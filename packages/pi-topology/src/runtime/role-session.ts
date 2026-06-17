import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  findMissionInRegistry,
  readMissionRegistry,
  writeMissionRegistry,
  type MissionRegistry,
  type MissionRegistryEntry,
  type MissionRegistryRoleSummary,
} from "./mission-registry.ts";
import { missionLayoutPaths } from "./mission-layout.ts";
import type { MissionLayoutPaths } from "./mission-layout.ts";
import { appendToJsonlLedger } from "./root-mirror.ts";
import type { MissionCard, TopologyRole } from "./mission.ts";

/**
 * Role session registry.
 *
 * Spec reference: `docs/14-pi-topology-mission-runtime-spec.md` §4.2 + §6.3
 *
 * Each Mission's per-mission `sessions.jsonl` (slice 1 layout) records role
 * lifecycle events. The 5-state classification (live / resumable / stale /
 * parked / closed) is DERIVED from the latest record per role. The spec
 * §6.3 6-step algorithm determines the classification; the heartbeat
 * freshness window defaults to 20 seconds and the resume freshness window
 * defaults to 10 minutes.
 *
 * Slice 3 contract:
 *   - RoleSessionRecord type (8 raw event kinds: planned, script_written,
 *     launch_printed, launch_requested, alive_confirmed, heartbeat, parked,
 *     closed, failed)
 *   - appendRoleSessionRecord / getRoleSessionRecords (JSONL read/write
 *     through the slice 1 root-mirror path)
 *   - classifyRole (the spec §6.3 6-step algorithm)
 *   - classifyAllRoles + computeRoleSummary (registry entry role_summary)
 *   - isFreshHeartbeat / isWithinResumeWindow (freshness predicates)
 *
 * Per spec §6.3: "Supervisor must not send work to `resumable` or `stale`
 * roles until liveness is confirmed or the role is relaunched." This is a
 * caller-side constraint enforced in slice 4/5; slice 3 only surfaces the
 * `needs_liveness_confirmation` flag.
 *
 * Pi native session lifecycle (startup / reload / new / resume / fork) is
 * ORTHOGONAL to OMP's role liveness 5-state (per the slice 2 API audit §1.5
 * cross-reference).
 */

export type RoleSessionEventType =
  | "planned"
  | "script_written"
  | "launch_printed"
  | "launch_requested"
  | "alive_confirmed"
  | "heartbeat"
  | "parked"
  | "closed"
  | "failed";

export interface RoleSessionRecord {
  record_id: string;
  mission_id: string;
  role: TopologyRole;
  session_id: string | null;
  script_path: string | null;
  event_type: RoleSessionEventType;
  timestamp: string;
  context_used_pct?: number;
  registry_path?: string;
  reason?: string;
}

/**
 * The 5 derived role-liveness states (spec §4.2 + §5.2 picker categories).
 * `failed` is NOT a separate state — per spec §4.2, a `failed` record
 * overrides older records the same way `closed` does, and the count goes
 * into `closed` in `role_summary`.
 */
export type RoleLivenessState = "live" | "resumable" | "stale" | "parked" | "closed";

export interface RoleLivenessClassification {
  role: TopologyRole;
  state: RoleLivenessState;
  latest_record_id: string | null;
  latest_event_type: RoleSessionEventType | null;
  latest_event_timestamp: string | null;
  needs_liveness_confirmation: boolean;
  reason: string;
}

export const DEFAULT_HEARTBEAT_FRESHNESS_MS = 20_000; // spec §4.2: 20s default
export const DEFAULT_RESUME_FRESHNESS_MS = 600_000; // spec §4.2: 10min default

export interface ClassificationOptions {
  now: Date;
  heartbeatFreshnessMs?: number;
  resumeFreshnessMs?: number;
  /** When true, the Mission has reached `delivered` (spec §4.1). */
  isMissionClosed?: boolean;
  /** When true, the Mission is `archived` (spec §4.1). */
  isMissionArchived?: boolean;
  /**
   * Roles the owner has explicitly parked (typically via a `parkMission`
   * action). When set, the role classifies as `parked` regardless of session
   * record content. NOT used for `closed` records — closed records win
   * per spec §4.2.
   */
  ownerParkedRoles?: ReadonlySet<TopologyRole>;
}

// ---------------------------------------------------------------------------
// Freshness predicates
// ---------------------------------------------------------------------------

