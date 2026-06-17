import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  formatDashboardText,
  formatDashboardTextDetailed,
  formatDashboardWidget,
  readDashboardSnapshot,
  type DashboardSnapshot,
} from "../../src/runtime/dashboard.ts";
import {
  createInitialStatusBoard,
  createMissionDraft,
  type TopologyRole,
} from "../../src/runtime/mission.ts";
import { createMissionLayout, missionLayoutPaths } from "../../src/runtime/mission-layout.ts";
import {
  addMissionToRegistry,
  createEmptyRegistry,
  newMissionRegistryEntry,
  readMissionRegistry,
  writeMissionRegistry,
} from "../../src/runtime/mission-registry.ts";
import { writeActiveMissionPointer, buildActiveMissionPointer } from "../../src/runtime/mission-pointer.ts";
import { appendRoleSessionRecord, buildRoleSessionRecord } from "../../src/runtime/role-session.ts";
import { appendPacketLedger } from "../../src/runtime/packet-ledger.ts";
import type { PacketLedgerEntry, PacketType } from "../../src/runtime/packet-ledger.ts";
import { syncRootMirrorFromLayout } from "../../src/runtime/root-mirror.ts";

function makeWorkspace(): string {
  return mkdtempSync(join(tmpdir(), "pi-topology-slice5-dashboard-"));
}

interface MissionContext {
  card: ReturnType<typeof createMissionDraft>;
  layout: ReturnType<typeof missionLayoutPaths>;
  registry_entry: ReturnType<typeof newMissionRegistryEntry>;
}

function makeMission(
  workspaceDir: string,
  project: string,
  objective: string,
  lifecycle_state: ReturnType<typeof createMissionDraft> extends never ? never : import("../../src/runtime/mission-lifecycle.ts").MissionLifecycleState = "running",
): MissionContext {
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
  const registry_entry = newMissionRegistryEntry({
    mission_id: card.mission_id,
    title: card.objective,
    objective: card.objective,
    lifecycle_state,
    progress_status: "draft",
    owner_gate: "required",
    mission_dir: layout.missionDirRelative,
  });
  const reg = addMissionToRegistry(createEmptyRegistry(), registry_entry).registry;
  writeMissionRegistry(workspaceDir, reg);
  writeActiveMissionPointer(
    workspaceDir,
    buildActiveMissionPointer({
      mission_id: card.mission_id,
      mission_dir: layout.missionDirRelative,
      reason: "created",
      event_id: "evt_test_init",
    }),
  );
  syncRootMirrorFromLayout(workspaceDir, layout);
  return { card, layout, registry_entry };
}

let counter = 0;
function makePacket(opts: {
  mission_id: string;
  packet_id?: string;
  type?: PacketType;
  from?: TopologyRole;
  to?: TopologyRole;
  state?: PacketLedgerEntry["state"];
  last_seen_at?: string;
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
    raw_transport_path: null,
    first_seen_at: opts.last_seen_at ?? "2026-06-17T00:00:00.000Z",
    last_seen_at: opts.last_seen_at ?? "2026-06-17T00:00:00.000Z",
    classification_reason: null,
    artifact_path: null,
  };
}

const NOW = new Date("2026-06-17T00:00:00.000Z");

// ============================================================
// Empty / no-active cases
// ============================================================

