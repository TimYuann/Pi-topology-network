/**
 * Slice 6: Migration from current single-Mission layout to per-Mission
 * directory layout.
 *
 * Spec reference: `docs/14-pi-topology-mission-runtime-spec.md` §12
 * ("Migration").
 *
 * The migration is a one-shot operator-initiated flow:
 *
 *   1. Read and validate root Mission (`mission-card.json`).
 *   2. Create `.pi/topology/missions/<mission_id>/`.
 *   3. Copy root active files into that folder.
 *   4. Write `mission-registry.json`.
 *   5. Write `active-mission.json`.
 *   6. Keep root files as active mirrors (root-mirror.ts already does this
 *      for the 5 spec §3.2 mirror files; slice 6 leaves the legacy
 *      `mission-card.json` and `status-board.json` in place as readable
 *      fallbacks for tools that haven't migrated).
 *   7. Append `mission_migrated` event to the new per-Mission
 *      `runtime-events.jsonl`.
 *
 * If copied files are missing, create empty compatible files with
 * `_meta.inferred_empty: true` (per spec §12.1: "Reviewers must be able
 * to distinguish 'truly no events yet' from 'legacy file was missing
 * during migration.'"). For JSONL ledgers, write a first metadata row
 * with `event_type: "migration_inferred_empty"`.
 *
 * Design rules (slice 6 scope discipline):
 *   - Migration is opt-in. The dashboard, picker, and per-Mission tools
 *     work without migration; legacy paths are still readable.
 *   - Migration is idempotent: re-running on a migrated workspace returns
 *     `mode: "already_done"` (or `mode: "no_legacy"` if legacy paths
 *     are gone).
 *   - Migration is non-destructive: legacy root files are preserved.
 *   - No Pi primitives introduced.
 *   - No raw transport touched.
 */

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createMissionLayout, missionLayoutPaths, validateMissionIdPathSegment } from "./mission-layout.ts";
import { syncRootMirrorFromLayout } from "./root-mirror.ts";
import {
  addMissionToRegistry,
  createEmptyRegistry,
  newMissionRegistryEntry,
  readMissionRegistry,
  writeMissionRegistry,
  type MissionRegistry,
  type MissionRegistryEntry,
  type MissionRegistryRoleSummary,
} from "./mission-registry.ts";
import {
  buildActiveMissionPointer,
  writeActiveMissionPointer,
} from "./mission-pointer.ts";
import {
  appendMissionLifecycleTransition,
  MISSION_LIFECYCLE_TRANSITION_EVENT,
} from "./mission-events.ts";
import { validateMissionCard, type MissionCard, type StatusBoard } from "./mission.ts";
import { ROOT_MISSION_CARD_RELATIVE } from "./supervisor-picker.ts";
import {
  appendPacketLedger,
  PACKET_STATES,
  PACKET_TYPES,
  type PacketLedgerEntry,
  type PacketState,
  type PacketType,
} from "./packet-ledger.ts";
import type { TopologyRole } from "./mission.ts";

export const ROOT_MISSION_CARD_PATH = ROOT_MISSION_CARD_RELATIVE;

export const ROOT_STATUS_BOARD_PATH = ".pi/topology/status-board.json";
export const ROOT_SESSIONS_PATH = ".pi/topology/sessions.jsonl";
export const ROOT_RUNTIME_EVENTS_PATH = ".pi/topology/runtime-events.jsonl";
export const ROOT_INCIDENT_LOG_PATH = ".pi/topology/incident-log.jsonl";
export const ROOT_LAUNCH_DIR = ".pi/topology/launch";
export const ROOT_ARTIFACTS_DIR = ".pi/topology/artifacts";

const TOPOLOGY_ROLE_SET = new Set<TopologyRole>([
  "topology-supervisor",
  "hq",
  "repair",
  "runner",
  "oracle",
  "librarian",
  "scott",
]);

