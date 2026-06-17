/**
 * Slice 5: Multi-Mission dashboard snapshot.
 *
 * Spec reference: `docs/14-pi-topology-mission-runtime-spec.md` §10
 * ("UI, Footer, And Status").
 *
 * The dashboard is the owner-facing summary of the **active** Mission
 * (current-Mission-first per spec §10). It assembles 8 required fields from
 * per-Mission data sources created in slices 1-4:
 *
 *   1. active Mission id/title          ← active-mission pointer + registry
 *   2. lifecycle state                  ← registry entry
 *   3. owner gate                       ← registry entry
 *   4. next action                      ← picker snapshot (slice 2)
 *   5. role counts (5-state)            ← sessions.jsonl + classify (slice 3)
 *   6. pending active packet count      ← packet-ledger.jsonl (slice 4)
 *   7. incident count                   ← incident-log.jsonl
 *   8. closeout/artifact pointer        ← registry + artifacts/ scan
 *
 * Design rules (Slice 5 scope discipline):
 *   - Read-only: dashboard does NOT mutate the registry by default. Role
 *     summary and pending packet count are recomputed from
 *     source-of-truth files (sessions.jsonl, packet-ledger.jsonl) on every
 *     read. `options.persistToRegistry = true` is opt-in for callers that
 *     want the registry to reflect the freshly-computed values.
 *   - Additive: does not replace the legacy `topology_status` tool or
 *     `topology-status` command. They continue to use legacy single-Mission
 *     paths; slice 6 handles the migration.
 *   - No Pi primitives: does not introduce `ctx.newSession`,
 *     `ctx.switchSession`, or any other session-changing API.
 *   - No raw transport touch: `src/transport/*` is not imported.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { validateMissionIdPathSegment } from "./mission-layout.ts";
import {
  findMissionInRegistry,
  readMissionRegistry,
  registryFilePath,
  writeMissionRegistry,
  type MissionRegistry,
  type MissionRegistryEntry,
  type MissionRegistryRoleSummary,
} from "./mission-registry.ts";
import {
  readActiveMissionPointer,
  type ActiveMissionPointer,
} from "./mission-pointer.ts";
import {
  missionLayoutPaths,
  type MissionLayoutPaths,
} from "./mission-layout.ts";
import {
  classifyAllRoles,
  computeRoleSummary,
  getRoleSessionRecords,
  type RoleLivenessClassification,
} from "./role-session.ts";
import {
  isActionableForRecipient,
  ACTIVE_READ_STATES,
  DEFAULT_STALE_THRESHOLD_MS,
  defaultActionableTypesForRole,
  classifyPacketLiveness,
  type ActivePacketsFilterOptions,
  type PacketLedgerEntry,
  type PacketType,
} from "./packet-ledger.ts";
import {
  availableActionsForOption,
  findMissionOption,
  readPickerSnapshot,
  type OwnerAction,
  type PickerMode,
  type PickerSnapshot,
} from "./supervisor-picker.ts";
import { type MissionLifecycleState } from "./mission-lifecycle.ts";
import { type TopologyRole } from "./mission.ts";

export interface DashboardRoleClassification {
  role: string;
  state: RoleLivenessClassification["state"];
  latest_record_state: string;
  age_ms: number;
  needs_liveness_confirmation: boolean;
}

export interface DashboardArtifact {
  path: string;
  name: string;
  size: number;
  mtime: string;
  kind: "file" | "directory";
}

export interface DashboardSnapshot {
  workspaceDir: string;
  generated_at: string;
  has_active_mission: boolean;
  has_registry: boolean;
  active_mission_id: string | null;
  // Active Mission fields (null when no active mission)
  title: string | null;
  mission_dir: string | null;
  lifecycle_state: MissionLifecycleState | null;
  owner_gate: string | null;
  blocked: boolean;
  archived: boolean;
  next_action: OwnerAction | null;
  available_actions: OwnerAction[];
  picker_mode: PickerMode;
  role_summary: MissionRegistryRoleSummary;
  role_classifications: DashboardRoleClassification[];
  pending_packet_count: number;
  pending_packet_total: number;
  stale_packet_count: number;
  incident_count: number;
  closeout_path: string | null;
  artifacts: DashboardArtifact[];
  // Diagnostic / path surface (for /topology dashboard-verbose)
  paths: {
    registry_path: string;
    active_pointer_path: string;
    mission_dir: string | null;
    mission_card_path: string | null;
    status_board_path: string | null;
    sessions_path: string | null;
    incident_log_path: string | null;
    packet_ledger_path: string | null;
    artifacts_dir: string | null;
  };
  warnings: string[];
}

/**
 * Recompute the pending packet count for one Mission, by reading
 * packet-ledger.jsonl + applying the same 4-filter rule as
 * `populatePendingPacketCountForMission` (mission_id + liveness + actionable)
 * but without mutating the registry.
 */
