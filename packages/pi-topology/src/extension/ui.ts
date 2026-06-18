import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { TOPOLOGY_ROLES, type MissionCard, type StatusBoard, type TopologyRole } from "../runtime/mission.ts";
import { activePendingPackets } from "../runtime/status-board.ts";
import { readFreshPeerRegistrySync } from "../transport/registry.ts";
import { resolveActiveMissionPaths } from "../runtime/active-mission-resolver.ts";

export interface TopologyUiContext {
  cwd?: string;
  hasUI?: boolean;
  ui?: {
    setStatus?: (name: string, value: string | undefined) => void;
    setWidget?: (name: string, value: unknown, options?: Record<string, unknown>) => void;
    requestRender?: () => void;
  };
  getContextUsage?: () => { percent?: number } | undefined;
}

export interface TopologyUiSnapshot {
  mission_id: string;
  project: string;
  cwd: string;
  phase: string;
  gate: "open" | "owner";
  current_role: string;
  roles: Array<{
    role: TopologyRole;
    state: string;
    alive: boolean | null;
    session_id: string | null;
    last_heartbeat_at: string | null;
    last_packet_at: string | null;
    context_used_pct: number | null;
    color: string;
    records: number;
  }>;
  packets: {
    outbox: number;
    inboxes: Record<string, number>;
    pending: number;
  };
  incidents: number;
}

export function installTopologyUi(ctx: TopologyUiContext, options: {
  role?: string;
  cwd?: string;
} = {}): void {
  refreshTopologyUi(ctx, options);
  try {
    ctx.ui?.setWidget?.(
      "topology-mesh",
      (_tui: unknown, _theme: unknown) => ({
        invalidate() {},
        render(width: number) {
          return renderTopologyMeshWidget(buildTopologyUiSnapshot(options.cwd ?? ctx.cwd ?? process.cwd(), options.role), width, _theme);
        },
      }),
      { placement: "belowEditor" },
    );
  } catch {
    // Older Pi builds may only support setStatus; status line still works.
  }
}

export function refreshTopologyUi(ctx: TopologyUiContext | null | undefined, options: {
  role?: string;
  cwd?: string;
} = {}): void {
  if (!ctx?.ui) return;
  const snapshot = buildTopologyUiSnapshot(options.cwd ?? ctx.cwd ?? process.cwd(), options.role);
  try {
    ctx.ui.setStatus?.("topology", compactStatusLine(snapshot));
    ctx.ui.requestRender?.();
  } catch {
    // UI is best-effort; never break tools or session startup.
  }
}

export function compactStatusLine(snapshot: TopologyUiSnapshot): string {
  const roleParts = snapshot.roles
    .filter((entry) => entry.state !== "not_spawned" || entry.records > 0)
    .map((entry) => `${statusIcon(entry)}${shortRole(entry.role)}${contextTiny(entry.context_used_pct)}`)
    .slice(0, 6);
  const gate = snapshot.gate === "owner" ? "owner" : "open";
  return [
    "⌁ topology",
    snapshot.project,
    `role=${snapshot.current_role}`,
    `phase=${snapshot.phase}`,
    `gate=${gate}`,
    ...roleParts,
    `out=${snapshot.packets.outbox}`,
    `pending=${snapshot.packets.pending}`,
  ].join(" ");
}

