import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  DEFAULT_MISSION_PROGRESS_STATUS,
  isMissionLegacyProgressStatus,
  type MissionLegacyProgressStatus,
  type MissionLifecycleState,
} from "./mission-lifecycle.ts";

/**
 * Mission Registry — derived summary view over per-Mission evidence files.
 *
 * Spec reference: `docs/14-pi-topology-mission-runtime-spec.md` §3.4
 *
 * The registry is a CACHE. Per-Mission files under `.pi/topology/missions/<id>/`
 * are the source of truth. Registry summaries (role_summary, pending_packet_count,
 * incident_count) are derived views that must be re-derivable from the per-Mission
 * files at any time.
 *
 * Slice 1 contract:
 *   - create / read / write the registry file
 *   - add a mission entry (without computing derived summaries — those land in
 *     slice 3 session registry and slice 4 packet cleanup)
 *   - find a mission by id
 *   - list mission ids
 */

export const MISSION_REGISTRY_VERSION = 1 as const;

export const MISSION_REGISTRY_FILENAME = "mission-registry.json";
export const ACTIVE_MISSION_POINTER_FILENAME = "active-mission.json";

export type OwnerGateState = "required" | "clear";
export type RoleLivenessSummary = "live" | "resumable" | "stale" | "parked" | "closed";

export interface MissionRegistryRoleSummary {
  live: number;
  resumable: number;
  stale: number;
  parked: number;
  closed: number;
}

export interface MissionRegistryEntry {
  mission_id: string;
  mission_dir: string;
  title: string;
  objective: string;
  lifecycle_state: MissionLifecycleState;
  /**
   * Legacy `MissionProgress.status` value, preserved for compatibility with
   * pre-slice-1 readers. Distinct from `lifecycle_state` because not all
   * legacy statuses have a 1:1 lifecycle mapping (e.g. `supervisor_ready`
   * maps to `awaiting_owner_confirmation` in the lifecycle state machine).
   */
  progress_status: MissionLegacyProgressStatus;
  owner_gate: OwnerGateState;
  blocked: boolean;
  archived: boolean;
  last_updated_at: string;
  role_summary: MissionRegistryRoleSummary;
  pending_packet_count: number;
  incident_count: number;
  closeout_path: string | null;
}

export interface MissionRegistry {
  version: typeof MISSION_REGISTRY_VERSION;
  active_mission_id: string | null;
  updated_at: string;
  missions: MissionRegistryEntry[];
}

export function registryFilePath(workspaceDir: string): string {
  return path.join(workspaceDir, ".pi", "topology", MISSION_REGISTRY_FILENAME);
}

export function missionRegistryDir(workspaceDir: string): string {
  return path.join(workspaceDir, ".pi", "topology", "missions");
}

export function emptyRoleSummary(): MissionRegistryRoleSummary {
  return { live: 0, resumable: 0, stale: 0, parked: 0, closed: 0 };
}

export function createEmptyRegistry(now: Date = new Date()): MissionRegistry {
  return {
    version: MISSION_REGISTRY_VERSION,
    active_mission_id: null,
    updated_at: now.toISOString(),
    missions: [],
  };
}

export function readMissionRegistry(workspaceDir: string): MissionRegistry | null {
  const filePath = registryFilePath(workspaceDir);
  if (!existsSync(filePath)) return null;
  const raw = readFileSync(filePath, "utf8");
  return JSON.parse(raw) as MissionRegistry;
}

export function writeMissionRegistry(workspaceDir: string, registry: MissionRegistry): void {
  const filePath = registryFilePath(workspaceDir);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
}

export interface NewMissionRegistryEntryInput {
  mission_id: string;
  title: string;
  objective: string;
  lifecycle_state: MissionLifecycleState;
  progress_status?: MissionLegacyProgressStatus;
  owner_gate?: OwnerGateState;
  blocked?: boolean;
  archived?: boolean;
  closeout_path?: string | null;
  mission_dir?: string;
  now?: Date;
}

