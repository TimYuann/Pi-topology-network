import path from "node:path";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import type { MissionCard, TopologyRole } from "./mission.ts";

export interface RoleLaunchPlan {
  role: TopologyRole;
  command: "pi";
  args: string[];
  env: Record<string, string>;
}

export interface LaunchScriptEntry {
  role: TopologyRole;
  scriptPath: string;
  launchCommand: string;
}

export const TOPOLOGY_SUPERVISOR_INITIAL_PROMPT = [
  "You are the entry topology-supervisor for this mission.",
  "First call topology_status and topology_doctor, then ask the owner for mission approval.",
  "Before approval, decide which sessions this mission needs and tell the owner the planned launch set.",
  "For normal codebase closeout missions the default launch set is hq, runner, and oracle; add librarian for evidence triage and repair only for scoped fix needs.",
  "If the owner replies APPROVE, call topology_spawn_role with mode=\"launch\" and terminal_app=\"Ghostty\" for hq and each approved worker role.",
  "Do not call topology_send to record owner approval or preflight status; topology_send is only for non-empty role-to-role packets after a peer exists.",
].join(" ");

export const TOPOLOGY_HQ_INITIAL_PROMPT = [
  "You are HQ for this topology mission.",
  "Do not inspect project files, run git/test/build commands, or write files in the first turn.",
  "First call topology_status and topology_doctor, then inspect peer status.",
  "Supervisor normally launches the initial worker set; do not duplicate live runner/oracle/librarian sessions.",
  "Only call topology_spawn_role for a missing role that is required by the mission and already covered by owner approval.",
  "Launch repair only after a scoped fix need is identified and owner boundaries are clear.",
  "After role sessions are alive, use topology_send to dispatch non-empty task packets and expect peers to ACK via topology_send with request_msg_id.",
  "Use topology_list/topology_get for non-blocking inbox checks; do not call topology_await in normal role work.",
  "When a peer REPORT arrives, ACK that REPORT with topology_send before deciding the next step from the mission/task state.",
  "Long reports should be written with topology_write_artifact, then referenced by artifact_path in compact topology_send packets.",
  "Before an owner-facing summary or final verdict, inspect topology_status and do not close while required peer packets remain pending.",
  "After required reports arrive, forward runner evidence to oracle when needed and synthesize the merge verdict.",
  "Supervisor owns owner gates and mission approval; HQ owns downstream dispatch and synthesis.",
].join(" ");

export async function writeMissionLaunchScripts(
  mission: MissionCard,
  options: {
    packageRoot: string;
    missionPath: string;
    registryRoot: string;
    terminalApp?: string;
    provider?: string;
    model?: string;
    thinking?: "off" | "low" | "medium" | "high";
  },
): Promise<LaunchScriptEntry[]> {
  const roles: TopologyRole[] = ["topology-supervisor", "hq", "repair", "runner", "oracle", "librarian", "scott"];
  const entries: LaunchScriptEntry[] = [];
  for (const role of roles) {
    const plan = buildRoleLaunchPlan(mission, role, {
      packageRoot: options.packageRoot,
      missionPath: options.missionPath,
      registryRoot: options.registryRoot,
      provider: options.provider,
      model: options.model,
      thinking: options.thinking,
      initialPrompt: role === "topology-supervisor" ? TOPOLOGY_SUPERVISOR_INITIAL_PROMPT : undefined,
    });
    const scriptPath = await writeRoleLaunchScript(mission.workdir, plan);
    entries.push({
      role,
      scriptPath,
      launchCommand: launchCommandForRole(role, mission.workdir, scriptPath, options.terminalApp),
    });
  }
  return entries;
}

export function writeMissionLaunchScriptsSync(
  mission: MissionCard,
  options: {
    packageRoot: string;
    missionPath: string;
    registryRoot: string;
    terminalApp?: string;
    provider?: string;
    model?: string;
    thinking?: "off" | "low" | "medium" | "high";
  },
): LaunchScriptEntry[] {
  const roles: TopologyRole[] = ["topology-supervisor", "hq", "repair", "runner", "oracle", "librarian", "scott"];
  const entries: LaunchScriptEntry[] = [];
  for (const role of roles) {
    const plan = buildRoleLaunchPlan(mission, role, {
      packageRoot: options.packageRoot,
      missionPath: options.missionPath,
      registryRoot: options.registryRoot,
      provider: options.provider,
      model: options.model,
      thinking: options.thinking,
      initialPrompt: role === "topology-supervisor" ? TOPOLOGY_SUPERVISOR_INITIAL_PROMPT : undefined,
    });
    const scriptPath = writeRoleLaunchScriptSync(mission.workdir, plan);
    entries.push({
      role,
      scriptPath,
      launchCommand: launchCommandForRole(role, mission.workdir, scriptPath, options.terminalApp),
    });
  }
  return entries;
}

