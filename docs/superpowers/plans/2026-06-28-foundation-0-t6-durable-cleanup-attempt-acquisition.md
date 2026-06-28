# Foundation-0 T6 Durable Cleanup-Attempt Acquisition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a durable, replayable cleanup-attempt acquisition primitive keyed by `mission_id + resource_id + identity_digest`, without performing any real cleanup effects.

**Architecture:** T6 stays inside isolated Foundation-0 runtime code. It uses the existing mission event log, payload digest binding, and lockfile primitives to append action/acquisition events under durable serialization, then reconstructs active cleanup attempts from canonical events. It also stabilizes stale-lock tests before adding acquisition logic, per 5.5pro review feedback.

**Tech Stack:** TypeScript with Node's built-in `node:test`; existing Foundation-0 modules under `packages/pi-topology/src/runtime/foundation0/`; no new package dependencies.

## Global Constraints

- T6 is a pre-effectful control-plane task.
- No real process spawn.
- No Ghostty launch.
- No Pi topology spawn.
- No `topology_spawn_role`.
- No v0.5 runtime integration.
- No process signal, `process.kill`, `kill`, `pkill`, `killall`, or process-group signal.
- No temp-directory creation as a managed resource.
- No temp-directory quarantine, recursive delete, unlink, rmdir, rm, or cleanup.
- No cleanup execution.
- No package dependency changes.
- No commit, push, publish, broad cleanup, dogfood, or branch merge from the Coder thread.
- Durable cleanup-attempt acquisition must happen before any later real signal/delete/temp cleanup.
- Durable acquisition must serialize by `mission_id + resource_id + identity_digest`.
- Same idempotency key must be idempotent.
- Different idempotency key while active must return `cleanup_in_progress`.
- Interrupted or indeterminate attempts must be reconstructed as active/reconciliation-required, not blindly retried.

---

## Context

5.5pro approved T1-T5 as a coherent pre-effects foundation and approved T6 as the next task, with this boundary:

```text
T6: Durable Cleanup-Attempt Acquisition
Scope: no real cleanup effects
```

5.5pro also recommended stabilizing the prior stale-lock timing flake before T6 merge:

```text
stale-lock tests must be deterministic under repeated local runs
```

Contract references:

- `docs/T1-T5-5.5-review-feedback.md`
- `docs/2026-06-28-foundation-0-before-effects-review-brief.md`
- `docs/19-pi-topology-v0.6-foundation-0-first-slice-contract.md` §8.1 cleanup attempt rules
- `docs/20-pi-topology-v0.6-foundation-0-first-slice-contract-closure.md` §10 active cleanup attempt and §11 reconciliation model
- `docs/superpowers/plans/2026-06-26-foundation-0-t2-t3-followups-before-effects.md` Follow-Up 4
- `records/2026-06-26-foundation-0-t5-before-effects-hardening.md`

Doc 20 supersedes conflicting first-slice semantics in doc 19.

## File Map

Allowed implementation files:

- Modify: `packages/pi-topology/src/runtime/foundation0/lockfile.ts`
  - Add a deterministic stale-age clock injection for tests while keeping timeout behavior on real elapsed time.
- Modify: `packages/pi-topology/src/runtime/foundation0/schema.ts`
  - Add minimal T6 runtime types if needed for cleanup acquisition payloads/projections.
- Modify: `packages/pi-topology/src/runtime/foundation0/validation.ts`
  - Add validators only for any new T6 payload/projection objects introduced in `schema.ts`.
- Modify: `packages/pi-topology/src/runtime/foundation0/event-append.ts`
  - Add a reusable payload reader if needed by replay; keep existing append semantics unchanged.
- Create: `packages/pi-topology/src/runtime/foundation0/cleanup-attempt-acquisition.ts`
  - Implement durable acquisition, idempotency/conflict handling, and replay projection.

Allowed test/report files:

- Modify: `packages/pi-topology/test/unit/foundation0/lockfile.test.ts`
  - Make stale-lock tests deterministic and repeatable.
- Create: `packages/pi-topology/test/unit/foundation0/cleanup-attempt-acquisition.test.ts`
  - Cover acquisition, idempotent replay, conflict, replay, and corrupt/missing payload handling.
- Create: `records/2026-06-28-foundation-0-t6-durable-cleanup-attempt-acquisition.md`
  - Coder implementation report with commands and results.

Minimal import/export adjustments inside `packages/pi-topology/src/runtime/foundation0/` are allowed if needed.

## Runtime Model

