import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInitialStatusBoard, createMissionDraft, normalizeMissionCard, runWatchdogCheck, validateMissionCard, type MissionCard, type StatusBoard } from "../runtime/mission.ts";
import { missionPathForWorkspace } from "../runtime/mission-path.ts";
import { activePendingPackets, reconcileBoardWithLiveRegistry, reconcileBoardWithSessionRecords } from "../runtime/status-board.ts";
import { buildRoleLaunchPlan, writeMissionLaunchScriptsSync, writeRoleLaunchScript } from "../runtime/spawn.ts";
import { markMissionProgressForHqLaunch, markRoleLaunchRequested } from "../runtime/status-board.ts";
import { appendEventSync } from "../state/event-log.ts";
import { appendSessionRecordSync } from "../state/session-ledger.ts";
import { readFreshPeerRegistrySync } from "../transport/registry.ts";
import { spawn } from "node:child_process";

interface PiLike {
  registerCommand: (name: string, command: Record<string, unknown>) => void;
  sendMessage?: (message: { customType: string; content: string; display?: string; details?: Record<string, unknown> }, options?: Record<string, unknown>) => void;
}

export interface TopologyCommandHooks {
  activateSupervisor?: (mission: MissionCard, ctx: CommandContext) => Promise<{ sessionId: string }>;
  isSupervisorActive?: (missionId?: string) => boolean;
}

export function registerTopologyCommands(pi: PiLike, hooks: TopologyCommandHooks = {}): void {
  pi.registerCommand("topology-status", {
    description: "Show the current Pi topology preflight/status summary.",
    handler: (_args: string, ctx: CommandContext) => {
      const result = renderPreflight(ctx.cwd, { detailed: true, supervisorActive: hooks.isSupervisorActive?.() });
      ctx.ui?.notify?.(`Topology status checked for ${ctx.cwd}`, "info");
      emitCommandText(pi, result, { command: "topology-status", cwd: ctx.cwd });
      return result;
    },
  });

  pi.registerCommand("topology", {
    description: "Run topology preflight, initialize a mission, or show topology startup guidance.",
    handler: async (args: string, ctx: CommandContext) => {
      const result = await handleTopologyCommand(args, ctx, hooks);
      emitCommandText(pi, result, { command: "topology", args, cwd: ctx.cwd });
      return result;
    },
  });
}

export interface CommandContext {
  cwd: string;
  ui?: {
    notify?: (message: string, level?: string) => void;
    setStatus?: (name: string, value: string | undefined) => void;
    setWidget?: (name: string, value: unknown, options?: Record<string, unknown>) => void;
    requestRender?: () => void;
  };
  sessionManager?: {
    getSessionFile?: () => string | undefined;
    getBranch?: () => Array<{
      id?: string;
      type: string;
      message?: {
        role?: string;
        content?: unknown;
      };
    }>;
  };
  getContextUsage?: () => { percent?: number } | undefined;
}

async function handleTopologyCommand(args: string, ctx: CommandContext, hooks: TopologyCommandHooks): Promise<string> {
  const trimmed = args.trim();
  if (!trimmed) return handleBareTopology(ctx, hooks);
  if (trimmed === "preflight") return renderPreflight(ctx.cwd, { detailed: true, supervisorActive: hooks.isSupervisorActive?.() });

  const [subcommand = "", ...rest] = splitArgs(trimmed);
  switch (subcommand) {
    case "help":
      return renderHelp();
    case "status":
      return renderPreflight(ctx.cwd, { detailed: true, supervisorActive: hooks.isSupervisorActive?.() });
    case "doctor":
      return renderDoctor(ctx.cwd);
    case "packets":
      return renderPackets(ctx.cwd);
    case "init":
      return initMission(ctx.cwd, rest.join(" ").trim(), ctx, {}, hooks);
    case "spawn":
      return handleSpawnCommand(ctx.cwd, rest[0] ?? "hq", ctx, hooks);
    default:
      return initMission(ctx.cwd, trimmed, ctx, {}, hooks);
  }
}

