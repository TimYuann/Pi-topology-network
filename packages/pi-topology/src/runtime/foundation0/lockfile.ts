import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, readFile, stat, unlink } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname } from "node:path";
import { fsyncDirectory, writeDurableFile } from "./durable-fs.ts";
import { validateId, validateTimestamp } from "./ids.ts";

export type Foundation0LockPurpose =
  | "mission_event_append"
  | "cleanup_attempt_acquisition"
  | "resource_creation_plan";

export interface Foundation0LockMetadata {
  schema_version: 1;
  lock_id: string;
  mission_id: string;
  purpose: Foundation0LockPurpose;
  holder_pid: number;
  holder_process_start_tuple?: {
    start_time_seconds: number;
    start_time_microseconds: number;
  };
  holder_executable?: string;
  holder_nonce: string;
  hostname: string;
  created_at: string;
}

export interface LockOptions {
  lockId: string;
  missionId: string;
  purpose: Foundation0LockPurpose;
  timeoutMs: number;
  retryDelayMs?: number;
  staleMs?: number;
  holderProbe?: Foundation0HolderProbe;
  onStaleLockIncident?: (incident: Foundation0StaleLockIncident) => void;
}

export interface AcquiredLock {
  lockPath: string;
  metadata: Foundation0LockMetadata;
  release(): Promise<void>;
}

export type Foundation0HolderProbeResult =
  | { status: "present_matching" }
  | { status: "absent_verified" }
  | { status: "start_tuple_mismatch_verified" }
  | { status: "permission_denied" }
  | { status: "ambiguous" }
  | { status: "unsupported_platform" };

export type Foundation0HolderProbe = (
  metadata: Foundation0LockMetadata,
) => Promise<Foundation0HolderProbeResult>;

export interface Foundation0StaleLockIncident {
  lockPath: string;
  metadata: Foundation0LockMetadata;
  reason: "absent_verified" | "start_tuple_mismatch_verified";
}

export type LockMetadata = Foundation0LockMetadata;

export class LockTimeoutError extends Error {
  readonly lockPath: string;
  readonly lockId: string;

