import { existsSync } from "node:fs";
import {
  addMissionToRegistry,
  createEmptyRegistry,
  findMissionInRegistry,
  newMissionRegistryEntry,
  readMissionRegistry,
  setRegistryActiveMission,
  updateRegistryEntry,
  writeMissionRegistry,
  type MissionRegistry,
  type MissionRegistryEntry,
} from "./mission-registry.ts";
import {
  activeMissionPointerPath,
  buildActiveMissionPointer,
  readActiveMissionPointer,
  writeActiveMissionPointer,
  type ActiveMissionPointer,
  type ActiveMissionPointerReason,
} from "./mission-pointer.ts";
import {
  createInitialStatusBoard,
  createMissionDraft,
  type MissionCard,
  type MissionDraftInput,
} from "./mission.ts";
import {
  createMissionLayout,
  missionLayoutPaths,
  type MissionLayoutPaths,
} from "./mission-layout.ts";
import {
  appendMissionCreated,
  appendMissionLifecycleTransition,
  appendMissionSelected,
  buildEventId,
  type MissionLifecycleTransitionEvent,
} from "./mission-events.ts";
import { syncRootMirrorFromLayout } from "./root-mirror.ts";

/**
 * Mission actions — the orchestrator for supervisor picker → state mutations.
 *
 * Spec reference: `docs/14-pi-topology-mission-runtime-spec.md` §5.3
 *
 * ALL active pointer writes go through `setActiveMissionFull` (the only
 * canonical path), which:
 *   1. reads registry
 *   2. calls `setRegistryActiveMission` (the static gate; throws on unknown)
 *   3. appends a `mission_selected` runtime event
 *   4. writes the registry
 *   5. writes the active pointer
 *   6. syncs the root mirror
 *
 * Callers MUST NOT bypass this function by writing `active-mission.json`
 * directly. The slice 1 `writeActiveMissionPointer` is exported only for
 * slice 1 legacy tests and explicit constructional use cases.
 */

export interface SetActiveMissionOptions {
  reason: ActiveMissionPointerReason;
  selected_by?: string;
  actor?: string;
  now?: Date;
  /** If provided, use this event_id instead of generating one (testing). */
  event_id?: string;
  /** Skip appending mission_selected event (testing). */
  skip_event_append?: boolean;
  /** Skip root mirror sync (testing). */
  skip_root_mirror_sync?: boolean;
}

export interface SetActiveMissionResult {
  registry: MissionRegistry;
  pointer: ActiveMissionPointer;
  event_id: string;
  previous_active_mission_id: string | null;
}

/**
 * Canonical path for active pointer writes. Goes through the registry gate.
 * Throws if the registry is missing OR if the mission_id is unknown.
 */
export function setActiveMissionFull(
  workspaceDir: string,
  missionId: string,
  opts: SetActiveMissionOptions,
): SetActiveMissionResult {
  const now = opts.now ?? new Date();
  const registry = readMissionRegistry(workspaceDir);
  if (!registry) {
    throw new Error(
      `setActiveMissionFull: mission-registry.json not found at ${workspaceDir}; create a Mission first via createMissionFlow`,
    );
  }
  // GATE: throws on unknown mission_id (per slice 1.1 static gate).
  const nextRegistry = setRegistryActiveMission(registry, missionId, now);
  const entry = findMissionInRegistry(nextRegistry, missionId);
  if (!entry) {
    // Unreachable in practice: setRegistryActiveMission throws on unknown.
    throw new Error(`setActiveMissionFull: mission ${JSON.stringify(missionId)} missing after gate`);
  }

  const event_id = opts.event_id ?? buildEventId(now);
  const layout = missionLayoutPaths(workspaceDir, missionId);
  const previousActiveId = registry.active_mission_id;

  if (!opts.skip_event_append && existsSync(layout.runtimeEventsPath)) {
    appendMissionSelected(workspaceDir, layout, {
      mission_id: missionId,
      selected_at: now.toISOString(),
      selected_by: opts.selected_by ?? "topology-supervisor",
      reason: opts.reason,
      previous_active_mission_id: previousActiveId,
    });
  }

  const pointer = buildActiveMissionPointer({
    mission_id: missionId,
    mission_dir: entry.mission_dir,
    reason: opts.reason,
    selected_by: opts.selected_by ?? "topology-supervisor",
    event_id,
    now,
  });

  writeMissionRegistry(workspaceDir, nextRegistry);
  writeActiveMissionPointer(workspaceDir, pointer);

  if (!opts.skip_root_mirror_sync && existsSync(layout.missionDirAbsolute)) {
    syncRootMirrorFromLayout(workspaceDir, layout);
  }

  return {
    registry: nextRegistry,
    pointer,
    event_id,
    previous_active_mission_id: previousActiveId,
  };
}

