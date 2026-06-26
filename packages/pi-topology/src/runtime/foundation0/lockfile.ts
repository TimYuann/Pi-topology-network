import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, readFile, stat, unlink } from "node:fs/promises";
import { dirname } from "node:path";

export interface LockMetadata {
  holder_id: string;
  lock_id: string;
  pid: number;
  created_at: string;
}

export interface LockOptions {
  lockId: string;
  timeoutMs: number;
  retryDelayMs?: number;
  staleMs?: number;
}

export interface AcquiredLock {
  lockPath: string;
  metadata: LockMetadata;
  release(): Promise<void>;
}

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

export async function readLockMetadata(lockPath: string): Promise<LockMetadata | null> {
  try {
    const raw = await readFile(lockPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<LockMetadata>;
    if (
      typeof parsed.holder_id !== "string" ||
      typeof parsed.lock_id !== "string" ||
      typeof parsed.pid !== "number" ||
      typeof parsed.created_at !== "string"
    ) {
      return null;
    }
    return {
      holder_id: parsed.holder_id,
      lock_id: parsed.lock_id,
      pid: parsed.pid,
      created_at: parsed.created_at,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

async function tryCreateLock(lockPath: string, metadata: LockMetadata): Promise<boolean> {
  await mkdir(dirname(lockPath), { recursive: true });
  let handle;
  try {
    handle = await open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    await handle.writeFile(`${JSON.stringify(metadata)}\n`, "utf8");
    await handle.sync();
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  } finally {
    await handle?.close();
  }
}

function isStale(metadata: LockMetadata | null, mtimeMs: number, staleMs: number): boolean {
  const createdAtMs = metadata === null ? Number.NaN : Date.parse(metadata.created_at);
  const timestampMs = Number.isFinite(createdAtMs) ? createdAtMs : mtimeMs;
  return Date.now() - timestampMs > staleMs;
}

async function removeStaleLockIfStillSame(
  lockPath: string,
  expected: { metadata: LockMetadata | null; mtimeMs: number; size: number },
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
  if (currentMetadata?.holder_id !== expected.metadata?.holder_id) return;
  await unlink(lockPath);
}

async function cleanupStaleLock(lockPath: string, staleMs: number): Promise<void> {
  let lockStat;
  try {
    lockStat = await stat(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }

  const metadata = await readLockMetadata(lockPath);
  if (!isStale(metadata, lockStat.mtimeMs, staleMs)) return;
  await removeStaleLockIfStillSame(lockPath, {
    metadata,
    mtimeMs: lockStat.mtimeMs,
    size: lockStat.size,
  });
}

export async function releaseLock(lockPath: string, metadata: LockMetadata): Promise<void> {
  const current = await readLockMetadata(lockPath);
  if (current?.holder_id !== metadata.holder_id) return;
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
  const metadata: LockMetadata = {
    holder_id: randomUUID(),
    lock_id: options.lockId,
    pid: process.pid,
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
      await cleanupStaleLock(lockPath, options.staleMs);
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
