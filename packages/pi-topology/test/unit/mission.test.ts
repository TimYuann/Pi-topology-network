import assert from "node:assert/strict";
import test from "node:test";
import {
  createInitialStatusBoard,
  createMissionDraft,
  runWatchdogCheck,
  validateMissionCard,
} from "../../src/runtime/mission.ts";

test("creates a valid Pi dynamic-spawn mission draft with an owner gate", () => {
  const draft = createMissionDraft({
    project: "OMP拓扑网络",
    workdir: "/work/project",
    objective: "Dogfood Pi topology package",
    allowed_paths: ["/work/project/packages/pi-topology"],
  });

  assert.equal(draft.runtime, "pi");
  assert.equal(draft.entry_role, "topology-supervisor");
  assert.equal(draft.mode, "dynamic-spawn");
  assert.equal(draft.progress.status, "awaiting_owner_confirmation");
  assert.equal(draft.progress.percent, 5);
  assert.equal(draft.session_ledger_path, ".pi/topology/sessions.jsonl");
  assert.deepEqual(draft.progress.completed_steps, ["mission_drafted"]);
  assert.equal(draft.progress.pending_steps.includes("start_topology_supervisor"), true);
  assert.equal(draft.roles.hq.spawn_policy, "required_after_mission_approval");
  assert.equal(draft.roles.librarian.spawn_policy, "on_demand");
  assert.equal(draft.roles.librarian.write_policy, "read_only");
  assert.equal(draft.roles.scott.spawn_policy, "on_demand");
  assert.equal(draft.roles.scott.write_policy, "read_only");
  assert.equal(validateMissionCard(draft).ok, true);

  const board = createInitialStatusBoard(draft);
  assert.equal(board.runtime_phase, "intake");
  assert.equal(board.next_gate.owner_required, true);
  assert.equal(board.peer_status["topology-supervisor"].state, "entry");
  assert.equal(board.peer_status.hq.state, "not_spawned");
  assert.equal(board.peer_status.librarian.state, "not_spawned");
  assert.equal(board.peer_status.scott.state, "not_spawned");
});

test("rejects mission cards that omit required authority and path fields", () => {
  const result = validateMissionCard({
    mission_id: "bad",
    runtime: "pi",
    entry_role: "hq",
    mode: "dynamic-spawn",
    allowed_paths: [],
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /entry_role must be topology-supervisor/);
  assert.match(result.errors.join("\n"), /allowed_paths must be a non-empty array/);
  assert.match(result.errors.join("\n"), /workdir is required/);
  assert.match(result.errors.join("\n"), /progress is required/);
});

test("watchdog reports owner gate, missing checkpoint, and overdue packet", () => {
  const draft = createMissionDraft({
    project: "dogfood",
    workdir: "/work/project",
    objective: "Watchdog proof",
    allowed_paths: ["/work/project/docs"],
  });
  const board = createInitialStatusBoard(draft);
  board.pending_packets.push({
    packet_id: "pkt_1",
    type: "REQUEST",
    deadline_at: "2026-06-16T00:00:00.000Z",
  });

  const result = runWatchdogCheck(board, [], new Date("2026-06-16T00:10:00.000Z"));
  assert.equal(result.summary_status, "attention_required");
  assert.deepEqual(
    result.findings.map((finding) => finding.type).sort(),
    ["checkpoint_missing", "owner_gate", "packet_overdue"],
  );
});

test("watchdog ignores non-active control packets when checking overdue pending work", () => {
  const draft = createMissionDraft({
    project: "dogfood",
    workdir: "/work/project",
    objective: "Ignore old control packet noise",
    allowed_paths: ["/work/project/docs"],
  });
  const board = createInitialStatusBoard(draft);
  board.last_checkpoint_at = "2026-06-16T00:00:00.000Z";
  board.next_gate.owner_required = false;
  board.pending_packets.push(
    {
      packet_id: "pkt_status",
      type: "STATUS",
      state: "delivered",
      deadline_at: "2026-06-16T00:00:00.000Z",
    },
    {
      packet_id: "pkt_verdict",
      type: "VERDICT",
      state: "delivered",
      deadline_at: "2026-06-16T00:00:00.000Z",
    },
  );

  const result = runWatchdogCheck(board, [], new Date("2026-06-16T00:10:00.000Z"));

  assert.equal(result.summary_status, "ok");
  assert.deepEqual(result.findings, []);
});
