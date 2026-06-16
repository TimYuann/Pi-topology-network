import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { MissionCard, TopologyRole } from "../runtime/mission.ts";
import type { TopologyPacket } from "../runtime/packet.ts";
import { evaluateToolCall } from "../runtime/guard.ts";
import { appendEvent } from "../state/event-log.ts";
import { clearPacketMemory, hasClosedPacket, markPacketSeen } from "../state/packet-memory.ts";
import { appendSessionRecordSync } from "../state/session-ledger.ts";
import { markRoleAlive } from "../runtime/status-board.ts";
import { startLiveTopologyEndpoint, type LiveTopologyEndpoint } from "../transport/live-coms.ts";
import { refreshPeerRegistryHeartbeat, removePeerRegistry } from "../transport/registry.ts";
import { registerTopologyCommands, type CommandContext } from "./commands.ts";
import { registerTopologyTools } from "./tools.ts";
import { installTopologyUi, refreshTopologyUi, type TopologyUiContext } from "./ui.ts";

interface PiLike {
  registerTool: (tool: Record<string, unknown>) => void;
  registerCommand: (name: string, command: Record<string, unknown>) => void;
  registerFlag?: (name: string, options: Record<string, unknown>) => void;
  on: (name: string, handler: (...args: unknown[]) => unknown) => void;
  getFlag?: (name: string) => unknown;
  appendEntry?: (customType: string, data: Record<string, unknown>) => void;
  sendMessage?: (message: { customType: string; content: string; display?: boolean | string; details?: Record<string, unknown> }, options?: Record<string, unknown>) => void;
}