function handleBareTopology(ctx: CommandContext, hooks: TopologyCommandHooks): Promise<string> | string {
  const state = loadTopologyState(ctx.cwd);
  if (state.mission) return resumeExistingMission(ctx.cwd, state.mission, ctx, hooks);
  const candidate = findLatestAssistantTaskCard(ctx);
  if (!candidate) return renderPreflight(ctx.cwd);
  return initMission(ctx.cwd, candidate.objective, ctx, {
    source: "session_context",
    source_entry_id: candidate.entryId,
    source_excerpt: candidate.excerpt,
  }, hooks);
}

function renderPreflight(cwd: string, options: { detailed?: boolean; supervisorActive?: boolean } = {}): string {
  const state = loadTopologyState(cwd);
  const trust = inspectTrust(cwd);
  if (!state.mission) {
    return [
      "Topology preflight",
      `project: ${path.basename(cwd)}`,
      `cwd: ${cwd}`,
      `trusted: ${trust}`,
      "mission: none",
      "mode: intake - no mission created yet",
      "",
      "Recommended next:",
      "- If the previous assistant reply is a task card, /topology will auto-draft the mission and promote this session to Supervisor.",
      "- Or type /topology <task goal or task card> directly; no init keyword is required.",
      "",
      "What init does:",
      "- creates .pi/topology/mission-card.json",
      "- creates .pi/topology/status-board.json",
      "- writes .pi/topology/launch/topology-supervisor.sh and role scripts",
      "- appends runtime_boot + mission_initialized events",
      "- keeps worker spawn behind the Supervisor/owner gate",
      "",
      "Other commands:",
      "/topology status",
      "/topology doctor",
      "/topology packets",
      "/topology spawn hq",
    ].join("\n");
  }

  const board = state.board;
  const validation = validateMissionCard(state.mission);
  const incidentCount = countJsonl(state.incidentPath);
  const sessionRecordCount = countJsonl(state.sessionLedgerPath);
  const packetCount = countJsonl(state.outboxPath);
  const pendingPackets = activePendingPackets(board?.pending_packets ?? []);
  const supervisorScript = path.join(cwd, ".pi", "topology", "launch", "topology-supervisor.sh");
  const supervisorLaunch = currentTerminalCommand(cwd, supervisorScript);
  const lines = [
    "Topology preflight",
    `project: ${state.mission.project}`,
    `cwd: ${cwd}`,
    `trusted: ${trust}`,
    `mission: ${state.mission.mission_id}`,
    `objective: ${state.mission.objective}`,
    `progress: ${state.mission.progress?.status ?? "unknown"} (${state.mission.progress?.percent ?? "?"}%)`,
    `current_step: ${state.mission.progress?.current_step ?? "unknown"}`,
    `phase: ${board?.runtime_phase ?? "unknown"}`,
    `owner_gate: ${board?.next_gate?.owner_required ? board.next_gate.reason : "clear"}`,
    `incidents: ${incidentCount}`,
    `session_records: ${sessionRecordCount}`,
    `outbox_packets: ${packetCount}`,
    ...(pendingPackets.length ? [`pending_packets: ${pendingPackets.length}`] : []),
    `validation: ${validation.ok ? "ok" : validation.errors.join("; ")}`,
    "",
    "Recommended next:",
    ...recommendedNextLines({ board, supervisorActive: options.supervisorActive, supervisorLaunch }),
  ];
  if (options.detailed) {
    lines.push(
      "",
      "Paths:",
      `mission_card: ${state.missionPath}`,
      `status_board: ${state.statusPath}`,
      `incident_log: ${state.incidentPath}`,
      `runtime_events: ${state.eventPath}`,
      `session_ledger: ${state.sessionLedgerPath}`,
      `local_outbox: ${state.outboxPath}`,
    );
  }
  return lines.join("\n");
}

function recommendedNextLines(options: {
  board: StatusBoard | null;
  supervisorActive?: boolean;
  supervisorLaunch: string;
}): string[] {
  const hq = options.board?.peer_status?.hq;
  if (hq?.alive === true || hq?.state === "alive") {
    return [
      "HQ is already live.",
      "Continue with dispatch/status review; do not launch another HQ unless the owner explicitly requests a replacement.",
    ];
  }
  if (options.supervisorActive) {
    if (hq?.state === "launch_requested") {
      return [
        "The current session is already topology-supervisor.",
        "HQ launch has already been requested; wait for the dashboard/registry heartbeat before retrying.",
      ];
    }
    return [
      "The current session is already topology-supervisor.",
      "Continue here: review the mission card, ask owner approval, then launch HQ only if the launch set requires it.",
    ];
  }
  return [
    "Launch the Supervisor entry session:",
    options.supervisorLaunch,
    "Supervisor will review the mission card, ask owner approval, then launch HQ and needed worker sessions.",
  ];
}

