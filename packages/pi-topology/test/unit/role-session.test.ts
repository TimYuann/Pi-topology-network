import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  appendRoleSessionRecord,
  buildRoleSessionRecord,
  classifyAllRoles,
  classifyRole,
  computeRoleSummary,
  DEFAULT_HEARTBEAT_FRESHNESS_MS,
  DEFAULT_RESUME_FRESHNESS_MS,
  emptyRoleSummary,
  generateRecordId,
  getRoleSessionRecords,
  isFreshHeartbeat,
  isMissionTerminalForRoles,
  isWithinResumeWindow,
  latestRecordForRole,
  populateRoleSummaryForMission,
  type RoleSessionRecord,
} from "../../src/runtime/role-session.ts";
import { createInitialStatusBoard, createMissionDraft, type MissionCard, type TopologyRole } from "../../src/runtime/mission.ts";
import { createMissionLayout, missionLayoutPaths } from "../../src/runtime/mission-layout.ts";
import { addMissionToRegistry, createEmptyRegistry, newMissionRegistryEntry, readMissionRegistry, writeMissionRegistry } from "../../src/runtime/mission-registry.ts";

function makeWorkspace(): string {
  return mkdtempSync(join(tmpdir(), "pi-topology-slice3-rolesession-"));
}

function makeMissionLayout(workspaceDir: string, project: string, objective: string) {
  const card = createMissionDraft({
    project,
    workdir: workspaceDir,
    objective,
    allowed_paths: [workspaceDir],
  });
  const board = createInitialStatusBoard(card);
  const { layout, created } = createMissionLayout({
    workspaceDir,
    missionCard: card,
    initialStatusBoard: board,
  });
  assert.equal(created, true);
  // Seed registry with this Mission so populateRoleSummaryForMission can find it.
  const entry = newMissionRegistryEntry({
    mission_id: card.mission_id,
    title: card.objective,
    objective: card.objective,
    lifecycle_state: "draft",
    progress_status: "draft",
    owner_gate: "required",
    mission_dir: layout.missionDirRelative,
  });
  const reg = addMissionToRegistry(createEmptyRegistry(), entry).registry;
  writeMissionRegistry(workspaceDir, reg);
  return { card, layout, entry };
}

const ROLES_ALL: TopologyRole[] = [
  "topology-supervisor",
  "hq",
  "repair",
  "runner",
  "oracle",
  "librarian",
  "scott",
];

function record(opts: {
  mission_id: string;
  role: TopologyRole;
  event_type: RoleSessionRecord["event_type"];
  timestamp?: string;
  session_id?: string | null;
  script_path?: string | null;
  reason?: string;
  context_used_pct?: number;
  registry_path?: string;
}): RoleSessionRecord {
  return {
    record_id: generateRecordId(),
    mission_id: opts.mission_id,
    role: opts.role,
    session_id: opts.session_id ?? null,
    script_path: opts.script_path ?? null,
    event_type: opts.event_type,
    timestamp: opts.timestamp ?? "2026-06-17T00:00:00.000Z",
    ...(opts.context_used_pct !== undefined ? { context_used_pct: opts.context_used_pct } : {}),
    ...(opts.registry_path !== undefined ? { registry_path: opts.registry_path } : {}),
    ...(opts.reason !== undefined ? { reason: opts.reason } : {}),
  };
}

// ---------------------------------------------------------------------------
// Constants & freshness predicates
// ---------------------------------------------------------------------------

test("default heartbeat freshness is 20s and resume window is 10min (spec §4.2)", () => {
  assert.equal(DEFAULT_HEARTBEAT_FRESHNESS_MS, 20_000);
  assert.equal(DEFAULT_RESUME_FRESHNESS_MS, 600_000);
});