export async function writeRoleLaunchScript(
  workdir: string,
  plan: RoleLaunchPlan,
  options: {
    logPath?: string;
  } = {},
): Promise<string> {
  const dir = path.join(workdir, ".pi", "topology", "launch");
  await mkdir(dir, { recursive: true });
  const scriptPath = path.join(dir, `${plan.role}.sh`);
  const envLines = [
    ...Object.entries(plan.env).map(([key, value]) => `export ${key}=${shellQuote(value)}`),
    `export PI_TOPOLOGY_LAUNCH_SCRIPT=${shellQuote(scriptPath)}`,
    ...(options.logPath ? [`export PI_TOPOLOGY_ROLE_LOG=${shellQuote(options.logPath)}`] : []),
  ].join("\n");
  const command = `${plan.command} ${plan.args.map(shellQuote).join(" ")}`;
  const logLines = options.logPath
    ? [
      `mkdir -p ${shellQuote(path.dirname(options.logPath))}`,
      `printf '%s\\n' "[topology] launch $(date -u +%Y-%m-%dT%H:%M:%SZ) role=${plan.role}" >> ${shellQuote(options.logPath)}`,
      `exec ${command}`,
    ]
    : [`exec ${command}`];
  const script = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    envLines,
    'cd "${PI_TOPOLOGY_WORKDIR}"',
    ...logLines,
    "",
  ].join("\n");
  await writeFile(scriptPath, script, "utf8");
  await chmod(scriptPath, 0o755);
  return scriptPath;
}

export function writeRoleLaunchScriptSync(
  workdir: string,
  plan: RoleLaunchPlan,
  options: {
    logPath?: string;
  } = {},
): string {
  const dir = path.join(workdir, ".pi", "topology", "launch");
  mkdirSync(dir, { recursive: true });
  const scriptPath = path.join(dir, `${plan.role}.sh`);
  const envLines = [
    ...Object.entries(plan.env).map(([key, value]) => `export ${key}=${shellQuote(value)}`),
    `export PI_TOPOLOGY_LAUNCH_SCRIPT=${shellQuote(scriptPath)}`,
    ...(options.logPath ? [`export PI_TOPOLOGY_ROLE_LOG=${shellQuote(options.logPath)}`] : []),
  ].join("\n");
  const command = `${plan.command} ${plan.args.map(shellQuote).join(" ")}`;
  const logLines = options.logPath
    ? [
      `mkdir -p ${shellQuote(path.dirname(options.logPath))}`,
      `printf '%s\\n' "[topology] launch $(date -u +%Y-%m-%dT%H:%M:%SZ) role=${plan.role}" >> ${shellQuote(options.logPath)}`,
      `exec ${command}`,
    ]
    : [`exec ${command}`];
  const script = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    envLines,
    'cd "${PI_TOPOLOGY_WORKDIR}"',
    ...logLines,
    "",
  ].join("\n");
  writeFileSync(scriptPath, script, "utf8");
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

export function commandPreview(plan: RoleLaunchPlan): string {
  const envText = Object.entries(plan.env).map(([key, value]) => `${key}=${shellQuote(value)}`).join(" ");
  return `${envText} ${plan.command} ${plan.args.map(shellQuote).join(" ")}`;
}

