export type TopologyRole = "topology-supervisor" | "hq" | "repair" | "runner" | "oracle" | "librarian" | "scott";
export type WorkerRole = Exclude<TopologyRole, "topology-supervisor">;

export interface MissionCard {
  mission_id: string;
  runtime: "pi";
  entry_role: "topology-supervisor";
  project: string;
  workdir: string;
  objective: string;
  progress: MissionProgress;
  mode: "dynamic-spawn";
  roles: Record<TopologyRole, RolePolicy>;
  allowed_paths: string[];
  forbidden_actions: string[];
  checkpoint_interval_minutes: number;
  watchdog_interval_minutes: number;
  stop_conditions: string[];
  status_board_path: string;
  incident_log_path: string;
  event_log_path: string;
  session_ledger_path: string;
  owner_gate_required_for: string[];
}

export interface MissionProgress {
  status: "draft" | "awaiting_owner_confirmation" | "supervisor_ready" | "running" | "blocked" | "completed" | "abandoned";
  percent: number;
  current_step: string;
  completed_steps: string[];
  pending_steps: string[];
  updated_at: string;
  source: "manual" | "session_context";
  source_entry_id?: string;
  completion_summary?: string;
}

export interface RolePolicy {
  spawn_policy: "entry" | "required_after_mission_approval" | "on_demand";
  write_policy: "no_business_code_writes" | "allowed_paths_only" | "read_only";
  report_target: "owner" | "topology-supervisor" | "hq";
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export interface MissionDraftInput {
  project: string;
  workdir: string;
  objective: string;
  allowed_paths: string[];
  forbidden_actions?: string[];
  source?: MissionProgress["source"];
  source_entry_id?: string;
}

export interface PeerStatus {
  state: "entry" | "not_spawned" | "launch_requested" | "alive" | "stale" | "blocked";
  session_id: string | null;
  alive: boolean | null;
  context_used_pct: number | null;
  last_heartbeat_at: string | null;
  last_packet_at: string | null;
}

export interface StatusBoard {
  mission_id: string;
  runtime: "pi";
  runtime_phase: "intake" | "approved" | "spawning" | "running" | "blocked" | "complete";
  project: string;
  workdir: string;
  owner_goal: string;
  active_slice: unknown | null;
  owner_decisions: unknown[];
  peer_status: Record<TopologyRole, PeerStatus>;
  pending_packets: Array<Record<string, unknown>>;
  active_workers: Array<Record<string, unknown>>;
  allowed_paths: string[];
  forbidden_actions: string[];
  next_gate: {
    type: string;
    owner_required: boolean;
    reason: string;
    created_at: string | null;
  };
  last_checkpoint_at: string | null;
  next_checkpoint_due_at: string | null;
  context_health: {
    high_watermark_pct: number;
    roles_over_high_watermark: string[];
  };
  incidents: unknown[];
  evidence_index: {
    transport: unknown[];
    business: unknown[];
    inference: unknown[];
  };
  future_ui: {
    event_log_path: string;
    graph_nodes: unknown[];
    graph_edges: unknown[];
  };
}

export interface WatchdogFinding {
  type: string;
  detail: string;
}

export interface WatchdogResult {
  mission_id: string;
  phase: string;
  now: string;
  findings: WatchdogFinding[];
  incident_count: number;
  summary_status: "ok" | "attention_required";
}

export const TOPOLOGY_ROLES: TopologyRole[] = ["topology-supervisor", "hq", "repair", "runner", "oracle", "librarian", "scott"];

export function createMissionDraft(input: MissionDraftInput): MissionCard {
  const slug = slugify(input.project || "topology");
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  return {
    mission_id: `${slug}-${today}-001`,
    runtime: "pi",
    entry_role: "topology-supervisor",
    project: input.project,
    workdir: input.workdir,
    objective: input.objective,
    progress: {
      status: "awaiting_owner_confirmation",
      percent: 5,
      current_step: "Mission drafted; waiting for owner confirmation before Supervisor starts.",
      completed_steps: ["mission_drafted"],
      pending_steps: ["owner_confirm_mission", "start_topology_supervisor", "spawn_hq_after_owner_gate", "execute_and_verify", "owner_closeout"],
      updated_at: now,
      source: input.source ?? "manual",
      ...(input.source_entry_id ? { source_entry_id: input.source_entry_id } : {}),
    },
    mode: "dynamic-spawn",
    roles: {
      "topology-supervisor": {
        spawn_policy: "entry",
        write_policy: "no_business_code_writes",
        report_target: "owner",
      },
      hq: {
        spawn_policy: "required_after_mission_approval",
        write_policy: "no_business_code_writes",
        report_target: "topology-supervisor",
      },
      repair: {
        spawn_policy: "on_demand",
        write_policy: "allowed_paths_only",
        report_target: "hq",
      },
      runner: {
        spawn_policy: "on_demand",
        write_policy: "read_only",
        report_target: "hq",
      },
      oracle: {
        spawn_policy: "on_demand",
        write_policy: "read_only",
        report_target: "hq",
      },
      librarian: {
        spawn_policy: "on_demand",
        write_policy: "read_only",
        report_target: "hq",
      },
      scott: {
        spawn_policy: "on_demand",
        write_policy: "read_only",
        report_target: "hq",
      },
    },
    allowed_paths: [...input.allowed_paths],
    forbidden_actions: input.forbidden_actions ?? [
      "git add",
      "git commit",
      "git push",
      "git reset --hard",
      "git clean -fd",
      "rm -rf",
      "write outside allowed_paths",
      "cross-role permission transfer",
    ],
    checkpoint_interval_minutes: 30,
    watchdog_interval_minutes: 10,
    stop_conditions: [
      "owner gate pending",
      "scope violation",
      "role boundary violation",
      "damage-control hard block",
      "peer registry unavailable",
      "context over high watermark without summary",
      "HQ missing two consecutive checkpoints",
    ],
    status_board_path: ".pi/topology/status-board.json",
    incident_log_path: ".pi/topology/incident-log.jsonl",
    event_log_path: ".pi/topology/runtime-events.jsonl",
    session_ledger_path: ".pi/topology/sessions.jsonl",
    owner_gate_required_for: [
      "scope expansion",
      "destructive command",
      "git add",
      "git commit",
      "git push",
      "runtime decision ambiguity",
    ],
  };
}

export function validateMissionCard(input: unknown): ValidationResult {
  const errors: string[] = [];
  if (!input || typeof input !== "object") {
    return { ok: false, errors: ["mission card must be an object"] };
  }
  const card = input as Partial<MissionCard>;
  if (!card.mission_id) errors.push("mission_id is required");
  if (card.runtime !== "pi") errors.push("runtime must be pi");
  if (card.entry_role !== "topology-supervisor") errors.push("entry_role must be topology-supervisor");
  if (!card.project) errors.push("project is required");
  if (!card.workdir) errors.push("workdir is required");
  if (!card.objective) errors.push("objective is required");
  if (typeof card.progress !== "object" || card.progress === null) {
    errors.push("progress is required");
  } else {
    if (!card.progress.status) errors.push("progress.status is required");
    if (typeof card.progress.percent !== "number") errors.push("progress.percent must be a number");
    if (!card.progress.current_step) errors.push("progress.current_step is required");
    if (!Array.isArray(card.progress.completed_steps)) errors.push("progress.completed_steps must be an array");
    if (!Array.isArray(card.progress.pending_steps)) errors.push("progress.pending_steps must be an array");
  }
  if (card.mode !== "dynamic-spawn") errors.push("mode must be dynamic-spawn");
  if (!Array.isArray(card.allowed_paths) || card.allowed_paths.length === 0) {
    errors.push("allowed_paths must be a non-empty array");
  }
  if (!Array.isArray(card.forbidden_actions)) errors.push("forbidden_actions must be an array");
  if (!Array.isArray(card.stop_conditions)) errors.push("stop_conditions must be an array");
  if (!card.session_ledger_path) errors.push("session_ledger_path is required");
  if (typeof card.checkpoint_interval_minutes !== "number") {
    errors.push("checkpoint_interval_minutes must be a number");
  }
  if (typeof card.watchdog_interval_minutes !== "number") {
    errors.push("watchdog_interval_minutes must be a number");
  }
  return { ok: errors.length === 0, errors };
}

export function normalizeMissionCard(input: MissionCard): { mission: MissionCard; changed: boolean } {
  let changed = false;
  const mission = { ...input };
  const now = new Date().toISOString();
  if (!mission.progress) {
    mission.progress = {
      status: "awaiting_owner_confirmation",
      percent: 5,
      current_step: "Mission migrated; waiting for owner confirmation before Supervisor starts.",
      completed_steps: ["mission_migrated"],
      pending_steps: ["owner_confirm_mission", "start_topology_supervisor", "spawn_hq_after_owner_gate", "execute_and_verify", "owner_closeout"],
      updated_at: now,
      source: "manual",
    };
    changed = true;
  }
  if (!mission.session_ledger_path) {
    mission.session_ledger_path = ".pi/topology/sessions.jsonl";
    changed = true;
  }
  return { mission, changed };
}

export function createInitialStatusBoard(mission: MissionCard): StatusBoard {
  const peer_status = {} as Record<TopologyRole, PeerStatus>;
  for (const role of TOPOLOGY_ROLES) {
    peer_status[role] = {
      state: role === "topology-supervisor" ? "entry" : "not_spawned",
      session_id: null,
      alive: null,
      context_used_pct: null,
      last_heartbeat_at: null,
      last_packet_at: null,
    };
  }

  return {
    mission_id: mission.mission_id,
    runtime: "pi",
    runtime_phase: "intake",
    project: mission.project,
    workdir: mission.workdir,
    owner_goal: mission.objective,
    active_slice: null,
    owner_decisions: [],
    peer_status,
    pending_packets: [],
    active_workers: [],
    allowed_paths: [...mission.allowed_paths],
    forbidden_actions: [...mission.forbidden_actions],
    next_gate: {
      type: "mission_approval",
      owner_required: true,
      reason: "Owner must approve mission card before dynamic spawn.",
      created_at: null,
    },
    last_checkpoint_at: null,
    next_checkpoint_due_at: null,
    context_health: {
      high_watermark_pct: 80,
      roles_over_high_watermark: [],
    },
    incidents: [],
    evidence_index: {
      transport: [],
      business: [],
      inference: [],
    },
    future_ui: {
      event_log_path: mission.event_log_path,
      graph_nodes: TOPOLOGY_ROLES.map((role) => ({ id: role, role })),
      graph_edges: [],
    },
  };
}

export function runWatchdogCheck(board: StatusBoard, incidents: unknown[], now = new Date()): WatchdogResult {
  const findings: WatchdogFinding[] = [];

  if (!board.last_checkpoint_at) {
    findings.push({ type: "checkpoint_missing", detail: "last_checkpoint_at is empty" });
  }
  if (board.next_gate?.owner_required) {
    findings.push({ type: "owner_gate", detail: board.next_gate.reason || board.next_gate.type });
  }
  for (const packet of board.pending_packets.filter((packet) => {
    const state = String(packet.state ?? "");
    if (["closed", "report_acknowledged", "ignored", "stale"].includes(state)) return false;
    const type = String(packet.type ?? "");
    return type === "REQUEST" || type === "REPORT" || type === "INCIDENT";
  })) {
    const due = String(packet.deadline_at ?? packet.sla_due_at ?? "");
    if (due && Date.parse(due) < now.getTime()) {
      findings.push({ type: "packet_overdue", detail: String(packet.packet_id ?? packet.msg_id ?? "unknown packet") });
    }
  }
  for (const [role, state] of Object.entries(board.peer_status)) {
    if (state.alive === false) findings.push({ type: "peer_not_alive", detail: role });
    if (typeof state.context_used_pct === "number" && state.context_used_pct >= board.context_health.high_watermark_pct) {
      findings.push({ type: "context_high", detail: `${role} at ${state.context_used_pct}%` });
    }
  }

  return {
    mission_id: board.mission_id,
    phase: board.runtime_phase,
    now: now.toISOString(),
    findings,
    incident_count: incidents.length,
    summary_status: findings.length > 0 ? "attention_required" : "ok",
  };
}

function slugify(value: string): string {
  const ascii = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return ascii || "topology";
}