export function registerPiTopology(pi: PiLike): void {
  let currentCtx: TopologyUiContext | null = null;
  let uiTimer: NodeJS.Timeout | null = null;
  let liveEndpoint: LiveTopologyEndpoint | null = null;
  let takeoverRole: TopologyRole | null = null;
  let takeoverMission: MissionCard | null = null;

  pi.registerFlag?.("cname", {
    type: "string",
    description: "Topology role/session name, such as topology-supervisor, hq, repair, runner, or oracle.",
  });
  pi.registerFlag?.("project", {
    type: "string",
    description: "Topology project name used for mission state and transport registry grouping.",
  });

  registerTopologyTools(pi);
  registerTopologyCommands(pi, {
    activateSupervisor: (mission, ctx) => activateCurrentSessionAsSupervisor(mission, ctx),
    isSupervisorActive: (missionId) => takeoverRole === "topology-supervisor" && (!missionId || takeoverMission?.mission_id === missionId),
  });

  pi.on("resources_discover", () => ({
    skillPaths: [topologyPackageSkillsDir()],
  }));

  pi.on("session_start", async (_event: unknown, ctx: TopologyUiContext) => {
    const role = currentTopologyRole(pi, takeoverRole);
    if (!role) return;
    currentCtx = ctx;
    const sessionId = topologySessionId(role);
    await startTopologyRuntimeForCurrentSession(role, sessionId, ctx);
  });

  pi.on("tool_call", async (event: Record<string, unknown>) => {
    const role = currentTopologyRole(pi, takeoverRole) ?? "topology-supervisor";
    if (currentCtx) refreshTopologyUi(currentCtx, { role });
    const mission = readMissionFromEnv(takeoverMission);
    if (!mission) return;
    const toolName = String(event.toolName ?? event.name ?? event.tool ?? "");
    const args = (event.input ?? event.arguments ?? event.args ?? {}) as Record<string, unknown>;
    const tool = classifyTool(toolName);
    const decision = evaluateToolCall({
      role,
      mission,
      tool,
      path: typeof args.path === "string" ? args.path : typeof args.file === "string" ? args.file : undefined,
      command: typeof args.command === "string" ? args.command : undefined,
      artifact_role: tool === "topology_artifact_write" && typeof args.role === "string" ? args.role : undefined,
      incident_log_path: mission.incident_log_path,
    });
    if (decision.decision === "allow") return;
    if (mission.event_log_path) {
      await appendEvent(mission.event_log_path, {
        event_type: "guard_block",
        mission_id: mission.mission_id,
        role,
        tool: toolName,
        decision: decision.decision,
        reason: decision.reason,
        incident: decision.incident,
        evidence: {
          transport: [mission.incident_log_path].filter(Boolean),
          business: [toolName],
          inference: [decision.reason],
        },
      });
    }
    return {
      block: true,
      reason: decision.reason,
      details: {
        decision: decision.decision,
        incident: decision.incident,
      },
    };
  });

  pi.on("agent_end", () => {
    const role = currentTopologyRole(pi, takeoverRole);
    if (role) refreshTopologyUi(currentCtx, { role });
  });

  pi.on("session_shutdown", () => {
    const missionId = takeoverMission?.mission_id ?? process.env.PI_TOPOLOGY_MISSION_ID;
    const role = currentTopologyRole(pi, takeoverRole);
    if (uiTimer) clearInterval(uiTimer);
    uiTimer = null;
    void cleanupLiveEndpoint(liveEndpoint, takeoverMission ?? undefined);
    liveEndpoint = null;
    if (missionId && role) clearPacketMemory(missionId, role);
    try { currentCtx?.ui?.setWidget?.("topology-mesh", undefined); } catch { /* ignore */ }
  });

  async function activateCurrentSessionAsSupervisor(mission: MissionCard, ctx: CommandContext): Promise<{ sessionId: string }> {
    takeoverRole = "topology-supervisor";
    takeoverMission = mission;
    currentCtx = ctx;
    const sessionId = topologySessionId(takeoverRole);
    await startTopologyRuntimeForCurrentSession(takeoverRole, sessionId, ctx, mission);
    pi.sendMessage?.({
      customType: "topology-supervisor-bootstrap",
      content: supervisorBootstrapMessage(mission, sessionId),
      display: true,
      details: {
        mission_id: mission.mission_id,
        role: takeoverRole,
        session_id: sessionId,
      },
    }, { deliverAs: "followUp", triggerTurn: true });
    return { sessionId };
  }

  async function startTopologyRuntimeForCurrentSession(role: TopologyRole, sessionId: string, ctx: TopologyUiContext, missionOverride?: MissionCard): Promise<void> {
    currentCtx = ctx;
    if (liveEndpoint) {
      await cleanupLiveEndpoint(liveEndpoint, missionOverride);
      liveEndpoint = null;
    }
    await registerLiveEndpoint(pi, role, sessionId, missionOverride);
    markTopologySessionAlive(role, sessionId, readContextPercent(ctx), missionOverride);
    installTopologyUi(ctx, { role });
    if (uiTimer) clearInterval(uiTimer);
    uiTimer = setInterval(() => {
      heartbeatTopologySession(role, sessionId, readContextPercent(currentCtx ?? undefined), missionOverride, liveEndpoint);
      refreshTopologyUi(currentCtx, { role });
    }, 5_000);
    try { uiTimer.unref?.(); } catch { /* ignore */ }
  }

  async function registerLiveEndpoint(piLike: PiLike, role: TopologyRole, sessionId: string, missionOverride?: Pick<MissionCard, "project">): Promise<void> {
    const mission = missionOverride ?? readFullMissionFromEnv();
    if (!mission) return;
    const root = process.env.PI_COMS_DIR ?? path.join("/tmp", `pi-topology-${mission.project}`);
    const onPacket = (packet: TopologyPacket) => {
      const delivery = classifyInboundPacket(role, packet);
      piLike.appendEntry?.("topology-packet", {
        mission_id: packet.mission_id,
        packet_id: packet.packet_id,
        type: packet.type,
        from: packet.from,
        to: packet.to,
        request_msg_id: packet.request_msg_id,
        delivery_mode: delivery.deliveryMode,
        reason: delivery.reason,
        body: packet.body,
      });
      if (delivery.deliveryMode !== "follow-up") return;
      piLike.sendMessage?.({
        customType: "topology-inbound",
        content: formatInboundPacket(packet),
        display: true,
        details: {
          packet_id: packet.packet_id,
          packet_type: packet.type,
          from: packet.from,
          to: packet.to,
          mission_id: packet.mission_id,
          request_msg_id: packet.request_msg_id,
        },
      }, { deliverAs: "followUp", triggerTurn: true });
    };
    const requestedMode = process.env.PI_TOPOLOGY_LIVE_TRANSPORT === "memory" ? "memory" : "socket";
    try {
      liveEndpoint = await startLiveTopologyEndpoint({
        root,
        project: mission.project,
        role,
        sessionId,
        mode: requestedMode,
        onPacket,
      });
    } catch (error) {
      if (requestedMode === "memory") throw error;
      liveEndpoint = await startLiveTopologyEndpoint({
        root,
        project: mission.project,
        role,
        sessionId,
        mode: "memory",
        onPacket,
      });
    }
  }

  async function cleanupLiveEndpoint(endpoint: LiveTopologyEndpoint | null, missionOverride?: Pick<MissionCard, "project">): Promise<void> {
    if (!endpoint) return;
    const mission = missionOverride ?? readFullMissionFromEnv();
    try { await endpoint.close(); } catch { /* best effort */ }
    if (!mission) return;
    const root = process.env.PI_COMS_DIR ?? path.join("/tmp", `pi-topology-${mission.project}`);
    try { await removePeerRegistry(root, mission.project, endpoint.role); } catch { /* best effort */ }
  }
}

function topologyPackageSkillsDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "skills");
}

function classifyInboundPacket(role: TopologyRole, packet: TopologyPacket): { deliveryMode: "follow-up" | "append-only"; reason: string } {
  if (markPacketSeen(packet.mission_id, role, packet.packet_id)) {
    return { deliveryMode: "append-only", reason: "duplicate" };
  }
  if (hasClosedPacket(packet.mission_id, role, packet.packet_id)) {
    return { deliveryMode: "append-only", reason: "closed" };
  }
  if (packet.type === "ACK") {
    return { deliveryMode: "append-only", reason: "ack" };
  }
  if (packet.type === "VERDICT" && isTerminalVerdict(packet.body)) {
    return { deliveryMode: "append-only", reason: "terminal_verdict" };
  }
  if (packet.type === "STATUS" && isIdempotentStatus(packet.body)) {
    return { deliveryMode: "append-only", reason: "idempotent_status" };
  }
  return { deliveryMode: "follow-up", reason: "actionable" };
}

function isTerminalVerdict(body: Record<string, unknown>): boolean {
  const next = typeof body.next === "string" ? body.next : "";
  const verdict = typeof body.verdict === "string" ? body.verdict : "";
  return next === "stand_down" || verdict === "closeout_acknowledged";
}

function isIdempotentStatus(body: Record<string, unknown>): boolean {
  const status = typeof body.status === "string" ? body.status : "";
  const next = typeof body.next === "string" ? body.next : "";
  return status.startsWith("ack_") || next === "no_further_action_required";
}

const TOPOLOGY_ROLE_NAMES = new Set<string>([
  "topology-supervisor",
  "hq",
  "repair",
  "runner",
  "oracle",
  "librarian",
  "scott",
]);

function currentTopologyRole(pi: PiLike, overrideRole: TopologyRole | null = null): TopologyRole | null {
  if (overrideRole) return overrideRole;
  const explicitRole = pi.getFlag?.("cname") ?? process.env.PI_TOPOLOGY_ROLE;
  if (typeof explicitRole === "string" && TOPOLOGY_ROLE_NAMES.has(explicitRole)) {
    return explicitRole as TopologyRole;
  }
  return null;
}

