import { randomUUID } from "node:crypto";
import { TOPOLOGY_ROLES, type TopologyRole } from "./mission.ts";

const TOPOLOGY_ROLE_SET = new Set<TopologyRole>(TOPOLOGY_ROLES);

export type PacketType = "ACK" | "STATUS" | "REPORT" | "REQUEST" | "INCIDENT" | "VERDICT";

export interface TopologyPacket {
  packet_id: string;
  mission_id: string;
  type: PacketType;
  from: TopologyRole;
  to: TopologyRole | "owner";
  body: Record<string, unknown>;
  timestamp: string;
  correlation_id?: string;
  request_msg_id?: string;
  hops: number;
  max_hops: number;
  audit: {
    transport_evidence: unknown[];
    business_evidence: unknown[];
    inference: unknown[];
  };
}

export function createPacket(input: {
  mission_id: string;
  type: PacketType;
  from: TopologyRole;
  to: TopologyRole | "owner";
  body: Record<string, unknown>;
  correlation_id?: string;
  request_msg_id?: string;
  max_hops?: number;
}): TopologyPacket {
  return {
    packet_id: `pkt_${randomUUID()}`,
    mission_id: input.mission_id,
    type: input.type,
    from: input.from,
    to: input.to,
    body: input.body,
    timestamp: new Date().toISOString(),
    correlation_id: input.correlation_id,
    request_msg_id: input.request_msg_id,
    hops: 0,
    max_hops: input.max_hops ?? 5,
    audit: {
      transport_evidence: [],
      business_evidence: [],
      inference: [],
    },
  };
}

export function validatePacket(input: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!input || typeof input !== "object") return { ok: false, errors: ["packet must be an object"] };
  const packet = input as Partial<TopologyPacket>;
  if (!packet.packet_id || typeof packet.packet_id !== "string") errors.push("packet_id is required");
  if (!packet.mission_id || typeof packet.mission_id !== "string") errors.push("mission_id is required");
  if (!packet.type) errors.push("type is required");
  if (!packet.from || !TOPOLOGY_ROLE_SET.has(packet.from as TopologyRole)) errors.push("from must be a topology role");
  if (!packet.to || (packet.to !== "owner" && !TOPOLOGY_ROLE_SET.has(packet.to as TopologyRole))) errors.push("to must be a topology role or owner");
  if (!packet.body || typeof packet.body !== "object" || Array.isArray(packet.body)) {
    errors.push("body must be an object");
  } else if (Object.keys(packet.body).length === 0) {
    errors.push("body must not be empty");
  }
  if (typeof packet.timestamp !== "string") errors.push("timestamp is required");
  if (typeof packet.hops !== "number" || Number.isNaN(packet.hops) || !Number.isInteger(packet.hops) || packet.hops < 0) {
    errors.push("hops must be a non-negative integer");
  }
  if (typeof packet.max_hops !== "number" || Number.isNaN(packet.max_hops) || !Number.isInteger(packet.max_hops) || packet.max_hops <= 0) {
    errors.push("max_hops must be a positive integer");
  }
  if (!packet.audit || typeof packet.audit !== "object") {
    errors.push("audit is required");
  } else {
    if (!Array.isArray(packet.audit.transport_evidence)) errors.push("audit.transport_evidence must be an array");
    if (!Array.isArray(packet.audit.business_evidence)) errors.push("audit.business_evidence must be an array");
    if (!Array.isArray(packet.audit.inference)) errors.push("audit.inference must be an array");
  }
  if (typeof packet.hops === "number" && typeof packet.max_hops === "number" && packet.hops > packet.max_hops) {
    errors.push("hops exceeds max_hops");
  }
  return { ok: errors.length === 0, errors };
}

export function assertDirectReplyAllowed(text: string): { ok: true } | { ok: false; reason: string } {
  const trimmed = text.trim();
  if (/^(ACK|BLOCKED|NEEDS_CLARIFICATION)(\b|:|$)/.test(trimmed) && trimmed.length <= 240) return { ok: true };
  return { ok: false, reason: "business_report_must_use_packet" };
}
