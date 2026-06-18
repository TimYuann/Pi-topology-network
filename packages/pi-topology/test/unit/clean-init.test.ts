/**
 * Slice D2 (v0.5.1.5 / "5.2 tail") regression: clean workspace init goes
 * through the canonical createMissionFlow, not the legacy root-only path.
 *
 * Verifies that:
 *   1. topology_init_mission tool on a clean workspace creates
 *      missions/<id>/ + registry + active pointer (canonical v0.5 form).
 *   2. /topology init <objective> slash command on a clean workspace does
 *      the same.
 *   3. The legacy root mission-card.json / status-board.json are
 *      compatibility mirrors after init, not the source of truth.
 *   4. After clean init, all topology_* tools resolve to per-mission mode.
 *   5. Resolver agrees: mode "per-mission", missionId matches.
 *
 * Part of the v0.5.1.5 "5.2 tail" runtime alignment repair.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { registerPiTopology } from "../../src/extension/register.ts";
import { resolveActiveMissionPaths } from "../../src/runtime/active-mission-resolver.ts";
import { readMissionRegistry } from "../../src/runtime/mission-registry.ts";
import { readActiveMissionPointer } from "../../src/runtime/mission-pointer.ts";
import { missionLayoutPaths } from "../../src/runtime/mission-layout.ts";

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
    registerTool: (tool) => {
      tools[tool.name] = tool;
    },
    registerCommand: (name, cmd) => {
      commands[name] = cmd;
    },
    on: () => {},
    registerFlag: () => {},
    getFlag: () => undefined,
  };
  registerPiTopology(pi);
  return { pi, tools, commands };
}

function makeWorkspace(): string {
  return mkdtempSync(join(tmpdir(), "pi-topology-clean-init-"));
}

function readDetails(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== "object") return {};
  return ((result as { details?: unknown }).details as Record<string, unknown> | undefined) ?? {};
}

function readText(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const content = (result as { content?: Array<{ text?: string }> }).content;
  if (!Array.isArray(content) || !content[0] || typeof content[0].text !== "string") return "";
  return content[0].text;
}

// ---------------------------------------------------------------------------
// P1: topology_init_mission tool on clean workspace creates canonical layout
// ---------------------------------------------------------------------------

test("topology_init_mission on clean workspace creates per-mission layout + registry + active pointer", async () => {
  const ws = makeWorkspace();
  const { tools } = setupPi();
  try {
    // Confirm pre-state: no registry, no pointer, no missions dir.
    assert.equal(existsSync(join(ws, ".pi", "topology", "mission-registry.json")), false);
    assert.equal(existsSync(join(ws, ".pi", "topology", "active-mission.json")), false);
    assert.equal(existsSync(join(ws, ".pi", "topology", "missions")), false);

    const result = (await tools.topology_init_mission.execute(
      "init",
      { objective: "Clean init creates canonical v0.5 layout", project: "clean-init-proj", allowed_paths: [ws] },
      undefined,
      undefined,
      { cwd: ws },
    )) as { content: Array<{ text: string }>; details: Record<string, unknown> };
    assert.match(readText(result), /mission initialized/);

    // Post-state: registry + pointer + missions dir all present.
    const registry = readMissionRegistry(ws);
    assert.ok(registry, "mission-registry.json must exist after clean init");
    const pointer = readActiveMissionPointer(ws);
    assert.ok(pointer, "active-mission.json must exist after clean init");
    assert.ok(pointer?.mission_id, "pointer must reference a mission_id");
    const missionId = pointer!.mission_id!;

    // Per-mission layout files exist.
    const layout = missionLayoutPaths(ws, missionId);
    assert.equal(existsSync(layout.missionDirAbsolute), true, `mission dir ${layout.missionDirAbsolute} must exist`);
    assert.equal(existsSync(layout.missionCardPath), true);
    assert.equal(existsSync(layout.statusBoardPath), true);
    assert.equal(existsSync(layout.runtimeEventsPath), true);
    assert.equal(existsSync(layout.incidentLogPath), true);
    assert.equal(existsSync(layout.sessionsPath), true);
    assert.equal(existsSync(layout.launchDir), true);
    assert.equal(existsSync(layout.artifactsDir), true);

    // Resolver agrees: per-mission mode.
    const res = resolveActiveMissionPaths(ws);
    assert.equal(res.mode, "per-mission");
    assert.equal(res.missionId, missionId);
    // Details from the tool should expose the per-mission missionPath.
    const details = readDetails(result);
    const missionPath = String(details.missionPath ?? "");
    assert.match(missionPath, new RegExp(`missions/${missionId}/mission-card\\.json`));
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("topology_init_mission on clean workspace mirrors root files for backward compat", async () => {
  const ws = makeWorkspace();
  const { tools } = setupPi();
  try {
    await tools.topology_init_mission.execute(
      "init",
      { objective: "Mirror check after clean init", project: "clean-init-mirror", allowed_paths: [ws] },
      undefined,
      undefined,
      { cwd: ws },
    );
    // Root mirror files exist as compatibility copies.
    assert.equal(existsSync(join(ws, ".pi", "topology", "mission-card.json")), true);
    assert.equal(existsSync(join(ws, ".pi", "topology", "status-board.json")), true);
    assert.equal(existsSync(join(ws, ".pi", "topology", "runtime-events.jsonl")), true);
    assert.equal(existsSync(join(ws, ".pi", "topology", "incident-log.jsonl")), true);
    assert.equal(existsSync(join(ws, ".pi", "topology", "sessions.jsonl")), true);
    // Root mission-card.json content is a mirror of the per-mission copy.
    const pointer = readActiveMissionPointer(ws)!;
    const layout = missionLayoutPaths(ws, pointer.mission_id);
    const perMission = JSON.parse(readFileSync(layout.missionCardPath, "utf8")) as { mission_id?: string };
    const rootMirror = JSON.parse(readFileSync(join(ws, ".pi", "topology", "mission-card.json"), "utf8")) as { mission_id?: string };
    assert.equal(perMission.mission_id, rootMirror.mission_id);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// P1: /topology init slash command on clean workspace creates canonical layout
// ---------------------------------------------------------------------------

test("/topology init on clean workspace creates per-mission layout + registry + active pointer", async () => {
  const ws = makeWorkspace();
  const { commands } = setupPi();
  try {
    const handler = commands["topology"]?.handler;
    assert.ok(handler, "topology command must be registered");
    const result = (await handler("init Clean init from slash command", { cwd: ws })) as string;
    assert.match(result, /initialized mission|ACK topology-supervisor/);

    const registry = readMissionRegistry(ws);
    assert.ok(registry, "mission-registry.json must exist after /topology init on clean workspace");
    const pointer = readActiveMissionPointer(ws);
    assert.ok(pointer, "active-mission.json must exist after /topology init on clean workspace");

    const res = resolveActiveMissionPaths(ws);
    assert.equal(res.mode, "per-mission");
    assert.ok(res.missionId);
    const layout = missionLayoutPaths(ws, res.missionId!);
    assert.equal(existsSync(layout.missionDirAbsolute), true);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("/topology init on clean workspace is rejected when no objective is given", async () => {
  const ws = makeWorkspace();
  const { commands } = setupPi();
  try {
    const handler = commands["topology"]?.handler;
    assert.ok(handler);
    const result = (await handler("init", { cwd: ws })) as string;
    assert.match(result, /task goal or task card/i);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// After clean init, all topology_* tools are per-mission
// ---------------------------------------------------------------------------

test("after clean init, topology_status reports per-mission paths", async () => {
  const ws = makeWorkspace();
  const { tools } = setupPi();
  try {
    await tools.topology_init_mission.execute(
      "init",
      { objective: "Status after clean init", project: "clean-init-status", allowed_paths: [ws] },
      undefined, undefined, { cwd: ws },
    );
    const statusResult = (await tools.topology_status.execute(
      "status",
      {},
      undefined, undefined, { cwd: ws },
    )) as { content: Array<{ text: string }>; details: Record<string, unknown> };
    const details = readDetails(statusResult);
    const statusPath = String(details.statusPath ?? "");
    const sessionLedgerPath = String(details.sessionLedgerPath ?? "");
    const eventPath = String(details.eventPath ?? "");
    assert.match(statusPath, /\.pi\/topology\/missions\/[^/]+\/status-board\.json/);
    assert.match(sessionLedgerPath, /\.pi\/topology\/missions\/[^/]+\/sessions\.jsonl/);
    assert.match(eventPath, /\.pi\/topology\/missions\/[^/]+\/runtime-events\.jsonl/);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});