function countPendingPacketsReadOnly(
  workspaceDir: string,
  missionId: string,
  now: Date,
  staleThresholdMs: number,
  actionable: (role: TopologyRole) => ReadonlySet<PacketType>,
): { pending_count: number; total_active: number; stale_count: number } {
  const layout = missionLayoutPaths(workspaceDir, missionId);
  if (!existsSync(layout.packetLedgerPath)) {
    return { pending_count: 0, total_active: 0, stale_count: 0 };
  }
  let pending_count = 0;
  let total_active = 0;
  let stale_count = 0;
  const lines = readFileSync(layout.packetLedgerPath, "utf8").split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    let entry: PacketLedgerEntry;
    try {
      entry = JSON.parse(line) as PacketLedgerEntry;
    } catch {
      continue;
    }
    if (entry.mission_id !== missionId) continue;
    const liveness = classifyPacketLiveness(entry, now, staleThresholdMs);
    if (liveness === "stale") {
      stale_count += 1;
      continue;
    }
    if (!ACTIVE_READ_STATES.has(liveness)) continue;
    total_active += 1;
    if (isActionableForRecipient(entry, actionable)) {
      pending_count += 1;
    }
  }
  return { pending_count, total_active, stale_count };
}

function readMissionCardForDashboard(
  workspaceDir: string,
  missionId: string,
): { ok: true; roles: readonly string[] } | { ok: false; reason: string } {
  const layout = missionLayoutPaths(workspaceDir, missionId);
  if (!existsSync(layout.missionCardPath)) {
    return { ok: false, reason: `mission-card.json missing at ${layout.missionCardPath}` };
  }
  try {
    const card = JSON.parse(readFileSync(layout.missionCardPath, "utf8")) as {
      roles?: Record<string, unknown>;
    };
    return { ok: true, roles: Object.keys(card.roles ?? {}) };
  } catch (err) {
    return { ok: false, reason: `mission-card.json parse error: ${(err as Error).message}` };
  }
}

function readIncidentCount(layout: MissionLayoutPaths): number {
  if (!existsSync(layout.incidentLogPath)) return 0;
  const raw = readFileSync(layout.incidentLogPath, "utf8");
  return raw.split("\n").filter((line) => line.trim().length > 0).length;
}

