# Foundation-0 T5 Before-Effects Hardening

Date: 2026-06-26
Owner: HQ/Codex
Executor: Coder
Reviewer: Reviewer
Status: ready for HQ review

## Context

T1/T1.1 established the Foundation-0 schema contract. T2 added local mission event locking and canonical append. T3 added pure ManagedResource lifecycle and pre-registration. T4 is scoped as read-only ProcessIdentity / ProcessInspector work.

The T2/T3 blocker review splits the remaining before-effects blockers into:

```text
T5 closes: 1 storage path, 2 ResourceCreationPlan, 3 abandoned-before-creation,
           5 parent-directory fsync, 6 conservative stale-lock recovery

T5 does not close: 4 durable cleanup-attempt acquisition
```

T5 is contract alignment and hardening before any real external effect. It must not create, spawn, signal, delete, clean up, or integrate into the existing v0.5 runtime.

## Contract References

- `docs/T2&T3-blocker-review.md`
- `docs/superpowers/plans/2026-06-26-foundation-0-t2-t3-followups-before-effects.md`
- `docs/superpowers/plans/2026-06-26-foundation-0-t4-readonly-process-inspector.md`
- `records/2026-06-26-foundation-0-first-slice-planning-gate.md`
- `docs/19-pi-topology-v0.6-foundation-0-first-slice-contract.md`
- `docs/20-pi-topology-v0.6-foundation-0-first-slice-contract-closure.md`

Doc 20 supersedes conflicting first-slice semantics in doc 19. T5 may update docs 19/20 only to remove path/semantic drift for Foundation-0 first-slice behavior.

## Scope

Allowed implementation files:

- `packages/pi-topology/src/runtime/foundation0/schema.ts`
- `packages/pi-topology/src/runtime/foundation0/validation.ts`
- `packages/pi-topology/src/runtime/foundation0/event-append.ts`
- `packages/pi-topology/src/runtime/foundation0/lockfile.ts`
- `packages/pi-topology/src/runtime/foundation0/resource-lifecycle.ts`
- New helper if needed: `packages/pi-topology/src/runtime/foundation0/durable-fs.ts`
- New helper if needed: `packages/pi-topology/src/runtime/foundation0/resource-creation-plan.ts`

Allowed docs/report files:

- `docs/19-pi-topology-v0.6-foundation-0-first-slice-contract.md`
- `docs/20-pi-topology-v0.6-foundation-0-first-slice-contract-closure.md`
- `docs/superpowers/plans/2026-06-26-foundation-0-t2-t3-followups-before-effects.md`
- `records/2026-06-26-foundation-0-t5-before-effects-hardening.md`

Allowed test files:

- `packages/pi-topology/test/unit/foundation0/event-append.test.ts`
- `packages/pi-topology/test/unit/foundation0/lockfile.test.ts`
- `packages/pi-topology/test/unit/foundation0/resource-lifecycle.test.ts`
- `packages/pi-topology/test/unit/foundation0/pre-registration.test.ts`
- New test if needed: `packages/pi-topology/test/unit/foundation0/resource-creation-plan.test.ts`
- New test if needed: `packages/pi-topology/test/unit/foundation0/durable-fs.test.ts`

Minimal import/export adjustments inside `packages/pi-topology/src/runtime/foundation0/` are allowed.

## Hard Non-Goals

T5 must not perform or integrate any real external effect.

Forbidden in T5:

- No real process spawn.
- No Ghostty launch.
- No Pi topology spawn.
- No `topology_spawn_role`.
- No v0.5 runtime integration.
- No process signal, `process.kill`, `kill`, `pkill`, `killall`, or process-group signal.
- No temp-directory creation as a managed resource.
- No temp-directory quarantine, recursive delete, unlink, rmdir, rm, or cleanup.
- No cleanup execution.
- No durable cleanup-attempt acquisition implementation.
- No package dependency changes.
- No commit, push, publish, broad cleanup, or dogfood.

Durable cleanup-attempt acquisition remains a T6/T7 blocker. T5 may only record that follow-up in docs/report.

## Required Behavior

### 1. Adopt Canonical Foundation-0 Storage Path

Adopt this as the canonical Foundation-0 storage layout:

```text
<missionDir>/foundation0/runtime-events.jsonl
<missionDir>/foundation0/payloads/<payload_digest>.json
<missionDir>/foundation0/locks/mission-events.lock
```

Future Foundation-0 projections should also live under:

```text
<missionDir>/foundation0/
```

T5 must align docs, code, tests, and payload refs to a single path model.

Required rules:

- Foundation-0 has exactly one canonical event stream.
- Mission root may be used later for compatibility mirrors, but not as a second Foundation-0 canonical stream.
- `foundation0StoragePaths(missionDir)` remains the single path constructor for T2/T5 storage paths.
- Event `payload_ref` must be stable and relative to the canonical Foundation-0 path model.
- Tests must assert the chosen `payload_ref` shape and physical payload location.