export interface LegacyMissionData {
  mission_id: string;
  mission_card: MissionCard;
  status_board: StatusBoard | null;
  files: {
    mission_card: { source: string; exists: boolean; bytes: number };
    status_board: { source: string; exists: boolean; bytes: number };
    sessions: { source: string; exists: boolean; bytes: number; lines: number };
    runtime_events: { source: string; exists: boolean; bytes: number; lines: number };
    incident_log: { source: string; exists: boolean; bytes: number; lines: number };
  };
}

export type MigrationMode =
  | "migrated"
  | "already_done"
  | "no_legacy"
  | "registry_present"
  | "validation_failed"
  | "error";

export interface MigrationResult {
  ok: boolean;
  mode: MigrationMode;
  mission_id: string | null;
  reason: string | null;
  files_migrated: string[];
  files_created_empty: string[];
  warnings: string[];
  generated_at: string;
}

/**
 * Legacy detection (spec §12.1): root `.pi/topology/mission-card.json` exists
 * AND root `mission-registry.json` does not exist.
 */
export function detectLegacyLayout(workspaceDir: string): boolean {
  const missionCard = path.join(workspaceDir, ROOT_MISSION_CARD_PATH);
  const registry = path.join(workspaceDir, ".pi", "topology", "mission-registry.json");
  return existsSync(missionCard) && !existsSync(registry);
}

/** Convenience: workspace needs migration iff legacy is detected. */
export function isMigrationNeeded(workspaceDir: string): boolean {
  return detectLegacyLayout(workspaceDir);
}

function readJsonSafe<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function countJsonlLines(filePath: string): number {
  if (!existsSync(filePath)) return 0;
  return readFileSync(filePath, "utf8").split("\n").filter((l) => l.trim().length > 0).length;
}

/**
 * Read legacy single-Mission data. Returns null when the legacy
 * `mission-card.json` is missing or invalid.
 */
export function readLegacyMissionData(workspaceDir: string): LegacyMissionData | null {
  const missionCardPath = path.join(workspaceDir, ROOT_MISSION_CARD_PATH);
  const statusBoardPath = path.join(workspaceDir, ROOT_STATUS_BOARD_PATH);
  const sessionsPath = path.join(workspaceDir, ROOT_SESSIONS_PATH);
  const runtimeEventsPath = path.join(workspaceDir, ROOT_RUNTIME_EVENTS_PATH);
  const incidentLogPath = path.join(workspaceDir, ROOT_INCIDENT_LOG_PATH);

  const card = readJsonSafe<MissionCard>(missionCardPath);
  if (!card) return null;
  if (!card.mission_id) return null;
  const status = readJsonSafe<StatusBoard>(statusBoardPath);

  return {
    mission_id: card.mission_id,
    mission_card: card,
    status_board: status,
    files: {
      mission_card: {
        source: missionCardPath,
        exists: existsSync(missionCardPath),
        bytes: existsSync(missionCardPath) ? readFileSync(missionCardPath, "utf8").length : 0,
      },
      status_board: {
        source: statusBoardPath,
        exists: existsSync(statusBoardPath),
        bytes: existsSync(statusBoardPath) ? readFileSync(statusBoardPath, "utf8").length : 0,
      },
      sessions: {
        source: sessionsPath,
        exists: existsSync(sessionsPath),
        bytes: existsSync(sessionsPath) ? readFileSync(sessionsPath, "utf8").length : 0,
        lines: countJsonlLines(sessionsPath),
      },
      runtime_events: {
        source: runtimeEventsPath,
        exists: existsSync(runtimeEventsPath),
        bytes: existsSync(runtimeEventsPath) ? readFileSync(runtimeEventsPath, "utf8").length : 0,
        lines: countJsonlLines(runtimeEventsPath),
      },
      incident_log: {
        source: incidentLogPath,
        exists: existsSync(incidentLogPath),
        bytes: existsSync(incidentLogPath) ? readFileSync(incidentLogPath, "utf8").length : 0,
        lines: countJsonlLines(incidentLogPath),
      },
    },
  };
}