T6 should reuse existing first-slice objects rather than inventing a new event catalog:

- `action_requested` records the terminate-resource ActionRequest.
- `action_attempt_started` records the cleanup ActionAttempt.
- `policy_decision_recorded` records the execution-boundary PolicyDecision.
- `resource_cleanup_pending` records that this resource identity pair has an active cleanup attempt.
- `reconciliation_required` may be used for replay/corruption/indeterminate states where no safe retry is allowed.

Active cleanup attempt definition from doc 20:

```text
action_attempt_started exists
AND no final non-indeterminate terminal resolution exists
```

For T6, no real effect and no terminal cleanup outcome should be written. An acquired attempt therefore remains active until a later task records a terminal outcome or reconciliation resolution.

## Proposed Interfaces

The Coder may refine names, but preserve these semantics.

```ts
export interface CleanupAttemptKey {
  mission_id: string;
  resource_id: string;
  identity_digest: string;
}

export interface ActiveCleanupAttempt {
  mission_id: string;
  resource_id: string;
  identity_digest: string;
  idempotency_key: string;
  action_id: string;
  action_attempt_id: string;
  policy_decision_id: string;
  started_at: string;
  state: "active" | "reconciliation_required";
  blocking_event_ids: string[];
}

export type CleanupAttemptAcquisitionResult =
  | {
      result: "acquired";
      attempt: ActiveCleanupAttempt;
      events: Event[];
    }
  | {
      result: "idempotent_replay";
      attempt: ActiveCleanupAttempt;
      events: Event[];
    }
  | {
      result: "cleanup_in_progress";
      active_attempt: ActiveCleanupAttempt;
      policy_decision: PolicyDecision;
      events: Event[];
    }
  | {
      result: "reconciliation_required";
      attempt: ActiveCleanupAttempt;
      reason: "missing_payload" | "payload_digest_mismatch" | "partial_event_log" | "unsupported_schema";
      events: Event[];
    };

export interface AcquireCleanupAttemptInput {
  missionDir: string;
  actionRequest: TerminateResourceAction;
  actionAttempt: ActionAttempt;
  allowedDecision: PolicyDecision;
  cleanupInProgressDecision: PolicyDecision;
  resourceId: string;
  identityDigest: string;
  idempotencyKey?: string;
  lockTimeoutMs?: number;
  lockRetryDelayMs?: number;
  lockStaleMs?: number;
}

export async function acquireCleanupAttempt(
  input: AcquireCleanupAttemptInput,
): Promise<CleanupAttemptAcquisitionResult>;

export async function readActiveCleanupAttempts(
  missionDir: string,
): Promise<ActiveCleanupAttempt[]>;
```

Validation rules:

- `actionRequest.payload_kind` must be `terminate_resource`.
- `actionRequest.capability` must be `terminate_resource`.
- `actionRequest.target.entity_type` must be `resource`.
- `actionRequest.target.resource_id` must equal `resourceId`.
- `actionRequest.mission_id`, `actionAttempt.mission_id`, `allowedDecision.mission_id`, and `cleanupInProgressDecision.mission_id` must match.
- `actionAttempt.action_id`, `allowedDecision.action_id`, and `cleanupInProgressDecision.action_id` must match `actionRequest.action_id`.
- `allowedDecision.action_attempt_id` and `cleanupInProgressDecision.action_attempt_id` must match `actionAttempt.action_attempt_id`.
- `allowedDecision.evaluation_point` and `cleanupInProgressDecision.evaluation_point` must be `execution`.
- Only `allowedDecision.result === "allowed"` can acquire.
- Only `cleanupInProgressDecision.result === "cleanup_in_progress"` can be recorded for a conflict result.
- `identityDigest` must pass Foundation-0 digest validation.
- The active-attempt key is `mission_id + resource_id + identity_digest`.

## Task 1: Stabilize Stale-Lock Tests

**Files:**

- Modify: `packages/pi-topology/src/runtime/foundation0/lockfile.ts`
- Modify: `packages/pi-topology/test/unit/foundation0/lockfile.test.ts`

**Interfaces:**

- Consumes: existing `LockOptions`, `acquireLock`, `withLock`.
- Produces: deterministic stale-age evaluation for tests without changing lock timeout behavior.

- [ ] **Step 1: Write/adjust failing deterministic stale-lock test**

Add a test case that proves stale evaluation does not depend on wall-clock timing jitter.

Example test shape:

```ts
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

    assert.equal((await readLockMetadata(lockPath))?.holder_nonce, acquired.metadata.holder_nonce);
    await acquired.release();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the focused lockfile test**

Run from `packages/pi-topology/`:

```bash
node --experimental-strip-types --test test/unit/foundation0/lockfile.test.ts
```

Expected before implementation: TypeScript/runtime failure because `staleNowMs` is not part of `LockOptions`.

- [ ] **Step 3: Implement deterministic stale-age clock**

In `lockfile.ts`, extend `LockOptions`:

```ts
export interface LockOptions {
  lockId: string;
  missionId: string;
  purpose: Foundation0LockPurpose;
  timeoutMs: number;
  retryDelayMs?: number;
  staleMs?: number;
  staleNowMs?: () => number;
  holderProbe?: Foundation0HolderProbe;
  onStaleLockIncident?: (incident: Foundation0StaleLockIncident) => void;
}
```

Keep acquisition timeout on real elapsed time. Use `staleNowMs` only when evaluating stale age:

```ts
function isStale(
  metadata: Foundation0LockMetadata | null,
  mtimeMs: number,
  staleMs: number,
  nowMs: number,
): boolean {
  const createdAtMs = metadata === null ? Number.NaN : Date.parse(metadata.created_at);
  const timestampMs = Number.isFinite(createdAtMs) ? createdAtMs : mtimeMs;
  return nowMs - timestampMs > staleMs;
}
```

Then call it from `cleanupStaleLock` with:

```ts
const nowMs = options.staleNowMs?.() ?? Date.now();
if (!isStale(metadata, lockStat.mtimeMs, staleMs, nowMs)) return;
```

- [ ] **Step 4: Run repeated stale-lock verification**

Run from `packages/pi-topology/`:

```bash
node --experimental-strip-types --test test/unit/foundation0/lockfile.test.ts
```

Expected: PASS.

Then repeat the same command at least 5 times manually or with a local loop. Record results in the T6 report.

## Task 2: Define Cleanup Acquisition Types And Validators

**Files:**

- Modify: `packages/pi-topology/src/runtime/foundation0/schema.ts`
- Modify: `packages/pi-topology/src/runtime/foundation0/validation.ts`
- Create: `packages/pi-topology/test/unit/foundation0/cleanup-attempt-acquisition.test.ts`

**Interfaces:**

- Consumes: existing `TerminateResourceAction`, `ActionAttempt`, `PolicyDecision`, `Event`, digest/ID/timestamp validators.
- Produces: typed acquisition key/projection payloads and validation helpers used by the acquisition module.

- [ ] **Step 1: Write validator tests first**

Add tests that assert:

- a valid acquisition payload validates;
- `identity_digest` must be a digest;
- mismatched `mission_id`, `resource_id`, `action_id`, or `action_attempt_id` rejects;
- non-terminate action rejects;
- non-execution policy decision rejects;
- non-allowed `allowedDecision` cannot acquire;
- non-`cleanup_in_progress` `cleanupInProgressDecision` cannot be recorded as conflict.

Use fixed timestamps and digests in fixtures.

- [ ] **Step 2: Run the new focused test**

Run from `packages/pi-topology/`:

```bash
node --experimental-strip-types --test test/unit/foundation0/cleanup-attempt-acquisition.test.ts
```

Expected before implementation: FAIL because the module/types do not exist.

- [ ] **Step 3: Add minimal schema types**

Prefer keeping these as runtime helper types if they do not need to be first-slice schema objects. If validators need exported shapes, add:

```ts
export interface CleanupAttemptAcquisitionPayload {
  schema_version: 1;
  mission_id: string;
  resource_id: string;
  identity_digest: string;
  idempotency_key: string;
  action_id: string;
  action_attempt_id: string;
  policy_decision_id: string;
  acquired_at: string;
}
```

Do not add a new event type unless the contract is updated. Use existing `resource_cleanup_pending` for the durable acquisition payload.

- [ ] **Step 4: Add validation helper**

If the payload type is added, implement:

```ts
export function validateCleanupAttemptAcquisitionPayload(
  input: unknown,
): CleanupAttemptAcquisitionPayload;
```

Validation must enforce:

- `schema_version === 1`;
- all IDs pass `validateId`;
- `identity_digest` passes `validateDigest`;
- `acquired_at` passes `validateTimestamp`;
- `additionalProperties: false`.

- [ ] **Step 5: Run schema/validator tests**

Run from `packages/pi-topology/`:

```bash
node --experimental-strip-types --test test/unit/foundation0/cleanup-attempt-acquisition.test.ts
node --experimental-strip-types --test test/unit/foundation0/*.test.ts
```

Expected: PASS.

## Task 3: Implement Durable Acquisition And Idempotency

**Files:**

- Create: `packages/pi-topology/src/runtime/foundation0/cleanup-attempt-acquisition.ts`
- Modify: `packages/pi-topology/test/unit/foundation0/cleanup-attempt-acquisition.test.ts`
- Modify: `packages/pi-topology/src/runtime/foundation0/event-append.ts` only if a reusable payload reader is needed.

**Interfaces:**

- Consumes: `appendFoundation0Event`, `readFoundation0Events`, `foundation0StoragePaths`, existing validators, `withLock`.
- Produces: `acquireCleanupAttempt(input)` and `readActiveCleanupAttempts(missionDir)`.

- [ ] **Step 1: Write acquisition tests first**

Cover these cases:

```text
allowed terminate_resource acquisition appends action_requested, action_attempt_started,
policy_decision_recorded, and resource_cleanup_pending events
```

```text
same idempotency key returns idempotent_replay and does not append a second active attempt
```

```text
different idempotency key for same mission/resource/identity while active returns cleanup_in_progress
and records a cleanup_in_progress execution PolicyDecision without resource_cleanup_pending
```

```text
same resource_id with different identity_digest can acquire independently
```

```text
same identity_digest with different resource_id can acquire independently
```

- [ ] **Step 2: Run acquisition tests and confirm failure**

Run from `packages/pi-topology/`:

```bash
node --experimental-strip-types --test test/unit/foundation0/cleanup-attempt-acquisition.test.ts
```

Expected before implementation: FAIL because `acquireCleanupAttempt` is missing or incomplete.

- [ ] **Step 3: Implement replay projection**

Implement `readActiveCleanupAttempts(missionDir)`.

Projection behavior:

- Read canonical events in sequence.
- Load and digest-verify payloads needed for cleanup acquisition projection.
- Track active attempts by `mission_id + resource_id + identity_digest`.
- Treat `resource_cleanup_pending` with acquisition payload as active.
- Treat later final terminal events for the same `action_attempt_id` as clearing active state only if they are non-indeterminate terminal outcomes or reconciliation resolutions.
- For T6 tests, no terminal cleanup effect should be generated, so acquired attempts remain active.
- Missing payload or digest mismatch must produce a reconciliation-required projection result in acquisition flow and must not authorize a new destructive attempt.

If `event-append.ts` gets a payload reader, keep it read-only:

```ts
export async function readFoundation0EventPayload(
  missionDir: string,
  event: Event,
): Promise<unknown>;
```

It should reuse existing payload path conventions and digest checks.

- [ ] **Step 4: Implement acquisition under serialization**

`acquireCleanupAttempt(input)` must:

1. Validate `actionRequest`, `actionAttempt`, `allowedDecision`, `cleanupInProgressDecision`, and `identityDigest`.
2. Acquire a lock with purpose `cleanup_attempt_acquisition`.
3. Re-read active cleanup attempts while holding the lock.
4. If same key and same idempotency key exists, return `idempotent_replay`.
5. If same key and different idempotency key exists, append a `policy_decision_recorded` event for `cleanupInProgressDecision`, then return `cleanup_in_progress`.
6. If no active attempt exists, append:
   - `action_requested`
   - `action_attempt_started`
   - `policy_decision_recorded` for `allowedDecision`
   - `resource_cleanup_pending`
7. Return `acquired`.

Use deterministic idempotency keys per event, for example:

```ts
`cleanup_attempt:${missionId}:${resourceId}:${identityDigest}:${idempotencyKey}:action_requested`
`cleanup_attempt:${missionId}:${resourceId}:${identityDigest}:${idempotencyKey}:attempt_started`
`cleanup_attempt:${missionId}:${resourceId}:${identityDigest}:${idempotencyKey}:policy_decision`
`cleanup_attempt:${missionId}:${resourceId}:${identityDigest}:${idempotencyKey}:cleanup_pending`
```

Append events through `appendFoundation0Event`; do not write JSONL manually.

- [ ] **Step 5: Verify no real effects are introduced**

Run from repo root:

```bash
rg -n "process\\.kill|\\bkill\\b|\\bpkill\\b|\\bkillall\\b|topology_spawn_role|Ghostty|spawn\\(|process\\.spawn|child_process\\.spawn|rm\\(|unlink\\(|rmdir\\(" packages/pi-topology/src/runtime/foundation0 packages/pi-topology/test/unit/foundation0
```

Expected: no matches except safe existing lockfile test cleanup imports/usages. If `unlink` appears only in lockfile internals/tests, explain that in the report.

## Task 4: Add Replay And Crash-Boundary Tests

**Files:**

- Modify: `packages/pi-topology/test/unit/foundation0/cleanup-attempt-acquisition.test.ts`

**Interfaces:**

- Consumes: `readActiveCleanupAttempts`, `acquireCleanupAttempt`, existing event append/read helpers.
- Produces: confidence that crash/interruption states are replayable and block blind retry.

- [ ] **Step 1: Add replay tests**

Cover:

- `readActiveCleanupAttempts` reconstructs an active attempt after a fresh module call.
- Active attempt survives process-local memory loss because it is reconstructed from canonical events.
- If an `action_attempt_started` exists without final terminal outcome, new different idempotency key returns `cleanup_in_progress`.
- If payload is missing or digest-mismatched for an acquisition event, acquisition returns/reports `reconciliation_required` and does not append `resource_cleanup_pending`.

- [ ] **Step 2: Add concurrency test**

Use `Promise.all` with multiple acquisitions for the same `resource_id + identity_digest`.

Expected:

- exactly one result is `acquired`;
- same idempotency-key callers may be `idempotent_replay`;
- different idempotency-key callers are `cleanup_in_progress`;
- only one active attempt exists after replay.

- [ ] **Step 3: Run focused and foundation tests**

Run from `packages/pi-topology/`:

```bash
node --experimental-strip-types --test test/unit/foundation0/cleanup-attempt-acquisition.test.ts
node --experimental-strip-types --test test/unit/foundation0/*.test.ts
```

Expected: PASS.

## Task 5: Report And Verification

**Files:**

- Create: `records/2026-06-28-foundation-0-t6-durable-cleanup-attempt-acquisition.md`

**Interfaces:**

- Consumes: implementation and test results.
- Produces: Coder report for Reviewer/HQ.

- [ ] **Step 1: Create the report**

Report must include:

- task doc path;
- files changed;
- statement that T6 implemented no real cleanup effects;
- stale-lock deterministic stabilization summary;
- acquisition/replay/conflict behavior summary;
- known limitations;
- exact verification commands and results.

- [ ] **Step 2: Run required verification**

Run from `packages/pi-topology/`:

```bash
node --experimental-strip-types --test test/unit/foundation0/lockfile.test.ts
node --experimental-strip-types --test test/unit/foundation0/cleanup-attempt-acquisition.test.ts
node --experimental-strip-types --test test/unit/foundation0/*.test.ts
npm run typecheck
node --experimental-strip-types --test test/unit/*.test.ts test/unit/foundation0/*.test.ts test/integration/foundation0/*.test.ts
```

Run from repo root:

```bash
rg -n "process\\.kill|\\bkill\\b|\\bpkill\\b|\\bkillall\\b|topology_spawn_role|Ghostty|spawn\\(|process\\.spawn|child_process\\.spawn" packages/pi-topology/src/runtime/foundation0 packages/pi-topology/test/unit/foundation0
```

Expected: no forbidden effectful APIs. Record any benign matches and why they are not new effectful behavior.

- [ ] **Step 3: Final Coder handoff**

Send HQ:

- short implementation summary;
- report path;
- verification summary;
- any residual risk;
- explicit statement that no commit/push was performed.

## Acceptance Criteria

- Stale-lock tests are deterministic under repeated local runs.
- `acquireCleanupAttempt` serializes by `mission_id + resource_id + identity_digest`.
- Same idempotency key is idempotent.
- Different idempotency key while active returns `cleanup_in_progress`.
- Acquisition state is durable and replayable from canonical event storage.
- Missing/corrupt payload state routes to reconciliation-required handling and never authorizes blind retry.
- No real signal/delete/spawn/temp cleanup/v0.5 integration is implemented.
- Required tests and typecheck pass.
- Coder report exists at `records/2026-06-28-foundation-0-t6-durable-cleanup-attempt-acquisition.md`.

## Reviewer Focus

Reviewer should check:

- T6 did not broaden scope into real effects.
- Lock timing stabilization does not affect lock timeout behavior.
- Acquisition lock is durable and uses `cleanup_attempt_acquisition`.
- Replay uses canonical events and payload digest verification.
- Conflict behavior records `cleanup_in_progress` without creating a second active attempt.
- The implementation does not treat missing/corrupt payloads as safe retry conditions.
- Tests prove idempotency, conflict, replay, and no-effect boundaries.