test("isFreshHeartbeat accepts only heartbeat events within window", () => {
  const now = new Date("2026-06-17T00:00:30.000Z");
  const fresh = record({ mission_id: "m", role: "hq", event_type: "heartbeat", timestamp: "2026-06-17T00:00:20.000Z" });
  const stale = record({ mission_id: "m", role: "hq", event_type: "heartbeat", timestamp: "2026-06-17T00:00:00.000Z" });
  const notHeartbeat = record({ mission_id: "m", role: "hq", event_type: "alive_confirmed", timestamp: "2026-06-17T00:00:29.000Z" });
  assert.equal(isFreshHeartbeat(fresh, now, 20_000), true);
  assert.equal(isFreshHeartbeat(stale, now, 20_000), false);
  assert.equal(isFreshHeartbeat(notHeartbeat, now, 20_000), false);
});

test("isWithinResumeWindow accepts only alive_confirmed within 10min (boundary is inclusive)", () => {
  const now = new Date("2026-06-17T00:10:00.000Z");
  const fresh = record({ mission_id: "m", role: "hq", event_type: "alive_confirmed", timestamp: "2026-06-17T00:05:00.000Z" });
  // Exactly at the 10min boundary: still within the window.
  const boundary = record({ mission_id: "m", role: "hq", event_type: "alive_confirmed", timestamp: "2026-06-17T00:00:00.000Z" });
  // Past 10min: out of window.
  const stale = record({ mission_id: "m", role: "hq", event_type: "alive_confirmed", timestamp: "2026-06-16T23:59:00.000Z" });
  const notAlive = record({ mission_id: "m", role: "hq", event_type: "heartbeat", timestamp: "2026-06-17T00:09:59.000Z" });
  assert.equal(isWithinResumeWindow(fresh, now, 600_000), true);
  assert.equal(isWithinResumeWindow(boundary, now, 600_000), true);
  assert.equal(isWithinResumeWindow(stale, now, 600_000), false);
  assert.equal(isWithinResumeWindow(notAlive, now, 600_000), false);
});

// ---------------------------------------------------------------------------
// Record read/write
// ---------------------------------------------------------------------------

test("buildRoleSessionRecord generates a record_id and stamps timestamp", () => {
  const r = buildRoleSessionRecord({
    mission_id: "m1",
    role: "hq",
    event_type: "script_written",
    script_path: "/work/project/launch/hq.sh",
  });
  assert.match(r.record_id, /^rec_[0-9a-f]{12}$/);
  assert.equal(r.mission_id, "m1");
  assert.equal(r.role, "hq");
  assert.equal(r.event_type, "script_written");
  assert.equal(r.script_path, "/work/project/launch/hq.sh");
  assert.equal(r.session_id, null);
  assert.match(r.timestamp, /^\d{4}-\d{2}-\d{2}T/);
});

