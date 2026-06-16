import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createPacket } from "../../src/runtime/packet.ts";
import registerPiTopology from "../../index.ts";
import { createInitialStatusBoard, createMissionDraft } from "../../src/runtime/mission.ts";
import { clearPacketMemory } from "../../src/state/packet-memory.ts";
import { topology_send } from "../../src/transport/local-coms.ts";
import { writePeerRegistry } from "../../src/transport/registry.ts";

test("registers minimal Pi topology tool and command surface", () => {
  const tools: Array<{ name: string; promptSnippet?: string; promptGuidelines?: string[] }> = [];
  const commands: string[] = [];
  const flags: string[] = [];
  const handlers: Record<string, unknown[]> = {};
  const pi = {
    registerTool(tool: { name: string; promptSnippet?: string; promptGuidelines?: string[] }) {
      tools.push(tool);
    },
    registerCommand(name: string, command: unknown) {
      commands.push(name);
      handlers[name] = [command];
    },
    on(name: string) {
      handlers[name] = [];
    },
    registerFlag(name: string) {
      flags.push(name);
    },
    getFlag() {
      return undefined;
    },
  };

  registerPiTopology(pi);

  assert.deepEqual(
    tools.map((tool) => tool.name).sort(),
    [
      "topology_cleanup",
      "topology_await",
      "topology_doctor",
      "topology_get",
      "topology_init_mission",
      "topology_list",
      "topology_read_artifact",
      "topology_send",
      "topology_smoke",
      "topology_spawn_role",
      "topology_status",
      "topology_write_artifact",
    ].sort(),
  );
  assert.equal(tools.every((tool) => typeof tool.promptSnippet === "string" && tool.promptSnippet.length > 0), true);
  assert.equal(tools.every((tool) => Array.isArray(tool.promptGuidelines) && tool.promptGuidelines.length > 0), true);
  assert.deepEqual(commands.sort(), ["topology", "topology-status"].sort());
  assert.deepEqual(flags.sort(), ["cname", "project"].sort());
  assert.equal(Object.hasOwn(handlers, "session_start"), true);
  assert.equal(Object.hasOwn(handlers, "tool_call"), true);
});

test("registers package skill path via Pi resources_discover", async () => {
  const handlers: Record<string, (...args: unknown[]) => unknown> = {};
  const pi = {
    registerTool() {},
    registerCommand() {},
    on(name: string, handler: (...args: unknown[]) => unknown) {
      handlers[name] = handler;
    },
    registerFlag() {},
    getFlag() {
      return undefined;
    },
  };

  registerPiTopology(pi);

  assert.equal(typeof handlers.resources_discover, "function");
  const result = await Promise.resolve(handlers.resources_discover({ cwd: process.cwd(), reason: "startup" }, {}));
  assert.equal(Array.isArray((result as { skillPaths?: unknown[] }).skillPaths), true);
  assert.equal(
    ((result as { skillPaths: string[] }).skillPaths).some((entry) => entry.endsWith("packages/pi-topology/skills")),
    true,
  );
});

test("topology-runtime skill frontmatter follows Pi skill loading requirements", async () => {
  const skill = await readFile(new URL("../../skills/topology-runtime/SKILL.md", import.meta.url), "utf8");
  const match = /^---\n([\s\S]*?)\n---/.exec(skill);
  assert.notEqual(match, null);
  const frontmatter = match?.[1] ?? "";

  assert.match(frontmatter, /^name: topology-runtime$/m);
  assert.match(frontmatter, /^description: ".+"$/m);
  assert.doesNotMatch(frontmatter, /^origin:/m);
  assert.match(frontmatter, /^metadata:$/m);
});

test("session_start does not install topology ui for ordinary Pi sessions", () => {
  const handlers: Record<string, (...args: unknown[]) => unknown> = {};
  const statusWrites: Array<[string, string | undefined]> = [];
  const widgetWrites: Array<[string, unknown]> = [];
  const pi = {
    registerTool() {},
    registerCommand() {},
    on(name: string, handler: (...args: unknown[]) => unknown) {
      handlers[name] = handler;
    },
    registerFlag() {},
    getFlag() {
      return undefined;
    },
  };
  const previous = {
    mission: process.env.PI_TOPOLOGY_MISSION_CARD,
    workdir: process.env.PI_TOPOLOGY_WORKDIR,
    role: process.env.PI_TOPOLOGY_ROLE,
  };
  try {
    process.env.PI_TOPOLOGY_MISSION_CARD = "/tmp/pi-topology-ordinary/mission-card.json";
    process.env.PI_TOPOLOGY_WORKDIR = "/tmp/pi-topology-ordinary";
    delete process.env.PI_TOPOLOGY_ROLE;
    registerPiTopology(pi);

    handlers.session_start({}, {
      ui: {
        setStatus(name: string, value: string | undefined) {
          statusWrites.push([name, value]);
        },
        setWidget(name: string, value: unknown) {
          widgetWrites.push([name, value]);
        },
      },
    });

    assert.deepEqual(statusWrites, []);
    assert.deepEqual(widgetWrites, []);
  } finally {
    restoreEnv("PI_TOPOLOGY_MISSION_CARD", previous.mission);
    restoreEnv("PI_TOPOLOGY_WORKDIR", previous.workdir);
    restoreEnv("PI_TOPOLOGY_ROLE", previous.role);
  }
});