export function isFreshHeartbeat(
  record: RoleSessionRecord,
  now: Date,
  freshnessMs: number,
): boolean {
  if (record.event_type !== "heartbeat") return false;
  const age = now.getTime() - Date.parse(record.timestamp);
  return Number.isFinite(age) && age >= 0 && age <= freshnessMs;
}

export function isWithinResumeWindow(
  record: RoleSessionRecord,
  now: Date,
  windowMs: number,
): boolean {
  if (record.event_type !== "alive_confirmed") return false;
  const age = now.getTime() - Date.parse(record.timestamp);
  return Number.isFinite(age) && age >= 0 && age <= windowMs;
}

// ---------------------------------------------------------------------------
// Record read/write
// ---------------------------------------------------------------------------

export function generateRecordId(): string {
  return `rec_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export interface NewRoleSessionRecordInput {
  mission_id: string;
  role: TopologyRole;
  event_type: RoleSessionEventType;
  session_id?: string | null;
  script_path?: string | null;
  context_used_pct?: number;
  registry_path?: string;
  reason?: string;
  now?: Date;
}

export function buildRoleSessionRecord(input: NewRoleSessionRecordInput): RoleSessionRecord {
  return {
    record_id: generateRecordId(),
    mission_id: input.mission_id,
    role: input.role,
    session_id: input.session_id ?? null,
    script_path: input.script_path ?? null,
    event_type: input.event_type,
    timestamp: (input.now ?? new Date()).toISOString(),
    ...(input.context_used_pct !== undefined ? { context_used_pct: input.context_used_pct } : {}),
    ...(input.registry_path !== undefined ? { registry_path: input.registry_path } : {}),
    ...(input.reason !== undefined ? { reason: input.reason } : {}),
  };
}

export function appendRoleSessionRecord(
  workspaceDir: string,
  layout: MissionLayoutPaths,
  record: RoleSessionRecord,
): void {
  appendToJsonlLedger(workspaceDir, layout, "sessions.jsonl", JSON.stringify(record));
}

export function getRoleSessionRecords(
  workspaceDir: string,
  missionId: string,
): RoleSessionRecord[] {
  const layout = missionLayoutPaths(workspaceDir, missionId);
  if (!existsSync(layout.sessionsPath)) return [];
  const content = readFileSync(layout.sessionsPath, "utf8");
  const out: RoleSessionRecord[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as RoleSessionRecord);
    } catch {
      // Skip malformed lines defensively; classification tolerates this.
    }
  }
  return out;
}

export function latestRecordForRole(
  records: RoleSessionRecord[],
  role: TopologyRole,
): RoleSessionRecord | null {
  let latest: RoleSessionRecord | null = null;
  for (const r of records) {
    if (r.role !== role) continue;
    if (latest === null || r.timestamp > latest.timestamp) latest = r;
  }
  return latest;
}

// ---------------------------------------------------------------------------
// Classification (spec §6.3 6-step algorithm)
// ---------------------------------------------------------------------------

const LAUNCH_ATTEMPT_EVENTS: ReadonlySet<RoleSessionEventType> = new Set([
  "script_written",
  "launch_printed",
  "launch_requested",
]);

/**
 * Classify a single role's liveness state.
 *
 * Implements spec §6.3 6-step resume order, with the simplifying rule that
 * the LATEST record per role drives the state (with `closed` / `failed` /
 * `parked` records treated as terminal-authoritative since they reflect
 * intentional state transitions, not transient liveness signals).
 *
 * Algorithm:
 *   1. If owner parked the role (via `ownerParkedRoles` set), mark `parked`
 *   2. If Mission is delivered/archived, mark `closed` for the role
 *   3. If no session records exist, mark `stale`
 *   4. Examine the latest record:
 *      - `closed` or `failed` → `closed`
 *      - `parked`              → `parked`
 *      - `heartbeat` (fresh)   → `live` (spec §4.2: 20s default)
 *      - `alive_confirmed` (within 10min) → `resumable` (no liveness check)
 *      - `script_written` / `launch_printed` / `launch_requested` → `resumable`
 *        with `needs_liveness_confirmation: true`
 *   5. Otherwise mark `stale` (record exists but is too old to qualify as live
 *      or resumable)
 */
export function classifyRole(
  role: TopologyRole,
  records: RoleSessionRecord[],
  options: ClassificationOptions,
): RoleLivenessClassification {
  const heartbeatMs = options.heartbeatFreshnessMs ?? DEFAULT_HEARTBEAT_FRESHNESS_MS;
  const resumeMs = options.resumeFreshnessMs ?? DEFAULT_RESUME_FRESHNESS_MS;
  const isOwnerParked = options.ownerParkedRoles?.has(role) ?? false;
  const isMissionTerminal = options.isMissionClosed || options.isMissionArchived;
  const latest = latestRecordForRole(records, role);

  // Step 1: owner parked.
  if (isOwnerParked) {
    return {
      role,
      state: "parked",
      latest_record_id: latest?.record_id ?? null,
      latest_event_type: latest?.event_type ?? null,
      latest_event_timestamp: latest?.timestamp ?? null,
      needs_liveness_confirmation: false,
      reason: "owner parked role (spec §6.3 step 1)",
    };
  }

  // Step 2: mission terminal → all roles closed.
  if (isMissionTerminal) {
    return {
      role,
      state: "closed",
      latest_record_id: latest?.record_id ?? null,
      latest_event_type: latest?.event_type ?? null,
      latest_event_timestamp: latest?.timestamp ?? null,
      needs_liveness_confirmation: false,
      reason: options.isMissionArchived
        ? "mission archived (spec §6.3 step 2)"
        : "mission delivered (spec §6.3 step 2)",
    };
  }

  // Step 3: no records → stale.
  if (!latest) {
    return {
      role,
      state: "stale",
      latest_record_id: null,
      latest_event_type: null,
      latest_event_timestamp: null,
      needs_liveness_confirmation: false,
      reason: "no session records for role (spec §6.3 step 6)",
    };
  }

  // Step 4a: latest record is closed or failed → closed.
  if (latest.event_type === "closed" || latest.event_type === "failed") {
    return {
      role,
      state: "closed",
      latest_record_id: latest.record_id,
      latest_event_type: latest.event_type,
      latest_event_timestamp: latest.timestamp,
      needs_liveness_confirmation: false,
      reason: `latest record is ${latest.event_type} (terminal, spec §4.2)`,
    };
  }

  // Step 4b: latest record is parked → parked.
  if (latest.event_type === "parked") {
    return {
      role,
      state: "parked",
      latest_record_id: latest.record_id,
      latest_event_type: latest.event_type,
      latest_event_timestamp: latest.timestamp,
      needs_liveness_confirmation: false,
      reason: "latest record is parked (spec §4.2)",
    };
  }

  // Step 4c: fresh heartbeat → live.
  if (isFreshHeartbeat(latest, options.now, heartbeatMs)) {
    return {
      role,
      state: "live",
      latest_record_id: latest.record_id,
      latest_event_type: latest.event_type,
      latest_event_timestamp: latest.timestamp,
      needs_liveness_confirmation: false,
      reason: "fresh registry heartbeat (spec §6.3 step 3)",
    };
  }

  // Step 4d: alive_confirmed within resume window → resumable (no liveness check).
  if (isWithinResumeWindow(latest, options.now, resumeMs)) {
    return {
      role,
      state: "resumable",
      latest_record_id: latest.record_id,
      latest_event_type: latest.event_type,
      latest_event_timestamp: latest.timestamp,
      needs_liveness_confirmation: false,
      reason: "alive_confirmed within resume window (spec §6.3 step 4)",
    };
  }

  // Step 4e: launch-attempt event within resume window → resumable with
  // liveness check. Per spec §4.2: "A session record may be `resumable` for
  // up to the Mission resume freshness window" — this applies to all
  // resumable classifications, including launch-attempt events. Outside
  // the window, falls through to step 5 (stale).
  if (LAUNCH_ATTEMPT_EVENTS.has(latest.event_type)) {
    const age = options.now.getTime() - Date.parse(latest.timestamp);
    if (Number.isFinite(age) && age >= 0 && age <= resumeMs) {
      return {
        role,
        state: "resumable",
        latest_record_id: latest.record_id,
        latest_event_type: latest.event_type,
        latest_event_timestamp: latest.timestamp,
        needs_liveness_confirmation: true,
        reason: "launch attempted within resume window, liveness check needed (spec §6.3 step 5)",
      };
    }
    // Outside the resume window: fall through to step 5 (stale).
  }

  // Step 5: stale fallback (record exists but no qualifying state).
  return {
    role,
    state: "stale",
    latest_record_id: latest.record_id,
    latest_event_type: latest.event_type,
    latest_event_timestamp: latest.timestamp,
    needs_liveness_confirmation: false,
    reason: "latest record is older than freshness windows (spec §6.3 step 6)",
  };
}

export function classifyAllRoles(
  roles: readonly TopologyRole[],
  records: RoleSessionRecord[],
  options: ClassificationOptions,
): RoleLivenessClassification[] {
  return roles.map((r) => classifyRole(r, records, options));
}

export function computeRoleSummary(
  classifications: readonly RoleLivenessClassification[],
): MissionRegistryRoleSummary {
  const summary: MissionRegistryRoleSummary = {
    live: 0,
    resumable: 0,
    stale: 0,
    parked: 0,
    closed: 0,
  };
  for (const c of classifications) {
    summary[c.state] += 1;
  }
  return summary;
}

export function emptyRoleSummary(): MissionRegistryRoleSummary {
  return { live: 0, resumable: 0, stale: 0, parked: 0, closed: 0 };
}

// ---------------------------------------------------------------------------
// Registry role_summary population
// ---------------------------------------------------------------------------

/**
 * Lifecycle states that mark the Mission as terminal for role classification
 * purposes (per spec §6.3 step 2). All roles are `closed` in these states.
 */
const MISSION_TERMINAL_LIFECYCLE_STATES: ReadonlySet<string> = new Set([
  "delivered",
  "abandoned",
]);

export interface PopulateRoleSummaryResult {
  role_summary: MissionRegistryRoleSummary;
  classifications: RoleLivenessClassification[];
  updated_entry: MissionRegistryEntry;
  previous_role_summary: MissionRegistryRoleSummary;
}

export function isMissionTerminalForRoles(
  lifecycleState: MissionRegistryEntry["lifecycle_state"],
  archived: boolean,
): boolean {
  return archived || MISSION_TERMINAL_LIFECYCLE_STATES.has(lifecycleState);
}

/**
 * Read all role session records for a Mission, classify each role per the
 * spec §6.3 6-step algorithm, recompute `role_summary`, and write the
 * updated entry to the registry. Returns null when the Mission is unknown
 * to the registry.
 *
 * Owner-parked roles (per `parkMission` action) are not yet tracked per-role
 * in slice 3; the per-role park signal will arrive in slice 4+ when the
 * park action becomes per-role. Until then, `ownerParkedRoles` is empty.
 */
export function populateRoleSummaryForMission(
  workspaceDir: string,
  missionId: string,
  now: Date = new Date(),
): PopulateRoleSummaryResult | null {
  const registry = readMissionRegistry(workspaceDir);
  if (!registry) return null;
  const entry = findMissionInRegistry(registry, missionId);
  if (!entry) return null;

  const layout = missionLayoutPaths(workspaceDir, missionId);
  if (!existsSync(layout.missionCardPath)) return null;
  const cardRaw = readFileSync(layout.missionCardPath, "utf8");
  const card = JSON.parse(cardRaw) as MissionCard;
  const roles = Object.keys(card.roles) as TopologyRole[];

  const records = getRoleSessionRecords(workspaceDir, missionId);
  const classifications = classifyAllRoles(roles, records, {
    now,
    isMissionClosed: MISSION_TERMINAL_LIFECYCLE_STATES.has(entry.lifecycle_state),
    isMissionArchived: entry.archived,
    ownerParkedRoles: new Set<TopologyRole>(),
  });
  const role_summary = computeRoleSummary(classifications);

  const idx = registry.missions.findIndex((m) => m.mission_id === missionId);
  if (idx < 0) return null;
  const previous_role_summary = entry.role_summary;
  const updated_entry: MissionRegistryEntry = {
    ...entry,
    role_summary,
    last_updated_at: now.toISOString(),
  };
  const updatedRegistry: MissionRegistry = {
    ...registry,
    updated_at: now.toISOString(),
    missions: [
      ...registry.missions.slice(0, idx),
      updated_entry,
      ...registry.missions.slice(idx + 1),
    ],
  };
  writeMissionRegistry(workspaceDir, updatedRegistry);

  return { role_summary, classifications, updated_entry, previous_role_summary };
}