function readArtifacts(layout: MissionLayoutPaths): DashboardArtifact[] {
  if (!existsSync(layout.artifactsDir)) return [];
  const entries = readdirSync(layout.artifactsDir, { withFileTypes: true });
  const out: DashboardArtifact[] = [];
  for (const ent of entries) {
    // Skip the per-role artifact subdirectories (e.g., `artifacts/hq/`).
    // These are organizational layout, not user-facing artifacts. Recurse
    // into them and surface the leaf files instead.
    if (ent.isDirectory()) {
      const subDir = path.join(layout.artifactsDir, ent.name);
      try {
        const subEntries = readdirSync(subDir, { withFileTypes: true });
        for (const sub of subEntries) {
          if (sub.isDirectory()) continue; // single-level only
          const subFull = path.join(subDir, sub.name);
          try {
            const stat = statSync(subFull);
            out.push({
              path: subFull,
              name: `${ent.name}/${sub.name}`,
              size: stat.size,
              mtime: stat.mtime.toISOString(),
              kind: "file",
            });
          } catch {
            // skip
          }
        }
      } catch {
        // skip
      }
      continue;
    }
    const full = path.join(layout.artifactsDir, ent.name);
    try {
      const stat = statSync(full);
      out.push({
        path: full,
        name: ent.name,
        size: stat.size,
        mtime: stat.mtime.toISOString(),
        kind: "file",
      });
    } catch {
      // unreadable entry — skip silently
    }
  }
  return out;
}

function buildPathsForActive(
  workspaceDir: string,
  missionId: string | null,
  activePointer: ActiveMissionPointer | null,
): DashboardSnapshot["paths"] {
  const base = {
    registry_path: registryFilePath(workspaceDir),
    active_pointer_path: activePointer
      ? path.join(workspaceDir, ".pi", "topology", "active-mission.json")
      : path.join(workspaceDir, ".pi", "topology", "active-mission.json"),
  };
  if (!missionId) {
    return {
      ...base,
      mission_dir: null,
      mission_card_path: null,
      status_board_path: null,
      sessions_path: null,
      incident_log_path: null,
      packet_ledger_path: null,
      artifacts_dir: null,
    };
  }
  const layout = missionLayoutPaths(workspaceDir, missionId);
  return {
    ...base,
    mission_dir: layout.missionDirAbsolute,
    mission_card_path: layout.missionCardPath,
    status_board_path: layout.statusBoardPath,
    sessions_path: layout.sessionsPath,
    incident_log_path: layout.incidentLogPath,
    packet_ledger_path: layout.packetLedgerPath,
    artifacts_dir: layout.artifactsDir,
  };
}

export interface ReadDashboardOptions {
  now?: Date;
  staleThresholdMs?: number;
  /** Override for tests. Defaults to `defaultActionableTypesForRole`. */
  actionableTypesForRole?: ActivePacketsFilterOptions["actionableTypesForRole"];
  /** If true, write-back role summary + pending packet count to the registry
   * (matches the slice 3/4 "populate" functions). Default: false. The
   * dashboard is read-only by design; this is opt-in for callers that want
   * the registry to reflect the freshly-computed values. */
  persistToRegistry?: boolean;
}

