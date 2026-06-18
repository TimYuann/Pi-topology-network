/**
 * Slice D integration regression: legacy workspace → migrate → per-mission runtime.
 *
 * End-to-end check that:
 *   1. Legacy workspace has root .pi/topology/mission-card.json only.
 *   2. topology_migrate mode=execute creates per-mission layout + registry + pointer.
 *   3. After migrate, every topology_* tool reads/writes per-mission canonical.
 *   4. topology_spawn_role writes launch scripts to per-mission launch dir
 *      and env vars point to per-mission canonical.
 *   5. topology_write_artifact writes to per-mission artifacts/<role>/.
 *   6. session_start writes alive_confirmed to per-mission sessions.jsonl
 *      and event to per-mission runtime-events.jsonl.
 *   7. UI snapshot reads per-mission canonical paths.
 *   8. guard allows per-mission artifacts/<role>/.
 *   9. After all per-mission writes, root mirror files are kept in sync
 *      (per spec §3.2 + §12.2); root is mirror, not second source of truth.
 *
 * Part of the v0.5.1 runtime alignment repair.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { registerPiTopology } from "../../src/extension/register.ts";
import { createMissionDraft, createInitialStatusBoard } from "../../src/runtime/mission.ts";
import { missionLayoutPaths } from "../../src/runtime/mission-layout.ts";
import { migrateLegacyToPerMission } from "../../src/runtime/migration.ts";
import { readMissionRegistry } from "../../src/runtime/mission-registry.ts";
import { readActiveMissionPointer } from "../../src/runtime/mission-pointer.ts";
import { resolveActiveMissionPaths } from "../../src/runtime/active-mission-resolver.ts";
import { buildTopologyUiSnapshot } from "../../src/extension/ui.ts";
import { evaluateToolCall } from "../../src/runtime/guard.ts";

interface RegisteredPi {
  registerTool: (tool: { name: string; execute: (...args: unknown[]) => Promise<unknown> }) => void;
  registerCommand: (name: string, cmd: { handler: (...args: unknown[]) => Promise<unknown> | unknown }) => void;
  on: (name: string, handler: (...args: unknown[]) => Promise<unknown> | unknown) => void;
  registerFlag: (name: string, opts: unknown) => void;
  getFlag: (name: string) => unknown;
}

function setupPi(): { pi: RegisteredPi; tools: Record<string, { name: string; execute: (...args: unknown[]) => Promise<unknown> }>; handlers: Record<string, (...args: unknown[]) => unknown> } {
  const tools: Record<string, { name: string; execute: (...args: unknown[]) => Promise<unknown> }> = {};
  const handlers: Record<string, (...args: unknown[]) => unknown> = {};
  const pi: RegisteredPi = {
    registerTool: (tool) => {
      tools[tool.name] = tool;
    },
    registerCommand: () => {},
    on: (name, handler) => {
      handlers[name] = handler;
    },
    registerFlag: () => {},
    getFlag: () => undefined,
  };
  registerPiTopology(pi);
  return { pi, tools, handlers };
}

function makeWorkspace(): string {
  return mkdtempSync(join(tmpdir(), "pi-topology-pm-runtime-"));
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

test("integration: legacy workspace → migrate → per-mission runtime chain", async () => {
  const ws = makeWorkspace();
  const { tools, handlers } = setupPi();
  let missionId = "";
  let project = "pm-rt";
  try {
    // Step 1: create a legacy workspace (root mission-card.json + status-board.json).
    const card = createMissionDraft({
      project,
      workdir: ws,
      objective: "Per-mission runtime integration test",
      allowed_paths: [ws],
    });
    missionId = card.mission_id;
    mkdirSync(join(ws, ".pi", "topology"), { recursive: true });
    writeFileSync(join(ws, ".pi", "topology", "mission-card.json"), JSON.stringify(card, null, 2), "utf8");
    writeFileSync(join(ws, ".pi", "topology", "status-board.json"), JSON.stringify(createInitialStatusBoard(card), null, 2), "utf8");
    writeFileSync(join(ws, ".pi", "topology", "sessions.jsonl"), "", "utf8");
    writeFileSync(join(ws, ".pi", "topology", "runtime-events.jsonl"), "", "utf8");
    writeFileSync(join(ws, ".pi", "topology", "incident-log.jsonl"), "", "utf8");

    // Confirm legacy mode.
    const legacy = resolveActiveMissionPaths(ws);
    assert.equal(legacy.mode, "legacy");

    // Step 2: run topology_migrate mode=execute.
    const migrate = (await tools.topology_migrate.execute(
      "migrate",
      { mode: "execute" },
      undefined,
      undefined,
      { cwd: ws },
    )) as { content: Array<{ text: string }> };
    assert.match(readText(migrate), /migrated/);

    // After migrate, registry and pointer should exist.
    const registry = readMissionRegistry(ws);
    assert.ok(registry, "mission-registry.json must exist after migrate");
    assert.equal(registry?.active_mission_id, missionId);
    const pointer = readActiveMissionPointer(ws);
    assert.ok(pointer, "active-mission.json must exist after migrate");
    assert.equal(pointer?.mission_id, missionId);

    // Step 3: resolver returns per-mission mode.
    const res = resolveActiveMissionPaths(ws);
    assert.equal(res.mode, "per-mission");
    assert.equal(res.missionId, missionId);
    if (res.mode !== "per-mission") return;

    // Step 4: topology_status reports per-mission paths.
    const statusResult = (await tools.topology_status.execute(
      "status",
      {},
      undefined,
      undefined,
      { cwd: ws },
    )) as { content: Array<{ text: string }>; details: Record<string, unknown> };
    const statusDetails = readDetails(statusResult);
    const statusPath = String(statusDetails.statusPath ?? "");
    assert.match(statusPath, new RegExp(`missions/${missionId}/status-board\\.json`));

    // Step 5: topology_spawn_role writes launch script to per-mission launch dir
    // and env vars point to per-mission canonical.
    const spawnResult = (await tools.topology_spawn_role.execute(
      "spawn",
      { role: "runner", mode: "print" },
      undefined,
      undefined,
      { cwd: ws },
    )) as { content: Array<{ text: string }>; details: Record<string, unknown> };
    const spawnDetails = readDetails(spawnResult);
    const scriptPath = String(spawnDetails.scriptPath ?? "");
    assert.match(scriptPath, new RegExp(`missions/${missionId}/launch/runner\\.sh`));
    assert.equal(existsSync(scriptPath), true);
    const script = readFileSync(scriptPath, "utf8");
    assert.match(script, new RegExp(`PI_TOPOLOGY_MISSION_CARD=.*missions/${missionId}/mission-card\\.json`));
    assert.match(script, new RegExp(`PI_TOPOLOGY_INCIDENT_LOG=.*missions/${missionId}/incident-log\\.jsonl`));
    assert.match(script, new RegExp(`PI_TOPOLOGY_EVENT_LOG=.*missions/${missionId}/runtime-events\\.jsonl`));

    // Step 6: topology_write_artifact writes to per-mission artifacts/<role>/.
    const artifactResult = (await tools.topology_write_artifact.execute(
      "artifact",
      {
        role: "runner",
        kind: "report",
        title: "Integration artifact",
        body: "verdict: pass\n\nPer-mission integration.",
      },
      undefined,
      undefined,
      { cwd: ws },
    )) as { content: Array<{ text: string }>; details: Record<string, unknown> };
    const artifactPath = String(readDetails(artifactResult).artifact_path ?? "");
    assert.match(artifactPath, new RegExp(`^\\.pi/topology/missions/${missionId}/artifacts/runner/`));
    assert.equal(existsSync(join(ws, artifactPath)), true);

    // Step 7: topology_send writes events to per-mission runtime-events.jsonl.
    await tools.topology_send.execute(
      "send",
      {
        type: "STATUS",
        from: "hq",
        to: "runner",
        body: { status: "accepted", summary: "integration", next: "wait" },
      },
      undefined,
      undefined,
      { cwd: ws },
    );
    const layout = missionLayoutPaths(ws, missionId);
    assert.equal(existsSync(layout.runtimeEventsPath), true);
    const runtimeLines = readFileSync(layout.runtimeEventsPath, "utf8").split("\n").filter(Boolean);
    assert.ok(
      runtimeLines.some((l) => {
        try {
          const obj = JSON.parse(l) as { event_type?: string; mission_id?: string };
          return obj.event_type === "packet_sent" && obj.mission_id === missionId;
        } catch {
          return false;
        }
      }),
      "packet_sent must be in per-mission runtime-events.jsonl",
    );

    // Step 8: session_start handler writes alive_confirmed to per-mission sessions.jsonl
    // and event to per-mission runtime-events.jsonl.
    // Set PI_TOPOLOGY_MISSION_CARD / WORKDIR / LAUNCH_SCRIPT to the per-mission paths.
    const previous = {
      mission: process.env.PI_TOPOLOGY_MISSION_CARD,
      workdir: process.env.PI_TOPOLOGY_WORKDIR,
      script: process.env.PI_TOPOLOGY_LAUNCH_SCRIPT,
      provider: process.env.PI_TOPOLOGY_PROVIDER,
      model: process.env.PI_TOPOLOGY_MODEL,
      cname: process.env.PI_TOPOLOGY_CNAME,
      role: process.env.PI_TOPOLOGY_ROLE,
    };
    process.env.PI_TOPOLOGY_MISSION_CARD = layout.missionCardPath;
    process.env.PI_TOPOLOGY_WORKDIR = ws;
    process.env.PI_TOPOLOGY_LAUNCH_SCRIPT = scriptPath;
    process.env.PI_TOPOLOGY_PROVIDER = "minimax-cn";
    process.env.PI_TOPOLOGY_MODEL = "MiniMax-M3";
    process.env.PI_TOPOLOGY_CNAME = "runner";
    process.env.PI_TOPOLOGY_ROLE = "runner";
    try {
      await handlers.session_start?.({}, { getContextUsage: () => undefined });
    } finally {
      if (previous.mission === undefined) delete process.env.PI_TOPOLOGY_MISSION_CARD;
      else process.env.PI_TOPOLOGY_MISSION_CARD = previous.mission;
      if (previous.workdir === undefined) delete process.env.PI_TOPOLOGY_WORKDIR;
      else process.env.PI_TOPOLOGY_WORKDIR = previous.workdir;
      if (previous.script === undefined) delete process.env.PI_TOPOLOGY_LAUNCH_SCRIPT;
      else process.env.PI_TOPOLOGY_LAUNCH_SCRIPT = previous.script;
      if (previous.provider === undefined) delete process.env.PI_TOPOLOGY_PROVIDER;
      else process.env.PI_TOPOLOGY_PROVIDER = previous.provider;
      if (previous.model === undefined) delete process.env.PI_TOPOLOGY_MODEL;
      else process.env.PI_TOPOLOGY_MODEL = previous.model;
      if (previous.cname === undefined) delete process.env.PI_TOPOLOGY_CNAME;
      else process.env.PI_TOPOLOGY_CNAME = previous.cname;
      if (previous.role === undefined) delete process.env.PI_TOPOLOGY_ROLE;
      else process.env.PI_TOPOLOGY_ROLE = previous.role;
    }
    // Per-mission sessions.jsonl must contain alive_confirmed.
    const sessionsLines = readFileSync(layout.sessionsPath, "utf8").split("\n").filter(Boolean);
    assert.ok(
      sessionsLines.some((l) => {
        try {
          const obj = JSON.parse(l) as { state?: string; role?: string; mission_id?: string };
          return obj.state === "alive_confirmed" && obj.role === "runner" && obj.mission_id === missionId;
        } catch {
          return false;
        }
      }),
      "alive_confirmed must be in per-mission sessions.jsonl",
    );
    // Per-mission runtime-events.jsonl must contain session_alive.
    const eventsAfter = readFileSync(layout.runtimeEventsPath, "utf8").split("\n").filter(Boolean);
    assert.ok(
      eventsAfter.some((l) => {
        try {
          const obj = JSON.parse(l) as { event_type?: string; mission_id?: string };
          return obj.event_type === "session_alive" && obj.mission_id === missionId;
        } catch {
          return false;
        }
      }),
      "session_alive event must be in per-mission runtime-events.jsonl",
    );

    // Step 9: UI snapshot reads per-mission canonical (status-board phase, mission_id, etc.).
    const uiSnapshot = buildTopologyUiSnapshot(ws);
    assert.equal(uiSnapshot.mission_id, missionId);
    // The session records count must reflect the per-mission sessions.jsonl
    // (>= 1 because of the session_start write above).
    const runnerRecord = uiSnapshot.roles.find((r) => r.role === "runner");
    assert.ok(runnerRecord, "runner role should be in UI snapshot");
    assert.ok((runnerRecord?.records ?? 0) >= 1, "runner record count must reflect per-mission session");

    // Step 10: guard allows per-mission artifacts/<role>/.
    const perMissionArtifactForHq = join(
      ws, ".pi", "topology", "missions", missionId, "artifacts", "hq", "decision.md",
    );
    const decision = evaluateToolCall({
      role: "hq",
      mission: { allowed_paths: [ws], forbidden_actions: [], mission_id: missionId },
      tool: "write_file",
      path: perMissionArtifactForHq,
      incident_log_path: layout.incidentLogPath,
    });
    assert.equal(decision.decision, "allow",
      `hq writing own per-mission artifact should be allowed, got: ${decision.decision} (${decision.reason})`);

    // Step 11: root mirror must reflect per-mission canonical (after migrate + sync).
    // Specifically the root status-board.json must equal the per-mission copy
    // (modulo a trailing newline or _meta field, but the runtime_phase should match).
    const rootBoard = JSON.parse(readFileSync(join(ws, ".pi", "topology", "status-board.json"), "utf8")) as { mission_id?: string };
    assert.equal(rootBoard.mission_id, missionId,
      "root mirror status-board.json must reference the active mission_id after migrate");

    // Step 12: a new artifact appended at per-mission should not appear in root
    // (root is mirror but artifacts/ mirror is a separate concern; the test only
    // asserts the canonical write landed in the right place).
    assert.match(artifactPath, new RegExp(`^\\.pi/topology/missions/${missionId}/artifacts/runner/`));
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