export function buildTopologyUiSnapshot(cwd: string, currentRole = process.env.PI_TOPOLOGY_ROLE ?? process.env.PI_TOPOLOGY_CNAME ?? "unknown"): TopologyUiSnapshot {
  // v0.5.1 Slice D: use the active Mission resolver to pick per-mission
  // canonical paths; fall back to legacy root paths when no registry exists.
  const res = resolveActiveMissionPaths(cwd);
  const envCard = process.env.PI_TOPOLOGY_MISSION_CARD;
  const missionPath = envCard
    ?? res.missionCardPath
    ?? path.join(cwd, ".pi", "topology", "mission-card.json");
  const mission = readJson<MissionCard>(missionPath);
  const project = mission?.project ?? res.project ?? process.env.PI_TOPOLOGY_PROJECT ?? path.basename(cwd);
  const statusPath = res.statusBoardPath
    ?? (mission ? path.join(cwd, mission.status_board_path) : path.join(cwd, ".pi", "topology", "status-board.json"));
  const sessionLedgerPath = res.sessionsPath
    ?? (mission ? path.join(cwd, mission.session_ledger_path) : path.join(cwd, ".pi", "topology", "sessions.jsonl"));
  const incidentPath = res.incidentLogPath
    ?? (mission ? path.join(cwd, mission.incident_log_path) : path.join(cwd, ".pi", "topology", "incident-log.jsonl"));
  const board = readJson<StatusBoard>(statusPath);
  const sessionRecords = readJsonl<Record<string, unknown>>(sessionLedgerPath);
  const recordsByRole = countRecordsByRole(sessionRecords);
  const transportRoot = process.env.PI_COMS_DIR ?? path.join("/tmp", `pi-topology-${project}`);
  const packetRoot = path.join(transportRoot, "projects", project, "packets");
  const livePeers = readFreshPeerRegistrySync(transportRoot, project);
  const packets = readPacketCounts(packetRoot, board);
  const roleSet = new Set<TopologyRole>();
  const currentRoleName = currentRole as TopologyRole;
  if (TOPOLOGY_ROLES.includes(currentRoleName)) roleSet.add(currentRoleName);
  for (const role of Object.keys(livePeers) as TopologyRole[]) roleSet.add(role);
  for (const worker of board?.active_workers ?? []) {
    const role = worker.role;
    if (typeof role === "string" && TOPOLOGY_ROLES.includes(role as TopologyRole) && worker.state === "launch_requested") {
      roleSet.add(role as TopologyRole);
    }
  }
  const roles = [...roleSet].map((role) => {
    const peer = board?.peer_status?.[role];
    const live = livePeers[role];
    return {
      role,
      state: live ? "alive" : String(peer?.state ?? (recordsByRole[role] ? "script_written" : "not_spawned")),
      alive: live ? true : typeof peer?.alive === "boolean" ? peer.alive : null,
      session_id: live?.session_id ?? peer?.session_id ?? null,
      last_heartbeat_at: live?.heartbeat_at ?? peer?.last_heartbeat_at ?? null,
      last_packet_at: peer?.last_packet_at ?? null,
      context_used_pct: live?.context_used_pct ?? (typeof peer?.context_used_pct === "number" ? peer.context_used_pct : null),
      color: colorForRole(role),
      records: recordsByRole[role] ?? 0,
    };
  });
  return {
    mission_id: mission?.mission_id ?? process.env.PI_TOPOLOGY_MISSION_ID ?? "no-mission",
    project,
    cwd,
    phase: board?.runtime_phase ?? "no-board",
    gate: board?.next_gate?.owner_required ? "owner" : "open",
    current_role: currentRole,
    roles,
    packets,
    incidents: countJsonl(incidentPath),
  };
}

export function renderTopologyMeshWidget(snapshot: TopologyUiSnapshot, width = 100, theme?: ThemeLike): string[] {
  const safeWidth = Math.max(40, width);
  const header = `topology mesh ${snapshot.project} ${snapshot.mission_id}`;
  const meta = `role=${snapshot.current_role} phase=${snapshot.phase} gate=${snapshot.gate} outbox=${snapshot.packets.outbox} pending=${snapshot.packets.pending} incidents=${snapshot.incidents}`;
  const lines = [
    border("top", safeWidth, " topology ", theme),
    fit(color(theme, "accent", header), safeWidth),
    fit(color(theme, snapshot.gate === "owner" ? "warning" : "dim", meta), safeWidth),
  ];
  for (const entry of snapshot.roles.filter((role) => role.records > 0 || role.alive === true || role.state !== "not_spawned")) {
    const session = entry.session_id ? abbreviate(entry.session_id, 18) : "-";
    const pct = entry.context_used_pct;
    const bar = contextBar(pct, entry.color, theme);
    const dot = iconForAlive(entry.alive, entry.state, theme, entry.color);
    const state = color(theme, colorForState(entry.state, entry.alive), stateLabel(entry.state, entry.alive).padEnd(7));
    const name = hexFg(entry.color, entry.role.padEnd(20));
    const pctText = color(theme, pctColor(pct), (pct == null ? "--%" : `${pct}%`).padStart(4));
    const records = color(theme, "dim", `r${String(entry.records).padStart(2)}`);
    const row = ` ${dot} ${name} ${state} ${bar} ${pctText} ${records} ${color(theme, "dim", session)}`;
    lines.push(fit(row, safeWidth));
  }
  const inboxSummary = Object.entries(snapshot.packets.inboxes)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, count]) => `${name.replace(/-inbox$/, "")}=${count}`)
    .join(" ");
  if (inboxSummary) lines.push(fit(color(theme, "muted", `inbox ${inboxSummary}`), safeWidth));
  lines.push(border("bottom", safeWidth, "", theme));
  return lines;
}

type ThemeLike = {
  fg?: (name: string, value: string) => string;
};

function readJson<T>(file: string): T | null {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function readJsonl<T extends Record<string, unknown>>(file: string): T[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as T;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is T => Boolean(entry));
}

function countJsonl(file: string): number {
  return readJsonl(file).length;
}

function countRecordsByRole(records: Array<Record<string, unknown>>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const record of records) {
    const role = String(record.role ?? "");
    if (!role) continue;
    counts[role] = (counts[role] ?? 0) + 1;
  }
  return counts;
}

