import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  appendMissionCreated,
  appendMissionLifecycleTransition,
  appendMissionSelected,
  buildEventId,
  isMissionCreatedEvent,
  isMissionLifecycleTransitionEvent,
  isMissionSelectedEvent,
  MISSION_CREATED_EVENT,
  MISSION_LIFECYCLE_TRANSITION_EVENT,
  MISSION_SELECTED_EVENT,
} from "../../src/runtime/mission-events.ts";
import {
  createInitialStatusBoard,
  createMissionDraft,
} from "../../src/runtime/mission.ts";
import { createMissionLayout, missionLayoutPaths } from "../../src/runtime/mission-layout.ts";

function makeWorkspace(): string {
  return mkdtempSync(join(tmpdir(), "pi-topology-slice2-events-"));
}

function makeLayoutWithMission(workspaceDir: string, project: string, objective: string) {
  const card = createMissionDraft({
    project,
    workdir: workspaceDir,
    objective,
    allowed_paths: [workspaceDir],
  });
  const board = createInitialStatusBoard(card);
  const { layout } = createMissionLayout({ workspaceDir, missionCard: card, initialStatusBoard: board });
  return layout;
}

test("buildEventId returns evt_<iso>_<uuid8>", () => {
  const id = buildEventId(new Date("2026-06-17T00:00:00.000Z"));
  assert.match(id, /^evt_2026-06-17T00:00:00\.000Z_[0-9a-f]{8}$/);
  const id2 = buildEventId();
  assert.match(id2, /^evt_\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z_[0-9a-f]{8}$/);
  // Two consecutive ids differ.
  assert.notEqual(id, id2);
});

test("appendMissionLifecycleTransition writes a single JSONL line with all spec §4.1 fields", () => {
  const ws = makeWorkspace();
  try {
    const layout = makeLayoutWithMission(ws, "dogfood", "events proof");
    const event = appendMissionLifecycleTransition(ws, layout, {
      event_id: "evt_test_lifecycle_001",
      mission_id: layout.missionId,
      from_state: "draft",
      to_state: "running",
      reason: "owner-approved",
      actor: "owner",
      owner_decision_id: "dec_001",
      evidence: { transport: ["/tmp/transport"], business: ["approve"], inference: ["owner gate cleared"] },
    }, new Date("2026-06-17T00:00:00.000Z"));

    assert.equal(event.event_type, MISSION_LIFECYCLE_TRANSITION_EVENT);
    assert.equal(event.event_id, "evt_test_lifecycle_001");
    assert.equal(event.mission_id, layout.missionId);
    assert.equal(event.from_state, "draft");
    assert.equal(event.to_state, "running");
    assert.equal(event.actor, "owner");

    const lines = readFileSync(layout.runtimeEventsPath, "utf8").split("\n").filter(Boolean);
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]!);
    assert.equal(parsed.event_type, "mission_lifecycle_transition");
    assert.equal(parsed.owner_decision_id, "dec_001");
    assert.deepEqual(parsed.evidence, { transport: ["/tmp/transport"], business: ["approve"], inference: ["owner gate cleared"] });
    assert.ok(isMissionLifecycleTransitionEvent(parsed));
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("appendMissionSelected writes spec §3.3 mission_selected fields", () => {
  const ws = makeWorkspace();
  try {
    const layout = makeLayoutWithMission(ws, "dogfood", "select proof");
    const event = appendMissionSelected(ws, layout, {
      event_id: "evt_test_select_001",
      mission_id: layout.missionId,
      selected_at: "2026-06-17T00:00:00.000Z",
      selected_by: "topology-supervisor",
      reason: "owner_selected",
      previous_active_mission_id: "previous-001",
    }, new Date("2026-06-17T00:00:00.000Z"));
    assert.equal(event.event_type, MISSION_SELECTED_EVENT);
    assert.equal(event.event_id, "evt_test_select_001");
    assert.equal(event.previous_active_mission_id, "previous-001");
    assert.ok(isMissionSelectedEvent(event));

    // Slice 2.1 fix: event_id must appear in the JSONL line.
    const lines = readFileSync(layout.runtimeEventsPath, "utf8").split("\n").filter(Boolean);
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]!);
    assert.equal(parsed.event_id, "evt_test_select_001");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("appendMissionCreated writes the new event type with initial state info", () => {
  const ws = makeWorkspace();
  try {
    const layout = makeLayoutWithMission(ws, "dogfood", "create proof");
    const event = appendMissionCreated(ws, layout, {
      event_id: "evt_test_create_001",
      mission_id: layout.missionId,
      created_by: "owner",
      initial_lifecycle_state: "draft",
      initial_progress_status: "draft",
      title: "T",
      objective: "O",
    }, new Date("2026-06-17T00:00:00.000Z"));
    assert.equal(event.event_type, MISSION_CREATED_EVENT);
    assert.equal(event.event_id, "evt_test_create_001");
    assert.equal(event.initial_lifecycle_state, "draft");
    assert.equal(event.title, "T");
    assert.ok(isMissionCreatedEvent(event));
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("appending three events yields three JSONL lines, each parseable", () => {
  const ws = makeWorkspace();
  try {
    const layout = makeLayoutWithMission(ws, "dogfood", "three events");
    appendMissionCreated(ws, layout, {
      event_id: "evt_test_three_001",
      mission_id: layout.missionId,
      created_by: "owner",
      initial_lifecycle_state: "draft",
      initial_progress_status: "draft",
      title: "T",
      objective: "O",
    });
    appendMissionSelected(ws, layout, {
      event_id: "evt_test_three_002",
      mission_id: layout.missionId,
      selected_at: "2026-06-17T00:00:00.000Z",
      selected_by: "topology-supervisor",
      reason: "created",
      previous_active_mission_id: null,
    });
    appendMissionLifecycleTransition(ws, layout, {
      event_id: "evt_test_three_003",
      mission_id: layout.missionId,
      from_state: "draft",
      to_state: "running",
      reason: "owner-approved",
      actor: "owner",
      evidence: { transport: [], business: ["approve"], inference: [] },
    });
    const lines = readFileSync(layout.runtimeEventsPath, "utf8").split("\n").filter(Boolean);
    assert.equal(lines.length, 3);
    const types = lines.map((l) => JSON.parse(l).event_type);
    assert.deepEqual(types, ["mission_created", "mission_selected", "mission_lifecycle_transition"]);
    // Each event has event_id (slice 2.1 invariant).
    const ids = lines.map((l) => JSON.parse(l).event_id);
    assert.deepEqual(ids, ["evt_test_three_001", "evt_test_three_002", "evt_test_three_003"]);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("missionLayoutPaths without prior createMissionLayout still computes paths (used by events before layout exists)", () => {
  const ws = makeWorkspace();
  try {
    const layout = missionLayoutPaths(ws, "future-mission-001");
    // The path computation itself does not require existence.
    assert.equal(layout.missionCardPath.endsWith("/mission-card.json"), true);
    assert.equal(layout.runtimeEventsPath.endsWith("/runtime-events.jsonl"), true);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
