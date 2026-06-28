# Foundation-0 T6 Durable Cleanup-Attempt Acquisition — Coder Report

> **Task doc:** `docs/superpowers/plans/2026-06-28-foundation-0-t6-durable-cleanup-attempt-acquisition.md`
> **Status:** complete after Reviewer REQUEST CHANGES revisions; ready for HQ.
> **Checkout:** `master` with T6 working-tree changes present (no commit, no push).

## Scope Statement

T6 implemented exactly the boundary 5.5pro approved:

```text
T6: Durable Cleanup-Attempt Acquisition
Scope: no real cleanup effects
```

No real spawn, signal, delete, temp cleanup, Ghostty launch, Pi topology spawn, `topology_spawn_role`, v0.5 runtime integration, dogfood, package dependency change, or branch merge was performed.

## Files Changed

```text
packages/pi-topology/src/runtime/foundation0/lockfile.ts
packages/pi-topology/src/runtime/foundation0/schema.ts
packages/pi-topology/src/runtime/foundation0/validation.ts
packages/pi-topology/src/runtime/foundation0/event-append.ts
packages/pi-topology/src/runtime/foundation0/cleanup-attempt-acquisition.ts
packages/pi-topology/test/unit/foundation0/lockfile.test.ts
packages/pi-topology/test/unit/foundation0/cleanup-attempt-acquisition.test.ts
records/2026-06-28-foundation-0-t6-durable-cleanup-attempt-acquisition.md
```

## Summary of Changes

### Task 1 — Stale-lock deterministic stabilization

5.5pro required stale-lock tests to be deterministic before T6 merge. The
existing `isStale` was wall-clock based, which leaked wall-clock jitter
into the stale-age decision.

- `LockOptions.staleNowMs?: () => number` — optional clock consulted ONLY
  for stale-age evaluation. Acquisition timeouts continue to use real
  `Date.now()` so timeout semantics are unchanged.
- `isStale(metadata, mtimeMs, staleMs, nowMs)` — explicit `nowMs` parameter
  replaces the implicit `Date.now()` read.
- `cleanupStaleLock` reads `options.staleNowMs?.() ?? Date.now()` and passes
  it to `isStale`.

Stability was verified by running the lockfile test 8 times in a row — all
8 runs reported `tests 10 / pass 10 / fail 0` with no timing flake. The
test file gained two new tests:

- `stale lock age can be evaluated with deterministic test clock` — uses
  `staleNowMs: () => Date.parse("2026-06-28T00:00:00.011Z")` to prove stale
  evaluation does not depend on wall-clock timing jitter.
- `stale lock age is not considered stale when injected clock reports young age` —
  uses `staleNowMs: () => Date.parse("2026-06-28T00:00:00.500Z")` with
  `staleMs: 60_000` to prove the injected clock is actually consulted (a
  wall-clock-only implementation would have removed the lock here).

### Task 2 — Acquisition types and validators

- `schema.ts`: added the helper type `CleanupAttemptAcquisitionPayload`
  (`schema_version: 1`) for the `resource_cleanup_pending` payload. No
  new first-slice event type was introduced; the durable event still uses
  `resource_cleanup_pending` per the doc 20 contract.
- `validation.ts`: added `validateCleanupAttemptAcquisitionPayload` and
  the `CLEANUP_ATTEMPT_ACQUISITION_PAYLOAD_KEYS` allow-list. Validates
  schema_version, all IDs, the digest, the timestamp, and rejects
  additional properties.

### Task 3 — Durable acquisition, idempotency, and conflict handling

- `event-append.ts`: added `readFoundation0EventPayload(missionDir, event)`,
  a read-only helper that returns the parsed payload after digest
  verification. Throws `MissingPayloadError` and `PayloadDigestMismatchError`
  on the corresponding failure modes; existing append semantics are
  unchanged.
- `cleanup-attempt-acquisition.ts` (new): implements
  `acquireCleanupAttempt(input)` and `readActiveCleanupAttempts(missionDir)`.
  The module:
  - Validates the cross-field shape contract of the four supplied objects
    before any lock is taken.
  - Acquires `cleanup-attempt.lock` with
    `purpose: "cleanup_attempt_acquisition"` and a stable bounded
    `cleanup_acq_<sha256>` metadata lockId derived from
    `mission_id + resource_id`.
  - Re-reads active attempts under the lock, then dispatches to one of
    `acquired`, `idempotent_replay`, `cleanup_in_progress`, or
    `reconciliation_required`.
  - Records a conflict `policy_decision_recorded` event when an active
    attempt exists with a different idempotency key, and explicitly does
    NOT append a second `resource_cleanup_pending`.
  - Uses `appendFoundation0Event` for every event write so the
    canonical-event-append semantics, fsync ordering, and lock-file
    invariants established by T2/T5 are preserved.
