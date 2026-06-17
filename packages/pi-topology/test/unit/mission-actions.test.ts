import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  archiveMission,
  createMissionFlow,
  inspectMission,
  markMissionBlocked,
  parkMission,
  readCurrentActiveMissionId,
  requestRollback,
  resumeMission,
  setActiveMissionFull,
  unparkMission,
} from "../../src/runtime/mission-actions.ts";
import {
  addMissionToRegistry,
  createEmptyRegistry,
  newMissionRegistryEntry,
  readMissionRegistry,
  setRegistryActiveMission,
  UnknownMissionRegistryEntryError,
  updateRegistryEntry,
  writeMissionRegistry,
} from "../../src/runtime/mission-registry.ts";
import {
  activeMissionPointerPath,
  clearActiveMissionPointer,
  readActiveMissionPointer,
} from "../../src/runtime/mission-pointer.ts";
import {
  createInitialStatusBoard,
  createMissionDraft,
} from "../../src/runtime/mission.ts";
import { missionLayoutPaths } from "../../src/runtime/mission-layout.ts";

function makeWorkspace(): string {
  return mkdtempSync(join(tmpdir(), "pi-topology-slice2-actions-"));
}

function seedRegistryWithMission(workspaceDir: string, suffix: string) {
  // Include the workspace suffix in the project name so two seed calls in the
  // same workspace produce two distinct mission_ids (the slug derives from
  // project; a fresh workspace per test still works).
  const projectSuffix = workspaceDir.slice(-6);
  const card = createMissionDraft({
    project: `dogfood-${suffix}-${projectSuffix}`,
    workdir: workspaceDir,
    objective: `actions proof ${suffix}`,
    allowed_paths: [workspaceDir],
  });
  const board = createInitialStatusBoard(card);
  // Use the helpers via createMissionFlow equivalent without going through
  // the full flow so we can test individual actions in isolation.
  const layout = missionLayoutPaths(workspaceDir, card.mission_id);
  mkdirSync(layout.missionDirAbsolute, { recursive: true });
  mkdirSync(layout.launchDir, { recursive: true });
  mkdirSync(layout.artifactsDir, { recursive: true });
  for (const roleDir of Object.values(layout.artifactRoleDirs)) mkdirSync(roleDir, { recursive: true });
  mkdirSync(layout.slicesDir, { recursive: true });
  writeFileSync(layout.missionCardPath, `${JSON.stringify(card, null, 2)}\n`, "utf8");
  writeFileSync(layout.statusBoardPath, `${JSON.stringify(board, null, 2)}\n`, "utf8");
  writeFileSync(layout.runtimeEventsPath, "", "utf8");
  writeFileSync(layout.incidentLogPath, "", "utf8");
  writeFileSync(layout.sessionsPath, "", "utf8");
  writeFileSync(layout.packetLedgerPath, "", "utf8");
  writeFileSync(layout.evidenceIndexPath, "", "utf8");
  writeFileSync(layout.closeoutPath, `# Closeout — ${card.mission_id}\n\nplaceholder\n`, "utf8");

  // Preserve any prior registry entries (so two seeds in the same workspace
  // produce two distinct missions, not overwrite each other).
  const existing = readMissionRegistry(workspaceDir);
  const baseRegistry = existing ?? createEmptyRegistry();
  const entry = newMissionRegistryEntry({
    mission_id: card.mission_id,
    title: card.objective,
    objective: card.objective,
    lifecycle_state: "draft",
    progress_status: "draft",
    owner_gate: "required",
    mission_dir: layout.missionDirRelative,
  });
  const withEntry = addMissionToRegistry(baseRegistry, entry).registry;
  writeMissionRegistry(workspaceDir, withEntry);
  return { card, layout, entry };
}

