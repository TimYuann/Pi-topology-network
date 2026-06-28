# Foundation-0 Before-Effects Review Brief

Date: 2026-06-28
Audience: 5.5pro external architecture review
Prepared by: HQ/Codex
Status: ready for external review

## Purpose

This brief summarizes the Pi Topology v0.6 Foundation-0 stopping point after T5 before-effects hardening.

The project has deliberately not crossed into real runtime effects yet. The review question is whether the current pre-effects foundation is safe and coherent enough to proceed toward effectful Foundation-0 work, and if so, what the next narrow gate should be.

The owner-facing goal remains operational accountability for topology-agent collaboration: every mission has a boundary, every runtime action is represented as an auditable request and decision, every created process or temporary directory is registered, cleanup is bounded and replayable, and closeout can explain which resources are clean, which remain, and why.

## Current Direction

Foundation-0 is still isolated under:

```text
packages/pi-topology/src/runtime/foundation0/
```

It is not wired into the existing v0.5 topology runtime. It has not launched Ghostty, spawned Pi topology sessions, sent process signals, created managed temporary directories, deleted temporary directories, or performed cleanup.

The implementation sequence so far has been:

```text
schema contract
-> mission event lock and canonical append
-> managed resource lifecycle and pre-registration
-> read-only process inspection
-> before-effects hardening
```

This checkpoint asks whether the next step should still be a narrow precondition task, rather than resource creation or cleanup execution.

## Completed Scope

### T1/T1.1: Foundation-0 Schema Contract

Commit:

```text
67e74e8 feat(pi-topology): add foundation0 schema contract
```

Implemented:

- Foundation-0 ID, digest, timestamp, and canonical JSON helpers.
- First-slice TypeScript schema object families.
- Per-object validators and dispatch validators.
- Authorization discriminated union tightening.
- Closed `AuthorizationGrant` scope validation.
- Action-specific `InitialOutcome` validation.
- ManagedResource planned/observed validation rules.

### T2: Mission Event Lock And Canonical Append

Commit:

```text
7c75a6b feat(pi-topology): add foundation0 event append lock
```

Implemented:

- Mission-scoped event lock.
- Project-local `O_EXCL` lockfile primitive, with no package dependency.
- Canonical payload digest computation.
- Durable payload write before event append.
- Content-addressed payload storage.
- Deterministic event id and idempotent append behavior.
- File-order sequence invariant validation.
- Partial/orphan payload repair handling.

### T3: ManagedResource Lifecycle And Pre-Registration

Commit:

```text
ae18d96 feat(pi-topology): add foundation0 resource lifecycle
```

Implemented:

- Closed ManagedResource lifecycle transition helper.
- Runtime-created resource pre-registration sidecar.
- Explicit `AbandonedResource` branch so `planned -> abandoned` can represent a resource that was never externally created.
- In-memory cleanup-attempt coordination for pure lifecycle logic.
- Validation-preserving transitions with refreshed timestamps.

Important decision:

`abandoned` is a terminal ManagedResource branch, not an observed resource state. Identity-null abandoned is valid only for verified never-created resources.

### T4: Read-Only Process Inspector

Commit:

```text
fc3922f feat(pi-topology): add foundation0 process inspector
```

Implemented:

- Read-only `ProcessInspector` abstraction.
- Host macOS process inspector for read-only probing.
- Fake-injected inspector tests.
- Protection facts for the current CLI PID, ancestors, and current process group.
- PID/PGID protection helpers.
- Identity matching helper.

Important limitation:

The host macOS probe intentionally degrades to non-exact results when argv or start-time precision is ambiguous. T4 does not authorize cleanup. It only provides read-only process facts.

### T5: Before-Effects Hardening

Commit:

```text
5244c02 feat(pi-topology): harden foundation0 before effects
```

Implemented:

- Canonical Foundation-0 storage layout under `<missionDir>/foundation0/`.
- `ResourceCreationPlan` schema, validation, canonical effect fingerprint, and durable event payload binding.
- Verified never-created abandoned semantics.
- Parent-directory fsync helpers and durable write ordering.
- Rich lock metadata.
- Conservative stale-lock recovery.
- Fake holder probes for stale-lock tests.

T5 intentionally did not implement real spawn, signal, delete, cleanup, managed temp-directory creation, Ghostty/Pi topology spawn, dogfood, v0.5 integration, package dependency changes, or publish behavior.

## T5 Details To Review

### Canonical Foundation-0 Storage

Foundation-0 canonical storage is now:

```text
<missionDir>/foundation0/runtime-events.jsonl
<missionDir>/foundation0/payloads/<payload_digest>.json
<missionDir>/foundation0/locks/mission-events.lock
```

`foundation0StoragePaths(missionDir)` remains the single constructor. Event payload refs use:

```text
foundation0/payloads/<payload_digest>.json
```

The intent is to avoid drift between mission-root examples and the isolated Foundation-0 first-slice runtime.

### ResourceCreationPlan

