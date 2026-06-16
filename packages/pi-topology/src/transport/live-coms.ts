import { existsSync, unlinkSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import type { TopologyPacket } from "../runtime/packet.ts";
import type { TopologyRole } from "../runtime/mission.ts";
import { readPeerRegistry, writePeerRegistry } from "./registry.ts";

const LINE_CAP_BYTES = 2_000_000;
const SEND_TIMEOUT_MS = 15_000;
const memoryHandlers = new Map<string, (packet: TopologyPacket) => void | Promise<void>>();

export type LiveDeliveryStatus = "delivered" | "offline" | "unreachable" | "skipped";

export interface LiveDeliveryResult {
  status: LiveDeliveryStatus;
  endpoint?: string;
  error?: string;
}

export interface LiveTopologyEndpoint {
  role: TopologyRole;
  session_id: string;
  endpoint: string;
  close: () => Promise<void>;
}

interface PacketEnvelope {
  type: "topology_packet";
  msg_id: string;
  packet: TopologyPacket;
}

export async function startLiveTopologyEndpoint(options: {
  root: string;
  project: string;
  role: TopologyRole;
  sessionId: string;
  contextUsedPct?: number;
  mode?: "socket" | "memory";
  onPacket: (packet: TopologyPacket) => void | Promise<void>;
}): Promise<LiveTopologyEndpoint> {
  if (options.mode === "memory") {
    const endpoint = `memory://${options.project}/${options.sessionId}`;
    memoryHandlers.set(endpoint, options.onPacket);
    await writePeerRegistry(options.root, options.project, {
      name: options.role,
      role: options.role,
      session_id: options.sessionId,
      endpoint,
      heartbeat_at: new Date().toISOString(),
      context_used_pct: options.contextUsedPct ?? 0,
    });
    return {
      role: options.role,
      session_id: options.sessionId,
      endpoint,
      close: async () => {
        memoryHandlers.delete(endpoint);
      },
    };
  }

  const endpoint = makeEndpoint(options.root, options.project, options.sessionId);
  if (process.platform !== "win32") {
    await mkdir(path.dirname(endpoint), { recursive: true });
    try { unlinkSync(endpoint); } catch { /* stale or absent socket */ }
  }

  const server = await new Promise<net.Server>((resolve, reject) => {
    const srv = net.createServer((socket) => handleSocket(socket, options.onPacket));
    srv.once("error", reject);
    srv.listen(endpoint, () => {
      srv.off("error", reject);
      resolve(srv);
    });
  });
  try { server.unref(); } catch { /* best effort */ }

  await writePeerRegistry(options.root, options.project, {
    name: options.role,
    role: options.role,
    session_id: options.sessionId,
    endpoint,
    heartbeat_at: new Date().toISOString(),
    context_used_pct: options.contextUsedPct ?? 0,
  });

  return {
    role: options.role,
    session_id: options.sessionId,
    endpoint,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (process.platform !== "win32" && existsSync(endpoint)) {
        try { unlinkSync(endpoint); } catch { /* best effort */ }
      }
    },
  };
}

export async function deliverLiveTopologyPacket(root: string, project: string, packet: TopologyPacket): Promise<LiveDeliveryResult> {
  if (packet.to === "owner") return { status: "skipped" };
  const peers = await readPeerRegistry(root, project);
  const target = Object.values(peers).find((entry) => entry.role === packet.to || entry.name === packet.to);
  if (!target?.endpoint) return { status: "offline" };
  if (target.endpoint.startsWith("memory://")) {
    const handler = memoryHandlers.get(target.endpoint);
    if (!handler) return { status: "unreachable", endpoint: target.endpoint, error: "memory endpoint missing" };
    try {
      await handler(packet);
      return { status: "delivered", endpoint: target.endpoint };
    } catch (error) {
      return {
        status: "unreachable",
        endpoint: target.endpoint,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  try {
    await sendEnvelope(target.endpoint, {
      type: "topology_packet",
      msg_id: packet.packet_id,
      packet,
    });
    return { status: "delivered", endpoint: target.endpoint };
  } catch (error) {
    return {
      status: "unreachable",
      endpoint: target.endpoint,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function handleSocket(socket: net.Socket, onPacket: (packet: TopologyPacket) => void | Promise<void>): void {
  let buf = "";
  let handled = false;
  const onData = (chunk: Buffer) => {
    if (handled) return;
    buf += chunk.toString("utf8");
    if (buf.length > LINE_CAP_BYTES) {
      nack(socket, "", "oversized envelope");
      handled = true;
      return;
    }
    const nl = buf.indexOf("\n");
    if (nl < 0) return;
    handled = true;
    socket.removeListener("data", onData);
    let parsed: PacketEnvelope;
    try {
      parsed = JSON.parse(buf.slice(0, nl)) as PacketEnvelope;
    } catch {
      nack(socket, "", "malformed envelope");
      return;
    }
    if (!parsed || parsed.type !== "topology_packet" || typeof parsed.msg_id !== "string" || !parsed.packet) {
      nack(socket, "", "malformed topology packet envelope");
      return;
    }
    Promise.resolve(onPacket(parsed.packet))
      .then(() => ack(socket, parsed.msg_id))
      .catch((error) => nack(socket, parsed.msg_id, error instanceof Error ? error.message : String(error)));
  };
  socket.on("data", onData);
  socket.once("error", () => {
    try { socket.destroy(); } catch { /* ignore */ }
  });
}

function sendEnvelope(endpoint: string, envelope: PacketEnvelope): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint);
    let buf = "";
    let settled = false;
    const timeout = setTimeout(() => {
      finish(new Error("timeout"));
    }, SEND_TIMEOUT_MS);
    try { timeout.unref?.(); } catch { /* best effort */ }

    function finish(error?: Error): void {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try { socket.end(); } catch { /* ignore */ }
      if (error) reject(error);
      else resolve();
    }

    socket.on("connect", () => {
      socket.write(`${JSON.stringify(envelope)}\n`);
    });
    socket.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      if (buf.length > LINE_CAP_BYTES) {
        finish(new Error("oversized response"));
        return;
      }
      const nl = buf.indexOf("\n");
      if (nl < 0) return;
      let parsed: { type?: string; error?: string };
      try {
        parsed = JSON.parse(buf.slice(0, nl)) as { type?: string; error?: string };
      } catch {
        finish(new Error("malformed response"));
        return;
      }
      if (parsed.type === "nack") finish(new Error(parsed.error || "nack"));
      else finish();
    });
    socket.on("error", (error) => finish(error));
  });
}

function ack(socket: net.Socket, msg_id: string): void {
  try { socket.write(`${JSON.stringify({ type: "ack", msg_id })}\n`); } catch { /* ignore */ }
  try { socket.end(); } catch { /* ignore */ }
}

function nack(socket: net.Socket, msg_id: string, error: string): void {
  try { socket.write(`${JSON.stringify({ type: "nack", msg_id, error })}\n`); } catch { /* ignore */ }
  try { socket.end(); } catch { /* ignore */ }
}

function makeEndpoint(root: string, project: string, sessionId: string): string {
  const safeSession = sessionId.replace(/[^a-zA-Z0-9_.-]/g, "-");
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\pi-topology-${project}-${safeSession}`;
  }
  return path.join(root, "projects", project, "sockets", `${safeSession}.sock`);
}