export function newMissionRegistryEntry(input: NewMissionRegistryEntryInput): MissionRegistryEntry {
  const now = (input.now ?? new Date()).toISOString();
  return {
    mission_id: input.mission_id,
    mission_dir: input.mission_dir ?? `.pi/topology/missions/${input.mission_id}`,
    title: input.title,
    objective: input.objective,
    lifecycle_state: input.lifecycle_state,
    progress_status: input.progress_status ?? DEFAULT_MISSION_PROGRESS_STATUS,
    owner_gate: input.owner_gate ?? "required",
    blocked: input.blocked ?? false,
    archived: input.archived ?? false,
    last_updated_at: now,
    role_summary: emptyRoleSummary(),
    pending_packet_count: 0,
    incident_count: 0,
    closeout_path: input.closeout_path ?? null,
  };
}

export interface AddMissionResult {
  registry: MissionRegistry;
  entry: MissionRegistryEntry;
  added: boolean;
}

export function addMissionToRegistry(
  registry: MissionRegistry,
  entry: MissionRegistryEntry,
  now: Date = new Date(),
): AddMissionResult {
  const existingIndex = registry.missions.findIndex((m) => m.mission_id === entry.mission_id);
  const next: MissionRegistry = {
    ...registry,
    updated_at: now.toISOString(),
    missions: [...registry.missions],
  };
  if (existingIndex >= 0) {
    next.missions[existingIndex] = entry;
    return { registry: next, entry, added: false };
  }
  next.missions.push(entry);
  return { registry: next, entry, added: true };
}

export function findMissionInRegistry(
  registry: MissionRegistry,
  missionId: string,
): MissionRegistryEntry | undefined {
  return registry.missions.find((m) => m.mission_id === missionId);
}

export function listMissionIds(registry: MissionRegistry): string[] {
  return registry.missions.map((m) => m.mission_id);
}

export interface UpdateRegistryEntryPatch {
  title?: string;
  objective?: string;
  lifecycle_state?: MissionLifecycleState;
  progress_status?: MissionLegacyProgressStatus;
  owner_gate?: OwnerGateState;
  blocked?: boolean;
  archived?: boolean;
  closeout_path?: string | null;
}

export interface UpdateRegistryEntryInput {
  mission_id: string;
  patch: UpdateRegistryEntryPatch;
  now?: Date;
}

export interface UpdateRegistryEntryResult {
  registry: MissionRegistry;
  entry: MissionRegistryEntry;
  updated: boolean;
  previous: MissionRegistryEntry;
}

export class UnknownMissionRegistryEntryError extends Error {
  public readonly missionId: string;
  constructor(missionId: string) {
    super(`unknown mission registry entry: ${JSON.stringify(missionId)}`);
    this.name = "UnknownMissionRegistryEntryError";
    this.missionId = missionId;
  }
}

const UPDATABLE_FIELDS: readonly (keyof UpdateRegistryEntryPatch)[] = [
  "title",
  "objective",
  "lifecycle_state",
  "progress_status",
  "owner_gate",
  "blocked",
  "archived",
  "closeout_path",
];

/**
 * Apply a partial update to a registry entry. Pure: returns a new registry.
 * `previous` always reflects the entry state BEFORE the patch, even when no
 * fields actually changed (so callers can detect no-op updates).
 *
 * role_summary / pending_packet_count / incident_count / last_updated_at are
 * NOT patchable here — they are derived views updated by their owners
 * (session registry for role_summary, inbox cleanup for pending count,
 * incident log for incident count). Use those code paths instead.
 */
