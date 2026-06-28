import assert from "node:assert/strict";
import { mkdtemp, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  type ActionAttempt,
  type PolicyDecision,
  type TerminateResourceAction,
} from "../../../src/runtime/foundation0/schema.ts";
import {
  validateActionAttempt,
  validatePolicyDecision,
  validateTerminateResourceAction,
} from "../../../src/runtime/foundation0/validation.ts";
import { Foundation0ValidationError } from "../../../src/runtime/foundation0/ids.ts";
import { acquireLock, readLockMetadata } from "../../../src/runtime/foundation0/lockfile.ts";
import {
  foundation0StoragePaths,
  appendFoundation0Event,
  readFoundation0Events,
} from "../../../src/runtime/foundation0/event-append.ts";
import {
  acquireCleanupAttempt,
  readActiveCleanupAttempts,
} from "../../../src/runtime/foundation0/cleanup-attempt-acquisition.ts";

const MISSION_ID = "mission_foundation0_t6";
const ACTION_ID = "action_terminate_001";
const ACTION_ATTEMPT_ID = "attempt_001";
const POLICY_DECISION_ID = "policy_decision_001";
const CONFLICT_POLICY_DECISION_ID = "policy_decision_conflict_001";
const RESOURCE_ID = "res_process_001";
const IDENTITY_DIGEST = `sha256:${"1".repeat(64)}`;
const ALTERNATE_RESOURCE_ID = "res_process_002";
const ALTERNATE_IDENTITY_DIGEST = `sha256:${"2".repeat(64)}`;
const AUTHORIZATION_ID = "auth_owner_001";
const ACTOR_ID = "actor_owner_001";
const IDEMPOTENCY_KEY = "idem_cleanup_001";
const ALTERNATE_IDEMPOTENCY_KEY = "idem_cleanup_002";
const POLICY_HASH = `sha256:${"a".repeat(64)}`;
const VALID_TS = "2026-06-28T00:00:00.000Z";
const REQUESTED_AT = "2026-06-28T00:00:00.000Z";
const STARTED_AT = "2026-06-28T00:00:01.000Z";
const DECIDED_AT = "2026-06-28T00:00:02.000Z";
const ACQUIRED_AT = "2026-06-28T00:00:03.000Z";

function terminateResourceAction(
  overrides: Partial<TerminateResourceAction> = {},
): TerminateResourceAction {
  return {
    schema_version: 1,
    action_id: ACTION_ID,
    mission_id: MISSION_ID,
    actor_id: ACTOR_ID,
    authorization_id: AUTHORIZATION_ID,
    idempotency_key: IDEMPOTENCY_KEY,
    payload_ref: `foundation0/payloads/${ACTION_ID}.json`,
    payload_digest: `sha256:${"a".repeat(64)}`,
    effect_fingerprint: `sha256:${"b".repeat(64)}`,
    retry_of_action_id: null,
    requested_at: REQUESTED_AT,
    capability: "terminate_resource",
    payload_kind: "terminate_resource",
    target: { entity_type: "resource", resource_id: RESOURCE_ID },
    ...overrides,
  } as TerminateResourceAction;
}

function actionAttempt(
  overrides: Partial<ActionAttempt> = {},
): ActionAttempt {
  return {
    schema_version: 1,
    action_attempt_id: ACTION_ATTEMPT_ID,
    action_id: ACTION_ID,
    mission_id: MISSION_ID,
    attempt_number: 1,
    started_at: STARTED_AT,
    ...overrides,
  };
}

function allowedPolicyDecision(
  overrides: Partial<PolicyDecision> = {},
): PolicyDecision {
  return {
    schema_version: 1,
    policy_decision_id: POLICY_DECISION_ID,
    action_id: ACTION_ID,
    action_attempt_id: ACTION_ATTEMPT_ID,
    mission_id: MISSION_ID,
    evaluation_point: "execution",
    evaluation_sequence: 1,
    result: "allowed",
    reason_codes: ["cleanup_authorized"],
    authorization_chain: [AUTHORIZATION_ID],
    evaluated_policy_hash: POLICY_HASH,
    decided_at: DECIDED_AT,
    ...overrides,
  };
}

