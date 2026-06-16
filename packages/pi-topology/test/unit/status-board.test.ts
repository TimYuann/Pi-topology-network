import assert from "node:assert/strict";
import test from "node:test";
import { createInitialStatusBoard, createMissionDraft } from "../../src/runtime/mission.ts";
import { createPacket } from "../../src/runtime/packet.ts";
import { applyPacketLifecycle, markMissionProgressForHqLaunch, markRoleAlive, markRoleLaunchRequested, reconcileBoardWithSessionRecords } from "../../src/runtime/status-board.ts";

test("HQ launch clears owner gate and records owner approval", () => {
  const mission = createMissionDraft({
    project: "dogfood",
    workdir: "/work/project",
    objective: "Spawn HQ",
    allowed_paths: ["/work/project"],
  });
  const board = createInitialStatusBoard(mission);

  const next = markRoleLaunchRequested(board, mission, {
    role: "hq",
    scriptPath: "/work/project/.pi/topology/launch/hq.sh",
    now: "2026-06-16T00:00:00.000Z",
  });
  const updatedMission = markMissionProgressForHqLaunch(mission, "2026-06-16T00:00:00.000Z");

  assert.equal(next.next_gate.owner_required, false);
  assert.equal(next.owner_decisions.length, 1);
  assert.equal(next.peer_status.hq.state, "launch_requested");
  assert.equal(next.active_workers.some((worker) => worker.role === "hq"), true);
  assert.equal(updatedMission.progress.status, "running");
  assert.equal(updatedMission.progress.pending_steps.includes("spawn_hq_after_owner_gate"), false);
});

test("role launch and alive updates merge active worker state by role", () => {
  const mission = createMissionDraft({
    project: "dogfood",
    workdir: "/work/project",
    objective: "Spawn workers",
    allowed_paths: ["/work/project"],
  });
  const board = createInitialStatusBoard(mission);
  const withRunner = markRoleLaunchRequested(board, mission, {
    role: "runner",
    scriptPath: "/work/project/.pi/topology/launch/runner.sh",
  });
  const withLibrarian = markRoleLaunchRequested(withRunner, mission, {
    role: "librarian",
    scriptPath: "/work/project/.pi/topology/launch/librarian.sh",
  });
  const aliveRunner = markRoleAlive(withLibrarian, {
    role: "runner",
    sessionId: "runner-123",
    now: "2026-06-16T00:00:01.000Z",
  });

  assert.equal(aliveRunner.active_workers.length, 2);
  assert.equal(aliveRunner.peer_status.runner.state, "alive");
  assert.equal(aliveRunner.peer_status.runner.session_id, "runner-123");
  assert.equal(aliveRunner.peer_status.librarian.state, "launch_requested");
});

test("supervisor restart marks old live peers stale before a resumed run", () => {
  const mission = createMissionDraft({
    project: "dogfood",
    workdir: "/work/project",
    objective: "Resume mission",
    allowed_paths: ["/work/project"],
  });
  const board = createInitialStatusBoard(mission);
  const withRunner = markRoleAlive(board, {
    role: "runner",
    sessionId: "runner-old",
    now: "2026-06-16T00:00:00.000Z",
  });
  const resumed = markRoleAlive(withRunner, {
    role: "topology-supervisor",
    sessionId: "topology-supervisor-new",
    now: "2026-06-16T00:05:00.000Z",
  });

  assert.equal(resumed.peer_status["topology-supervisor"].alive, true);
  assert.equal(resumed.peer_status.runner.state, "stale");
  assert.equal(resumed.peer_status.runner.alive, false);
  assert.equal(resumed.active_workers.find((worker) => worker.role === "runner")?.state, "stale");
});

test("new role start marks old live peers stale before replaying a resumed mesh", () => {
  const mission = createMissionDraft({
    project: "dogfood",
    workdir: "/work/project",
    objective: "Resume mission from HQ",
    allowed_paths: ["/work/project"],
  });
  const board = createInitialStatusBoard(mission);
  const withSupervisor = markRoleAlive(board, {
    role: "topology-supervisor",
    sessionId: "topology-supervisor-old",
    now: "2026-06-16T00:00:00.000Z",
  });
  const resumed = markRoleAlive(withSupervisor, {
    role: "hq",
    sessionId: "hq-new",
    now: "2026-06-16T00:05:00.000Z",
  });

  assert.equal(resumed.peer_status["topology-supervisor"].state, "stale");
  assert.equal(resumed.peer_status["topology-supervisor"].alive, false);
  assert.equal(resumed.peer_status.hq.state, "alive");
  assert.equal(resumed.peer_status.hq.alive, true);
});

test("supervisor restart keeps recently heartbeated peers alive", () => {
  const mission = createMissionDraft({
    project: "dogfood",
    workdir: "/work/project",
    objective: "Resume mission",
    allowed_paths: ["/work/project"],
  });
  const board = createInitialStatusBoard(mission);
  const withRunner = markRoleAlive(board, {
    role: "runner",
    sessionId: "runner-recent",
    now: "2026-06-16T00:00:00.000Z",
  });
  const resumed = markRoleAlive(withRunner, {
    role: "topology-supervisor",
    sessionId: "topology-supervisor-new",
    now: "2026-06-16T00:00:30.000Z",
  });

  assert.equal(resumed.peer_status.runner.state, "alive");
  assert.equal(resumed.peer_status.runner.alive, true);
});