function latestSessionRecord(records: Array<Record<string, unknown>>, role: string, state: string): Record<string, unknown> | null {
  return [...records].reverse().find((record) => record.role === role && record.state === state) ?? null;
}

function readPacketCounts(packetRoot: string, board?: StatusBoard | null): TopologyUiSnapshot["packets"] {
  const inboxes: Record<string, number> = {};
  const pending = board ? activePendingPackets(board.pending_packets).length : 0;
  if (!existsSync(packetRoot)) return { outbox: 0, inboxes, pending };
  let outbox = 0;
  try {
    for (const file of readdirSync(packetRoot)) {
      const full = path.join(packetRoot, file);
      if (!file.endsWith(".jsonl") || !statSync(full).isFile()) continue;
      const count = countJsonl(full);
      if (file === "outbox.jsonl") outbox = count;
      if (file.endsWith("-inbox.jsonl")) inboxes[file.replace(".jsonl", "")] = count;
    }
  } catch {
    return { outbox, inboxes, pending };
  }
  return { outbox, inboxes, pending };
}

function stateLabel(state: string, alive: boolean | null): string {
  if (alive === true) return "live";
  if (state === "launch_requested") return "launch";
  if (state === "launch_printed") return "printed";
  if (state === "script_written") return "script";
  if (state === "not_spawned") return "idle";
  return state;
}

function aliveLabel(alive: boolean | null): string {
  if (alive === true) return "yes";
  if (alive === false) return "no";
  return "?";
}

function statusIcon(entry: { alive: boolean | null; state: string }): string {
  if (entry.alive === true) return "●";
  if (entry.state === "launch_requested" || entry.state === "stale") return "◌";
  if (entry.alive === false || entry.state === "blocked") return "✗";
  return "○";
}

function iconForAlive(alive: boolean | null, state: string, theme: ThemeLike | undefined, roleColor: string): string {
  if (alive === true) return hexFg(roleColor, "●");
  if (state === "launch_requested") return color(theme, "warning", "◌");
  if (state === "stale") return color(theme, "warning", "◌");
  if (alive === false || state === "blocked") return color(theme, "error", "✗");
  return color(theme, "dim", "○");
}

function colorForState(state: string, alive: boolean | null): string {
  if (alive === true) return "success";
  if (state === "launch_requested") return "warning";
  if (state === "stale") return "warning";
  if (alive === false || state === "blocked") return "error";
  return "dim";
}

function pctColor(pct: number | null): string {
  if (pct == null) return "dim";
  if (pct >= 85) return "error";
  if (pct >= 70) return "warning";
  return "accent";
}

function contextTiny(pct: number | null): string {
  if (pct == null) return "";
  return `${pct}%`;
}

function contextBar(pct: number | null, roleColor: string, theme: ThemeLike | undefined): string {
  const slots = 12;
  if (pct == null) return color(theme, "dim", `[${"-".repeat(slots)}]`);
  const filled = Math.max(0, Math.min(slots, Math.round((pct / 100) * slots)));
  const empty = slots - filled;
  return color(theme, "warning", "[") + hexFg(roleColor, "#".repeat(filled)) + color(theme, "dim", "-".repeat(empty)) + color(theme, "warning", "]");
}

function color(theme: ThemeLike | undefined, name: string, value: string): string {
  try {
    return theme?.fg?.(name, value) ?? value;
  } catch {
    return value;
  }
}

function hexFg(hex: string, value: string): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return value;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `\x1b[38;2;${r};${g};${b}m${value}\x1b[39m`;
}

function colorForRole(role: TopologyRole): string {
  switch (role) {
    case "topology-supervisor":
      return "#72F1B8";
    case "hq":
      return "#36F9F6";
    case "runner":
      return "#FEDE5D";
    case "oracle":
      return "#C792EA";
    case "repair":
      return "#FF8B39";
    case "librarian":
      return "#4D9DE0";
    case "scott":
      return "#FF7EDB";
  }
}

function shortRole(role: string): string {
  switch (role) {
    case "topology-supervisor":
      return "sup";
    case "librarian":
      return "lib";
    default:
      return role;
  }
}

function abbreviate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}~`;
}

function border(kind: "top" | "bottom", width: number, label = "", theme?: ThemeLike): string {
  if (width < 4) return "-".repeat(width);
  if (kind === "top" && label) {
    const prefix = `┏━${label}`;
    const suffix = "┓";
    return color(theme, "dim", `${prefix}${"━".repeat(Math.max(0, width - visiblePlainWidth(prefix) - visiblePlainWidth(suffix)))}${suffix}`);
  }
  return color(theme, "dim", `┗${"━".repeat(width - 2)}┛`);
}

function fit(value: string, width: number): string {
  if (visiblePlainWidth(value) <= width) return value;
  return `${stripAnsi(value).slice(0, Math.max(0, width - 1))}~`;
}

function visiblePlainWidth(value: string): number {
  return stripAnsi(value).length;
}

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}