async function initMission(cwd: string, objective: string, ctx: CommandContext, options: {
  source?: "manual" | "session_context";
  source_entry_id?: string;
  source_excerpt?: string;
} = {}, hooks: TopologyCommandHooks = {}): Promise<string> {
  if (!objective) {
    return [
      "Topology needs a task goal or task card.",
      "",
      "Usage:",
      "/topology Stabilize package smoke and update readiness docs",
      "",
      "Compatibility form:",
      "/topology init <task card>",
    ].join("\n");
  }

  const state = loadTopologyState(cwd);
  if (state.mission) {
    return resumeExistingMission(cwd, state.mission, ctx, hooks);
  }

  const project = path.basename(cwd);
  const mission = createMissionDraft({
    project,
    workdir: cwd,
    objective,
    allowed_paths: [cwd],
    source: options.source ?? "manual",
    source_entry_id: options.source_entry_id,
  });
  mission.progress = {
    ...mission.progress,
    current_step: "Current session is topology-supervisor; waiting for owner confirmation before dynamic role spawn.",
    completed_steps: unique([...mission.progress.completed_steps, "start_topology_supervisor"]),
    pending_steps: mission.progress.pending_steps.filter((step) => step !== "start_topology_supervisor"),
  };
  const missionPath = missionPathFor(cwd);
  const statusPath = path.join(cwd, mission.status_board_path);
  const eventPath = path.join(cwd, mission.event_log_path);
  const sessionLedgerPath = path.join(cwd, mission.session_ledger_path);
  const packageRoot = resolvePackageRoot();
  writeJson(missionPath, mission);
  writeJson(statusPath, createInitialStatusBoard(mission));
  const launchScripts = writeMissionLaunchScriptsSync(mission, {
    packageRoot,
    missionPath,
    registryRoot: process.env.PI_COMS_DIR ?? path.join("/tmp", `pi-topology-${mission.project}`),
    provider: "minimax-cn",
    model: "MiniMax-M3",
    thinking: "low",
  });
  appendEventSync(eventPath, {
    event_type: "runtime_boot",
    mission_id: mission.mission_id,
    project,
    evidence: { transport: ["/topology"], business: [], inference: [] },
  });
  appendEventSync(eventPath, {
    event_type: "mission_initialized",
    mission_id: mission.mission_id,
    mission_path: missionPath,
    status_board_path: statusPath,
    evidence: { transport: [missionPath, statusPath], business: [objective], inference: [] },
  });
  appendEventSync(eventPath, {
    event_type: "launch_scripts_written",
    mission_id: mission.mission_id,
    launch_dir: path.join(cwd, ".pi", "topology", "launch"),
    roles: launchScripts.map((entry) => entry.role),
    evidence: {
      transport: launchScripts.map((entry) => entry.scriptPath),
      business: ["topology-supervisor entry script generated"],
      inference: [],
    },
  });
  for (const entry of launchScripts) {
    appendSessionRecordSync(sessionLedgerPath, {
      mission_id: mission.mission_id,
      project,
      role: entry.role,
      state: "script_written",
      session_id: null,
      script_path: entry.scriptPath,
      launch_command: entry.launchCommand,
      provider: "minimax-cn",
      model: "MiniMax-M3",
      thinking: "low",
      evidence: {
        transport: [entry.scriptPath, sessionLedgerPath],
        business: [`${entry.role} launch script generated`],
        inference: ["script_written is not proof that the role session is alive"],
      },
    });
  }
  ctx.ui?.notify?.(`Topology mission initialized: ${mission.mission_id}`, "info");
  const activation = hooks.activateSupervisor
    ? await hooks.activateSupervisor(mission, ctx)
    : null;
  const supervisor = launchScripts.find((entry) => entry.role === "topology-supervisor");

  return [
    `ACK topology-supervisor: initialized mission ${mission.mission_id}.`,
    "",
    `objective: ${objective}`,
    `progress: ${mission.progress.status} (${mission.progress.percent}%)`,
    ...(options.source_excerpt ? ["source: latest assistant task card", `source_excerpt: ${options.source_excerpt}`] : []),
    `allowed_paths: ${cwd}`,
    "phase: intake",
    "owner_gate: required before dynamic role spawn",
    "",
    "Next:",
    activation
      ? `1. The current session is now topology-supervisor (${activation.sessionId}).`
      : "1. Review this task card and allowed path.",
    activation
      ? "2. Continue in this session; a Supervisor bootstrap follow-up has been queued."
      : "2. Launch the Supervisor entry session:",
    activation
      ? "3. Supervisor will ask for owner approval before using the generated role scripts."
      : supervisor?.launchCommand ?? currentTerminalCommand(cwd, path.join(cwd, ".pi/topology/launch/topology-supervisor.sh")),
    ...(activation ? [] : ["3. Supervisor will ask for owner approval before using the generated role scripts."]),
    "",
    `launch_dir: ${path.join(cwd, ".pi", "topology", "launch")}`,
    `session_ledger: ${sessionLedgerPath}`,
  ].join("\n");
}

