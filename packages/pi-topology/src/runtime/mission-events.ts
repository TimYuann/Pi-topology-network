import { randomUUID } from "node:crypto";
import type { MissionLegacyProgressStatus, MissionLifecycleState } from "./mission-lifecycle.ts";
import type { MissionLayoutPaths } from "./mission-layout.ts";
import { appendToJsonlLedger } from "./root-mirror.ts";
import type { ActiveMissionPointerReason } from "./mission-pointer.ts";

/**
 * Mission lifecycle / action events.
 *
 * Spec reference: `docs/14-pi-topology-mission-runtime-spec.md` §3.3 + §4.1
 *
 * Every Mission lifecycle transition MUST append a runtime event to the
 * Mission's `runtime-events.jsonl` (per spec §3.4: "Changing the active pointer
 * must append a `mission_selected` runtime event to the selected Mission and
 * a `registry_updated` event to the registry audit stream if such a stream is
 * added later.").
 *
 * Slice 2 contract: typed builders for the three event kinds the slice 2
 * actions emit:
 *   - mission_lifecycle_transition (per spec §4.1, 9 required fields)
 *   - mission_selected (per spec §3.3)
 *   - mission_created (new for slice 2)
 *
 * Persistence is via `appendToJsonlLedger` from slice 1 root-mirror.ts, which
 * keeps per-mission and root-mirror content identical.
 */

export const MISSION_LIFECYCLE_TRANSITION_EVENT = "mission_lifecycle_transition";
export const MISSION_SELECTED_EVENT = "mission_selected";
export const MISSION_CREATED_EVENT = "mission_created";

/** Per spec §4.1: every transition needs from_state / to_state / reason / actor / evidence.
 *  Slice 2.1: every mission event also carries `event_id` so that the
 *  `active-mission.json` pointer's `event_id` field can be traced to a
 *  concrete line in the runtime events ledger. */
export interface MissionLifecycleTransitionEvent {
  event_type: typeof MISSION_LIFECYCLE_TRANSITION_EVENT;
  event_id: string;
  mission_id: string;
  timestamp: string;
  from_state: MissionLifecycleState;
  to_state: MissionLifecycleState;
  reason: string;
  actor: string;
  owner_decision_id?: string;
  evidence: {
    transport: string[];
    business: string[];
    inference: string[];
  };
}

export interface MissionSelectedEvent {
  event_type: typeof MISSION_SELECTED_EVENT;
  event_id: string;
  mission_id: string;
  timestamp: string;
  selected_at: string;
  selected_by: string;
  reason: ActiveMissionPointerReason;
  previous_active_mission_id: string | null;
}

export interface MissionCreatedEvent {
  event_type: typeof MISSION_CREATED_EVENT;
  event_id: string;
  mission_id: string;
  timestamp: string;
  created_by: string;
  initial_lifecycle_state: MissionLifecycleState;
  initial_progress_status: MissionLegacyProgressStatus;
  title: string;
  objective: string;
}

export type MissionEvent =
  | MissionLifecycleTransitionEvent
  | MissionSelectedEvent
  | MissionCreatedEvent;

/**
 * Generate a stable event id of the form `evt_<iso8601>_<uuid8>`. The uuid8
 * suffix uses crypto.randomUUID() so collisions are astronomically unlikely
 * even across distributed appenders.
 */
export function buildEventId(now: Date = new Date()): string {
  const iso = now.toISOString();
  const uuid8 = randomUUID().replace(/-/g, "").slice(0, 8);
  return `evt_${iso}_${uuid8}`;
}

export function appendMissionEvent(
  workspaceDir: string,
  layout: MissionLayoutPaths,
  event: MissionEvent,
): void {
  appendToJsonlLedger(workspaceDir, layout, "runtime-events.jsonl", JSON.stringify(event));
}

export function appendMissionLifecycleTransition(
  workspaceDir: string,
  layout: MissionLayoutPaths,
  input: Omit<MissionLifecycleTransitionEvent, "event_type" | "event_id" | "timestamp"> & { event_id?: string },
  now: Date = new Date(),
): MissionLifecycleTransitionEvent {
  const event: MissionLifecycleTransitionEvent = {
    event_type: MISSION_LIFECYCLE_TRANSITION_EVENT,
    event_id: input.event_id ?? buildEventId(now),
    timestamp: now.toISOString(),
    ...input,
  };
  appendMissionEvent(workspaceDir, layout, event);
  return event;
}

export function appendMissionSelected(
  workspaceDir: string,
  layout: MissionLayoutPaths,
  input: Omit<MissionSelectedEvent, "event_type" | "event_id" | "timestamp"> & { event_id?: string },
  now: Date = new Date(),
): MissionSelectedEvent {
  const event: MissionSelectedEvent = {
    event_type: MISSION_SELECTED_EVENT,
    event_id: input.event_id ?? buildEventId(now),
    timestamp: now.toISOString(),
    ...input,
  };
  appendMissionEvent(workspaceDir, layout, event);
  return event;
}

export function appendMissionCreated(
  workspaceDir: string,
  layout: MissionLayoutPaths,
  input: Omit<MissionCreatedEvent, "event_type" | "event_id" | "timestamp"> & { event_id?: string },
  now: Date = new Date(),
): MissionCreatedEvent {
  const event: MissionCreatedEvent = {
    event_type: MISSION_CREATED_EVENT,
    event_id: input.event_id ?? buildEventId(now),
    timestamp: now.toISOString(),
    ...input,
  };
  appendMissionEvent(workspaceDir, layout, event);
  return event;
}

export function isMissionLifecycleTransitionEvent(value: unknown): value is MissionLifecycleTransitionEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { event_type?: unknown }).event_type === MISSION_LIFECYCLE_TRANSITION_EVENT
  );
}

export function isMissionSelectedEvent(value: unknown): value is MissionSelectedEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { event_type?: unknown }).event_type === MISSION_SELECTED_EVENT
  );
}

export function isMissionCreatedEvent(value: unknown): value is MissionCreatedEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { event_type?: unknown }).event_type === MISSION_CREATED_EVENT
  );
}
