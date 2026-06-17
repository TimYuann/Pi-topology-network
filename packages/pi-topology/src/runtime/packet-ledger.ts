import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  findMissionInRegistry,
  readMissionRegistry,
  writeMissionRegistry,
  type MissionRegistry,
  type MissionRegistryEntry,
} from "./mission-registry.ts";
import { missionLayoutPaths } from "./mission-layout.ts";
import type { MissionLayoutPaths } from "./mission-layout.ts";
import type { TopologyRole } from "./mission.ts";

/**
 * Per-Mission packet ledger.
 *
 * Spec reference: `docs/14-pi-topology-mission-runtime-spec.md` §4.4 + §7
 *
 * Each Mission owns a per-mission `packet-ledger.jsonl` (slice 1 layout)
 * recording the packet lifecycle as observed through the OMP packet
 * protocol. The 11-state machine (per spec §4.4) classifies packets through
 * the compactor. Default active reads are filtered by:
 *   1. `packet.mission_id === active_mission_id`
 *   2. state is one of the 5 active states (queued / delivered / acknowledged /
 *      in_progress / reported) AND not stale-by-freshness
 *   3. packet type is in the requesting role's actionable-type set
 *
 * Slice 4 contract:
 *   - PacketLedgerEntry type (13 fields per spec §4.4)
 *   - appendPacketLedger / getPacketLedgerEntries (JSONL read/write via the
 *     slice 1 root-mirror path)
 *   - isPacketStale / classifyPacketLiveness
 *   - defaultActionableTypesForRole / getActivePacketsForMission
 *   - populatePendingPacketCountForMission (registry entry field)
 *   - compileRawPacketToLedger (raw-transport-to-ledger helper; the full
 *     compactor reads raw transport in a future slice)
 *
 * Per spec §7: cleanup WRITES to packet-ledger.jsonl; cleanup MUST NOT
 * delete raw outbox/inbox files, rewrite raw packet history, delete
 * artifacts, ledgers, or Mission folders. Slice 4 follows that contract.
 */

export const PACKET_STATES = [
  "queued",
  "delivered",
  "acknowledged",
  "in_progress",
  "reported",
  "report_acknowledged",
  "closed",
  "ignored",
  "stale",
  "duplicate",
  "preserved",
] as const;

export type PacketState = (typeof PACKET_STATES)[number];

export const PACKET_TYPES = ["ACK", "STATUS", "REPORT", "REQUEST", "INCIDENT", "VERDICT"] as const;

export type PacketType = (typeof PACKET_TYPES)[number];

export interface PacketLedgerEntry {
  packet_id: string;
  mission_id: string;
  type: PacketType;
  from: TopologyRole;
  to: TopologyRole;
  request_msg_id: string | null;
  correlation_id: string | null;
  state: PacketState;
  raw_transport_path: string;
  first_seen_at: string;
  last_seen_at: string;
  classification_reason: string;
  artifact_path: string | null;
}

/** Minimal raw packet observation shape (from `src/transport/local-coms.ts`
 *  outbox/inbox). The compactor produces ledger entries from these. */
export interface RawPacketObservation {
  packet_id: string;
  type: PacketType;
  from: TopologyRole;
  to: TopologyRole;
  request_msg_id?: string | null;
  correlation_id?: string | null;
  raw_path: string;
  timestamp: string;
  state_hint?: PacketState;
}

/**
 * Active-read states (per spec §7: "packet state is not `closed`,
 * `report_acknowledged`, `ignored`, `stale`, or `duplicate`"). `preserved`
 * is also hidden from default reads — visible only via `include_history`.
 */
export const ACTIVE_READ_STATES: ReadonlySet<PacketState> = new Set<PacketState>([
  "queued",
  "delivered",
  "acknowledged",
  "in_progress",
  "reported",
]);

/** Terminal states: any packet here is excluded from default active reads. */
export const TERMINAL_PACKET_STATES: ReadonlySet<PacketState> = new Set<PacketState>([
  "closed",
  "report_acknowledged",
  "ignored",
  "stale",
  "duplicate",
  "preserved",
]);

/** Default stale threshold: 30 minutes since last_seen_at for active states. */
export const DEFAULT_STALE_THRESHOLD_MS = 30 * 60 * 1000;

// ---------------------------------------------------------------------------
// Default actionable types per role
// ---------------------------------------------------------------------------

/**
 * Default mapping of which packet types a given role acts on. Caller may
 * override via `getActivePacketsForMission({ actionableTypesForRole })`.
 * The mapping reflects spec §3 RolePolicy.report_target relationships:
 *   - topology-supervisor / hq: receive REPORT / ACK / INCIDENT / VERDICT
 *   - repair: REQUEST / ACK / VERDICT (assigned tasks)
 *   - runner / oracle / librarian / scott: REQUEST / ACK / INCIDENT
 */
