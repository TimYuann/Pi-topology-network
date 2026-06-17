import { existsSync } from "node:fs";
import path from "node:path";
import {
  readMissionRegistry,
  registryFilePath,
  type MissionRegistryEntry,
} from "./mission-registry.ts";
import {
  readActiveMissionPointer,
  activeMissionPointerPath,
} from "./mission-pointer.ts";
import type { MissionLegacyProgressStatus, MissionLifecycleState } from "./mission-lifecycle.ts";
import type { OwnerGateState } from "./mission-registry.ts";

/**
 * Supervisor Mission picker snapshot.
 *
 * Spec reference: `docs/14-pi-topology-mission-runtime-spec.md` §5
 *
 * `/topology` reads this snapshot, classifies Missions into the 6 spec §5.2
 * categories (new/active/resumed/archived/blocked/parked), and presents them
 * to the owner. The picker is read-only (per spec §5.1 + PRD review Gap 3.1);
 * mutations go through `mission-actions.ts` action handlers.
 *
 * Three load modes per spec §5.1:
 *   - registry: `mission-registry.json` exists → use registry as truth
 *   - legacy_root: no registry but root `mission-card.json` exists → legacy mode
 *   - intake: neither exists → show intake (create new Mission)
 *
 * role_summary is intentionally zeroed in slice 2 (slice 3 session registry
 * will populate it; per spec review Gap 6.1 slice 2 deferral).
 */

export type PickerMode = "registry" | "legacy_root" | "intake";

export type MissionCategory = "new" | "active" | "resumed" | "archived" | "blocked" | "parked";

export interface MissionOption {
  mission_id: string;
  title: string;
  objective: string;
  lifecycle_state: MissionLifecycleState;
  progress_status: MissionLegacyProgressStatus;
  owner_gate: OwnerGateState;
  blocked: boolean;
  archived: boolean;
  mission_dir: string;
  last_updated_at: string;
  pending_packet_count: number;
  incident_count: number;
  role_summary: MissionRegistryEntry["role_summary"];
  closeout_path: string | null;
  category: MissionCategory;
  is_active: boolean;
}

export interface LegacyRootOption {
  source: "legacy_root";
  mission_card_path: string;
  detected: true;
}

export interface PickerSnapshot {
  workspaceDir: string;
  mode: PickerMode;
  registry_path: string | null;
  active_mission_id: string | null;
  options: MissionOption[];
  legacy_root: LegacyRootOption | null;
  /**
   * True when the snapshot was taken AFTER the registry state stabilized.
   * Mutations to other Missions during picker display do NOT roll back the
   * owner's choice (per spec §5.1 + PRD review Gap 3.1).
   */
  snapshot_at: string;
}

export const ROOT_MISSION_CARD_RELATIVE = ".pi/topology/mission-card.json";

export function rootLegacyMissionCardPath(workspaceDir: string): string {
  return path.join(workspaceDir, ROOT_MISSION_CARD_RELATIVE);
}

/**
 * Classify a single registry entry into the spec §5.2 categories.
 *
 * Precedence (first match wins):
 *   archived → "archived"
 *   blocked  → "blocked"
 *   lifecycle_state === "parked" → "parked"
 *   mission_id === activeId     → "active"
 *   else                        → "resumed"
 */
export function classifyMission(
  entry: MissionRegistryEntry,
  activeMissionId: string | null,
): MissionCategory {
  if (entry.archived) return "archived";
  if (entry.blocked) return "blocked";
  if (entry.lifecycle_state === "parked") return "parked";
  if (activeMissionId !== null && entry.mission_id === activeMissionId) return "active";
  return "resumed";
}

function entryToOption(entry: MissionRegistryEntry, activeMissionId: string | null): MissionOption {
  return {
    mission_id: entry.mission_id,
    title: entry.title,
    objective: entry.objective,
    lifecycle_state: entry.lifecycle_state,
    progress_status: entry.progress_status,
    owner_gate: entry.owner_gate,
    blocked: entry.blocked,
    archived: entry.archived,
    mission_dir: entry.mission_dir,
    last_updated_at: entry.last_updated_at,
    pending_packet_count: entry.pending_packet_count,
    incident_count: entry.incident_count,
    role_summary: { ...entry.role_summary },
    closeout_path: entry.closeout_path,
    category: classifyMission(entry, activeMissionId),
    is_active: activeMissionId !== null && entry.mission_id === activeMissionId,
  };
}

export interface ReadPickerSnapshotOptions {
  now?: Date;
}

/**
 * Read the current picker snapshot from disk.
 *
 * This is a read-only snapshot (per spec §5.1: "The picker/dashboard is a
 * read-only snapshot at fetch time"). Callers that want to mutate MUST go
 * through `mission-actions.ts` action handlers and re-read state before
 * writing.
 */
export function readPickerSnapshot(
  workspaceDir: string,
  opts: ReadPickerSnapshotOptions = {},
): PickerSnapshot {
  const now = (opts.now ?? new Date()).toISOString();
  const regPath = registryFilePath(workspaceDir);
  const pointerPath = activeMissionPointerPath(workspaceDir);
  const legacyCardPath = rootLegacyMissionCardPath(workspaceDir);

  if (existsSync(regPath)) {
    const registry = readMissionRegistry(workspaceDir);
    const pointer = existsSync(pointerPath) ? readActiveMissionPointer(workspaceDir) : null;
    const activeId = pointer?.mission_id ?? registry?.active_mission_id ?? null;
    const options: MissionOption[] = (registry?.missions ?? []).map((e) =>
      entryToOption(e, activeId),
    );
    return {
      workspaceDir,
      mode: "registry",
      registry_path: regPath,
      active_mission_id: activeId,
      options,
      legacy_root: null,
      snapshot_at: now,
    };
  }

  if (existsSync(legacyCardPath)) {
    return {
      workspaceDir,
      mode: "legacy_root",
      registry_path: null,
      active_mission_id: null,
      options: [],
      legacy_root: { source: "legacy_root", mission_card_path: legacyCardPath, detected: true },
      snapshot_at: now,
    };
  }

  return {
    workspaceDir,
    mode: "intake",
    registry_path: null,
    active_mission_id: null,
    options: [],
    legacy_root: null,
    snapshot_at: now,
  };
}

/**
 * Find a mission option by id (linear search). Returns null when not in the
 * snapshot (e.g., archived Missions may still appear in the snapshot but
 * actions refuse them; this helper only locates).
 */
export function findMissionOption(snapshot: PickerSnapshot, missionId: string): MissionOption | null {
  return snapshot.options.find((o) => o.mission_id === missionId) ?? null;
}

/**
 * Owner action availability per spec §5.3. The picker uses this to show only
 * the actions the owner can take on each option.
 */
export type OwnerAction =
  | "continue"
  | "resume"
  | "create_new"
  | "inspect"
  | "archive"
  | "park"
  | "unpark"
  | "mark_blocked"
  | "request_rollback";

export function availableActionsForOption(option: MissionOption, mode: PickerMode): OwnerAction[] {
  // Inspect is always available for any non-intake option.
  if (mode === "intake") return ["create_new"];
  const actions: OwnerAction[] = ["inspect"];
  if (option.is_active) actions.push("continue");
  if (!option.is_active && !option.archived) actions.push("resume");
  if (option.archived) {
    // Archived Missions are inspectable but not actionable beyond inspect.
  } else if (option.lifecycle_state === "parked") {
    actions.push("unpark");
  } else {
    actions.push("archive", "park", "mark_blocked", "request_rollback");
  }
  return actions;
}
