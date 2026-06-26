import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  canonicalizeForDigest,
  computeSha256Digest,
} from "./ids.ts";
import {
  type Event,
  type EventCausedByEntityType,
  type EventEntityType,
  type EventType,
} from "./schema.ts";
import { validateEvent } from "./validation.ts";
import { withLock } from "./lockfile.ts";

export interface Foundation0StoragePaths {
  rootDir: string;
  eventLogPath: string;
  payloadsDir: string;
  locksDir: string;
  missionEventsLockPath: string;
}

export interface AppendFoundation0EventInput {
  missionDir: string;
  missionId: string;
  eventType: EventType;
  entityType: EventEntityType;
  entityId: string;
  payload: unknown;
  idempotencyKey?: string;
  payloadDigestHint?: string;
  lockId?: string;
  lockTimeoutMs?: number;
  lockRetryDelayMs?: number;
  lockStaleMs?: number;
  principalId?: string;
  actorId?: string;
  actionId?: string;
  actionAttemptId?: string;
  policyDecisionId?: string;
  causedBy?: {
    entity_type: EventCausedByEntityType;
    entity_id: string;
  };
}

export class PartialEventLogError extends Error {
  readonly eventLogPath: string;

  constructor(eventLogPath: string, message = "Foundation-0 event log has a partial trailing row") {
    super(`${message}: ${eventLogPath}`);
    this.name = "PartialEventLogError";
    this.eventLogPath = eventLogPath;
  }
}

export class MissingPayloadError extends Error {
  readonly payloadPath: string;

  constructor(payloadPath: string) {
    super(`Foundation-0 event payload is missing: ${payloadPath}`);
    this.name = "MissingPayloadError";
    this.payloadPath = payloadPath;
  }
}

export class PayloadDigestMismatchError extends Error {
  readonly payloadPath: string;

  constructor(payloadPath: string) {
    super(`Foundation-0 event payload digest mismatch: ${payloadPath}`);
    this.name = "PayloadDigestMismatchError";
    this.payloadPath = payloadPath;
  }
}

export class SequenceInvariantError extends Error {
  readonly eventLogPath: string;

  constructor(eventLogPath: string, message: string) {
    super(`Foundation-0 event sequence invariant failed: ${message}: ${eventLogPath}`);
    this.name = "SequenceInvariantError";
    this.eventLogPath = eventLogPath;
  }
}

export function foundation0StoragePaths(missionDir: string): Foundation0StoragePaths {
  const rootDir = join(missionDir, "foundation0");
  const payloadsDir = join(rootDir, "payloads");
  const locksDir = join(rootDir, "locks");
  return {
    rootDir,
    eventLogPath: join(rootDir, "runtime-events.jsonl"),
    payloadsDir,
    locksDir,
    missionEventsLockPath: join(locksDir, "mission-events.lock"),
  };
}

function idempotentEventId(missionId: string, idempotencyKey: string): string {
  const hex = createHash("sha256")
    .update(canonicalizeForDigest({ idempotency_key: idempotencyKey, mission_id: missionId }))
    .digest("hex")
    .slice(0, 32);
  return `evt_${hex}`;
}

function sequencedEventId(sequence: number): string {
  return `evt_seq_${String(sequence).padStart(12, "0")}`;
}

async function writeDurableFile(path: string, content: string, flags: string | number): Promise<void> {
  let handle;
  try {
    handle = await open(path, flags, 0o600);
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle?.close();
  }
}

async function unlinkIfExists(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}