test("topology slash command preflights and initializes a mission from a task card", async () => {
  const commands: Record<string, { handler: (args: string, ctx: { cwd: string }) => Promise<string> }> = {};
  const sentMessages: Array<{ customType: string; content: string }> = [];
  const pi = {
    registerTool() {},
    registerCommand(name: string, command: { handler: (args: string, ctx: { cwd: string }) => Promise<string> }) {
      commands[name] = command;
    },
    sendMessage(message: { customType: string; content: string }) {
      sentMessages.push(message);
    },
    on() {},
    registerFlag() {},
    getFlag() {
      return undefined;
    },
  };
  registerPiTopology(pi);

  const cwd = await mkdtemp(join(tmpdir(), "pi-topology-command-"));
  const ctx = { cwd };

  const preflight = await commands.topology.handler("", ctx);
  assert.match(preflight, /mission: none/);
  assert.match(preflight, /\/topology <task goal or task card>/);
  assert.equal(sentMessages.at(-1)?.customType, "topology");
  assert.match(sentMessages.at(-1)?.content ?? "", /mission: none/);

  const initialized = await commands.topology.handler("init Stabilize package startup flow", ctx);
  assert.match(initialized, /ACK topology-supervisor: initialized mission/);
  assert.match(initialized, /owner_gate: required before dynamic role spawn/);
  assert.match(initialized, /current session is now topology-supervisor/);
  assert.doesNotMatch(initialized, /Launch the Supervisor entry session/);
  assert.equal(sentMessages.some((message) => message.customType === "topology-supervisor-bootstrap"), true);

  const mission = JSON.parse(await readFile(join(cwd, ".pi/topology/mission-card.json"), "utf8"));
  assert.equal(mission.objective, "Stabilize package startup flow");
  assert.deepEqual(mission.allowed_paths, [cwd]);
  assert.equal(mission.session_ledger_path, ".pi/topology/sessions.jsonl");

  const sessions = (await readFile(join(cwd, ".pi/topology/sessions.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { role: string; state: string; session_id: string | null; script_path: string });
  assert.equal(sessions.length, 8);
  assert.equal(sessions.find((entry) => entry.role === "topology-supervisor")?.state, "script_written");
  assert.equal(sessions.some((entry) => entry.role === "topology-supervisor" && entry.state === "alive_confirmed" && entry.session_id), true);
  assert.match(sessions.find((entry) => entry.role === "topology-supervisor" && entry.state === "script_written")?.script_path ?? "", /topology-supervisor\.sh/);

  const events = (await readFile(join(cwd, ".pi/topology/runtime-events.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { event_type: string });
  assert.deepEqual(events.map((event) => event.event_type).slice(0, 3), ["runtime_boot", "mission_initialized", "launch_scripts_written"]);

  const status = await commands.topology.handler("status", ctx);
  assert.match(status, /phase: intake/);
  assert.match(status, /mission_card:/);
  assert.match(status, /session_ledger:/);
  assert.match(status, /session_records: 8/);
  assert.match(status, /current session is already topology-supervisor/);
  assert.doesNotMatch(status, /Launch the Supervisor entry session/);
  assert.doesNotMatch(status, /open -n -a/);

  const doctor = await commands.topology.handler("doctor", ctx);
  assert.match(doctor, /validation: ok/);
  assert.match(doctor, /owner_gate/);

  const packets = await commands.topology.handler("packets", ctx);
  assert.match(packets, /No local topology packets found/);

  const spawn = await commands.topology.handler("spawn hq", ctx);
  assert.match(spawn, /Current session is topology-supervisor/);
  assert.doesNotMatch(spawn, /topology-supervisor\.sh/);
  assert.doesNotMatch(spawn, /open -n -a/);
  assert.doesNotMatch(spawn, /launch\/hq\.sh/);
});

test("topology status recommends continuing when HQ is already live", async () => {
  const commands: Record<string, { handler: (args: string, ctx: { cwd: string }) => Promise<string> }> = {};
  const pi = {
    registerTool() {},
    registerCommand(name: string, command: { handler: (args: string, ctx: { cwd: string }) => Promise<string> }) {
      commands[name] = command;
    },
    on() {},
    registerFlag() {},
    getFlag() {
      return undefined;
    },
  };
  registerPiTopology(pi);

  const cwd = await mkdtemp(join(tmpdir(), "pi-topology-status-hq-live-"));
  const previousComsDir = process.env.PI_COMS_DIR;
  const mission = createMissionDraft({
    project: "status-hq-live",
    workdir: cwd,
    objective: "Resume without stale launch advice",
    allowed_paths: [cwd],
  });
  mission.progress.current_step = "Owner approved mission; HQ launch requested.";
  const board = createInitialStatusBoard(mission);
  board.runtime_phase = "spawning";
  board.next_gate.owner_required = false;
  board.peer_status.hq = {
    ...board.peer_status.hq,
    state: "alive",
    alive: true,
    session_id: "hq-live",
    last_heartbeat_at: "2026-06-16T00:00:00.000Z",
  };
  await mkdir(join(cwd, ".pi/topology"), { recursive: true });
  await writeFile(join(cwd, ".pi/topology/mission-card.json"), `${JSON.stringify(mission, null, 2)}\n`, "utf8");
  await writeFile(join(cwd, ".pi/topology/status-board.json"), `${JSON.stringify(board, null, 2)}\n`, "utf8");
  await writeFile(join(cwd, ".pi/topology/incident-log.jsonl"), "", "utf8");
  await writeFile(join(cwd, ".pi/topology/runtime-events.jsonl"), "", "utf8");
  await writeFile(join(cwd, ".pi/topology/sessions.jsonl"), "", "utf8");
  try {
    process.env.PI_COMS_DIR = await mkdtemp(join("/private/tmp", "pi-topology-status-hq-live-registry-"));
    await writePeerRegistry(process.env.PI_COMS_DIR, "status-hq-live", {
      name: "hq",
      role: "hq",
      session_id: "hq-live",
      endpoint: "memory://status-hq-live/hq-live",
      heartbeat_at: new Date().toISOString(),
      context_used_pct: 2,
    });

    const status = await commands.topology.handler("status", { cwd });

    assert.match(status, /HQ is already live/);
    assert.doesNotMatch(status, /launch HQ/i);
  } finally {
    restoreEnv("PI_COMS_DIR", previousComsDir);
  }
});

test("bare topology command drafts mission from latest assistant task card", async () => {
  const commands: Record<string, { handler: (args: string, ctx: { cwd: string; sessionManager?: unknown }) => Promise<string> }> = {};
  const sentMessages: Array<{ customType: string; content: string }> = [];
  const pi = {
    registerTool() {},
    registerCommand(name: string, command: { handler: (args: string, ctx: { cwd: string; sessionManager?: unknown }) => Promise<string> }) {
      commands[name] = command;
    },
    sendMessage(message: { customType: string; content: string }) {
      sentMessages.push(message);
    },
    on() {},
    registerFlag() {},
    getFlag() {
      return undefined;
    },
  };
  registerPiTopology(pi);

  const cwd = await mkdtemp(join(tmpdir(), "pi-topology-auto-card-"));
  const taskCard = [
    "# 任务卡",
    "目标: Stabilize package entry flow",
    "",
    "## Scope",
    "- Update slash command intake",
    "",
    "## 验收",
    "- /topology creates a mission draft",
    "",
    "## 风险",
    "- Avoid opening sessions without owner confirmation",
    "",
    "## 下一步",
    "- Start Supervisor after owner review",
  ].join("\n");
  const result = await commands.topology.handler("", {
    cwd,
    sessionManager: {
      getBranch() {
        return [
          {
            id: "assistant-task-card",
            type: "message",
            message: { role: "assistant", content: taskCard },
          },
        ];
      },
    },
  });

  assert.match(result, /initialized mission/);
  assert.match(result, /source: latest assistant task card/);
  assert.match(sentMessages.at(-1)?.content ?? "", /source: latest assistant task card/);
  const mission = JSON.parse(await readFile(join(cwd, ".pi/topology/mission-card.json"), "utf8"));
  assert.equal(mission.objective, "Stabilize package entry flow");
  assert.equal(mission.progress.source, "session_context");
  assert.equal(mission.progress.source_entry_id, "assistant-task-card");
  const sessions = (await readFile(join(cwd, ".pi/topology/sessions.jsonl"), "utf8")).trim().split("\n");
  assert.equal(sessions.length, 8);
});

test("topology command treats freeform args as the task card without requiring init", async () => {
  const commands: Record<string, { handler: (args: string, ctx: { cwd: string }) => Promise<string> }> = {};
  const pi = {
    registerTool() {},
    registerCommand(name: string, command: { handler: (args: string, ctx: { cwd: string }) => Promise<string> }) {
      commands[name] = command;
    },
    sendMessage() {},
    on() {},
    registerFlag() {},
    getFlag() {
      return undefined;
    },
  };
  registerPiTopology(pi);

  const cwd = await mkdtemp(join(tmpdir(), "pi-topology-freeform-"));
  const result = await commands.topology.handler("Stabilize package entry flow", { cwd });

  assert.match(result, /initialized mission/);
  const mission = JSON.parse(await readFile(join(cwd, ".pi/topology/mission-card.json"), "utf8"));
  assert.equal(mission.objective, "Stabilize package entry flow");
  assert.equal(mission.progress.source, "manual");
  const sessions = (await readFile(join(cwd, ".pi/topology/sessions.jsonl"), "utf8")).trim().split("\n");
  assert.equal(sessions.length, 8);
});

test("topology command uses project flag when drafting a mission", async () => {
  const commands: Record<string, { handler: (args: string, ctx: { cwd: string }) => Promise<string> }> = {};
  const pi = {
    registerTool() {},
    registerCommand(name: string, command: { handler: (args: string, ctx: { cwd: string }) => Promise<string> }) {
      commands[name] = command;
    },
    sendMessage() {},
    on() {},
    registerFlag() {},
    getFlag(name: string) {
      return name === "project" ? "flag-project" : undefined;
    },
  };
  registerPiTopology(pi);

  const cwd = await mkdtemp(join(tmpdir(), "pi-topology-project-flag-"));
  const result = await commands.topology.handler("Stabilize package entry flow", { cwd });

  assert.match(result, /initialized mission/);
  const mission = JSON.parse(await readFile(join(cwd, ".pi/topology/mission-card.json"), "utf8"));
  assert.equal(mission.project, "flag-project");
  const board = JSON.parse(await readFile(join(cwd, ".pi/topology/status-board.json"), "utf8"));
  assert.equal(board.project, "flag-project");
});

test("topology command promotes the current session to supervisor after mission init", async () => {
  const commands: Record<string, { handler: (args: string, ctx: { cwd: string; ui?: unknown; getContextUsage?: () => { percent: number } }) => Promise<string> }> = {};
  const sentMessages: Array<{ message: { customType: string; content: string }; options?: Record<string, unknown> }> = [];
  const statusWrites: Array<[string, string | undefined]> = [];
  const widgetWrites: Array<[string, unknown]> = [];
  const pi = {
    registerTool() {},
    registerCommand(name: string, command: { handler: (args: string, ctx: { cwd: string; ui?: unknown; getContextUsage?: () => { percent: number } }) => Promise<string> }) {
      commands[name] = command;
    },
    sendMessage(message: { customType: string; content: string }, options?: Record<string, unknown>) {
      sentMessages.push({ message, options });
    },
    on() {},
    registerFlag() {},
    getFlag() {
      return undefined;
    },
  };
  registerPiTopology(pi);

  const cwd = await mkdtemp(join(tmpdir(), "pi-topology-takeover-"));
  const result = await commands.topology.handler("Stabilize package entry flow", {
    cwd,
    getContextUsage() {
      return { percent: 17 };
    },
    ui: {
      setStatus(name: string, value: string | undefined) {
        statusWrites.push([name, value]);
      },
      setWidget(name: string, value: unknown) {
        widgetWrites.push([name, value]);
      },
      requestRender() {},
    },
  });

  assert.match(result, /current session is now topology-supervisor/);
  assert.doesNotMatch(result, /Launch the Supervisor entry session/);
  assert.equal(statusWrites.some(([name, value]) => name === "topology" && /role=topology-supervisor/.test(value ?? "")), true);
  assert.equal(widgetWrites.some(([name]) => name === "topology-mesh"), true);
  assert.equal(sentMessages.some(({ message, options }) => (
    message.customType === "topology-supervisor-bootstrap"
    && /You are now topology-supervisor/.test(message.content)
    && options?.deliverAs === "followUp"
    && options?.triggerTurn === true
  )), true);

  const sessions = (await readFile(join(cwd, ".pi/topology/sessions.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { role: string; state: string; session_id: string | null });
  assert.equal(sessions.some((entry) => entry.role === "topology-supervisor" && entry.state === "alive_confirmed" && entry.session_id), true);

  const board = JSON.parse(await readFile(join(cwd, ".pi/topology/status-board.json"), "utf8"));
  assert.equal(board.peer_status["topology-supervisor"].alive, true);
  assert.equal(board.peer_status["topology-supervisor"].state, "entry");
  assert.equal(board.peer_status["topology-supervisor"].context_used_pct, 17);
});

test("topology command resumes an existing mission as current-session supervisor", async () => {
  const commands: Record<string, { handler: (args: string, ctx: { cwd: string; ui?: unknown; getContextUsage?: () => { percent: number } }) => Promise<string> }> = {};
  const sentMessages: Array<{ message: { customType: string; content: string }; options?: Record<string, unknown> }> = [];
  const pi = {
    registerTool() {},
    registerCommand(name: string, command: { handler: (args: string, ctx: { cwd: string; ui?: unknown; getContextUsage?: () => { percent: number } }) => Promise<string> }) {
      commands[name] = command;
    },
    sendMessage(message: { customType: string; content: string }, options?: Record<string, unknown>) {
      sentMessages.push({ message, options });
    },
    on() {},
    registerFlag() {},
    getFlag() {
      return undefined;
    },
  };
  registerPiTopology(pi);

  const cwd = await mkdtemp(join(tmpdir(), "pi-topology-resume-existing-"));
  const mission = createMissionDraft({
    project: "resume-existing",
    workdir: cwd,
    objective: "Resume existing mission",
    allowed_paths: [cwd],
  });
  await mkdir(join(cwd, ".pi/topology"), { recursive: true });
  await writeFile(join(cwd, ".pi/topology/mission-card.json"), `${JSON.stringify(mission, null, 2)}\n`, "utf8");
  await writeFile(join(cwd, ".pi/topology/status-board.json"), `${JSON.stringify(createInitialStatusBoard(mission), null, 2)}\n`, "utf8");

  const result = await commands.topology.handler("Resume existing mission", {
    cwd,
    getContextUsage() {
      return { percent: 9 };
    },
    ui: {
      setStatus() {},
      setWidget() {},
      requestRender() {},
    },
  });

  assert.match(result, /resumed existing mission/);
  assert.match(result, /current session is now topology-supervisor/);
  assert.doesNotMatch(result, /Topology mission already exists/);
  assert.equal(sentMessages.some(({ message, options }) => (
    message.customType === "topology-supervisor-bootstrap"
    && /You are now topology-supervisor/.test(message.content)
    && options?.deliverAs === "followUp"
    && options?.triggerTurn === true
  )), true);

  const board = JSON.parse(await readFile(join(cwd, ".pi/topology/status-board.json"), "utf8"));
  assert.equal(board.peer_status["topology-supervisor"].alive, true);
  assert.equal(board.peer_status["topology-supervisor"].context_used_pct, 9);
});

test("topology status migrates old mission cards before validation", async () => {
  const commands: Record<string, { handler: (args: string, ctx: { cwd: string }) => Promise<string> }> = {};
  const pi = {
    registerTool() {},
    registerCommand(name: string, command: { handler: (args: string, ctx: { cwd: string }) => Promise<string> }) {
      commands[name] = command;
    },
    sendMessage() {},
    on() {},
    registerFlag() {},
    getFlag() {
      return undefined;
    },
  };
  registerPiTopology(pi);

  const cwd = await mkdtemp(join(tmpdir(), "pi-topology-old-mission-"));
  const mission = createMissionDraft({
    project: "legacy",
    workdir: cwd,
    objective: "Legacy mission before progress ledger",
    allowed_paths: [cwd],
  }) as Record<string, unknown>;
  delete mission.progress;
  delete mission.session_ledger_path;
  await mkdir(join(cwd, ".pi/topology"), { recursive: true });
  await writeFile(join(cwd, ".pi/topology/mission-card.json"), `${JSON.stringify(mission, null, 2)}\n`, "utf8");

  const status = await commands.topology.handler("status", { cwd });
  assert.match(status, /validation: ok/);
  assert.match(status, /progress: awaiting_owner_confirmation/);
  assert.match(status, /session_records: 7/);
  assert.match(status, /Launch the Supervisor entry session/);
  assert.doesNotMatch(status, /open -n -a/);

  const migrated = JSON.parse(await readFile(join(cwd, ".pi/topology/mission-card.json"), "utf8"));
  assert.equal(migrated.progress.status, "awaiting_owner_confirmation");
  assert.equal(migrated.session_ledger_path, ".pi/topology/sessions.jsonl");
  const sessions = (await readFile(join(cwd, ".pi/topology/sessions.jsonl"), "utf8")).trim().split("\n");
  assert.equal(sessions.length, 7);
});

test("topology status refreshes existing launch scripts without duplicating session ledger", async () => {
  const commands: Record<string, { handler: (args: string, ctx: { cwd: string }) => Promise<string> }> = {};
  const pi = {
    registerTool() {},
    registerCommand(name: string, command: { handler: (args: string, ctx: { cwd: string }) => Promise<string> }) {
      commands[name] = command;
    },
    sendMessage() {},
    on() {},
    registerFlag() {},
    getFlag() {
      return undefined;
    },
  };
  registerPiTopology(pi);

  const cwd = await mkdtemp(join(tmpdir(), "pi-topology-refresh-scripts-"));
  const mission = createMissionDraft({
    project: "refresh",
    workdir: cwd,
    objective: "Refresh stale supervisor prompt",
    allowed_paths: [cwd],
  });
  await mkdir(join(cwd, ".pi/topology/launch"), { recursive: true });
  await writeFile(join(cwd, ".pi/topology/mission-card.json"), `${JSON.stringify(mission, null, 2)}\n`, "utf8");
  await writeFile(join(cwd, ".pi/topology/launch/topology-supervisor.sh"), "old prompt without launch mode\n", "utf8");
  await writeFile(
    join(cwd, ".pi/topology/sessions.jsonl"),
    `${JSON.stringify({ role: "topology-supervisor", state: "script_written" })}\n`,
    "utf8",
  );

  const status = await commands.topology.handler("status", { cwd });
  assert.match(status, /session_records: 1/);
  const refreshed = await readFile(join(cwd, ".pi/topology/launch/topology-supervisor.sh"), "utf8");
  assert.match(refreshed, /mode="launch"/);
  assert.match(refreshed, /Do not call topology_send/);
  const sessions = (await readFile(join(cwd, ".pi/topology/sessions.jsonl"), "utf8")).trim().split("\n");
  assert.equal(sessions.length, 1);
});

test("topology tools persist runtime events for init, spawn, and packet flow", async () => {
  const registered: Record<string, { execute: Function }> = {};
  const pi = {
    registerTool(tool: { name: string; execute: Function }) {
      registered[tool.name] = tool;
    },
    registerCommand() {},
    on() {},
    registerFlag() {},
    getFlag() {
      return undefined;
    },
  };
  registerPiTopology(pi);

  const cwd = await mkdtemp(join(tmpdir(), "pi-topology-extension-"));
  const ctx = { cwd };
  await registered.topology_init_mission.execute(
    "init",
    { objective: "Prove runtime events", project: "dogfood", allowed_paths: [cwd] },
    undefined,
    undefined,
    ctx,
  );
  await registered.topology_spawn_role.execute(
    "spawn",
    {
      role: "hq",
      mode: "print",
      initial_prompt: "Call topology_status and topology_doctor.",
      log_path: join(cwd, ".pi/topology/logs/hq-spawn.log"),
      provider: "minimax-cn",
      model: "MiniMax-M3",
      thinking: "low",
    },
    undefined,
    undefined,
    ctx,
  );
  const sessionRecords = (await readFile(join(cwd, ".pi/topology/sessions.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { role: string; state: string; session_id: string | null });
  assert.equal(sessionRecords.filter((entry) => entry.state === "script_written").length, 7);
  assert.equal(sessionRecords.some((entry) => entry.role === "hq" && entry.state === "launch_printed" && entry.session_id === null), true);
  const send = await registered.topology_send.execute(
    "send",
    { type: "STATUS", from: "hq", to: "runner", body: { check: "smoke" } },
    undefined,
    undefined,
    ctx,
  );
  await registered.topology_get.execute(
    "get",
    { to: "runner", packet_id: send.details.packet.packet_id },
    undefined,
    undefined,
    ctx,
  );

  const events = (await readFile(join(cwd, ".pi/topology/runtime-events.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { event_type: string });

  assert.deepEqual(
    events.map((event) => event.event_type),
    ["runtime_boot", "mission_initialized", "launch_scripts_written", "spawn_request", "spawn_result", "packet_sent", "packet_received"],
  );
});

test("topology tools tolerate malformed session ledger lines", async () => {
  const registered: Record<string, { execute: Function }> = {};
  const pi = {
    registerTool(tool: { name: string; execute: Function }) {
      registered[tool.name] = tool;
    },
    registerCommand() {},
    on() {},
    registerFlag() {},
    getFlag() {
      return undefined;
    },
  };
  registerPiTopology(pi);

  const cwd = await mkdtemp(join(tmpdir(), "pi-topology-malformed-ledger-"));
  const ctx = { cwd };
  await registered.topology_init_mission.execute(
    "init",
    { objective: "Tolerate malformed ledger", project: "dogfood", allowed_paths: [cwd] },
    undefined,
    undefined,
    ctx,
  );
  await writeFile(
    join(cwd, ".pi/topology/sessions.jsonl"),
    [
      JSON.stringify({ role: "topology-supervisor", state: "script_written" }),
      "[topology] launch 2026-06-16T07:03:36Z role=hq",
      JSON.stringify({ role: "hq", state: "alive_confirmed", session_id: "hq-123" }),
    ].join("\n") + "\n",
    "utf8",
  );

  const status = await registered.topology_status.execute("status", {}, undefined, undefined, ctx);
  const doctor = await registered.topology_doctor.execute("doctor", {}, undefined, undefined, ctx);

  assert.match(status.content[0].text, /session_records: 2/);
  assert.match(doctor.content[0].text, /watchdog/);
});

test("topology_spawn_role sanitizes unsafe log_path values", async () => {
  const registered: Record<string, { execute: Function }> = {};
  const pi = {
    registerTool(tool: { name: string; execute: Function }) {
      registered[tool.name] = tool;
    },
    registerCommand() {},
    on() {},
    registerFlag() {},
    getFlag() {
      return undefined;
    },
  };
  registerPiTopology(pi);

  const cwd = await mkdtemp(join(tmpdir(), "pi-topology-sanitize-log-"));
  const ctx = { cwd };
  await registered.topology_init_mission.execute(
    "init",
    { objective: "Sanitize spawn log path", project: "dogfood", allowed_paths: [cwd] },
    undefined,
    undefined,
    ctx,
  );
  const printed = await registered.topology_spawn_role.execute(
    "spawn",
    {
      role: "runner",
      mode: "print",
      log_path: join(cwd, ".pi/topology/sessions.jsonl"),
    },
    undefined,
    undefined,
    ctx,
  );

  assert.match(printed.content[0].text, /launch plan prepared for runner; not launched/);
  assert.doesNotMatch(printed.content[0].text, /PI_TOPOLOGY_/);
  assert.doesNotMatch(printed.content[0].text, /--append-system-prompt/);
  assert.equal(Object.hasOwn(printed.details, "plan"), false);

  const sessions = (await readFile(join(cwd, ".pi/topology/sessions.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { role: string; state: string; log_path?: string });
  const launchRecord = sessions.find((entry) => entry.role === "runner" && entry.state === "launch_printed");
  assert.equal(launchRecord?.log_path, join(cwd, ".pi/topology/runner.log"));
});

test("topology_spawn_role ignores caller-supplied provider and model overrides", async () => {
  const registered: Record<string, { execute: Function }> = {};
  const pi = {
    registerTool(tool: { name: string; execute: Function }) {
      registered[tool.name] = tool;
    },
    registerCommand() {},
    on() {},
    registerFlag() {},
    getFlag() {
      return undefined;
    },
  };
  registerPiTopology(pi);

  const cwd = await mkdtemp(join(tmpdir(), "pi-topology-spawn-model-lock-"));
  const ctx = { cwd };
  await registered.topology_init_mission.execute(
    "init",
    { objective: "Keep spawned roles on mission model", project: "dogfood", allowed_paths: [cwd] },
    undefined,
    undefined,
    ctx,
  );
  const printed = await registered.topology_spawn_role.execute(
    "spawn",
    {
      role: "hq",
      mode: "print",
      terminal_app: "ghostty",
      provider: "anthropic",
      model: "claude-sonnet-4",
      thinking: "medium",
    },
    undefined,
    undefined,
    ctx,
  );

  const script = await readFile(join(cwd, ".pi/topology/launch/hq.sh"), "utf8");
  const sessions = (await readFile(join(cwd, ".pi/topology/sessions.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { role: string; state: string; provider?: string; model?: string; thinking?: string });
  const hq = sessions.find((entry) => entry.role === "hq" && entry.state === "launch_printed");

  assert.equal(printed.details.provider, "minimax-cn");
  assert.equal(printed.details.model, "MiniMax-M3");
  assert.match(script, /--provider' 'minimax-cn'/);
  assert.match(script, /--model' 'MiniMax-M3'/);
  assert.doesNotMatch(script, /claude-sonnet-4/);
  assert.equal(hq?.provider, "minimax-cn");
  assert.equal(hq?.model, "MiniMax-M3");
  assert.equal(hq?.thinking, "low");
});

test("topology_spawn_role honors spawn mode lock over caller requested launch", async () => {
  const registered: Record<string, { execute: Function }> = {};
  const pi = {
    registerTool(tool: { name: string; execute: Function }) {
      registered[tool.name] = tool;
    },
    registerCommand() {},
    on() {},
    registerFlag() {},
    getFlag() {
      return undefined;
    },
  };
  registerPiTopology(pi);

  const cwd = await mkdtemp(join(tmpdir(), "pi-topology-spawn-mode-lock-"));
  const ctx = { cwd };
  const previousLock = process.env.PI_TOPOLOGY_SPAWN_MODE_LOCK;
  try {
    process.env.PI_TOPOLOGY_SPAWN_MODE_LOCK = "print";
    await registered.topology_init_mission.execute(
      "init",
      { objective: "Keep print smoke from launching", project: "dogfood", allowed_paths: [cwd] },
      undefined,
      undefined,
      ctx,
    );
    const printed = await registered.topology_spawn_role.execute(
      "spawn",
      {
        role: "hq",
        mode: "launch",
        terminal_app: "Ghostty.app",
        log_path: join(cwd, ".pi/topology/logs/hq-spawn.log"),
      },
      undefined,
      undefined,
      ctx,
    );

    const events = (await readFile(join(cwd, ".pi/topology/runtime-events.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { event_type: string; mode?: string; launch_requested?: boolean });
    const spawnRequest = events.find((event) => event.event_type === "spawn_request");
    const spawnResult = events.find((event) => event.event_type === "spawn_result");
    assert.match(printed.content[0].text, /launch plan prepared for hq; not launched/);
    assert.equal(printed.details.mode, "print");
    assert.equal(printed.details.launch_requested, false);
    assert.equal(spawnRequest?.mode, "print");
    assert.equal(spawnResult?.mode, "print");
    assert.equal(spawnResult?.launch_requested, false);
  } finally {
    restoreEnv("PI_TOPOLOGY_SPAWN_MODE_LOCK", previousLock);
  }
});

test("topology_send derives request_msg_id from ACK body for lifecycle tracking", async () => {
  const registered: Record<string, { execute: Function }> = {};
  const pi = {
    registerTool(tool: { name: string; execute: Function }) {
      registered[tool.name] = tool;
    },
    registerCommand() {},
    on() {},
    registerFlag() {},
    getFlag() {
      return undefined;
    },
  };
  registerPiTopology(pi);

  const cwd = await mkdtemp(join(tmpdir(), "pi-topology-send-lifecycle-"));
  const ctx = { cwd };
  await registered.topology_init_mission.execute(
    "init",
    { objective: "Track ACK body request id", project: "dogfood", allowed_paths: [cwd] },
    undefined,
    undefined,
    ctx,
  );
  const request = await registered.topology_send.execute(
    "send-request",
    { type: "REQUEST", from: "hq", to: "runner", body: { task: "verify smoke" } },
    undefined,
    undefined,
    ctx,
  );
  await registered.topology_send.execute(
    "send-ack",
    {
      type: "ACK",
      from: "runner",
      to: "hq",
      body: {
        status: "accepted",
        received_packet_id: request.details.packet.packet_id,
        next: "run verification",
      },
    },
    undefined,
    undefined,
    ctx,
  );

  const board = JSON.parse(await readFile(join(cwd, ".pi/topology/status-board.json"), "utf8"));
  assert.equal(board.pending_packets.length, 1);
  assert.equal(board.pending_packets[0].packet_id, request.details.packet.packet_id);
  assert.equal(board.pending_packets[0].state, "acknowledged");
});

test("topology_list and topology_get are compact by default", async () => {
  const registered: Record<string, { execute: Function }> = {};
  const pi = {
    registerTool(tool: { name: string; execute: Function }) {
      registered[tool.name] = tool;
    },
    registerCommand() {},
    on() {},
    registerFlag() {},
    getFlag() {
      return undefined;
    },
  };
  registerPiTopology(pi);

  const cwd = await mkdtemp(join(tmpdir(), "pi-topology-compact-packets-"));
  const ctx = { cwd };
  const previousComsDir = process.env.PI_COMS_DIR;
  try {
    process.env.PI_COMS_DIR = await mkdtemp(join("/private/tmp", "pi-topology-compact-registry-"));
    await registered.topology_init_mission.execute(
      "init",
      { objective: "Compact packet inspection", project: "compact-dogfood", allowed_paths: [cwd] },
      undefined,
      undefined,
      ctx,
    );
    const report = await registered.topology_send.execute(
      "send-report",
      {
        type: "REPORT",
        from: "oracle",
        to: "hq",
        body: {
          verdict: "CONDITIONAL-GO",
          verdict_summary: "A very long review body should stay out of inline packet inspection by default.",
          artifact_path: ".pi/topology/artifacts/oracle/review.md",
        },
      },
      undefined,
      undefined,
      ctx,
    );

    const list = await registered.topology_list.execute(
      "list",
      { to: "hq" },
      undefined,
      undefined,
      ctx,
    );
    const get = await registered.topology_get.execute(
      "get",
      { to: "hq", packet_id: report.details.packet.packet_id },
      undefined,
      undefined,
      ctx,
    );

    assert.match(list.content[0].text, /topology_list hq/);
    assert.match(list.content[0].text, /summary=A very long review body should stay out of inline packet inspection by default\./);
    assert.match(list.content[0].text, /artifact_path=\.pi\/topology\/artifacts\/oracle\/review\.md/);
    assert.doesNotMatch(list.content[0].text, /"packet_id":/);
    assert.match(get.content[0].text, /topology_get/);
    assert.match(get.content[0].text, /summary=A very long review body should stay out of inline packet inspection by default\./);
    assert.doesNotMatch(get.content[0].text, /"packet":/);
  } finally {
    restoreEnv("PI_COMS_DIR", previousComsDir);
  }
});

test("topology_list stays compact even when verbose is requested", async () => {
  const registered: Record<string, { execute: Function }> = {};
  const pi = {
    registerTool(tool: { name: string; execute: Function }) {
      registered[tool.name] = tool;
    },
    registerCommand() {},
    on() {},
    registerFlag() {},
    getFlag() {
      return undefined;
    },
  };
  registerPiTopology(pi);

  const cwd = await mkdtemp(join(tmpdir(), "pi-topology-list-no-inline-"));
  const ctx = { cwd };
  const previousComsDir = process.env.PI_COMS_DIR;
  try {
    process.env.PI_COMS_DIR = await mkdtemp(join("/private/tmp", "pi-topology-list-no-inline-registry-"));
    await registered.topology_init_mission.execute(
      "init",
      { objective: "Keep packet list compact", project: "compact-list", allowed_paths: [cwd] },
      undefined,
      undefined,
      ctx,
    );
    const request = await registered.topology_send.execute(
      "send-request",
      {
        type: "REQUEST",
        from: "topology-supervisor",
        to: "hq",
        body: {
          task: "Summarize a long instruction without replaying the JSON packet.",
          note: "This sentence should appear as a compact summary, not as a raw JSON body.",
        },
      },
      undefined,
      undefined,
      ctx,
    );

    const list = await registered.topology_list.execute(
      "list",
      { to: "hq", verbose: true },
      undefined,
      undefined,
      ctx,
    );

    assert.match(list.content[0].text, /topology_list hq/);
    assert.match(list.content[0].text, new RegExp(request.details.packet.packet_id));
    assert.doesNotMatch(list.content[0].text, /"packet_id":/);
    assert.doesNotMatch(list.content[0].text, /"body":/);
  } finally {
    restoreEnv("PI_COMS_DIR", previousComsDir);
  }
});

test("topology_list and topology_get do not duplicate packet_received audit events", async () => {
  const registered: Record<string, { execute: Function }> = {};
  const pi = {
    registerTool(tool: { name: string; execute: Function }) {
      registered[tool.name] = tool;
    },
    registerCommand() {},
    on() {},
    registerFlag() {},
    getFlag() {
      return undefined;
    },
  };
  registerPiTopology(pi);

  const cwd = await mkdtemp(join(tmpdir(), "pi-topology-read-denoise-"));
  const ctx = { cwd };
  const previousComsDir = process.env.PI_COMS_DIR;
  try {
    process.env.PI_COMS_DIR = await mkdtemp(join("/private/tmp", "pi-topology-read-denoise-registry-"));
    await registered.topology_init_mission.execute(
      "init",
      { objective: "Avoid duplicate durable receive events", project: "read-denoise", allowed_paths: [cwd] },
      undefined,
      undefined,
      ctx,
    );
    const request = await registered.topology_send.execute(
      "send-request",
      {
        type: "REQUEST",
        from: "hq",
        to: "runner",
        body: { task: "Verify receive event idempotency" },
      },
      undefined,
      undefined,
      ctx,
    );

    await registered.topology_list.execute("list-1", { to: "runner" }, undefined, undefined, ctx);
    await registered.topology_list.execute("list-2", { to: "runner" }, undefined, undefined, ctx);
    clearPacketMemory(request.details.packet.mission_id, "runner");
    await registered.topology_list.execute("list-after-restart", { to: "runner" }, undefined, undefined, ctx);
    await registered.topology_get.execute(
      "get-1",
      { to: "runner", packet_id: request.details.packet.packet_id },
      undefined,
      undefined,
      ctx,
    );
    await registered.topology_get.execute(
      "get-2",
      { to: "runner", packet_id: request.details.packet.packet_id },
      undefined,
      undefined,
      ctx,
    );

    const receiveEvents = (await readFile(join(cwd, ".pi/topology/runtime-events.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { event_type: string; packet_id?: string })
      .filter((event) => event.event_type === "packet_received" && event.packet_id === request.details.packet.packet_id);
    assert.equal(receiveEvents.length, 1);
  } finally {
    restoreEnv("PI_COMS_DIR", previousComsDir);
  }
});

test("topology_init_mission ignores mission-card env from a different workspace", async () => {
  const registered: Record<string, { execute: Function }> = {};
  const pi = {
    registerTool(tool: { name: string; execute: Function }) {
      registered[tool.name] = tool;
    },
    registerCommand() {},
    on() {},
    registerFlag() {},
    getFlag() {
      return undefined;
    },
  };
  registerPiTopology(pi);

  const cwd = await mkdtemp(join(tmpdir(), "pi-topology-env-isolated-"));
  const foreign = await mkdtemp(join(tmpdir(), "pi-topology-foreign-mission-"));
  const foreignMissionPath = join(foreign, ".pi/topology/mission-card.json");
  await mkdir(join(foreign, ".pi/topology"), { recursive: true });
  await writeFile(foreignMissionPath, `${JSON.stringify({ sentinel: "do-not-overwrite" }, null, 2)}\n`, "utf8");
  const previous = {
    mission: process.env.PI_TOPOLOGY_MISSION_CARD,
    workdir: process.env.PI_TOPOLOGY_WORKDIR,
  };

  try {
    process.env.PI_TOPOLOGY_MISSION_CARD = foreignMissionPath;
    process.env.PI_TOPOLOGY_WORKDIR = foreign;
    await registered.topology_init_mission.execute(
      "init",
      { objective: "Do not overwrite another workspace mission", project: "env-isolated", allowed_paths: [cwd] },
      undefined,
      undefined,
      { cwd },
    );

    const foreignMission = JSON.parse(await readFile(foreignMissionPath, "utf8"));
    const localMission = JSON.parse(await readFile(join(cwd, ".pi/topology/mission-card.json"), "utf8"));
    assert.equal(foreignMission.sentinel, "do-not-overwrite");
    assert.equal(localMission.project, "env-isolated");
  } finally {
    restoreEnv("PI_TOPOLOGY_MISSION_CARD", previous.mission);
    restoreEnv("PI_TOPOLOGY_WORKDIR", previous.workdir);
  }
});

test("topology_list filters historical packets outside the active mission by default", async () => {
  const registered: Record<string, { execute: Function }> = {};
  const pi = {
    registerTool(tool: { name: string; execute: Function }) {
      registered[tool.name] = tool;
    },
    registerCommand() {},
    on() {},
    registerFlag() {},
    getFlag() {
      return undefined;
    },
  };
  registerPiTopology(pi);

  const cwd = await mkdtemp(join(tmpdir(), "pi-topology-list-mission-filter-"));
  const ctx = { cwd };
  const previousComsDir = process.env.PI_COMS_DIR;
  try {
    const comsDir = await mkdtemp(join("/private/tmp", "pi-topology-list-mission-filter-registry-"));
    process.env.PI_COMS_DIR = comsDir;
    await registered.topology_init_mission.execute(
      "init",
      { objective: "Filter stale inbox packets", project: "queue-filter", allowed_paths: [cwd] },
      undefined,
      undefined,
      ctx,
    );
    const active = await registered.topology_send.execute(
      "send-active",
      { type: "REQUEST", from: "hq", to: "runner", body: { task: "current verify smoke" } },
      undefined,
      undefined,
      ctx,
    );
    const stale = createPacket({
      mission_id: "old-mission-001",
      type: "REQUEST",
      from: "hq",
      to: "runner",
      body: { task: "stale verify smoke" },
    });
    const packetDir = join(comsDir, "projects", "queue-filter", "packets");
    await mkdir(packetDir, { recursive: true });
    await appendFile(join(packetDir, "runner-inbox.jsonl"), `${JSON.stringify(stale)}\n`, "utf8");

    const list = await registered.topology_list.execute(
      "list",
      { to: "runner" },
      undefined,
      undefined,
      ctx,
    );
    const history = await registered.topology_list.execute(
      "list-history",
      { to: "runner", include_history: true },
      undefined,
      undefined,
      ctx,
    );

    assert.match(list.content[0].text, new RegExp(active.details.packet.packet_id));
    assert.doesNotMatch(list.content[0].text, new RegExp(stale.packet_id));
    assert.match(history.content[0].text, new RegExp(stale.packet_id));
  } finally {
    restoreEnv("PI_COMS_DIR", previousComsDir);
  }
});

test("topology_send can build a packet body from simple top-level fields", async () => {
  const registered: Record<string, { execute: Function }> = {};
  const pi = {
    registerTool(tool: { name: string; execute: Function }) {
      registered[tool.name] = tool;
    },
    registerCommand() {},
    on() {},
    registerFlag() {},
    getFlag() {
      return undefined;
    },
  };
  registerPiTopology(pi);

  const cwd = await mkdtemp(join(tmpdir(), "pi-topology-send-fields-"));
  const ctx = { cwd };
  await registered.topology_init_mission.execute(
    "init",
    { objective: "Send fallback body fields", project: "dogfood", allowed_paths: [cwd] },
    undefined,
    undefined,
    ctx,
  );
  const report = await registered.topology_send.execute(
    "send-report",
    {
      type: "REPORT",
      from: "hq",
      to: "topology-supervisor",
      status: "blocked",
      summary: "artifact writer blocked",
      next: "wait for supervisor",
    },
    undefined,
    undefined,
    ctx,
  );

  assert.equal(report.details.ok, true);
  assert.equal(report.details.packet.body.status, "blocked");
  assert.equal(report.details.packet.body.summary, "artifact writer blocked");
  assert.equal(report.details.packet.body.next, "wait for supervisor");
});

test("topology_write_artifact writes role artifacts under mission topology folder", async () => {
  const registered: Record<string, { execute: Function }> = {};
  const pi = {
    registerTool(tool: { name: string; execute: Function }) {
      registered[tool.name] = tool;
    },
    registerCommand() {},
    on() {},
    registerFlag() {},
    getFlag() {
      return undefined;
    },
  };
  registerPiTopology(pi);

  const cwd = await mkdtemp(join(tmpdir(), "pi-topology-artifact-"));
  const ctx = { cwd };
  await registered.topology_init_mission.execute(
    "init",
    { objective: "Write compact reports", project: "dogfood", allowed_paths: [cwd] },
    undefined,
    undefined,
    ctx,
  );
  const result = await registered.topology_write_artifact.execute(
    "artifact",
    {
      role: "oracle",
      kind: "review",
      title: "P6 closeout review",
      body: "verdict: NEEDS-REVIEW\n\nEvidence stays in this artifact.",
      request_msg_id: "pkt_request",
    },
    undefined,
    undefined,
    ctx,
  );

  assert.match(result.details.artifact_path, /^\.pi\/topology\/artifacts\/oracle\//);
  const artifact = await readFile(join(cwd, result.details.artifact_path), "utf8");
  assert.match(artifact, /role: oracle/);
  assert.match(artifact, /kind: review/);
  assert.match(artifact, /request_msg_id: pkt_request/);
  assert.match(artifact, /Evidence stays in this artifact/);
});

test("topology_read_artifact reads only mission topology artifacts", async () => {
  const registered: Record<string, { execute: Function }> = {};
  const pi = {
    registerTool(tool: { name: string; execute: Function }) {
      registered[tool.name] = tool;
    },
    registerCommand() {},
    on() {},
    registerFlag() {},
    getFlag() {
      return undefined;
    },
  };
  registerPiTopology(pi);

  const cwd = await mkdtemp(join(tmpdir(), "pi-topology-read-artifact-"));
  const ctx = { cwd };
  await registered.topology_init_mission.execute(
    "init",
    { objective: "Read compact reports", project: "dogfood", allowed_paths: [cwd] },
    undefined,
    undefined,
    ctx,
  );
  const written = await registered.topology_write_artifact.execute(
    "artifact",
    {
      role: "runner",
      kind: "report",
      title: "Verification report",
      body: "verdict: pass",
    },
    undefined,
    undefined,
    ctx,
  );
  const read = await registered.topology_read_artifact.execute(
    "read-artifact",
    { artifact_path: written.details.artifact_path },
    undefined,
    undefined,
    ctx,
  );
  const blocked = await registered.topology_read_artifact.execute(
    "read-blocked",
    { artifact_path: "README.md" },
    undefined,
    undefined,
    ctx,
  );

  assert.match(read.content[0].text, /verdict: pass/);
  assert.equal(read.details.ok, true);
  assert.equal(blocked.details.ok, false);
  assert.match(blocked.content[0].text, /artifact_path must be under/);
});

test("topology_read_artifact returns a compact preview unless full is requested", async () => {
  const registered: Record<string, { execute: Function }> = {};
  const pi = {
    registerTool(tool: { name: string; execute: Function }) {
      registered[tool.name] = tool;
    },
    registerCommand() {},
    on() {},
    registerFlag() {},
    getFlag() {
      return undefined;
    },
  };
  registerPiTopology(pi);

  const cwd = await mkdtemp(join(tmpdir(), "pi-topology-read-artifact-compact-"));
  const ctx = { cwd };
  await registered.topology_init_mission.execute(
    "init",
    { objective: "Read compact reports", project: "dogfood", allowed_paths: [cwd] },
    undefined,
    undefined,
    ctx,
  );
  const longBody = [
    "verdict: pass",
    ...Array.from({ length: 260 }, (_, index) => `evidence line ${index + 1}: ${"detail ".repeat(12)}`),
    "TAIL_SENTINEL_DO_NOT_INLINE",
  ].join("\n");
  const written = await registered.topology_write_artifact.execute(
    "artifact",
    {
      role: "scott",
      kind: "report",
      title: "Long research report",
      body: longBody,
    },
    undefined,
    undefined,
    ctx,
  );

  const preview = await registered.topology_read_artifact.execute(
    "preview",
    { artifact_path: written.details.artifact_path },
    undefined,
    undefined,
    ctx,
  );
  const full = await registered.topology_read_artifact.execute(
    "full",
    { artifact_path: written.details.artifact_path, full: true },
    undefined,
    undefined,
    ctx,
  );

  assert.equal(preview.details.ok, true);
  assert.equal(preview.details.truncated, true);
  assert.match(preview.content[0].text, /topology_read_artifact/);
  assert.match(preview.content[0].text, /verdict: pass/);
  assert.doesNotMatch(preview.content[0].text, /TAIL_SENTINEL_DO_NOT_INLINE/);
  assert.match(full.content[0].text, /TAIL_SENTINEL_DO_NOT_INLINE/);
});

test("tool_call guard persists incident and guard_block runtime event", async () => {
  const handlers: Record<string, (...args: unknown[]) => unknown> = {};
  const pi = {
    registerTool() {},
    registerCommand() {},
    on(name: string, handler: (...args: unknown[]) => unknown) {
      handlers[name] = handler;
    },
    registerFlag() {},
    getFlag(name: string) {
      return name === "cname" ? "runner" : undefined;
    },
  };
  const cwd = await mkdtemp(join(tmpdir(), "pi-topology-guard-extension-"));
  const incidentLog = join(cwd, ".pi/topology/incident-log.jsonl");
  const eventLog = join(cwd, ".pi/topology/runtime-events.jsonl");
  const previous = {
    allowed: process.env.PI_TOPOLOGY_ALLOWED_PATHS,
    forbidden: process.env.PI_TOPOLOGY_FORBIDDEN_ACTIONS,
    incident: process.env.PI_TOPOLOGY_INCIDENT_LOG,
    event: process.env.PI_TOPOLOGY_EVENT_LOG,
    mission: process.env.PI_TOPOLOGY_MISSION_ID,
  };
  try {
    process.env.PI_TOPOLOGY_ALLOWED_PATHS = cwd;
    process.env.PI_TOPOLOGY_FORBIDDEN_ACTIONS = "git push:git reset --hard:rm -rf";
    process.env.PI_TOPOLOGY_INCIDENT_LOG = incidentLog;
    process.env.PI_TOPOLOGY_EVENT_LOG = eventLog;
    process.env.PI_TOPOLOGY_MISSION_ID = "dogfood-2026-06-16-001";
    registerPiTopology(pi);

    const result = await handlers.tool_call({ toolName: "write_file", input: { path: join(cwd, "notes.md") } });

    assert.equal((result as { block: boolean }).block, true);
    assert.match((result as { reason: string }).reason, /runner is read-only/);
    const incidents = (await readFile(incidentLog, "utf8")).trim().split("\n");
    assert.equal(incidents.length, 1);
    const events = (await readFile(eventLog, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { event_type: string });
    assert.equal(events[0].event_type, "guard_block");
  } finally {
    restoreEnv("PI_TOPOLOGY_ALLOWED_PATHS", previous.allowed);
    restoreEnv("PI_TOPOLOGY_FORBIDDEN_ACTIONS", previous.forbidden);
    restoreEnv("PI_TOPOLOGY_INCIDENT_LOG", previous.incident);
    restoreEnv("PI_TOPOLOGY_EVENT_LOG", previous.event);
    restoreEnv("PI_TOPOLOGY_MISSION_ID", previous.mission);
  }
});

test("tool_call guard allows a role to write its own topology artifact", async () => {
  const handlers: Record<string, (...args: unknown[]) => unknown> = {};
  const pi = {
    registerTool() {},
    registerCommand() {},
    on(name: string, handler: (...args: unknown[]) => unknown) {
      handlers[name] = handler;
    },
    registerFlag() {},
    getFlag(name: string) {
      return name === "cname" ? "hq" : undefined;
    },
  };
  const cwd = await mkdtemp(join(tmpdir(), "pi-topology-artifact-guard-"));
  const incidentLog = join(cwd, ".pi/topology/incident-log.jsonl");
  const eventLog = join(cwd, ".pi/topology/runtime-events.jsonl");
  const previous = {
    allowed: process.env.PI_TOPOLOGY_ALLOWED_PATHS,
    forbidden: process.env.PI_TOPOLOGY_FORBIDDEN_ACTIONS,
    incident: process.env.PI_TOPOLOGY_INCIDENT_LOG,
    event: process.env.PI_TOPOLOGY_EVENT_LOG,
    mission: process.env.PI_TOPOLOGY_MISSION_ID,
  };
  try {
    process.env.PI_TOPOLOGY_ALLOWED_PATHS = cwd;
    process.env.PI_TOPOLOGY_FORBIDDEN_ACTIONS = "git push:git reset --hard:rm -rf";
    process.env.PI_TOPOLOGY_INCIDENT_LOG = incidentLog;
    process.env.PI_TOPOLOGY_EVENT_LOG = eventLog;
    process.env.PI_TOPOLOGY_MISSION_ID = "dogfood-2026-06-16-002";
    registerPiTopology(pi);

    const ownArtifact = await handlers.tool_call({
      toolName: "topology_write_artifact",
      input: { role: "hq", kind: "report", title: "HQ intake", body: "alive" },
    });
    const crossRoleArtifact = await handlers.tool_call({
      toolName: "topology_write_artifact",
      input: { role: "runner", kind: "report", title: "Runner report", body: "bad role" },
    });

    assert.equal(ownArtifact, undefined);
    assert.equal((crossRoleArtifact as { block: boolean }).block, true);
    assert.match((crossRoleArtifact as { reason: string }).reason, /cannot write artifacts for runner/);
    const incidents = (await readFile(incidentLog, "utf8")).trim().split("\n");
    assert.equal(incidents.length, 1);
  } finally {
    restoreEnv("PI_TOPOLOGY_ALLOWED_PATHS", previous.allowed);
    restoreEnv("PI_TOPOLOGY_FORBIDDEN_ACTIONS", previous.forbidden);
    restoreEnv("PI_TOPOLOGY_INCIDENT_LOG", previous.incident);
    restoreEnv("PI_TOPOLOGY_EVENT_LOG", previous.event);
    restoreEnv("PI_TOPOLOGY_MISSION_ID", previous.mission);
  }
});

test("session_start records alive confirmation for topology role sessions", async () => {
  const handlers: Record<string, (...args: unknown[]) => unknown> = {};
  const pi = {
    registerTool() {},
    registerCommand() {},
    on(name: string, handler: (...args: unknown[]) => unknown) {
      handlers[name] = handler;
    },
    registerFlag() {},
    getFlag(name: string) {
      return name === "cname" ? "runner" : undefined;
    },
  };
  const cwd = await mkdtemp(join(tmpdir(), "pi-topology-session-alive-"));
  const mission = createMissionDraft({
    project: "alive",
    workdir: cwd,
    objective: "Confirm role session",
    allowed_paths: [cwd],
  });
  await mkdir(join(cwd, ".pi/topology"), { recursive: true });
  await writeFile(join(cwd, ".pi/topology/mission-card.json"), `${JSON.stringify(mission, null, 2)}\n`, "utf8");
  await writeFile(join(cwd, ".pi/topology/status-board.json"), `${JSON.stringify(createInitialStatusBoard(mission), null, 2)}\n`, "utf8");
  const previous = {
    mission: process.env.PI_TOPOLOGY_MISSION_CARD,
    workdir: process.env.PI_TOPOLOGY_WORKDIR,
    script: process.env.PI_TOPOLOGY_LAUNCH_SCRIPT,
    provider: process.env.PI_TOPOLOGY_PROVIDER,
    model: process.env.PI_TOPOLOGY_MODEL,
    coms: process.env.PI_COMS_DIR,
    liveTransport: process.env.PI_TOPOLOGY_LIVE_TRANSPORT,
  };
  try {
    process.env.PI_TOPOLOGY_MISSION_CARD = join(cwd, ".pi/topology/mission-card.json");
    process.env.PI_TOPOLOGY_WORKDIR = cwd;
    process.env.PI_TOPOLOGY_LAUNCH_SCRIPT = join(cwd, ".pi/topology/launch/runner.sh");
    process.env.PI_TOPOLOGY_PROVIDER = "minimax-cn";
    process.env.PI_TOPOLOGY_MODEL = "MiniMax-M3";
    process.env.PI_COMS_DIR = await mkdtemp(join("/private/tmp", "pi-topology-live-registry-"));
    process.env.PI_TOPOLOGY_LIVE_TRANSPORT = "memory";
    registerPiTopology(pi);

    await Promise.resolve(handlers.session_start({}, {}));

    const sessions = (await readFile(join(cwd, ".pi/topology/sessions.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { role: string; state: string; session_id: string | null; provider?: string; model?: string });
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].role, "runner");
    assert.equal(sessions[0].state, "alive_confirmed");
    assert.equal(sessions[0].provider, "minimax-cn");
    assert.equal(sessions[0].model, "MiniMax-M3");
    assert.match(sessions[0].session_id ?? "", /^runner-/);
    const board = JSON.parse(await readFile(join(cwd, ".pi/topology/status-board.json"), "utf8"));
    assert.equal(board.peer_status.runner.state, "alive");
    assert.equal(board.peer_status.runner.alive, true);
  } finally {
    handlers.session_shutdown?.();
    restoreEnv("PI_TOPOLOGY_MISSION_CARD", previous.mission);
    restoreEnv("PI_TOPOLOGY_WORKDIR", previous.workdir);
    restoreEnv("PI_TOPOLOGY_LAUNCH_SCRIPT", previous.script);
    restoreEnv("PI_TOPOLOGY_PROVIDER", previous.provider);
    restoreEnv("PI_TOPOLOGY_MODEL", previous.model);
    restoreEnv("PI_COMS_DIR", previous.coms);
    restoreEnv("PI_TOPOLOGY_LIVE_TRANSPORT", previous.liveTransport);
  }
});

test("session_start heartbeat refreshes live registry without crashing Pi", async () => {
  const handlers: Record<string, (...args: unknown[]) => unknown> = {};
  const pi = {
    registerTool() {},
    registerCommand() {},
    on(name: string, handler: (...args: unknown[]) => unknown) {
      handlers[name] = handler;
    },
    registerFlag() {},
    getFlag(name: string) {
      return name === "cname" ? "runner" : undefined;
    },
  };
  const cwd = await mkdtemp(join(tmpdir(), "pi-topology-session-heartbeat-"));
  const registryRoot = await mkdtemp(join("/private/tmp", "pi-topology-heartbeat-registry-"));
  const mission = createMissionDraft({
    project: "heartbeat",
    workdir: cwd,
    objective: "Keep role session alive",
    allowed_paths: [cwd],
  });
  await mkdir(join(cwd, ".pi/topology"), { recursive: true });
  await writeFile(join(cwd, ".pi/topology/mission-card.json"), `${JSON.stringify(mission, null, 2)}\n`, "utf8");
  await writeFile(join(cwd, ".pi/topology/status-board.json"), `${JSON.stringify(createInitialStatusBoard(mission), null, 2)}\n`, "utf8");
  const previous = {
    mission: process.env.PI_TOPOLOGY_MISSION_CARD,
    workdir: process.env.PI_TOPOLOGY_WORKDIR,
    coms: process.env.PI_COMS_DIR,
    liveTransport: process.env.PI_TOPOLOGY_LIVE_TRANSPORT,
  };
  const previousSetInterval = globalThis.setInterval;
  const previousClearInterval = globalThis.clearInterval;
  let heartbeat: (() => void) | null = null;
  const fakeTimer = { unref() {} } as NodeJS.Timeout;
  try {
    process.env.PI_TOPOLOGY_MISSION_CARD = join(cwd, ".pi/topology/mission-card.json");
    process.env.PI_TOPOLOGY_WORKDIR = cwd;
    process.env.PI_COMS_DIR = registryRoot;
    process.env.PI_TOPOLOGY_LIVE_TRANSPORT = "memory";
    globalThis.setInterval = ((handler: (...args: unknown[]) => void, _timeout?: number, ...args: unknown[]) => {
      heartbeat = () => handler(...args);
      return fakeTimer;
    }) as typeof globalThis.setInterval;
    globalThis.clearInterval = (() => undefined) as typeof globalThis.clearInterval;
    registerPiTopology(pi);

    await Promise.resolve(handlers.session_start({}, {
      getContextUsage() {
        return { percent: 42 };
      },
      ui: {
        setStatus() {},
        setWidget() {},
        requestRender() {},
      },
    }));

    assert.equal(typeof heartbeat, "function");
    assert.doesNotThrow(() => heartbeat?.());
    await new Promise((resolve) => setImmediate(resolve));

    const board = JSON.parse(await readFile(join(cwd, ".pi/topology/status-board.json"), "utf8"));
    assert.equal(board.peer_status.runner.context_used_pct, 42);
    assert.equal(typeof board.peer_status.runner.last_heartbeat_at, "string");
  } finally {
    handlers.session_shutdown?.();
    globalThis.setInterval = previousSetInterval;
    globalThis.clearInterval = previousClearInterval;
    restoreEnv("PI_TOPOLOGY_MISSION_CARD", previous.mission);
    restoreEnv("PI_TOPOLOGY_WORKDIR", previous.workdir);
    restoreEnv("PI_COMS_DIR", previous.coms);
    restoreEnv("PI_TOPOLOGY_LIVE_TRANSPORT", previous.liveTransport);
  }
});

test("topology spawn hq launches a visible HQ peer session from supervisor", async () => {
  const commands: Record<string, { handler: (args: string, ctx: Record<string, unknown>) => Promise<string> }> = {};
  const pi = {
    registerTool() {},
    registerCommand(name: string, command: { handler: (args: string, ctx: Record<string, unknown>) => Promise<string> }) {
      commands[name] = command;
    },
    sendMessage() {},
    on() {},
    registerFlag() {},
    getFlag() {
      return undefined;
    },
  };
  registerPiTopology(pi);

  const cwd = await mkdtemp(join(tmpdir(), "pi-topology-mesh-spawn-guidance-"));
  const previousComsDir = process.env.PI_COMS_DIR;
  process.env.PI_COMS_DIR = await mkdtemp(join("/private/tmp", "pi-topology-command-spawn-registry-"));
  await commands.topology.handler("Stabilize supervisor bootstrap", {
    cwd,
    sessionManager: {
      getBranch() {
        return [];
      },
    },
    getContextUsage() {
      return { percent: 11 };
    },
    ui: {
      setStatus() {},
      setWidget() {},
      requestRender() {},
      notify() {},
    },
  });

  const missionPath = join(cwd, ".pi/topology/mission-card.json");
  const mission = JSON.parse(await readFile(missionPath, "utf8"));
  mission.progress.status = "running";
  mission.progress.current_step = "Owner approved mission; HQ launch ready.";
  mission.progress.completed_steps = [...new Set([...(mission.progress.completed_steps ?? []), "owner_confirm_mission"])];
  await writeFile(missionPath, `${JSON.stringify(mission, null, 2)}\n`, "utf8");
  const statusPath = join(cwd, ".pi/topology/status-board.json");
  const board = JSON.parse(await readFile(statusPath, "utf8"));
  board.runtime_phase = "approved";
  board.next_gate = { type: "none", owner_required: false, reason: "Mission approved", created_at: new Date().toISOString() };
  await writeFile(statusPath, `${JSON.stringify(board, null, 2)}\n`, "utf8");

  const result = await commands.topology.handler("spawn hq", {
    cwd,
    sessionManager: {
      getBranch() {
        return [];
      },
    },
    ui: {
      notify() {},
    },
  });

  assert.match(result, /launch requested for hq/);
  assert.match(result, /Wait for the dashboard\/registry heartbeat to confirm the role becomes live/);
  const nextBoard = JSON.parse(await readFile(statusPath, "utf8"));
  assert.equal(nextBoard.peer_status.hq.state, "launch_requested");
  const sessions = (await readFile(join(cwd, ".pi/topology/sessions.jsonl"), "utf8")).trim().split("\n");
  assert.equal(sessions.some((line) => /"role":"hq"/.test(line) && /"state":"launch_requested"/.test(line)), true);
  restoreEnv("PI_COMS_DIR", previousComsDir);
});

test("live inbound packet wakes a topology role session with follow-up sendMessage", async () => {
  const handlers: Record<string, (...args: unknown[]) => unknown> = {};
  const sentMessages: Array<{ message: { customType: string; content: string; details?: Record<string, unknown> }; options?: Record<string, unknown> }> = [];
  const appendedEntries: Array<{ key: string; value: Record<string, unknown> }> = [];
  const pi = {
    registerTool() {},
    registerCommand() {},
    on(name: string, handler: (...args: unknown[]) => unknown) {
      handlers[name] = handler;
    },
    registerFlag() {},
    getFlag(name: string) {
      return name === "cname" ? "hq" : undefined;
    },
    sendMessage(message: { customType: string; content: string; details?: Record<string, unknown> }, options?: Record<string, unknown>) {
      sentMessages.push({ message, options });
    },
    appendEntry(key: string, value: Record<string, unknown>) {
      appendedEntries.push({ key, value });
    },
  };
  const cwd = await mkdtemp(join(tmpdir(), "pi-topology-live-wakeup-"));
  const registryRoot = await mkdtemp(join("/private/tmp", "pi-topology-live-registry-"));
  const mission = createMissionDraft({
    project: "livewake",
    workdir: cwd,
    objective: "Wake HQ on late runner report",
    allowed_paths: [cwd],
  });
  await mkdir(join(cwd, ".pi/topology"), { recursive: true });
  await writeFile(join(cwd, ".pi/topology/mission-card.json"), `${JSON.stringify(mission, null, 2)}\n`, "utf8");
  await writeFile(join(cwd, ".pi/topology/status-board.json"), `${JSON.stringify(createInitialStatusBoard(mission), null, 2)}\n`, "utf8");
  const previous = {
    mission: process.env.PI_TOPOLOGY_MISSION_CARD,
    workdir: process.env.PI_TOPOLOGY_WORKDIR,
    coms: process.env.PI_COMS_DIR,
    liveTransport: process.env.PI_TOPOLOGY_LIVE_TRANSPORT,
  };
  try {
    process.env.PI_TOPOLOGY_MISSION_CARD = join(cwd, ".pi/topology/mission-card.json");
    process.env.PI_TOPOLOGY_WORKDIR = cwd;
    process.env.PI_COMS_DIR = registryRoot;
    process.env.PI_TOPOLOGY_LIVE_TRANSPORT = "memory";
    registerPiTopology(pi);
    await Promise.resolve(handlers.session_start({}, {}));

    const packet = createPacket({
      mission_id: mission.mission_id,
      type: "REPORT",
      from: "runner",
      to: "hq",
      body: { status: "pass", evidence: "late runner report" },
    });
    const result = await topology_send(registryRoot, mission.project, packet);

    assert.equal(result.live_delivery?.status, "delivered");
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].message.customType, "topology-inbound");
    assert.match(sentMessages[0].message.content, /\[topology-inbound\]/);
    assert.match(sentMessages[0].message.content, /late runner report/);
    assert.deepEqual(sentMessages[0].options, { deliverAs: "followUp", triggerTurn: true });
    assert.equal(appendedEntries.length, 1);
    assert.equal(appendedEntries[0].key, "topology-packet");
    assert.equal(appendedEntries[0].value.packet_id, packet.packet_id);
  } finally {
    handlers.session_shutdown?.();
    restoreEnv("PI_TOPOLOGY_MISSION_CARD", previous.mission);
    restoreEnv("PI_TOPOLOGY_WORKDIR", previous.workdir);
    restoreEnv("PI_COMS_DIR", previous.coms);
    restoreEnv("PI_TOPOLOGY_LIVE_TRANSPORT", previous.liveTransport);
  }
});

test("terminal and duplicate inbound packets do not wake a topology role session", async () => {
  const handlers: Record<string, (...args: unknown[]) => unknown> = {};
  const sentMessages: Array<{ message: { customType: string; content: string; details?: Record<string, unknown> }; options?: Record<string, unknown> }> = [];
  const appendedEntries: Array<{ key: string; value: Record<string, unknown> }> = [];
  const pi = {
    registerTool() {},
    registerCommand() {},
    on(name: string, handler: (...args: unknown[]) => unknown) {
      handlers[name] = handler;
    },
    registerFlag() {},
    getFlag(name: string) {
      return name === "cname" ? "hq" : undefined;
    },
    sendMessage(message: { customType: string; content: string; details?: Record<string, unknown> }, options?: Record<string, unknown>) {
      sentMessages.push({ message, options });
    },
    appendEntry(key: string, value: Record<string, unknown>) {
      appendedEntries.push({ key, value });
    },
  };
  const cwd = await mkdtemp(join(tmpdir(), "pi-topology-live-terminal-"));
  const registryRoot = await mkdtemp(join("/private/tmp", "pi-topology-live-registry-"));
  const mission = createMissionDraft({
    project: "liveterminal",
    workdir: cwd,
    objective: "Ignore terminal inbound control packets",
    allowed_paths: [cwd],
  });
  await mkdir(join(cwd, ".pi/topology"), { recursive: true });
  await writeFile(join(cwd, ".pi/topology/mission-card.json"), `${JSON.stringify(mission, null, 2)}\n`, "utf8");
  await writeFile(join(cwd, ".pi/topology/status-board.json"), `${JSON.stringify(createInitialStatusBoard(mission), null, 2)}\n`, "utf8");
  const previous = {
    mission: process.env.PI_TOPOLOGY_MISSION_CARD,
    workdir: process.env.PI_TOPOLOGY_WORKDIR,
    coms: process.env.PI_COMS_DIR,
    liveTransport: process.env.PI_TOPOLOGY_LIVE_TRANSPORT,
  };
  try {
    process.env.PI_TOPOLOGY_MISSION_CARD = join(cwd, ".pi/topology/mission-card.json");
    process.env.PI_TOPOLOGY_WORKDIR = cwd;
    process.env.PI_COMS_DIR = registryRoot;
    process.env.PI_TOPOLOGY_LIVE_TRANSPORT = "memory";
    registerPiTopology(pi);
    await Promise.resolve(handlers.session_start({}, {}));

    const ackPacket = createPacket({
      mission_id: mission.mission_id,
      type: "ACK",
      from: "topology-supervisor",
      to: "hq",
      request_msg_id: "pkt_request",
      body: {
        status: "accepted",
        received_packet_id: "pkt_request",
        next: "standby",
      },
    });
    const verdictPacket = createPacket({
      mission_id: mission.mission_id,
      type: "VERDICT",
      from: "topology-supervisor",
      to: "hq",
      body: {
        verdict: "closeout_acknowledged",
        next: "stand_down",
      },
    });

    await topology_send(registryRoot, mission.project, ackPacket);
    await topology_send(registryRoot, mission.project, verdictPacket);
    await topology_send(registryRoot, mission.project, ackPacket);

    assert.equal(sentMessages.length, 0);
    assert.equal(appendedEntries.length, 3);
    assert.equal(appendedEntries.every((entry) => entry.key === "topology-packet"), true);
    assert.deepEqual(
      appendedEntries.map((entry) => entry.value.delivery_mode),
      ["append-only", "append-only", "append-only"],
    );
    assert.deepEqual(
      appendedEntries.map((entry) => entry.value.reason),
      ["ack", "terminal_verdict", "duplicate"],
    );
  } finally {
    handlers.session_shutdown?.();
    restoreEnv("PI_TOPOLOGY_MISSION_CARD", previous.mission);
    restoreEnv("PI_TOPOLOGY_WORKDIR", previous.workdir);
    restoreEnv("PI_COMS_DIR", previous.coms);
    restoreEnv("PI_TOPOLOGY_LIVE_TRANSPORT", previous.liveTransport);
  }
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
