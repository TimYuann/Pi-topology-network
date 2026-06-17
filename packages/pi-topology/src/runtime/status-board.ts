export {
  createInitialStatusBoard,
  type PeerStatus,
  type StatusBoard,
  type TopologyRole,
} from "./mission.ts";

import type { MissionCard, StatusBoard, TopologyRole } from "./mission.ts";
import type { PacketType, TopologyPacket } from "./packet.ts";
import type { LiveDeliveryStatus } from "../transport/live-coms.ts";
import type { PeerRegistryEntry } from "../transport/registry.ts";

export type PacketLifecycleState =
  | "queued"
  | "delivered"
  | "acknowledged"
  | "in_progress"
  | "reported"
  | "report_acknowledged"
  | "closed";

export interface PacketLifecycleRecord {
  packet_id: string;
  type: PacketType;
  from: TopologyRole;
  to: TopologyRole | "owner";
  state: PacketLifecycleState;
  request_msg_id?: string;
  correlation_id?: string;
  transport_state?: LiveDeliveryStatus;
  sent_at: string;
  delivered_at?: string;
  acknowledged_at?: string;
  ack_packet_id?: string;
  status_packet_id?: string;
  in_progress_at?: string;
  report_packet_id?: string;
  reported_at?: string;
  report_acknowledged_at?: string;
  closed_at?: string;
}

export function markRoleLaunchRequested(board: StatusBoard, mission: MissionCard, params: {
  role: TopologyRole;
  scriptPath: string;
  logPath?: string;
  now?: string;
}): StatusBoard {
  const now = params.now ?? new Date().toISOString();
  const next = cloneBoard(board);
  next.runtime_phase = "spawning";
  if (params.role === "hq" && next.next_gate?.owner_required) {
    next.runtime_phase = "approved";
    next.next_gate = {
      type: "none",
      owner_required: false,
      reason: "Mission approved; HQ launch command issued.",
      created_at: now,
    };
    next.owner_decisions = [
      ...next.owner_decisions,
      {
        decision: "mission_approved",
        role: "topology-supervisor",
        at: now,
        evidence: "topology_spawn_role(role=hq, mode=launch)",
      },
    ];
  }
  next.peer_status[params.role] = {
    ...(next.peer_status[params.role] ?? {
      state: "not_spawned",
      session_id: null,
      alive: null,
      context_used_pct: null,
      last_heartbeat_at: null,
      last_packet_at: null,
    }),
    state: "launch_requested",
    alive: null,
  };
  next.active_workers = upsertActiveWorker(next.active_workers, {
    role: params.role,
    state: "launch_requested",
    session_id: null,
    script_path: params.scriptPath,
    log_path: params.logPath,
    requested_at: now,
  });
  next.last_checkpoint_at = now;
  next.evidence_index.transport = [
    ...next.evidence_index.transport,
    {
      type: "launch_command_issued",
      role: params.role,
      script_path: params.scriptPath,
      at: now,
      inference: "not proof that the terminal executed the role or that the role is alive",
    },
  ];
  next.allowed_paths = [...mission.allowed_paths];
  next.forbidden_actions = [...mission.forbidden_actions];
  return next;
}

export function markRoleAlive(board: StatusBoard, params: {
  role: TopologyRole;
  sessionId: string;
  now?: string;
}): StatusBoard {
  const now = params.now ?? new Date().toISOString();
  const next = cloneBoard(board);
  markStalePeersOnRoleStart(next, now, params.role);
  if (next.runtime_phase === "intake" && params.role !== "topology-supervisor") next.runtime_phase = "running";
  next.peer_status[params.role] = {
    ...(next.peer_status[params.role] ?? {
      state: "not_spawned",
      session_id: null,
      alive: null,
      context_used_pct: null,
      last_heartbeat_at: null,
      last_packet_at: null,
    }),
    state: params.role === "topology-supervisor" ? "entry" : "alive",
    session_id: params.sessionId,
    alive: true,
    last_heartbeat_at: now,
  };
  next.active_workers = upsertActiveWorker(next.active_workers, {
    role: params.role,
    state: params.role === "topology-supervisor" ? "entry" : "alive",
    session_id: params.sessionId,
    alive_at: now,
  });
  next.last_checkpoint_at = now;
  return next;
}

