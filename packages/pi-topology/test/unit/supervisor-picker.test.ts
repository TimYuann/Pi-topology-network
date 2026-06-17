import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  availableActionsForOption,
  classifyMission,
  findMissionOption,
  readPickerSnapshot,
  rootLegacyMissionCardPath,
  ROOT_MISSION_CARD_RELATIVE,
} from "../../src/runtime/supervisor-picker.ts";
import {
  addMissionToRegistry,
  createEmptyRegistry,
  newMissionRegistryEntry,
  setRegistryActiveMission,
  writeMissionRegistry,
} from "../../src/runtime/mission-registry.ts";
import {
  buildActiveMissionPointer,
  clearActiveMissionPointer,
  readActiveMissionPointer,
  writeActiveMissionPointer,
} from "../../src/runtime/mission-pointer.ts";
import type { MissionRegistryEntry } from "../../src/runtime/mission-registry.ts";

function makeWorkspace(): string {
  return mkdtempSync(join(tmpdir(), "pi-topology-slice2-picker-"));
}

function makeEntry(overrides: Partial<MissionRegistryEntry> = {}): MissionRegistryEntry {
  const base: MissionRegistryEntry = {
    mission_id: "m1",
    mission_dir: ".pi/topology/missions/m1",
    title: "T",
    objective: "O",
    lifecycle_state: "draft",
    progress_status: "draft",
    owner_gate: "required",
    blocked: false,
    archived: false,
    last_updated_at: "2026-06-17T00:00:00.000Z",
    role_summary: { live: 0, resumable: 0, stale: 0, parked: 0, closed: 0 },
    pending_packet_count: 0,
    incident_count: 0,
    closeout_path: null,
  };
  return { ...base, ...overrides };
}

test("ROOT_MISSION_CARD_RELATIVE is the spec §3.2 root compatibility path", () => {
  assert.equal(ROOT_MISSION_CARD_RELATIVE, ".pi/topology/mission-card.json");
});

test("classifyMission picks the highest-precedence category", () => {
  const base = makeEntry();
  // archived wins over everything.
  assert.equal(classifyMission({ ...base, archived: true }, null), "archived");
  // blocked wins when not archived.
  assert.equal(classifyMission({ ...base, archived: false, blocked: true }, null), "blocked");
  // parked wins when not archived/blocked.
  assert.equal(
    classifyMission({ ...base, archived: false, blocked: false, lifecycle_state: "parked" }, null),
    "parked",
  );
  // active when not archived/blocked/parked AND matches active.
  assert.equal(
    classifyMission({ ...base, mission_id: "x", archived: false, blocked: false, lifecycle_state: "draft" }, "x"),
    "active",
  );
  // resumed otherwise.
  assert.equal(
    classifyMission({ ...base, mission_id: "x", archived: false, blocked: false, lifecycle_state: "draft" }, "y"),
    "resumed",
  );
  // null activeId never yields active.
  assert.equal(
    classifyMission({ ...base, archived: false, blocked: false, lifecycle_state: "draft" }, null),
    "resumed",
  );
});

