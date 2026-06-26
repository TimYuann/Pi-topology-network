# Foundation-0 T2/T3 Follow-Ups Before Effects

Date: 2026-06-26
Owner: HQ/Codex
Status: ready for HQ review

## Purpose

This tracking doc records the T2/T3 issues that must be resolved before Foundation-0 performs any real resource creation, process cleanup, temp-directory cleanup, signal sending, or v0.5 runtime integration.

T4 may proceed as strict read-only ProcessIdentity / ProcessInspector work. The items below block later effectful tasks.

## Hard Boundary

Do not authorize these until this follow-up list is resolved or explicitly split into reviewed task docs:

- real process spawn under Foundation-0 ownership
- Ghostty or Pi topology spawn integration
- temp directory creation under Foundation-0 ownership
- `SIGTERM`, `SIGKILL`, process-group signal, `process.kill`, `kill`, `pkill`, or `killall`
- temp-directory quarantine or deletion
- cleanup outcome append based on real external effects
- v0.5 runtime integration

## Follow-Up 1: Canonical Storage Path Normalization

Problem:

T2 currently uses:

```text
<missionDir>/foundation0/runtime-events.jsonl
<missionDir>/foundation0/payloads/<payload_digest>.json
<missionDir>/foundation0/locks/mission-events.lock
```

The original first-slice contract names mission-root paths such as:

```text
.pi/topology/missions/<mission_id>/runtime-events.jsonl
```

Decision needed:

Choose one canonical Foundation-0 storage layout and align docs, code, tests, payload refs, recovery readers, and future projections.

Recommended decision:

Use the isolated Foundation-0 subdirectory as canonical for this first slice:

```text
<missionDir>/foundation0/runtime-events.jsonl
<missionDir>/foundation0/payloads/<payload_digest>.json
<missionDir>/foundation0/locks/mission-events.lock
```

Reason:

Foundation-0 is intentionally isolated from the existing v0.5 runtime. A namespaced storage root reduces path drift while the new ledger is still contract-gated.

Acceptance:

- One doc explicitly declares the canonical layout.
- `foundation0StoragePaths()` remains the single path constructor.
- Event `payload_ref` values are relative to the declared canonical root.
- Recovery helpers and tests read the same paths the append helper writes.
- Future projection paths are specified relative to the same root.

## Follow-Up 2: ResourceCreationPlan Durability, Replay, And Digest Binding

Problem:

T3 models pre-registration with a sidecar:

```text
{ resource: PlannedResource, cleanup_policy: ProcessCleanupPolicy | TempDirectoryCleanupPolicy }
```

This is acceptable for pure lifecycle tests, but real resource creation requires the sidecar to be durable and replayable before the external effect begins.

Decision needed:

Define a canonical `ResourceCreationPlan` object and decide whether it is stored as an action payload, event payload, or both.

Required minimum shape:

```json
{
  "schema_version": 1,
  "resource_id": "res_...",
  "resource_type": "process",
  "planned_resource": {},
  "cleanup_policy": {},
  "creation_plan": {},
  "effect_fingerprint": "sha256:..."
}
```

Required rules:

- `ResourceCreationPlan` must be durably written before external resource creation begins.
- Its payload digest must be recomputed from canonical JSON.
- Any event referencing it must bind `payload_ref` and `payload_digest`.
- Replay must recover the planned resource, cleanup policy, intended creation method, and effect fingerprint.
- `PlannedResource.cleanup_policy` remains `null`; the cleanup policy lives in the durable plan until observed identity exists.

Acceptance:

- A future task can crash after durable plan write and before creation, then replay the plan.
- A future task can crash after creation and before activation, then reconcile from the plan plus observed evidence.
- No real spawn or temp creation is allowed before this is implemented.

## Follow-Up 3: Abandoned-Before-Creation Verification Semantics

Problem:

T3 added an identity-null `AbandonedResource` branch for `planned -> abandoned` when no external resource was created. Current vocabulary risks representing this as `verification_state: "unverified"`, which would incorrectly block clean closeout.

