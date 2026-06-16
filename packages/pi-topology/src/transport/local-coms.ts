import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { TopologyPacket } from "../runtime/packet.ts";
import { validatePacket } from "../runtime/packet.ts";
import { TOPOLOGY_ROLES, type TopologyRole } from "../runtime/mission.ts";
import { deliverLiveTopologyPacket, type LiveDeliveryResult } from "./live-coms.ts";

export function outboxPath(root: string, project: string): string {
  return path.join(root, "projects", project, "packets", "outbox.jsonl");
}

function inboxPath(root: string, project: string, to: TopologyRole | "owner"): string {
  return path.join(root, "projects", project, "packets", `${to}-inbox.jsonl`);
}

interface PacketRecord {
  packet_id: string;
  payload: TopologyPacket;
}

function normalizeRecipient(value: string | undefined): TopologyRole | "owner" {
  if (value === "owner" || TOPOLOGY_ROLES.includes(value as TopologyRole)) {
    return value;
  }
  throw new Error(`invalid recipient ${String(value)}`);
}

async function appendPacket(file: string, packet: TopologyPacket | PacketRecord): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify(packet)}\n`, "utf8");
}

export async function appendOutboundPacket(root: string, project: string, packet: TopologyPacket): Promise<void> {
  const file = outboxPath(root, project);
  await appendPacket(file, packet);
}

export async function readOutboundPackets(root: string, project: string): Promise<Record<string, unknown>[]> {
  try {
    const raw = await readFile(outboxPath(root, project), "utf8");
    return raw.split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
  } catch {
    return [];
  }
}

async function readPackets(file: string): Promise<TopologyPacket[]> {
  try {
    const raw = await readFile(file, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    return lines
      .map((line): TopologyPacket | undefined => {
        const parsed = JSON.parse(line) as TopologyPacket | PacketRecord;
        if (parsed && typeof parsed === "object") {
          if ((parsed as PacketRecord).packet_id && (parsed as PacketRecord).payload) {
            return (parsed as PacketRecord).payload;
          }
          return parsed as TopologyPacket;
        }
        return undefined;
      })
      .filter((packet): packet is TopologyPacket => Boolean(packet));
  } catch {
    return [];
  }
}

export interface PacketSendResult {
  packet: TopologyPacket;
  status: "queued";
  target: TopologyRole | "owner";
  live_delivery?: LiveDeliveryResult;
}

export interface PacketGetResult {
  status: "pending" | "complete";
  packet?: TopologyPacket;
}

export interface PacketAwaitFilter {
  mission_id?: string;
  from?: TopologyRole;
  type?: TopologyPacket["type"];
  request_msg_id?: string;
  after_timestamp?: string;
}

export interface PacketAwaitOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export interface PacketAwaitResult {
  status: "complete" | "timeout";
  packets: TopologyPacket[];
  elapsed_ms: number;
}

export async function topology_send(
  root: string,
  project: string,
  packet: TopologyPacket,
): Promise<PacketSendResult> {
  const validation = validatePacket(packet);
  if (!validation.ok) {
    throw new Error(`invalid packet: ${validation.errors.join("; ")}`);
  }
  if (packet.hops >= packet.max_hops) {
    throw new Error(`hop limit reached (${packet.hops} >= ${packet.max_hops})`);
  }
  const target = normalizeRecipient(packet.to);
  const normalizedPacket: TopologyPacket = {
    ...packet,
    to: target,
  };
  await appendOutboundPacket(root, project, normalizedPacket);
  await appendPacket(inboxPath(root, project, target), normalizedPacket);
  const liveDelivery = await deliverLiveTopologyPacket(root, project, normalizedPacket);
  return { packet: normalizedPacket, status: "queued", target, live_delivery: liveDelivery };
}

export async function topology_list(root: string, project: string, to: TopologyRole | "owner"): Promise<TopologyPacket[]> {
  const normalizedTo = normalizeRecipient(to);
  return readPackets(inboxPath(root, project, normalizedTo));
}

export async function topology_get(
  root: string,
  project: string,
  to: TopologyRole | "owner",
  packetId: string,
): Promise<PacketGetResult> {
  const normalizedTo = normalizeRecipient(to);
  const inbox = await readPackets(inboxPath(root, project, normalizedTo));
  const found = inbox.find((packet) => packet.packet_id === packetId);
  if (!found) {
    return { status: "pending" };
  }
  return { status: "complete", packet: found };
}

export async function topology_await(
  root: string,
  project: string,
  to: TopologyRole | "owner",
  filter: PacketAwaitFilter = {},
  options: PacketAwaitOptions = {},
): Promise<PacketAwaitResult> {
  const started = Date.now();
  const timeoutMs = Math.max(0, Math.min(options.timeoutMs ?? 120_000, 300_000));
  const pollIntervalMs = Math.max(10, Math.min(options.pollIntervalMs ?? 1_000, 10_000));
  while (Date.now() - started <= timeoutMs) {
    const matches = filterPackets(await topology_list(root, project, to), filter);
    if (matches.length > 0) {
      return { status: "complete", packets: matches, elapsed_ms: Date.now() - started };
    }
    await sleep(Math.min(pollIntervalMs, Math.max(0, timeoutMs - (Date.now() - started))));
  }
  return { status: "timeout", packets: [], elapsed_ms: Date.now() - started };
}

export const topologySend = topology_send;
export const topologyGet = topology_get;
export const topologyList = topology_list;
export const topologyAwait = topology_await;

function filterPackets(packets: TopologyPacket[], filter: PacketAwaitFilter): TopologyPacket[] {
  const after = filter.after_timestamp ? Date.parse(filter.after_timestamp) : null;
  return packets.filter((packet) => {
    if (filter.mission_id && packet.mission_id !== filter.mission_id) return false;
    if (filter.from && packet.from !== filter.from) return false;
    if (filter.type && packet.type !== filter.type) return false;
    if (filter.request_msg_id && packet.request_msg_id !== filter.request_msg_id && packet.body?.reply_to !== filter.request_msg_id) return false;
    if (after !== null && !Number.isNaN(after)) {
      const timestamp = Date.parse(packet.timestamp);
      if (Number.isNaN(timestamp) || timestamp <= after) return false;
    }
    return true;
  });
}