test("session ledger reconciliation restores alive role state after concurrent status-board writes", () => {
  const mission = createMissionDraft({
    project: "dogfood",
    workdir: "/work/project",
    objective: "Spawn workers",
    allowed_paths: ["/work/project"],
  });
  const board = createInitialStatusBoard(mission);
  const launched = markRoleLaunchRequested(board, mission, {
    role: "oracle",
    scriptPath: "/work/project/.pi/topology/launch/oracle.sh",
    now: "2026-06-16T00:00:00.000Z",
  });

  const reconciled = reconcileBoardWithSessionRecords(launched, [
    {
      timestamp: "2026-06-16T00:00:02.000Z",
      role: "oracle",
      state: "alive_confirmed",
      session_id: "oracle-123",
    },
  ]);

  assert.equal(reconciled.peer_status.oracle.state, "alive");
  assert.equal(reconciled.peer_status.oracle.alive, true);
  assert.equal(reconciled.peer_status.oracle.session_id, "oracle-123");
  assert.equal(reconciled.active_workers.find((worker) => worker.role === "oracle")?.state, "alive");
});

test("session ledger reconciliation does not resurrect a stale historical session", () => {
  const mission = createMissionDraft({
    project: "dogfood",
    workdir: "/work/project",
    objective: "Avoid stale replay",
    allowed_paths: ["/work/project"],
  });
  const board = createInitialStatusBoard(mission);
  const oldRunner = markRoleAlive(board, {
    role: "runner",
    sessionId: "runner-old",
    now: "2026-06-16T00:00:00.000Z",
  });
  const resumed = markRoleAlive(oldRunner, {
    role: "hq",
    sessionId: "hq-new",
    now: "2026-06-16T00:05:00.000Z",
  });

  const reconciled = reconcileBoardWithSessionRecords(resumed, [
    {
      timestamp: "2026-06-16T00:00:00.000Z",
      role: "runner",
      state: "alive_confirmed",
      session_id: "runner-old",
    },
    {
      timestamp: "2026-06-16T00:05:00.000Z",
      role: "hq",
      state: "alive_confirmed",
      session_id: "hq-new",
    },
  ]);

  assert.equal(reconciled.peer_status.runner.state, "stale");
  assert.equal(reconciled.peer_status.runner.alive, false);
  assert.equal(reconciled.peer_status.hq.state, "alive");
});

test("packet lifecycle closes a dispatched task only after report acknowledgement", () => {
  const mission = createMissionDraft({
    project: "dogfood",
    workdir: "/work/project",
    objective: "Track packet lifecycle",
    allowed_paths: ["/work/project"],
  });
  const board = createInitialStatusBoard(mission);
  const request = createPacket({
    mission_id: mission.mission_id,
    type: "REQUEST",
    from: "hq",
    to: "runner",
    body: { task: "run smoke" },
  });
  const requestAck = createPacket({
    mission_id: mission.mission_id,
    type: "ACK",
    from: "runner",
    to: "hq",
    body: { received: true },
    request_msg_id: request.packet_id,
  });
  const report = createPacket({
    mission_id: mission.mission_id,
    type: "REPORT",
    from: "runner",
    to: "hq",
    body: { status: "pass" },
    request_msg_id: request.packet_id,
  });
  const reportAck = createPacket({
    mission_id: mission.mission_id,
    type: "ACK",
    from: "hq",
    to: "runner",
    body: { received: true },
    request_msg_id: report.packet_id,
  });

  const sent = applyPacketLifecycle(board, request, { liveDeliveryStatus: "delivered", now: "2026-06-16T00:00:00.000Z" });
  assert.equal(sent.pending_packets.length, 1);
  assert.equal(sent.pending_packets[0].state, "delivered");

  const acknowledged = applyPacketLifecycle(sent, requestAck, { liveDeliveryStatus: "delivered", now: "2026-06-16T00:00:01.000Z" });
  assert.equal(acknowledged.pending_packets[0].state, "acknowledged");
  assert.equal(acknowledged.pending_packets[0].ack_packet_id, requestAck.packet_id);

  const reported = applyPacketLifecycle(acknowledged, report, { liveDeliveryStatus: "delivered", now: "2026-06-16T00:00:02.000Z" });
  assert.equal(reported.pending_packets.find((packet) => packet.packet_id === request.packet_id)?.state, "reported");
  assert.equal(reported.pending_packets.find((packet) => packet.packet_id === request.packet_id)?.report_packet_id, report.packet_id);
  assert.equal(reported.pending_packets.find((packet) => packet.packet_id === report.packet_id)?.state, "reported");

  const closed = applyPacketLifecycle(reported, reportAck, { liveDeliveryStatus: "delivered", now: "2026-06-16T00:00:03.000Z" });
  assert.equal(closed.pending_packets.length, 0);
  assert.equal(closed.peer_status.hq.last_packet_at, "2026-06-16T00:00:03.000Z");
  assert.equal(closed.peer_status.runner.last_packet_at, "2026-06-16T00:00:03.000Z");
});