Decision needed:

Choose a precise machine-checkable representation for "planned resource was durably registered, external creation never happened, abandonment is verified."

Recommended narrow representation:

```json
{
  "lifecycle_state": "abandoned",
  "identity": null,
  "identity_digest": null,
  "abandoned_reason": "never_created",
  "verification_state": "verified"
}
```

Alternative:

Add an orthogonal creation-state field such as:

```text
external_creation_state =
  planned_only
  | creation_attempted
  | observed_created
  | creation_failed
  | never_created
  | unknown
```

Acceptance:

- Identity-null abandoned is only valid for never-created resources.
- Observed resources do not use identity-null abandoned.
- Clean closeout can allow `abandoned + verified never_created`.
- Conditional closeout remains required for real residual or unverified resources.

## Follow-Up 4: Upgrade In-Memory Cleanup Coordination To Durable Coordination

Problem:

T3 implements only an in-memory coordination helper:

```text
same resource_id + identity_digest + different idempotency key => cleanup_in_progress
```

This is acceptable for pure lifecycle logic and T4 read-only inspection, but it is not acceptable for real cleanup execution.

Decision needed:

Define durable cleanup-attempt acquisition under either the mission event lock or a resource-level lock. The first effectful cleanup task must serialize by:

```text
resource_id + identity_digest
```

Required rules:

- At most one active cleanup attempt may exist for a resource identity pair.
- Same idempotency key is idempotent.
- Different idempotency key while active returns `cleanup_in_progress`.
- Acquisition, policy decision, identity check, and outcome must be replayable from canonical storage.
- Crash recovery must detect active/indeterminate cleanup attempts and route to reconciliation rather than repeating dangerous effects.

Acceptance:

- No real signal/delete task may rely on the T3 in-memory helper alone.
- Durable acquisition has tests for concurrent processes or equivalent fault injection.
- Recovery has a deterministic state for "cleanup intent without final outcome."

## Follow-Up 5: Parent-Directory Fsync

Problem:

T2 fsyncs payload and event files, but crash durability of newly created or renamed directory entries also depends on parent-directory fsync.

Decision needed:

Define where parent-directory fsync is required in Foundation-0 durable writes.

Required coverage:

- payload file create/rename
- event log create on first append
- lock file create/remove where durability is claimed
- future ResourceCreationPlan payload writes
- future marker/quarantine path creation before delete semantics rely on them

Acceptance:

- Durable intent can honestly mean "survives crash according to local filesystem assumptions."
- Real external effects are not authorized until intent and allowed decision have been durably committed under the clarified fsync strategy.

## Follow-Up 6: Conservative Stale-Lock Recovery

Problem:

T2 has local `O_EXCL` lock behavior and stale-lock cleanup. Before real effects, stale-lock handling must avoid breaking a live holder.

Required lock metadata:

```json
{
  "pid": 12345,
  "created_at": "2026-06-26T00:00:00.000Z",
  "lock_id": "foundation0_event_append",
  "mission_id": "mission_...",
  "purpose": "mission_event_append",
  "holder_nonce": "lock_..."
}
```

Required rules:

- If holder liveness cannot be safely determined, do not break the lock silently.
- If PID exists but start tuple cannot be verified, treat as unsafe to break.
- If metadata is malformed, prefer timeout/failure over destructive recovery for effectful paths.
- Stale recovery must be bounded and reported.
- Cleanup execution must not proceed after ambiguous stale-lock recovery.

Acceptance:

- Lock recovery behavior is documented and tested before real cleanup or creation.
- Effectful tasks report lock ambiguity as a safe failure, not as permission to continue.

## Ready States

T4 read-only ProcessInspector:

```text
ready after HQ accepts the T4 doc boundary
```

Real resource creation:

```text
blocked until storage path normalization and ResourceCreationPlan durability are resolved
```

Real cleanup execution:

```text
blocked until all items in this follow-up doc are resolved or superseded by reviewed task docs
```

v0.5 runtime integration:

```text
blocked until real creation/cleanup gates are separately approved
```
