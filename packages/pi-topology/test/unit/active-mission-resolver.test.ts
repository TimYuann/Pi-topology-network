/**
 * Slice A regression: unified active Mission runtime resolver.
 *
 * Verifies that `resolveActiveMissionPaths` is the single source of truth
 * for active Mission paths in both legacy and per-mission modes:
 *
 *   1. legacy mode (no registry, no pointer) → root `.pi/topology/...` paths
 *   2. per-mission mode (registry + active pointer) → `missions/<id>/...` paths
 *   3. env override (PI_TOPOLOGY_MISSION_CARD) → env path wins
 *   4. invalid active mission_id → returns mode "none" (graceful)
 *   5. stale pointer (mission dir missing) → falls back to legacy root
 *
 * This file is part of the v0.5.1 runtime alignment repair (Slice A).
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import test from "node:test";

import { resolveActiveMissionPaths, type ActiveMissionResolution } from "../../src/runtime/active-mission-resolver.ts";
import { writeMissionRegistry, createEmptyRegistry, newMissionRegistryEntry, addMissionToRegistry, setRegistryActiveMission } from "../../src/runtime/mission-registry.ts";
import { buildActiveMissionPointer, writeActiveMissionPointer } from "../../src/runtime/mission-pointer.ts";
import { validateMissionRegistry } from "../../src/runtime/mission-registry.ts";
import { createMissionDraft, createInitialStatusBoard } from "../../src/runtime/mission.ts";
import { missionLayoutPaths, createMissionLayout } from "../../src/runtime/mission-layout.ts";
import { readDashboardSnapshot } from "../../src/runtime/dashboard.ts";
import { syncRootMirrorFromLayout } from "../../src/runtime/root-mirror.ts";

function makeWorkspace(): string {
  return mkdtempSync(join(tmpdir(), "pi-topology-resolver-"));
}

function writeLegacyRoot(ws: string, missionId: string, project: string): void {
  const card = createMissionDraft({
    project,
    workdir: ws,
    objective: "Resolver legacy test",
    allowed_paths: [ws],
  });
  card.mission_id = missionId;
  mkdirSync(join(ws, ".pi", "topology"), { recursive: true });
  writeFileSync(join(ws, ".pi", "topology", "mission-card.json"), JSON.stringify(card, null, 2), "utf8");
  writeFileSync(join(ws, ".pi", "topology", "status-board.json"), JSON.stringify(createInitialStatusBoard(card), null, 2), "utf8");
}

function writePerMission(ws: string, missionId: string, project: string): ActiveMissionResolution {
  const card = createMissionDraft({
    project,
    workdir: ws,
    objective: "Resolver per-mission test",
    allowed_paths: [ws],
  });
  card.mission_id = missionId;
  const layout = missionLayoutPaths(ws, missionId);
  createMissionLayout({
    workspaceDir: ws,
    missionCard: card,
    initialStatusBoard: createInitialStatusBoard(card),
  });
  const registry = createEmptyRegistry();
  const entry = newMissionRegistryEntry({
    mission_id: missionId,
    title: card.objective,
    objective: card.objective,
    lifecycle_state: "running",
    progress_status: "running",
    mission_dir: layout.missionDirRelative,
  });
  const { registry: afterAdd } = addMissionToRegistry(registry, entry);
  const withActive = setRegistryActiveMission(afterAdd, missionId);
  writeMissionRegistry(ws, withActive);
  writeActiveMissionPointer(ws, buildActiveMissionPointer({
    mission_id: missionId,
    mission_dir: layout.missionDirRelative,
    reason: "created",
    event_id: `evt_test_${missionId}_${Date.now()}`,
  }));
  return resolveActiveMissionPaths(ws);
}

// ---------------------------------------------------------------------------
// Legacy mode (no registry, no pointer) → root paths
// ---------------------------------------------------------------------------

test("resolver: legacy mode returns root paths when no registry exists", () => {
  const ws = makeWorkspace();
  try {
    writeLegacyRoot(ws, "legacy-2026-06-18-001", "legacy-proj");

    const res = resolveActiveMissionPaths(ws);
    assert.equal(res.mode, "legacy");
    assert.equal(res.missionId, "legacy-2026-06-18-001");
    assert.equal(res.project, "legacy-proj");
    assert.equal(res.missionCardPath, join(ws, ".pi", "topology", "mission-card.json"));
    assert.equal(res.statusBoardPath, join(ws, ".pi", "topology", "status-board.json"));
    assert.equal(res.sessionsPath, join(ws, ".pi", "topology", "sessions.jsonl"));
    assert.equal(res.eventLogPath, join(ws, ".pi", "topology", "runtime-events.jsonl"));
    assert.equal(res.incidentLogPath, join(ws, ".pi", "topology", "incident-log.jsonl"));
    assert.equal(res.launchDir, join(ws, ".pi", "topology", "launch"));
    assert.equal(res.artifactsDir, join(ws, ".pi", "topology", "artifacts"));
    // Mirror paths in legacy mode ARE the canonical paths.
    assert.equal(res.rootMirror.missionCardPath, join(ws, ".pi", "topology", "mission-card.json"));
    assert.equal(res.rootMirror.statusBoardPath, join(ws, ".pi", "topology", "status-board.json"));
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Per-mission mode (registry + pointer) → per-mission paths
// ---------------------------------------------------------------------------

test("resolver: per-mission mode returns missions/<id>/ paths when registry + pointer exist", () => {
  const ws = makeWorkspace();
  try {
    writePerMission(ws, "per-2026-06-18-001", "per-proj");

    const res = resolveActiveMissionPaths(ws);
    assert.equal(res.mode, "per-mission");
    assert.equal(res.missionId, "per-2026-06-18-001");
    assert.equal(res.project, "per-proj");
    assert.equal(res.missionCardPath, join(ws, ".pi", "topology", "missions", "per-2026-06-18-001", "mission-card.json"));
    assert.equal(res.statusBoardPath, join(ws, ".pi", "topology", "missions", "per-2026-06-18-001", "status-board.json"));
    assert.equal(res.sessionsPath, join(ws, ".pi", "topology", "missions", "per-2026-06-18-001", "sessions.jsonl"));
    assert.equal(res.eventLogPath, join(ws, ".pi", "topology", "missions", "per-2026-06-18-001", "runtime-events.jsonl"));
    assert.equal(res.incidentLogPath, join(ws, ".pi", "topology", "missions", "per-2026-06-18-001", "incident-log.jsonl"));
    assert.equal(res.launchDir, join(ws, ".pi", "topology", "missions", "per-2026-06-18-001", "launch"));
    assert.equal(res.artifactsDir, join(ws, ".pi", "topology", "missions", "per-2026-06-18-001", "artifacts"));
    // Root mirror paths differ from canonical in per-mission mode.
    assert.equal(res.rootMirror.missionCardPath, join(ws, ".pi", "topology", "mission-card.json"));
    assert.equal(res.rootMirror.statusBoardPath, join(ws, ".pi", "topology", "status-board.json"));
    assert.notEqual(res.missionCardPath, res.rootMirror.missionCardPath);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Env override: PI_TOPOLOGY_MISSION_CARD wins
// ---------------------------------------------------------------------------

test("resolver: PI_TOPOLOGY_MISSION_CARD env var overrides registry", () => {
  const ws = makeWorkspace();
  try {
    writePerMission(ws, "per-2026-06-18-002", "per-proj-2");
    const envPath = join(ws, ".pi", "topology", "missions", "per-2026-06-18-002", "mission-card.json");
    const previous = process.env.PI_TOPOLOGY_MISSION_CARD;
    try {
      process.env.PI_TOPOLOGY_MISSION_CARD = envPath;
      const res = resolveActiveMissionPaths(ws);
      assert.equal(res.mode, "per-mission");
      assert.equal(res.missionCardPath, envPath);
    } finally {
      if (previous === undefined) delete process.env.PI_TOPOLOGY_MISSION_CARD;
      else process.env.PI_TOPOLOGY_MISSION_CARD = previous;
    }
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// No mission at all → "none"
// ---------------------------------------------------------------------------

test("resolver: empty workspace returns mode 'none'", () => {
  const ws = makeWorkspace();
  try {
    const res = resolveActiveMissionPaths(ws);
    assert.equal(res.mode, "none");
    assert.equal(res.missionId, null);
    assert.equal(res.missionCardPath, null);
    assert.equal(res.statusBoardPath, null);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Stale pointer (pointer points to non-existent mission dir) → graceful none
// ---------------------------------------------------------------------------

test("resolver: stale pointer (pointed mission_dir missing) returns mode 'none' with warning", () => {
  const ws = makeWorkspace();
  try {
    // Write a registry with active_mission_id pointing to a non-existent mission dir.
    mkdirSync(join(ws, ".pi", "topology"), { recursive: true });
    writeMissionRegistry(ws, {
      version: 1,
      active_mission_id: "ghost-mission-2026-06-18-001",
      updated_at: new Date().toISOString(),
      missions: [{
        mission_id: "ghost-mission-2026-06-18-001",
        mission_dir: ".pi/topology/missions/ghost-mission-2026-06-18-001",
        title: "ghost",
        objective: "ghost",
        lifecycle_state: "draft",
        progress_status: "draft",
        owner_gate: "required",
        blocked: false,
        archived: false,
        last_updated_at: new Date().toISOString(),
        role_summary: { live: 0, resumable: 0, stale: 0, parked: 0, closed: 0 },
        pending_packet_count: 0,
        incident_count: 0,
        closeout_path: null,
      }],
    });
    const res = resolveActiveMissionPaths(ws);
    assert.equal(res.mode, "none");
    assert.equal(res.missionId, null);
    assert.ok(res.warnings.some((w) => /stale|missing|ghost/i.test(w)),
      `expected warning about stale/missing mission_dir, got: ${JSON.stringify(res.warnings)}`);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Dashboard should agree with the resolver (single source of truth)
// ---------------------------------------------------------------------------

test("resolver: dashboard's paths field agrees with resolver paths", () => {
  const ws = makeWorkspace();
  try {
    writePerMission(ws, "per-2026-06-18-003", "per-proj-3");
    const res = resolveActiveMissionPaths(ws);
    const dashboard = readDashboardSnapshot(ws);
    assert.equal(dashboard.has_active_mission, true);
    assert.equal(dashboard.active_mission_id, "per-2026-06-18-003");
    assert.equal(dashboard.paths.mission_card_path, res.missionCardPath);
    assert.equal(dashboard.paths.status_board_path, res.statusBoardPath);
    assert.equal(dashboard.paths.sessions_path, res.sessionsPath);
    assert.equal(dashboard.paths.incident_log_path, res.incidentLogPath);
    assert.equal(dashboard.paths.packet_ledger_path, res.packetLedgerPath);
    assert.equal(dashboard.paths.artifacts_dir, res.artifactsDir);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Root mirror sync keeps root copies in sync with per-mission canonical
// ---------------------------------------------------------------------------

test("resolver: syncRootMirrorFromLayout brings root mirror to byte-for-byte match with per-mission", () => {
  const ws = makeWorkspace();
  try {
    writePerMission(ws, "per-2026-06-18-004", "per-proj-4");
    const res = resolveActiveMissionPaths(ws);
    assert.equal(res.mode, "per-mission");
    if (res.mode !== "per-mission") return;
    // Mutate the per-mission status-board.json so it diverges from any
    // (currently identical) root mirror copy.
    const layout = missionLayoutPaths(ws, res.missionId!);
    const newBoard = { ...createInitialStatusBoard({
      ...createMissionDraft({ project: "per-proj-4", workdir: ws, objective: "x", allowed_paths: [ws] }),
      mission_id: res.missionId!,
    }), runtime_phase: "running" };
    writeFileSync(layout.statusBoardPath, JSON.stringify(newBoard, null, 2), "utf8");
    // Sync the mirror.
    syncRootMirrorFromLayout(ws, layout);
    // Now both per-mission and root mirror status-board should be identical.
    assert.equal(existsSync(res.rootMirror.statusBoardPath!), true);
    const a = readFileSync(layout.statusBoardPath, "utf8");
    const b = readFileSync(res.rootMirror.statusBoardPath!, "utf8");
    assert.equal(a, b);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