- `readActiveCleanupAttempts(missionDir)` walks the canonical event log
  and projects active attempts per `(mission_id, resource_id,
  identity_digest)`. Attempts whose `resource_cleanup_pending` payload is
  missing or digest-mismatched are surfaced with
  `state: "reconciliation_required"`, never silently retried.

### Reviewer REQUEST CHANGES revision

The rework closed the three reviewer findings:

- Crash before `resource_cleanup_pending`: replay now detects
  `action_requested + action_attempt_started + allowed execution
  policy_decision_recorded` without a matching pending event. Because the
  missing pending payload means the exact `identity_digest` binding cannot
  be proven from durable state, acquisition returns
  `reconciliation_required / crash_before_cleanup_pending` and appends no
  second pending event.
- Durable idempotency key validation: `AcquireCleanupAttemptInput`
  `idempotencyKey`, when supplied, must pass Foundation-0 `validateId()`.
  The default remains the already-validated `actionRequest.idempotency_key`.
  This prevents writing a payload that the replay validator cannot later
  read.
- Partial event log: `PartialEventLogError` from canonical event replay is
  converted into `reconciliation_required / partial_event_log`, with no
  acquisition side effects.

### Reviewer re-review REQUEST CHANGES revision

The rework closed the long-ID lock metadata finding:

- T6 no longer concatenates `mission_id` / `resource_id` directly into
  lock metadata IDs. Both the outer `cleanup-attempt.lock` metadata lockId
  and nested event-append metadata lockIds now use a stable
  `cleanup_acq_<32 hex sha256>` helper validated by Foundation-0
  `validateId()`.
- The lock path stays unchanged; only metadata `lock_id` construction was
  changed.
- The conflict-policy append path also uses the bounded event-append
  lockId helper, so all T6 event writes share the same ID-safe lock
  metadata shape.

### Task 4 — Replay and crash-boundary tests

The test file `cleanup-attempt-acquisition.test.ts` covers:

- Validator shape, additional-property rejection, and digest/ID/timestamp
  grammar.
- Cross-field validation rejection: mismatched mission_id / action_id /
  action_attempt_id, non-terminate capability, non-execution decision,
  non-allowed acquire, non-`cleanup_in_progress` conflict, mismatched
  target.resource_id, non-digest identity_digest.
- Acquisition happy path: writes `action_requested`,
  `action_attempt_started`, `policy_decision_recorded`,
  `resource_cleanup_pending` and returns the same four events. The
  `started_at` is asserted to equal the deterministic `ACQUIRED_AT`
  constant via the `nowIso` clock injected by `defaultArgs`.
- `idempotent_replay` for the same idempotency key (no second pending).
- Long valid Foundation-0 IDs: outer cleanup lock metadata is readable
  while held, release removes `cleanup-attempt.lock`, nested event-append
  lock metadata is releasable, and same-key replay does not timeout.
- `cleanup_in_progress` for a different idempotency key on the same
  `(mission, resource, identity)` triple (one `policy_decision_recorded`,
  no second pending).
- Same resource_id with different identity_digest: independent
  acquisition.
- Same identity_digest with different resource_id: independent
  acquisition.
- Replay after a fresh module call: `readActiveCleanupAttempts`
  reconstructs the active attempt from canonical events.
- Crash boundary: missing payload → `reconciliation_required` and no new
  acquisition.
- Crash boundary: digest-mismatched payload → `reconciliation_required`
  and no new acquisition.
- Crash boundary before `resource_cleanup_pending` → conservative
  `reconciliation_required` and no second pending/acquire.
- Non-ID-safe acquisition idempotency key → validation failure before any
  append; replay remains clean.
- Partial trailing event log → `reconciliation_required` and no blind retry.
- Concurrency: `Promise.all` over mixed idempotency keys leaves exactly
  one active attempt and dispatches the others as `idempotent_replay` /
  `cleanup_in_progress`.

## Verification

```text
# focused — Task 1 + Tasks 2/3/4
node --experimental-strip-types --test test/unit/foundation0/lockfile.test.ts
  tests 10 / pass 10 / fail 0
node --experimental-strip-types --test test/unit/foundation0/cleanup-attempt-acquisition.test.ts
  tests 26 / pass 26 / fail 0

# foundation0 (full unit subdirectory)
node --experimental-strip-types --test test/unit/foundation0/*.test.ts
  tests 84 / pass 84 / fail 0

# full unit + foundation0 + integration
node --experimental-strip-types --test test/unit/*.test.ts \
                                    test/unit/foundation0/*.test.ts \
                                    test/integration/foundation0/*.test.ts
  tests 462 / pass 462 / fail 0

# typecheck
npm run typecheck
  strip-types import ok

# forbidden-effect scan from repo root
rg -n "process\\.kill|\\bkill\\b|\\bpkill\\b|\\bkillall\\b|topology_spawn_role|Ghostty|spawn\\(|process\\.spawn|child_process\\.spawn" \
  packages/pi-topology/src/runtime/foundation0 \
  packages/pi-topology/test/unit/foundation0
  no matches (rg exit 1)
```

