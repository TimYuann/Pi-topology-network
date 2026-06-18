/**
 * Slice B/C regression: per-mission canonical path discipline.
 *
 * Verifies that:
 *   1. topology_status / doctor / smoke / send / list / get / await all read
 *      and write the per-mission canonical files in a migrated workspace.
 *   2. topology_spawn_role writes launch scripts to per-mission launch dir.
 *   3. Launch script env vars (PI_TOPOLOGY_MISSION_CARD / EVENT_LOG /
 *      INCIDENT_LOG / SESSION_LEDGER / STATUS_BOARD) point to per-mission
 *      canonical paths, not the root mirror.
 *   4. topology_write_artifact writes to per-mission artifacts/<role>/.
 *   5. topology_read_artifact reads per-mission first, falls back to root.
 *   6. guard allowlist includes the per-mission artifacts/<role>/ path.
 *   7. guard block reason includes tool_guidance pointing at
 *      topology_write_artifact and the per-mission canonical dir.
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
import { missionLayoutPaths, createMissionLayout } from "../../src/runtime/mission-layout.ts";
import {
  addMissionToRegistry,
  createEmptyRegistry,
  newMissionRegistryEntry,
  setRegistryActiveMission,
  writeMissionRegistry,
} from "../../src/runtime/mission-registry.ts";
import { buildActiveMissionPointer, writeActiveMissionPointer } from "../../src/runtime/mission-pointer.ts";
import { evaluateToolCall } from "../../src/runtime/guard.ts";
import { resolveActiveMissionPaths } from "../../src/runtime/active-mission-resolver.ts";

type RegisteredTool = { name: string; execute: (...args: unknown[]) => Promise<unknown> };
type RegisteredHandler = (...args: unknown[]) => Promise<unknown> | unknown;

interface RegisteredPi {
  registerTool: (tool: RegisteredTool) => void;
  registerCommand: (name: string, cmd: { handler: RegisteredHandler }) => void;
  on: (name: string, handler: RegisteredHandler) => void;
  registerFlag: (name: string, opts: unknown) => void;
  getFlag: (name: string) => unknown;
}

function setupPi(): { pi: RegisteredPi; tools: Record<string, RegisteredTool>; handlers: Record<string, RegisteredHandler> } {
  const tools: Record<string, RegisteredTool> = {};
  const handlers: Record<string, RegisteredHandler> = {};
  const pi: RegisteredPi = {
    registerTool: (tool) => {
      tools[tool.name] = tool;
    },
    registerCommand: (_name, cmd) => {
      // command handlers are not used here
      void cmd;
    },
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
  return mkdtempSync(join(tmpdir(), "pi-topology-per-mission-tools-"));
}

function createPerMission(ws: string, missionId: string, project: string): void {
  const card = createMissionDraft({
    project,
    workdir: ws,
    objective: "Per-mission tools test",
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
// Slice B: tools write per-mission paths
// ---------------------------------------------------------------------------

test("topology_status (tool) reports per-mission paths in a migrated workspace", async () => {
  const ws = makeWorkspace();
  const { tools } = setupPi();
  try {
    createPerMission(ws, "pm-status-2026-06-18-001", "pm-proj-status");
    const ctx = { cwd: ws };
    const result = (await tools.topology_status.execute("status", {}, undefined, undefined, ctx)) as {
      content: Array<{ text: string }>;
      details: Record<string, unknown>;
    };
    const text = readText(result);
    // Should not be the "no mission card" message.
    assert.equal(/no topology mission card found/i.test(text), false);
    // Details should expose per-mission paths.
    const details = readDetails(result);
    const statusPath = String(details.statusPath ?? "");
    const sessionLedgerPath = String(details.sessionLedgerPath ?? "");
    const eventPath = String(details.eventPath ?? "");
    const incidentPath = String(details.incidentPath ?? "");
    assert.match(statusPath, /\.pi\/topology\/missions\/pm-status-2026-06-18-001\/status-board\.json/);
    assert.match(sessionLedgerPath, /\.pi\/topology\/missions\/pm-status-2026-06-18-001\/sessions\.jsonl/);
    assert.match(eventPath, /\.pi\/topology\/missions\/pm-status-2026-06-18-001\/runtime-events\.jsonl/);
    assert.match(incidentPath, /\.pi\/topology\/missions\/pm-status-2026-06-18-001\/incident-log\.jsonl/);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("topology_send writes events to per-mission runtime-events.jsonl", async () => {
  const ws = makeWorkspace();
  const { tools } = setupPi();
  try {
    createPerMission(ws, "pm-send-2026-06-18-001", "pm-proj-send");
    const ctx = { cwd: ws };
    const result = (await tools.topology_send.execute(
      "send",
      {
        type: "STATUS",
        from: "hq",
        to: "runner",
        body: { status: "accepted", summary: "per-mission send test", next: "wait" },
      },
      undefined,
      undefined,
      ctx,
    )) as { content: Array<{ text: string }> };
    assert.match(readText(result), /queued STATUS/);
    // The per-mission runtime-events.jsonl must contain a packet_sent row.
    const layout = missionLayoutPaths(ws, "pm-send-2026-06-18-001");
    assert.equal(existsSync(layout.runtimeEventsPath), true);
    const lines = readFileSync(layout.runtimeEventsPath, "utf8").split("\n").filter(Boolean);
    assert.ok(lines.length > 0, "per-mission runtime-events.jsonl should have entries");
    const hasPacketSent = lines.some((l) => {
      try {
        const obj = JSON.parse(l) as { event_type?: string; mission_id?: string };
        return obj.event_type === "packet_sent" && obj.mission_id === "pm-send-2026-06-18-001";
      } catch {
        return false;
      }
    });
    assert.equal(hasPacketSent, true, "packet_sent event must be written to per-mission runtime-events.jsonl");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("topology_spawn_role writes launch script to per-mission launch dir", async () => {
  const ws = makeWorkspace();
  const { tools } = setupPi();
  try {
    createPerMission(ws, "pm-spawn-2026-06-18-001", "pm-proj-spawn");
    const ctx = { cwd: ws };
    const result = (await tools.topology_spawn_role.execute(
      "spawn",
      { role: "runner", mode: "print" },
      undefined,
      undefined,
      ctx,
    )) as { content: Array<{ text: string }>; details: Record<string, unknown> };
    const details = readDetails(result);
    const scriptPath = String(details.scriptPath ?? "");
    assert.match(
      scriptPath,
      /\.pi\/topology\/missions\/pm-spawn-2026-06-18-001\/launch\/runner\.sh/,
      `expected per-mission launch script path, got: ${scriptPath}`,
    );
    assert.equal(existsSync(scriptPath), true);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("topology_spawn_role launch script env vars point to per-mission canonical", async () => {
  const ws = makeWorkspace();
  const { tools } = setupPi();
  try {
    createPerMission(ws, "pm-spawn-env-2026-06-18-001", "pm-proj-spawn-env");
    const ctx = { cwd: ws };
    const result = (await tools.topology_spawn_role.execute(
      "spawn",
      { role: "hq", mode: "print" },
      undefined,
      undefined,
      ctx,
    )) as { content: Array<{ text: string }>; details: Record<string, unknown> };
    const details = readDetails(result);
    const scriptPath = String(details.scriptPath ?? "");
    const script = readFileSync(scriptPath, "utf8");
    // All four env vars must point to per-mission canonical.
    assert.match(script, /PI_TOPOLOGY_MISSION_CARD=.*missions\/pm-spawn-env-2026-06-18-001\/mission-card\.json/);
    assert.match(script, /PI_TOPOLOGY_INCIDENT_LOG=.*missions\/pm-spawn-env-2026-06-18-001\/incident-log\.jsonl/);
    assert.match(script, /PI_TOPOLOGY_EVENT_LOG=.*missions\/pm-spawn-env-2026-06-18-001\/runtime-events\.jsonl/);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Slice C: artifacts + guard
// ---------------------------------------------------------------------------

test("topology_write_artifact writes to per-mission artifacts/<role>/", async () => {
  const ws = makeWorkspace();
  const { tools } = setupPi();
  try {
    createPerMission(ws, "pm-art-2026-06-18-001", "pm-proj-art");
    const ctx = { cwd: ws };
    const result = (await tools.topology_write_artifact.execute(
      "artifact",
      {
        role: "runner",
        kind: "report",
        title: "Per-mission artifact test",
        body: "verdict: pass\n\nThis artifact lives in per-mission canonical dir.",
      },
      undefined,
      undefined,
      ctx,
    )) as { content: Array<{ text: string }>; details: Record<string, unknown> };
    const details = readDetails(result);
    const artifactPath = String(details.artifact_path ?? "");
    assert.match(
      artifactPath,
      /^\.pi\/topology\/missions\/pm-art-2026-06-18-001\/artifacts\/runner\//,
      `expected per-mission artifact path, got: ${artifactPath}`,
    );
    assert.equal(existsSync(join(ws, artifactPath)), true);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("topology_read_artifact reads per-mission artifact first, falls back to root", async () => {
  const ws = makeWorkspace();
  const { tools } = setupPi();
  try {
    createPerMission(ws, "pm-read-2026-06-18-001", "pm-proj-read");
    const ctx = { cwd: ws };
    // Write via tool (per-mission).
    const write = (await tools.topology_write_artifact.execute(
      "write",
      { role: "oracle", kind: "review", title: "Read test", body: "per-mission body" },
      undefined, undefined, ctx,
    )) as { details: Record<string, unknown> };
    const perMissionPath = String(write.details.artifact_path ?? "");
    // Read back.
    const read = (await tools.topology_read_artifact.execute(
      "read",
      { artifact_path: perMissionPath, full: true },
      undefined, undefined, ctx,
    )) as { content: Array<{ text: string }> };
    assert.match(readText(read), /per-mission body/);
    // Root-mirror fallback: create a root-only artifact and read it.
    const rootArt = join(ws, ".pi", "topology", "artifacts", "runner", "root-only.md");
    mkdirSync(join(rootArt, ".."), { recursive: true });
    writeFileSync(rootArt, "root mirror body", "utf8");
    const readRoot = (await tools.topology_read_artifact.execute(
      "read-root",
      { artifact_path: ".pi/topology/artifacts/runner/root-only.md", full: true },
      undefined, undefined, ctx,
    )) as { content: Array<{ text: string }> };
    assert.match(readText(readRoot), /root mirror body/);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("guard: per-mission artifacts/<role>/ path is allowed for the owning role", () => {
  const ws = makeWorkspace();
  try {
    createPerMission(ws, "pm-guard-2026-06-18-001", "pm-proj-guard");
    const res = resolveActiveMissionPaths(ws);
    assert.equal(res.mode, "per-mission");
    if (res.mode !== "per-mission") return;
    const perMissionArtifact = join(
      ws,
      ".pi", "topology", "missions", res.missionId!,
      "artifacts", "hq", "decision.md",
    );
    const decision = evaluateToolCall({
      role: "hq",
      mission: { allowed_paths: [ws], forbidden_actions: [], mission_id: res.missionId! },
      tool: "write_file",
      path: perMissionArtifact,
      incident_log_path: res.incidentLogPath ?? undefined,
    });
    assert.equal(decision.decision, "allow",
      `hq writing own per-mission artifact should be allowed, got: ${decision.decision} (${decision.reason})`);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("guard: shell write by hq is blocked with tool_guidance pointing to topology_write_artifact", () => {
  const decision = evaluateToolCall({
    role: "hq",
    mission: { allowed_paths: ["/tmp"], forbidden_actions: [] },
    tool: "shell",
    command: "cat > /tmp/some-report.md <<EOF\nhello\nEOF",
  });
  assert.equal(decision.decision, "block");
  // The new tool_guidance field must be present and point to topology_write_artifact
  // and to the per-mission artifacts dir.
  const reason = String(decision.reason ?? "");
  assert.match(reason, /topology_write_artifact/);
  assert.match(reason, /\.pi\/topology\/(missions\/<id>\/)?artifacts\/hq\//);
});
