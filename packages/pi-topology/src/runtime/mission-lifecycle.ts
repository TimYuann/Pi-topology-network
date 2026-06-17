/**
 * Mission lifecycle states.
 *
 * Spec reference: `docs/14-pi-topology-mission-runtime-spec.md` §4.1
 *
 * Mission lifecycle is the OMP business-level state machine. It is ORTHOGONAL to
 * Pi's session lifecycle (startup | new | resume | fork) and to OMP's role
 * liveness 5-state (live | resumable | stale | parked | closed).
 *
 * Slice 1 contract: type + ordering + set membership. Transition rules belong to
 * slice 2 supervisor picker and slice 9 acceptance.
 */

export const MISSION_LIFECYCLE_STATES = [
  "draft",
  "awaiting_owner_confirmation",
  "team_building",
  "running",
  "reviewing",
  "delivering",
  "delivered",
  "archived",
  "blocked",
  "rollback_pending",
  "parked",
  "abandoned",
] as const;

export type MissionLifecycleState = (typeof MISSION_LIFECYCLE_STATES)[number];

export function isMissionLifecycleState(value: unknown): value is MissionLifecycleState {
  return typeof value === "string" && (MISSION_LIFECYCLE_STATES as readonly string[]).includes(value);
}

/**
 * Migration map from current `MissionProgress.status` to target lifecycle.
 * Spec §4.1 migration table.
 */
export const MISSION_PROGRESS_TO_LIFECYCLE: Record<string, MissionLifecycleState> = {
  draft: "draft",
  awaiting_owner_confirmation: "awaiting_owner_confirmation",
  supervisor_ready: "awaiting_owner_confirmation",
  running: "running",
  blocked: "blocked",
  completed: "delivered",
  abandoned: "abandoned",
};

export function mapLegacyMissionStatus(legacyStatus: string): MissionLifecycleState {
  return MISSION_PROGRESS_TO_LIFECYCLE[legacyStatus] ?? "draft";
}