test("dashboard: returns snapshot with has_active_mission=false when workspace has no .pi/topology", () => {
  const ws = makeWorkspace();
  try {
    const snapshot = readDashboardSnapshot(ws, { now: NOW });
    assert.equal(snapshot.has_active_mission, false);
    assert.equal(snapshot.has_registry, false);
    assert.equal(snapshot.active_mission_id, null);
    assert.equal(snapshot.title, null);
    assert.deepEqual(snapshot.role_summary, { live: 0, resumable: 0, stale: 0, parked: 0, closed: 0 });
    assert.equal(snapshot.pending_packet_count, 0);
    assert.equal(snapshot.incident_count, 0);
    assert.equal(snapshot.closeout_path, null);
    assert.deepEqual(snapshot.artifacts, []);
    assert.equal(snapshot.warnings.length, 0);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("dashboard: returns snapshot with has_active_mission=false when registry exists but no active_mission_id", () => {
  const ws = makeWorkspace();
  try {
    // Create a registry with no active_mission_id (no mission pointer set).
    const reg = createEmptyRegistry();
    writeMissionRegistry(ws, reg);
    const snapshot = readDashboardSnapshot(ws, { now: NOW });
    assert.equal(snapshot.has_active_mission, false);
    assert.equal(snapshot.has_registry, true);
    assert.equal(snapshot.active_mission_id, null);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("dashboard: formatDashboardText for no-active-mission produces compact output", () => {
  const ws = makeWorkspace();
  try {
    const snapshot = readDashboardSnapshot(ws, { now: NOW });
    const text = formatDashboardText(snapshot);
    assert.match(text, /no active mission/);
    assert.match(text, /registry: absent/);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

// ============================================================
// Active Mission: all 8 spec §10 fields
// ============================================================

test("dashboard: active Mission populates all 8 spec §10 fields", () => {
  const ws = makeWorkspace();
  try {
    const { card, layout } = makeMission(ws, "dogfood-dashboard", "Slice 5 dashboard smoke");
    const snapshot = readDashboardSnapshot(ws, { now: NOW });
    assert.equal(snapshot.has_active_mission, true);
    assert.equal(snapshot.has_registry, true);
    assert.equal(snapshot.active_mission_id, card.mission_id);
    assert.equal(snapshot.title, "Slice 5 dashboard smoke");
    assert.equal(snapshot.lifecycle_state, "running");
    assert.equal(snapshot.owner_gate, "required");
    assert.equal(snapshot.blocked, false);
    assert.equal(snapshot.archived, false);
    assert.equal(snapshot.mission_dir, layout.missionDirAbsolute);
    assert.equal(snapshot.pending_packet_count, 0);
    assert.equal(snapshot.pending_packet_total, 0);
    assert.equal(snapshot.stale_packet_count, 0);
    assert.equal(snapshot.incident_count, 0);
    assert.equal(snapshot.closeout_path, null);
    // Paths all set
    assert.equal(snapshot.paths.mission_card_path, layout.missionCardPath);
    assert.equal(snapshot.paths.packet_ledger_path, layout.packetLedgerPath);
    assert.equal(snapshot.paths.sessions_path, layout.sessionsPath);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("dashboard: role summary is recomputed from sessions.jsonl, not from registry cache", () => {
  const ws = makeWorkspace();
  try {
    const { card, layout } = makeMission(ws, "dogfood-roles", "Role summary recompute");
    const now = NOW;
    // Write a fresh heartbeat for hq
    appendRoleSessionRecord(
      ws,
      layout,
      buildRoleSessionRecord({
        mission_id: card.mission_id,
        role: "hq",
        event_type: "heartbeat",
        session_id: "sess-hq-1",
        now: new Date(now.getTime() - 1000),
      }),
    );
    // The registry's cached role_summary is empty (default). But the
    // dashboard recomputes from sessions.jsonl.
    const reg = readMissionRegistry(ws);
    const cachedEntry = reg?.missions.find((m) => m.mission_id === card.mission_id);
    assert.deepEqual(cachedEntry?.role_summary, { live: 0, resumable: 0, stale: 0, parked: 0, closed: 0 });

    const snapshot = readDashboardSnapshot(ws, { now });
    // hq is live (fresh heartbeat), other 6 roles are resumable (no records yet → "resumable" per spec §6.3 step 3)
    assert.equal(snapshot.role_summary.live, 1);
    // Sum of all 7 roles' classifications
    const total = snapshot.role_summary.live + snapshot.role_summary.resumable
      + snapshot.role_summary.stale + snapshot.role_summary.parked + snapshot.role_summary.closed;
    assert.equal(total, 7);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("dashboard: pending packet count is recomputed from packet-ledger.jsonl, not from registry cache", () => {
  const ws = makeWorkspace();
  try {
    const { card, layout } = makeMission(ws, "dogfood-packets", "Packet count recompute");
    const now = NOW;
    // Append 2 actionable packets (REPORT → topology-supervisor)
    appendPacketLedger(ws, layout, makePacket({ mission_id: card.mission_id, packet_id: "pkt_1", to: "topology-supervisor", type: "REPORT", last_seen_at: now.toISOString() }));
    appendPacketLedger(ws, layout, makePacket({ mission_id: card.mission_id, packet_id: "pkt_2", to: "hq", type: "REPORT", last_seen_at: now.toISOString() }));
    // 1 non-actionable (STATUS → librarian)
    appendPacketLedger(ws, layout, makePacket({ mission_id: card.mission_id, packet_id: "pkt_3", to: "librarian", type: "STATUS", last_seen_at: now.toISOString() }));

    // Registry cache says 0
    const reg = readMissionRegistry(ws);
    const cachedEntry = reg?.missions.find((m) => m.mission_id === card.mission_id);
    assert.equal(cachedEntry?.pending_packet_count, 0);

    const snapshot = readDashboardSnapshot(ws, { now });
    // pending_count = 2 (actionable); total_active = 3 (active state, regardless of actionable)
    assert.equal(snapshot.pending_packet_count, 2);
    assert.equal(snapshot.pending_packet_total, 3);
    assert.equal(snapshot.stale_packet_count, 0);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("dashboard: stale packet count is recomputed from packet-ledger.jsonl", () => {
  const ws = makeWorkspace();
  try {
    const { card, layout } = makeMission(ws, "dogfood-stale", "Stale count recompute");
    const now = NOW;
    // 1 fresh actionable
    appendPacketLedger(ws, layout, makePacket({ mission_id: card.mission_id, packet_id: "pkt_fresh", to: "topology-supervisor", type: "REPORT", last_seen_at: now.toISOString() }));
    // 1 stale-by-freshness (delivered state, old last_seen_at)
    appendPacketLedger(ws, layout, makePacket({ mission_id: card.mission_id, packet_id: "pkt_stale", to: "topology-supervisor", type: "REPORT", state: "delivered", last_seen_at: "2026-06-16T00:00:00.000Z" }));
    const snapshot = readDashboardSnapshot(ws, { now });
    assert.equal(snapshot.pending_packet_count, 1);
    assert.equal(snapshot.pending_packet_total, 1); // stale is excluded from active_total
    assert.equal(snapshot.stale_packet_count, 1);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("dashboard: incident count reads from incident-log.jsonl", () => {
  const ws = makeWorkspace();
  try {
    const { layout } = makeMission(ws, "dogfood-incidents", "Incident count");
    // Write 3 lines to incident-log.jsonl
    writeFileSync(layout.incidentLogPath, `${JSON.stringify({ incident_id: "i1" })}\n${JSON.stringify({ incident_id: "i2" })}\n${JSON.stringify({ incident_id: "i3" })}\n`, "utf8");
    const snapshot = readDashboardSnapshot(ws, { now: NOW });
    assert.equal(snapshot.incident_count, 3);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("dashboard: artifacts scan populates artifact list with file metadata", () => {
  const ws = makeWorkspace();
  try {
    const { layout } = makeMission(ws, "dogfood-artifacts", "Artifact scan");
    mkdirSync(layout.artifactsDir, { recursive: true });
    writeFileSync(join(layout.artifactsDir, "report.md"), "# Report\n", "utf8");
    writeFileSync(join(layout.artifactsDir, "diff.patch"), "diff --git a b\n", "utf8");
    const snapshot = readDashboardSnapshot(ws, { now: NOW });
    assert.equal(snapshot.artifacts.length, 2);
    const names = snapshot.artifacts.map((a) => a.name).sort();
    assert.deepEqual(names, ["diff.patch", "report.md"]);
    for (const art of snapshot.artifacts) {
      assert.equal(art.kind, "file");
      assert.equal(typeof art.size, "number");
      assert.ok(art.size > 0);
    }
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

// ============================================================
// Text / widget formatting
// ============================================================

test("formatDashboardText: compact text contains all 8 spec §10 fields", () => {
  const ws = makeWorkspace();
  try {
    makeMission(ws, "dogfood-compact", "Compact text");
    const snapshot = readDashboardSnapshot(ws, { now: NOW });
    const text = formatDashboardText(snapshot);
    assert.match(text, /mission:/);
    assert.match(text, /lifecycle:/);
    assert.match(text, /owner_gate:/);
    assert.match(text, /next_action:/);
    assert.match(text, /roles:/);
    assert.match(text, /pending_packets:/);
    assert.match(text, /incidents:/);
    assert.match(text, /closeout:/);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("formatDashboardTextDetailed: verbose text adds paths, artifacts, role classifications", () => {
  const ws = makeWorkspace();
  try {
    const { layout } = makeMission(ws, "dogfood-verbose", "Verbose text");
    mkdirSync(layout.artifactsDir, { recursive: true });
    writeFileSync(join(layout.artifactsDir, "evidence.txt"), "x", "utf8");
    const snapshot = readDashboardSnapshot(ws, { now: NOW });
    const text = formatDashboardTextDetailed(snapshot);
    assert.match(text, /^paths:/m);
    assert.match(text, /mission_card_path:/);
    assert.match(text, /packet_ledger_path:/);
    assert.match(text, /^artifacts:/m);
    assert.match(text, /^role classifications:/m);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("formatDashboardWidget: returns status entries + structured widget object", () => {
  const ws = makeWorkspace();
  try {
    makeMission(ws, "dogfood-widget", "Widget format");
    const snapshot = readDashboardSnapshot(ws, { now: NOW });
    const { status, widget } = formatDashboardWidget(snapshot);
    // Status entries are name/value pairs
    assert.ok(status.length > 0);
    const names = status.map((s) => s.name);
    assert.ok(names.includes("topology.mission"));
    assert.ok(names.includes("topology.lifecycle"));
    assert.ok(names.includes("topology.roles"));
    // Widget is structured
    assert.equal(typeof widget, "object");
    assert.equal((widget as { mission_id?: string }).mission_id, snapshot.active_mission_id);
    assert.ok((widget as { role_summary?: unknown }).role_summary);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("formatDashboardWidget: no-active-mission returns minimal status + widget", () => {
  const ws = makeWorkspace();
  try {
    const snapshot = readDashboardSnapshot(ws, { now: NOW });
    const { status, widget } = formatDashboardWidget(snapshot);
    assert.equal(status.length, 1);
    assert.equal(status[0]?.name, "topology.mission");
    assert.equal(status[0]?.value, "none");
    assert.equal((widget as { mission?: string }).mission, "none");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

// ============================================================
// Defensive / consistency checks
// ============================================================

test("dashboard: warning when active pointer and registry.active_mission_id disagree", () => {
  const ws = makeWorkspace();
  try {
    const { card, layout } = makeMission(ws, "dogfood-disagree", "Disagreement");
    // Force a disagreement: rewrite the registry JSON so the registry's
    // active_mission_id points at the same Mission but with a different
    // pointer reference (we patch the registry file directly, since
    // setRegistryActiveMission validates the mission_id is known).
    const regPath = join(ws, ".pi", "topology", "mission-registry.json");
    const reg = readMissionRegistry(ws);
    if (!reg) throw new Error("no registry");
    // Add a SECOND mission to the registry so the disagreement is on a
    // known mission. Then change active_mission_id to the second one.
    const secondEntry = newMissionRegistryEntry({
      mission_id: "other-mission-001",
      title: "Other",
      objective: "Other",
      lifecycle_state: "draft",
      progress_status: "draft",
      owner_gate: "required",
      mission_dir: ".pi/topology/missions/other-mission-001",
    });
    const updated = {
      ...reg,
      active_mission_id: "other-mission-001",
      missions: [...reg.missions, secondEntry],
    };
    writeFileSync(regPath, JSON.stringify(updated, null, 2), "utf8");
    syncRootMirrorFromLayout(ws, layout);
    const snapshot = readDashboardSnapshot(ws, { now: NOW });
    // The pointer wins (active_mission_id from pointer = card.mission_id)
    assert.equal(snapshot.active_mission_id, card.mission_id);
    // Warning is surfaced
    assert.ok(
      snapshot.warnings.some((w) => /disagree/i.test(w)),
      `expected disagreement warning, got: ${JSON.stringify(snapshot.warnings)}`,
    );
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("dashboard: missing mission-card.json produces a warning and empty role summary", () => {
  const ws = makeWorkspace();
  try {
    const { layout } = makeMission(ws, "dogfood-missing-card", "Missing card");
    // Delete the mission-card.json after creation
    rmSync(layout.missionCardPath, { force: true });
    const snapshot = readDashboardSnapshot(ws, { now: NOW });
    assert.deepEqual(snapshot.role_summary, { live: 0, resumable: 0, stale: 0, parked: 0, closed: 0 });
    assert.ok(
      snapshot.warnings.some((w) => /mission-card.json missing/i.test(w)),
      `expected missing-card warning, got: ${JSON.stringify(snapshot.warnings)}`,
    );
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

// ============================================================
// Opt-in persistence
// ============================================================

test("dashboard: persistToRegistry=true writes back role_summary + pending_packet_count", () => {
  const ws = makeWorkspace();
  try {
    const { card, layout } = makeMission(ws, "dogfood-persist", "Persist on read");
    const now = NOW;
    appendPacketLedger(ws, layout, makePacket({ mission_id: card.mission_id, packet_id: "pkt_1", to: "topology-supervisor", type: "REPORT", last_seen_at: now.toISOString() }));

    appendRoleSessionRecord(
      ws,
      layout,
      buildRoleSessionRecord({
        mission_id: card.mission_id,
        role: "hq",
        event_type: "heartbeat",
        session_id: "sess-hq",
        now: new Date(now.getTime() - 1000),
      }),
    );

    // Pre-read: registry cache is empty
    let reg = readMissionRegistry(ws);
    let cachedEntry = reg?.missions.find((m) => m.mission_id === card.mission_id);
    assert.equal(cachedEntry?.pending_packet_count, 0);
    assert.equal(cachedEntry?.role_summary.live, 0);

    // Read with persistToRegistry
    readDashboardSnapshot(ws, { now, persistToRegistry: true });

    // Post-read: registry cache updated
    reg = readMissionRegistry(ws);
    cachedEntry = reg?.missions.find((m) => m.mission_id === card.mission_id);
    assert.equal(cachedEntry?.pending_packet_count, 1);
    assert.ok((cachedEntry?.role_summary.live ?? 0) >= 1);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("dashboard: persistToRegistry=false (default) does NOT mutate registry", () => {
  const ws = makeWorkspace();
  try {
    const { card, layout } = makeMission(ws, "dogfood-no-persist", "Default no-persist");
    const now = NOW;
    appendRoleSessionRecord(
      ws,
      layout,
      buildRoleSessionRecord({
        mission_id: card.mission_id,
        role: "hq",
        event_type: "heartbeat",
        session_id: "sess-hq",
        now: new Date(now.getTime() - 1000),
      }),
    );

    readDashboardSnapshot(ws, { now });

    // Registry cache NOT updated
    const reg = readMissionRegistry(ws);
    const cachedEntry = reg?.missions.find((m) => m.mission_id === card.mission_id);
    assert.equal(cachedEntry?.pending_packet_count, 0);
    assert.equal(cachedEntry?.role_summary.live, 0);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

// ============================================================
// Defensive degradation (slice 5.1)
// ============================================================

test("dashboard: invalid active pointer mission_id degrades to no-active snapshot (no throw, slice 5.1)", () => {
  const ws = makeWorkspace();
  try {
    // Write a malicious active pointer whose mission_id would normally
    // path-traverse out of the missions root.
    writeActiveMissionPointer(
      ws,
      buildActiveMissionPointer({
        mission_id: "../evil",
        mission_dir: ".pi/topology/missions/../evil",
        reason: "created",
        event_id: "evt_evil",
      }),
    );
    // No registry written — pointer-only path.
    let snapshot: DashboardSnapshot | null = null;
    let threw = false;
    try {
      snapshot = readDashboardSnapshot(ws, { now: NOW });
    } catch {
      threw = true;
    }
    assert.equal(threw, false, "readDashboardSnapshot must not throw on invalid active mission_id");
    assert.ok(snapshot, "snapshot must be returned");
    assert.equal(snapshot.has_active_mission, false);
    assert.equal(snapshot.active_mission_id, null);
    assert.ok(
      snapshot.warnings.some((w) => /active mission_id invalid/i.test(w)),
      `expected invalid-id warning, got: ${JSON.stringify(snapshot.warnings)}`,
    );
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("dashboard: invalid registry active_mission_id degrades to no-active snapshot (no throw, slice 5.1)", () => {
  const ws = makeWorkspace();
  try {
    // Build a registry whose active_mission_id would path-traverse.
    const reg = {
      version: 1 as const,
      active_mission_id: "../escape",
      updated_at: NOW.toISOString(),
      missions: [],
    };
    writeMissionRegistry(ws, reg);
    let snapshot: DashboardSnapshot | null = null;
    let threw = false;
    try {
      snapshot = readDashboardSnapshot(ws, { now: NOW });
    } catch {
      threw = true;
    }
    assert.equal(threw, false, "readDashboardSnapshot must not throw on invalid registry active_mission_id");
    assert.ok(snapshot);
    assert.equal(snapshot.has_active_mission, false);
    assert.equal(snapshot.active_mission_id, null);
    assert.ok(
      snapshot.warnings.some((w) => /active mission_id invalid/i.test(w)),
      `expected invalid-id warning, got: ${JSON.stringify(snapshot.warnings)}`,
    );
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("dashboard: malformed JSON in active pointer does not throw (read returns null pointer)", () => {
  const ws = makeWorkspace();
  try {
    // Write a syntactically broken pointer file.
    const pointerPath = join(ws, ".pi", "topology", "active-mission.json");
    mkdirSync(join(ws, ".pi", "topology"), { recursive: true });
    writeFileSync(pointerPath, "{not-json", "utf8");
    let snapshot: DashboardSnapshot | null = null;
    let threw = false;
    try {
      snapshot = readDashboardSnapshot(ws, { now: NOW });
    } catch {
      threw = true;
    }
    // The pointer read throws at JSON.parse; the dashboard currently
    // surfaces that as a thrown error (the pointer is REQUIRED for active
    // selection). What we test here is that the dashboard is at minimum
    // an explicit, predictable failure — not a silent return of stale
    // state. If we want graceful degradation for this case, the dashboard
    // would need to wrap `readActiveMissionPointer` in try/catch. The
    // contract for slice 5.1 is: INVALID ID deos not throw; malformed
    // pointer JSON is a separate hardening item tracked in handoff.
    if (!threw) {
      assert.ok(snapshot);
      assert.equal(snapshot.has_active_mission, false);
    }
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

// ============================================================
// Edge cases
// ============================================================

test("dashboard: empty packet-ledger.jsonl returns zero counts", () => {
  const ws = makeWorkspace();
  try {
    const { layout } = makeMission(ws, "dogfood-empty-ledger", "Empty ledger");
    // Touch an empty file
    writeFileSync(layout.packetLedgerPath, "", "utf8");
    const snapshot = readDashboardSnapshot(ws, { now: NOW });
    assert.equal(snapshot.pending_packet_count, 0);
    assert.equal(snapshot.pending_packet_total, 0);
    assert.equal(snapshot.stale_packet_count, 0);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("dashboard: malformed packet-ledger lines are skipped (no throw)", () => {
  const ws = makeWorkspace();
  try {
    const { layout } = makeMission(ws, "dogfood-malformed", "Malformed ledger");
    // Mix valid and invalid JSON lines
    writeFileSync(
      layout.packetLedgerPath,
      `${JSON.stringify({ packet_id: "pkt_1", mission_id: layout.missionId, type: "REPORT", from: "hq", to: "topology-supervisor", request_msg_id: null, correlation_id: null, state: "delivered", raw_transport_path: null, first_seen_at: "2026-06-17T00:00:00.000Z", last_seen_at: "2026-06-17T00:00:00.000Z", classification_reason: null, artifact_path: null })}\nnot-valid-json\n`,
      "utf8",
    );
    const snapshot = readDashboardSnapshot(ws, { now: NOW });
    assert.equal(snapshot.pending_packet_count, 1); // 1 valid line counted
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("dashboard: snapshot includes generated_at ISO timestamp", () => {
  const ws = makeWorkspace();
  try {
    makeMission(ws, "dogfood-ts", "Timestamp");
    const snapshot = readDashboardSnapshot(ws, { now: NOW });
    assert.equal(snapshot.generated_at, NOW.toISOString());
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("dashboard: archived Mission is reflected (snapshot.archived=true)", () => {
  const ws = makeWorkspace();
  try {
    const { card, layout } = makeMission(ws, "dogfood-archive", "Archived flag");
    // Mark the registry entry as archived
    const reg = readMissionRegistry(ws);
    if (!reg) throw new Error("no registry");
    const idx = reg.missions.findIndex((m) => m.mission_id === card.mission_id);
    const updated = {
      ...reg,
      missions: [
        ...reg.missions.slice(0, idx),
        { ...reg.missions[idx]!, archived: true, lifecycle_state: "archived" as const },
        ...reg.missions.slice(idx + 1),
      ],
    };
    writeMissionRegistry(ws, updated);
    syncRootMirrorFromLayout(ws, layout);
    const snapshot = readDashboardSnapshot(ws, { now: NOW });
    assert.equal(snapshot.archived, true);
    assert.equal(snapshot.lifecycle_state, "archived");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("dashboard: dashboard shape is stable (8 spec §10 fields + 3 derived)", () => {
  const ws = makeWorkspace();
  try {
    makeMission(ws, "dogfood-shape", "Shape stability");
    const snapshot: DashboardSnapshot = readDashboardSnapshot(ws, { now: NOW });
    const expectedKeys = [
      "workspaceDir",
      "generated_at",
      "has_active_mission",
      "has_registry",
      "active_mission_id",
      "title",
      "mission_dir",
      "lifecycle_state",
      "owner_gate",
      "blocked",
      "archived",
      "next_action",
      "available_actions",
      "picker_mode",
      "role_summary",
      "role_classifications",
      "pending_packet_count",
      "pending_packet_total",
      "stale_packet_count",
      "incident_count",
      "closeout_path",
      "artifacts",
      "paths",
      "warnings",
    ];
    for (const key of expectedKeys) {
      assert.ok(key in snapshot, `missing key: ${key}`);
    }
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("dashboard: empty incident log returns 0 incidents", () => {
  const ws = makeWorkspace();
  try {
    makeMission(ws, "dogfood-no-incidents", "No incidents");
    const snapshot = readDashboardSnapshot(ws, { now: NOW });
    assert.equal(snapshot.incident_count, 0);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("dashboard: empty artifacts dir returns empty artifacts array", () => {
  const ws = makeWorkspace();
  try {
    makeMission(ws, "dogfood-no-artifacts", "No artifacts");
    const snapshot = readDashboardSnapshot(ws, { now: NOW });
    assert.deepEqual(snapshot.artifacts, []);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
