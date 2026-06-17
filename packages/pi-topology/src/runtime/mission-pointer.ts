import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ACTIVE_MISSION_POINTER_FILENAME } from "./mission-registry.ts";

/**
 * Active Mission pointer.
 *
 * Spec reference: `docs/14-pi-topology-mission-runtime-spec.md` §3.3
 *
 * The pointer is a tiny file that records which Mission is currently selected.
 * Changing the pointer must append a `mission_selected` runtime event to the
 * selected Mission's runtime-events.jsonl.
 *
 * Slice 1 contract: read / write / clear the pointer. Event append is done by
 * callers (slice 3 session registry integrates with this).
 */

export const ACTIVE_MISSION_POINTER_VERSION = 1 as const;

export type ActiveMissionPointerReason = "created" | "resumed" | "owner_selected" | "migration";

export interface ActiveMissionPointer {
  version: typeof ACTIVE_MISSION_POINTER_VERSION;
  mission_id: string;
  mission_dir: string;
  selected_at: string;
  selected_by: string;
  reason: ActiveMissionPointerReason;
  event_id: string;
}

export function activeMissionPointerPath(workspaceDir: string): string {
  return path.join(workspaceDir, ".pi", "topology", ACTIVE_MISSION_POINTER_FILENAME);
}

export interface NewActiveMissionPointerInput {
  mission_id: string;
  mission_dir: string;
  reason: ActiveMissionPointerReason;
  selected_by?: string;
  event_id: string;
  now?: Date;
}

export function buildActiveMissionPointer(input: NewActiveMissionPointerInput): ActiveMissionPointer {
  return {
    version: ACTIVE_MISSION_POINTER_VERSION,
    mission_id: input.mission_id,
    mission_dir: input.mission_dir,
    selected_at: (input.now ?? new Date()).toISOString(),
    selected_by: input.selected_by ?? "topology-supervisor",
    reason: input.reason,
    event_id: input.event_id,
  };
}

export function readActiveMissionPointer(workspaceDir: string): ActiveMissionPointer | null {
  const filePath = activeMissionPointerPath(workspaceDir);
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, "utf8")) as ActiveMissionPointer;
}

export function writeActiveMissionPointer(workspaceDir: string, pointer: ActiveMissionPointer): void {
  const filePath = activeMissionPointerPath(workspaceDir);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(pointer, null, 2)}\n`, "utf8");
}

export function clearActiveMissionPointer(workspaceDir: string): boolean {
  const filePath = activeMissionPointerPath(workspaceDir);
  if (!existsSync(filePath)) return false;
  unlinkSync(filePath);
  return true;
}

export function validateActiveMissionPointer(input: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!input || typeof input !== "object") {
    return { ok: false, errors: ["active mission pointer must be an object"] };
  }
  const p = input as Partial<ActiveMissionPointer>;
  if (p.version !== ACTIVE_MISSION_POINTER_VERSION) {
    errors.push(`pointer version must be ${ACTIVE_MISSION_POINTER_VERSION}`);
  }
  if (!p.mission_id) errors.push("mission_id is required");
  if (!p.mission_dir) errors.push("mission_dir is required");
  if (!p.selected_at) errors.push("selected_at is required");
  if (!p.selected_by) errors.push("selected_by is required");
  const validReasons: ActiveMissionPointerReason[] = ["created", "resumed", "owner_selected", "migration"];
  if (!validReasons.includes(p.reason as ActiveMissionPointerReason)) {
    errors.push(`reason must be one of: ${validReasons.join(", ")}`);
  }
  if (!p.event_id) errors.push("event_id is required");
  return { ok: errors.length === 0, errors };
}