async function resumeExistingMission(cwd: string, mission: MissionCard, ctx: CommandContext, hooks: TopologyCommandHooks): Promise<string> {
  if (hooks.isSupervisorActive?.(mission.mission_id)) {
    return [
      `ACK topology-supervisor: existing mission ${mission.mission_id} is already active in this session.`,
      "",
      `objective: ${mission.objective}`,
      "",
      "Current session is already topology-supervisor.",
      "Use /topology status for details, or continue with owner approval / HQ launch from here.",
    ].join("\n");
  }

  const activation = hooks.activateSupervisor
    ? await hooks.activateSupervisor(mission, ctx)
    : null;
  if (!activation) {
    return renderPreflight(cwd, { detailed: true, supervisorActive: false });
  }

  ctx.ui?.notify?.(`Topology mission resumed: ${mission.mission_id}`, "info");
  return [
    `ACK topology-supervisor: resumed existing mission ${mission.mission_id}.`,
    "",
    `objective: ${mission.objective}`,
    `progress: ${mission.progress?.status ?? "unknown"} (${mission.progress?.percent ?? "?"}%)`,
    `allowed_paths: ${mission.allowed_paths.join(", ")}`,
    "",
    "Next:",
    `1. The current session is now topology-supervisor (${activation.sessionId}).`,
    "2. Continue in this session; a Supervisor bootstrap follow-up has been queued.",
    "3. Supervisor will inspect current state and ask owner approval before spawning additional roles.",
    "",
    `mission_card: ${missionPathFor(cwd)}`,
    `session_ledger: ${path.join(cwd, mission.session_ledger_path ?? ".pi/topology/sessions.jsonl")}`,
  ].join("\n");
}

function renderDoctor(cwd: string): string {
  const state = loadTopologyState(cwd);
  if (!state.mission) return "No topology mission found. Run /topology <task goal or task card> first.";
  const validation = validateMissionCard(state.mission);
  const incidents = readJsonl(state.incidentPath);
  const watchdog = state.board ? runWatchdogCheck(state.board, incidents) : null;
  return [
    "Topology doctor",
    `validation: ${validation.ok ? "ok" : validation.errors.join("; ")}`,
    `incidents: ${incidents.length}`,
    watchdog ? `watchdog: ${watchdog.summary_status}` : "watchdog: status board missing",
    ...(watchdog?.findings.length ? ["findings:", ...watchdog.findings.map((finding) => `- ${finding.type}: ${finding.detail}`)] : []),
  ].join("\n");
}

function renderPackets(cwd: string): string {
  const state = loadTopologyState(cwd);
  if (!state.mission) return "No topology mission found. Run /topology <task goal or task card> first.";
  const packets = readJsonl(state.outboxPath) as Array<{ packet_id?: string; type?: string; from?: string; to?: string }>;
  if (!packets.length) return `No local topology packets found at ${state.outboxPath}`;
  return [
    `Topology packets (${packets.length})`,
    ...packets.slice(-12).map((packet) => `- ${packet.packet_id ?? "unknown"} ${packet.type ?? "?"} ${packet.from ?? "?"} -> ${packet.to ?? "?"}`),
  ].join("\n");
}

