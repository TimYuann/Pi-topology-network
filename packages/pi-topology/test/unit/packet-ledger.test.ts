import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ACTIVE_READ_STATES,
  appendPacketLedger,
  classifyPacketLiveness,
  compileRawPacketToLedger,
  DEFAULT_STALE_THRESHOLD_MS,
  defaultActionableTypesForRole,
  findPacketById,
  getActivePacketsForMission,
  getAllActivePacketsForMission,
  getPacketLedgerEntries,
  isActionableForRecipient,
  isPacketStale,
  PACKET_STATES,
  PACKET_TYPES,
  populatePendingPacketCountForMission,
  TERMINAL_PACKET_STATES,
  type ActivePacketsFilterOptions,
  type PacketLedgerEntry,
  type PacketState,
  type PacketType,
  type RawPacketObservation,
} from "../../src/runtime/packet-ledger.ts";
import {
  createInitialStatusBoard,
  createMissionDraft,
} from "../../src/runtime/mission.ts";
import { createMissionLayout } from "../../src/runtime/mission-layout.ts";
import { addMissionToRegistry, createEmptyRegistry, newMissionRegistryEntry, readMissionRegistry, writeMissionRegistry } from "../../src/runtime/mission-registry.ts";
import type { TopologyRole } from "../../src/runtime/mission.ts";

function makeWorkspace(): string {
  return mkdtempSync(join(tmpdir(), "pi-topology-slice4-packetledger-"));
}

