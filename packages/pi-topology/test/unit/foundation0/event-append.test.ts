import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  MissingPayloadError,
  PartialEventLogError,
  SequenceInvariantError,
  appendFoundation0Event,
  foundation0StoragePaths,
  readFoundation0Events,
  verifyFoundation0EventPayloads,
} from "../../../src/runtime/foundation0/event-append.ts";
import {
  getDurableFsTestHooks,
  setDurableFsTestHooks,
} from "../../../src/runtime/foundation0/durable-fs.ts";
import {
  canonicalizeForDigest,
  computeSha256Digest,
} from "../../../src/runtime/foundation0/ids.ts";

const MISSION_ID = "mission_foundation0_t2";

async function tempMissionDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "foundation0-event-"));
}

test("foundation0StoragePaths uses the canonical foundation0 storage layout", async () => {
  const missionDir = await tempMissionDir();
  try {
    const paths = foundation0StoragePaths(missionDir);

    assert.equal(paths.rootDir, join(missionDir, "foundation0"));
    assert.equal(paths.eventLogPath, join(missionDir, "foundation0", "runtime-events.jsonl"));
    assert.equal(paths.payloadsDir, join(missionDir, "foundation0", "payloads"));
    assert.equal(paths.locksDir, join(missionDir, "foundation0", "locks"));
    assert.equal(paths.missionEventsLockPath, join(missionDir, "foundation0", "locks", "mission-events.lock"));
  } finally {
    await rm(missionDir, { recursive: true, force: true });
  }
});

test("appendFoundation0Event allocates monotonic sequences and writes canonical payloads", async () => {
  const missionDir = await tempMissionDir();
  try {
    const firstPayload = { b: 2, a: 1 };
    const secondPayload = { a: 3 };

    const first = await appendFoundation0Event({
      missionDir,
      missionId: MISSION_ID,
      eventType: "mission_created",
      entityType: "mission",
      entityId: MISSION_ID,
      payload: firstPayload,
      lockId: "test_append_first",
    });
    const second = await appendFoundation0Event({
      missionDir,
      missionId: MISSION_ID,
      eventType: "mission_phase_changed",
      entityType: "mission",
      entityId: MISSION_ID,
      payload: secondPayload,
      lockId: "test_append_second",
    });

    assert.equal(first.sequence, 0);
    assert.equal(second.sequence, 1);
    assert.equal(first.payload_digest, computeSha256Digest(firstPayload));
    assert.equal(first.payload_ref, `foundation0/payloads/${first.payload_digest}.json`);

    const paths = foundation0StoragePaths(missionDir);
    const rawPayload = await readFile(
      join(paths.payloadsDir, `${first.payload_digest}.json`),
      "utf8",
    );
    assert.equal(rawPayload, `${canonicalizeForDigest(firstPayload)}\n`);

    const rows = await readFoundation0Events(missionDir);
    assert.deepEqual(
      rows.map((event) => event.sequence),
      [0, 1],
    );
  } finally {
    await rm(missionDir, { recursive: true, force: true });
  }
});

test("appendFoundation0Event fsyncs payload and Foundation-0 parent directories", async () => {
  const missionDir = await tempMissionDir();
  const previousHooks = getDurableFsTestHooks();
  const fsyncedDirectories: string[] = [];
  try {
    setDurableFsTestHooks({
      onFsyncDirectory: (path) => {
        fsyncedDirectories.push(path);
      },
    });
    const event = await appendFoundation0Event({
      missionDir,
      missionId: MISSION_ID,
      eventType: "action_requested",
      entityType: "action",
      entityId: "action_durable_dirs",
      payload: { durable: true },
      lockId: "test_durable_dirs",
    });
    const paths = foundation0StoragePaths(missionDir);

    assert.equal(event.payload_ref, `foundation0/payloads/${event.payload_digest}.json`);
    assert.ok(fsyncedDirectories.includes(paths.payloadsDir));
    assert.ok(fsyncedDirectories.includes(paths.rootDir));
  } finally {
    setDurableFsTestHooks(previousHooks);
    await rm(missionDir, { recursive: true, force: true });
  }
});

test("appendFoundation0Event recomputes payload digest and ignores caller hints", async () => {
  const missionDir = await tempMissionDir();
  try {
    const payload = { actual: true };
    const event = await appendFoundation0Event({
      missionDir,
      missionId: MISSION_ID,
      eventType: "action_requested",
      entityType: "action",
      entityId: "action_001",
      payload,
      payloadDigestHint: `sha256:${"0".repeat(64)}`,
      lockId: "test_digest",
    });

    assert.equal(event.payload_digest, computeSha256Digest(payload));
    assert.notEqual(event.payload_digest, `sha256:${"0".repeat(64)}`);
  } finally {
    await rm(missionDir, { recursive: true, force: true });
  }
});