async function handleSpawnCommand(cwd: string, role: string, ctx: CommandContext, hooks: TopologyCommandHooks): Promise<string> {
  const state = loadTopologyState(cwd);
  if (!state.mission) return "No topology mission found. Run /topology <task goal or task card> before spawning roles.";
  if (hooks.isSupervisorActive?.()) {
    if (role === "hq") {
      const livePeers = readFreshPeerRegistrySync(localTransportRoot(state.mission.project), state.mission.project);
      if (livePeers.hq) {
        return [
          "Topology spawn hq",
          "",
          `HQ already live: session_id=${livePeers.hq.session_id}`,
          "No new HQ launch requested.",
        ].join("\n");
      }
      if (state.board?.next_gate?.owner_required) {
        return [
          "Topology spawn hq",
          "",
          "Current session is topology-supervisor.",
          "Owner gate is still required before launching HQ.",
          `reason: ${state.board.next_gate.reason}`,
        ].join("\n");
      }
      return await launchRoleFromSupervisor(state, "hq");
    }
    return [
      `Topology spawn ${role}`,
      "",
      "Current session is topology-supervisor.",
      "Visible mesh mode is active: keep Supervisor as the human-facing session.",
      "Launch non-HQ roles from Supervisor only after HQ has asked for that peer and owner boundaries are clear.",
    ].join("\n");
  }
  const supervisorScript = path.join(cwd, ".pi", "topology", "launch", "topology-supervisor.sh");
  return [
    `Topology spawn ${role}`,
    "",
    "Slash command spawn is owner-facing guidance only.",
    "Do not launch HQ/workers from the first session.",
    "",
    "Launch the Supervisor entry session:",
    currentTerminalCommand(cwd, supervisorScript),
    "",
    "Supervisor will inspect the mission card, request owner approval for the needed session set, then call topology_spawn_role itself.",
  ].join("\n");
}

async function launchRoleFromSupervisor(
  state: ReturnType<typeof loadTopologyState>,
  role: "hq" | "repair" | "runner" | "oracle" | "librarian" | "scott",
): Promise<string> {
  const safeLogPath = path.join(state.mission.workdir, ".pi", "topology", `${role}.log`);
  const registryRoot = localTransportRoot(state.mission.project);
  const packageRoot = resolvePackageRoot();
  const plan = buildRoleLaunchPlan(state.mission, role, {
    packageRoot,
    missionPath: state.missionPath,
    registryRoot,
    provider: "minimax-cn",
    model: "MiniMax-M3",
    thinking: "low",
  });
  const scriptPath = await writeRoleLaunchScript(state.mission.workdir, plan, { logPath: safeLogPath });
  appendSessionRecordSync(state.sessionLedgerPath, {
    mission_id: state.mission.mission_id,
    project: state.mission.project,
    role,
    state: "launch_requested",
    session_id: null,
    script_path: scriptPath,
    launch_command: `open -n -a 'Ghostty' --args -e '${scriptPath}'`,
    log_path: safeLogPath,
    terminal_app: "Ghostty",
    provider: "minimax-cn",
    model: "MiniMax-M3",
    thinking: "low",
    evidence: {
      transport: [scriptPath, state.sessionLedgerPath],
      business: [`${role} launch requested from /topology spawn ${role}`],
      inference: ["session_id remains null until the new role session proves alive via registry/heartbeat"],
    },
  });
  const nextBoard = markRoleLaunchRequested(state.board ?? createInitialStatusBoard(state.mission), state.mission, {
    role,
    scriptPath,
    logPath: safeLogPath,
  });
  writeJson(state.statusPath, nextBoard);
  if (role === "hq") {
    writeJson(state.missionPath, markMissionProgressForHqLaunch(state.mission));
  }
  appendEventSync(state.eventPath, {
    event_type: "spawn_request",
    mission_id: state.mission.mission_id,
    role,
    mode: "launch",
    log_path: safeLogPath,
    evidence: { transport: [state.missionPath], business: [role], inference: [] },
  });
  spawn("open", ["-n", "-a", "Ghostty", "--args", "-e", scriptPath], {
    detached: true,
    stdio: "ignore",
  }).unref();
  appendEventSync(state.eventPath, {
    event_type: "spawn_result",
    mission_id: state.mission.mission_id,
    role,
    mode: "launch",
    launch_requested: true,
    script_path: scriptPath,
    log_path: safeLogPath,
    evidence: { transport: [scriptPath], business: [role], inference: [] },
  });
  return [
    `Topology spawn ${role}`,
    "",
    `launch requested for ${role}`,
    `script_path: ${scriptPath}`,
    `log_path: ${safeLogPath}`,
    "Wait for the dashboard/registry heartbeat to confirm the role becomes live.",
  ].join("\n");
}