export function reconcileBoardWithSessionRecords(board: StatusBoard, records: Array<Record<string, unknown>>): StatusBoard {
  let next = cloneBoard(board);
  const latestByRole = new Map<string, Record<string, unknown>>();
  for (const record of records) {
    if (record.state !== "alive_confirmed" || typeof record.role !== "string" || typeof record.session_id !== "string") continue;
    const previous = latestByRole.get(record.role);
    if (!previous || String(previous.timestamp ?? "").localeCompare(String(record.timestamp ?? "")) <= 0) {
      latestByRole.set(record.role, record);
    }
  }
  const aliveRecords = [...latestByRole.values()]
    .sort((a, b) => String(a.timestamp ?? "").localeCompare(String(b.timestamp ?? "")));
  for (const record of aliveRecords) {
    const current = next.peer_status[record.role as TopologyRole];
    if (current?.state === "stale" && current.session_id === String(record.session_id)) continue;
    const currentHeartbeat = current?.last_heartbeat_at ? Date.parse(current.last_heartbeat_at) : Number.NaN;
    const recordHeartbeat = typeof record.timestamp === "string" ? Date.parse(record.timestamp) : Number.NaN;
    if (!Number.isNaN(currentHeartbeat) && !Number.isNaN(recordHeartbeat) && currentHeartbeat > recordHeartbeat) continue;
    next = markRoleAlive(next, {
      role: record.role as TopologyRole,
      sessionId: String(record.session_id),
      now: typeof record.timestamp === "string" ? record.timestamp : undefined,
    });
  }
  return next;
}

export function reconcileBoardWithLiveRegistry(board: StatusBoard, peers: Record<string, PeerRegistryEntry>, now = new Date().toISOString()): StatusBoard {
  const next = cloneBoard(board);
  for (const [role, status] of Object.entries(next.peer_status) as Array<[TopologyRole, StatusBoard["peer_status"][TopologyRole]]>) {
    const peer = peers[role];
    if (peer) {
      next.peer_status[role] = {
        ...status,
        state: role === "topology-supervisor" ? "entry" : "alive",
        session_id: peer.session_id,
        alive: true,
        context_used_pct: peer.context_used_pct,
        last_heartbeat_at: peer.heartbeat_at,
      };
      continue;
    }
    if (status.alive === true) {
      next.peer_status[role] = {
        ...status,
        state: "stale",
        alive: false,
      };
      next.active_workers = upsertActiveWorker(next.active_workers, {
        role,
        state: "stale",
        session_id: status.session_id,
        stale_at: now,
      });
    }
  }
  return next;
}

export function markMissionProgressForHqLaunch(mission: MissionCard, now = new Date().toISOString()): MissionCard {
  return {
    ...mission,
    progress: {
      ...mission.progress,
      status: "running",
      percent: Math.max(mission.progress.percent, 15),
      current_step: "Owner approved mission; HQ launch command issued; waiting for alive confirmation.",
      completed_steps: unique([...mission.progress.completed_steps, "owner_confirm_mission", "start_topology_supervisor", "spawn_hq_after_owner_gate"]),
      pending_steps: mission.progress.pending_steps.filter((step) => !["owner_confirm_mission", "start_topology_supervisor", "spawn_hq_after_owner_gate"].includes(step)),
      updated_at: now,
    },
  };
}

export function applyPacketLifecycle(board: StatusBoard, packet: TopologyPacket, params: {
  liveDeliveryStatus?: LiveDeliveryStatus;
  now?: string;
} = {}): StatusBoard {
  const now = params.now ?? packet.timestamp ?? new Date().toISOString();
  const next = cloneBoard(board);
  touchPacketPeers(next, packet, now);
  next.pending_packets = next.pending_packets.map((record) => ({ ...record }));

  if (packet.type === "ACK" && packet.request_msg_id) {
    markPacketAcknowledged(next, packet, now);
    appendPacketEvidence(next, packet, "acknowledged");
    return next;
  }

  if (packet.type === "STATUS" && packet.request_msg_id) {
    markPacketInProgress(next, packet, now);
    appendPacketEvidence(next, packet, "sent");
    return next;
  }

  if (packet.type === "REPORT" && packet.request_msg_id) {
    markPacketReported(next, packet, now);
  }

  if (packet.type !== "ACK" && shouldTrackAsPending(packet)) {
    upsertPacketRecord(next, createLifecycleRecord(packet, params.liveDeliveryStatus, now));
  }
  appendPacketEvidence(next, packet, "sent");
  return next;
}

export function activePendingPackets(pendingPackets: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return pendingPackets.filter((packet) => {
    const state = String(packet.state ?? "");
    if (["closed", "report_acknowledged", "ignored", "stale"].includes(state)) return false;
    const type = String(packet.type ?? "");
    return type === "REQUEST" || type === "REPORT" || type === "INCIDENT";
  });
}

function shouldTrackAsPending(packet: TopologyPacket): boolean {
  return packet.type === "REQUEST" || packet.type === "REPORT" || packet.type === "INCIDENT";
}

function cloneBoard(board: StatusBoard): StatusBoard {
  return JSON.parse(JSON.stringify(board)) as StatusBoard;
}