export function readDashboardSnapshot(
  workspaceDir: string,
  options: ReadDashboardOptions = {},
): DashboardSnapshot {
  const now = options.now ?? new Date();
  const staleThresholdMs = options.staleThresholdMs ?? DEFAULT_STALE_THRESHOLD_MS;
  const actionable = options.actionableTypesForRole ?? defaultActionableTypesForRole;

  const registry = readMissionRegistry(workspaceDir);
  const has_registry = Boolean(registry);
  const activePointer = readActiveMissionPointer(workspaceDir);
  const activeMissionId =
    activePointer?.mission_id ?? registry?.active_mission_id ?? null;

  const warnings: string[] = [];
  if (
    registry &&
    activePointer?.mission_id &&
    registry.active_mission_id &&
    activePointer.mission_id !== registry.active_mission_id
  ) {
    warnings.push(
      `active pointer (${activePointer.mission_id}) and registry.active_mission_id (${registry.active_mission_id}) disagree`,
    );
  }
  if (!activeMissionId) {
    return {
      workspaceDir,
      generated_at: now.toISOString(),
      has_active_mission: false,
      has_registry,
      active_mission_id: null,
      title: null,
      mission_dir: null,
      lifecycle_state: null,
      owner_gate: null,
      blocked: false,
      archived: false,
      next_action: null,
      available_actions: [],
      picker_mode: "registry",
      role_summary: { live: 0, resumable: 0, stale: 0, parked: 0, closed: 0 },
      role_classifications: [],
      pending_packet_count: 0,
      pending_packet_total: 0,
      stale_packet_count: 0,
      incident_count: 0,
      closeout_path: null,
      artifacts: [],
      paths: buildPathsForActive(workspaceDir, null, activePointer),
      warnings,
    };
  }

  // Validate mission_id against path-traversal. If the active Mission id is
  // invalid (e.g. `../evil` from a poisoned active pointer or registry
  // entry), `missionLayoutPaths` would re-validate and throw, which would
  // turn the dashboard into a hard error. Degrade gracefully instead:
  // surface an `invalid active mission_id` warning AND return the
  // no-active-mission snapshot so the caller can recover (operator can
  // inspect the warning and reset the active pointer or registry).
  try {
    validateMissionIdPathSegment(activeMissionId);
  } catch (err) {
    warnings.push(
      `active mission_id invalid (${(err as Error).message}); falling back to no-active-mission snapshot`,
    );
    return {
      workspaceDir,
      generated_at: now.toISOString(),
      has_active_mission: false,
      has_registry,
      active_mission_id: null,
      title: null,
      mission_dir: null,
      lifecycle_state: null,
      owner_gate: null,
      blocked: false,
      archived: false,
      next_action: null,
      available_actions: [],
      picker_mode: "registry",
      role_summary: { live: 0, resumable: 0, stale: 0, parked: 0, closed: 0 },
      role_classifications: [],
      pending_packet_count: 0,
      pending_packet_total: 0,
      stale_packet_count: 0,
      incident_count: 0,
      closeout_path: null,
      artifacts: [],
      paths: buildPathsForActive(workspaceDir, null, activePointer),
      warnings,
    };
  }

  const entry = registry ? findMissionInRegistry(registry, activeMissionId) : null;
  const layout = missionLayoutPaths(workspaceDir, activeMissionId);

  // Role summary: recompute from sessions.jsonl.
  let role_summary: MissionRegistryRoleSummary = {
    live: 0,
    resumable: 0,
    stale: 0,
    parked: 0,
    closed: 0,
  };
  let role_classifications: DashboardRoleClassification[] = [];
  if (existsSync(layout.missionCardPath)) {
    const cardResult = readMissionCardForDashboard(workspaceDir, activeMissionId);
    if (cardResult.ok) {
      const records = getRoleSessionRecords(workspaceDir, activeMissionId);
      const classifications = classifyAllRoles(cardResult.roles as TopologyRole[], records, {
        now,
        isMissionClosed: entry
          ? entry.lifecycle_state === "delivered" || entry.lifecycle_state === "abandoned"
          : false,
        isMissionArchived: entry?.archived ?? false,
        ownerParkedRoles: new Set<TopologyRole>(),
      });
      role_summary = computeRoleSummary(classifications);
      role_classifications = classifications.map((c) => ({
        role: c.role,
        state: c.state,
        latest_record_state: c.latest_event_type ?? "none",
        age_ms: c.latest_event_timestamp ? now.getTime() - new Date(c.latest_event_timestamp).getTime() : -1,
        needs_liveness_confirmation: c.needs_liveness_confirmation ?? false,
      }));
    } else {
      warnings.push(cardResult.reason);
    }
  } else {
    warnings.push(`mission-card.json missing at ${layout.missionCardPath}; role summary is empty`);
  }

  // Pending packet count: recompute from packet-ledger.jsonl.
  const packetCounts = countPendingPacketsReadOnly(workspaceDir, activeMissionId, now, staleThresholdMs, actionable);

  // Incident count: read from incident-log.jsonl (recomputed).
  const incident_count = readIncidentCount(layout);

  // Closeout path: from registry.
  const closeout_path = entry?.closeout_path ?? null;

  // Artifacts: scan artifacts/ dir.
  const artifacts = readArtifacts(layout);

  // Next action: from picker snapshot.
  let next_action: OwnerAction | null = null;
  let available_actions: OwnerAction[] = [];
  const pickerSnapshot: PickerSnapshot = readPickerSnapshot(workspaceDir, { now });
  const option = findMissionOption(pickerSnapshot, activeMissionId);
  if (option) {
    available_actions = availableActionsForOption(option, pickerSnapshot.mode);
    next_action = available_actions[0] ?? null;
  }

  // Optional persistence (slice 3/4 populate behavior).
  if (options.persistToRegistry && registry && entry) {
    const idx = registry.missions.findIndex((m) => m.mission_id === activeMissionId);
    if (idx >= 0) {
      const updated_entry: MissionRegistryEntry = {
        ...entry,
        role_summary,
        pending_packet_count: packetCounts.pending_count,
        last_updated_at: now.toISOString(),
      };
      const updated_registry: MissionRegistry = {
        ...registry,
        updated_at: now.toISOString(),
        missions: [
          ...registry.missions.slice(0, idx),
          updated_entry,
          ...registry.missions.slice(idx + 1),
        ],
      };
      writeMissionRegistry(workspaceDir, updated_registry);
    }
  }

  return {
    workspaceDir,
    generated_at: now.toISOString(),
    has_active_mission: true,
    has_registry,
    active_mission_id: activeMissionId,
    title: entry?.title ?? null,
    mission_dir: layout.missionDirAbsolute,
    lifecycle_state: entry?.lifecycle_state ?? null,
    owner_gate: entry?.owner_gate ?? null,
    blocked: entry?.blocked ?? false,
    archived: entry?.archived ?? false,
    next_action,
    available_actions,
    picker_mode: pickerSnapshot.mode,
    role_summary,
    role_classifications,
    pending_packet_count: packetCounts.pending_count,
    pending_packet_total: packetCounts.total_active,
    stale_packet_count: packetCounts.stale_count,
    incident_count,
    closeout_path,
    artifacts,
    paths: buildPathsForActive(workspaceDir, activeMissionId, activePointer),
    warnings,
  };
}