// ---------------------------------------------------------------------------
// Public actions (spec §5.3)
// ---------------------------------------------------------------------------

export interface ResumeMissionOptions {
  reason?: ActiveMissionPointerReason;
  actor?: string;
  now?: Date;
}

export function resumeMission(
  workspaceDir: string,
  missionId: string,
  opts: ResumeMissionOptions = {},
): SetActiveMissionResult {
  return setActiveMissionFull(workspaceDir, missionId, {
    reason: opts.reason ?? "resumed",
    actor: opts.actor ?? "owner",
    now: opts.now,
  });
}

export interface CreateMissionInput extends MissionDraftInput {
  title?: string;
  actor?: string;
  now?: Date;
}

export interface CreateMissionResult {
  missionCard: MissionCard;
  layout: MissionLayoutPaths;
  entry: MissionRegistryEntry;
  registry: MissionRegistry;
  pointer: ActiveMissionPointer;
  event_id: string;
}

export function createMissionFlow(
  workspaceDir: string,
  input: CreateMissionInput,
): CreateMissionResult {
  const now = input.now ?? new Date();
  const missionCard = createMissionDraft(input);
  const initialBoard = createInitialStatusBoard(missionCard);

  const { layout, created } = createMissionLayout({
    workspaceDir,
    missionCard,
    initialStatusBoard: initialBoard,
  });
  if (!created) {
    throw new Error(
      `createMissionFlow: mission ${JSON.stringify(missionCard.mission_id)} already exists at ${layout.missionDirAbsolute}`,
    );
  }

  // Registry: create if missing, add entry.
  const existing = readMissionRegistry(workspaceDir);
  const baseRegistry: MissionRegistry = existing ?? createEmptyRegistry(now);
  const entry = newMissionRegistryEntry({
    mission_id: missionCard.mission_id,
    title: input.title ?? missionCard.objective,
    objective: missionCard.objective,
    lifecycle_state: "draft",
    progress_status: "draft",
    owner_gate: "required",
    now,
    mission_dir: layout.missionDirRelative,
  });
  const withEntry = addMissionToRegistry(baseRegistry, entry, now).registry;
  appendMissionCreated(workspaceDir, layout, {
    mission_id: missionCard.mission_id,
    created_by: input.actor ?? "owner",
    initial_lifecycle_state: "draft",
    initial_progress_status: "draft",
    title: entry.title,
    objective: entry.objective,
  }, now);
  writeMissionRegistry(workspaceDir, withEntry);

  // Now set active through the canonical gate.
  const activeResult = setActiveMissionFull(workspaceDir, missionCard.mission_id, {
    reason: "created",
    selected_by: "topology-supervisor",
    actor: input.actor ?? "owner",
    now,
  });

  return {
    missionCard,
    layout,
    entry: findMissionInRegistry(activeResult.registry, missionCard.mission_id)!,
    registry: activeResult.registry,
    pointer: activeResult.pointer,
    event_id: activeResult.event_id,
  };
}

export interface MissionActionOptions {
  actor?: string;
  reason?: string;
  now?: Date;
}

export interface MissionActionResult {
  registry: MissionRegistry;
  entry: MissionRegistryEntry;
  previous: MissionRegistryEntry;
  event: MissionLifecycleTransitionEvent;
}

