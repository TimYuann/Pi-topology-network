import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createInitialStatusBoard, createMissionDraft, type MissionCard } from "../../src/runtime/mission.ts";
import {
  createMissionLayout,
  expectedLayoutEntries,
  layoutExists,
  missionLayoutPaths,
} from "../../src/runtime/mission-layout.ts";
import {
  addMissionToRegistry,
  createEmptyRegistry,
  findMissionInRegistry,
  listMissionIds,
  MISSION_REGISTRY_FILENAME,
  readMissionRegistry,
  registryFilePath,
  setRegistryActiveMission,
  validateMissionRegistry,
  writeMissionRegistry,
} from "../../src/runtime/mission-registry.ts";
import {
  appendToJsonlLedger,
  copyRootMirrorFile,
  ROOT_MIRROR_FILES,
  rootMirrorFilePaths,
  rootMirrorMatchesLayout,
  syncRootMirrorFromLayout,
} from "../../src/runtime/root-mirror.ts";
import {
  buildActiveMissionPointer,
  clearActiveMissionPointer,
  readActiveMissionPointer,
  validateActiveMissionPointer,
  writeActiveMissionPointer,
} from "../../src/runtime/mission-pointer.ts";

function makeWorkspace(): string {
  return mkdtempSync(join(tmpdir(), "pi-topology-slice1-"));
}

function makeMission(project: string, objective: string): MissionCard {
  return createMissionDraft({
    project,
    workdir: "/work/project",
    objective,
    allowed_paths: ["/work/project/packages/pi-topology"],
  });
}

function makeMissionWithSuffix(project: string, objective: string, suffix: string): MissionCard {
  // Force a unique mission_id by tweaking project name; the slug derives from project.
  return createMissionDraft({
    project: `${project}-${suffix}`,
    workdir: "/work/project",
    objective,
    allowed_paths: ["/work/project/packages/pi-topology"],
  });
}

test("createEmptyRegistry returns a versioned, empty registry with no active mission", () => {
  const reg = createEmptyRegistry(new Date("2026-06-17T00:00:00.000Z"));
  assert.equal(reg.version, 1);
  assert.equal(reg.active_mission_id, null);
  assert.equal(reg.updated_at, "2026-06-17T00:00:00.000Z");
  assert.deepEqual(reg.missions, []);
});