export function defaultActionableTypesForRole(role: TopologyRole): ReadonlySet<PacketType> {
  switch (role) {
    case "topology-supervisor":
    case "hq":
      return new Set<PacketType>(["REPORT", "ACK", "INCIDENT", "VERDICT", "REQUEST", "STATUS"]);
    case "repair":
      return new Set<PacketType>(["REQUEST", "ACK", "VERDICT"]);
    case "runner":
    case "oracle":
      return new Set<PacketType>(["REQUEST", "ACK", "INCIDENT", "REPORT", "VERDICT"]);
    case "librarian":
      return new Set<PacketType>(["REPORT", "INCIDENT", "VERDICT"]);
    case "scott":
      return new Set<PacketType>(["STATUS", "REQUEST", "REPORT"]);
  }
}

// ---------------------------------------------------------------------------
// Read / write
// ---------------------------------------------------------------------------

export function appendPacketLedger(
  workspaceDir: string,
  layout: MissionLayoutPaths,
  entry: PacketLedgerEntry,
): void {
  // packet-ledger.jsonl is per-mission only (spec §3.2 mirror list explicitly
  // excludes it). Append directly to the per-mission file without going
  // through the slice 1 root-mirror path (which only handles the 5 mirrored
  // files: mission-card / status-board / runtime-events / incident-log / sessions).
  const path = layout.packetLedgerPath;
  mkdirSync(dirname(path), { recursive: true });
  const previous = existsSync(path) ? readFileSync(path, "utf8") : "";
  writeFileSync(path, `${previous}${JSON.stringify(entry)}\n`, "utf8");
}

export function getPacketLedgerEntries(
  workspaceDir: string,
  missionId: string,
): PacketLedgerEntry[] {
  const layout = missionLayoutPaths(workspaceDir, missionId);
  if (!existsSync(layout.packetLedgerPath)) return [];
  const content = readFileSync(layout.packetLedgerPath, "utf8");
  const out: PacketLedgerEntry[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as PacketLedgerEntry);
    } catch {
      // Skip malformed lines defensively (per spec §7: don't rewrite raw).
    }
  }
  return out;
}

