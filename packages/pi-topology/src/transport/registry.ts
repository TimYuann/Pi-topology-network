import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { TopologyRole } from "../runtime/mission.ts";

export interface PeerRegistryEntry {
  name: string;
  role: TopologyRole;
  session_id: string;
  endpoint: string;
  heartbeat_at: string;
  context_used_pct: number;
}

const DEFAULT_STALE_AFTER_MS = 20_000;

export function peerRegistryPath(root: string, project: string, name: string): string {
  return path.join(root, "projects", project, "agents", `${name}.json`);
}

export async function writePeerRegistry(root: string, project: string, entry: PeerRegistryEntry): Promise<void> {
  const finalPath = peerRegistryPath(root, project, entry.name);
  await mkdir(path.dirname(finalPath), { recursive: true });
  const tmp = `${finalPath}.tmp`;
  await writeFile(tmp, `${JSON.stringify(entry, null, 2)}\n`, "utf8");
  await rename(tmp, finalPath);
}

export async function readPeerRegistry(root: string, project: string): Promise<Record<string, PeerRegistryEntry>> {
  const dir = path.join(root, "projects", project, "agents");
  const result: Record<string, PeerRegistryEntry> = {};
  let files: string[] = [];
  try {
    files = await readdir(dir);
  } catch {
    return result;
  }
  for (const file of files.filter((item) => item.endsWith(".json"))) {
    const raw = await readFile(path.join(dir, file), "utf8");
    const entry = JSON.parse(raw) as PeerRegistryEntry;
    result[entry.name] = entry;
  }
  return result;
}

export function readPeerRegistrySync(root: string, project: string): Record<string, PeerRegistryEntry> {
  const dir = path.join(root, "projects", project, "agents");
  const result: Record<string, PeerRegistryEntry> = {};
  let files: string[] = [];
  try {
    files = readdirSync(dir);
  } catch {
    return result;
  }
  for (const file of files.filter((item) => item.endsWith(".json"))) {
    try {
      const raw = readFileSync(path.join(dir, file), "utf8");
      const entry = JSON.parse(raw) as PeerRegistryEntry;
      result[entry.name] = entry;
    } catch {
      // ignore malformed peer registry entry
    }
  }
  return result;
}

export function isPeerRegistryFresh(entry: PeerRegistryEntry, nowMs = Date.now(), staleAfterMs = DEFAULT_STALE_AFTER_MS): boolean {
  const heartbeatMs = Date.parse(entry.heartbeat_at);
  if (Number.isNaN(heartbeatMs)) return false;
  return nowMs - heartbeatMs <= staleAfterMs;
}

export function readFreshPeerRegistrySync(root: string, project: string, staleAfterMs = DEFAULT_STALE_AFTER_MS): Record<string, PeerRegistryEntry> {
  const all = readPeerRegistrySync(root, project);
  const nowMs = Date.now();
  return Object.fromEntries(
    Object.entries(all).filter(([, entry]) => isPeerRegistryFresh(entry, nowMs, staleAfterMs)),
  );
}

export async function refreshPeerRegistryHeartbeat(root: string, project: string, entry: PeerRegistryEntry): Promise<void> {
  await writePeerRegistry(root, project, {
    ...entry,
    heartbeat_at: new Date().toISOString(),
  });
}

export async function removePeerRegistry(root: string, project: string, name: string): Promise<void> {
  await rm(peerRegistryPath(root, project, name), { force: true });
}