test("appendRoleSessionRecord + getRoleSessionRecords round-trip", () => {
  const ws = makeWorkspace();
  try {
    const { card, layout } = makeMissionLayout(ws, "dogfood", "round-trip");
    const r1 = record({ mission_id: card.mission_id, role: "hq", event_type: "script_written", script_path: "/x.sh" });
    const r2 = record({ mission_id: card.mission_id, role: "hq", event_type: "alive_confirmed", session_id: "sess-1", timestamp: "2026-06-17T00:01:00.000Z" });
    appendRoleSessionRecord(ws, layout, r1);
    appendRoleSessionRecord(ws, layout, r2);
    const records = getRoleSessionRecords(ws, card.mission_id);
    assert.equal(records.length, 2);
    assert.equal(records[0]?.record_id, r1.record_id);
    assert.equal(records[1]?.event_type, "alive_confirmed");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("getRoleSessionRecords returns empty list when sessions.jsonl is absent", () => {
  const ws = makeWorkspace();
  try {
    const { card } = makeMissionLayout(ws, "dogfood", "empty-sessions");
    const records = getRoleSessionRecords(ws, card.mission_id);
    assert.deepEqual(records, []);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("getRoleSessionRecords tolerates malformed lines (skip, don't throw)", () => {
  const ws = makeWorkspace();
  try {
    const { card, layout } = makeMissionLayout(ws, "dogfood", "tolerant");
    const r1 = record({ mission_id: card.mission_id, role: "hq", event_type: "script_written" });
    appendRoleSessionRecord(ws, layout, r1);
    // Append a malformed line directly.
    const original = readFileSync(layout.sessionsPath, "utf8");
    writeFileSync(layout.sessionsPath, `${original}{not json}\n`, "utf8");
    const records = getRoleSessionRecords(ws, card.mission_id);
    assert.equal(records.length, 1);
    assert.equal(records[0]?.record_id, r1.record_id);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("latestRecordForRole returns the most recent record per role", () => {
  const records = [
    record({ mission_id: "m", role: "hq", event_type: "script_written", timestamp: "2026-06-17T00:00:00.000Z" }),
    record({ mission_id: "m", role: "hq", event_type: "alive_confirmed", timestamp: "2026-06-17T00:01:00.000Z" }),
    record({ mission_id: "m", role: "runner", event_type: "script_written", timestamp: "2026-06-17T00:02:00.000Z" }),
  ];
  const hq = latestRecordForRole(records, "hq");
  assert.ok(hq);
  assert.equal(hq?.event_type, "alive_confirmed");
  const runner = latestRecordForRole(records, "runner");
  assert.ok(runner);
  assert.equal(runner?.event_type, "script_written");
  const scott = latestRecordForRole(records, "scott");
  assert.equal(scott, null);
});

// ---------------------------------------------------------------------------
// classifyRole (spec §6.3 6-step algorithm)
// ---------------------------------------------------------------------------

test("classifyRole step 1: owner parked role → parked regardless of records", () => {
  const now = new Date("2026-06-17T00:00:00.000Z");
  const records = [
    record({ mission_id: "m", role: "hq", event_type: "heartbeat", timestamp: "2026-06-17T00:00:00.000Z" }),
  ];
  const c = classifyRole("hq", records, {
    now,
    ownerParkedRoles: new Set(["hq"]),
  });
  assert.equal(c.state, "parked");
  assert.equal(c.needs_liveness_confirmation, false);
  assert.match(c.reason, /owner parked/);
});

test("classifyRole step 2: mission archived → closed for all roles", () => {
  const now = new Date("2026-06-17T00:00:00.000Z");
  const records = [
    record({ mission_id: "m", role: "hq", event_type: "heartbeat", timestamp: now.toISOString() }),
  ];
  const c = classifyRole("hq", records, { now, isMissionArchived: true });
  assert.equal(c.state, "closed");
  assert.match(c.reason, /archived/);
});

test("classifyRole step 2: mission delivered → closed for all roles", () => {
  const now = new Date("2026-06-17T00:00:00.000Z");
  const c = classifyRole("hq", [], { now, isMissionClosed: true });
  assert.equal(c.state, "closed");
  assert.match(c.reason, /delivered/);
});

test("classifyRole step 2: latest closed record wins (without mission terminal flag)", () => {
  const now = new Date("2026-06-17T00:00:00.000Z");
  const records = [
    record({ mission_id: "m", role: "hq", event_type: "alive_confirmed", timestamp: "2026-06-17T00:00:00.000Z" }),
    record({ mission_id: "m", role: "hq", event_type: "closed", timestamp: "2026-06-17T00:01:00.000Z" }),
  ];
  const c = classifyRole("hq", records, { now });
  assert.equal(c.state, "closed");
  assert.match(c.reason, /latest record is closed/);
});

test("classifyRole step 2: latest failed record wins (per spec §4.2 \"A closed or failed record overrides\")", () => {
  const now = new Date("2026-06-17T00:00:00.000Z");
  const records = [
    record({ mission_id: "m", role: "hq", event_type: "alive_confirmed", timestamp: "2026-06-17T00:00:00.000Z" }),
    record({ mission_id: "m", role: "hq", event_type: "failed", timestamp: "2026-06-17T00:01:00.000Z" }),
  ];
  const c = classifyRole("hq", records, { now });
  assert.equal(c.state, "closed");
  assert.match(c.reason, /latest record is failed/);
});

test("classifyRole step 3: fresh heartbeat → live (spec §4.2: 20s default)", () => {
  const now = new Date("2026-06-17T00:00:30.000Z");
  const records = [
    record({ mission_id: "m", role: "hq", event_type: "heartbeat", timestamp: "2026-06-17T00:00:20.000Z" }),
  ];
  const c = classifyRole("hq", records, { now });
  assert.equal(c.state, "live");
  assert.match(c.reason, /fresh registry heartbeat/);
});

test("classifyRole step 3: heartbeat outside 20s window is NOT live", () => {
  const now = new Date("2026-06-17T00:01:00.000Z");
  const records = [
    record({ mission_id: "m", role: "hq", event_type: "heartbeat", timestamp: "2026-06-17T00:00:00.000Z" }),
  ];
  const c = classifyRole("hq", records, { now });
  // Stale heartbeat should fall through to step 4/5/6.
  assert.equal(c.state, "stale");
});

test("classifyRole step 4: alive_confirmed within 10min → resumable (no liveness check)", () => {
  const now = new Date("2026-06-17T00:09:00.000Z");
  const records = [
    record({ mission_id: "m", role: "hq", event_type: "alive_confirmed", session_id: "sess-1", timestamp: "2026-06-17T00:05:00.000Z" }),
  ];
  const c = classifyRole("hq", records, { now });
  assert.equal(c.state, "resumable");
  assert.equal(c.needs_liveness_confirmation, false);
  assert.match(c.reason, /alive_confirmed/);
});

test("classifyRole step 4: alive_confirmed older than 10min → stale (not resumable)", () => {
  const now = new Date("2026-06-17T00:15:00.000Z");
  const records = [
    record({ mission_id: "m", role: "hq", event_type: "alive_confirmed", timestamp: "2026-06-17T00:00:00.000Z" }),
  ];
  const c = classifyRole("hq", records, { now });
  assert.equal(c.state, "stale");
});

test("classifyRole step 5: script_written without later event → resumable with liveness check", () => {
  const now = new Date("2026-06-17T00:00:30.000Z");
  const records = [
    record({
      mission_id: "m",
      role: "hq",
      event_type: "script_written",
      script_path: "/work/project/launch/hq.sh",
      timestamp: "2026-06-17T00:00:00.000Z",
    }),
  ];
  const c = classifyRole("hq", records, { now });
  assert.equal(c.state, "resumable");
  assert.equal(c.needs_liveness_confirmation, true);
  assert.match(c.reason, /launch attempted/);
});

test("classifyRole step 5: launch_printed and launch_requested also trigger liveness check", () => {
  const now = new Date("2026-06-17T00:00:30.000Z");
  for (const event_type of ["launch_printed", "launch_requested"] as const) {
    const records = [
      record({ mission_id: "m", role: "hq", event_type, timestamp: "2026-06-17T00:00:00.000Z" }),
    ];
    const c = classifyRole("hq", records, { now });
    assert.equal(c.state, "resumable", event_type);
    assert.equal(c.needs_liveness_confirmation, true, event_type);
  }
});

// Slice 3.1: launch-attempt events must respect the resume freshness window.
// Spec §4.2: "A session record may be `resumable` for up to the Mission
// resume freshness window." This applies to all resumable classifications,
// including those derived from script_written / launch_printed / launch_requested.
// Outside the window, the role is `stale` (liveness is too uncertain to claim
// "resumable" without a fresh heartbeat or alive_confirmed).

test("classifyRole step 5: old script_written (11 min) is stale, not resumable (slice 3.1)", () => {
  const now = new Date("2026-06-17T00:11:00.000Z");
  const records = [
    record({
      mission_id: "m",
      role: "hq",
      event_type: "script_written",
      script_path: "/work/project/launch/hq.sh",
      timestamp: "2026-06-17T00:00:00.000Z",
    }),
  ];
  const c = classifyRole("hq", records, { now });
  assert.equal(c.state, "stale");
  assert.equal(c.needs_liveness_confirmation, false);
  assert.match(c.reason, /older than freshness/);
});

test("classifyRole step 5: old launch_printed (11 min) is stale, not resumable (slice 3.1)", () => {
  const now = new Date("2026-06-17T00:11:00.000Z");
  const records = [
    record({ mission_id: "m", role: "hq", event_type: "launch_printed", timestamp: "2026-06-17T00:00:00.000Z" }),
  ];
  const c = classifyRole("hq", records, { now });
  assert.equal(c.state, "stale");
  assert.equal(c.needs_liveness_confirmation, false);
});

test("classifyRole step 5: old launch_requested (11 min) is stale, not resumable (slice 3.1)", () => {
  const now = new Date("2026-06-17T00:11:00.000Z");
  const records = [
    record({ mission_id: "m", role: "hq", event_type: "launch_requested", timestamp: "2026-06-17T00:00:00.000Z" }),
  ];
  const c = classifyRole("hq", records, { now });
  assert.equal(c.state, "stale");
  assert.equal(c.needs_liveness_confirmation, false);
});

test("classifyRole step 5: script_written at exact resume-window boundary is still resumable", () => {
  const now = new Date("2026-06-17T00:10:00.000Z");
  const records = [
    record({ mission_id: "m", role: "hq", event_type: "script_written", timestamp: "2026-06-17T00:00:00.000Z" }),
  ];
  const c = classifyRole("hq", records, { now });
  // 10 min = 600_000 ms is the inclusive boundary.
  assert.equal(c.state, "resumable");
  assert.equal(c.needs_liveness_confirmation, true);
});

test("classifyRole step 5: alive_confirmed and script_written share the same resume-window rule (10min)", () => {
  const now = new Date("2026-06-17T00:15:00.000Z");
  const aliveOld = record({ mission_id: "m", role: "hq", event_type: "alive_confirmed", timestamp: "2026-06-17T00:00:00.000Z" });
  const scriptOld = record({ mission_id: "m", role: "repair", event_type: "script_written", timestamp: "2026-06-17T00:00:00.000Z" });
  const aliveC = classifyRole("hq", [aliveOld], { now });
  const scriptC = classifyRole("repair", [scriptOld], { now });
  assert.equal(aliveC.state, "stale");
  assert.equal(scriptC.state, "stale");
});

test("classifyRole step 6: no records → stale", () => {
  const now = new Date("2026-06-17T00:00:00.000Z");
  const c = classifyRole("hq", [], { now });
  assert.equal(c.state, "stale");
  assert.equal(c.latest_record_id, null);
  assert.match(c.reason, /no session records/);
});

test("classifyRole step 6: heartbeat way past window → stale", () => {
  const now = new Date("2026-06-17T01:00:00.000Z");
  const records = [
    record({ mission_id: "m", role: "hq", event_type: "heartbeat", timestamp: "2026-06-17T00:00:00.000Z" }),
  ];
  const c = classifyRole("hq", records, { now });
  assert.equal(c.state, "stale");
  assert.match(c.reason, /older than freshness/);
});

test("classifyRole: latest record wins, even when older records imply a different state", () => {
  const now = new Date("2026-06-17T00:00:30.000Z");
  const records = [
    record({ mission_id: "m", role: "hq", event_type: "alive_confirmed", timestamp: "2026-06-17T00:00:00.000Z" }),
    record({ mission_id: "m", role: "hq", event_type: "heartbeat", timestamp: "2026-06-17T00:00:25.000Z" }),
  ];
  const c = classifyRole("hq", records, { now });
  // Latest is heartbeat (still fresh) → live, even though older was alive_confirmed.
  assert.equal(c.state, "live");
});

test("classifyRole: script_written followed by alive_confirmed (still fresh) → resumable not stale", () => {
  const now = new Date("2026-06-17T00:00:30.000Z");
  const records = [
    record({ mission_id: "m", role: "hq", event_type: "script_written", timestamp: "2026-06-17T00:00:00.000Z" }),
    record({ mission_id: "m", role: "hq", event_type: "alive_confirmed", session_id: "sess-1", timestamp: "2026-06-17T00:00:25.000Z" }),
  ];
  const c = classifyRole("hq", records, { now });
  assert.equal(c.state, "resumable");
  assert.equal(c.needs_liveness_confirmation, false);
});

test("classifyRole: latest record wins — a fresh heartbeat after an old closed overrides closed", () => {
  // Per slice 3 design: the LATEST record drives state. A newer fresh
  // heartbeat supersedes an older closed record (the close is a terminal
  // state for the older run; a new launch restarts the lifecycle).
  const now = new Date("2026-06-17T00:01:00.000Z");
  const records = [
    record({ mission_id: "m", role: "hq", event_type: "closed", timestamp: "2026-06-17T00:00:00.000Z", reason: "explicit close" }),
    record({ mission_id: "m", role: "hq", event_type: "heartbeat", timestamp: "2026-06-17T00:00:55.000Z" }),
  ];
  const c = classifyRole("hq", records, { now });
  assert.equal(c.state, "live");
});

test("classifyRole: latest record is closed → closed (no newer contradicting record)", () => {
  const now = new Date("2026-06-17T00:00:30.000Z");
  const records = [
    record({ mission_id: "m", role: "hq", event_type: "alive_confirmed", timestamp: "2026-06-17T00:00:00.000Z" }),
    record({ mission_id: "m", role: "hq", event_type: "closed", timestamp: "2026-06-17T00:00:20.000Z", reason: "explicit close" }),
  ];
  const c = classifyRole("hq", records, { now });
  assert.equal(c.state, "closed");
  assert.match(c.reason, /latest record is closed/);
});

test("classifyRole: latest record is parked → parked", () => {
  const now = new Date("2026-06-17T00:00:30.000Z");
  const records = [
    record({ mission_id: "m", role: "oracle", event_type: "heartbeat", timestamp: "2026-06-17T00:00:00.000Z" }),
    record({ mission_id: "m", role: "oracle", event_type: "parked", timestamp: "2026-06-17T00:00:20.000Z" }),
  ];
  const c = classifyRole("oracle", records, { now });
  assert.equal(c.state, "parked");
  assert.match(c.reason, /latest record is parked/);
});

// ---------------------------------------------------------------------------
// computeRoleSummary + classifyAllRoles
// ---------------------------------------------------------------------------

test("computeRoleSummary counts 5 categories", () => {
  const c = computeRoleSummary([
    { role: "hq", state: "live", latest_record_id: null, latest_event_type: null, latest_event_timestamp: null, needs_liveness_confirmation: false, reason: "" },
    { role: "runner", state: "live", latest_record_id: null, latest_event_type: null, latest_event_timestamp: null, needs_liveness_confirmation: false, reason: "" },
    { role: "repair", state: "stale", latest_record_id: null, latest_event_type: null, latest_event_timestamp: null, needs_liveness_confirmation: false, reason: "" },
    { role: "oracle", state: "resumable", latest_record_id: null, latest_event_type: null, latest_event_timestamp: null, needs_liveness_confirmation: false, reason: "" },
    { role: "librarian", state: "parked", latest_record_id: null, latest_event_type: null, latest_event_timestamp: null, needs_liveness_confirmation: false, reason: "" },
    { role: "scott", state: "closed", latest_record_id: null, latest_event_type: null, latest_event_timestamp: null, needs_liveness_confirmation: false, reason: "" },
    { role: "topology-supervisor", state: "closed", latest_record_id: null, latest_event_type: null, latest_event_timestamp: null, needs_liveness_confirmation: false, reason: "" },
  ]);
  assert.deepEqual(c, { live: 2, resumable: 1, stale: 1, parked: 1, closed: 2 });
});

test("classifyAllRoles returns classifications for every role in the list", () => {
  const c = classifyAllRoles(ROLES_ALL, [], { now: new Date("2026-06-17T00:00:00.000Z") });
  assert.equal(c.length, 7);
  for (const cls of c) {
    assert.equal(cls.state, "stale"); // no records → all stale
  }
});

test("classifyAllRoles: one role live, others stale, summary matches", () => {
  const now = new Date("2026-06-17T00:00:30.000Z");
  const records = [
    record({ mission_id: "m", role: "hq", event_type: "heartbeat", timestamp: "2026-06-17T00:00:20.000Z" }),
  ];
  const c = classifyAllRoles(ROLES_ALL, records, { now });
  const summary = computeRoleSummary(c);
  assert.equal(summary.live, 1);
  assert.equal(summary.stale, 6);
  assert.equal(summary.resumable, 0);
  assert.equal(summary.parked, 0);
  assert.equal(summary.closed, 0);
});

test("emptyRoleSummary returns the zeroed 5-category shape", () => {
  assert.deepEqual(emptyRoleSummary(), { live: 0, resumable: 0, stale: 0, parked: 0, closed: 0 });
});

// ---------------------------------------------------------------------------
// populateRoleSummaryForMission
// ---------------------------------------------------------------------------

test("populateRoleSummaryForMission returns null for unknown Mission", () => {
  const ws = makeWorkspace();
  try {
    assert.equal(populateRoleSummaryForMission(ws, "ghost-mission"), null);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("populateRoleSummaryForMission returns null when no registry exists", () => {
  const ws = makeWorkspace();
  try {
    assert.equal(populateRoleSummaryForMission(ws, "any-mission"), null);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("populateRoleSummaryForMission with no records: all roles stale, summary = 0/0/7/0/0", () => {
  const ws = makeWorkspace();
  try {
    const { card } = makeMissionLayout(ws, "dogfood", "all-stale");
    const result = populateRoleSummaryForMission(ws, card.mission_id, new Date("2026-06-17T00:00:00.000Z"));
    assert.ok(result);
    assert.deepEqual(result.role_summary, { live: 0, resumable: 0, stale: 7, parked: 0, closed: 0 });

    // Registry's role_summary field updated.
    const reg = readMissionRegistry(ws);
    const entry = reg?.missions.find((m) => m.mission_id === card.mission_id);
    assert.deepEqual(entry?.role_summary, { live: 0, resumable: 0, stale: 7, parked: 0, closed: 0 });
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("populateRoleSummaryForMission with 1 live heartbeat: summary = 1/0/6/0/0", () => {
  const ws = makeWorkspace();
  try {
    const { card, layout } = makeMissionLayout(ws, "dogfood", "one-live");
    appendRoleSessionRecord(ws, layout, record({
      mission_id: card.mission_id,
      role: "hq",
      event_type: "heartbeat",
      timestamp: "2026-06-17T00:00:20.000Z",
    }));
    const result = populateRoleSummaryForMission(ws, card.mission_id, new Date("2026-06-17T00:00:30.000Z"));
    assert.ok(result);
    assert.deepEqual(result.role_summary, { live: 1, resumable: 0, stale: 6, parked: 0, closed: 0 });
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("populateRoleSummaryForMission reflects mission archived state (all closed)", () => {
  const ws = makeWorkspace();
  try {
    const { card, layout, entry } = makeMissionLayout(ws, "dogfood", "archived");
    appendRoleSessionRecord(ws, layout, record({
      mission_id: card.mission_id,
      role: "hq",
      event_type: "heartbeat",
      timestamp: "2026-06-17T00:00:20.000Z",
    }));
    // Mark Mission as archived in registry.
    const reg = readMissionRegistry(ws);
    const idx = reg!.missions.findIndex((m) => m.mission_id === card.mission_id);
    const newEntry = { ...reg!.missions[idx]!, archived: true, lifecycle_state: "archived" as const };
    writeMissionRegistry(ws, {
      ...reg!,
      missions: [...reg!.missions.slice(0, idx), newEntry, ...reg!.missions.slice(idx + 1)],
    });
    void entry;
    const result = populateRoleSummaryForMission(ws, card.mission_id, new Date("2026-06-17T00:00:30.000Z"));
    assert.ok(result);
    assert.deepEqual(result.role_summary, { live: 0, resumable: 0, stale: 0, parked: 0, closed: 7 });
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("populateRoleSummaryForMission is idempotent (calling twice yields same result)", () => {
  const ws = makeWorkspace();
  try {
    const { card, layout } = makeMissionLayout(ws, "dogfood", "idempotent");
    appendRoleSessionRecord(ws, layout, record({
      mission_id: card.mission_id,
      role: "hq",
      event_type: "heartbeat",
      timestamp: "2026-06-17T00:00:20.000Z",
    }));
    const now = new Date("2026-06-17T00:00:30.000Z");
    const r1 = populateRoleSummaryForMission(ws, card.mission_id, now);
    const r2 = populateRoleSummaryForMission(ws, card.mission_id, now);
    assert.ok(r1 && r2);
    assert.deepEqual(r1.role_summary, r2.role_summary);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("populateRoleSummaryForMission: full state mix (live + resumable + stale + parked + closed)", () => {
  const ws = makeWorkspace();
  try {
    const { card, layout, entry } = makeMissionLayout(ws, "dogfood", "mix");
    // topology-supervisor: live (fresh heartbeat — must be within 20s of now)
    appendRoleSessionRecord(ws, layout, record({
      mission_id: card.mission_id,
      role: "topology-supervisor",
      event_type: "heartbeat",
      timestamp: "2026-06-17T00:09:50.000Z",
    }));
    // hq: resumable (alive_confirmed within window)
    appendRoleSessionRecord(ws, layout, record({
      mission_id: card.mission_id,
      role: "hq",
      event_type: "alive_confirmed",
      timestamp: "2026-06-17T00:05:00.000Z",
    }));
    // repair: stale (heartbeat way too old)
    appendRoleSessionRecord(ws, layout, record({
      mission_id: card.mission_id,
      role: "repair",
      event_type: "heartbeat",
      timestamp: "2026-06-16T00:00:00.000Z",
    }));
    // runner: resumable with liveness check (script_written)
    appendRoleSessionRecord(ws, layout, record({
      mission_id: card.mission_id,
      role: "runner",
      event_type: "script_written",
      timestamp: "2026-06-17T00:00:00.000Z",
    }));
    // oracle: parked (latest record is parked)
    appendRoleSessionRecord(ws, layout, record({
      mission_id: card.mission_id,
      role: "oracle",
      event_type: "parked",
      timestamp: "2026-06-17T00:00:00.000Z",
    }));
    // librarian: closed (latest is closed)
    appendRoleSessionRecord(ws, layout, record({
      mission_id: card.mission_id,
      role: "librarian",
      event_type: "closed",
      timestamp: "2026-06-17T00:00:00.000Z",
    }));
    // scott: stale (no records)
    void entry;
    const now = new Date("2026-06-17T00:10:00.000Z");
    const result = populateRoleSummaryForMission(ws, card.mission_id, now);
    assert.ok(result);
    assert.deepEqual(result.role_summary, {
      live: 1,        // topology-supervisor
      resumable: 2,   // hq (alive_confirmed) + runner (script_written)
      stale: 2,      // repair (old heartbeat) + scott (no records)
      parked: 1,     // oracle
      closed: 1,     // librarian
    });
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Sanity: role session records persisted via appendToJsonlLedger also mirror to root
// ---------------------------------------------------------------------------

test("appendRoleSessionRecord mirrors to root sessions.jsonl (slice 1 root-mirror path)", () => {
  const ws = makeWorkspace();
  try {
    const { card, layout } = makeMissionLayout(ws, "dogfood", "mirror-check");
    const r = record({ mission_id: card.mission_id, role: "hq", event_type: "script_written" });
    appendRoleSessionRecord(ws, layout, r);

    const rootSessionsPath = join(ws, ".pi", "topology", "sessions.jsonl");
    const rootContent = readFileSync(rootSessionsPath, "utf8");
    assert.match(rootContent, new RegExp(r.record_id));
    // Per-mission and root mirror agree.
    assert.equal(readFileSync(layout.sessionsPath, "utf8"), rootContent);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// isMissionTerminalForRoles helper
// ---------------------------------------------------------------------------

test("isMissionTerminalForRoles: delivered and abandoned are terminal; archived always", () => {
  assert.equal(isMissionTerminalForRoles("delivered", false), true);
  assert.equal(isMissionTerminalForRoles("abandoned", false), true);
  assert.equal(isMissionTerminalForRoles("draft", true), true); // archived wins
  assert.equal(isMissionTerminalForRoles("draft", false), false);
  assert.equal(isMissionTerminalForRoles("running", false), false);
  assert.equal(isMissionTerminalForRoles("parked", false), false);
  assert.equal(isMissionTerminalForRoles("rollback_pending", false), false);
});