/** Compact one-line-per-field text. Used by `/topology dashboard`. */
export function formatDashboardText(snapshot: DashboardSnapshot): string {
  const lines: string[] = [];
  if (!snapshot.has_active_mission) {
    lines.push("topology dashboard (no active mission)");
    lines.push(`workspace: ${snapshot.workspaceDir}`);
    lines.push(`registry: ${snapshot.has_registry ? "present" : "absent"}`);
    if (snapshot.warnings.length) {
      lines.push("");
      lines.push("warnings:");
      for (const w of snapshot.warnings) lines.push(`  - ${w}`);
    }
    return lines.join("\n");
  }
  lines.push(`mission: ${snapshot.active_mission_id} (${snapshot.title ?? "untitled"})`);
  lines.push(`lifecycle: ${snapshot.lifecycle_state ?? "unknown"}`);
  lines.push(`owner_gate: ${snapshot.owner_gate ?? "unknown"}`);
  lines.push(`next_action: ${snapshot.next_action ?? "none"}`);
  const s = snapshot.role_summary;
  lines.push(`roles: live=${s.live} resumable=${s.resumable} stale=${s.stale} parked=${s.parked} closed=${s.closed}`);
  lines.push(
    `pending_packets: ${snapshot.pending_packet_count} (active_total=${snapshot.pending_packet_total}, stale=${snapshot.stale_packet_count})`,
  );
  lines.push(`incidents: ${snapshot.incident_count}`);
  lines.push(`closeout: ${snapshot.closeout_path ?? "none"}`);
  if (snapshot.artifacts.length) {
    lines.push(`artifacts: ${snapshot.artifacts.length} entries`);
  }
  if (snapshot.warnings.length) {
    lines.push("");
    lines.push("warnings:");
    for (const w of snapshot.warnings) lines.push(`  - ${w}`);
  }
  return lines.join("\n");
}

