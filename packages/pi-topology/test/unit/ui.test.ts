import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createInitialStatusBoard, createMissionDraft } from "../../src/runtime/mission.ts";
import { writePeerRegistry } from "../../src/transport/registry.ts";
import { buildTopologyUiSnapshot, compactStatusLine, installTopologyUi, renderTopologyMeshWidget } from "../../src/extension/ui.ts";

test("topology UI snapshot renders mesh roles from status board and session ledger", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-topology-ui-"));
  const previousComsDir = process.env.PI_COMS_DIR;
  const mission = createMissionDraft({
    project: "ui",
    workdir: cwd,
    objective: "Show mesh",
    allowed_paths: [cwd],
  });
  const board = createInitialStatusBoard(mission);
  board.runtime_phase = "running";
  board.next_gate.owner_required = false;
  board.peer_status.hq = {
    ...board.peer_status.hq,
    state: "alive",
    alive: true,
    context_used_pct: 42,
    session_id: "hq-1234567890",
    last_heartbeat_at: "2026-06-16T00:00:00.000Z",
  };
  board.peer_status.runner = {
    ...board.peer_status.runner,
    state: "launch_requested",
    alive: null,
  };
  await mkdir(join(cwd, ".pi/topology"), { recursive: true });
  await writeFile(join(cwd, ".pi/topology/mission-card.json"), `${JSON.stringify(mission, null, 2)}\n`, "utf8");
  await writeFile(join(cwd, ".pi/topology/status-board.json"), `${JSON.stringify(board, null, 2)}\n`, "utf8");
  await writeFile(
    join(cwd, ".pi/topology/sessions.jsonl"),
    [
      { role: "hq", state: "alive_confirmed", session_id: "hq-1234567890" },
      { role: "runner", state: "launch_requested", session_id: null },
    ].map((entry) => JSON.stringify(entry)).join("\n") + "\n",
    "utf8",
  );
  process.env.PI_COMS_DIR = await mkdtemp(join("/private/tmp", "pi-topology-ui-registry-"));
  await writePeerRegistry(process.env.PI_COMS_DIR, "ui", {
    name: "topology-supervisor",
    role: "topology-supervisor",
    session_id: "supervisor-1",
    endpoint: "memory://ui/supervisor-1",
    heartbeat_at: new Date().toISOString(),
    context_used_pct: 17,
  });
  await writePeerRegistry(process.env.PI_COMS_DIR, "ui", {
    name: "hq",
    role: "hq",
    session_id: "hq-1234567890",
    endpoint: "memory://ui/hq-1234567890",
    heartbeat_at: new Date().toISOString(),
    context_used_pct: 42,
  });

  const snapshot = buildTopologyUiSnapshot(cwd, "hq");
  const line = compactStatusLine(snapshot);
  const widget = stripAnsi(renderTopologyMeshWidget(snapshot, 100).join("\n"));

  assert.match(line, /topology ui role=hq phase=running gate=open/);
  assert.match(line, /●hq42%/);
  assert.match(line, /●sup17%/);
  assert.match(widget, /topology mesh ui/);
  assert.match(widget, /hq\s+live\s+\[#{5}-{7}\]\s+42%/);
  assert.match(widget, /topology-supervisor\s+live/);
  assert.doesNotMatch(widget, /runner\s+launch/);
  restoreEnv("PI_COMS_DIR", previousComsDir);
});

test("topology UI renders stale roles as unconfirmed instead of error", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-topology-ui-stale-"));
  const previousComsDir = process.env.PI_COMS_DIR;
  const mission = createMissionDraft({
    project: "ui-stale",
    workdir: cwd,
    objective: "Show stale mesh without alarm styling",
    allowed_paths: [cwd],
  });
  const board = createInitialStatusBoard(mission);
  board.runtime_phase = "running";
  board.peer_status.oracle = {
    ...board.peer_status.oracle,
    state: "stale",
    alive: false,
    session_id: "oracle-previous",
    last_heartbeat_at: "2026-06-16T00:00:00.000Z",
  };
  await mkdir(join(cwd, ".pi/topology"), { recursive: true });
  await writeFile(join(cwd, ".pi/topology/mission-card.json"), `${JSON.stringify(mission, null, 2)}\n`, "utf8");
  await writeFile(join(cwd, ".pi/topology/status-board.json"), `${JSON.stringify(board, null, 2)}\n`, "utf8");
  await writeFile(
    join(cwd, ".pi/topology/sessions.jsonl"),
    `${JSON.stringify({ role: "oracle", state: "alive_confirmed", session_id: "oracle-previous" })}\n`,
    "utf8",
  );
  process.env.PI_COMS_DIR = await mkdtemp(join("/private/tmp", "pi-topology-ui-stale-registry-"));

  const snapshot = buildTopologyUiSnapshot(cwd, "topology-supervisor");
  const line = compactStatusLine(snapshot);
  const widget = renderTopologyMeshWidget(snapshot, 160, {
    fg(name, value) {
      return `<${name}>${value}</${name}>`;
    },
  }).join("\n");

  assert.doesNotMatch(line, /oracle/);
  assert.doesNotMatch(widget, /oracle/);
  restoreEnv("PI_COMS_DIR", previousComsDir);
});

