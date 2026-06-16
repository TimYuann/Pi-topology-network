import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInitialStatusBoard, createMissionDraft, normalizeMissionCard, runWatchdogCheck, validateMissionCard, type WorkerRole } from "../runtime/mission.ts";
import { createPacket, type PacketType } from "../runtime/packet.ts";
import { buildRoleLaunchPlan, writeMissionLaunchScripts, writeMissionLaunchScriptsSync, writeRoleLaunchScript } from "../runtime/spawn.ts";
import { activePendingPackets, applyPacketLifecycle, markMissionProgressForHqLaunch, markRoleLaunchRequested, reconcileBoardWithLiveRegistry, reconcileBoardWithSessionRecords } from "../runtime/status-board.ts";
import { appendEvent } from "../state/event-log.ts";
import { rememberClosedPacket } from "../state/packet-memory.ts";
import { appendSessionRecord, appendSessionRecordSync } from "../state/session-ledger.ts";
import { topology_await as localTopologyAwait, topology_get as localTopologyGet, topology_list as localTopologyList, topology_send as localTopologySend } from "../transport/local-coms.ts";
import { netComsStatus } from "../transport/net-coms.ts";
import { readFreshPeerRegistrySync } from "../transport/registry.ts";

interface PiLike {
  registerTool: (tool: Record<string, unknown>) => void;
}

interface ToolContext {
  cwd: string;
  ui?: {
    notify?: (message: string, level?: string) => void;
  };
}

