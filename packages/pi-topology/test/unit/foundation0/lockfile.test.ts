import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, unlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  LockTimeoutError,
  acquireLock,
  readLockMetadata,
  withLock,
} from "../../../src/runtime/foundation0/lockfile.ts";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "foundation0-lock-"));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("withLock serializes concurrent critical sections", async () => {
  const dir = await tempDir();
  try {
    const lockPath = join(dir, "mission-events.lock");
    let active = 0;
    let maxActive = 0;
    const visits: number[] = [];

    await Promise.all(
      Array.from({ length: 8 }, async (_, i) =>
        withLock(
          lockPath,
          { lockId: `worker_${i}`, timeoutMs: 1000, retryDelayMs: 1, staleMs: 10_000 },
          async () => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            await sleep(4);
            visits.push(i);
            active -= 1;
          },
        ),
      ),
    );

    assert.equal(maxActive, 1);
    assert.equal(visits.length, 8);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("acquireLock timeout is recognizable and leaves another holder in place", async () => {
  const dir = await tempDir();
  try {
    const lockPath = join(dir, "mission-events.lock");
    const held = await acquireLock(lockPath, {
      lockId: "held",
      timeoutMs: 100,
      retryDelayMs: 1,
      staleMs: 10_000,
    });

    await assert.rejects(
      () =>
        acquireLock(lockPath, {
          lockId: "waiter",
          timeoutMs: 25,
          retryDelayMs: 5,
          staleMs: 10_000,
        }),
      (error) =>
        error instanceof LockTimeoutError &&
        error.lockPath === lockPath &&
        error.lockId === "waiter",
    );

    const metadata = await readLockMetadata(lockPath);
    assert.equal(metadata?.holder_id, held.metadata.holder_id);
    await held.release();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("release is idempotent and does not remove another holder lock", async () => {
  const dir = await tempDir();
  try {
    const lockPath = join(dir, "mission-events.lock");
    const first = await acquireLock(lockPath, {
      lockId: "first",
      timeoutMs: 100,
      retryDelayMs: 1,
      staleMs: 10_000,
    });
    await unlink(lockPath);

    const second = await acquireLock(lockPath, {
      lockId: "second",
      timeoutMs: 100,
      retryDelayMs: 1,
      staleMs: 10_000,
    });

    await first.release();
    await first.release();

    const metadata = await readLockMetadata(lockPath);
    assert.equal(metadata?.holder_id, second.metadata.holder_id);
    assert.equal(metadata?.lock_id, "second");
    await second.release();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("stale lock cleanup is bounded and safe", async () => {
  const dir = await tempDir();
  try {
    const lockPath = join(dir, "mission-events.lock");
    const old = new Date(Date.now() - 60_000);
    await writeFile(
      lockPath,
      JSON.stringify({
        holder_id: "stale_holder",
        lock_id: "stale",
        pid: 999999,
        created_at: old.toISOString(),
      }),
      "utf8",
    );
    await utimes(lockPath, old, old);

    const acquired = await acquireLock(lockPath, {
      lockId: "fresh",
      timeoutMs: 100,
      retryDelayMs: 1,
      staleMs: 10,
    });

    assert.equal((await readLockMetadata(lockPath))?.holder_id, acquired.metadata.holder_id);
    await acquired.release();

    const freshCreatedAt = new Date().toISOString();
    await writeFile(
      lockPath,
      JSON.stringify({
        holder_id: "recent_holder",
        lock_id: "recent",
        pid: process.pid,
        created_at: freshCreatedAt,
      }),
      "utf8",
    );

    await assert.rejects(
      () =>
        acquireLock(lockPath, {
          lockId: "blocked",
          timeoutMs: 20,
          retryDelayMs: 5,
          staleMs: 60_000,
        }),
      LockTimeoutError,
    );

    const raw = await readFile(lockPath, "utf8");
    assert.match(raw, /recent_holder/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
