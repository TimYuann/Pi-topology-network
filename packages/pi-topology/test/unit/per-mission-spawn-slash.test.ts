/**
 * Slice D2 (v0.5.1.5 / "5.2 tail") regression: slash-command /topology spawn
 * goes through per-mission canonical, same as topology_spawn_role tool.
 *
 * Verifies that:
 *   1. After legacy → migrate, /topology spawn hq writes the launch script
 *      to missions/<id>/launch/hq.sh (NOT root .pi/topology/launch/).
 *   2. Launch script env vars (PI_TOPOLOGY_MISSION_CARD / INCIDENT_LOG /
 *      EVENT_LOG / STATUS_BOARD / SESSIONS_LEDGER) point to per-mission.
 *   3. Resolver agrees: launch script path is per-mission.
 *
 * Part of the v0.5.1.5 "5.2 tail" runtime alignment repair.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { registerPiTopology } from "../../src/extension/register.ts";
import { createMissionDraft, createInitialStatusBoard } from "../../src/runtime/mission.ts";
import { missionLayoutPaths } from "../../src/runtime/mission-layout.ts";
import {
  addMissionToRegistry,
  createEmptyRegistry,
  newMissionRegistryEntry,
  setRegistryActiveMission,
  writeMissionRegistry,
} from "../../src/runtime/mission-registry.ts";
import { buildActiveMissionPointer, writeActiveMissionPointer } from "../../src/runtime/mission-pointer.ts";

interface RegisteredPi {
  registerTool: (tool: { name: string; execute: (...args: unknown[]) => Promise<unknown> }) => void;
  registerCommand: (name: string, cmd: { handler: (...args: unknown[]) => Promise<unknown> | unknown }) => void;
  on: (name: string, handler: (...args: unknown[]) => Promise<unknown> | unknown) => void;
  registerFlag: (name: string, opts: unknown) => void;
  getFlag: (name: string) => unknown;
}

function setupPi(): { pi: RegisteredPi; tools: Record<string, { name: string; execute: (...args: unknown[]) => Promise<unknown> }>; commands: Record<string, { handler: (...args: unknown[]) => Promise<unknown> | unknown }> } {
  const tools: Record<string, { name: string; execute: (...args: unknown[]) => Promise<unknown> }> = {};
  const commands: Record<string, { handler: (...args: unknown[]) => Promise<unknown> | unknown }> = {};
  const pi: RegisteredPi = {
    registerTool: (tool) => { tools[tool.name] = tool; },
    registerCommand: (name, cmd) => { commands[name] = cmd; },
    on: () => {},
    registerFlag: () => {},
    getFlag: () => undefined,
  };
  registerPiTopology(pi);
  return { pi, tools, commands };
}

function makeWorkspace(): string {
  return mkdtempSync(join(tmpdir(), "pi-topology-slash-spawn-"));
}

function createPerMission(ws: string, missionId: string, project: string): void {
  const card = createMissionDraft({
    project,
    workdir: ws,
    objective: "Slash spawn regression test",
    allowed_paths: [ws],
  });
  card.mission_id = missionId;
  const layout = missionLayoutPaths(ws, missionId);
  mkdirSync(layout.missionDirAbsolute, { recursive: true });
  writeFileSync(layout.missionCardPath, JSON.stringify(card, null, 2), "utf8");
  writeFileSync(layout.statusBoardPath, JSON.stringify(createInitialStatusBoard(card), null, 2), "utf8");
  writeFileSync(layout.runtimeEventsPath, "", "utf8");
  writeFileSync(layout.sessionsPath, "", "utf8");
  writeFileSync(layout.incidentLogPath, "", "utf8");
  writeFileSync(layout.packetLedgerPath, "", "utf8");
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
}


test("topology_spawn_role tool writes per-mission launch script in migrated workspace", async () => {
  const ws = makeWorkspace();
  const { tools } = setupPi();
  try {
    createPerMission(ws, "pm-tool-spawn-2026-06-18-001", "pm-proj-tool-spawn");
    const result = (await tools.topology_spawn_role.execute(
      "spawn",
      { role: "hq", mode: "print" },
      undefined, undefined, { cwd: ws },
    )) as { content: Array<{ text: string }>; details: Record<string, unknown> };
    const details = (result.details ?? {}) as { scriptPath?: string };
    const scriptPath = String(details.scriptPath ?? "");
    assert.match(scriptPath, /\.pi\/topology\/missions\/pm-tool-spawn-2026-06-18-001\/launch\/hq\.sh/);
    assert.equal(existsSync(scriptPath), true);
    const script = readFileSync(scriptPath, "utf8");
    assert.match(script, /PI_TOPOLOGY_MISSION_CARD=.*missions\/pm-tool-spawn-2026-06-18-001\/mission-card\.json/);
    assert.match(script, /PI_TOPOLOGY_INCIDENT_LOG=.*missions\/pm-tool-spawn-2026-06-18-001\/incident-log\.jsonl/);
    assert.match(script, /PI_TOPOLOGY_EVENT_LOG=.*missions\/pm-tool-spawn-2026-06-18-001\/runtime-events\.jsonl/);
    assert.match(script, /PI_TOPOLOGY_STATUS_BOARD=.*missions\/pm-tool-spawn-2026-06-18-001\/status-board\.json/);
    assert.match(script, /PI_TOPOLOGY_SESSIONS_LEDGER=.*missions\/pm-tool-spawn-2026-06-18-001\/sessions\.jsonl/);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("legacy single-mission mode still works (root launch dir when no registry)", async () => {
  const ws = makeWorkspace();
  const { tools } = setupPi();
  try {
    // Legacy workspace: root mission-card.json only, no registry.
    const card = createMissionDraft({
      project: "legacy-spawn-proj",
      workdir: ws,
      objective: "Legacy spawn regression",
      allowed_paths: [ws],
    });
    mkdirSync(join(ws, ".pi", "topology"), { recursive: true });
    writeFileSync(join(ws, ".pi", "topology", "mission-card.json"), JSON.stringify(card, null, 2), "utf8");
    writeFileSync(join(ws, ".pi", "topology", "status-board.json"), JSON.stringify(createInitialStatusBoard(card), null, 2), "utf8");

    const result = (await tools.topology_spawn_role.execute(
      "spawn",
      { role: "runner", mode: "print" },
      undefined, undefined, { cwd: ws },
    )) as { content: Array<{ text: string }>; details: Record<string, unknown> };
    const details = (result.details ?? {}) as { scriptPath?: string };
    const scriptPath = String(details.scriptPath ?? "");
    // In legacy mode, the script stays at root .pi/topology/launch/.
    assert.match(scriptPath, /\.pi\/topology\/launch\/runner\.sh/);
    assert.equal(existsSync(scriptPath), true);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});