export function registerTopologyTools(pi: PiLike): void {
  pi.registerTool({
    name: "topology_init_mission",
    label: "Topology Init Mission",
    description: "Create a mission card, initial status board, and event log for an owner-approved topology mission.",
    promptSnippet: "Initialize a topology mission draft in the current workspace",
    promptGuidelines: [
      "Use when the project needs a topology mission card and no active mission exists.",
      "Pass a concrete objective and non-empty allowed_paths.",
    ],
    parameters: {
      type: "object",
      required: ["objective", "allowed_paths"],
      properties: {
        objective: { type: "string" },
        project: { type: "string" },
        allowed_paths: { type: "array", items: { type: "string" } },
      },
    },
    async execute(_id: string, params: { objective: string; project?: string; allowed_paths: string[] }, _signal: unknown, _onUpdate: unknown, ctx: ToolContext) {
      if (!params.allowed_paths?.length) return toolText("allowed_paths must be non-empty.", { ok: false });
      const project = params.project ?? process.env.PI_TOPOLOGY_PROJECT ?? path.basename(ctx.cwd);
      const mission = createMissionDraft({
        project,
        workdir: ctx.cwd,
        objective: params.objective,
        allowed_paths: params.allowed_paths,
      });
      const missionPath = missionPathFor(ctx.cwd);
      const statusPath = path.join(ctx.cwd, mission.status_board_path);
      const eventPath = path.join(ctx.cwd, mission.event_log_path);
      const sessionLedgerPath = path.join(ctx.cwd, mission.session_ledger_path);
      const packageRoot = resolvePackageRoot();
      writeJson(missionPath, mission);
      writeJson(statusPath, createInitialStatusBoard(mission));
      const launchScripts = await writeMissionLaunchScripts(mission, {
        packageRoot,
        missionPath,
        registryRoot: localTransportRoot(project),
        provider: "minimax-cn",
        model: "MiniMax-M3",
        thinking: "low",
      });
      await appendEvent(eventPath, {
        event_type: "runtime_boot",
        mission_id: mission.mission_id,
        project,
        evidence: { transport: ["topology_init_mission"], business: [], inference: [] },
      });
      await appendEvent(eventPath, {
        event_type: "mission_initialized",
        mission_id: mission.mission_id,
        mission_path: missionPath,
        status_board_path: statusPath,
        evidence: { transport: [missionPath, statusPath], business: [params.objective], inference: [] },
      });
      await appendEvent(eventPath, {
        event_type: "launch_scripts_written",
        mission_id: mission.mission_id,
        launch_dir: path.join(ctx.cwd, ".pi", "topology", "launch"),
        roles: launchScripts.map((entry) => entry.role),
        evidence: {
          transport: launchScripts.map((entry) => entry.scriptPath),
          business: ["topology-supervisor entry script generated"],
          inference: [],
        },
      });
      for (const entry of launchScripts) {
        await appendSessionRecord(sessionLedgerPath, {
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
      const supervisor = launchScripts.find((entry) => entry.role === "topology-supervisor");
      return toolText(
        [
          `Topology mission initialized: ${mission.mission_id}`,
          missionPath,
          "",
          "Supervisor entry:",
          supervisor?.launchCommand ?? path.join(ctx.cwd, ".pi", "topology", "launch", "topology-supervisor.sh"),
        ].join("\n"),
        { ok: true, mission, missionPath, launchScripts },
      );
    },
  });

  pi.registerTool({
    name: "topology_status",
    label: "Topology Status",
    description: "Read the active mission card, status board, and incident count.",
    promptSnippet: "Read current topology mission state, peer status, and pending packets",
    promptGuidelines: [
      "Use before owner-facing summaries or when deciding whether the mission can close.",
      "Prefer this over raw file reads for mission state.",
    ],
    parameters: { type: "object", properties: {} },
    async execute(_id: string, _params: unknown, _signal: unknown, _onUpdate: unknown, ctx: ToolContext) {
      const loaded = loadRuntimeState(ctx.cwd);
      if (!loaded.ok) return toolText(loaded.message, loaded);
      return toolText(
        [
          `mission_id: ${loaded.mission.mission_id}`,
          `runtime_phase: ${loaded.board.runtime_phase}`,
          `status_board: ${loaded.statusPath}`,
          `incident_log: ${loaded.incidentPath}`,
          `session_ledger: ${loaded.sessionLedgerPath}`,
          `session_records: ${countJsonl(loaded.sessionLedgerPath)}`,
          `pending_packets: ${activePendingPackets(loaded.board.pending_packets).length}`,
          ...formatPendingPackets(activePendingPackets(loaded.board.pending_packets)),
        ].join("\n"),
        loaded,
      );
    },
  });

  pi.registerTool({
    name: "topology_doctor",
    label: "Topology Doctor",
    description: "Run read-only topology checks for mission schema, state files, transport status, and watchdog findings.",
    promptSnippet: "Run a read-only topology health and watchdog check",
    promptGuidelines: [
      "Use to validate mission state before taking orchestration action.",
      "Treat findings as evidence, not automatic permission to expand scope.",
    ],
    parameters: { type: "object", properties: {} },
    async execute(_id: string, _params: unknown, _signal: unknown, _onUpdate: unknown, ctx: ToolContext) {
      const loaded = loadRuntimeState(ctx.cwd);
      if (!loaded.ok) return toolText(loaded.message, loaded);
      const validation = validateMissionCard(loaded.mission);
      const watchdog = runWatchdogCheck(loaded.board, []);
      for (const finding of watchdog.findings) {
        await appendEvent(loaded.eventPath, {
          event_type: "watchdog_finding",
          mission_id: loaded.mission.mission_id,
          finding,
          evidence: { transport: [loaded.statusPath], business: [], inference: [finding.detail] },
        });
      }
      return toolText(JSON.stringify({ validation, watchdog, net_transport: netComsStatus() }, null, 2), {
        ok: validation.ok,
        validation,
        watchdog,
        net_transport: netComsStatus(),
      });
    },
  });

  pi.registerTool({
    name: "topology_smoke",
    label: "Topology Smoke",
    description: "Run a local, read-only smoke over mission schema and status-board watchdog behavior.",
    promptSnippet: "Run a small read-only topology smoke check",
    promptGuidelines: [
      "Use for lightweight verification only; do not treat this as full mission execution evidence.",
    ],
    parameters: { type: "object", properties: {} },
    async execute(_id: string, _params: unknown, _signal: unknown, _onUpdate: unknown, ctx: ToolContext) {
      const loaded = loadRuntimeState(ctx.cwd);
      if (!loaded.ok) return toolText(loaded.message, loaded);
      const validation = validateMissionCard(loaded.mission);
      const watchdog = runWatchdogCheck(loaded.board, []);
      const ok = validation.ok && Boolean(watchdog.mission_id);
      return toolText(ok ? "topology local smoke passed" : "topology local smoke failed", { ok, validation, watchdog });
    },
  });

  pi.registerTool({
    name: "topology_spawn_role",
    label: "Topology Spawn Role",
    description: "Prepare or launch a real Pi role session from the active mission card. Use mode=print before mode=launch.",
    promptSnippet: "Prepare or launch an approved topology role session",
    promptGuidelines: [
      "Only use after owner approval or when mission policy already covers the role.",
      "Prefer mode=print for review before mode=launch.",
    ],
    parameters: {
      type: "object",
      required: ["role"],
      properties: {
        role: { enum: ["hq", "repair", "runner", "oracle", "librarian", "scott"] },
        mode: { enum: ["print", "launch"] },
        terminal_app: { type: "string" },
        initial_prompt: { type: "string" },
        log_path: { type: "string" },
        provider: { type: "string" },
        model: { type: "string" },
        thinking: { enum: ["off", "low", "medium", "high"] },
      },
    },
    async execute(_id: string, params: {
      role: WorkerRole;
      mode?: "print" | "launch";
      terminal_app?: string;
      initial_prompt?: string;
      log_path?: string;
      provider?: string;
      model?: string;
      thinking?: "off" | "low" | "medium" | "high";
    }, _signal: unknown, _onUpdate: unknown, ctx: ToolContext) {
      const loaded = loadRuntimeState(ctx.cwd);
      if (!loaded.ok) return toolText(loaded.message, loaded);
      const packageRoot = resolvePackageRoot();
      const safeLogPath = resolveRoleLogPath(ctx.cwd, params.role, params.log_path);
      await appendEvent(loaded.eventPath, {
        event_type: "spawn_request",
        mission_id: loaded.mission.mission_id,
        role: params.role,
        mode: params.mode ?? "print",
        log_path: safeLogPath,
        evidence: { transport: [loaded.missionPath], business: [params.role], inference: [] },
      });
      const plan = buildRoleLaunchPlan(loaded.mission, params.role, {
        packageRoot,
        missionPath: loaded.missionPath,
        registryRoot: process.env.PI_COMS_DIR ?? path.join("/tmp", `pi-topology-${loaded.mission.project}`),
        provider: params.provider,
        model: params.model,
        thinking: params.thinking,
        initialPrompt: params.initial_prompt,
      });
      const scriptPath = await writeRoleLaunchScript(ctx.cwd, plan, { logPath: safeLogPath });
      const mode = params.mode ?? "print";
      let launchRequested = false;
      await appendSessionRecord(loaded.sessionLedgerPath, {
        mission_id: loaded.mission.mission_id,
        project: loaded.mission.project,
        role: params.role,
        state: mode === "launch" ? "launch_requested" : "launch_printed",
        session_id: null,
        script_path: scriptPath,
        launch_command: `open -n -a '${params.terminal_app ?? "Ghostty"}' --args -e '${scriptPath}'`,
        log_path: safeLogPath,
        terminal_app: params.terminal_app ?? "Ghostty",
        provider: params.provider ?? "minimax-cn",
        model: params.model ?? "MiniMax-M3",
        thinking: params.thinking,
        evidence: {
          transport: [scriptPath, loaded.sessionLedgerPath],
          business: [`${params.role} ${mode === "launch" ? "launch requested" : "launch command printed"}`],
          inference: ["session_id remains null until the role session confirms itself"],
        },
      });
      if (mode === "launch") {
        const app = params.terminal_app ?? "Ghostty";
        spawn("open", ["-n", "-a", app, "--args", "-e", scriptPath], {
          detached: true,
          stdio: "ignore",
        }).unref();
        launchRequested = true;
        const latestBoard = existsSync(loaded.statusPath)
          ? JSON.parse(readFileSync(loaded.statusPath, "utf8")) as typeof loaded.board
          : loaded.board;
        const now = new Date().toISOString();
        const nextBoard = markRoleLaunchRequested(latestBoard, loaded.mission, {
          role: params.role,
          scriptPath,
          logPath: safeLogPath,
          now,
        });
        writeJson(loaded.statusPath, nextBoard);
        if (params.role === "hq") {
          const nextMission = markMissionProgressForHqLaunch(loaded.mission, now);
          writeJson(loaded.missionPath, nextMission);
        }
      }
      await appendEvent(loaded.eventPath, {
        event_type: "spawn_result",
        mission_id: loaded.mission.mission_id,
        role: params.role,
        mode,
        launch_requested: launchRequested,
        script_path: scriptPath,
        log_path: safeLogPath,
        evidence: { transport: [scriptPath], business: [params.role], inference: [] },
      });
      return toolText(
        launchRequested
          ? `launch requested for ${params.role} via ${scriptPath}\nVerify the new Pi session before marking the role alive.`
          : [
            `launch plan prepared for ${params.role}; not launched.`,
            `script_path: ${scriptPath}`,
            `log_path: ${safeLogPath}`,
            "Ask the owner for final go, then call topology_spawn_role with mode=launch.",
          ].join("\n"),
        {
          ok: true,
          role: params.role,
          mode,
          launch_requested: launchRequested,
          scriptPath,
          log_path: safeLogPath,
          terminal_app: params.terminal_app ?? "Ghostty",
          provider: params.provider ?? "minimax-cn",
          model: params.model ?? "MiniMax-M3",
        },
      );
    },
  });

  pi.registerTool({
    name: "topology_send",
    label: "Topology Send",
    description: "Send a structured local topology packet to a role inbox and record packet_sent evidence. Always include a non-empty body; ACK/REPORT replies should set request_msg_id to the packet being answered.",
    promptSnippet: "Send a non-empty role-to-role topology packet",
    promptGuidelines: [
      "Use only for actual role-to-role business traffic, not generic logs or owner receipts.",
      "Always include a non-empty body.",
      "When replying to a packet, set request_msg_id to the packet being answered.",
    ],
    parameters: {
      type: "object",
      required: ["type", "from", "to"],
      properties: {
        type: { enum: ["ACK", "STATUS", "REPORT", "REQUEST", "INCIDENT", "VERDICT"] },
        from: { type: "string" },
        to: { type: "string" },
        body: { type: "object" },
        status: { type: "string" },
        summary: { type: "string" },
        next: { type: "string" },
        note: { type: "string" },
        artifact_path: { type: "string" },
        correlation_id: { type: "string" },
        request_msg_id: { type: "string" },
      },
    },
    async execute(_id: string, params: {
      type: PacketType;
      from: WorkerRole | "topology-supervisor";
      to: WorkerRole | "topology-supervisor" | "owner";
      body?: Record<string, unknown>;
      status?: string;
      summary?: string;
      next?: string;
      note?: string;
      artifact_path?: string;
      correlation_id?: string;
      request_msg_id?: string;
    }, _signal: unknown, _onUpdate: unknown, ctx: ToolContext) {
      const loaded = loadRuntimeState(ctx.cwd);
      if (!loaded.ok) return toolText(loaded.message, loaded);
      const body = normalizePacketBody(params);
      if (!body || Object.keys(body).length === 0) {
        return toolText(`REPORT NOT SENT: transport_blocked target=${params.to} reason=body_required`, {
          ok: false,
          reason: "body_required",
          example: {
            status: "accepted",
            summary: "one sentence",
            next: "next action",
          },
        });
      }
      const requestMsgId = deriveRequestMsgId(params.type, params.request_msg_id, body);
      const packet = createPacket({
        mission_id: loaded.mission.mission_id,
        type: params.type,
        from: params.from,
        to: params.to,
        body,
        correlation_id: params.correlation_id,
        request_msg_id: requestMsgId,
      });
      const result = await localTopologySend(localTransportRoot(loaded.mission.project), loaded.mission.project, packet);
      if (packet.type === "ACK") {
        const receivedPacketId = typeof packet.body.received_packet_id === "string" ? packet.body.received_packet_id : undefined;
        if (receivedPacketId) rememberClosedPacket(loaded.mission.mission_id, packet.from, receivedPacketId);
      }
      if (packet.type === "VERDICT") {
        const closedPacketId = typeof packet.request_msg_id === "string" ? packet.request_msg_id : undefined;
        if (closedPacketId) rememberClosedPacket(loaded.mission.mission_id, packet.from, closedPacketId);
      }
      const latestBoard = existsSync(loaded.statusPath)
        ? JSON.parse(readFileSync(loaded.statusPath, "utf8")) as typeof loaded.board
        : loaded.board;
      writeJson(loaded.statusPath, applyPacketLifecycle(latestBoard, packet, {
        liveDeliveryStatus: result.live_delivery?.status,
        now: packet.timestamp,
      }));
      await appendEvent(loaded.eventPath, {
        event_type: "packet_sent",
        mission_id: loaded.mission.mission_id,
        packet_id: packet.packet_id,
        from: packet.from,
        to: packet.to,
        packet_type: packet.type,
        lifecycle_state: result.live_delivery?.status === "delivered" ? "delivered" : "queued",
        live_delivery: result.live_delivery,
        evidence: { transport: [localTransportRoot(loaded.mission.project)], business: [packet.body], inference: [] },
      });
      return toolText(`queued ${packet.type} packet ${packet.packet_id} for ${packet.to}`, { ok: true, ...result });
    },
  });

  pi.registerTool({
    name: "topology_write_artifact",
    label: "Topology Write Artifact",
    description: "Write a role report/review artifact under .pi/topology/artifacts/<role>/ and return its relative path for compact topology_send payloads.",
    promptSnippet: "Write a long topology report into an artifact file and return artifact_path",
    promptGuidelines: [
      "Use for long reports instead of putting verbose prose directly into topology_send bodies.",
      "Reference the returned artifact_path from a compact packet.",
    ],
    parameters: {
      type: "object",
      required: ["role", "kind", "title", "body"],
      properties: {
        role: { enum: ["topology-supervisor", "hq", "repair", "runner", "oracle", "librarian", "scott"] },
        kind: { enum: ["report", "review", "status", "handoff", "evidence", "decision"] },
        title: { type: "string" },
        body: { type: "string" },
        request_msg_id: { type: "string" },
      },
    },
    async execute(_id: string, params: {
      role: WorkerRole | "topology-supervisor";
      kind: "report" | "review" | "status" | "handoff" | "evidence" | "decision";
      title: string;
      body: string;
      request_msg_id?: string;
    }, _signal: unknown, _onUpdate: unknown, ctx: ToolContext) {
      const loaded = loadRuntimeState(ctx.cwd);
      if (!loaded.ok) return toolText(loaded.message, loaded);
      const now = new Date().toISOString();
      const dir = path.join(ctx.cwd, ".pi", "topology", "artifacts", params.role);
      const filename = `${now.replace(/[:.]/g, "-")}-${sanitizeArtifactSegment(params.kind)}-${sanitizeArtifactSegment(params.title)}.md`;
      const artifactPath = path.join(dir, filename);
      const relativePath = path.relative(ctx.cwd, artifactPath);
      mkdirSync(dir, { recursive: true });
      writeFileSync(artifactPath, [
        "---",
        `mission_id: ${loaded.mission.mission_id}`,
        `role: ${params.role}`,
        `kind: ${params.kind}`,
        `title: ${params.title.replace(/\n/g, " ")}`,
        `created_at: ${now}`,
        ...(params.request_msg_id ? [`request_msg_id: ${params.request_msg_id}`] : []),
        "---",
        "",
        params.body.trim(),
        "",
      ].join("\n"), "utf8");
      await appendEvent(loaded.eventPath, {
        event_type: "artifact_written",
        mission_id: loaded.mission.mission_id,
        role: params.role,
        artifact_path: relativePath,
        request_msg_id: params.request_msg_id,
        evidence: {
          transport: [relativePath],
          business: [params.title],
          inference: [],
        },
      });
      return toolText(`artifact written: ${relativePath}`, {
        ok: true,
        artifact_path: relativePath,
        absolute_path: artifactPath,
      });
    },
  });

  pi.registerTool({
    name: "topology_read_artifact",
    label: "Topology Read Artifact",
    description: "Read a role report/review artifact from .pi/topology/artifacts/. Use this for artifact_path values received in topology_send packets instead of generic file reads.",
    promptSnippet: "Read a topology artifact referenced by artifact_path",
    promptGuidelines: [
      "Prefer this over generic file reads when a packet provides artifact_path.",
    ],
    parameters: {
      type: "object",
      required: ["artifact_path"],
      properties: {
        artifact_path: { type: "string" },
      },
    },
    async execute(_id: string, params: { artifact_path: string }, _signal: unknown, _onUpdate: unknown, ctx: ToolContext) {
      const loaded = loadRuntimeState(ctx.cwd);
      if (!loaded.ok) return toolText(loaded.message, loaded);
      const resolved = resolveArtifactPath(ctx.cwd, params.artifact_path);
      if (!resolved.ok) return toolText(resolved.message, resolved);
      const body = readFileSync(resolved.absolutePath, "utf8");
      await appendEvent(loaded.eventPath, {
        event_type: "artifact_read",
        mission_id: loaded.mission.mission_id,
        artifact_path: resolved.relativePath,
        evidence: {
          transport: [resolved.relativePath],
          business: [],
          inference: [],
        },
      });
      return toolText(body, {
        ok: true,
        artifact_path: resolved.relativePath,
        absolute_path: resolved.absolutePath,
      });
    },
  });

  pi.registerTool({
    name: "topology_list",
    label: "Topology List",
    description: "Non-blocking list of local topology packets for a role inbox.",
    promptSnippet: "List packets currently present in a topology inbox without blocking",
    promptGuidelines: [
      "Use for inbox inspection when you do not want to wait.",
      "Prefer this over repeated generic log inspection.",
    ],
    parameters: {
      type: "object",
      required: ["to"],
      properties: {
        to: { type: "string" },
      },
    },
    async execute(_id: string, params: { to: WorkerRole | "topology-supervisor" | "owner"; verbose?: boolean }, _signal: unknown, _onUpdate: unknown, ctx: ToolContext) {
      const loaded = loadRuntimeState(ctx.cwd);
      if (!loaded.ok) return toolText(loaded.message, loaded);
      const packets = await localTopologyList(localTransportRoot(loaded.mission.project), loaded.mission.project, params.to);
      for (const packet of packets) {
        await appendEvent(loaded.eventPath, {
          event_type: "packet_received",
          mission_id: loaded.mission.mission_id,
          packet_id: packet.packet_id,
          to: params.to,
          source: "topology_list",
          evidence: { transport: [localTransportRoot(loaded.mission.project)], business: [packet.body], inference: [] },
        });
      }
      const text = formatPacketSummaries(packets, { title: `topology_list ${params.to}`, empty: `No packets for ${params.to}` });
      return toolText(text, { ok: true, packets });
    },
  });

  pi.registerTool({
    name: "topology_await",
    label: "Topology Await",
    description: "Blocking wait for a matching topology packet in a role inbox; use after dispatching work to avoid missing late peer reports.",
    promptSnippet: "Wait for a matching topology packet when blocking is truly necessary",
    promptGuidelines: [
      "Use sparingly; prefer topology_list/topology_get for normal role work.",
      "Bias against long waits that only add token churn.",
    ],
    parameters: {
      type: "object",
      required: ["to"],
      properties: {
        to: { type: "string" },
        from: { type: "string" },
        type: { enum: ["ACK", "STATUS", "REPORT", "REQUEST", "INCIDENT", "VERDICT"] },
        request_msg_id: { type: "string" },
        after_timestamp: { type: "string" },
        timeout_ms: { type: "number" },
        poll_interval_ms: { type: "number" },
      },
    },
    async execute(_id: string, params: {
      to: WorkerRole | "topology-supervisor" | "owner";
      from?: WorkerRole | "topology-supervisor";
      type?: PacketType;
      request_msg_id?: string;
      after_timestamp?: string;
      timeout_ms?: number;
      poll_interval_ms?: number;
    }, _signal: unknown, _onUpdate: unknown, ctx: ToolContext) {
      const loaded = loadRuntimeState(ctx.cwd);
      if (!loaded.ok) return toolText(loaded.message, loaded);
      const result = await localTopologyAwait(localTransportRoot(loaded.mission.project), loaded.mission.project, params.to, {
        from: params.from,
        type: params.type,
        request_msg_id: params.request_msg_id,
        after_timestamp: params.after_timestamp,
      }, {
        timeoutMs: params.timeout_ms,
        pollIntervalMs: params.poll_interval_ms,
      });
      for (const packet of result.packets) {
        await appendEvent(loaded.eventPath, {
          event_type: "packet_received",
          mission_id: loaded.mission.mission_id,
          packet_id: packet.packet_id,
          to: params.to,
          source: "topology_await",
          evidence: { transport: [localTransportRoot(loaded.mission.project)], business: [packet.body], inference: [] },
        });
      }
      return toolText(JSON.stringify(result, null, 2), { ok: true, ...result });
    },
  });

  pi.registerTool({
    name: "topology_get",
    label: "Topology Get",
    description: "Non-blocking lookup of one local topology packet for a role inbox.",
    promptSnippet: "Fetch one packet from a topology inbox by packet_id",
    promptGuidelines: [
      "Use after topology_list when you need one packet's durable body.",
      "Avoid repeatedly fetching the same packet unless state changed.",
    ],
    parameters: {
      type: "object",
      required: ["to", "packet_id"],
      properties: {
        to: { type: "string" },
        packet_id: { type: "string" },
        verbose: { type: "boolean" },
      },
    },
    async execute(_id: string, params: { to: WorkerRole | "topology-supervisor" | "owner"; packet_id: string; verbose?: boolean }, _signal: unknown, _onUpdate: unknown, ctx: ToolContext) {
      const loaded = loadRuntimeState(ctx.cwd);
      if (!loaded.ok) return toolText(loaded.message, loaded);
      const result = await localTopologyGet(localTransportRoot(loaded.mission.project), loaded.mission.project, params.to, params.packet_id);
      if (result.status === "complete" && result.packet) {
        await appendEvent(loaded.eventPath, {
          event_type: "packet_received",
          mission_id: loaded.mission.mission_id,
          packet_id: result.packet.packet_id,
          to: params.to,
          source: "topology_get",
          evidence: { transport: [localTransportRoot(loaded.mission.project)], business: [result.packet.body], inference: [] },
        });
      }
      const text = params.verbose
        ? JSON.stringify(result, null, 2)
        : formatPacketLookup(result, params.packet_id);
      return toolText(text, { ok: true, ...result });
    },
  });

  pi.registerTool({
    name: "topology_cleanup",
    label: "Topology Cleanup",
    description: "Clean generated topology state only when confirm=true; otherwise report what would be removed.",
    promptSnippet: "Remove generated topology state only with explicit confirmation",
    promptGuidelines: [
      "Use only for cleanup, not normal workflow.",
      "Respect confirm=false dry-run behavior by default.",
    ],
    parameters: {
      type: "object",
      properties: {
        confirm: { type: "boolean" },
      },
    },
    async execute(_id: string, params: { confirm?: boolean }, _signal: unknown, _onUpdate: unknown, ctx: ToolContext) {
      const dir = path.join(ctx.cwd, ".pi", "topology");
      if (!params.confirm) return toolText(`dry-run: would remove ${dir}`, { ok: true, dry_run: true, path: dir });
      rmSync(dir, { recursive: true, force: true });
      return toolText(`removed ${dir}`, { ok: true, path: dir });
    },
  });
}

function missionPathFor(cwd: string): string {
  return process.env.PI_TOPOLOGY_MISSION_CARD ?? path.join(cwd, ".pi", "topology", "mission-card.json");
}

function resolvePackageRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

function loadRuntimeState(cwd: string): { ok: false; message: string } | {
  ok: true;
  mission: ReturnType<typeof createMissionDraft>;
  board: ReturnType<typeof createInitialStatusBoard>;
  missionPath: string;
  statusPath: string;
  incidentPath: string;
  eventPath: string;
  sessionLedgerPath: string;
} {
  const missionPath = missionPathFor(cwd);
  if (!existsSync(missionPath)) return { ok: false, message: `No topology mission card found at ${missionPath}` };
  let mission = JSON.parse(readFileSync(missionPath, "utf8")) as ReturnType<typeof createMissionDraft>;
  const normalized = normalizeMissionCard(mission);
  mission = normalized.mission as ReturnType<typeof createMissionDraft>;
  if (normalized.changed) writeJson(missionPath, mission);
  const validation = validateMissionCard(mission);
  if (!validation.ok) return { ok: false, message: `Invalid mission card: ${validation.errors.join("; ")}` };
  const statusPath = path.join(cwd, mission.status_board_path);
  const board = existsSync(statusPath)
    ? JSON.parse(readFileSync(statusPath, "utf8")) as ReturnType<typeof createInitialStatusBoard>
    : createInitialStatusBoard(mission);
  const sessionLedgerPath = path.join(cwd, mission.session_ledger_path ?? ".pi/topology/sessions.jsonl");
  ensureSessionLedger(cwd, mission, missionPath, sessionLedgerPath);
  const registryRoot = localTransportRoot(mission.project);
  const reconciledBoard = reconcileBoardWithLiveRegistry(
    reconcileBoardWithSessionRecords(board, readJsonl(sessionLedgerPath)),
    readFreshPeerRegistrySync(registryRoot, mission.project),
  );
  if (JSON.stringify(reconciledBoard) !== JSON.stringify(board)) {
    writeJson(statusPath, reconciledBoard);
  }
  return {
    ok: true,
    mission,
    board: reconciledBoard,
    missionPath,
    statusPath,
    incidentPath: path.join(cwd, mission.incident_log_path),
    eventPath: path.join(cwd, mission.event_log_path),
    sessionLedgerPath,
  };
}

function readJsonl(file: string): Array<Record<string, unknown>> {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
}

function ensureSessionLedger(cwd: string, mission: ReturnType<typeof createMissionDraft>, missionPath: string, sessionLedgerPath: string): void {
  const launchScripts = writeMissionLaunchScriptsSync(mission, {
    packageRoot: resolvePackageRoot(),
    missionPath,
    registryRoot: localTransportRoot(mission.project),
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

function localTransportRoot(project: string): string {
  return process.env.PI_COMS_DIR ?? path.join("/tmp", `pi-topology-${project}`);
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function countJsonl(file: string): number {
  if (!existsSync(file)) return 0;
  return readJsonl(file).length;
}

function resolveRoleLogPath(cwd: string, role: WorkerRole, requestedPath?: string): string {
  const defaultPath = path.join(cwd, ".pi", "topology", `${role}.log`);
  if (!requestedPath?.trim()) return defaultPath;
  const resolved = path.resolve(cwd, requestedPath);
  const ext = path.extname(resolved).toLowerCase();
  if (ext !== ".log") return defaultPath;
  const forbiddenBasenames = new Set([
    "mission-card.json",
    "status-board.json",
    "runtime-events.jsonl",
    "incident-log.jsonl",
    "sessions.jsonl",
  ]);
  if (forbiddenBasenames.has(path.basename(resolved))) return defaultPath;
  return resolved;
}

function normalizePacketBody(params: {
  body?: Record<string, unknown>;
  status?: string;
  summary?: string;
  next?: string;
  note?: string;
  artifact_path?: string;
}): Record<string, unknown> | undefined {
  if (params.body && Object.keys(params.body).length > 0) return params.body;
  const body = {
    status: params.status,
    summary: params.summary,
    next: params.next,
    note: params.note,
    artifact_path: params.artifact_path,
  };
  const entries = Object.entries(body).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0);
  if (!entries.length) return params.body;
  return Object.fromEntries(entries);
}

function deriveRequestMsgId(type: PacketType, explicit: string | undefined, body: Record<string, unknown>): string | undefined {
  if (explicit) return explicit;
  if (typeof body.request_msg_id === "string") return body.request_msg_id;
  if (type === "ACK" && typeof body.received_packet_id === "string") return body.received_packet_id;
  return undefined;
}

function formatPacketSummaries(
  packets: Array<{ packet_id: string; type: string; from: string; to: string; request_msg_id?: string; body?: Record<string, unknown> }>,
  options: { title: string; empty: string },
): string {
  if (!packets.length) return options.empty;
  return [options.title, ...packets.map((packet) => formatPacketSummaryLine(packet))].join("\n");
}

function formatPacketLookup(
  result: { status: string; packet?: { packet_id: string; type: string; from: string; to: string; request_msg_id?: string; body?: Record<string, unknown> } },
  packetId: string,
): string {
  if (result.status !== "complete" || !result.packet) return `topology_get ${packetId}: ${result.status}`;
  return [`topology_get ${packetId}`, formatPacketSummaryLine(result.packet)].join("\n");
}

function formatPacketSummaryLine(packet: {
  packet_id: string;
  type: string;
  from: string;
  to: string;
  request_msg_id?: string;
  body?: Record<string, unknown>;
}): string {
  const body = packet.body ?? {};
  const summary = firstString(body, ["summary", "verdict_summary", "verdict", "status", "task", "note"]);
  const artifactPath = typeof body.artifact_path === "string" ? body.artifact_path : undefined;
  const request = packet.request_msg_id ? ` request_msg_id=${packet.request_msg_id}` : "";
  const extra = [
    summary ? `summary=${truncateInline(summary, 180)}` : undefined,
    artifactPath ? `artifact_path=${artifactPath}` : undefined,
  ].filter(Boolean).join(" ");
  return `- ${packet.packet_id} ${packet.type} ${packet.from}->${packet.to}${request}${extra ? ` ${extra}` : ""}`;
}

function firstString(body: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = body[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function truncateInline(value: string, max = 180): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function formatPendingPackets(pendingPackets: Array<Record<string, unknown>>): string[] {
  if (!pendingPackets.length) return [];
  return [
    "pending_detail:",
    ...pendingPackets.slice(-8).map((packet) => [
      `- ${String(packet.packet_id ?? "unknown")}`,
      String(packet.type ?? "?"),
      `${String(packet.from ?? "?")}->${String(packet.to ?? "?")}`,
      `state=${String(packet.state ?? "?")}`,
      packet.request_msg_id ? `request_msg_id=${String(packet.request_msg_id)}` : undefined,
      packet.report_packet_id ? `report_packet_id=${String(packet.report_packet_id)}` : undefined,
    ].filter(Boolean).join(" ")),
  ];
}

function sanitizeArtifactSegment(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return slug || "artifact";
}

function resolveArtifactPath(cwd: string, inputPath: string): { ok: true; absolutePath: string; relativePath: string } | { ok: false; message: string } {
  const artifactRoot = path.resolve(cwd, ".pi", "topology", "artifacts");
  const absolutePath = path.isAbsolute(inputPath)
    ? path.resolve(inputPath)
    : path.resolve(cwd, inputPath);
  if (absolutePath !== artifactRoot && !absolutePath.startsWith(`${artifactRoot}${path.sep}`)) {
    return { ok: false, message: `artifact_path must be under ${path.relative(cwd, artifactRoot)}` };
  }
  if (!existsSync(absolutePath)) {
    return { ok: false, message: `artifact not found: ${path.relative(cwd, absolutePath)}` };
  }
  return {
    ok: true,
    absolutePath,
    relativePath: path.relative(cwd, absolutePath),
  };
}

function toolText(text: string, details: Record<string, unknown>): { content: { type: "text"; text: string }[]; details: Record<string, unknown> } {
  return { content: [{ type: "text", text }], details };
}