/** Copy a file from source to destination; returns true on success. */
function copyFileSyncCompat(source: string, dest: string): boolean {
  if (!existsSync(source)) return false;
  const content = readFileSync(source, "utf8");
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(dest, content, "utf8");
  return true;
}

function listRelativeFiles(dir: string, prefix = ""): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = path.join(prefix, entry.name);
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listRelativeFiles(full, rel));
    } else {
      out.push(rel);
    }
  }
  return out;
}

function copyDirectoryContents(sourceDir: string, destDir: string, resultPrefix: string): string[] {
  if (!existsSync(sourceDir)) return [];
  mkdirSync(destDir, { recursive: true });
  const copied = listRelativeFiles(sourceDir).map((rel) => path.join(resultPrefix, rel));
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    cpSync(path.join(sourceDir, entry.name), path.join(destDir, entry.name), {
      recursive: true,
      force: true,
    });
  }
  return copied;
}

function isTopologyRole(value: unknown): value is TopologyRole {
  return typeof value === "string" && TOPOLOGY_ROLE_SET.has(value as TopologyRole);
}

function isPacketState(value: unknown): value is PacketState {
  return typeof value === "string" && (PACKET_STATES as readonly string[]).includes(value);
}

function isPacketType(value: unknown): value is PacketType {
  return typeof value === "string" && (PACKET_TYPES as readonly string[]).includes(value);
}

function migrateLegacyPendingPackets(
  workspaceDir: string,
  layout: ReturnType<typeof missionLayoutPaths>,
  statusBoard: StatusBoard | null,
): number {
  const pending = Array.isArray(statusBoard?.pending_packets) ? statusBoard.pending_packets : [];
  let migrated = 0;
  for (const raw of pending) {
    if (!raw || typeof raw !== "object") continue;
    const packet = raw as Record<string, unknown>;
    if (
      typeof packet.packet_id !== "string" ||
      !isPacketType(packet.type) ||
      !isTopologyRole(packet.from) ||
      !isTopologyRole(packet.to)
    ) {
      continue;
    }
    const sentAt = typeof packet.sent_at === "string" ? packet.sent_at : new Date().toISOString();
    const lastSeen =
      (typeof packet.closed_at === "string" && packet.closed_at) ||
      (typeof packet.report_acknowledged_at === "string" && packet.report_acknowledged_at) ||
      (typeof packet.reported_at === "string" && packet.reported_at) ||
      (typeof packet.acknowledged_at === "string" && packet.acknowledged_at) ||
      (typeof packet.delivered_at === "string" && packet.delivered_at) ||
      sentAt;
    const entry: PacketLedgerEntry = {
      packet_id: packet.packet_id,
      mission_id: layout.missionId,
      type: packet.type as PacketType,
      from: packet.from,
      to: packet.to,
      request_msg_id: typeof packet.request_msg_id === "string" ? packet.request_msg_id : null,
      correlation_id: typeof packet.correlation_id === "string" ? packet.correlation_id : null,
      state: isPacketState(packet.state) ? packet.state : "delivered",
      raw_transport_path: ROOT_STATUS_BOARD_PATH,
      first_seen_at: sentAt,
      last_seen_at: lastSeen,
      classification_reason: "migrated from legacy status-board pending_packets",
      artifact_path: null,
    };
    appendPacketLedger(workspaceDir, layout, entry);
    migrated += 1;
  }
  return migrated;
}

/** Write a JSON file with `_meta.inferred_empty: true` for legacy-missing files. */
function writeInferredEmptyJson(dest: string, sourceForType: string | null): void {
  mkdirSync(path.dirname(dest), { recursive: true });
  if (sourceForType && existsSync(sourceForType)) {
    // If a status board file existed but was empty/invalid, copy whatever
    // is readable. Otherwise emit an inferred-empty marker.
    try {
      const raw = readFileSync(sourceForType, "utf8");
      if (raw.trim().length > 0) {
        const parsed = JSON.parse(raw);
        writeFileSync(dest, `${JSON.stringify({ ...parsed, _meta: { inferred_empty: true } }, null, 2)}\n`, "utf8");
        return;
      }
    } catch {
      // fall through to inferred-empty
    }
  }
  writeFileSync(dest, `${JSON.stringify({ _meta: { inferred_empty: true } }, null, 2)}\n`, "utf8");
}