T5 introduced a first-class `ResourceCreationPlan` object for planned external resource creation. It records the planned resource, cleanup policy, creation kind, creation payload, authorization, requesting action, created timestamp, and canonical effect fingerprint.

The runtime helper recomputes `effect_fingerprint` from canonical inputs and does not trust caller-provided digest hints.

`writeResourceCreationPlanEvent` validates the plan, writes the canonical payload, binds the payload digest/ref into a `resource_planned` event, and appends it through the T2/T5 durable event path. It does not create a process or temporary directory.

### Verified Never-Created Abandoned

Identity-null abandoned resources now require the narrow representation:

```json
{
  "lifecycle_state": "abandoned",
  "identity": null,
  "identity_digest": null,
  "cleanup_policy": null,
  "abandoned_reason": "never_created",
  "verification_state": "verified"
}
```

Observed resources cannot transition into this identity-null branch.

### Durable Write Ordering

T5 added local helpers for file and directory fsync, durable append, durable rename, and atomic JSON writes.

The intended ordering is:

- payload temp file is fsynced before rename;
- payload directory is fsynced after rename;
- runtime event file is fsynced after append;
- Foundation-0 directory is fsynced when the event log is first created;
- lock file metadata is fsynced and the locks directory is fsynced after create;
- projection-style JSON writes can fsync temp file, rename, then fsync parent directory.

Tests observe ordering through hooks; they do not simulate real crash recovery.

### Lock Metadata And Stale Recovery

Lock metadata now includes:

```text
schema_version
lock_id
mission_id
purpose
holder_pid
holder_process_start_tuple?
holder_executable?
holder_nonce
hostname
created_at
```

Stale-lock recovery is conservative:

- malformed metadata does not break the lock;
- invalid `created_at` does not break the lock;
- hostname mismatch does not break the lock;
- missing holder probe does not break the lock;
- permission denied, ambiguous, unsupported, or present-matching holder probe does not break the lock;
- verified absent or verified start-tuple mismatch can break only through explicit stale recovery;
- verified stale break reports an incident before removal.

T5 uses fake holder probes in tests. It does not add process probing to lock recovery.

## Current Verification

Latest known verification from HQ after T5:

```text
node --experimental-strip-types --test test/unit/foundation0/lockfile.test.ts
PASS 8/8

node --experimental-strip-types --test test/unit/foundation0/*.test.ts
First run had one transient stale-lock timing flake; immediate rerun PASS 56/56

npm run typecheck
PASS: strip-types import ok

node --experimental-strip-types --test test/unit/*.test.ts test/unit/foundation0/*.test.ts test/integration/foundation0/*.test.ts
PASS 434/434

forbidden signal/spawn scan on Foundation-0 source/tests
PASS: no matches
```

The stale-lock timing flake did not recur on immediate rerun, but it should remain visible to reviewers because stale recovery will become more important before effectful work.

## Remaining Blocker

Durable cleanup-attempt acquisition remains required before any real signal/delete.

T3's in-memory cleanup coordination is acceptable only for pure lifecycle logic and read-only inspection phases. It is not sufficient for real cleanup execution.

The next cleanup-related primitive should serialize by:

```text
resource_id + identity_digest
```

Expected properties:

- at most one active cleanup attempt exists for a resource identity pair;
- the same idempotency key is idempotent;
- a different idempotency key while active returns `cleanup_in_progress`;
- acquisition, policy decision, identity check, and final or indeterminate outcome are replayable from canonical storage;
- crash recovery routes indeterminate cleanup attempts to reconciliation, not blind retry;
- no real signal/delete/temp cleanup is included unless separately authorized.

## Review Questions For 5.5pro

1. Is the T1-T5 pre-effects foundation coherent enough to proceed toward effectful Foundation-0 work?
2. Should T6 be strictly `Durable Cleanup-Attempt Acquisition` before any real resource creation, signal, delete, or cleanup?
3. Should real temp-directory creation/cleanup be sequenced before process cleanup because path markers, quarantine, and delete semantics are easier to bound than process signaling?
4. Does the macOS read-only process inspector limitation mean process cleanup should require a stronger identity source before any signal is allowed?
5. Is the T5 stale-lock recovery posture conservative enough for pre-effects work, or should the transient timing flake be stabilized before any T6 task?
6. Should future effectful work be split into several small gates, for example durable cleanup acquisition, temp creation identity/marker, temp quarantine/delete guard, process creation identity, process signal guard, reconciliation, and closeout?
7. Are there remaining path, digest, fsync, or replay gaps in `ResourceCreationPlan` that must be closed before resource creation begins?

## HQ Recommendation

Do not proceed directly to real spawn, signal, delete, or v0.5 runtime integration.

If external review approves the current direction, the recommended next implementation task is:

```text
T6: Durable Cleanup-Attempt Acquisition
```

T6 should be a narrow reviewed capability. It should implement durable acquisition and replay semantics for cleanup attempts without performing real cleanup effects.

The first effectful Foundation-0 task should remain blocked until durable acquisition is implemented, reviewed, verified, and committed.
