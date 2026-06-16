import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { TopologyRole } from "../runtime/mission.ts";

export type SessionRecordState = "script_written" | "launch_requested" | "launch_printed" | "alive_confirmed" | "closed" | "failed";

export interface SessionLedgerRecord {
  record_id?: string;
  timestamp?: string;
  mission_id: string;
  project: string;
  role: TopologyRole;
  state: SessionRecordState;
  session_id: string | null;
  script_path: string;
  launch_command?: string;
  log_path?: string;
  terminal_app?: string;
  provider?: string;
  model?: string;
  thinking?: string;
  evidence?: {
    transport: unknown[];
    business: unknown[];
    inference: unknown[];
  };
}

export async function appendSessionRecord(path: string, record: SessionLedgerRecord): Promise<Required<Pick<SessionLedgerRecord, "record_id" | "timestamp">> & SessionLedgerRecord> {
  const entry = materializeSessionRecord(record);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(entry)}\n`, "utf8");
  return entry;
}

export function appendSessionRecordSync(path: string, record: SessionLedgerRecord): Required<Pick<SessionLedgerRecord, "record_id" | "timestamp">> & SessionLedgerRecord {
  const entry = materializeSessionRecord(record);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(entry)}\n`, "utf8");
  return entry;
}

function materializeSessionRecord(record: SessionLedgerRecord): Required<Pick<SessionLedgerRecord, "record_id" | "timestamp">> & SessionLedgerRecord {
  return {
    record_id: record.record_id ?? `sess_${randomUUID()}`,
    timestamp: record.timestamp ?? new Date().toISOString(),
    ...record,
  };
}