function cleanupInProgressPolicyDecision(
  overrides: Partial<PolicyDecision> = {},
): PolicyDecision {
  return {
    schema_version: 1,
    policy_decision_id: CONFLICT_POLICY_DECISION_ID,
    action_id: ACTION_ID,
    action_attempt_id: ACTION_ATTEMPT_ID,
    mission_id: MISSION_ID,
    evaluation_point: "execution",
    evaluation_sequence: 2,
    result: "cleanup_in_progress",
    reason_codes: ["active_cleanup_attempt"],
    authorization_chain: [AUTHORIZATION_ID],
    evaluated_policy_hash: POLICY_HASH,
    decided_at: DECIDED_AT,
    ...overrides,
  };
}

async function tempMissionDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "foundation0-cleanup-acq-"));
}

interface BuildInputArgs {
  actionRequest?: TerminateResourceAction;
  actionAttempt?: ActionAttempt;
  allowedDecision?: PolicyDecision;
  cleanupInProgressDecision?: PolicyDecision;
  resourceId?: string;
  identityDigest?: string;
  idempotencyKey?: string;
  nowIso?: () => string;
}

function defaultArgs(overrides: BuildInputArgs = {}) {
  return {
    actionRequest: overrides.actionRequest ?? terminateResourceAction(),
    actionAttempt: overrides.actionAttempt ?? actionAttempt(),
    allowedDecision: overrides.allowedDecision ?? allowedPolicyDecision(),
    cleanupInProgressDecision:
      overrides.cleanupInProgressDecision ?? cleanupInProgressPolicyDecision(),
    resourceId: overrides.resourceId ?? RESOURCE_ID,
    identityDigest: overrides.identityDigest ?? IDENTITY_DIGEST,
    idempotencyKey: overrides.idempotencyKey ?? IDEMPOTENCY_KEY,
    nowIso: overrides.nowIso ?? (() => ACQUIRED_AT),
  };
}

function repeatedId(character: string, length: number): string {
  return character.repeat(length);
}