/** Detailed text with full paths. Used by `/topology dashboard-verbose`. */
export function formatDashboardTextDetailed(snapshot: DashboardSnapshot): string {
  const compact = formatDashboardText(snapshot);
  const lines: string[] = [compact, "", "paths:"];
  for (const [key, value] of Object.entries(snapshot.paths)) {
    lines.push(`  ${key}: ${value ?? "(unset)"}`);
  }
  if (snapshot.artifacts.length) {
    lines.push("");
    lines.push("artifacts:");
    for (const art of snapshot.artifacts) {
      lines.push(`  ${art.kind}: ${art.path}`);
    }
  }
  if (snapshot.role_classifications.length) {
    lines.push("");
    lines.push("role classifications:");
    for (const c of snapshot.role_classifications) {
      const age = c.age_ms < 0 ? "n/a" : `${Math.floor(c.age_ms / 1000)}s`;
      lines.push(`  ${c.role}: ${c.state} (latest=${c.latest_record_state}, age=${age}, confirm=${c.needs_liveness_confirmation})`);
    }
  }
  return lines.join("\n");
}

/** Structured form for `ctx.ui.setStatus` / `ctx.ui.setWidget` consumption. */
export interface DashboardWidgetEntry {
  name: string;
  value: string;
  description?: string;
}

export function formatDashboardWidget(snapshot: DashboardSnapshot): {
  status: DashboardWidgetEntry[];
  widget: Record<string, unknown>;
} {
  const status: DashboardWidgetEntry[] = [];
  if (!snapshot.has_active_mission) {
    status.push({ name: "topology.mission", value: "none", description: "no active Mission" });
    return { status, widget: { mission: "none" } };
  }
  status.push({ name: "topology.mission", value: snapshot.active_mission_id ?? "unknown" });
  if (snapshot.title) status.push({ name: "topology.title", value: snapshot.title });
  if (snapshot.lifecycle_state) status.push({ name: "topology.lifecycle", value: snapshot.lifecycle_state });
  if (snapshot.owner_gate) status.push({ name: "topology.owner_gate", value: snapshot.owner_gate });
  if (snapshot.next_action) status.push({ name: "topology.next_action", value: snapshot.next_action });
  status.push({ name: "topology.pending_packets", value: String(snapshot.pending_packet_count) });
  status.push({ name: "topology.incidents", value: String(snapshot.incident_count) });
  status.push({
    name: "topology.roles",
    value: `live=${snapshot.role_summary.live}/resumable=${snapshot.role_summary.resumable}/stale=${snapshot.role_summary.stale}/parked=${snapshot.role_summary.parked}/closed=${snapshot.role_summary.closed}`,
  });
  const widget: Record<string, unknown> = {
    mission_id: snapshot.active_mission_id,
    title: snapshot.title,
    lifecycle_state: snapshot.lifecycle_state,
    owner_gate: snapshot.owner_gate,
    blocked: snapshot.blocked,
    archived: snapshot.archived,
    next_action: snapshot.next_action,
    available_actions: snapshot.available_actions,
    picker_mode: snapshot.picker_mode,
    role_summary: snapshot.role_summary,
    role_classifications: snapshot.role_classifications,
    pending_packet_count: snapshot.pending_packet_count,
    pending_packet_total: snapshot.pending_packet_total,
    stale_packet_count: snapshot.stale_packet_count,
    incident_count: snapshot.incident_count,
    closeout_path: snapshot.closeout_path,
    artifacts: snapshot.artifacts,
    paths: snapshot.paths,
    warnings: snapshot.warnings,
    generated_at: snapshot.generated_at,
  };
  return { status, widget };
}