test("topology UI does not prelist non-existent peers before they are discovered", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-topology-ui-live-only-"));
  const previousComsDir = process.env.PI_COMS_DIR;
  const mission = createMissionDraft({
    project: "ui-live-only",
    workdir: cwd,
    objective: "Only show discovered peers",
    allowed_paths: [cwd],
  });
  const board = createInitialStatusBoard(mission);
  board.runtime_phase = "running";
  board.peer_status.hq = {
    ...board.peer_status.hq,
    state: "alive",
    alive: true,
    session_id: "hq-old",
    last_heartbeat_at: "2026-06-16T00:00:00.000Z",
  };
  await mkdir(join(cwd, ".pi/topology"), { recursive: true });
  await writeFile(join(cwd, ".pi/topology/mission-card.json"), `${JSON.stringify(mission, null, 2)}\n`, "utf8");
  await writeFile(join(cwd, ".pi/topology/status-board.json"), `${JSON.stringify(board, null, 2)}\n`, "utf8");
  await writeFile(join(cwd, ".pi/topology/sessions.jsonl"), "", "utf8");
  process.env.PI_COMS_DIR = await mkdtemp(join("/private/tmp", "pi-topology-ui-live-only-registry-"));
  await writePeerRegistry(process.env.PI_COMS_DIR, "ui-live-only", {
    name: "topology-supervisor",
    role: "topology-supervisor",
    session_id: "supervisor-live",
    endpoint: "memory://ui-live-only/supervisor-live",
    heartbeat_at: new Date().toISOString(),
    context_used_pct: 8,
  });

  const snapshot = buildTopologyUiSnapshot(cwd, "topology-supervisor");
  const widget = stripAnsi(renderTopologyMeshWidget(snapshot, 120).join("\n"));
  assert.match(widget, /topology-supervisor\s+live/);
  assert.doesNotMatch(widget, /\bhq\s+live\b/);
  restoreEnv("PI_COMS_DIR", previousComsDir);
});

test("installTopologyUi publishes status and widget", () => {
  const calls: Array<{ kind: string; key: string; value: unknown }> = [];
  installTopologyUi(
    {
      cwd: "/missing/project",
      ui: {
        setStatus(key, value) {
          calls.push({ kind: "status", key, value });
        },
        setWidget(key, value) {
          calls.push({ kind: "widget", key, value });
        },
      },
    },
    { role: "topology-supervisor", cwd: "/missing/project" },
  );

  assert.equal(calls.some((call) => call.kind === "status" && call.key === "topology"), true);
  assert.equal(calls.some((call) => call.kind === "widget" && call.key === "topology-mesh"), true);
});

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