test("setActiveMissionFull: gate throws when registry is missing", () => {
  const ws = makeWorkspace();
  try {
    assert.throws(
      () => setActiveMissionFull(ws, "any", { reason: "resumed" }),
      /mission-registry\.json not found/,
    );
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("setActiveMissionFull: gate throws when mission_id is unknown (slice 1.1 invariant)", () => {
  const ws = makeWorkspace();
  try {
    seedRegistryWithMission(ws, "alpha");
    assert.throws(
      () => setActiveMissionFull(ws, "ghost-mission", { reason: "resumed" }),
      /unknown mission/,
    );
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("setActiveMissionFull: success path writes pointer, registry, event, root mirror", () => {
  const ws = makeWorkspace();
  try {
    const { card, layout } = seedRegistryWithMission(ws, "alpha");
    const result = setActiveMissionFull(ws, card.mission_id, {
      reason: "owner_selected",
      now: new Date("2026-06-17T00:00:00.000Z"),
    });

    assert.equal(result.pointer.mission_id, card.mission_id);
    assert.equal(result.pointer.reason, "owner_selected");
    assert.equal(result.event_id.startsWith("evt_2026-06-17T00:00:00.000Z_"), true);

    // Pointer written.
    assert.equal(existsSync(activeMissionPointerPath(ws)), true);
    const readPointer = readActiveMissionPointer(ws);
    assert.equal(readPointer?.mission_id, card.mission_id);

    // Registry updated.
    const reg = readMissionRegistry(ws);
    assert.equal(reg?.active_mission_id, card.mission_id);

    // Event appended.
    const events = readFileSync(layout.runtimeEventsPath, "utf8").split("\n").filter(Boolean);
    assert.equal(events.length, 1);
    const parsed = JSON.parse(events[0]!);
    assert.equal(parsed.event_type, "mission_selected");
    assert.equal(parsed.mission_id, card.mission_id);
    assert.equal(parsed.previous_active_mission_id, null);

    // Root mirror updated (mission-card.json now reflects this Mission).
    const rootCard = readFileSync(join(ws, ".pi", "topology", "mission-card.json"), "utf8");
    const perMissionCard = readFileSync(layout.missionCardPath, "utf8");
    assert.equal(rootCard, perMissionCard);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("setActiveMissionFull: switching active Mission updates pointer and event's previous_active_mission_id", () => {
  const ws = makeWorkspace();
  try {
    const a = seedRegistryWithMission(ws, "alpha");
    const b = seedRegistryWithMission(ws, "beta");
    assert.notEqual(a.card.mission_id, b.card.mission_id);
    // Activate A first.
    setActiveMissionFull(ws, a.card.mission_id, { reason: "owner_selected", now: new Date("2026-06-17T00:00:00.000Z") });
    // Switch to B.
    const result = setActiveMissionFull(ws, b.card.mission_id, { reason: "owner_selected", now: new Date("2026-06-17T00:01:00.000Z") });

    assert.equal(result.pointer.mission_id, b.card.mission_id);
    assert.equal(result.previous_active_mission_id, a.card.mission_id);

    // B's events should include the selection event with previous_active_mission_id = a.
    const events = readFileSync(b.layout.runtimeEventsPath, "utf8").split("\n").filter(Boolean);
    assert.equal(events.length, 1);
    const parsed = JSON.parse(events[0]!);
    assert.equal(parsed.previous_active_mission_id, a.card.mission_id);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("resumeMission throws on unknown mission (gate is enforced)", () => {
  const ws = makeWorkspace();
  try {
    seedRegistryWithMission(ws, "alpha");
    assert.throws(
      () => resumeMission(ws, "ghost"),
      /unknown mission/,
    );
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("resumeMission sets active and appends mission_selected event with reason=resumed", () => {
  const ws = makeWorkspace();
  try {
    const { card, layout } = seedRegistryWithMission(ws, "alpha");
    const result = resumeMission(ws, card.mission_id, { now: new Date("2026-06-17T00:00:00.000Z") });
    assert.equal(result.pointer.reason, "resumed");
    const events = readFileSync(layout.runtimeEventsPath, "utf8").split("\n").filter(Boolean);
    assert.equal(events.length, 1);
    assert.equal(JSON.parse(events[0]!).reason, "resumed");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("createMissionFlow creates layout + registry entry + active pointer + events", () => {
  const ws = makeWorkspace();
  try {
    const result = createMissionFlow(ws, {
      project: "dogfood-create",
      workdir: ws,
      objective: "create flow proof",
      allowed_paths: [ws],
      title: "Create Flow",
      actor: "owner",
      now: new Date("2026-06-17T00:00:00.000Z"),
    });

    assert.equal(result.missionCard.project, "dogfood-create");
    assert.equal(result.entry.title, "Create Flow");
    assert.equal(result.entry.lifecycle_state, "draft");
    assert.equal(result.entry.progress_status, "draft");
    assert.equal(result.registry.active_mission_id, result.missionCard.mission_id);

    // Files exist.
    assert.ok(existsSync(result.layout.missionCardPath));
    assert.ok(existsSync(result.layout.runtimeEventsPath));
    assert.ok(existsSync(result.layout.closeoutPath));
    assert.ok(existsSync(activeMissionPointerPath(ws)));

    // Events: mission_created + mission_selected.
    const events = readFileSync(result.layout.runtimeEventsPath, "utf8").split("\n").filter(Boolean);
    assert.equal(events.length, 2);
    const types = events.map((e) => JSON.parse(e).event_type);
    assert.deepEqual(types, ["mission_created", "mission_selected"]);

    // Root mirror reflects the new Mission.
    const rootCard = readFileSync(join(ws, ".pi", "topology", "mission-card.json"), "utf8");
    assert.match(rootCard, new RegExp(result.missionCard.mission_id));
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("createMissionFlow throws on duplicate mission_id", () => {
  const ws = makeWorkspace();
  try {
    createMissionFlow(ws, {
      project: "dogfood-dup",
      workdir: ws,
      objective: "first",
      allowed_paths: [ws],
    });
    assert.throws(
      () =>
        createMissionFlow(ws, {
          project: "dogfood-dup",
          workdir: ws,
          objective: "second",
          allowed_paths: [ws],
        }),
      /already exists/,
    );
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("archiveMission sets archived=true and writes mission_lifecycle_transition event", () => {
  const ws = makeWorkspace();
  try {
    const { card, layout } = seedRegistryWithMission(ws, "alpha");
    const result = archiveMission(ws, card.mission_id, {
      actor: "owner",
      reason: "owner-decision",
      now: new Date("2026-06-17T00:00:00.000Z"),
    });
    assert.equal(result.entry.archived, true);
    assert.equal(result.entry.lifecycle_state, "archived");
    assert.equal(result.event.event_type, "mission_lifecycle_transition");
    assert.equal(result.event.from_state, "draft");
    assert.equal(result.event.to_state, "archived");
    const events = readFileSync(layout.runtimeEventsPath, "utf8").split("\n").filter(Boolean);
    assert.equal(events.length, 1);
    assert.equal(JSON.parse(events[0]!).event_type, "mission_lifecycle_transition");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("parkMission sets lifecycle_state=parked and unparkMission restores awaiting_owner_confirmation", () => {
  const ws = makeWorkspace();
  try {
    const { card } = seedRegistryWithMission(ws, "alpha");
    parkMission(ws, card.mission_id, { now: new Date("2026-06-17T00:00:00.000Z") });
    let reg = readMissionRegistry(ws);
    const parked = reg?.missions.find((m) => m.mission_id === card.mission_id);
    assert.equal(parked?.lifecycle_state, "parked");

    unparkMission(ws, card.mission_id, { now: new Date("2026-06-17T00:01:00.000Z") });
    reg = readMissionRegistry(ws);
    const restored = reg?.missions.find((m) => m.mission_id === card.mission_id);
    assert.equal(restored?.lifecycle_state, "awaiting_owner_confirmation");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("markMissionBlocked sets blocked=true and lifecycle_state=blocked", () => {
  const ws = makeWorkspace();
  try {
    const { card } = seedRegistryWithMission(ws, "alpha");
    markMissionBlocked(ws, card.mission_id, {
      reason: "evidence-conflict",
      now: new Date("2026-06-17T00:00:00.000Z"),
    });
    const reg = readMissionRegistry(ws);
    const e = reg?.missions.find((m) => m.mission_id === card.mission_id);
    assert.equal(e?.blocked, true);
    assert.equal(e?.lifecycle_state, "blocked");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("requestRollback sets lifecycle_state=rollback_pending and blocked=true", () => {
  const ws = makeWorkspace();
  try {
    const { card } = seedRegistryWithMission(ws, "alpha");
    requestRollback(ws, card.mission_id, { reason: "slice failed", now: new Date("2026-06-17T00:00:00.000Z") });
    const reg = readMissionRegistry(ws);
    const e = reg?.missions.find((m) => m.mission_id === card.mission_id);
    assert.equal(e?.lifecycle_state, "rollback_pending");
    assert.equal(e?.blocked, true);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("inspectMission returns a read-only summary", () => {
  const ws = makeWorkspace();
  try {
    const { card } = seedRegistryWithMission(ws, "alpha");
    resumeMission(ws, card.mission_id);
    const summary = inspectMission(ws, card.mission_id);
    assert.equal(summary.mission_id, card.mission_id);
    assert.equal(summary.is_active, true);
    assert.ok(summary.layout.missionDirAbsolute.endsWith(card.mission_id));
    assert.equal(summary.active_pointer_exists, true);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("inspectMission throws on unknown mission", () => {
  const ws = makeWorkspace();
  try {
    seedRegistryWithMission(ws, "alpha");
    assert.throws(() => inspectMission(ws, "ghost"));
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("readCurrentActiveMissionId prefers pointer file over registry fallback", () => {
  const ws = makeWorkspace();
  try {
    const { card } = seedRegistryWithMission(ws, "alpha");
    // No pointer yet.
    clearActiveMissionPointer(ws);
    assert.equal(readCurrentActiveMissionId(ws), null);

    // Now set registry active_mission_id (without pointer) — fallback path.
    const reg = readMissionRegistry(ws);
    const next = setRegistryActiveMission(reg!, card.mission_id);
    writeMissionRegistry(ws, next);
    // Pointer file still absent.
    assert.equal(readCurrentActiveMissionId(ws), card.mission_id);

    // Pointer written → pointer wins (slice 1.2 invariant).
    resumeMission(ws, card.mission_id);
    assert.equal(readCurrentActiveMissionId(ws), card.mission_id);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("updateRegistryEntry throws UnknownMissionRegistryEntryError for unknown mission", () => {
  const ws = makeWorkspace();
  try {
    seedRegistryWithMission(ws, "alpha");
    const reg = readMissionRegistry(ws);
    assert.throws(
      () => updateRegistryEntry(reg!, { mission_id: "ghost", patch: { archived: true } }),
      UnknownMissionRegistryEntryError,
    );
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("updateRegistryEntry previous reflects entry BEFORE patch; updated reflects real change", () => {
  const ws = makeWorkspace();
  try {
    const { card } = seedRegistryWithMission(ws, "alpha");
    const reg = readMissionRegistry(ws);
    const before = reg!.missions[0]!.title;
    const result = updateRegistryEntry(reg!, { mission_id: card.mission_id, patch: { title: "Renamed" } });
    // previous reflects state BEFORE the patch (the seed title).
    assert.equal(result.previous.title, before);
    // entry reflects state AFTER the patch.
    assert.equal(result.entry.title, "Renamed");
    // A real title change is detected as updated.
    assert.equal(result.updated, true);

    // A no-op patch returns updated=false.
    const noop = updateRegistryEntry(reg!, { mission_id: card.mission_id, patch: { title: before } });
    assert.equal(noop.updated, false);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("createMissionFlow then archiveMission then resumeMission chain keeps consistent registry", () => {
  const ws = makeWorkspace();
  try {
    const created = createMissionFlow(ws, {
      project: "chain",
      workdir: ws,
      objective: "chain proof",
      allowed_paths: [ws],
      title: "Chain",
      now: new Date("2026-06-17T00:00:00.000Z"),
    });
    archiveMission(ws, created.missionCard.mission_id, { now: new Date("2026-06-17T00:01:00.000Z") });
    // After archive, registry.active_mission_id still points to the archived Mission
    // (archiving does not clear active). Resume is a no-op for active.
    const reg1 = readMissionRegistry(ws);
    assert.equal(reg1?.active_mission_id, created.missionCard.mission_id);
    assert.equal(reg1?.missions[0]?.archived, true);

    // Resume on the same mission is allowed (still known to the registry).
    resumeMission(ws, created.missionCard.mission_id, { now: new Date("2026-06-17T00:02:00.000Z") });
    const reg2 = readMissionRegistry(ws);
    assert.equal(reg2?.active_mission_id, created.missionCard.mission_id);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