function currentTerminalCommand(cwd: string, scriptPath: string): string {
  return `cd ${shellQuote(cwd)} && ${shellQuote(scriptPath)}`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function renderHelp(): string {
  return [
    "Pi topology slash commands:",
    "/topology                 # smart intake: reuse existing mission or latest assistant task card",
    "/topology <task card>     # create mission + status board without the init keyword",
    "/topology init <task card> # compatibility form for explicit init",
    "/topology status          # detailed status paths",
    "/topology doctor          # read-only validation/watchdog summary",
    "/topology packets         # recent local outbox packets",
    "/topology spawn hq        # explain/prepare HQ expansion gate",
    "/topology-status          # status alias",
  ].join("\n");
}

function loadTopologyState(cwd: string): {
  mission: MissionCard | null;
  board: StatusBoard | null;
  missionPath: string;
  statusPath: string;
  incidentPath: string;
  eventPath: string;
  sessionLedgerPath: string;
  outboxPath: string;
} {
  const missionPath = missionPathFor(cwd);
  let mission = readJson<MissionCard>(missionPath);
  if (mission) {
    const normalized = normalizeMissionCard(mission);
    mission = normalized.mission;
    if (normalized.changed) writeJson(missionPath, mission);
  }
  const statusPath = mission ? path.join(cwd, mission.status_board_path) : path.join(cwd, ".pi/topology/status-board.json");
  const incidentPath = mission ? path.join(cwd, mission.incident_log_path) : path.join(cwd, ".pi/topology/incident-log.jsonl");
  const eventPath = mission ? path.join(cwd, mission.event_log_path) : path.join(cwd, ".pi/topology/runtime-events.jsonl");
  const sessionLedgerPath = mission ? path.join(cwd, mission.session_ledger_path ?? ".pi/topology/sessions.jsonl") : path.join(cwd, ".pi/topology/sessions.jsonl");
  if (mission) ensureSessionLedger(cwd, mission, missionPath, sessionLedgerPath);
  const rawBoard = readJson<StatusBoard>(statusPath);
  const project = mission?.project ?? path.basename(cwd);
  const outboxPath = path.join(process.env.PI_COMS_DIR ?? path.join("/tmp", `pi-topology-${project}`), "projects", project, "packets", "outbox.jsonl");
  const board = rawBoard && mission
    ? reconcileBoardWithLiveRegistry(
      reconcileBoardWithSessionRecords(rawBoard, readJsonl(sessionLedgerPath) as Array<Record<string, unknown>>),
      readFreshPeerRegistrySync(localTransportRoot(project), project),
    )
    : rawBoard;
  if (board && rawBoard && JSON.stringify(board) !== JSON.stringify(rawBoard)) writeJson(statusPath, board);
  return { mission, board, missionPath, statusPath, incidentPath, eventPath, sessionLedgerPath, outboxPath };
}

function ensureSessionLedger(cwd: string, mission: MissionCard, missionPath: string, sessionLedgerPath: string): void {
  const launchScripts = writeMissionLaunchScriptsSync(mission, {
    packageRoot: resolvePackageRoot(),
    missionPath,
    registryRoot: process.env.PI_COMS_DIR ?? path.join("/tmp", `pi-topology-${mission.project}`),
    provider: "minimax-cn",
    model: "MiniMax-M3",
    thinking: "low",
  });
  if (countJsonl(sessionLedgerPath) > 0) return;
  for (const entry of launchScripts) {
    appendSessionRecordSync(sessionLedgerPath, {
      mission_id: mission.mission_id,
      project: mission.project,
      role: entry.role,
      state: "script_written",
      session_id: null,
      script_path: entry.scriptPath,
      launch_command: entry.launchCommand,
      provider: "minimax-cn",
      model: "MiniMax-M3",
      thinking: "low",
      evidence: {
        transport: [entry.scriptPath, sessionLedgerPath],
        business: [`${entry.role} launch script generated during mission migration`],
        inference: ["script_written is not proof that the role session is alive"],
      },
    });
  }
}

function missionPathFor(cwd: string): string {
  return missionPathForWorkspace(cwd);
}

function inspectTrust(cwd: string): string {
  const trustPath = path.join(homedir(), ".pi", "agent", "trust.json");
  const trust = readJson<Record<string, boolean>>(trustPath);
  if (!trust) return "unknown";
  const trustedRoot = Object.entries(trust)
    .filter(([, trusted]) => trusted)
    .map(([root]) => root)
    .find((root) => cwd === root || cwd.startsWith(`${root}${path.sep}`));
  return trustedRoot ? `yes (${trustedRoot})` : "no";
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson<T>(file: string): T | null {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function readJsonl(file: string): unknown[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { parse_error: true, line };
      }
    });
}

