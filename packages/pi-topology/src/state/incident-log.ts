import { randomUUID } from "node:crypto";
import { mkdir, appendFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function appendIncident(path: string, incident: Record<string, unknown>): Promise<Record<string, unknown>> {
  const entry = {
    incident_id: incident.incident_id ?? `inc_${randomUUID()}`,
    timestamp: incident.timestamp ?? new Date().toISOString(),
    severity: incident.severity ?? "warn",
    ...incident,
  };
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(entry)}\n`, "utf8");
  return entry;
}
