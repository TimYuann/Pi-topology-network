# Foundation-0 T2 Event Lock And Append Report

Date: 2026-06-26
Role: Coder
Decision: ready_for_codex_review
Base: `67e74e8`

## Review Revision

After reviewer `REQUEST CHANGES`, T2 was tightened in two places:

- Payload files are now written to unique temp files in the same payload directory, fsynced, then moved to the final digest path. An unreferenced partial final payload left by a crash is repaired on retry; an already-referenced mismatched payload still fails with `PayloadDigestMismatchError`.
- Event log reads now enforce canonical file-order sequence invariants: row `0` must have sequence `0`, row `1` sequence `1`, and so on. Gaps, duplicates, and out-of-order rows fail with `SequenceInvariantError` before a new sequence is allocated.

## Files Changed

- `packages/pi-topology/src/runtime/foundation0/lockfile.ts`
- `packages/pi-topology/src/runtime/foundation0/event-append.ts`
- `packages/pi-topology/test/unit/foundation0/lockfile.test.ts`
- `packages/pi-topology/test/unit/foundation0/event-append.test.ts`
- `packages/pi-topology/test/integration/foundation0/concurrent-append.test.ts`
- `records/2026-06-26-foundation-0-t2-event-lock-append.md`

No package dependencies were added.

## Storage Layout

T2 uses the planned Foundation-0 local mission layout:

```text
<missionDir>/foundation0/runtime-events.jsonl
<missionDir>/foundation0/payloads/<payload_digest>.json
<missionDir>/foundation0/locks/mission-events.lock
```

Payload filenames use the full Foundation-0 digest string, for example `sha256:<64-hex>.json`.

## Lock Behavior

- `acquireLock` uses atomic lockfile creation with `O_CREAT | O_EXCL`.
- Lock metadata includes `holder_id`, caller `lock_id`, `pid`, and `created_at`.
- Acquisition retries with bounded timeout/backoff and throws `LockTimeoutError` on timeout.
- `releaseLock` is idempotent and only removes the lock when the current file still belongs to the releasing holder.
- Stale cleanup is guarded by stale threshold plus metadata/stat recheck before unlink.
- `withLock` wraps acquire/release around serialized async work.

## Event Append Behavior

- `appendFoundation0Event` acquires the mission event lock before reading/appending.
- The next mission-global `sequence` is allocated from the validated JSONL event log.
- Payload digest is recomputed from canonical JSON; caller digest hints are ignored.
- Payload content is written to a unique temp file, fsynced, then moved to the final content-addressed path before the event row is appended.
- If the final payload already exists, append verifies canonical content. If it is an unreferenced partial orphan, append repairs it; if it is referenced by an event row and mismatched, append fails.
- Event envelopes are validated with the existing Foundation-0 `validateEvent`.
- Each append writes exactly one JSONL row with a trailing newline.
- Idempotency uses a deterministic event id derived from `mission_id + idempotencyKey`; retries return the existing event and do not duplicate rows.
- `readFoundation0Events` detects partial/invalid event rows and rejects non-contiguous, duplicate, or out-of-order sequence rows instead of silently accepting them.
- `verifyFoundation0EventPayloads` detects missing or digest-mismatched payload files.

## Verification

```text
node --experimental-strip-types --test test/unit/foundation0/lockfile.test.ts
PASS: 4/4

node --experimental-strip-types --test test/unit/foundation0/event-append.test.ts
PASS: 7/7

node --experimental-strip-types --test test/integration/foundation0/concurrent-append.test.ts
PASS: 1/1

node --experimental-strip-types --test test/unit/*.test.ts test/unit/foundation0/*.test.ts test/integration/foundation0/*.test.ts
PASS: 389/389

npm run typecheck
PASS: strip-types import ok
```

## Scope Statement

No existing v0.5 runtime integration was modified. No changes were made under `packages/pi-topology/src/state`, `src/extension`, or existing runtime modules outside `packages/pi-topology/src/runtime/foundation0/`. No Pi/topology mission, Ghostty, spawn, dogfood, kill/pkill, commit, push, publish, or dependency install was performed.

## Caveats For T3/T7

- Locking is local-filesystem oriented and does not claim multi-host/distributed semantics.
- T2 fsyncs payload and event files, but parent-directory fsync and richer crash-recovery scanning can be handled in a later recovery task.
- Idempotent retry currently returns the existing event by deterministic event id; a future layer may add explicit conflict reporting if the same idempotency key is retried with incompatible caller intent.
