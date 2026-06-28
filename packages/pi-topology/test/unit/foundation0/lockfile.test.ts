import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, unlink, utimes, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  getDurableFsTestHooks,
  setDurableFsTestHooks,
} from "../../../src/runtime/foundation0/durable-fs.ts";
import {
  type Foundation0HolderProbe,
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
          {
            lockId: `worker_${i}`,
            missionId: "mission_lock_001",
            purpose: "mission_event_append",
            timeoutMs: 1000,
            retryDelayMs: 1,
            staleMs: 10_000,
          },
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
      missionId: "mission_lock_001",
      purpose: "mission_event_append",
      timeoutMs: 100,
      retryDelayMs: 1,
      staleMs: 10_000,
    });

    await assert.rejects(
      () =>
        acquireLock(lockPath, {
          lockId: "waiter",
          missionId: "mission_lock_001",
          purpose: "mission_event_append",
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
    assert.equal(metadata?.holder_nonce, held.metadata.holder_nonce);
    assert.equal(metadata?.mission_id, "mission_lock_001");
    assert.equal(metadata?.purpose, "mission_event_append");
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
      missionId: "mission_lock_001",
      purpose: "mission_event_append",
      timeoutMs: 100,
      retryDelayMs: 1,
      staleMs: 10_000,
    });
    await unlink(lockPath);

    const second = await acquireLock(lockPath, {
      lockId: "second",
      missionId: "mission_lock_001",
      purpose: "mission_event_append",
      timeoutMs: 100,
      retryDelayMs: 1,
      staleMs: 10_000,
    });

    await first.release();
    await first.release();

    const metadata = await readLockMetadata(lockPath);
    assert.equal(metadata?.holder_nonce, second.metadata.holder_nonce);
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
        schema_version: 1,
        lock_id: "stale",
        mission_id: "mission_lock_001",
        purpose: "mission_event_append",
        holder_pid: 999999,
        holder_process_start_tuple: {
          start_time_seconds: 1,
          start_time_microseconds: 2,
        },
        holder_nonce: "stale_holder",
        hostname: hostname(),
        created_at: old.toISOString(),
      }),
      "utf8",
    );
    await utimes(lockPath, old, old);

    const acquired = await acquireLock(lockPath, {
      lockId: "fresh",
      missionId: "mission_lock_001",
      purpose: "mission_event_append",
      timeoutMs: 100,
      retryDelayMs: 1,
      staleMs: 10,
      holderProbe: async () => ({
        status: "absent_verified",
      }),
    });

    assert.equal((await readLockMetadata(lockPath))?.holder_nonce, acquired.metadata.holder_nonce);
    await acquired.release();

    const freshCreatedAt = new Date().toISOString();
    await writeFile(
      lockPath,
      JSON.stringify({
        schema_version: 1,
        lock_id: "recent",
        mission_id: "mission_lock_001",
        purpose: "mission_event_append",
        holder_pid: process.pid,
        holder_nonce: "recent_holder",
        hostname: hostname(),
        created_at: freshCreatedAt,
      }),
      "utf8",
    );

    await assert.rejects(
      () =>
        acquireLock(lockPath, {
          lockId: "blocked",
          missionId: "mission_lock_001",
          purpose: "mission_event_append",
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

test("lockfile create writes rich metadata and fsyncs lock file plus locks directory", async () => {
  const dir = await tempDir();
  const previousHooks = getDurableFsTestHooks();
  const calls: string[] = [];
  try {
    setDurableFsTestHooks({
      onFsyncFile: (path) => calls.push(`file:${path}`),
      onFsyncDirectory: (path) => calls.push(`dir:${path}`),
    });
    const lockPath = join(dir, "locks", "mission-events.lock");
    const lock = await acquireLock(lockPath, {
      lockId: "rich",
      missionId: "mission_lock_001",
      purpose: "resource_creation_plan",
      timeoutMs: 100,
    });
    const metadata = await readLockMetadata(lockPath);

    assert.equal(metadata?.schema_version, 1);
    assert.equal(metadata?.lock_id, "rich");
    assert.equal(metadata?.mission_id, "mission_lock_001");
    assert.equal(metadata?.purpose, "resource_creation_plan");
    assert.equal(metadata?.holder_pid, process.pid);
    assert.equal(metadata?.hostname, hostname());
    assert.equal(typeof metadata?.holder_nonce, "string");
    assert.ok(calls.includes(`file:${lockPath}`));
    assert.ok(calls.includes(`dir:${dirname(lockPath)}`));
    await lock.release();
  } finally {
    setDurableFsTestHooks(previousHooks);
    await rm(dir, { recursive: true, force: true });
  }
});

test("malformed metadata and hostname mismatch fail safe instead of stale breaking", async () => {
  const dir = await tempDir();
  try {
    const lockPath = join(dir, "mission-events.lock");
    await writeFile(lockPath, "{not-json", "utf8");
    await assert.rejects(
      () =>
        acquireLock(lockPath, {
          lockId: "blocked_malformed",
          missionId: "mission_lock_001",
          purpose: "mission_event_append",
          timeoutMs: 20,
          retryDelayMs: 5,
          staleMs: 1,
        }),
      LockTimeoutError,
    );

    const old = new Date(Date.now() - 60_000);
    await writeFile(
      lockPath,
      JSON.stringify({
        schema_version: 1,
        lock_id: "foreign",
        mission_id: "mission_lock_001",
        purpose: "mission_event_append",
        holder_pid: 999999,
        holder_nonce: "foreign_nonce",
        hostname: "other-host",
        created_at: old.toISOString(),
      }),
      "utf8",
    );
    await utimes(lockPath, old, old);
    await assert.rejects(
      () =>
        acquireLock(lockPath, {
          lockId: "blocked_hostname",
          missionId: "mission_lock_001",
          purpose: "mission_event_append",
          timeoutMs: 20,
          retryDelayMs: 5,
          staleMs: 1,
        }),
      LockTimeoutError,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("invalid lock created_at fails safe even with verified stale holder probe", async () => {
  const dir = await tempDir();
  try {
    const lockPath = join(dir, "mission-events.lock");
    const old = new Date(Date.now() - 60_000);
    await writeFile(
      lockPath,
      JSON.stringify({
        schema_version: 1,
        lock_id: "bad_created_at",
        mission_id: "mission_lock_001",
        purpose: "mission_event_append",
        holder_pid: 999999,
        holder_process_start_tuple: {
          start_time_seconds: 1,
          start_time_microseconds: 2,
        },
        holder_nonce: "bad_created_at_nonce",
        hostname: hostname(),
        created_at: "not-a-date",
      }),
      "utf8",
    );
    await utimes(lockPath, old, old);

    await assert.rejects(
      () =>
        acquireLock(lockPath, {
          lockId: "blocked_bad_created_at",
          missionId: "mission_lock_001",
          purpose: "mission_event_append",
          timeoutMs: 20,
          retryDelayMs: 5,
          staleMs: 1,
          holderProbe: async () => ({
            status: "absent_verified",
          }),
        }),
      LockTimeoutError,
    );

    const raw = await readFile(lockPath, "utf8");
    assert.match(raw, /bad_created_at_nonce/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("permission denied or ambiguous holder probe fails safe; verified mismatch records stale incident before break", async () => {
  const dir = await tempDir();
  const old = new Date(Date.now() - 60_000);
  const lockPath = join(dir, "mission-events.lock");
  const metadata = {
    schema_version: 1,
    lock_id: "probe",
    mission_id: "mission_lock_001",
    purpose: "mission_event_append",
    holder_pid: 999999,
    holder_process_start_tuple: {
      start_time_seconds: 1,
      start_time_microseconds: 2,
    },
    holder_nonce: "probe_nonce",
    hostname: hostname(),
    created_at: old.toISOString(),
  };
  try {
    await writeFile(lockPath, JSON.stringify(metadata), "utf8");
    await utimes(lockPath, old, old);
    const permissionDeniedProbe: Foundation0HolderProbe = async () => ({
      status: "permission_denied",
    });
    await assert.rejects(
      () =>
        acquireLock(lockPath, {
          lockId: "blocked_probe",
          missionId: "mission_lock_001",
          purpose: "mission_event_append",
          timeoutMs: 20,
          retryDelayMs: 5,
          staleMs: 1,
          holderProbe: permissionDeniedProbe,
        }),
      LockTimeoutError,
    );

    const staleIncidents: string[] = [];
    const acquired = await acquireLock(lockPath, {
      lockId: "after_verified_mismatch",
      missionId: "mission_lock_001",
      purpose: "mission_event_append",
      timeoutMs: 100,
      retryDelayMs: 5,
      staleMs: 1,
      holderProbe: async () => ({
        status: "start_tuple_mismatch_verified",
      }),
      onStaleLockIncident: (incident) => {
        staleIncidents.push(incident.reason);
      },
    });

    assert.deepEqual(staleIncidents, ["start_tuple_mismatch_verified"]);
    await acquired.release();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});


test("stale lock age can be evaluated with deterministic test clock", async () => {
  const dir = await tempDir();
  try {
    const lockPath = join(dir, "mission-events.lock");
    await writeFile(
      lockPath,
      JSON.stringify({
        schema_version: 1,
        lock_id: "stale_clock",
        mission_id: "mission_lock_001",
        purpose: "cleanup_attempt_acquisition",
        holder_pid: 999999,
        holder_process_start_tuple: {
          start_time_seconds: 1,
          start_time_microseconds: 2,
        },
        holder_nonce: "stale_clock_nonce",
        hostname: hostname(),
        created_at: "2026-06-28T00:00:00.000Z",
      }),
      "utf8",
    );

    const acquired = await acquireLock(lockPath, {
      lockId: "fresh_clock",
      missionId: "mission_lock_001",
      purpose: "cleanup_attempt_acquisition",
      timeoutMs: 100,
      retryDelayMs: 1,
      staleMs: 10,
      staleNowMs: () => Date.parse("2026-06-28T00:00:00.011Z"),
      holderProbe: async () => ({ status: "absent_verified" }),
    });

    assert.equal(
      (await readLockMetadata(lockPath))?.holder_nonce,
      acquired.metadata.holder_nonce,
    );
    await acquired.release();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("stale lock age is not considered stale when injected clock reports young age", async () => {
  const dir = await tempDir();
  try {
    const lockPath = join(dir, "mission-events.lock");
    await writeFile(
      lockPath,
      JSON.stringify({
        schema_version: 1,
        lock_id: "young_clock",
        mission_id: "mission_lock_001",
        purpose: "mission_event_append",
        holder_pid: 999999,
        holder_process_start_tuple: {
          start_time_seconds: 1,
          start_time_microseconds: 2,
        },
        holder_nonce: "young_clock_nonce",
        hostname: hostname(),
        created_at: "2026-06-28T00:00:00.000Z",
      }),
      "utf8",
    );

    await assert.rejects(
      () =>
        acquireLock(lockPath, {
          lockId: "blocked_young",
          missionId: "mission_lock_001",
          purpose: "mission_event_append",
          timeoutMs: 20,
          retryDelayMs: 5,
          staleMs: 60_000,
          staleNowMs: () => Date.parse("2026-06-28T00:00:00.500Z"),
          holderProbe: async () => ({ status: "absent_verified" }),
        }),
      LockTimeoutError,
    );

    const raw = await readFile(lockPath, "utf8");
    assert.match(raw, /young_clock_nonce/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});