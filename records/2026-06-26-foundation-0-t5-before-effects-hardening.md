# Foundation-0 T5 Before-Effects Hardening Report

Date: 2026-06-26
Role: Coder
Decision: ready_for_codex_review
Base: `2c9972c`

## Plan Input

- `docs/superpowers/plans/2026-06-26-foundation-0-t5-before-effects-hardening.md`

T5 boundary applied:

```text
T5 = before-effects hardening / contract alignment.
T5 closes blocker items 1, 2, 3, 5, and 6.
T5 does not implement blocker item 4 durable cleanup-attempt acquisition.
```

## Files Changed

- `docs/19-pi-topology-v0.6-foundation-0-first-slice-contract.md`
- `docs/20-pi-topology-v0.6-foundation-0-first-slice-contract-closure.md`
- `docs/superpowers/plans/2026-06-26-foundation-0-t2-t3-followups-before-effects.md`
- `packages/pi-topology/src/runtime/foundation0/durable-fs.ts`
- `packages/pi-topology/src/runtime/foundation0/event-append.ts`
- `packages/pi-topology/src/runtime/foundation0/lockfile.ts`
- `packages/pi-topology/src/runtime/foundation0/resource-creation-plan.ts`
- `packages/pi-topology/src/runtime/foundation0/resource-lifecycle.ts`
- `packages/pi-topology/src/runtime/foundation0/schema.ts`
- `packages/pi-topology/src/runtime/foundation0/validation.ts`
- `packages/pi-topology/test/unit/foundation0/durable-fs.test.ts`
- `packages/pi-topology/test/unit/foundation0/event-append.test.ts`
- `packages/pi-topology/test/unit/foundation0/lockfile.test.ts`
- `packages/pi-topology/test/unit/foundation0/pre-registration.test.ts`
- `packages/pi-topology/test/unit/foundation0/resource-creation-plan.test.ts`
- `packages/pi-topology/test/unit/foundation0/resource-lifecycle.test.ts`
- `records/2026-06-26-foundation-0-t5-before-effects-hardening.md`

No package dependencies were added.

## Canonical Storage Path

Foundation-0 canonical storage is:

```text
<missionDir>/foundation0/runtime-events.jsonl
<missionDir>/foundation0/payloads/<payload_digest>.json
<missionDir>/foundation0/locks/mission-events.lock
```

`foundation0StoragePaths(missionDir)` remains the single constructor. Event payload refs use:

```text
foundation0/payloads/<payload_digest>.json
```

Docs 19/20 were aligned away from mission-root payload/runtime examples.

## ResourceCreationPlan

Added `ResourceCreationPlan` schema/type and `validateResourceCreationPlan`.

Rules implemented:

- `plan_id`, `mission_id`, `resource_id`, `authorization_id`, `requested_by_action_id` use Foundation-0 ID grammar.
- `created_at` uses UTC millisecond timestamp grammar.
- `effect_fingerprint` uses digest grammar.
- `planned_resource` must be valid planned resource with null identity, identity digest, and cleanup policy.
- planned resource `mission_id`, `resource_id`, `resource_type`, and `authorization_id` must match the plan.
- cleanup policy must match `resource_type`.
- `creation_kind` must match `resource_type`.

`resource-creation-plan.ts` adds pure construction and digest helpers. `createResourceCreationPlan` recomputes `effect_fingerprint` from canonical plan inputs and ignores caller hints.

## Durable Plan Write

`writeResourceCreationPlanEvent` validates the plan, recomputes the effect fingerprint, and appends a `resource_planned` Foundation-0 event whose canonical payload is the plan. This uses T2/T5 append semantics:

```text
plan payload file -> digest binding -> event row reference
```

Tests verify the event `payload_ref`, physical payload location, and digest mismatch detection after tampering. No external process or temp directory is created.

## Abandoned Never-Created

Identity-null abandoned resources are now the narrow never-created branch:

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