Preferred `payload_ref`:

```text
foundation0/payloads/<payload_digest>.json
```

### 2. Introduce ResourceCreationPlan

Add a first-class `ResourceCreationPlan` schema/type and validator.

Minimum shape:

```ts
export type ResourceCreationKind = "spawn_process" | "create_temp_directory";

export interface ResourceCreationPlan {
  schema_version: 1;
  plan_id: string;
  mission_id: string;
  resource_id: string;
  resource_type: "process" | "temp_directory";
  planned_resource: PlannedResource;
  cleanup_policy: ProcessCleanupPolicy | TempDirectoryCleanupPolicy;
  creation_kind: ResourceCreationKind;
  creation_payload: Record<string, unknown>;
  authorization_id: string;
  requested_by_action_id: string;
  effect_fingerprint: string;
  created_at: string;
}
```

Validation rules:

- `plan_id`, `mission_id`, `resource_id`, `authorization_id`, and `requested_by_action_id` use the existing Foundation-0 ID grammar.
- `created_at` uses existing UTC millisecond timestamp validation.
- `effect_fingerprint` uses existing digest grammar.
- `planned_resource.lifecycle_state` must be `planned`.
- `planned_resource.identity`, `planned_resource.identity_digest`, and `planned_resource.cleanup_policy` must be `null`.
- `planned_resource.resource_id` must equal `resource_id`.
- `planned_resource.mission_id` must equal `mission_id`.
- `planned_resource.authorization_id` must equal `authorization_id`.
- `cleanup_policy` must match `resource_type`.
- `creation_kind` must match `resource_type`:
  - `process` uses `spawn_process`.
  - `temp_directory` uses `create_temp_directory`.
- Runtime helpers must recompute `effect_fingerprint` from canonical creation-plan inputs and must not trust caller-provided digest hints.

Durable semantics:

```text
ResourceCreationPlan MUST be durably written, digest-verified,
and referenced by a durably committed event before external creation begins.
```

T5 implements the schema, validator, digest computation, and durable-plan write semantics using fake payloads only. It does not create the external resource.

### 3. Finalize Abandoned-Before-Creation Semantics

Finalize the narrow never-created branch:

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

Required rules:

- Identity-null `abandoned` is valid only when external creation never started.
- `abandoned_reason: "never_created"` is required for identity-null abandoned resources.
- `verification_state` must be `"verified"` for the never-created abandoned branch.
- If external creation was attempted, or identity may have existed, the resource must not use this branch.
- Observed resources must not transition to identity-null abandoned.
- Clean closeout may later treat `abandoned + verified + never_created` as non-residual.

T5 should update schema/types/validators/lifecycle helpers/tests so this is machine-checkable.

### 4. Add Parent-Directory Fsync Strategy

Add explicit helper behavior and tests for parent-directory fsync where Foundation-0 claims durable writes.

Required durable write strategy:

```text
payload write:
  write temp file
  fsync file
  rename into payloads/<digest>.json
  fsync payloads directory

event append:
  open/create runtime-events.jsonl
  append complete line
  fsync/fdatasync event file
  if file was newly created, fsync foundation0 directory

projection-style write, if helper is introduced:
  write temp projection
  fsync temp file
  rename
  fsync projection directory

lockfile:
  O_EXCL create
  write lock metadata
  fsync lock file
  fsync locks directory where required
```

Implementation may use a small local helper such as:

```ts
export async function fsyncFile(path: string): Promise<void>;
export async function fsyncDirectory(path: string): Promise<void>;
export async function writeJsonAtomicallyDurable(path: string, value: unknown): Promise<void>;
```

Tests should use temp directories and fake payloads. They must not create managed temp resources.

### 5. Add Richer Lock Metadata And Conservative Stale-Lock Recovery

Upgrade lock metadata for effectful-readiness.

Required minimum metadata:

```ts
export interface Foundation0LockMetadata {
  schema_version: 1;
  lock_id: string;
  mission_id: string;
  purpose: "mission_event_append" | "cleanup_attempt_acquisition" | "resource_creation_plan";
  holder_pid: number;
  holder_process_start_tuple?: {
    start_time_seconds: number;
    start_time_microseconds: number;
  };
  holder_executable?: string;
  holder_nonce: string;
  hostname: string;
  created_at: string;
}
```

Conservative stale-lock rules:

- If holder cannot be verified, fail safe and do not silently break the lock.
- If hostname differs, fail safe. Distributed/multi-host recovery is out of scope.
- If PID is absent and holder start tuple confirms the process is gone, stale break may be allowed.
- If PID exists but start tuple differs, stale break may be allowed only after recording/reporting a stale-lock incident.
- If process probing is unavailable, permission denied, unsupported, or ambiguous, do not break.
- If lock metadata is missing, malformed, or digest-invalid, do not break in effectful-readiness paths.
- A first implementation may return `lock_unverified` or `lock_busy` rather than breaking suspected stale locks.