## Acceptance Criteria Mapping

| Criterion | Evidence |
|---|---|
| Stale-lock tests deterministic under repeated runs | 5/5 and 8/8 lockfile reruns reported `pass 10 / fail 0`. New tests use the injected `staleNowMs` clock; wall-clock cannot affect the verdict. |
| `acquireCleanupAttempt` serializes by `mission_id + resource_id + identity_digest` | Validation enforces the triple; `cleanup-attempt.lock` lock metadata ID is a bounded hash of mission/resource; conflict/idempotent decision is by triple. |
| Same idempotency key is idempotent | Test 15 (`same idempotency key returns idempotent_replay without appending a new active attempt`) and the projection verify zero new pending events. |
| Long valid Foundation-0 IDs do not create unreleasable T6 lock metadata | Test 16 uses 110-character valid mission/resource IDs, reads non-null `cleanup-attempt.lock` metadata while held, verifies the lock is removed after release, verifies the nested mission-events lock is removed, and same-key replay does not timeout. |
| Different idempotency key while active returns `cleanup_in_progress` | Test 17 verifies `cleanup_in_progress` plus one `policy_decision_recorded` and no new pending event. |
| Acquisition state durable and replayable from canonical event storage | Test 20 verifies `readActiveCleanupAttempts` reconstructs an active attempt across a fresh module call. |
| Missing/corrupt payload → `reconciliation_required`, no blind retry | Tests 21 and 22 cover missing and digest-mismatched payloads; both return `reconciliation_required` and do not append a second `resource_cleanup_pending`. |
| No real signal / delete / spawn / temp cleanup / v0.5 integration | Forbidden-effect scan: no `process.kill`, `kill`, `pkill`, `killall`, `topology_spawn_role`, `Ghostty`, `spawn(`, `process.spawn`, `child_process.spawn` in `foundation0` source or tests. |
| Crash before `resource_cleanup_pending` does not blind retry | Test 23 creates a log with `action_requested + action_attempt_started + allowed policy_decision_recorded` but no pending event; a different idempotency key returns `reconciliation_required / crash_before_cleanup_pending` and appends no pending event. |
| Non-ID-safe idempotency key cannot create unreplayable payload | Test 24 rejects `bad:key` before append and confirms `readActiveCleanupAttempts()` replays cleanly. |
| Partial event log returns `reconciliation_required` | Test 25 appends a partial trailing JSON row and verifies acquisition returns `reconciliation_required / partial_event_log` without acquiring. |
| Required tests and typecheck pass | 26 acquisition tests + 10 lockfile tests + 84 foundation0 unit + 462 unit+foundation0+integration + typecheck all green. |
| Coder report at `records/2026-06-28-foundation-0-t6-durable-cleanup-attempt-acquisition.md` | This file. |

## Residual Risk

- **Crash-before-pending reconciliation is conservative.** If durable
  state proves a started + allowed terminate attempt but lacks the
  `resource_cleanup_pending` payload, T6 cannot prove the exact
  `identity_digest` binding. The implementation blocks acquisition with
  `reconciliation_required` instead of treating it as active for a proven
  identity pair. A later reconciliation task should decide how to inspect
  or resolve that state.
- **No terminal outcome in T6.** T6 only records `acquired` and
  `cleanup_in_progress`; no `resource_cleaned`, `resource_cleanup_failed`,
  `reconciliation_resolved`, or `reconciliation_observed` event is
  written. Acquired attempts stay `state: "active"` until a later task
  emits a terminal outcome. Reviewer should confirm this is the intended
  pre-effectful boundary and not leave cleanup attempts dangling forever.

## Handoff

- No commit, push, or branch merge was performed.
- Checkout observed during revision: `master` with T6 working-tree changes present.
- Report: `records/2026-06-28-foundation-0-t6-durable-cleanup-attempt-acquisition.md`.
- Implementation: `packages/pi-topology/src/runtime/foundation0/cleanup-attempt-acquisition.ts`.
- Tests: `packages/pi-topology/test/unit/foundation0/cleanup-attempt-acquisition.test.ts`.
- Reviewer focus: see `docs/superpowers/plans/2026-06-28-foundation-0-t6-durable-cleanup-attempt-acquisition.md` §"Reviewer Focus" (T6 did not broaden scope into real effects; lock timing stabilization does not affect lock timeout behavior; acquisition lock is durable and uses `cleanup_attempt_acquisition`; replay uses canonical events and payload digest verification; conflict behavior records `cleanup_in_progress` without creating a second active attempt; the implementation does not treat missing/corrupt/partial/crash-before-pending durable state as safe retry conditions; tests prove idempotency, conflict, replay, and no-effect boundaries).