function countJsonl(file: string): number {
  return readJsonl(file).length;
}

function splitArgs(value: string): string[] {
  return value.split(/\s+/).filter(Boolean);
}

function findLatestAssistantTaskCard(ctx: CommandContext): { entryId?: string; objective: string; excerpt: string } | null {
  const branch = ctx.sessionManager?.getBranch?.() ?? [];
  for (const entry of [...branch].reverse()) {
    if (entry.type !== "message" || entry.message?.role !== "assistant") continue;
    const text = messageContentToText(entry.message.content);
    if (!looksLikeTaskCard(text)) continue;
    const objective = extractObjective(text);
    return {
      entryId: entry.id,
      objective,
      excerpt: compactLine(text).slice(0, 220),
    };
  }
  return null;
}

function messageContentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part && typeof part.text === "string") return part.text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function looksLikeTaskCard(text: string): boolean {
  const normalized = text.toLowerCase();
  if (normalized.length < 80) return false;
  const markers = [
    "任务卡",
    "mission card",
    "goal",
    "目标",
    "objective",
    "scope",
    "范围",
    "acceptance",
    "验收",
    "next",
    "下一步",
    "risk",
    "风险",
    "deliverable",
    "交付",
  ];
  const markerHits = markers.filter((marker) => normalized.includes(marker.toLowerCase())).length;
  const structureHits = [
    /^#{1,4}\s+/m.test(text),
    /^\s*[-*]\s+/m.test(text),
    /^\s*\d+\.\s+/m.test(text),
    /\|.+\|/.test(text),
  ].filter(Boolean).length;
  return markerHits >= 3 && structureHits >= 1;
}

function extractObjective(text: string): string {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const direct = lines.find((line) => /^(#{1,4}\s*)?(goal|objective|目标|任务目标|mission)\s*[:：]/i.test(line));
  if (direct) return cleanupObjective(direct.replace(/^(#{1,4}\s*)?(goal|objective|目标|任务目标|mission)\s*[:：]\s*/i, ""));
  const title = lines.find((line) => /^#{1,3}\s+/.test(line));
  if (title) return cleanupObjective(title.replace(/^#{1,3}\s+/, ""));
  const firstContent = lines.find((line) => !/^[-*]\s*$/.test(line) && !/^\|/.test(line));
  return cleanupObjective(firstContent ?? "Topology mission from previous assistant task card");
}

function cleanupObjective(value: string): string {
  return compactLine(value.replace(/^[-*]\s*/, "")).slice(0, 500) || "Topology mission from previous assistant task card";
}

function compactLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function resolvePackageRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

function localTransportRoot(project: string): string {
  return process.env.PI_COMS_DIR ?? path.join("/tmp", `pi-topology-${project}`);
}

function emitCommandText(pi: PiLike, text: string, details: Record<string, unknown>): void {
  pi.sendMessage?.({
    customType: "topology",
    content: text,
    display: text,
    details,
  });
}