function supervisorBootstrapMessage(mission: MissionCard, sessionId: string): string {
  return [
    "You are now topology-supervisor for this mission in the current Pi session.",
    "",
    `mission_id: ${mission.mission_id}`,
    `session_id: ${sessionId}`,
    `objective: ${mission.objective}`,
    `workdir: ${mission.workdir}`,
    "",
    "First reply directly to the owner with:",
    "`ACK topology-supervisor: received <task>. status=accepted. next=<one sentence>.`",
    "",
    "Then call topology_status and topology_doctor, propose the launch set, and wait for owner approval before spawning HQ or worker sessions.",
    "Do not ask the owner to copy or run the topology-supervisor launch script; this current session is already the Supervisor entry.",
  ].join("\n");
}

function classifyTool(toolName: string): string {
  if (toolName === "topology_write_artifact") return "topology_artifact_write";
  if (/write|edit|patch/i.test(toolName)) return "write_file";
  if (/bash|shell|exec|command/i.test(toolName)) return "shell";
  return "read_file";
}

function readMissionFromEnv(missionOverride?: MissionCard | null): (Pick<MissionCard, "allowed_paths" | "forbidden_actions"> & {
  mission_id?: string;
  incident_log_path?: string;
  event_log_path?: string;
}) | null {
  if (missionOverride) {
    return {
      mission_id: missionOverride.mission_id,
      allowed_paths: missionOverride.allowed_paths,
      forbidden_actions: missionOverride.forbidden_actions,
      incident_log_path: path.join(missionOverride.workdir, missionOverride.incident_log_path),
      event_log_path: path.join(missionOverride.workdir, missionOverride.event_log_path),
    };
  }
  if (!process.env.PI_TOPOLOGY_ALLOWED_PATHS && !process.env.PI_TOPOLOGY_FORBIDDEN_ACTIONS) return null;
  return {
    mission_id: process.env.PI_TOPOLOGY_MISSION_ID,
    allowed_paths: (process.env.PI_TOPOLOGY_ALLOWED_PATHS ?? "").split(":").filter(Boolean),
    forbidden_actions: (process.env.PI_TOPOLOGY_FORBIDDEN_ACTIONS ?? "git push:git reset --hard:rm -rf").split(":").filter(Boolean),
    incident_log_path: process.env.PI_TOPOLOGY_INCIDENT_LOG,
    event_log_path: process.env.PI_TOPOLOGY_EVENT_LOG,
  };
}

function markTopologySessionAlive(role: TopologyRole, sessionId: string, contextUsedPct?: number, missionOverride?: MissionCard): void {
  const loaded = loadMissionForRuntime(missionOverride);
  if (!loaded) return;
  const { mission, workdir } = loaded;
  const statusPath = path.join(workdir, mission.status_board_path);
  const sessionLedgerPath = path.join(workdir, mission.session_ledger_path);
  const scriptPath = process.env.PI_TOPOLOGY_LAUNCH_SCRIPT ?? path.join(workdir, ".pi", "topology", "launch", `${role}.sh`);
  const now = new Date().toISOString();
  appendSessionRecordSync(sessionLedgerPath, {
    mission_id: mission.mission_id,
    project: mission.project,
    role,
    state: "alive_confirmed",
    session_id: sessionId,
    script_path: scriptPath,
    provider: process.env.PI_TOPOLOGY_PROVIDER,
    model: process.env.PI_TOPOLOGY_MODEL,
    evidence: {
      transport: [sessionLedgerPath, statusPath],
      business: [`${role} session_start observed`],
      inference: [],
    },
  });
  if (existsSync(statusPath)) {
    const board = JSON.parse(readFileSync(statusPath, "utf8"));
    const nextBoard = markRoleAlive(board, { role, sessionId, now });
    if (typeof contextUsedPct === "number") {
      nextBoard.peer_status[role].context_used_pct = contextUsedPct;
    }
    mkdirSync(path.dirname(statusPath), { recursive: true });
    writeFileSync(statusPath, `${JSON.stringify(nextBoard, null, 2)}\n`, "utf8");
  }
  if (mission.event_log_path) {
    const eventPath = path.join(workdir, mission.event_log_path);
    void appendEvent(eventPath, {
      event_type: "session_alive",
      mission_id: mission.mission_id,
      role,
      session_id: sessionId,
      evidence: {
        transport: [sessionLedgerPath, statusPath],
        business: [`${role} session_start observed`],
        inference: [],
      },
    });
  }
}