T5 may use fake holder probes in tests. It must not call real signal APIs.

### 6. Track Durable Cleanup-Attempt Acquisition As Follow-Up Only

T5 must not implement item 4 from the blocker review.

It must leave a clear follow-up statement:

```text
Durable cleanup-attempt acquisition remains required before any real signal/delete.
T3's in-memory cleanup coordination is acceptable only for pure lifecycle logic
and read-only inspection phases.
```

The T5 report should state whether this was recorded in the follow-up doc.

## Required Tests

Add or update focused tests covering:

### Storage Path

- `foundation0StoragePaths()` returns `runtime-events.jsonl`, `payloads`, and `locks` under `<missionDir>/foundation0/`.
- Appended events use `payload_ref = foundation0/payloads/<digest>.json`.
- Payload verification reads the same path that append writes.
- No test expects a mission-root Foundation-0 canonical event stream.

### ResourceCreationPlan

- Valid process creation plan passes validation.
- Valid temp-directory creation plan passes validation.
- `planned_resource.cleanup_policy` must remain `null`.
- `cleanup_policy` must match `resource_type`.
- `creation_kind` must match `resource_type`.
- mismatched `mission_id`, `resource_id`, or `authorization_id` is rejected.
- effect fingerprint is recomputed from canonical inputs.
- durable plan write stores payload before event reference using fake payloads only.
- digest mismatch is detectable.

### Abandoned Never-Created

- `planned -> abandoned` with `abandoned_reason: "never_created"` and `verification_state: "verified"` succeeds.
- identity-null abandoned without `abandoned_reason` is rejected.
- identity-null abandoned with `verification_state: "unverified"` is rejected.
- observed resource cannot become identity-null abandoned.
- abandoned never-created remains valid with `identity`, `identity_digest`, and `cleanup_policy` all `null`.

### Parent-Directory Fsync

- payload durable write calls file fsync before rename and directory fsync after rename.
- first event log creation fsyncs the Foundation-0 directory.
- lockfile create writes metadata and fsyncs the lock file and locks directory.
- helper failures surface recognizable errors and do not report durable success.

Use injectable filesystem shims or local wrappers where needed so tests can observe fsync calls without relying on crash simulation.

### Conservative Lock Recovery

- lock metadata includes mission id, purpose, holder pid, holder nonce, hostname, and created timestamp.
- same holder releases its own lock idempotently.
- release does not remove another holder's lock.
- malformed metadata returns safe failure in effectful-readiness mode.
- hostname mismatch returns safe failure.
- permission denied or ambiguous holder probe returns safe failure.
- PID absent with verified holder tuple can be treated as stale only through the explicit stale path.
- PID exists with different verified start tuple records/reports a stale-lock incident before break.

## Verification Commands

Run from `packages/pi-topology/`:

```bash
node --experimental-strip-types --test test/unit/foundation0/event-append.test.ts
node --experimental-strip-types --test test/unit/foundation0/lockfile.test.ts
node --experimental-strip-types --test test/unit/foundation0/pre-registration.test.ts
node --experimental-strip-types --test test/unit/foundation0/resource-lifecycle.test.ts
node --experimental-strip-types --test test/unit/foundation0/resource-creation-plan.test.ts
node --experimental-strip-types --test test/unit/foundation0/durable-fs.test.ts
node --experimental-strip-types --test test/unit/foundation0/*.test.ts
npm run typecheck
```

If optional new test files are not created because coverage is folded into existing tests, record the exact commands used and why.

## Report

Create:

```text
records/2026-06-26-foundation-0-t5-before-effects-hardening.md
```

The report must include:

- Files changed.
- Canonical storage path decision and payload_ref shape.
- ResourceCreationPlan schema/validator summary.
- Durable plan write and digest-binding summary.
- Abandoned never-created semantics summary.
- Parent-directory fsync strategy summary.
- Lock metadata and stale-lock recovery summary.
- Verification results.
- Explicit statement that T5 did not implement durable cleanup-attempt acquisition.
- Explicit statement that no real spawn, signal, delete, cleanup, temp creation, Ghostty/Pi topology spawn, dogfood, or v0.5 runtime integration was implemented or invoked.
- Remaining blocker: durable cleanup-attempt acquisition before real cleanup.

## Handoff To Reviewer

When done, send Reviewer thread `019f0289-736e-7372-a240-d2ac2303d626` a short message with:

- this task doc path,
- report path,
- changed files,
- verification summary,
- confirmation that item 4 durable cleanup-attempt acquisition remains deferred,
- request for review.

Do not send a long inline implementation dump. The report is the source of truth.

## HQ Review Gate

T5 is ready for delegation only after HQ accepts:

```text
T5 = before-effects hardening / contract alignment.
T5 closes blocker items 1, 2, 3, 5, and 6.
T5 does not implement blocker item 4 durable cleanup-attempt acquisition.
T5 does not perform real spawn, signal, delete, cleanup, temp creation, or v0.5 integration.
```
