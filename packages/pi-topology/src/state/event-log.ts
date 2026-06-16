import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { mkdir, appendFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function appendEvent(path: string, event: Record<string, unknown>): Promise<Record<string, unknown>> {
  const entry = {
    event_id: event.event_id ?? `evt_${randomUUID()}`,
    timestamp: event.timestamp ?? new Date().toISOString(),
    severity: event.severity ?? "info",
    ...event,
  };
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(entry)}\n`, "utf8");
  return entry;
}

export function appendEventSync(path: string, event: Record<string, unknown>): Record<string, unknown> {
  const entry = {
    event_id: event.event_id ?? `evt_${randomUUID()}`,
    timestamp: event.timestamp ?? new Date().toISOString(),
    severity: event.severity ?? "info",
    ...event,
  };
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(entry)}\n`, "utf8");
  return entry;
}