function heartbeatTopologySession(
  role: TopologyRole,
  sessionId: string,
  contextUsedPct?: number,
  missionOverride?: MissionCard,
  liveEndpoint?: LiveTopologyEndpoint | null,
): void {
  const loaded = loadMissionForRuntime(missionOverride);
  if (!loaded) return;
  const { mission, workdir } = loaded;
  const statusPath = path.join(workdir, mission.status_board_path);
  if (!existsSync(statusPath)) return;
  const board = JSON.parse(readFileSync(statusPath, "utf8"));
  const current = board.peer_status?.[role];
  if (!current || current.session_id !== sessionId || current.alive !== true) return;
  current.last_heartbeat_at = new Date().toISOString();
  if (typeof contextUsedPct === "number") current.context_used_pct = contextUsedPct;
  mkdirSync(path.dirname(statusPath), { recursive: true });
  writeFileSync(statusPath, `${JSON.stringify(board, null, 2)}\n`, "utf8");
  if (liveEndpoint?.role === role && liveEndpoint.session_id === sessionId) {
    void refreshPeerRegistryHeartbeat(
      process.env.PI_COMS_DIR ?? path.join("/tmp", `pi-topology-${mission.project}`),
      mission.project,
      {
        name: role,
        role,
        session_id: sessionId,
        endpoint: liveEndpoint.endpoint,
        heartbeat_at: current.last_heartbeat_at,
        context_used_pct: typeof contextUsedPct === "number" ? contextUsedPct : current.context_used_pct ?? 0,
      },
    );
  }
}

function loadMissionForRuntime(missionOverride?: MissionCard): { mission: MissionCard; workdir: string } | null {
  if (missionOverride) return { mission: missionOverride, workdir: missionOverride.workdir };
  const missionPath = process.env.PI_TOPOLOGY_MISSION_CARD;
  const workdir = process.env.PI_TOPOLOGY_WORKDIR;
  if (!missionPath || !workdir || !existsSync(missionPath)) return null;
  return {
    mission: JSON.parse(readFileSync(missionPath, "utf8")) as MissionCard,
    workdir,
  };
}

function readContextPercent(ctx: TopologyUiContext | undefined): number | undefined {
  const pct = ctx?.getContextUsage?.()?.percent;
  if (typeof pct !== "number" || Number.isNaN(pct)) return undefined;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

function topologySessionId(role: TopologyRole): string {
  return `${role}-${process.pid}-${Date.now()}`;
}

function readFullMissionFromEnv(): Pick<MissionCard, "project"> | null {
  const missionPath = process.env.PI_TOPOLOGY_MISSION_CARD;
  if (missionPath && existsSync(missionPath)) {
    try {
      const mission = JSON.parse(readFileSync(missionPath, "utf8")) as MissionCard;
      if (mission.project) return { project: mission.project };
    } catch {
      // fall through to env project
    }
  }
  const project = process.env.PI_TOPOLOGY_PROJECT;
  return project ? { project } : null;
}

function formatInboundPacket(packet: {
  packet_id: string;
  type: string;
  from: string;
  to: string;
  body: Record<string, unknown>;
  request_msg_id?: string;
}): string {
  return [
    "[topology-inbound]",
    `packet_id: ${packet.packet_id}`,
    `type: ${packet.type}`,
    `from: ${packet.from}`,
    `to: ${packet.to}`,
    packet.request_msg_id ? `request_msg_id: ${packet.request_msg_id}` : undefined,
    "",
    "Packet body:",
    JSON.stringify(packet.body, null, 2),
    "",
  "Handle this inbound packet now. Use topology_list/topology_get if you need durable packet context, and respond with topology_send when a role-to-role reply is required.",
  ].filter((line): line is string => line !== undefined).join("\n");
}