function makeMission(workspaceDir: string, project: string, objective: string) {
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

let counter = 0;
function entry(opts: {
  mission_id: string;
  packet_id?: string;
  type?: PacketType;
  from?: TopologyRole;
  to?: TopologyRole;
  state?: PacketState;
  first_seen_at?: string;
  last_seen_at?: string;
  raw_path?: string;
  reason?: string;
}): PacketLedgerEntry {
  counter += 1;
  return {
    packet_id: opts.packet_id ?? `pkt_${counter}`,
    mission_id: opts.mission_id,
    type: opts.type ?? "REPORT",
    from: opts.from ?? "hq",
    to: opts.to ?? "topology-supervisor",
    request_msg_id: null,
    correlation_id: null,
    state: opts.state ?? "delivered",
    raw_transport_path: opts.raw_path ?? "/tmp/pi-topology-x/packets/outbox.jsonl",
    first_seen_at: opts.first_seen_at ?? "2026-06-17T00:00:00.000Z",
    last_seen_at: opts.last_seen_at ?? opts.first_seen_at ?? "2026-06-17T00:00:00.000Z",
    classification_reason: opts.reason ?? "raw packet observed",
    artifact_path: null,
  };
}

// ---------------------------------------------------------------------------
// Constants & enums
// ---------------------------------------------------------------------------

test("PACKET_STATES has all 11 spec §4.4 states", () => {
  assert.deepEqual([...PACKET_STATES], [
    "queued", "delivered", "acknowledged", "in_progress", "reported",
    "report_acknowledged", "closed", "ignored", "stale", "duplicate", "preserved",
  ]);
});

test("PACKET_TYPES has all 6 spec §3.1 packet types", () => {
  assert.deepEqual([...PACKET_TYPES], ["ACK", "STATUS", "REPORT", "REQUEST", "INCIDENT", "VERDICT"]);
});

test("ACTIVE_READ_STATES = {queued, delivered, acknowledged, in_progress, reported}", () => {
  assert.equal(ACTIVE_READ_STATES.size, 5);
  for (const s of ["queued", "delivered", "acknowledged", "in_progress", "reported"] as const) {
    assert.equal(ACTIVE_READ_STATES.has(s), true, s);
  }
});

test("TERMINAL_PACKET_STATES = {closed, report_acknowledged, ignored, stale, duplicate, preserved}", () => {
  assert.equal(TERMINAL_PACKET_STATES.size, 6);
  for (const s of ["closed", "report_acknowledged", "ignored", "stale", "duplicate", "preserved"] as const) {
    assert.equal(TERMINAL_PACKET_STATES.has(s), true, s);
  }
});

test("ACTIVE_READ_STATES and TERMINAL_PACKET_STATES are disjoint and together cover all 11 states", () => {
  for (const s of PACKET_STATES) {
    const inActive = ACTIVE_READ_STATES.has(s);
    const inTerminal = TERMINAL_PACKET_STATES.has(s);
    assert.notEqual(inActive && inTerminal, true, `${s} should not be in both sets`);
    assert.equal(inActive || inTerminal, true, `${s} must be in either set`);
  }
});

test("default stale threshold is 30 minutes", () => {
  assert.equal(DEFAULT_STALE_THRESHOLD_MS, 30 * 60 * 1000);
});

// ---------------------------------------------------------------------------
// defaultActionableTypesForRole
// ---------------------------------------------------------------------------

test("defaultActionableTypesForRole: topology-supervisor + hq see all 6 types", () => {
  for (const role of ["topology-supervisor", "hq"] as const) {
    const types = defaultActionableTypesForRole(role);
    for (const t of PACKET_TYPES) {
      assert.equal(types.has(t), true, `${role} should see ${t}`);
    }
  }
});

test("defaultActionableTypesForRole: repair sees REQUEST / ACK / VERDICT", () => {
  const types = defaultActionableTypesForRole("repair");
  assert.deepEqual([...types].sort(), ["ACK", "REQUEST", "VERDICT"]);
});

test("defaultActionableTypesForRole: runner / oracle see REQUEST/ACK/INCIDENT/REPORT/VERDICT", () => {
  for (const role of ["runner", "oracle"] as const) {
    const types = defaultActionableTypesForRole(role);
    assert.deepEqual([...types].sort(), ["ACK", "INCIDENT", "REPORT", "REQUEST", "VERDICT"]);
  }
});

test("defaultActionableTypesForRole: librarian sees REPORT / INCIDENT / VERDICT", () => {
  const types = defaultActionableTypesForRole("librarian");
  assert.deepEqual([...types].sort(), ["INCIDENT", "REPORT", "VERDICT"]);
});

test("defaultActionableTypesForRole: scott sees STATUS / REQUEST / REPORT", () => {
  const types = defaultActionableTypesForRole("scott");
  assert.deepEqual([...types].sort(), ["REPORT", "REQUEST", "STATUS"]);
});

// ---------------------------------------------------------------------------
// Read / write
// ---------------------------------------------------------------------------

test("appendPacketLedger + getPacketLedgerEntries round-trip", () => {
  const ws = makeWorkspace();
  try {
    const { card, layout } = makeMission(ws, "dogfood", "round-trip");
    const e1 = entry({ mission_id: card.mission_id, packet_id: "pkt_a" });
    const e2 = entry({ mission_id: card.mission_id, packet_id: "pkt_b" });
    appendPacketLedger(ws, layout, e1);
    appendPacketLedger(ws, layout, e2);
    const all = getPacketLedgerEntries(ws, card.mission_id);
    assert.equal(all.length, 2);
    assert.equal(all[0]?.packet_id, "pkt_a");
    assert.equal(all[1]?.packet_id, "pkt_b");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("getPacketLedgerEntries returns empty list when packet-ledger.jsonl is absent", () => {
  const ws = makeWorkspace();
  try {
    const { card } = makeMission(ws, "dogfood", "empty");
    const all = getPacketLedgerEntries(ws, card.mission_id);
    assert.deepEqual(all, []);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("getPacketLedgerEntries tolerates malformed lines (skip, don't throw)", () => {
  const ws = makeWorkspace();
  try {
    const { card, layout } = makeMission(ws, "dogfood", "tolerant");
    const e1 = entry({ mission_id: card.mission_id, packet_id: "pkt_a" });
    appendPacketLedger(ws, layout, e1);
    // Append a malformed line.
    const original = readFileSync(layout.packetLedgerPath, "utf8");
    writeFileSync(layout.packetLedgerPath, `${original}{not json}\n`, "utf8");
    const all = getPacketLedgerEntries(ws, card.mission_id);
    assert.equal(all.length, 1);
    assert.equal(all[0]?.packet_id, "pkt_a");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("appendPacketLedger writes per-mission only (packet-ledger is NOT in slice 1 root-mirror list per spec §3.2)", () => {
  const ws = makeWorkspace();
  try {
    const { card, layout } = makeMission(ws, "dogfood", "per-mission");
    const e = entry({ mission_id: card.mission_id, packet_id: "pkt_per_mission" });
    appendPacketLedger(ws, layout, e);
    // Per-mission file contains the entry.
    const perMissionContent = readFileSync(layout.packetLedgerPath, "utf8");
    assert.match(perMissionContent, /pkt_per_mission/);
    // Root .pi/topology/packet-ledger.jsonl is NOT created (per spec §3.2 mirror list).
    const rootPath = join(ws, ".pi", "topology", "packet-ledger.jsonl");
    assert.equal(existsSync(rootPath), false);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("findPacketById returns the matching entry or null", () => {
  const entries = [
    entry({ mission_id: "m", packet_id: "pkt_x" }),
    entry({ mission_id: "m", packet_id: "pkt_y" }),
  ];
  assert.equal(findPacketById(entries, "pkt_x")?.packet_id, "pkt_x");
  assert.equal(findPacketById(entries, "pkt_y")?.packet_id, "pkt_y");
  assert.equal(findPacketById(entries, "pkt_z"), null);
});

// ---------------------------------------------------------------------------
// classifyPacketLiveness + isPacketStale
// ---------------------------------------------------------------------------

test("classifyPacketLiveness: stored stale stays stale", () => {
  const e = entry({ mission_id: "m", state: "stale", last_seen_at: "2026-06-17T00:00:00.000Z" });
  assert.equal(classifyPacketLiveness(e, new Date("2026-06-17T00:00:00.000Z")), "stale");
});

test("classifyPacketLiveness: terminal states pass through unchanged", () => {
  for (const s of ["closed", "report_acknowledged", "ignored", "duplicate", "preserved"] as const) {
    const e = entry({ mission_id: "m", state: s, last_seen_at: "2026-06-17T00:00:00.000Z" });
    assert.equal(classifyPacketLiveness(e, new Date("2026-06-17T01:00:00.000Z")), s);
  }
});

test("classifyPacketLiveness: active state with old last_seen_at → stale", () => {
  const e = entry({
    mission_id: "m",
    state: "delivered",
    last_seen_at: "2026-06-17T00:00:00.000Z",
  });
  const now = new Date("2026-06-17T00:30:01.000Z");
  assert.equal(classifyPacketLiveness(e, now), "stale");
});

test("classifyPacketLiveness: active state with recent last_seen_at → unchanged", () => {
  const e = entry({
    mission_id: "m",
    state: "delivered",
    last_seen_at: "2026-06-17T00:00:00.000Z",
  });
  const now = new Date("2026-06-17T00:29:59.000Z");
  assert.equal(classifyPacketLiveness(e, now), "delivered");
});

test("classifyPacketLiveness: active state at exact threshold is still active (boundary inclusive)", () => {
  const e = entry({
    mission_id: "m",
    state: "delivered",
    last_seen_at: "2026-06-17T00:00:00.000Z",
  });
  const now = new Date("2026-06-17T00:30:00.000Z");
  assert.equal(classifyPacketLiveness(e, now), "delivered");
});

test("isPacketStale is a thin wrapper over classifyPacketLiveness", () => {
  const e = entry({ mission_id: "m", state: "delivered", last_seen_at: "2026-06-17T00:00:00.000Z" });
  const now = new Date("2026-06-17T00:30:01.000Z");
  assert.equal(isPacketStale(e, now), true);
  const nowFresh = new Date("2026-06-17T00:29:59.000Z");
  assert.equal(isPacketStale(e, nowFresh), false);
});

// ---------------------------------------------------------------------------
// getActivePacketsForMission (spec §7 filter)
// ---------------------------------------------------------------------------

test("getActivePacketsForMission: filters by mission_id", () => {
  const ws = makeWorkspace();
  try {
    const { card: m1, layout: l1 } = makeMission(ws, "dogfood-m1", "m1");
    const { card: m2, layout: l2 } = makeMission(ws, "dogfood-m2", "m2");
    const now = new Date("2026-06-17T00:00:00.000Z");
    appendPacketLedger(ws, l1, entry({ mission_id: m1.mission_id, packet_id: "pkt_in_m1" }));
    appendPacketLedger(ws, l2, entry({ mission_id: m2.mission_id, packet_id: "pkt_in_m2" }));
    const opts: ActivePacketsFilterOptions = { now };
    const active = getActivePacketsForMission(ws, m1.mission_id, "topology-supervisor", opts);
    assert.equal(active.length, 1);
    assert.equal(active[0]?.packet_id, "pkt_in_m1");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("getActivePacketsForMission: filters by recipient role (to === role)", () => {
  const ws = makeWorkspace();
  try {
    const { card, layout } = makeMission(ws, "dogfood", "role-filter");
    const now = new Date("2026-06-17T00:00:00.000Z");
    appendPacketLedger(ws, layout, entry({ mission_id: card.mission_id, packet_id: "pkt_to_supervisor", to: "topology-supervisor" }));
    appendPacketLedger(ws, layout, entry({ mission_id: card.mission_id, packet_id: "pkt_to_hq", to: "hq" }));
    const activeForSupervisor = getActivePacketsForMission(ws, card.mission_id, "topology-supervisor", { now });
    const activeForHq = getActivePacketsForMission(ws, card.mission_id, "hq", { now });
    assert.equal(activeForSupervisor.length, 1);
    assert.equal(activeForSupervisor[0]?.packet_id, "pkt_to_supervisor");
    assert.equal(activeForHq.length, 1);
    assert.equal(activeForHq[0]?.packet_id, "pkt_to_hq");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("getActivePacketsForMission: filters out terminal states", () => {
  const ws = makeWorkspace();
  try {
    const { card, layout } = makeMission(ws, "dogfood", "terminal-filter");
    const now = new Date("2026-06-17T00:00:00.000Z");
    for (const state of ["closed", "report_acknowledged", "ignored", "duplicate", "preserved", "stale"] as const) {
      appendPacketLedger(ws, layout, entry({
        mission_id: card.mission_id,
        packet_id: `pkt_${state}`,
        state,
        last_seen_at: now.toISOString(),
      }));
    }
    appendPacketLedger(ws, layout, entry({
      mission_id: card.mission_id,
      packet_id: "pkt_delivered",
      state: "delivered",
      last_seen_at: now.toISOString(),
    }));
    const active = getActivePacketsForMission(ws, card.mission_id, "topology-supervisor", { now });
    assert.equal(active.length, 1);
    assert.equal(active[0]?.packet_id, "pkt_delivered");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("getActivePacketsForMission: reclassifies stale-by-freshness as excluded", () => {
  const ws = makeWorkspace();
  try {
    const { card, layout } = makeMission(ws, "dogfood", "stale-filter");
    const now = new Date("2026-06-17T00:30:01.000Z");
    // last_seen_at is 30+ min old, but stored state is "delivered" (active).
    appendPacketLedger(ws, layout, entry({
      mission_id: card.mission_id,
      packet_id: "pkt_stale",
      state: "delivered",
      last_seen_at: "2026-06-17T00:00:00.000Z",
    }));
    const active = getActivePacketsForMission(ws, card.mission_id, "topology-supervisor", { now });
    assert.equal(active.length, 0);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("getActivePacketsForMission: filters by actionable type", () => {
  const ws = makeWorkspace();
  try {
    const { card, layout } = makeMission(ws, "dogfood", "type-filter");
    const now = new Date("2026-06-17T00:00:00.000Z");
    // Packets addressed to scott; scott's actionable types are STATUS / REQUEST / REPORT.
    appendPacketLedger(ws, layout, entry({
      mission_id: card.mission_id,
      packet_id: "pkt_status_to_scott",
      to: "scott",
      type: "STATUS",
      last_seen_at: now.toISOString(),
    }));
    appendPacketLedger(ws, layout, entry({
      mission_id: card.mission_id,
      packet_id: "pkt_report_to_scott",
      to: "scott",
      type: "REPORT",
      last_seen_at: now.toISOString(),
    }));
    // Packets addressed to librarian; librarian's actionable types are REPORT / INCIDENT / VERDICT.
    appendPacketLedger(ws, layout, entry({
      mission_id: card.mission_id,
      packet_id: "pkt_report_to_librarian",
      to: "librarian",
      type: "REPORT",
      last_seen_at: now.toISOString(),
    }));
    appendPacketLedger(ws, layout, entry({
      mission_id: card.mission_id,
      packet_id: "pkt_status_to_librarian",
      to: "librarian",
      type: "STATUS", // NOT actionable for librarian
      last_seen_at: now.toISOString(),
    }));

    // scott sees STATUS + REPORT (both actionable).
    const scottActive = getActivePacketsForMission(ws, card.mission_id, "scott", { now });
    assert.equal(scottActive.length, 2);
    const scottIds = scottActive.map((p) => p.packet_id).sort();
    assert.deepEqual(scottIds, ["pkt_report_to_scott", "pkt_status_to_scott"]);

    // librarian sees only REPORT (STATUS is not actionable).
    const librarianActive = getActivePacketsForMission(ws, card.mission_id, "librarian", { now });
    assert.equal(librarianActive.length, 1);
    assert.equal(librarianActive[0]?.packet_id, "pkt_report_to_librarian");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("getActivePacketsForMission: respects custom actionableTypesForRole override", () => {
  const ws = makeWorkspace();
  try {
    const { card, layout } = makeMission(ws, "dogfood", "custom-actionable");
    const now = new Date("2026-06-17T00:00:00.000Z");
    appendPacketLedger(ws, layout, entry({
      mission_id: card.mission_id,
      packet_id: "pkt_status",
      to: "topology-supervisor",
      type: "STATUS",
      last_seen_at: now.toISOString(),
    }));
    // Default supervisor sees STATUS, but custom override excludes it.
    const active = getActivePacketsForMission(ws, card.mission_id, "topology-supervisor", {
      now,
      actionableTypesForRole: () => new Set<PacketType>(["REPORT"]),
    });
    assert.equal(active.length, 0);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("getActivePacketsForMission: full filter (mission + role + state + type) intersection", () => {
  const ws = makeWorkspace();
  try {
    const { card, layout } = makeMission(ws, "dogfood", "intersection");
    const now = new Date("2026-06-17T00:00:00.000Z");
    // 1. Active packet, right role, right type → included
    appendPacketLedger(ws, layout, entry({ mission_id: card.mission_id, packet_id: "pkt_match", to: "hq", type: "REPORT" }));
    // 2. Wrong role → excluded
    appendPacketLedger(ws, layout, entry({ mission_id: card.mission_id, packet_id: "pkt_wrong_role", to: "runner", type: "REPORT" }));
    // 3. Right role, but closed → excluded
    appendPacketLedger(ws, layout, entry({ mission_id: card.mission_id, packet_id: "pkt_closed", to: "hq", type: "REPORT", state: "closed" }));
    // 4. Right role, but stale → excluded
    appendPacketLedger(ws, layout, entry({ mission_id: card.mission_id, packet_id: "pkt_stale", to: "hq", type: "REPORT", state: "stale" }));

    const active = getActivePacketsForMission(ws, card.mission_id, "hq", { now });
    assert.equal(active.length, 1);
    assert.equal(active[0]?.packet_id, "pkt_match");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("isActionableForRecipient: STATUS → librarian is NOT actionable (slice 4.1)", () => {
  const e = entry({ mission_id: "m", to: "librarian", type: "STATUS" });
  assert.equal(isActionableForRecipient(e), false);
  assert.equal(
    isActionableForRecipient(e, defaultActionableTypesForRole),
    false,
  );
});

test("isActionableForRecipient: STATUS → scott IS actionable (slice 4.1)", () => {
  const e = entry({ mission_id: "m", to: "scott", type: "STATUS" });
  assert.equal(isActionableForRecipient(e), true);
});

test("isActionableForRecipient: INCIDENT → repair is NOT actionable (repair doesn't see INCIDENT)", () => {
  // repair actionable: REQUEST / ACK / VERDICT. INCIDENT not in set.
  const e = entry({ mission_id: "m", to: "repair", type: "INCIDENT" });
  assert.equal(isActionableForRecipient(e), false);
});

test("isActionableForRecipient: REQUEST → repair IS actionable (REQUEST is repair's type)", () => {
  const e = entry({ mission_id: "m", to: "repair", type: "REQUEST" });
  assert.equal(isActionableForRecipient(e), true);
});

test("getAllActivePacketsForMission: STATUS → librarian excluded (slice 4.1 leak fix)", () => {
  const ws = makeWorkspace();
  try {
    const { card, layout } = makeMission(ws, "dogfood", "all-active-leak");
    const now = new Date("2026-06-17T00:00:00.000Z");
    appendPacketLedger(ws, layout, entry({ mission_id: card.mission_id, packet_id: "pkt_status_to_librarian", to: "librarian", type: "STATUS", last_seen_at: now.toISOString() }));
    appendPacketLedger(ws, layout, entry({ mission_id: card.mission_id, packet_id: "pkt_report_to_librarian", to: "librarian", type: "REPORT", last_seen_at: now.toISOString() }));
    appendPacketLedger(ws, layout, entry({ mission_id: card.mission_id, packet_id: "pkt_status_to_scott", to: "scott", type: "STATUS", last_seen_at: now.toISOString() }));

    const all = getAllActivePacketsForMission(ws, card.mission_id, { now });
    // Excluded: STATUS → librarian (not actionable)
    // Included: REPORT → librarian, STATUS → scott
    assert.equal(all.length, 2);
    const ids = all.map((p) => p.packet_id).sort();
    assert.deepEqual(ids, ["pkt_report_to_librarian", "pkt_status_to_scott"]);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("populatePendingPacketCountForMission: STATUS → librarian does NOT inflate count (slice 4.1)", () => {
  const ws = makeWorkspace();
  try {
    const { card, layout } = makeMission(ws, "dogfood", "pending-count-leak");
    const now = new Date("2026-06-17T00:00:00.000Z");
    // Not actionable for librarian: STATUS
    appendPacketLedger(ws, layout, entry({ mission_id: card.mission_id, packet_id: "pkt_status_l", to: "librarian", type: "STATUS", last_seen_at: now.toISOString() }));
    // Actionable for librarian: REPORT
    appendPacketLedger(ws, layout, entry({ mission_id: card.mission_id, packet_id: "pkt_report_l", to: "librarian", type: "REPORT", last_seen_at: now.toISOString() }));
    // Actionable for scott: STATUS
    appendPacketLedger(ws, layout, entry({ mission_id: card.mission_id, packet_id: "pkt_status_s", to: "scott", type: "STATUS", last_seen_at: now.toISOString() }));

    const result = populatePendingPacketCountForMission(ws, card.mission_id, now);
    // 2 actionable: pkt_report_l + pkt_status_s
    // NOT counted: pkt_status_l (librarian doesn't act on STATUS)
    assert.equal(result?.pending_packet_count, 2);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("populatePendingPacketCountForMission: terminal/stale excluded as before, plus actionable check", () => {
  const ws = makeWorkspace();
  try {
    const { card, layout } = makeMission(ws, "dogfood", "count-mix-actionable");
    const now = new Date("2026-06-17T00:00:00.000Z");
    // Active + actionable → count
    appendPacketLedger(ws, layout, entry({ mission_id: card.mission_id, packet_id: "pkt_1", state: "delivered", to: "topology-supervisor", type: "REPORT", last_seen_at: now.toISOString() }));
    // Active + actionable → count
    appendPacketLedger(ws, layout, entry({ mission_id: card.mission_id, packet_id: "pkt_2", state: "acknowledged", to: "topology-supervisor", type: "REPORT", last_seen_at: now.toISOString() }));
    // Active + NOT actionable (librarian/STATUS) → NOT count
    appendPacketLedger(ws, layout, entry({ mission_id: card.mission_id, packet_id: "pkt_3_actionable_check", state: "in_progress", to: "librarian", type: "STATUS", last_seen_at: now.toISOString() }));
    // Terminal → not count
    appendPacketLedger(ws, layout, entry({ mission_id: card.mission_id, packet_id: "pkt_4", state: "closed", to: "topology-supervisor", type: "REPORT", last_seen_at: now.toISOString() }));
    // Stale-by-freshness → stale_count
    appendPacketLedger(ws, layout, entry({ mission_id: card.mission_id, packet_id: "pkt_5", state: "delivered", to: "topology-supervisor", type: "REPORT", last_seen_at: "2026-06-16T00:00:00.000Z" }));

    const result = populatePendingPacketCountForMission(ws, card.mission_id, now);
    assert.equal(result?.pending_packet_count, 2); // pkt_1 + pkt_2 (pkt_3 is not actionable)
    assert.equal(result?.active_count, 2);
    assert.equal(result?.stale_count, 1); // pkt_5
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("populatePendingPacketCountForMission: actionableTypesForRole override is honored (slice 4.1)", () => {
  const ws = makeWorkspace();
  try {
    const { card, layout } = makeMission(ws, "dogfood", "override-honor");
    const now = new Date("2026-06-17T00:00:00.000Z");
    appendPacketLedger(ws, layout, entry({ mission_id: card.mission_id, packet_id: "pkt_x", to: "topology-supervisor", type: "STATUS", last_seen_at: now.toISOString() }));
    // Default: supervisor sees STATUS → count = 1.
    let result = populatePendingPacketCountForMission(ws, card.mission_id, now);
    assert.equal(result?.pending_packet_count, 1);
    // Override: supervisor's actionable types excludes STATUS → count = 0.
    result = populatePendingPacketCountForMission(ws, card.mission_id, now, DEFAULT_STALE_THRESHOLD_MS, () => new Set<PacketType>(["REPORT"]));
    assert.equal(result?.pending_packet_count, 0);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("populatePendingPacketCountForMission: wrong-mission entries do NOT inflate count (slice 4.2)", () => {
  const ws = makeWorkspace();
  try {
    const { card, layout } = makeMission(ws, "dogfood", "wrong-mission");
    const now = new Date("2026-06-17T00:00:00.000Z");
    // One valid entry in this Mission's ledger.
    appendPacketLedger(ws, layout, entry({
      mission_id: card.mission_id,
      packet_id: "pkt_valid",
      to: "topology-supervisor",
      type: "REPORT",
      last_seen_at: now.toISOString(),
    }));
    // Stray entry with a DIFFERENT mission_id (e.g., compactor bug or
    // manual edit). Per spec §7 line 531, the per-Mission pending count
    // must not include this — it would be visible to a different Mission's
    // active reads, not this one's.
    const wrongMissionId = `${card.mission_id}-other`;
    appendPacketLedger(ws, layout, entry({
      mission_id: wrongMissionId,
      packet_id: "pkt_wrong_mission",
      to: "topology-supervisor",
      type: "REPORT",
      last_seen_at: now.toISOString(),
    }));
    const result = populatePendingPacketCountForMission(ws, card.mission_id, now);
    // Only the valid entry is counted; the wrong-mission entry is filtered
    // out by the mission_id guard added in slice 4.2.
    assert.equal(result?.pending_packet_count, 1);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("getAllActivePacketsForMission: counts across all roles", () => {
  const ws = makeWorkspace();
  try {
    const { card, layout } = makeMission(ws, "dogfood", "all-roles");
    const now = new Date("2026-06-17T00:00:00.000Z");
    appendPacketLedger(ws, layout, entry({ mission_id: card.mission_id, packet_id: "pkt_a", to: "hq" }));
    appendPacketLedger(ws, layout, entry({ mission_id: card.mission_id, packet_id: "pkt_b", to: "topology-supervisor" }));
    appendPacketLedger(ws, layout, entry({ mission_id: card.mission_id, packet_id: "pkt_c", to: "runner" }));
    appendPacketLedger(ws, layout, entry({ mission_id: card.mission_id, packet_id: "pkt_d", to: "runner", state: "closed" }));
    const all = getAllActivePacketsForMission(ws, card.mission_id, { now });
    assert.equal(all.length, 3);
    const ids = all.map((p) => p.packet_id).sort();
    assert.deepEqual(ids, ["pkt_a", "pkt_b", "pkt_c"]);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// compileRawPacketToLedger (compactor helper)
// ---------------------------------------------------------------------------

test("compileRawPacketToLedger maps a raw observation to a ledger entry", () => {
  const raw: RawPacketObservation = {
    packet_id: "pkt_raw_001",
    type: "REPORT",
    from: "hq",
    to: "topology-supervisor",
    raw_path: "/tmp/pi-topology-x/packets/outbox.jsonl",
    timestamp: "2026-06-17T00:00:00.000Z",
  };
  const entry = compileRawPacketToLedger(raw, "m-001", new Date("2026-06-17T00:00:00.000Z"));
  assert.equal(entry.packet_id, "pkt_raw_001");
  assert.equal(entry.mission_id, "m-001");
  assert.equal(entry.type, "REPORT");
  assert.equal(entry.from, "hq");
  assert.equal(entry.to, "topology-supervisor");
  assert.equal(entry.state, "delivered"); // default
  assert.equal(entry.raw_transport_path, raw.raw_path);
  assert.equal(entry.first_seen_at, raw.timestamp);
  assert.equal(entry.last_seen_at, raw.timestamp);
  assert.match(entry.classification_reason, /m-001/);
  assert.equal(entry.request_msg_id, null);
  assert.equal(entry.correlation_id, null);
  assert.equal(entry.artifact_path, null);
});

test("compileRawPacketToLedger honors state_hint and optional correlation fields", () => {
  const raw: RawPacketObservation = {
    packet_id: "pkt_raw_002",
    type: "REQUEST",
    from: "topology-supervisor",
    to: "runner",
    request_msg_id: "msg_001",
    correlation_id: "corr_001",
    raw_path: "/tmp/x",
    timestamp: "2026-06-17T00:00:00.000Z",
    state_hint: "queued",
  };
  const entry = compileRawPacketToLedger(raw, "m-001");
  assert.equal(entry.state, "queued");
  assert.equal(entry.request_msg_id, "msg_001");
  assert.equal(entry.correlation_id, "corr_001");
});

// ---------------------------------------------------------------------------
// populatePendingPacketCountForMission
// ---------------------------------------------------------------------------

test("populatePendingPacketCountForMission returns null for unknown Mission", () => {
  const ws = makeWorkspace();
  try {
    assert.equal(populatePendingPacketCountForMission(ws, "ghost"), null);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("populatePendingPacketCountForMission returns null when no registry exists", () => {
  const ws = makeWorkspace();
  try {
    assert.equal(populatePendingPacketCountForMission(ws, "any"), null);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("populatePendingPacketCountForMission: empty ledger → pending_packet_count = 0", () => {
  const ws = makeWorkspace();
  try {
    const { card } = makeMission(ws, "dogfood", "empty-packets");
    const result = populatePendingPacketCountForMission(ws, card.mission_id);
    assert.ok(result);
    assert.equal(result?.pending_packet_count, 0);
    assert.equal(result?.active_count, 0);
    assert.equal(result?.stale_count, 0);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("populatePendingPacketCountForMission: counts active packets and excludes terminal/stale", () => {
  const ws = makeWorkspace();
  try {
    const { card, layout } = makeMission(ws, "dogfood", "count-mix");
    const now = new Date("2026-06-17T00:00:00.000Z");
    // 3 active (delivered / acknowledged / in_progress)
    appendPacketLedger(ws, layout, entry({ mission_id: card.mission_id, packet_id: "pkt_1", state: "delivered", last_seen_at: now.toISOString() }));
    appendPacketLedger(ws, layout, entry({ mission_id: card.mission_id, packet_id: "pkt_2", state: "acknowledged", last_seen_at: now.toISOString() }));
    appendPacketLedger(ws, layout, entry({ mission_id: card.mission_id, packet_id: "pkt_3", state: "in_progress", last_seen_at: now.toISOString() }));
    // 2 terminal (closed, ignored)
    appendPacketLedger(ws, layout, entry({ mission_id: card.mission_id, packet_id: "pkt_4", state: "closed", last_seen_at: now.toISOString() }));
    appendPacketLedger(ws, layout, entry({ mission_id: card.mission_id, packet_id: "pkt_5", state: "ignored", last_seen_at: now.toISOString() }));
    // 1 stale (active state but old last_seen_at)
    appendPacketLedger(ws, layout, entry({
      mission_id: card.mission_id,
      packet_id: "pkt_6",
      state: "delivered",
      last_seen_at: "2026-06-16T00:00:00.000Z",
    }));
    const result = populatePendingPacketCountForMission(ws, card.mission_id, now);
    assert.ok(result);
    assert.equal(result?.pending_packet_count, 3); // 3 active
    assert.equal(result?.active_count, 3);
    assert.equal(result?.stale_count, 1); // pkt_6 is stale-by-freshness

    // Registry entry updated.
    const reg = readMissionRegistry(ws);
    const registryEntry = reg?.missions.find((m) => m.mission_id === card.mission_id);
    assert.equal(registryEntry?.pending_packet_count, 3);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("populatePendingPacketCountForMission is idempotent", () => {
  const ws = makeWorkspace();
  try {
    const { card, layout } = makeMission(ws, "dogfood", "idempotent-packets");
    const now = new Date("2026-06-17T00:00:00.000Z");
    appendPacketLedger(ws, layout, entry({ mission_id: card.mission_id, packet_id: "pkt_1", state: "delivered", last_seen_at: now.toISOString() }));
    const r1 = populatePendingPacketCountForMission(ws, card.mission_id, now);
    const r2 = populatePendingPacketCountForMission(ws, card.mission_id, now);
    assert.ok(r1 && r2);
    assert.equal(r1?.pending_packet_count, r2?.pending_packet_count);
    assert.equal(r2?.previous_pending_packet_count, 1);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("populatePendingPacketCountForMission: count is independent of recipient role (any role counts)", () => {
  const ws = makeWorkspace();
  try {
    const { card, layout } = makeMission(ws, "dogfood", "all-recipients");
    const now = new Date("2026-06-17T00:00:00.000Z");
    appendPacketLedger(ws, layout, entry({ mission_id: card.mission_id, packet_id: "pkt_hq", to: "hq", state: "delivered", last_seen_at: now.toISOString() }));
    appendPacketLedger(ws, layout, entry({ mission_id: card.mission_id, packet_id: "pkt_runner", to: "runner", state: "delivered", last_seen_at: now.toISOString() }));
    const result = populatePendingPacketCountForMission(ws, card.mission_id, now);
    assert.equal(result?.pending_packet_count, 2);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