test("writes and reads registry JSON in a no-mission workspace", () => {
  const ws = makeWorkspace();
  try {
    assert.equal(existsSync(registryFilePath(ws)), false);
    const reg = createEmptyRegistry();
    writeMissionRegistry(ws, reg);
    assert.equal(existsSync(registryFilePath(ws)), true);

    const raw = readFileSync(registryFilePath(ws), "utf8");
    assert.match(raw, /"version": 1/);
    assert.match(raw, /"active_mission_id": null/);

    const round = readMissionRegistry(ws);
    assert.ok(round);
    assert.equal(round?.active_mission_id, null);
    assert.equal(round?.missions.length, 0);
    assert.equal(validateMissionRegistry(round).ok, true);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("addMissionToRegistry adds a new entry and is idempotent on duplicate id", () => {
  const reg = createEmptyRegistry();
  const entry = {
    mission_id: "omp-2026-06-17-001",
    mission_dir: ".pi/topology/missions/omp-2026-06-17-001",
    title: "Slice 1 dogfood",
    objective: "Verify registry + layout",
    lifecycle_state: "draft" as const,
    owner_gate: "required" as const,
    blocked: false,
    archived: false,
    last_updated_at: "2026-06-17T00:00:00.000Z",
    role_summary: { live: 0, resumable: 0, stale: 0, parked: 0, closed: 0 },
    pending_packet_count: 0,
    incident_count: 0,
    closeout_path: null,
  };

  const first = addMissionToRegistry(reg, entry);
  assert.equal(first.added, true);
  assert.equal(first.registry.missions.length, 1);
  assert.deepEqual(listMissionIds(first.registry), ["omp-2026-06-17-001"]);
  assert.equal(findMissionInRegistry(first.registry, "omp-2026-06-17-001")?.title, "Slice 1 dogfood");

  const dup = addMissionToRegistry(first.registry, entry);
  assert.equal(dup.added, false);
  assert.equal(dup.registry.missions.length, 1);
});

test("setRegistryActiveMission flips active_mission_id and updates timestamp", () => {
  const reg = createEmptyRegistry();
  const a = addMissionToRegistry(reg, {
    ...createEmptyRegistry().missions[0]!,
    mission_id: "a",
    title: "A",
    objective: "A obj",
    lifecycle_state: "draft",
    mission_dir: ".pi/topology/missions/a",
    last_updated_at: "2026-06-17T00:00:00.000Z",
    role_summary: { live: 0, resumable: 0, stale: 0, parked: 0, closed: 0 },
    owner_gate: "required",
    blocked: false,
    archived: false,
    pending_packet_count: 0,
    incident_count: 0,
    closeout_path: null,
  }).registry;
  const b = addMissionToRegistry(a, {
    ...a.missions[0]!,
    mission_id: "b",
    title: "B",
    objective: "B obj",
    mission_dir: ".pi/topology/missions/b",
    last_updated_at: "2026-06-17T00:00:00.000Z",
  }).registry;
  const withActive = setRegistryActiveMission(b, "a", new Date("2026-06-17T00:01:00.000Z"));
  assert.equal(withActive.active_mission_id, "a");
  assert.equal(withActive.updated_at, "2026-06-17T00:01:00.000Z");

  const cleared = setRegistryActiveMission(withActive, null, new Date("2026-06-17T00:02:00.000Z"));
  assert.equal(cleared.active_mission_id, null);
  assert.equal(cleared.updated_at, "2026-06-17T00:02:00.000Z");
});

test("readActiveMissionPointer returns null when no pointer file exists", () => {
  const ws = makeWorkspace();
  try {
    assert.equal(readActiveMissionPointer(ws), null);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("writeActiveMissionPointer persists, reads back, validates, and clears", () => {
  const ws = makeWorkspace();
  try {
    const pointer = buildActiveMissionPointer({
      mission_id: "omp-2026-06-17-001",
      mission_dir: ".pi/topology/missions/omp-2026-06-17-001",
      reason: "created",
      event_id: "evt_2026-06-17T00:00:00.000Z_001",
      now: new Date("2026-06-17T00:00:00.000Z"),
      selected_by: "topology-supervisor",
    });
    writeActiveMissionPointer(ws, pointer);

    const round = readActiveMissionPointer(ws);
    assert.ok(round);
    assert.equal(round?.mission_id, "omp-2026-06-17-001");
    assert.equal(round?.mission_dir, ".pi/topology/missions/omp-2026-06-17-001");
    assert.equal(round?.reason, "created");
    assert.equal(round?.selected_by, "topology-supervisor");
    assert.equal(validateActiveMissionPointer(round).ok, true);

    const cleared = clearActiveMissionPointer(ws);
    assert.equal(cleared, true);
    assert.equal(readActiveMissionPointer(ws), null);

    // Second clear is idempotent (no-op, returns false).
    assert.equal(clearActiveMissionPointer(ws), false);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("missionLayoutPaths computes the spec §3.1 layout with all required subpaths", () => {
  const ws = makeWorkspace();
  try {
    const layout = missionLayoutPaths(ws, "omp-2026-06-17-001");
    assert.equal(layout.missionDirRelative, ".pi/topology/missions/omp-2026-06-17-001");
    assert.equal(layout.missionCardPath, join(ws, ".pi", "topology", "missions", "omp-2026-06-17-001", "mission-card.json"));
    assert.equal(layout.statusBoardPath, join(ws, ".pi", "topology", "missions", "omp-2026-06-17-001", "status-board.json"));
    assert.equal(layout.runtimeEventsPath.endsWith("/runtime-events.jsonl"), true);
    assert.equal(layout.incidentLogPath.endsWith("/incident-log.jsonl"), true);
    assert.equal(layout.sessionsPath.endsWith("/sessions.jsonl"), true);
    assert.equal(layout.packetLedgerPath.endsWith("/packet-ledger.jsonl"), true);
    assert.equal(layout.evidenceIndexPath.endsWith("/evidence-index.jsonl"), true);
    assert.equal(layout.closeoutPath.endsWith("/closeout.md"), true);
    assert.equal(layout.launchDir.endsWith("/launch"), true);
    assert.equal(layout.artifactsDir.endsWith("/artifacts"), true);
    assert.equal(layout.slicesDir.endsWith("/slices"), true);
    // All 7 role artifact dirs present.
    for (const role of ["topology-supervisor", "hq", "repair", "runner", "oracle", "librarian", "scott"] as const) {
      assert.equal(layout.artifactRoleDirs[role].endsWith(`/artifacts/${role}`), true);
    }
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("createMissionLayout creates all expected files and dirs, and is idempotent on rerun", () => {
  const ws = makeWorkspace();
  try {
    const card = makeMission("dogfood", "Slice 1 layout proof");
    const board = createInitialStatusBoard(card);
    const first = createMissionLayout({ workspaceDir: ws, missionCard: card, initialStatusBoard: board });
    assert.equal(first.created, true);
    assert.equal(layoutExists(first.layout), true);
    for (const entry of expectedLayoutEntries(first.layout)) {
      assert.equal(existsSync(entry), true, `expected ${entry} to exist`);
    }
    // Mission card and status board content is parseable.
    const onDiskCard = JSON.parse(readFileSync(first.layout.missionCardPath, "utf8")) as MissionCard;
    assert.equal(onDiskCard.mission_id, card.mission_id);
    const onDiskBoard = JSON.parse(readFileSync(first.layout.statusBoardPath, "utf8"));
    assert.equal(onDiskBoard.mission_id, card.mission_id);
    // closeout.md placeholder mentions the mission id.
    const closeout = readFileSync(first.layout.closeoutPath, "utf8");
    assert.match(closeout, new RegExp(card.mission_id));
    // Runtime-events / incident-log / sessions / packet-ledger / evidence-index exist as empty files.
    for (const jsonl of [
      first.layout.runtimeEventsPath,
      first.layout.incidentLogPath,
      first.layout.sessionsPath,
      first.layout.packetLedgerPath,
      first.layout.evidenceIndexPath,
    ]) {
      assert.equal(existsSync(jsonl), true);
      assert.equal(readFileSync(jsonl, "utf8"), "");
    }

    // Idempotent: rerun is a no-op and does not throw.
    const second = createMissionLayout({ workspaceDir: ws, missionCard: card, initialStatusBoard: board });
    assert.equal(second.created, false);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("syncRootMirrorFromLayout copies active mission files to root compatibility paths", () => {
  const ws = makeWorkspace();
  try {
    const card = makeMission("dogfood", "Mirror proof");
    const board = createInitialStatusBoard(card);
    const { layout } = createMissionLayout({ workspaceDir: ws, missionCard: card, initialStatusBoard: board });

    const result = syncRootMirrorFromLayout(ws, layout);
    assert.equal(result.missing.length, 0);
    assert.equal(result.copied.length, ROOT_MIRROR_FILES.length);
    // Root mirror files now exist and match per-mission content.
    const check = rootMirrorMatchesLayout(ws, layout);
    assert.equal(check.ok, true, `mismatches: ${check.mismatches.join(", ")}`);
    // Sanity: root mission-card.json is identical to per-mission mission-card.json.
    const rootCard = readFileSync(join(ws, ".pi", "topology", "mission-card.json"), "utf8");
    const perMissionCard = readFileSync(layout.missionCardPath, "utf8");
    assert.equal(rootCard, perMissionCard);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("switching the active Mission updates root mirror and preserves old per-mission folder", () => {
  const ws = makeWorkspace();
  try {
    const cardA = makeMissionWithSuffix("dogfood", "First mission", "alpha");
    const boardA = createInitialStatusBoard(cardA);
    const a = createMissionLayout({ workspaceDir: ws, missionCard: cardA, initialStatusBoard: boardA });

    const cardB = makeMissionWithSuffix("dogfood", "Second mission", "beta");
    const boardB = createInitialStatusBoard(cardB);
    const b = createMissionLayout({ workspaceDir: ws, missionCard: cardB, initialStatusBoard: boardB });

    // Make per-mission content distinct so mirror equality is a real test.
    a.layout; // first layout
    // Active = A: mirror points to A.
    syncRootMirrorFromLayout(ws, a.layout);
    assert.equal(rootMirrorMatchesLayout(ws, a.layout).ok, true);
    const rootCardWhenA = readFileSync(join(ws, ".pi", "topology", "mission-card.json"), "utf8");
    assert.match(rootCardWhenA, new RegExp(cardA.mission_id));

    // Active = B: mirror points to B.
    syncRootMirrorFromLayout(ws, b.layout);
    assert.equal(rootMirrorMatchesLayout(ws, b.layout).ok, true);
    // B is now in root; A's per-mission folder is preserved.
    const rootCardWhenB = readFileSync(join(ws, ".pi", "topology", "mission-card.json"), "utf8");
    assert.match(rootCardWhenB, new RegExp(cardB.mission_id));
    assert.notEqual(rootCardWhenA, rootCardWhenB);
    // A's folder still exists with original content.
    assert.equal(existsSync(a.layout.missionDirAbsolute), true);
    assert.equal(existsSync(a.layout.missionCardPath), true);
    const aCard = readFileSync(a.layout.missionCardPath, "utf8");
    assert.match(aCard, new RegExp(cardA.mission_id));
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("appendToJsonlLedger updates both per-mission and root mirror, leaving previously mirrored missions untouched", () => {
  const ws = makeWorkspace();
  try {
    const cardA = makeMissionWithSuffix("dogfood", "Append proof A", "alpha");
    const boardA = createInitialStatusBoard(cardA);
    const a = createMissionLayout({ workspaceDir: ws, missionCard: cardA, initialStatusBoard: boardA });
    syncRootMirrorFromLayout(ws, a.layout);

    appendToJsonlLedger(
      ws,
      a.layout,
      "runtime-events.jsonl",
      JSON.stringify({ event_type: "mission_selected", mission_id: cardA.mission_id }),
    );

    // Per-mission + root mirror both have the line.
    const perMission = readFileSync(a.layout.runtimeEventsPath, "utf8");
    const rootMirror = readFileSync(join(ws, ".pi", "topology", "runtime-events.jsonl"), "utf8");
    assert.equal(perMission, rootMirror);
    assert.match(perMission, /mission_selected/);

    // Now create mission B and verify B's empty runtime-events is independent of A's appends.
    const cardB = makeMissionWithSuffix("dogfood", "Append proof B", "beta");
    const boardB = createInitialStatusBoard(cardB);
    const b = createMissionLayout({ workspaceDir: ws, missionCard: cardB, initialStatusBoard: boardB });
    const bEvents = readFileSync(b.layout.runtimeEventsPath, "utf8");
    assert.equal(bEvents, "");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("copyRootMirrorFile copies a single ledger when only one file changed", () => {
  const ws = makeWorkspace();
  try {
    const card = makeMission("dogfood", "Single file copy");
    const board = createInitialStatusBoard(card);
    const { layout } = createMissionLayout({ workspaceDir: ws, missionCard: card, initialStatusBoard: board });

    // Write directly to per-mission (simulating a write that bypassed the helper).
    const line = JSON.stringify({ event_type: "guard_block", role: "runner" });
    writeFileSync(layout.runtimeEventsPath, `${line}\n`, "utf8");

    const result = copyRootMirrorFile(ws, layout, "runtime-events.jsonl");
    assert.equal(result.ok, true);
    const rootMirror = readFileSync(rootMirrorFilePaths(ws)["runtime-events.jsonl"], "utf8");
    assert.equal(rootMirror, `${line}\n`);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("registry file is named per spec and lives at .pi/topology/mission-registry.json", () => {
  const ws = makeWorkspace();
  try {
    writeMissionRegistry(ws, createEmptyRegistry());
    assert.equal(
      registryFilePath(ws),
      join(ws, ".pi", "topology", MISSION_REGISTRY_FILENAME),
    );
    assert.equal(MISSION_REGISTRY_FILENAME, "mission-registry.json");
    assert.equal(existsSync(registryFilePath(ws)), true);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