function createLifecycleRecord(packet: TopologyPacket, liveDeliveryStatus: LiveDeliveryStatus | undefined, now: string): PacketLifecycleRecord {
  const delivered = liveDeliveryStatus === "delivered";
  const base: PacketLifecycleRecord = {
    packet_id: packet.packet_id,
    type: packet.type,
    from: packet.from,
    to: packet.to,
    state: packet.type === "REPORT" ? "reported" : delivered ? "delivered" : "queued",
    sent_at: now,
    transport_state: liveDeliveryStatus,
    ...(packet.request_msg_id ? { request_msg_id: packet.request_msg_id } : {}),
    ...(packet.correlation_id ? { correlation_id: packet.correlation_id } : {}),
    ...(delivered ? { delivered_at: now } : {}),
    ...(packet.type === "REPORT" ? { reported_at: now } : {}),
  };
  return base;
}

function markPacketAcknowledged(board: StatusBoard, ackPacket: TopologyPacket, now: string): void {
  const ackedPacketId = ackPacket.request_msg_id;
  const acked = board.pending_packets.find((record) => record.packet_id === ackedPacketId) as PacketLifecycleRecord | undefined;
  if (!acked) return;
  acked.ack_packet_id = ackPacket.packet_id;
  acked.acknowledged_at = now;
  if (acked.type === "REPORT") {
    acked.state = "report_acknowledged";
    acked.report_acknowledged_at = now;
    acked.closed_at = now;
    const original = board.pending_packets.find((record) => record.report_packet_id === acked.packet_id) as PacketLifecycleRecord | undefined;
    if (original) {
      original.state = "closed";
      original.report_acknowledged_at = now;
      original.closed_at = now;
    }
    board.pending_packets = board.pending_packets.filter((record) => record.packet_id !== acked.packet_id && record.packet_id !== original?.packet_id);
    return;
  }
  acked.state = "acknowledged";
}

function markPacketInProgress(board: StatusBoard, statusPacket: TopologyPacket, now: string): void {
  const record = board.pending_packets.find((item) => item.packet_id === statusPacket.request_msg_id) as PacketLifecycleRecord | undefined;
  if (!record) return;
  record.state = "in_progress";
  record.status_packet_id = statusPacket.packet_id;
  record.in_progress_at = now;
}

function markPacketReported(board: StatusBoard, reportPacket: TopologyPacket, now: string): void {
  const record = board.pending_packets.find((item) => item.packet_id === reportPacket.request_msg_id) as PacketLifecycleRecord | undefined;
  if (!record) return;
  record.state = "reported";
  record.report_packet_id = reportPacket.packet_id;
  record.reported_at = now;
}

function upsertPacketRecord(board: StatusBoard, record: PacketLifecycleRecord): void {
  const rest = board.pending_packets.filter((item) => item.packet_id !== record.packet_id);
  board.pending_packets = [...rest, record];
}

function touchPacketPeers(board: StatusBoard, packet: TopologyPacket, now: string): void {
  for (const role of [packet.from, packet.to]) {
    if (role === "owner") continue;
    const existing = board.peer_status[role];
    if (!existing) continue;
    board.peer_status[role] = {
      ...existing,
      last_packet_at: now,
    };
  }
  board.last_checkpoint_at = now;
}

function appendPacketEvidence(board: StatusBoard, packet: TopologyPacket, lifecycle: string): void {
  board.evidence_index.transport = [
    ...board.evidence_index.transport,
    {
      type: "packet_lifecycle",
      lifecycle,
      packet_id: packet.packet_id,
      packet_type: packet.type,
      from: packet.from,
      to: packet.to,
      request_msg_id: packet.request_msg_id,
      at: packet.timestamp,
    },
  ];
}

function upsertActiveWorker(workers: Array<Record<string, unknown>>, update: Record<string, unknown>): Array<Record<string, unknown>> {
  const role = update.role;
  const rest = workers.filter((worker) => worker.role !== role);
  const previous = workers.find((worker) => worker.role === role) ?? {};
  return [...rest, { ...previous, ...update }];
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function markStalePeersOnRoleStart(board: StatusBoard, now: string, currentRole: TopologyRole): void {
  const nowMs = Date.parse(now);
  if (Number.isNaN(nowMs)) return;
  const staleAfterMs = 120_000;
  for (const [role, status] of Object.entries(board.peer_status) as Array<[TopologyRole, StatusBoard["peer_status"][TopologyRole]]>) {
    if (role === currentRole) continue;
    if (status.alive !== true) continue;
    const heartbeatMs = status.last_heartbeat_at ? Date.parse(status.last_heartbeat_at) : Number.NaN;
    if (!Number.isNaN(heartbeatMs) && nowMs - heartbeatMs < staleAfterMs) continue;
    board.peer_status[role] = {
      ...status,
      state: "stale",
      alive: false,
    };
    board.active_workers = upsertActiveWorker(board.active_workers, {
      role,
      state: "stale",
      session_id: status.session_id,
      stale_at: now,
    });
  }
}