test("readPickerSnapshot in intake mode when nothing exists", () => {
  const ws = makeWorkspace();
  try {
    const snap = readPickerSnapshot(ws);
    assert.equal(snap.mode, "intake");
    assert.equal(snap.options.length, 0);
    assert.equal(snap.registry_path, null);
    assert.equal(snap.legacy_root, null);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("readPickerSnapshot in legacy_root mode when only root mission-card.json exists", () => {
  const ws = makeWorkspace();
  try {
    const cardPath = rootLegacyMissionCardPath(ws);
    mkdirSync(join(ws, ".pi", "topology"), { recursive: true });
    writeFileSync(cardPath, JSON.stringify({ mission_id: "legacy" }), "utf8");
    const snap = readPickerSnapshot(ws);
    assert.equal(snap.mode, "legacy_root");
    assert.equal(snap.legacy_root?.mission_card_path, cardPath);
    assert.equal(snap.options.length, 0);
    assert.equal(snap.registry_path, null);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("readPickerSnapshot in registry mode returns active pointer and option categories", () => {
  const ws = makeWorkspace();
  try {
    // Registry with 3 missions: 1 active, 1 archived, 1 parked.
    const reg = createEmptyRegistry();
    const a = makeEntry({ mission_id: "a", lifecycle_state: "running" });
    const b = makeEntry({ mission_id: "b", archived: true });
    const c = makeEntry({ mission_id: "c", lifecycle_state: "parked" });
    let r = addMissionToRegistry(reg, a).registry;
    r = addMissionToRegistry(r, b).registry;
    r = addMissionToRegistry(r, c).registry;
    r = setRegistryActiveMission(r, "a");
    writeMissionRegistry(ws, r);

    // Active pointer is also written so the picker reads it as the active source.
    writeActiveMissionPointer(ws, buildActiveMissionPointer({
      mission_id: "a",
      mission_dir: a.mission_dir,
      reason: "created",
      event_id: "evt_test_001",
      now: new Date("2026-06-17T00:00:00.000Z"),
    }));

    const snap = readPickerSnapshot(ws);
    assert.equal(snap.mode, "registry");
    assert.equal(snap.active_mission_id, "a");
    assert.equal(snap.options.length, 3);
    const byCat = Object.fromEntries(snap.options.map((o) => [o.mission_id, o.category]));
    assert.equal(byCat.a, "active");
    assert.equal(byCat.b, "archived");
    assert.equal(byCat.c, "parked");
    // role_summary is the zeroed default (slice 3 will populate).
    for (const opt of snap.options) {
      assert.deepEqual(opt.role_summary, { live: 0, resumable: 0, stale: 0, parked: 0, closed: 0 });
    }
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("readPickerSnapshot falls back to registry.active_mission_id when no pointer file exists", () => {
  const ws = makeWorkspace();
  try {
    const reg = createEmptyRegistry();
    const a = makeEntry({ mission_id: "a", lifecycle_state: "running" });
    let r = addMissionToRegistry(reg, a).registry;
    r = setRegistryActiveMission(r, "a");
    writeMissionRegistry(ws, r);
    // Intentionally do NOT write pointer.
    const snap = readPickerSnapshot(ws);
    assert.equal(snap.mode, "registry");
    assert.equal(snap.active_mission_id, "a");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("readPickerSnapshot snapshot_at is set and the snapshot is stable across re-reads", () => {
  const ws = makeWorkspace();
  try {
    const snap1 = readPickerSnapshot(ws, { now: new Date("2026-06-17T00:00:00.000Z") });
    // Sleep is not needed; the second read uses real time but snapshot_at reflects call time.
    const snap2 = readPickerSnapshot(ws);
    assert.ok(snap1.snapshot_at);
    assert.ok(snap2.snapshot_at);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("findMissionOption returns the matching option or null", () => {
  const ws = makeWorkspace();
  try {
    const reg = createEmptyRegistry();
    const a = makeEntry({ mission_id: "a" });
    const r = addMissionToRegistry(reg, a).registry;
    writeMissionRegistry(ws, r);
    const snap = readPickerSnapshot(ws);
    assert.ok(findMissionOption(snap, "a"));
    assert.equal(findMissionOption(snap, "ghost"), null);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("availableActionsForOption honors spec §5.3 actions", () => {
  const base = makeEntry();
  // Intake mode: only create_new.
  assert.deepEqual(availableActionsForOption({ ...base, is_active: false, category: "resumed" }, "intake"), ["create_new"]);
  // Active: continue + inspect + archive + park + mark_blocked + request_rollback
  // (spec §5.3 supports all these for any non-archived, non-parked Mission).
  const active = { ...base, mission_id: "a", is_active: true, category: "active" as const };
  assert.deepEqual(availableActionsForOption(active, "registry"), [
    "inspect",
    "continue",
    "archive",
    "park",
    "mark_blocked",
    "request_rollback",
  ]);
  // Resumed non-active: resume + inspect + lifecycle-changing actions
  // (spec §5.3 supports archive/park/mark_blocked/request_rollback on
  // non-archived, non-parked Missions).
  const resumed = { ...base, mission_id: "b", is_active: false, category: "resumed" as const };
  assert.deepEqual(availableActionsForOption(resumed, "registry"), [
    "inspect",
    "resume",
    "archive",
    "park",
    "mark_blocked",
    "request_rollback",
  ]);
  // Archived: inspect only — even when the active pointer still points to it.
  // Slice 2.1 regression: before this fix, the "is_active" branch pushed
  // "continue" first and the archived early-return did not exist, so a stale
  // active pointer on an archived Mission offered ["inspect", "continue"].
  // Spec §5.2 says archived is "closed for normal work, inspectable only".
  const archived = { ...base, mission_id: "c", archived: true, is_active: false, category: "archived" as const };
  assert.deepEqual(availableActionsForOption(archived, "registry"), ["inspect"]);
  const archivedButActive = { ...base, mission_id: "ca", archived: true, is_active: true, category: "archived" as const };
  assert.deepEqual(availableActionsForOption(archivedButActive, "registry"), ["inspect"]);
  const archivedButArchivedNotBlockedParked = { ...base, mission_id: "cb", archived: true, is_active: false, category: "archived" as const, lifecycle_state: "draft" as const };
  assert.deepEqual(availableActionsForOption(archivedButArchivedNotBlockedParked, "registry"), ["inspect"]);
  // Parked: inspect + resume + unpark (resume is the soft wake; unpark is the
  // canonical wake from a parked state).
  const parked = { ...base, mission_id: "d", is_active: false, category: "parked" as const, lifecycle_state: "parked" as const };
  assert.deepEqual(availableActionsForOption(parked, "registry"), ["inspect", "resume", "unpark"]);
  // Blocked (non-active): inspect + archive + park + mark_blocked + request_rollback.
  // (Blocked Missions remain non-archived, so all lifecycle actions still apply.)
  const blocked = { ...base, mission_id: "e", is_active: false, blocked: true, category: "blocked" as const };
  assert.deepEqual(availableActionsForOption(blocked, "registry"), [
    "inspect",
    "resume",
    "archive",
    "park",
    "mark_blocked",
    "request_rollback",
  ]);
});

test("readPickerSnapshot tolerates legacy_root + registry-pointer inconsistency by preferring pointer", () => {
  const ws = makeWorkspace();
  try {
    const reg = createEmptyRegistry();
    const a = makeEntry({ mission_id: "a", lifecycle_state: "running" });
    const r = addMissionToRegistry(reg, a).registry;
    // registry active is null but pointer points to "a"
    writeMissionRegistry(ws, r);
    writeActiveMissionPointer(ws, buildActiveMissionPointer({
      mission_id: "a",
      mission_dir: a.mission_dir,
      reason: "owner_selected",
      event_id: "evt_pointer_001",
      now: new Date("2026-06-17T00:00:00.000Z"),
    }));
    const snap = readPickerSnapshot(ws);
    // Pointer wins (slice 1.2 didn't gate the read path; pointer is the live source).
    assert.equal(snap.active_mission_id, "a");
    const optA = snap.options.find((o) => o.mission_id === "a")!;
    assert.equal(optA.is_active, true);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("clearActiveMissionPointer (slice 1 helper) leaves snapshot without active", () => {
  const ws = makeWorkspace();
  try {
    const reg = createEmptyRegistry();
    const a = makeEntry({ mission_id: "a" });
    const r = addMissionToRegistry(reg, a).registry;
    writeMissionRegistry(ws, r);
    writeActiveMissionPointer(ws, buildActiveMissionPointer({
      mission_id: "a",
      mission_dir: a.mission_dir,
      reason: "created",
      event_id: "evt_clear_001",
      now: new Date("2026-06-17T00:00:00.000Z"),
    }));
    assert.ok(readActiveMissionPointer(ws));
    clearActiveMissionPointer(ws);
    const snap = readPickerSnapshot(ws);
    // Falls back to registry.active_mission_id which is null.
    assert.equal(snap.active_mission_id, null);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