/** Write a JSONL file with a single `migration_inferred_empty` row. */
function writeInferredEmptyJsonl(dest: string): void {
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(
    dest,
    `${JSON.stringify({ event_type: "migration_inferred_empty", _meta: { inferred_empty: true } })}\n`,
    "utf8",
  );
}

export interface MigrateOptions {
  now?: Date;
  /** When true, simulate without writing files. Default false. */
  dryRun?: boolean;
}

/**
 * Migrate legacy single-Mission layout to per-Mission layout per spec
 * §12.1. Idempotent and non-destructive.
 */
export function migrateLegacyToPerMission(
  workspaceDir: string,
  options: MigrateOptions = {},
): MigrationResult {
  const now = options.now ?? new Date();
  const generated_at = now.toISOString();
  const warnings: string[] = [];
  const files_migrated: string[] = [];
  const files_created_empty: string[] = [];

  // Step 1: detect legacy.
  if (!detectLegacyLayout(workspaceDir)) {
    // Could be: no legacy (already migrated, or fresh), or registry already exists.
    const registry = readMissionRegistry(workspaceDir);
    if (registry) {
      return {
        ok: true,
        mode: "registry_present",
        mission_id: null,
        reason: "mission-registry.json already exists; nothing to migrate",
        files_migrated,
        files_created_empty,
        warnings,
        generated_at,
      };
    }
    return {
      ok: true,
      mode: "no_legacy",
      mission_id: null,
      reason: "no legacy mission-card.json found; nothing to migrate",
      files_migrated,
      files_created_empty,
      warnings,
      generated_at,
    };
  }

  // Step 2: read legacy data.
  const legacy = readLegacyMissionData(workspaceDir);
  if (!legacy) {
    return {
      ok: false,
      mode: "validation_failed",
      mission_id: null,
      reason: "legacy mission-card.json missing or invalid",
      files_migrated,
      files_created_empty,
      warnings,
      generated_at,
    };
  }

  // Validate the legacy card.
  const validation = validateMissionCard(legacy.mission_card);
  if (!validation.ok) {
    return {
      ok: false,
      mode: "validation_failed",
      mission_id: legacy.mission_id,
      reason: `legacy mission-card.json validation failed: ${validation.errors.join("; ")}`,
      files_migrated,
      files_created_empty,
      warnings,
      generated_at,
    };
  }

  // Slice 6.1: defense in depth — a legacy mission_id from a hand-edited
  // or poisoned root file may path-traverse out of the missions root.
  // `validateMissionCard` does not check the id format; `missionLayoutPaths`
  // re-validates and throws InvalidMissionIdError, which would turn the
  // migration into a hard error. Surface this as `validation_failed`
  // here, BEFORE any files are written.
  try {
    validateMissionIdPathSegment(legacy.mission_id);
  } catch (err) {
    return {
      ok: false,
      mode: "validation_failed",
      mission_id: legacy.mission_id,
      reason: `legacy mission_id invalid: ${(err as Error).message}`,
      files_migrated,
      files_created_empty,
      warnings,
      generated_at,
    };
  }

  if (options.dryRun) {
    return {
      ok: true,
      mode: "migrated",
      mission_id: legacy.mission_id,
      reason: "dry-run; no files written",
      files_migrated: [
        legacy.files.mission_card.source,
        legacy.files.status_board.source,
        legacy.files.sessions.source,
        legacy.files.runtime_events.source,
        legacy.files.incident_log.source,
      ],
      files_created_empty: [],
      warnings,
      generated_at,
    };
  }

  // Step 3: create per-Mission layout (mission-card.json, status-board.json,
  //          runtime-events.jsonl, incident-log.jsonl, sessions.jsonl,
  //          artifacts/, slices/, etc.).
  const layout = missionLayoutPaths(workspaceDir, legacy.mission_id);
  // Slice 6.1: track whether the legacy status board was missing so we can
  // mark the per-Mission copy as inferred_empty per spec §12.1.
  const legacyStatusBoardMissing = !legacy.status_board;
  const initialStatusBoard: StatusBoard = legacy.status_board ?? {
    mission_id: legacy.mission_id,
    runtime_phase: "intake",
    last_updated_at: now.toISOString(),
    pending_packets: [],
    next_gate: null,
  };
  const { created } = createMissionLayout({
    workspaceDir,
    missionCard: legacy.mission_card,
    initialStatusBoard,
  });
  if (!created) {
    return {
      ok: false,
      mode: "error",
      mission_id: legacy.mission_id,
      reason: `mission layout for ${legacy.mission_id} already exists; refusing to overwrite`,
      files_migrated,
      files_created_empty,
      warnings,
      generated_at,
    };
  }

  // Slice 6.1: when the legacy status board was missing, rewrite the
  // per-Mission copy with `_meta.inferred_empty: true` so reviewers can
  // distinguish "truly no events yet" from "legacy file was missing
  // during migration" (spec §12.1 audit requirement). Also add the
  // filename to files_created_empty.
  if (legacyStatusBoardMissing) {
    try {
      const raw = readFileSync(layout.statusBoardPath, "utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      writeFileSync(
        layout.statusBoardPath,
        `${JSON.stringify({ ...parsed, _meta: { inferred_empty: true } }, null, 2)}\n`,
        "utf8",
      );
      files_created_empty.push("status-board.json");
    } catch (err) {
      warnings.push(
        `failed to mark status-board.json as inferred_empty: ${(err as Error).message}`,
      );
    }
  }

  // Step 4: copy legacy files into the per-Mission directory. The
  // mission-card.json and status-board.json were already written by
  // createMissionLayout (from the same source content). Copy the
  // JSONL ledgers explicitly.
  if (legacy.files.sessions.exists) {
    if (copyFileSyncCompat(legacy.files.sessions.source, layout.sessionsPath)) {
      files_migrated.push("sessions.jsonl");
    } else {
      writeInferredEmptyJsonl(layout.sessionsPath);
      files_created_empty.push("sessions.jsonl");
    }
  } else {
    writeInferredEmptyJsonl(layout.sessionsPath);
    files_created_empty.push("sessions.jsonl");
  }
  if (legacy.files.runtime_events.exists) {
    if (copyFileSyncCompat(legacy.files.runtime_events.source, layout.runtimeEventsPath)) {
      files_migrated.push("runtime-events.jsonl");
    } else {
      writeInferredEmptyJsonl(layout.runtimeEventsPath);
      files_created_empty.push("runtime-events.jsonl");
    }
  } else {
    writeInferredEmptyJsonl(layout.runtimeEventsPath);
    files_created_empty.push("runtime-events.jsonl");
  }
  if (legacy.files.incident_log.exists) {
    if (copyFileSyncCompat(legacy.files.incident_log.source, layout.incidentLogPath)) {
      files_migrated.push("incident-log.jsonl");
    } else {
      writeInferredEmptyJsonl(layout.incidentLogPath);
      files_created_empty.push("incident-log.jsonl");
    }
  } else {
    writeInferredEmptyJsonl(layout.incidentLogPath);
    files_created_empty.push("incident-log.jsonl");
  }

  const launchFiles = copyDirectoryContents(
    path.join(workspaceDir, ROOT_LAUNCH_DIR),
    layout.launchDir,
    "launch",
  );
  files_migrated.push(...launchFiles);
  const artifactFiles = copyDirectoryContents(
    path.join(workspaceDir, ROOT_ARTIFACTS_DIR),
    layout.artifactsDir,
    "artifacts",
  );
  files_migrated.push(...artifactFiles);

  const migratedPacketCount = migrateLegacyPendingPackets(workspaceDir, layout, legacy.status_board);
  if (migratedPacketCount > 0) {
    files_migrated.push("packet-ledger.jsonl");
  }

  // Step 5: write mission-registry.json.
  const lifecycle_state = "draft" as const; // migrations always start at draft
  const progress_status = "draft" as const;
  const role_summary: MissionRegistryRoleSummary = {
    live: 0,
    resumable: 0,
    stale: 0,
    parked: 0,
    closed: 0,
  };
  const newEntry: MissionRegistryEntry = newMissionRegistryEntry({
    mission_id: legacy.mission_id,
    title: legacy.mission_card.objective ?? legacy.mission_id,
    objective: legacy.mission_card.objective ?? "",
    lifecycle_state,
    progress_status,
    owner_gate: "required",
    blocked: false,
    archived: false,
    mission_dir: layout.missionDirRelative,
  });
  // Override computed fields to avoid divergence from `emptyRoleSummary()`.
  newEntry.role_summary = role_summary;
  const registry = readMissionRegistry(workspaceDir) ?? createEmptyRegistry(now);
  const addResult = addMissionToRegistry(registry, newEntry, now);
  if (registry.active_mission_id === null) {
    addResult.registry.active_mission_id = legacy.mission_id;
  }
  // Write the registry ourselves to keep `active_mission_id` in sync.
  const finalRegistry: MissionRegistry = addResult.registry;
  // We re-write using writeMissionRegistry from mission-registry. The
  // `addMissionToRegistry` already writes internally for added entries,
  // so we just need to ensure the active_mission_id is set.
  if (registry.active_mission_id === null) {
    finalRegistry.active_mission_id = legacy.mission_id;
    finalRegistry.updated_at = now.toISOString();
    writeMissionRegistry(workspaceDir, finalRegistry);
  }

  // Step 6: write active-mission.json.
  writeActiveMissionPointer(
    workspaceDir,
    buildActiveMissionPointer({
      mission_id: legacy.mission_id,
      mission_dir: layout.missionDirRelative,
      reason: "migration",
      event_id: `evt_migration_${legacy.mission_id}_${now.getTime()}`,
      now,
    }),
  );

  // Step 7: append mission_migrated event.
  appendMissionLifecycleTransition(
    workspaceDir,
    layout,
    {
      from_state: "intake",
      to_state: lifecycle_state,
      owner_gate: "required",
      reason: "migrated from legacy single-Mission layout",
      context: {
        source: "legacy_root",
        files_migrated,
        files_created_empty,
      },
    },
    now,
  );

  // v0.5.1 Slice D / spec §3.2 + §12.2: after migration, sync root
  // compatibility mirror from the new per-mission canonical files. Root
  // stays a mirror; per-mission is the canonical source of truth.
  syncRootMirrorFromLayout(workspaceDir, layout);

  return {
    ok: true,
    mode: "migrated",
    mission_id: legacy.mission_id,
    reason: null,
    files_migrated,
    files_created_empty,
    warnings,
    generated_at,
  };
}

/** Render a migration result for owner-facing text output. */
export function formatMigrationResult(result: MigrationResult): string {
  const lines: string[] = [];
  lines.push(`topology migrate: ${result.mode}`);
  lines.push(`ok: ${result.ok}`);
  if (result.mission_id) lines.push(`mission_id: ${result.mission_id}`);
  if (result.reason) lines.push(`reason: ${result.reason}`);
  if (result.files_migrated.length) {
    lines.push("");
    lines.push("files migrated:");
    for (const f of result.files_migrated) lines.push(`  - ${f}`);
  }
  if (result.files_created_empty.length) {
    lines.push("");
    lines.push("files created (inferred empty):");
    for (const f of result.files_created_empty) lines.push(`  - ${f}`);
  }
  if (result.warnings.length) {
    lines.push("");
    lines.push("warnings:");
    for (const w of result.warnings) lines.push(`  - ${w}`);
  }
  return lines.join("\n");
}
