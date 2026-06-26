# Foundation-0 T2 Mission Event Lock And Canonical Append

Date: 2026-06-26
Owner: HQ/Codex
Executor: Coder
Reviewer: Reviewer
Status: ready for delegation

## Context

T1/T1.1 established the Foundation-0 schema, validators, and focused schema tests. T2 introduces the first durable runtime primitive inside the isolated Foundation-0 module: a mission-scoped lock and canonical event append path.

This task must stay narrow. It does not integrate with existing v0.5 topology command runtime yet. It creates reusable Foundation-0 primitives and tests them directly.

## Codex Decision: Lock Primitive

Use a project-local hand-rolled `O_EXCL` lockfile helper. Do not add `proper-lockfile` or any package dependency in T2.

Rationale:

- Keeps the first slice dependency-light and auditable.
- Allows deterministic unit tests and fault injection.
- Avoids changing package dependency/install surface before the runtime contract is proven.
- Satisfies the immediate first-slice need: local mission-event serialization on this machine.

## Scope

Allowed implementation files:

- `packages/pi-topology/src/runtime/foundation0/lockfile.ts`
- `packages/pi-topology/src/runtime/foundation0/event-append.ts`

Allowed test/report files:

- `packages/pi-topology/test/unit/foundation0/lockfile.test.ts`
- `packages/pi-topology/test/unit/foundation0/event-append.test.ts`
- `packages/pi-topology/test/integration/foundation0/concurrent-append.test.ts`
- `records/2026-06-26-foundation-0-t2-event-lock-append.md`

You may make minimal import/export adjustments inside `packages/pi-topology/src/runtime/foundation0/` if needed, but do not modify existing runtime files outside that folder.

## Non-Goals

- No integration into existing topology command/event writers.
- No changes under `packages/pi-topology/src/state`, `src/extension`, or existing v0.5 runtime modules.
- No process inspection, cleanup, signal sending, temp-directory deletion, Ghostty launch, dogfood, or real topology session spawn.
- No package dependency changes.
- No commit, push, publish, or broad cleanup.

## Required Behavior

### 1. Lockfile Helper

Implement a small async lock helper based on atomic file creation with `O_EXCL`.

Expected behavior:

- Acquires by creating a lock file atomically.
- Writes useful lock metadata, at minimum `pid`, `created_at`, and a caller-provided `lock_id` or reason.
- Retries with bounded wait/backoff when lock exists.
- Times out with a typed/recognizable error.
- Releases only the lock instance it acquired.
- Release is idempotent for the current holder.
- Supports stale-lock detection using lock file mtime/metadata and a caller-provided stale threshold.
- Does not remove a lock that was acquired by another holder after stale cleanup races.

Prefer a simple API such as:

```ts
await withLock(lockPath, options, async () => {
  // serialized work
});
```

Expose lower-level acquire/release only if it makes tests cleaner.

### 2. Canonical Event Append

Implement a Foundation-0 append primitive that:

- Acquires a mission event lock.
- Reads current canonical event log to determine the next mission-global `sequence`.
- Writes the event payload durably before writing the event row.
- Computes `payload_digest = sha256(canonical(payload))` using existing Foundation-0 digest helpers.
- Creates an `Event` envelope compatible with the existing Foundation-0 schema.
- Appends exactly one JSONL event row with a trailing newline.
- Validates the event before append.
- Releases the lock after the durable append path completes.
- Supports idempotency via `idempotency_key` or equivalent caller-provided key so a retry does not duplicate the same logical event.

The implementation may choose a local Foundation-0 storage layout, but it must be explicit and tested. Prefer:

```text
<missionDir>/foundation0/runtime-events.jsonl
<missionDir>/foundation0/payloads/<payload_digest>.json
<missionDir>/foundation0/locks/mission-events.lock
```

If a different layout is better, document it in the report.

### 3. Recovery Guardrails

T2 does not need full crash recovery, but it must avoid making recovery impossible:

- Payload file must be written before the event row.
- A missing or digest-mismatched payload must be detectable by a read/verify helper or test utility.
- A trailing partial event line should not be silently accepted as a valid event when reading current sequence.

## Required Tests

Add focused tests covering:

- Lock serializes concurrent critical sections.
- Lock timeout produces a recognizable error.
- Lock release does not remove another holder's lock.
- Stale lock cleanup is bounded and safe.
- Canonical append allocates monotonic sequences under lock.
- Concurrent append produces unique contiguous sequences.
- Payload digest is recomputed from canonical payload; caller-provided digest hints are not trusted.
- Payload is durable before event row is considered valid.
- Idempotent retry does not duplicate an event.
- Partial trailing event row is detected or ignored safely when allocating the next sequence.

Use fake temp directories and fake payloads only. Do not start real topology sessions or external apps.

## Verification Commands

Run from `packages/pi-topology/`:

```bash
node --experimental-strip-types --test test/unit/foundation0/lockfile.test.ts
node --experimental-strip-types --test test/unit/foundation0/event-append.test.ts
node --experimental-strip-types --test test/integration/foundation0/concurrent-append.test.ts
node --experimental-strip-types --test test/unit/*.test.ts test/unit/foundation0/*.test.ts test/integration/foundation0/*.test.ts
npm run typecheck
```

If a glob has no matches in the shell, adjust to the concrete files that exist and record the exact commands used.

## Report

Create:

```text
records/2026-06-26-foundation-0-t2-event-lock-append.md
```

The report must include:

- Files changed.
- Chosen storage layout.
- Lock behavior summary.
- Event append behavior summary.
- Verification results.
- Explicit statement that no existing v0.5 runtime integration was modified.
- Any caveats to send into T3/T7 backlog.

## Handoff To Reviewer

When done, send Reviewer thread `019f0289-736e-7372-a240-d2ac2303d626` a short message with:

- this task doc path,
- report path,
- changed files,
- verification summary,
- request for review.

Do not send a long inline implementation dump. The report is the source of truth.