export function findPacketById(
  entries: PacketLedgerEntry[],
  packetId: string,
): PacketLedgerEntry | null {
  for (const e of entries) {
    if (e.packet_id === packetId) return e;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Liveness / staleness
// ---------------------------------------------------------------------------

/**
 * Classify a packet's effective liveness for the active-read filter.
 *
 * A packet is `stale` when:
 *   - its stored state is one of the active states (queued / delivered /
 *     acknowledged / in_progress / reported), AND
 *   - the time since `last_seen_at` exceeds `staleThresholdMs`.
 *
 * A packet whose stored state is `stale` remains `stale` regardless of
 * `last_seen_at`. Terminal states (closed / report_acknowledged / ignored /
 * duplicate / preserved) pass through unchanged.
 */
export function classifyPacketLiveness(
  entry: PacketLedgerEntry,
  now: Date,
  staleThresholdMs: number = DEFAULT_STALE_THRESHOLD_MS,
): PacketState {
  if (entry.state === "stale") return "stale";
  if (TERMINAL_PACKET_STATES.has(entry.state)) return entry.state;
  if (!ACTIVE_READ_STATES.has(entry.state)) return entry.state;
  const age = now.getTime() - Date.parse(entry.last_seen_at);
  if (Number.isFinite(age) && age > staleThresholdMs) return "stale";
  return entry.state;
}

export function isPacketStale(
  entry: PacketLedgerEntry,
  now: Date,
  staleThresholdMs: number = DEFAULT_STALE_THRESHOLD_MS,
): boolean {
  return classifyPacketLiveness(entry, now, staleThresholdMs) === "stale";
}

// ---------------------------------------------------------------------------
// Active reads filter (spec §7)
// ---------------------------------------------------------------------------

export interface ActivePacketsFilterOptions {
  now: Date;
  staleThresholdMs?: number;
  /** Override the per-role actionable-type set (e.g., for testing). */
  actionableTypesForRole?: (role: TopologyRole) => ReadonlySet<PacketType>;
}

/**
 * Default active reads for a Mission + role (spec §7).
 *
 * Filter:
 *   1. `packet.mission_id === missionId`
 *   2. `packet.to === role`
 *   3. effective liveness ∈ ACTIVE_READ_STATES (re-classifies stale)
 *   4. `packet.type` is in the role's actionable-type set
 */
export function getActivePacketsForMission(
  workspaceDir: string,
  missionId: string,
  role: TopologyRole,
  options: ActivePacketsFilterOptions,
): PacketLedgerEntry[] {
  const all = getPacketLedgerEntries(workspaceDir, missionId);
  const actionable =
    options.actionableTypesForRole ?? defaultActionableTypesForRole;
  const roleActionable = actionable(role);
  const threshold = options.staleThresholdMs ?? DEFAULT_STALE_THRESHOLD_MS;
  return all.filter((e) => {
    if (e.mission_id !== missionId) return false;
    if (e.to !== role) return false;
    if (!ACTIVE_READ_STATES.has(classifyPacketLiveness(e, options.now, threshold))) return false;
    if (!roleActionable.has(e.type)) return false;
    return true;
  });
}

/**
 * All active packets across the Mission (any recipient, any actionable role).
 * Used for dashboard counts and `pending_packet_count` derivation.
 */
export function getAllActivePacketsForMission(
  workspaceDir: string,
  missionId: string,
  options: ActivePacketsFilterOptions,
): PacketLedgerEntry[] {
  const all = getPacketLedgerEntries(workspaceDir, missionId);
  const threshold = options.staleThresholdMs ?? DEFAULT_STALE_THRESHOLD_MS;
  return all.filter((e) => {
    if (e.mission_id !== missionId) return false;
    return ACTIVE_READ_STATES.has(classifyPacketLiveness(e, options.now, threshold));
  });
}

// ---------------------------------------------------------------------------
// Compactor helper: raw packet → ledger entry
// ---------------------------------------------------------------------------

/**
 * Map a raw transport packet observation to a per-Mission ledger entry.
 * The full compactor that walks raw outbox/inbox files lives in a later
 * slice; this helper produces the entry shape the compactor would write.
 */
export function compileRawPacketToLedger(
  raw: RawPacketObservation,
  missionId: string,
  now: Date = new Date(),
): PacketLedgerEntry {
  return {
    packet_id: raw.packet_id,
    mission_id: missionId,
    type: raw.type,
    from: raw.from,
    to: raw.to,
    request_msg_id: raw.request_msg_id ?? null,
    correlation_id: raw.correlation_id ?? null,
    state: raw.state_hint ?? "delivered",
    raw_transport_path: raw.raw_path,
    first_seen_at: raw.timestamp,
    last_seen_at: raw.timestamp,
    classification_reason: `raw packet observed (mission=${missionId})`,
    artifact_path: null,
  };
}

// ---------------------------------------------------------------------------
// Registry integration: pending_packet_count
// ---------------------------------------------------------------------------

export interface PopulatePendingPacketCountResult {
  pending_packet_count: number;
  active_count: number;
  stale_count: number;
  updated_entry: MissionRegistryEntry;
  previous_pending_packet_count: number;
}

export function populatePendingPacketCountForMission(
  workspaceDir: string,
  missionId: string,
  now: Date = new Date(),
  staleThresholdMs: number = DEFAULT_STALE_THRESHOLD_MS,
): PopulatePendingPacketCountResult | null {
  const registry = readMissionRegistry(workspaceDir);
  if (!registry) return null;
  const entry = findMissionInRegistry(registry, missionId);
  if (!entry) return null;

  const all = getPacketLedgerEntries(workspaceDir, missionId);
  let activeCount = 0;
  let staleCount = 0;
  for (const e of all) {
    const liveness = classifyPacketLiveness(e, now, staleThresholdMs);
    if (liveness === "stale") {
      staleCount += 1;
    } else if (ACTIVE_READ_STATES.has(liveness)) {
      activeCount += 1;
    }
  }

  const idx = registry.missions.findIndex((m) => m.mission_id === missionId);
  if (idx < 0) return null;
  const previous_pending_packet_count = entry.pending_packet_count;
  const updatedEntry: MissionRegistryEntry = {
    ...entry,
    pending_packet_count: activeCount,
    last_updated_at: now.toISOString(),
  };
  const updatedRegistry: MissionRegistry = {
    ...registry,
    updated_at: now.toISOString(),
    missions: [
      ...registry.missions.slice(0, idx),
      updatedEntry,
      ...registry.missions.slice(idx + 1),
    ],
  };
  writeMissionRegistry(workspaceDir, updatedRegistry);

  return {
    pending_packet_count: activeCount,
    active_count: activeCount,
    stale_count: staleCount,
    updated_entry: updatedEntry,
    previous_pending_packet_count,
  };
}