`validateAbandonedResource` rejects missing `abandoned_reason` and rejects unverified identity-null abandoned resources. `transitionManagedResource` only permits `planned -> abandoned`; observed resources cannot transition to identity-null abandoned.

## Parent-Directory Fsync

Added `durable-fs.ts` with local helpers:

- `fsyncFile`
- `fsyncDirectory`
- `writeDurableFile`
- `appendFileDurably`
- `renameDurably`
- `writeJsonAtomicallyDurable`

Durability strategy:

- payload temp file is fsynced before rename;
- payload directory is fsynced after rename;
- runtime event file is fsynced after append;
- Foundation-0 directory is fsynced when the event log is first created;
- lock file metadata is fsynced and the locks directory is fsynced after create;
- atomic JSON/projection helper fsyncs temp file, renames, then fsyncs parent directory.

Test hooks observe fsync/rename ordering without crash simulation.

## Lock Metadata And Stale Recovery

Lock metadata now includes:

```ts
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

Stale recovery is conservative:

- malformed metadata does not break;
- invalid `created_at` is malformed and does not break, even with an otherwise verified stale holder probe;
- `lock_id`, `mission_id`, and `created_at` are validated with existing Foundation-0 grammar;
- hostname mismatch does not break;
- no holder probe does not break;
- permission denied, ambiguous, unsupported, or present-matching holder probe does not break;
- verified absent or verified start-tuple mismatch can break only through explicit stale path;
- verified stale break reports an incident via callback before removal.

T5 does not add real process probing to lock recovery; tests use fake holder probes.

## Deferred Item 4

Durable cleanup-attempt acquisition remains required before any real signal/delete. T3's in-memory cleanup coordination is acceptable only for pure lifecycle logic and read-only inspection phases.

This is recorded in:

- `docs/superpowers/plans/2026-06-26-foundation-0-t2-t3-followups-before-effects.md`

## Verification

Run from `packages/pi-topology/`:

```text
node --experimental-strip-types --test test/unit/foundation0/event-append.test.ts
PASS: 9/9

node --experimental-strip-types --test test/unit/foundation0/lockfile.test.ts
PASS: 8/8

node --experimental-strip-types --test test/unit/foundation0/pre-registration.test.ts
PASS: 8/8

node --experimental-strip-types --test test/unit/foundation0/resource-lifecycle.test.ts
PASS: 9/9

node --experimental-strip-types --test test/unit/foundation0/resource-creation-plan.test.ts
PASS: 5/5

node --experimental-strip-types --test test/unit/foundation0/durable-fs.test.ts
PASS: 1/1

node --experimental-strip-types --test test/unit/foundation0/*.test.ts
PASS: 56/56

npm run typecheck
PASS: strip-types import ok
```

Additional verification:

```text
node --experimental-strip-types --test test/unit/*.test.ts test/unit/foundation0/*.test.ts test/integration/foundation0/*.test.ts
PASS: 433/433

rg -n "process\\.kill|\\bkill\\b|\\bpkill\\b|\\bkillall\\b|topology_spawn_role|Ghostty|spawn\\(|process\\.spawn|child_process\\.spawn" packages/pi-topology/src/runtime/foundation0 packages/pi-topology/test/unit/foundation0
PASS: no matches
```

## Scope Statement

No real process spawn, signal, `process.kill`, `kill`, `pkill`, `killall`, process-group signal, managed temp-directory creation, temp-directory quarantine, recursive delete, cleanup execution, durable cleanup-attempt acquisition, Ghostty launch, Pi topology spawn, dogfood, v0.5 runtime integration, package dependency change, commit, push, or publish was implemented or invoked.

Tests create and remove ordinary test temp directories under the OS temp root; they do not create managed Foundation-0 temp-directory resources.

## Remaining Blocker

Durable cleanup-attempt acquisition remains the blocker before real cleanup. No real cleanup/signal/delete task should rely on T3's in-memory cleanup coordination.