  constructor(lockPath: string, lockId: string, timeoutMs: number) {
    super(`Timed out acquiring lock ${lockPath} for ${lockId} after ${timeoutMs}ms`);
    this.name = "LockTimeoutError";
    this.lockPath = lockPath;
    this.lockId = lockId;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeRetryDelay(options: LockOptions): number {
  return Math.max(1, options.retryDelayMs ?? 10);
}

function isLockPurpose(value: unknown): value is Foundation0LockPurpose {
  return value === "mission_event_append" ||
    value === "cleanup_attempt_acquisition" ||
    value === "resource_creation_plan";
}

export async function readLockMetadata(lockPath: string): Promise<Foundation0LockMetadata | null> {
  try {
    const raw = await readFile(lockPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<Foundation0LockMetadata>;
    if (
      parsed.schema_version !== 1 ||
      typeof parsed.lock_id !== "string" ||
      typeof parsed.mission_id !== "string" ||
      !isLockPurpose(parsed.purpose) ||
      typeof parsed.holder_pid !== "number" ||
      !Number.isSafeInteger(parsed.holder_pid) ||
      parsed.holder_pid <= 0 ||
      (parsed.holder_process_start_tuple !== undefined &&
        (!Number.isSafeInteger(parsed.holder_process_start_tuple.start_time_seconds) ||
          parsed.holder_process_start_tuple.start_time_seconds < 0 ||
          !Number.isSafeInteger(parsed.holder_process_start_tuple.start_time_microseconds) ||
          parsed.holder_process_start_tuple.start_time_microseconds < 0)) ||
      (parsed.holder_executable !== undefined && typeof parsed.holder_executable !== "string") ||
      typeof parsed.holder_nonce !== "string" ||
      typeof parsed.hostname !== "string" ||
      typeof parsed.created_at !== "string"
    ) {
      return null;
    }
    const lock_id = validateId(parsed.lock_id, "Foundation0LockMetadata.lock_id");
    const mission_id = validateId(parsed.mission_id, "Foundation0LockMetadata.mission_id");
    const created_at = validateTimestamp(
      parsed.created_at,
      "Foundation0LockMetadata.created_at",
    );
    return {
      schema_version: 1,
      lock_id,
      mission_id,
      purpose: parsed.purpose,
      holder_pid: parsed.holder_pid,
      holder_process_start_tuple: parsed.holder_process_start_tuple,
      holder_executable: parsed.holder_executable,
      holder_nonce: parsed.holder_nonce,
      hostname: parsed.hostname,
      created_at,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    if (error instanceof SyntaxError) return null;
    if ((error as Error).name === "Foundation0ValidationError") return null;
    throw error;
  }
}

async function tryCreateLock(lockPath: string, metadata: Foundation0LockMetadata): Promise<boolean> {
  await mkdir(dirname(lockPath), { recursive: true });
  try {
    await writeDurableFile(
      lockPath,
      `${JSON.stringify(metadata)}\n`,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
    );
    await fsyncDirectory(dirname(lockPath));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

function isStale(metadata: Foundation0LockMetadata | null, mtimeMs: number, staleMs: number): boolean {
  const createdAtMs = metadata === null ? Number.NaN : Date.parse(metadata.created_at);
  const timestampMs = Number.isFinite(createdAtMs) ? createdAtMs : mtimeMs;
  return Date.now() - timestampMs > staleMs;
}

async function removeStaleLockIfStillSame(
  lockPath: string,
  expected: { metadata: Foundation0LockMetadata; mtimeMs: number; size: number },
): Promise<void> {
  let currentStat;
  try {
    currentStat = await stat(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }

  if (currentStat.mtimeMs !== expected.mtimeMs || currentStat.size !== expected.size) {
    return;
  }

  const currentMetadata = await readLockMetadata(lockPath);
  if (currentMetadata?.holder_nonce !== expected.metadata.holder_nonce) return;
  await unlink(lockPath);
}

async function cleanupStaleLock(
  lockPath: string,
  staleMs: number,
  options: LockOptions,
): Promise<void> {
  let lockStat;
  try {
    lockStat = await stat(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }

  const metadata = await readLockMetadata(lockPath);
  if (!isStale(metadata, lockStat.mtimeMs, staleMs)) return;
  if (metadata === null) return;
  if (metadata.hostname !== hostname()) return;
  if (options.holderProbe === undefined) return;

  const probe = await options.holderProbe(metadata);
  if (
    probe.status === "permission_denied" ||
    probe.status === "ambiguous" ||
    probe.status === "unsupported_platform" ||
    probe.status === "present_matching"
  ) {
    return;
  }
  if (metadata.holder_process_start_tuple === undefined) return;
  const reason = probe.status;
  options.onStaleLockIncident?.({ lockPath, metadata, reason });
  await removeStaleLockIfStillSame(lockPath, {
    metadata,
    mtimeMs: lockStat.mtimeMs,
    size: lockStat.size,
  });
}

export async function releaseLock(lockPath: string, metadata: Foundation0LockMetadata): Promise<void> {
  const current = await readLockMetadata(lockPath);
  if (current?.holder_nonce !== metadata.holder_nonce) return;
  try {
    await unlink(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}

export async function acquireLock(lockPath: string, options: LockOptions): Promise<AcquiredLock> {
  const retryDelayMs = normalizeRetryDelay(options);
  const startedAt = Date.now();
  const metadata: Foundation0LockMetadata = {
    schema_version: 1,
    lock_id: options.lockId,
    mission_id: options.missionId,
    purpose: options.purpose,
    holder_pid: process.pid,
    holder_nonce: randomUUID(),
    hostname: hostname(),
    created_at: new Date().toISOString(),
  };

  while (Date.now() - startedAt <= options.timeoutMs) {
    if (await tryCreateLock(lockPath, metadata)) {
      return {
        lockPath,
        metadata,
        release: () => releaseLock(lockPath, metadata),
      };
    }
    if (options.staleMs !== undefined) {
      await cleanupStaleLock(lockPath, options.staleMs, options);
    }
    await sleep(retryDelayMs);
  }

  throw new LockTimeoutError(lockPath, options.lockId, options.timeoutMs);
}

export async function withLock<T>(
  lockPath: string,
  options: LockOptions,
  fn: () => Promise<T>,
): Promise<T> {
  const lock = await acquireLock(lockPath, options);
  try {
    return await fn();
  } finally {
    await lock.release();
  }
}