test("appendFoundation0Event repairs an unreferenced partial final payload", async () => {
  const missionDir = await tempMissionDir();
  try {
    const payload = { crash: "during-final-payload-write" };
    const digest = computeSha256Digest(payload);
    const paths = foundation0StoragePaths(missionDir);
    await mkdir(paths.payloadsDir, { recursive: true });
    await writeFile(join(paths.payloadsDir, `${digest}.json`), "{\"crash\"", "utf8");

    const event = await appendFoundation0Event({
      missionDir,
      missionId: MISSION_ID,
      eventType: "action_requested",
      entityType: "action",
      entityId: "action_partial_payload_retry",
      payload,
      lockId: "test_repair_partial_payload",
    });

    assert.equal(event.payload_digest, digest);
    assert.equal(
      await readFile(join(paths.payloadsDir, `${digest}.json`), "utf8"),
      `${canonicalizeForDigest(payload)}\n`,
    );
    await verifyFoundation0EventPayloads(missionDir);
  } finally {
    await rm(missionDir, { recursive: true, force: true });
  }
});

test("appendFoundation0Event idempotent retry returns the existing event without duplicating", async () => {
  const missionDir = await tempMissionDir();
  try {
    const first = await appendFoundation0Event({
      missionDir,
      missionId: MISSION_ID,
      eventType: "resource_planned",
      entityType: "resource",
      entityId: "res_001",
      payload: { resource_id: "res_001" },
      idempotencyKey: "plan_res_001",
      lockId: "test_idempotency_first",
    });
    const retry = await appendFoundation0Event({
      missionDir,
      missionId: MISSION_ID,
      eventType: "resource_planned",
      entityType: "resource",
      entityId: "res_001",
      payload: { resource_id: "res_001" },
      idempotencyKey: "plan_res_001",
      lockId: "test_idempotency_retry",
    });

    assert.equal(retry.event_id, first.event_id);
    assert.equal(retry.sequence, first.sequence);
    assert.equal((await readFoundation0Events(missionDir)).length, 1);
  } finally {
    await rm(missionDir, { recursive: true, force: true });
  }
});

test("appendFoundation0Event refuses to allocate after sequence corruption", async () => {
  const missionDir = await tempMissionDir();
  try {
    await appendFoundation0Event({
      missionDir,
      missionId: MISSION_ID,
      eventType: "mission_created",
      entityType: "mission",
      entityId: MISSION_ID,
      payload: { sequence: 0 },
      lockId: "test_sequence_seed_0",
    });
    await appendFoundation0Event({
      missionDir,
      missionId: MISSION_ID,
      eventType: "mission_phase_changed",
      entityType: "mission",
      entityId: MISSION_ID,
      payload: { sequence: 1 },
      lockId: "test_sequence_seed_1",
    });

    const paths = foundation0StoragePaths(missionDir);
    const rows = (await readFile(paths.eventLogPath, "utf8")).trimEnd().split("\n");
    const second = JSON.parse(rows[1] ?? "{}");
    second.sequence = 2;
    await writeFile(paths.eventLogPath, `${rows[0]}\n${JSON.stringify(second)}\n`, "utf8");

    await assert.rejects(
      () =>
        appendFoundation0Event({
          missionDir,
          missionId: MISSION_ID,
          eventType: "closeout_started",
          entityType: "closeout",
          entityId: "closeout_sequence_corruption",
          payload: { blocked: true },
          lockId: "test_sequence_corruption_reject",
        }),
      SequenceInvariantError,
    );
  } finally {
    await rm(missionDir, { recursive: true, force: true });
  }
});

test("verifyFoundation0EventPayloads detects missing payloads before rows are treated as valid", async () => {
  const missionDir = await tempMissionDir();
  try {
    const event = await appendFoundation0Event({
      missionDir,
      missionId: MISSION_ID,
      eventType: "resource_registered",
      entityType: "resource",
      entityId: "res_002",
      payload: { resource_id: "res_002" },
      lockId: "test_missing_payload",
    });
    const paths = foundation0StoragePaths(missionDir);
    await unlink(join(paths.payloadsDir, `${event.payload_digest}.json`));

    await assert.rejects(
      () => verifyFoundation0EventPayloads(missionDir),
      MissingPayloadError,
    );
  } finally {
    await rm(missionDir, { recursive: true, force: true });
  }
});

test("partial trailing event row is detected when allocating the next sequence", async () => {
  const missionDir = await tempMissionDir();
  try {
    await appendFoundation0Event({
      missionDir,
      missionId: MISSION_ID,
      eventType: "mission_created",
      entityType: "mission",
      entityId: MISSION_ID,
      payload: { ok: true },
      lockId: "test_partial_seed",
    });

    const paths = foundation0StoragePaths(missionDir);
    await writeFile(paths.eventLogPath, "{\"schema_version\":1", { flag: "a" });

    await assert.rejects(
      () =>
        appendFoundation0Event({
          missionDir,
          missionId: MISSION_ID,
          eventType: "mission_phase_changed",
          entityType: "mission",
          entityId: MISSION_ID,
          payload: { blocked: true },
          lockId: "test_partial_reject",
        }),
      PartialEventLogError,
    );
  } finally {
    await rm(missionDir, { recursive: true, force: true });
  }
});