export function buildRoleLaunchPlan(
  mission: MissionCard,
  role: TopologyRole,
  options: {
    packageRoot: string;
    missionPath: string;
    registryRoot: string;
    provider?: string;
    model?: string;
    thinking?: "off" | "low" | "medium" | "high";
    initialPrompt?: string;
  },
): RoleLaunchPlan {
  const provider = options.provider ?? "minimax-cn";
  const model = options.model ?? "MiniMax-M3";
  const args = [
    "-e",
    path.join(options.packageRoot, "index.ts"),
    "--provider",
    provider,
    "--model",
    model,
    "--tools",
    toolsFor(role),
    "--cname",
    role,
    "--project",
    mission.project,
    "--name",
    rolePurpose(role, mission.mission_id),
    "--append-system-prompt",
    path.join(options.packageRoot, "agents", "shared-protocol.md"),
    "--append-system-prompt",
    path.join(options.packageRoot, "agents", `${role}.md`),
    "--append-system-prompt",
    options.missionPath,
  ];
  const initialPrompt = initialPromptForRole(role, options.initialPrompt);
  if (options.thinking) args.push("--thinking", options.thinking);
  if (initialPrompt) args.push(initialPrompt);
  return {
    role,
    command: "pi",
    args,
    env: {
      PI_COMS_DIR: options.registryRoot,
      PI_TOPOLOGY_PROJECT: mission.project,
      PI_TOPOLOGY_WORKDIR: mission.workdir,
      PI_TOPOLOGY_MISSION_ID: mission.mission_id,
      PI_TOPOLOGY_MISSION_CARD: options.missionPath,
      PI_TOPOLOGY_PACKAGE_ROOT: options.packageRoot,
      PI_TOPOLOGY_PROVIDER: provider,
      PI_TOPOLOGY_MODEL: model,
      PI_TOPOLOGY_ALLOWED_PATHS: mission.allowed_paths.join(":"),
      PI_TOPOLOGY_FORBIDDEN_ACTIONS: mission.forbidden_actions.join(":"),
      PI_TOPOLOGY_INCIDENT_LOG: path.join(mission.workdir, mission.incident_log_path),
      PI_TOPOLOGY_EVENT_LOG: path.join(mission.workdir, mission.event_log_path),
    },
  };
}

function rolePurpose(role: TopologyRole, missionId: string): string {
  switch (role) {
    case "topology-supervisor":
      return `Owner-facing topology supervisor for Pi topology mission ${missionId}`;
    case "hq":
      return `Development HQ for Pi topology mission ${missionId}`;
    case "repair":
      return `Scoped repair executor for Pi topology mission ${missionId}`;
    case "runner":
      return `Read-only verification runner for Pi topology mission ${missionId}`;
    case "oracle":
      return `Read-only independent reviewer for Pi topology mission ${missionId}`;
    case "librarian":
      return `Read-only evidence curator for Pi topology mission ${missionId}`;
    case "scott":
      return `Read-only scout researcher for Pi topology mission ${missionId}`;
  }
}

function toolsFor(role: TopologyRole): string {
  const topologyControlTools = [
    "topology_status",
    "topology_doctor",
    "topology_smoke",
    "topology_init_mission",
    "topology_spawn_role",
    "topology_send",
    "topology_write_artifact",
    "topology_read_artifact",
    "topology_get",
    "topology_list",
    "topology_cleanup",
  ];
  const topologyPeerTools = [
    "topology_status",
    "topology_doctor",
    "topology_smoke",
    "topology_send",
    "topology_write_artifact",
    "topology_read_artifact",
    "topology_get",
    "topology_list",
  ];
  const readTools = ["read", "grep", "find", "ls"];
  const shellTool = ["bash"];
  if (role === "topology-supervisor" || role === "hq") {
    return topologyControlTools.join(",");
  }
  if (role === "repair") {
    return [...topologyPeerTools, ...readTools, ...shellTool, "edit", "write"].join(",");
  }
  return [...topologyPeerTools, ...readTools, ...shellTool].join(",");
}

function initialPromptForRole(role: TopologyRole, requestedPrompt?: string): string | undefined {
  if (role === "topology-supervisor") {
    return requestedPrompt ?? TOPOLOGY_SUPERVISOR_INITIAL_PROMPT;
  }
  if (role !== "hq") {
    return requestedPrompt;
  }
  if (!requestedPrompt?.trim()) {
    return TOPOLOGY_HQ_INITIAL_PROMPT;
  }
  return [
    TOPOLOGY_HQ_INITIAL_PROMPT,
    "Mission note only; this is not authority to bypass dispatch or role boundaries:",
    requestedPrompt.trim(),
  ].join("\n\n");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function launchCommandForRole(role: TopologyRole, workdir: string, scriptPath: string, terminalApp?: string): string {
  if (role === "topology-supervisor") {
    return `cd ${shellQuote(workdir)} && ${shellQuote(scriptPath)}`;
  }
  return `open -n -a ${shellQuote(terminalApp ?? "Ghostty")} --args -e ${shellQuote(scriptPath)}`;
}