function performLifecycleTransition(
  workspaceDir: string,
  missionId: string,
  toState: MissionRegistryEntry["lifecycle_state"],
  ownerGate: MissionRegistryEntry["owner_gate"],
  blocked: MissionRegistryEntry["blocked"],
  archived: MissionRegistryEntry["archived"],
  actionReason: string,
  opts: MissionActionOptions,
): MissionActionResult {
  const now = opts.now ?? new Date();
  const registry = readMissionRegistry(workspaceDir);
  if (!registry) throw new Error(`${actionReason}: no mission-registry.json`);
  const entry = findMissionInRegistry(registry, missionId);
  if (!entry) throw new Error(`${actionReason}: unknown mission ${JSON.stringify(missionId)}`);

  const updated = updateRegistryEntry(registry, {
    mission_id: missionId,
    patch: {
      lifecycle_state: toState,
      owner_gate: ownerGate,
      blocked,
      archived,
    },
    now,
  });
  writeMissionRegistry(workspaceDir, updated.registry);

  const layout = missionLayoutPaths(workspaceDir, missionId);
  const event = appendMissionLifecycleTransition(
    workspaceDir,
    layout,
    {
      mission_id: missionId,
      from_state: updated.previous.lifecycle_state,
      to_state: toState,
      reason: opts.reason ?? actionReason,
      actor: opts.actor ?? "owner",
      evidence: {
        transport: [activeMissionPointerPath(workspaceDir)],
        business: [actionReason],
        inference: [`registry.active_mission_id=${updated.registry.active_mission_id}`],
      },
    },
    now,
  );

  return {
    registry: updated.registry,
    entry: updated.entry,
    previous: updated.previous,
    event,
  };
}

export function archiveMission(
  workspaceDir: string,
  missionId: string,
  opts: MissionActionOptions = {},
): MissionActionResult {
  return performLifecycleTransition(
    workspaceDir,
    missionId,
    "archived",
    "clear",
    false,
    true,
    "archive",
    opts,
  );
}

export function parkMission(
  workspaceDir: string,
  missionId: string,
  opts: MissionActionOptions = {},
): MissionActionResult {
  return performLifecycleTransition(
    workspaceDir,
    missionId,
    "parked",
    "clear",
    false,
    false,
    "park",
    opts,
  );
}

export function unparkMission(
  workspaceDir: string,
  missionId: string,
  opts: MissionActionOptions = {},
): MissionActionResult {
  const prev = readMissionRegistry(workspaceDir)?.missions.find((m) => m.mission_id === missionId);
  const target: MissionRegistryEntry["lifecycle_state"] =
    prev?.lifecycle_state === "abandoned" || prev?.lifecycle_state === "delivered" || prev?.lifecycle_state === "archived"
      ? prev.lifecycle_state
      : "awaiting_owner_confirmation";
  return performLifecycleTransition(
    workspaceDir,
    missionId,
    target,
    "required",
    false,
    prev?.archived ?? false,
    "unpark",
    opts,
  );
}

export function markMissionBlocked(
  workspaceDir: string,
  missionId: string,
  opts: MissionActionOptions = {},
): MissionActionResult {
  return performLifecycleTransition(
    workspaceDir,
    missionId,
    "blocked",
    "required",
    true,
    false,
    "mark_blocked",
    opts,
  );
}

export function requestRollback(
  workspaceDir: string,
  missionId: string,
  opts: MissionActionOptions = {},
): MissionActionResult {
  return performLifecycleTransition(
    workspaceDir,
    missionId,
    "rollback_pending",
    "required",
    true,
    false,
    "request_rollback",
    opts,
  );
}

export interface MissionInspection {
  mission_id: string;
  entry: MissionRegistryEntry;
  layout: MissionLayoutPaths;
  is_active: boolean;
  active_pointer_path: string;
  active_pointer_exists: boolean;
}

/** Read-only summary; does not write any state. */
export function inspectMission(workspaceDir: string, missionId: string): MissionInspection {
  const registry = readMissionRegistry(workspaceDir);
  if (!registry) throw new Error(`inspectMission: no mission-registry.json`);
  const entry = findMissionInRegistry(registry, missionId);
  if (!entry) throw new Error(`inspectMission: unknown mission ${JSON.stringify(missionId)}`);
  const layout = missionLayoutPaths(workspaceDir, missionId);
  const pointerPath = activeMissionPointerPath(workspaceDir);
  return {
    mission_id: missionId,
    entry,
    layout,
    is_active: registry.active_mission_id === missionId,
    active_pointer_path: pointerPath,
    active_pointer_exists: existsSync(pointerPath),
  };
}

/**
 * Read the current active pointer, falling back to registry.active_mission_id.
 * Used by callers that want to know which Mission is currently selected
 * without re-implementing the fallback.
 */
export function readCurrentActiveMissionId(workspaceDir: string): string | null {
  const pointer = readActiveMissionPointer(workspaceDir);
  if (pointer) return pointer.mission_id;
  const registry = readMissionRegistry(workspaceDir);
  return registry?.active_mission_id ?? null;
}