async function readPayloadIfExists(payloadPath: string): Promise<string | null> {
  try {
    return await readFile(payloadPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function writePayloadTempFile(paths: Foundation0StoragePaths, digest: string, canonical: string): Promise<string> {
  const tempPath = join(paths.payloadsDir, `.${digest}.${randomUUID()}.tmp`);
  await writeDurableFile(tempPath, canonical, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
  return tempPath;
}

async function ensurePayloadFile(
  paths: Foundation0StoragePaths,
  payload: unknown,
  referencedPayloadDigests: ReadonlySet<string>,
): Promise<string> {
  const digest = computeSha256Digest(payload);
  const payloadPath = join(paths.payloadsDir, `${digest}.json`);
  const canonical = `${canonicalizeForDigest(payload)}\n`;
  await mkdir(paths.payloadsDir, { recursive: true });

  const tempPath = await writePayloadTempFile(paths, digest, canonical);
  try {
    const existing = await readPayloadIfExists(payloadPath);
    if (existing === canonical) {
      await unlinkIfExists(tempPath);
      return digest;
    }
    if (existing !== null && referencedPayloadDigests.has(digest)) {
      throw new PayloadDigestMismatchError(payloadPath);
    }
    await rename(tempPath, payloadPath);
  } catch (error) {
    await unlinkIfExists(tempPath);
    throw error;
  }
  return digest;
}

async function appendDurableEventRow(eventLogPath: string, event: Event): Promise<void> {
  await mkdir(dirname(eventLogPath), { recursive: true });
  await writeDurableFile(eventLogPath, `${JSON.stringify(event)}\n`, constants.O_CREAT | constants.O_APPEND | constants.O_WRONLY);
}

function parseEventRow(row: string, eventLogPath: string): Event {
  try {
    return validateEvent(JSON.parse(row));
  } catch (error) {
    throw new PartialEventLogError(
      eventLogPath,
      `Foundation-0 event log contains an invalid row (${(error as Error).message})`,
    );
  }
}

export async function readFoundation0Events(missionDir: string): Promise<Event[]> {
  const paths = foundation0StoragePaths(missionDir);
  let raw: string;
  try {
    raw = await readFile(paths.eventLogPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  if (raw.length === 0) return [];
  if (!raw.endsWith("\n")) {
    throw new PartialEventLogError(paths.eventLogPath);
  }
  const events = raw
    .slice(0, -1)
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => parseEventRow(line, paths.eventLogPath));
  validateSequenceInvariants(events, paths.eventLogPath);
  return events;
}

function validateSequenceInvariants(events: Event[], eventLogPath: string): void {
  for (const [index, event] of events.entries()) {
    if (event.sequence !== index) {
      throw new SequenceInvariantError(
        eventLogPath,
        `row ${index} has sequence ${event.sequence}, expected ${index}`,
      );
    }
  }
}

function nextSequence(events: Event[]): number {
  return events.length;
}

export async function appendFoundation0Event(input: AppendFoundation0EventInput): Promise<Event> {
  const paths = foundation0StoragePaths(input.missionDir);
  return withLock(
    paths.missionEventsLockPath,
    {
      lockId: input.lockId ?? input.idempotencyKey ?? "foundation0_event_append",
      timeoutMs: input.lockTimeoutMs ?? 5_000,
      retryDelayMs: input.lockRetryDelayMs ?? 10,
      staleMs: input.lockStaleMs ?? 60_000,
    },
    async () => {
      const events = await readFoundation0Events(input.missionDir);
      const eventId =
        input.idempotencyKey === undefined
          ? sequencedEventId(nextSequence(events))
          : idempotentEventId(input.missionId, input.idempotencyKey);
      const existing = events.find((event) => event.event_id === eventId);
      if (existing !== undefined) return existing;

      const referencedPayloadDigests = new Set(events.map((event) => event.payload_digest));
      const payloadDigest = await ensurePayloadFile(paths, input.payload, referencedPayloadDigests);
      const event = validateEvent({
        schema_version: 1,
        event_id: eventId,
        mission_id: input.missionId,
        sequence: nextSequence(events),
        event_type: input.eventType,
        principal_id: input.principalId,
        actor_id: input.actorId,
        action_id: input.actionId,
        action_attempt_id: input.actionAttemptId,
        policy_decision_id: input.policyDecisionId,
        entity_type: input.entityType,
        entity_id: input.entityId,
        caused_by: input.causedBy,
        payload_ref: `foundation0/payloads/${payloadDigest}.json`,
        payload_digest: payloadDigest,
        created_at: new Date().toISOString(),
      });

      await appendDurableEventRow(paths.eventLogPath, event);
      return event;
    },
  );
}

export async function verifyFoundation0EventPayloads(missionDir: string): Promise<Event[]> {
  const paths = foundation0StoragePaths(missionDir);
  const events = await readFoundation0Events(missionDir);
  for (const event of events) {
    const payloadPath = join(paths.payloadsDir, `${event.payload_digest}.json`);
    let raw: string;
    try {
      raw = await readFile(payloadPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new MissingPayloadError(payloadPath);
      }
      throw error;
    }
    const parsed = JSON.parse(raw);
    const canonical = `${canonicalizeForDigest(parsed)}\n`;
    if (raw !== canonical || computeSha256Digest(parsed) !== event.payload_digest) {
      throw new PayloadDigestMismatchError(payloadPath);
    }
  }
  return events;
}