export function updateRegistryEntry(
  registry: MissionRegistry,
  input: UpdateRegistryEntryInput,
): UpdateRegistryEntryResult {
  const idx = registry.missions.findIndex((m) => m.mission_id === input.mission_id);
  if (idx < 0) throw new UnknownMissionRegistryEntryError(input.mission_id);
  const previous = registry.missions[idx]!;
  const now = (input.now ?? new Date()).toISOString();
  const next: MissionRegistryEntry = {
    ...previous,
    ...input.patch,
    last_updated_at: now,
  };
  const nextRegistry: MissionRegistry = {
    ...registry,
    updated_at: now,
    missions: [
      ...registry.missions.slice(0, idx),
      next,
      ...registry.missions.slice(idx + 1),
    ],
  };
  let updated = false;
  for (const field of UPDATABLE_FIELDS) {
    if (input.patch[field] !== undefined && (input.patch as Record<string, unknown>)[field] !== (previous as Record<string, unknown>)[field]) {
      updated = true;
      break;
    }
  }
  return { registry: nextRegistry, entry: next, updated, previous };
}

/** Convenience: set a single entry's lifecycle_state. */
export function setRegistryEntryLifecycle(
  registry: MissionRegistry,
  missionId: string,
  lifecycle_state: MissionLifecycleState,
  now: Date = new Date(),
): UpdateRegistryEntryResult {
  return updateRegistryEntry(registry, { mission_id: missionId, patch: { lifecycle_state }, now });
}

export function setRegistryActiveMission(
  registry: MissionRegistry,
  missionId: string | null,
  now: Date = new Date(),
): MissionRegistry {
  if (missionId !== null) {
    const exists = registry.missions.some((m) => m.mission_id === missionId);
    if (!exists) {
      throw new Error(
        `setRegistryActiveMission: cannot set active_mission_id to unknown mission ${JSON.stringify(missionId)}; known: ${registry.missions.map((m) => m.mission_id).join(", ") || "(none)"}`,
      );
    }
  }
  return {
    ...registry,
    active_mission_id: missionId,
    updated_at: now.toISOString(),
  };
}

export function validateMissionRegistry(input: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!input || typeof input !== "object") {
    return { ok: false, errors: ["mission registry must be an object"] };
  }
  const r = input as Partial<MissionRegistry>;
  if (r.version !== MISSION_REGISTRY_VERSION) {
    errors.push(`registry version must be ${MISSION_REGISTRY_VERSION}`);
  }
  if (r.active_mission_id !== null && typeof r.active_mission_id !== "string") {
    errors.push("active_mission_id must be a string or null");
  }
  if (typeof r.updated_at !== "string") errors.push("updated_at must be an ISO string");
  if (!Array.isArray(r.missions)) {
    errors.push("missions must be an array");
  } else {
    for (const [i, m] of r.missions.entries()) {
      if (!m || typeof m !== "object") {
        errors.push(`missions[${i}] must be an object`);
        continue;
      }
      const entry = m as Partial<MissionRegistryEntry>;
      if (!entry.mission_id) errors.push(`missions[${i}].mission_id is required`);
      if (!entry.mission_dir) errors.push(`missions[${i}].mission_dir is required`);
      if (!entry.title) errors.push(`missions[${i}].title is required`);
      if (!entry.objective) errors.push(`missions[${i}].objective is required`);
      if (!entry.lifecycle_state) errors.push(`missions[${i}].lifecycle_state is required`);
      if (!isMissionLegacyProgressStatus(entry.progress_status)) {
        errors.push(`missions[${i}].progress_status must be one of: draft, awaiting_owner_confirmation, supervisor_ready, running, blocked, completed, abandoned`);
      }
      if (entry.owner_gate !== "required" && entry.owner_gate !== "clear") {
        errors.push(`missions[${i}].owner_gate must be 'required' or 'clear'`);
      }
    }
    // active_mission_id consistency: if set, must reference an existing mission.
    // Catches BOTH the "ghost id in non-empty missions[]" case AND the
    // "non-null active_mission_id with empty missions[]" case (slice 1.2 fix).
    if (typeof r.active_mission_id === "string") {
      const ids = r.missions.map((m) => (m as MissionRegistryEntry).mission_id);
      if (!ids.includes(r.active_mission_id)) {
        errors.push(`active_mission_id "${r.active_mission_id}" not found in missions[]`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}