async function waitForExistingPath(path: string): Promise<void> {
  const deadline = Date.now() + 500;
  while (Date.now() < deadline) {
    try {
      await stat(path);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  assert.fail(`Timed out waiting for path to exist: ${path}`);
}

test("defaultArgs nowIso produces a deterministic acquired_at", () => {
  const args = defaultArgs();
  assert.equal(args.nowIso?.(), ACQUIRED_AT);
});

// ============================================================ validator tests

test("validateTerminateResourceAction accepts a canonical terminate_resource action", () => {
  const action = terminateResourceAction();
  const validated = validateTerminateResourceAction(action);
  assert.equal(validated.action_id, ACTION_ID);
  assert.equal(validated.target.resource_id, RESOURCE_ID);
});

test("validateActionAttempt accepts a canonical attempt envelope", () => {
  const attempt = actionAttempt();
  const validated = validateActionAttempt(attempt);
  assert.equal(validated.action_attempt_id, ACTION_ATTEMPT_ID);
});

test("validatePolicyDecision accepts an allowed execution decision", () => {
  const decision = allowedPolicyDecision();
  const validated = validatePolicyDecision(decision);
  assert.equal(validated.result, "allowed");
  assert.equal(validated.evaluation_point, "execution");
});

test("acquireCleanupAttempt rejects a non-terminate-resource action", async () => {
  const missionDir = await tempMissionDir();
  try {
    const badAction = {
      ...terminateResourceAction(),
      capability: "register_resource",
      payload_kind: "register_resource",
    } as unknown as TerminateResourceAction;
    await assert.rejects(
      () =>
        acquireCleanupAttempt({
          missionDir,
          ...defaultArgs({ actionRequest: badAction }),
        }),
      Foundation0ValidationError,
    );
  } finally {
    await rm(missionDir, { recursive: true, force: true });
  }
});

test("acquireCleanupAttempt rejects a non-execution policy decision", async () => {
  const missionDir = await tempMissionDir();
  try {
    const badDecision = {
      ...allowedPolicyDecision(),
      evaluation_point: "intent",
    } as unknown as PolicyDecision;
    await assert.rejects(
      () =>
        acquireCleanupAttempt({
          missionDir,
          ...defaultArgs({ allowedDecision: badDecision }),
        }),
      Foundation0ValidationError,
    );
  } finally {
    await rm(missionDir, { recursive: true, force: true });
  }
});

test("acquireCleanupAttempt rejects a non-allowed execution decision for acquire path", async () => {
  const missionDir = await tempMissionDir();
  try {
    const deniedDecision = {
      ...allowedPolicyDecision(),
      result: "denied",
    } as unknown as PolicyDecision;
    await assert.rejects(
      () =>
        acquireCleanupAttempt({
          missionDir,
          ...defaultArgs({ allowedDecision: deniedDecision }),
        }),
      Foundation0ValidationError,
    );
  } finally {
    await rm(missionDir, { recursive: true, force: true });
  }
});

test("acquireCleanupAttempt rejects a non-cleanup_in_progress decision for conflict path", async () => {
  const missionDir = await tempMissionDir();
  try {
    // First create an active attempt
    await acquireCleanupAttempt({ missionDir, ...defaultArgs() });
    // Now try a conflict decision that is not cleanup_in_progress
    const badConflict = {
      ...cleanupInProgressPolicyDecision(),
      result: "denied",
    } as unknown as PolicyDecision;
    await assert.rejects(
      () =>
        acquireCleanupAttempt({
          missionDir,
          ...defaultArgs({
            idempotencyKey: ALTERNATE_IDEMPOTENCY_KEY,
            cleanupInProgressDecision: badConflict,
          }),
        }),
      Foundation0ValidationError,
    );
  } finally {
    await rm(missionDir, { recursive: true, force: true });
  }
});

test("acquireCleanupAttempt rejects mismatched mission_id between action and decision", async () => {
  const missionDir = await tempMissionDir();
  try {
    const mismatchedDecision = {
      ...allowedPolicyDecision(),
      mission_id: "mission_other_001",
    } as unknown as PolicyDecision;
    await assert.rejects(
      () =>
        acquireCleanupAttempt({
          missionDir,
          ...defaultArgs({ allowedDecision: mismatchedDecision }),
        }),
      Foundation0ValidationError,
    );
  } finally {
    await rm(missionDir, { recursive: true, force: true });
  }
});

test("acquireCleanupAttempt rejects mismatched action_id between attempt and decision", async () => {
  const missionDir = await tempMissionDir();
  try {
    const mismatchedDecision = {
      ...allowedPolicyDecision(),
      action_id: "action_other_001",
    } as unknown as PolicyDecision;
    await assert.rejects(
      () =>
        acquireCleanupAttempt({
          missionDir,
          ...defaultArgs({ allowedDecision: mismatchedDecision }),
        }),
      Foundation0ValidationError,
    );
  } finally {
    await rm(missionDir, { recursive: true, force: true });
  }
});

test("acquireCleanupAttempt rejects mismatched action_attempt_id", async () => {
  const missionDir = await tempMissionDir();
  try {
    const mismatchedDecision = {
      ...allowedPolicyDecision(),
      action_attempt_id: "attempt_other_001",
    } as unknown as PolicyDecision;
    await assert.rejects(
      () =>
        acquireCleanupAttempt({
          missionDir,
          ...defaultArgs({ allowedDecision: mismatchedDecision }),
        }),
      Foundation0ValidationError,
    );
  } finally {
    await rm(missionDir, { recursive: true, force: true });
  }
});

test("acquireCleanupAttempt rejects target.resource_id that does not match the supplied resourceId", async () => {
  const missionDir = await tempMissionDir();
  try {
    await assert.rejects(
      () =>
        acquireCleanupAttempt({
          missionDir,
          ...defaultArgs({ resourceId: "res_other_001" }),
        }),
      Foundation0ValidationError,
    );
  } finally {
    await rm(missionDir, { recursive: true, force: true });
  }
});

test("acquireCleanupAttempt rejects a non-digest identity_digest", async () => {
  const missionDir = await tempMissionDir();
  try {
    await assert.rejects(
      () =>
        acquireCleanupAttempt({
          missionDir,
          ...defaultArgs({ identityDigest: "not-a-digest" }),
        }),
      Foundation0ValidationError,
    );
  } finally {
    await rm(missionDir, { recursive: true, force: true });
  }
});

// ============================================================ acquisition behavior

test("acquireCleanupAttempt writes the four canonical events for a fresh acquisition", async () => {
  const missionDir = await tempMissionDir();
  try {
    const result = await acquireCleanupAttempt({ missionDir, ...defaultArgs() });

    assert.equal(result.result, "acquired");
    if (result.result !== "acquired") return;

    assert.equal(result.events.length, 4);
    const types = result.events.map((event) => event.event_type);
    assert.deepEqual(types, [
      "action_requested",
      "action_attempt_started",
      "policy_decision_recorded",
      "resource_cleanup_pending",
    ]);

    // All four events reference the same mission, action, attempt.
    // All four events reference the same mission and action.
    for (const event of result.events) {
      assert.equal(event.mission_id, MISSION_ID);
      assert.equal(event.action_id, ACTION_ID);
    }
    // Events after the request carry the attempt id.
    for (const event of result.events.slice(1)) {
      assert.equal(event.action_attempt_id, ACTION_ATTEMPT_ID);
    }
    // The pending event references the allowed policy decision.
    const pending = result.events[3];
    assert.equal(pending?.event_type, "resource_cleanup_pending");
    assert.equal(pending?.policy_decision_id, POLICY_DECISION_ID);

    // Active attempt projection reports the same key.
    assert.equal(result.attempt.mission_id, MISSION_ID);
    assert.equal(result.attempt.resource_id, RESOURCE_ID);
    assert.equal(result.attempt.identity_digest, IDENTITY_DIGEST);
    assert.equal(result.attempt.idempotency_key, IDEMPOTENCY_KEY);
    assert.equal(result.attempt.state, "active");
    assert.equal(result.attempt.started_at, ACQUIRED_AT, "acquired_at is deterministic via defaultArgs.nowIso");

    const active = await readActiveCleanupAttempts(missionDir);
    assert.equal(active.length, 1);
    assert.equal(active[0]?.mission_id, MISSION_ID);
    assert.equal(active[0]?.resource_id, RESOURCE_ID);
    assert.equal(active[0]?.identity_digest, IDENTITY_DIGEST);
    assert.equal(active[0]?.idempotency_key, IDEMPOTENCY_KEY);
  } finally {
    await rm(missionDir, { recursive: true, force: true });
  }
});

test("same idempotency key returns idempotent_replay without appending a new active attempt", async () => {
  const missionDir = await tempMissionDir();
  try {
    const first = await acquireCleanupAttempt({ missionDir, ...defaultArgs() });
    assert.equal(first.result, "acquired");

    const second = await acquireCleanupAttempt({ missionDir, ...defaultArgs() });
    assert.equal(second.result, "idempotent_replay");
    if (second.result !== "idempotent_replay") return;

    assert.equal(second.events.length, 0);
    assert.equal(second.attempt.mission_id, MISSION_ID);
    assert.equal(second.attempt.resource_id, RESOURCE_ID);
    assert.equal(second.attempt.idempotency_key, IDEMPOTENCY_KEY);

    const active = await readActiveCleanupAttempts(missionDir);
    assert.equal(active.length, 1);
  } finally {
    await rm(missionDir, { recursive: true, force: true });
  }
});

test("valid long Foundation-0 IDs keep cleanup and event-append lock metadata releasable", async () => {
  const missionDir = await tempMissionDir();
  const missionId = repeatedId("m", 110);
  const resourceId = repeatedId("r", 110);
  const args = defaultArgs({
    actionRequest: terminateResourceAction({
      mission_id: missionId,
      target: { entity_type: "resource", resource_id: resourceId },
    }),
    actionAttempt: actionAttempt({ mission_id: missionId }),
    allowedDecision: allowedPolicyDecision({ mission_id: missionId }),
    cleanupInProgressDecision: cleanupInProgressPolicyDecision({ mission_id: missionId }),
    resourceId,
  });
  const paths = foundation0StoragePaths(missionDir);
  const cleanupLockPath = join(paths.locksDir, "cleanup-attempt.lock");
  const eventAppendGate = await acquireLock(paths.missionEventsLockPath, {
    lockId: "test_long_id_gate",
    missionId,
    purpose: "mission_event_append",
    timeoutMs: 500,
    retryDelayMs: 5,
  });
  let first: Promise<Awaited<ReturnType<typeof acquireCleanupAttempt>>> | undefined;
  try {
    first = acquireCleanupAttempt({
      missionDir,
      ...args,
      lockTimeoutMs: 500,
      lockRetryDelayMs: 5,
    });
    await waitForExistingPath(cleanupLockPath);

    const heldMetadata = await readLockMetadata(cleanupLockPath);
    assert.notEqual(heldMetadata, null);
    assert.match(heldMetadata?.lock_id ?? "", /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);

    await eventAppendGate.release();
    const firstResult = await first;
    assert.equal(firstResult.result, "acquired");
    assert.equal(await readLockMetadata(cleanupLockPath), null);
    assert.equal(await readLockMetadata(paths.missionEventsLockPath), null);

    const replay = await acquireCleanupAttempt({
      missionDir,
      ...args,
      lockTimeoutMs: 500,
      lockRetryDelayMs: 5,
    });
    assert.equal(replay.result, "idempotent_replay");
  } finally {
    await eventAppendGate.release();
    await first?.catch(() => undefined);
    await rm(missionDir, { recursive: true, force: true });
  }
});

test("different idempotency key for same mission+resource+identity returns cleanup_in_progress", async () => {
  const missionDir = await tempMissionDir();
  try {
    const first = await acquireCleanupAttempt({ missionDir, ...defaultArgs() });
    assert.equal(first.result, "acquired");

    const second = await acquireCleanupAttempt({
      missionDir,
      ...defaultArgs({ idempotencyKey: ALTERNATE_IDEMPOTENCY_KEY }),
    });
    assert.equal(second.result, "cleanup_in_progress");
    if (second.result !== "cleanup_in_progress") return;

    assert.equal(second.events.length, 1);
    assert.equal(second.events[0]?.event_type, "policy_decision_recorded");
    assert.equal(
      second.events[0]?.policy_decision_id,
      CONFLICT_POLICY_DECISION_ID,
    );

    // The conflict decision must be the cleanup_in_progress one.
    assert.equal(second.policy_decision.result, "cleanup_in_progress");

    // No second resource_cleanup_pending event was appended.
    const active = await readActiveCleanupAttempts(missionDir);
    assert.equal(active.length, 1);
    assert.equal(active[0]?.idempotency_key, IDEMPOTENCY_KEY);
  } finally {
    await rm(missionDir, { recursive: true, force: true });
  }
});

test("same resource_id with different identity_digest can acquire independently", async () => {
  const missionDir = await tempMissionDir();
  try {
    const first = await acquireCleanupAttempt({ missionDir, ...defaultArgs() });
    assert.equal(first.result, "acquired");

    const second = await acquireCleanupAttempt({
      missionDir,
      ...defaultArgs({ identityDigest: ALTERNATE_IDENTITY_DIGEST }),
    });
    assert.equal(second.result, "acquired");
    if (second.result !== "acquired") return;

    const active = await readActiveCleanupAttempts(missionDir);
    assert.equal(active.length, 2);
    const digests = active.map((a) => a.identity_digest).sort();
    assert.deepEqual(digests, [IDENTITY_DIGEST, ALTERNATE_IDENTITY_DIGEST].sort());
  } finally {
    await rm(missionDir, { recursive: true, force: true });
  }
});

test("same identity_digest with different resource_id can acquire independently", async () => {
  const missionDir = await tempMissionDir();
  try {
    const first = await acquireCleanupAttempt({ missionDir, ...defaultArgs() });
    assert.equal(first.result, "acquired");

    const second = await acquireCleanupAttempt({
      missionDir,
      ...defaultArgs({
        resourceId: ALTERNATE_RESOURCE_ID,
        actionRequest: terminateResourceAction({
          target: { entity_type: "resource", resource_id: ALTERNATE_RESOURCE_ID },
        }),
      }),
    });
    assert.equal(second.result, "acquired");
    if (second.result !== "acquired") return;

    const active = await readActiveCleanupAttempts(missionDir);
    assert.equal(active.length, 2);
    const resourceIds = active.map((a) => a.resource_id).sort();
    assert.deepEqual(
      resourceIds,
      [RESOURCE_ID, ALTERNATE_RESOURCE_ID].sort(),
    );
  } finally {
    await rm(missionDir, { recursive: true, force: true });
  }
});

// ============================================================ replay & crash boundary

test("readActiveCleanupAttempts reconstructs active state after a fresh module call", async () => {
  const missionDir = await tempMissionDir();
  try {
    const first = await acquireCleanupAttempt({ missionDir, ...defaultArgs() });
    assert.equal(first.result, "acquired");

    // Simulate a fresh process: re-read the canonical events from disk.
    const active = await readActiveCleanupAttempts(missionDir);
    assert.equal(active.length, 1);
    assert.equal(active[0]?.idempotency_key, IDEMPOTENCY_KEY);
    assert.equal(active[0]?.state, "active");
    assert.ok((active[0]?.blocking_event_ids.length ?? 0) > 0);
  } finally {
    await rm(missionDir, { recursive: true, force: true });
  }
});

test("missing payload causes reconciliation_required and does not acquire", async () => {
  const missionDir = await tempMissionDir();
  try {
    const first = await acquireCleanupAttempt({ missionDir, ...defaultArgs() });
    assert.equal(first.result, "acquired");

    // Delete the payload backing the resource_cleanup_pending event so the
    // projection cannot verify its digest.
    const pending = first.events[3];
    assert.ok(pending);
    const payloadPath = join(
      foundation0StoragePaths(missionDir).payloadsDir,
      `${pending.payload_digest}.json`,
    );
    await unlink(payloadPath);

    // A new attempt with a different idempotency key should be treated as
    // reconciliation-required, not blindly retry.
    const second = await acquireCleanupAttempt({
      missionDir,
      ...defaultArgs({ idempotencyKey: ALTERNATE_IDEMPOTENCY_KEY }),
    });
    assert.equal(second.result, "reconciliation_required");
    if (second.result !== "reconciliation_required") return;
    assert.equal(second.reason, "missing_payload");
    // No additional resource_cleanup_pending event appended.
    const active = await readActiveCleanupAttempts(missionDir);
    assert.equal(active.length, 1);
  } finally {
    await rm(missionDir, { recursive: true, force: true });
  }
});

test("payload_digest_mismatch causes reconciliation_required and does not acquire", async () => {
  const missionDir = await tempMissionDir();
  try {
    const first = await acquireCleanupAttempt({ missionDir, ...defaultArgs() });
    assert.equal(first.result, "acquired");

    // Corrupt the payload backing the resource_cleanup_pending event.
    const pending = first.events[3];
    assert.ok(pending);
    const payloadPath = join(
      foundation0StoragePaths(missionDir).payloadsDir,
      `${pending.payload_digest}.json`,
    );
    // Read the original canonical payload, change one field, rewrite.
    const original = first.events[3]?.payload_digest ?? "";
    // Write a JSON that canonicalizes differently from the original payload.
    const fs = await import("node:fs/promises");
    await fs.writeFile(payloadPath, "{\"tampered\":true}\n", "utf8");
    assert.notEqual(original, "");

    const second = await acquireCleanupAttempt({
      missionDir,
      ...defaultArgs({ idempotencyKey: ALTERNATE_IDEMPOTENCY_KEY }),
    });
    assert.equal(second.result, "reconciliation_required");
    if (second.result !== "reconciliation_required") return;
    assert.equal(second.reason, "payload_digest_mismatch");
  } finally {
    await rm(missionDir, { recursive: true, force: true });
  }
});

test("crash before resource_cleanup_pending blocks a different idempotency key without appending pending", async () => {
  const missionDir = await tempMissionDir();
  try {
    const actionRequest = terminateResourceAction();
    const attempt = actionAttempt();
    const decision = allowedPolicyDecision();
    const lockId = "test_crash_before_pending";
    await appendFoundation0Event({
      missionDir,
      missionId: MISSION_ID,
      eventType: "action_requested",
      entityType: "action",
      entityId: ACTION_ID,
      payload: actionRequest,
      actionId: ACTION_ID,
      idempotencyKey: "crash_before_pending_action_requested",
      lockId,
    });
    await appendFoundation0Event({
      missionDir,
      missionId: MISSION_ID,
      eventType: "action_attempt_started",
      entityType: "action",
      entityId: ACTION_ATTEMPT_ID,
      payload: attempt,
      actionId: ACTION_ID,
      actionAttemptId: ACTION_ATTEMPT_ID,
      idempotencyKey: "crash_before_pending_attempt_started",
      lockId,
    });
    await appendFoundation0Event({
      missionDir,
      missionId: MISSION_ID,
      eventType: "policy_decision_recorded",
      entityType: "action",
      entityId: POLICY_DECISION_ID,
      payload: decision,
      actionId: ACTION_ID,
      actionAttemptId: ACTION_ATTEMPT_ID,
      policyDecisionId: POLICY_DECISION_ID,
      idempotencyKey: "crash_before_pending_policy_decision",
      lockId,
    });

    const result = await acquireCleanupAttempt({
      missionDir,
      ...defaultArgs({ idempotencyKey: ALTERNATE_IDEMPOTENCY_KEY }),
    });

    assert.equal(result.result, "reconciliation_required");
    if (result.result !== "reconciliation_required") return;
    assert.equal(result.reason, "crash_before_cleanup_pending");
    assert.equal(result.events.length, 0);
    const events = await readFoundation0Events(missionDir);
    assert.equal(
      events.filter((event) => event.event_type === "resource_cleanup_pending").length,
      0,
    );
  } finally {
    await rm(missionDir, { recursive: true, force: true });
  }
});

test("non-ID-safe acquisition idempotency key is rejected before append", async () => {
  const missionDir = await tempMissionDir();
  try {
    await assert.rejects(
      () =>
        acquireCleanupAttempt({
          missionDir,
          ...defaultArgs({ idempotencyKey: "bad:key" }),
        }),
      Foundation0ValidationError,
    );
    assert.deepEqual(await readActiveCleanupAttempts(missionDir), []);
  } finally {
    await rm(missionDir, { recursive: true, force: true });
  }
});

test("partial event log returns reconciliation_required instead of throwing or acquiring", async () => {
  const missionDir = await tempMissionDir();
  try {
    await acquireCleanupAttempt({ missionDir, ...defaultArgs() });
    const paths = foundation0StoragePaths(missionDir);
    await writeFile(paths.eventLogPath, "{\"schema_version\":1", { flag: "a" });

    const result = await acquireCleanupAttempt({
      missionDir,
      ...defaultArgs({ idempotencyKey: ALTERNATE_IDEMPOTENCY_KEY }),
    });

    assert.equal(result.result, "reconciliation_required");
    if (result.result !== "reconciliation_required") return;
    assert.equal(result.reason, "partial_event_log");
    assert.equal(result.events.length, 0);
  } finally {
    await rm(missionDir, { recursive: true, force: true });
  }
});

// ============================================================ concurrency

test("Promise.all with mixed idempotency keys leaves exactly one active attempt", async () => {
  const missionDir = await tempMissionDir();
  try {
    const results = await Promise.all([
      acquireCleanupAttempt({ missionDir, ...defaultArgs() }),
      acquireCleanupAttempt({ missionDir, ...defaultArgs() }),
      acquireCleanupAttempt({
        missionDir,
        ...defaultArgs({ idempotencyKey: ALTERNATE_IDEMPOTENCY_KEY }),
      }),
      acquireCleanupAttempt({
        missionDir,
        ...defaultArgs({ idempotencyKey: ALTERNATE_IDEMPOTENCY_KEY }),
      }),
    ]);

    const acquired = results.filter((r) => r.result === "acquired");
    const replayed = results.filter((r) => r.result === "idempotent_replay");
    const conflict = results.filter((r) => r.result === "cleanup_in_progress");

    // Race outcome is non-deterministic; the only invariants are:
    // 1) exactly one acquirer wins, 2) one same-key runner-up replays,
    // 3) both calls from the OTHER key report cleanup_in_progress.
    assert.equal(acquired.length, 1, "exactly one acquired result");
    assert.equal(replayed.length, 1, "exactly one idempotent_replay");
    assert.equal(conflict.length, 2, "exactly two cleanup_in_progress");
    assert.equal(
      acquired.length + replayed.length + conflict.length,
      4,
      "every Promise.all result must be one of the three outcomes",
    );

    const active = await readActiveCleanupAttempts(missionDir);
    assert.equal(active.length, 1, "exactly one active attempt after replay");
    if (acquired[0]?.result === "acquired") {
      assert.equal(
        active[0]?.idempotency_key,
        acquired[0].attempt.idempotency_key,
        "active attempt key matches the acquirer's key",
      );
    }
  } finally {
    await rm(missionDir, { recursive: true, force: true });
  }
});
