# Pi Topology v0.6 Foundation-0 First-Slice Contract

Date: 2026-06-26
Project: Pi拓扑网络 / `packages/pi-topology`
Status: first-slice implementation contract candidate
Depends on:

- `docs/18-pi-topology-v0.6-collaboration-kernel-freeze-draft.md`
- `docs/Freeze-spec-review-5.5.md`

## 1. Purpose

This document narrows the v0.6 collaboration kernel into the first implementable contract:

```text
Foundation-0 + process/temp-directory Resource Ledger and Cleanup Guard
```

It does not reopen the broader architecture. The accepted architecture direction remains:

```text
Mission boundary
capability-first authority
ActionRequest + PolicyDecision
canonical append-only events
managed-resource cleanup
closeout with residual-resource accountability
```

This document exists so Pi can implement the first slice without inventing missing semantics.

## 2. Conformance Applicability

Normative requirements are tagged by applicability:

- `[SCHEMA]`: required for schema-conformant objects.
- `[FIRST-SLICE]`: required for the first implementation slice.
- `[KERNEL]`: required for full v0.6 kernel conformance, not necessarily implemented in this slice.

A first-slice-conformant implementation MUST:

- satisfy all `[SCHEMA]` requirements for objects named in this document
- satisfy all `[FIRST-SLICE]` requirements
- preserve schema fields reserved for `[KERNEL]` where specified
- not claim full v0.6 kernel conformance

Full workspace write leases, general message retry/backpressure, terminal-window cleanup, external-session cleanup, and artifact retention policy are `[KERNEL]` or later work unless explicitly marked `[FIRST-SLICE]`.

## 3. Threat Model

`[FIRST-SLICE]` The runtime protects topology-managed cleanup paths from:

- stale or missing authorization
- duplicate cleanup requests
- concurrent cleanup attempts
- PID reuse
- process-group overreach
- accidental deletion outside approved temp roots
- crash windows around resource creation and cleanup
- clean closeout despite residual runtime-owned resources

This slice does not claim sandbox containment against an actor that bypasses topology tools and directly uses arbitrary shell or filesystem access.

## 4. Storage Paths

`[FIRST-SLICE]` Canonical event stream:

```text
.pi/topology/missions/<mission_id>/foundation0/runtime-events.jsonl
```

`[FIRST-SLICE]` First-slice projections:

```text
.pi/topology/missions/<mission_id>/foundation0/resource-ledger.jsonl
.pi/topology/missions/<mission_id>/foundation0/cleanup-log.jsonl
.pi/topology/missions/<mission_id>/foundation0/closeout.json
.pi/topology/missions/<mission_id>/foundation0/payloads/<payload_digest>.json
.pi/topology/missions/<mission_id>/foundation0/locks/mission-events.lock
```

`runtime-events.jsonl` is authoritative. Projection files are rebuildable views or indexes. If a projection conflicts with the canonical event stream, the event stream wins and an incident or reconciliation event MUST be recorded.

Root `.pi/topology/*` files remain compatibility mirrors only and MUST NOT become canonical for first-slice state after a mission registry exists.

## 5. Foundation-0 Objects

### 5.1 Principal

`[SCHEMA]`

```json
{
  "schema_version": 1,
  "principal_id": "principal_owner_...",
  "kind": "human_owner|agent|system",
  "display_name": "owner",
  "trust_domain": "local-runtime"
}
```

Rules:

- `[FIRST-SLICE]` Owner approval MUST be represented by a `human_owner` Principal.
- `[FIRST-SLICE]` Runtime bootstrap actions MAY use a `system` Principal.

### 5.2 Mission

`[SCHEMA]`

```json
{
  "schema_version": 1,
  "mission_id": "mission_...",
  "created_by_principal_id": "principal_...",
  "created_at": "2026-06-26T12:00:00.000Z",
  "lifecycle_phase": "draft|active|closing|closed|abandoned",
  "attention_state": "clear|blocked|rollback_pending",
  "pending_gate_ids": [],
  "policy_hash": "sha256:..."
}
```

`[FIRST-SLICE]` Mission transition table:

```text
draft -> active
active -> closing
active -> abandoned
closing -> closed
closing -> abandoned
```

Rules:

- `[FIRST-SLICE]` Resource registration is allowed only when `lifecycle_phase = active`.
- `[FIRST-SLICE]` When `lifecycle_phase = closing`, only cleanup, reconciliation, evidence publication, and closeout actions are allowed.
- `[FIRST-SLICE]` Clean closeout requires `lifecycle_phase = closing`.

### 5.3 Actor

`[SCHEMA]`

```json
{
  "schema_version": 1,
  "actor_id": "actor_...",
  "principal_id": "principal_...",
  "mission_id": "mission_...",
  "role": "topology-supervisor|hq|runner|repair|oracle|governor|runtime",
  "session_id": "session_...",
  "policy_hash": "sha256:...",
  "status": "planned|live|stale|closed|failed"
}
```

Rules:

- `[FIRST-SLICE]` Cleanup actions MUST reference an Actor.
- `[FIRST-SLICE]` Runtime-internal reconciliation MAY use `role = runtime`.

### 5.4 Authorization

`[SCHEMA]`

```json
{
  "schema_version": 1,
  "authorization_id": "auth_...",
  "mission_id": "mission_...",
  "granted_by_principal_id": "principal_...",
  "granted_by_actor_id": null,
  "granted_under_authorization_id": null,
  "root_basis": "owner_approval|system_bootstrap",
  "granted_to_actor_id": "actor_...",
  "delegation_depth_remaining": 1,
  "risk_ceiling": "medium",
  "policy_hash_at_grant": "sha256:...",
  "expires_at": "2026-06-26T14:00:00.000Z",
  "supersedes_authorization_id": null,
  "grants": [
    {
      "capability": "register_resource",
      "scope": {
        "resource_types": ["process", "temp_directory"],
        "mission_relation": "same_mission",
        "approved_temp_root_ids": ["tmp_root_default"]
      },
      "risk_class": "low"
    },
    {
      "capability": "terminate_resource",
      "scope": {
        "resource_types": ["process", "temp_directory"],
        "mission_relation": "same_mission",
        "ownership_relation": "owned_or_cleanup_owned",
        "cleanup_methods": [
          "signal_pid",
          "signal_dedicated_process_group",
          "remove_owned_temp_directory"
        ],
        "approved_temp_root_ids": ["tmp_root_default"]
      },
      "risk_class": "medium"
    }
  ],
  "created_by_event_id": "evt_..."
}
```

Rules:

- `[FIRST-SLICE]` `register_resource` and `terminate_resource` MUST be defined capabilities.
- `[FIRST-SLICE]` `stale_policy_hash` is non-allowed. The action must be re-evaluated under current policy.
- `[FIRST-SLICE]` If any authorization in the chain is revoked, expired, replaced, or invalid, all descendants are invalid for new executions.
- `[FIRST-SLICE]` `expires_at` takes effect by time comparison. An `authorization_expired` event is audit evidence, not the source of expiry.
- `[FIRST-SLICE]` Renewal creates a new authorization with `supersedes_authorization_id`; it MUST NOT mutate the old record.

## 6. Action And Policy Model

### 6.1 ActionRequest

`[SCHEMA]`

```json
{
  "schema_version": 1,
  "action_id": "action_...",
  "mission_id": "mission_...",
  "actor_id": "actor_...",
  "capability": "register_resource|terminate_resource|close_mission",
  "target": {
    "resource_id": "res_..."
  },
  "authorization_id": "auth_...",
  "idempotency_key": "idem_...",
  "effect_fingerprint": "sha256:...",
  "payload_digest": "sha256:...",
  "retry_of_action_id": null,
  "requested_at": "2026-06-26T12:00:00.000Z"
}
```

`[FIRST-SLICE]` Action dedupe scope:

```text
mission_id + actor_id + capability + idempotency_key
```

Rules:

- `[FIRST-SLICE]` Same dedupe scope and same effect fingerprint returns the existing action state or outcome.
- `[FIRST-SLICE]` Same dedupe scope with different effect fingerprint MUST return `idempotency_conflict`.
- `[FIRST-SLICE]` Retry after failed or indeterminate action MUST use a new idempotency key and set `retry_of_action_id`.
- `[FIRST-SLICE]` Effect fingerprint MUST cover capability, target, payload digest, and cleanup method where applicable.

### 6.2 ActionAttempt

`[SCHEMA]`

```json
{
  "schema_version": 1,
  "action_attempt_id": "attempt_...",
  "action_id": "action_...",
  "mission_id": "mission_...",
  "attempt_number": 1,
  "started_at": "2026-06-26T12:00:00.000Z"
}
```

`[FIRST-SLICE]` Each external side effect MUST occur inside an ActionAttempt.

### 6.3 PolicyDecision

`[SCHEMA]`

```json
{
  "schema_version": 1,
  "policy_decision_id": "policy_decision_...",
  "action_id": "action_...",
  "action_attempt_id": "attempt_...",
  "mission_id": "mission_...",
  "evaluation_point": "acceptance|execution|reconciliation",
  "evaluation_sequence": 1,
  "result": "allowed|denied|requires_owner_gate|requires_authorization|requires_resource_registration|stale_policy_hash|inactive_mission|cleanup_in_progress",
  "reason_codes": [],
  "authorization_chain": ["auth_..."],
  "evaluated_policy_hash": "sha256:...",
  "decided_at": "2026-06-26T12:00:00.000Z"
}
```

Rules:

- `[FIRST-SLICE]` Only an `execution` decision with `result = allowed` may authorize an external side effect.
- `[FIRST-SLICE]` Authorization validity MUST be rechecked at execution boundary.
- `[FIRST-SLICE]` Allowed, denied, and gated decisions MUST all be durably recorded.

### 6.4 InitialOutcome

`[SCHEMA]`

```json
{
  "schema_version": 1,
  "outcome_id": "outcome_...",
  "action_attempt_id": "attempt_...",
  "action_id": "action_...",
  "mission_id": "mission_...",
  "status": "succeeded|failed|skipped|indeterminate",
  "result_code": "cleaned|already_absent|skipped_identity_mismatch|cleanup_failed|idempotency_conflict|denied",
  "evidence_ids": [],
  "created_at": "2026-06-26T12:00:00.000Z"
}
```

Rules:

- `[FIRST-SLICE]` Every ActionAttempt MUST have exactly one InitialOutcome.
- `[FIRST-SLICE]` An `indeterminate` outcome MAY later receive one ReconciliationResolution.

### 6.5 ReconciliationResolution

`[SCHEMA]`

```json
{
  "schema_version": 1,
  "resolution_id": "resolution_...",
  "action_attempt_id": "attempt_...",
  "action_id": "action_...",
  "mission_id": "mission_...",
  "resolution": "reconciled_succeeded|reconciled_failed|unresolved",
  "evidence_ids": [],
  "created_at": "2026-06-26T12:00:00.000Z"
}
```

## 7. Canonical Event Envelope

`[SCHEMA]`

```json
{
  "schema_version": 1,
  "event_id": "evt_...",
  "mission_id": "mission_...",
  "sequence": 42,
  "event_type": "action_intent|policy_decision|resource_registered|cleanup_attempted|cleanup_succeeded|cleanup_failed|reconciliation_required|closeout_started|closeout_recorded",
  "principal_id": "principal_...",
  "actor_id": "actor_...",
  "action_id": "action_...",
  "action_attempt_id": "attempt_...",
  "policy_decision_id": "policy_decision_...",
  "entity_type": "mission|resource|cleanup|closeout|authorization|action",
  "entity_id": "res_...",
  "caused_by": {
    "entity_type": "event|message|action",
    "entity_id": "evt_..."
  },
  "payload_ref": "foundation0/payloads/<payload_digest>.json",
  "payload_digest": "sha256:...",
  "created_at": "2026-06-26T12:00:00.000Z"
}
```

Rules:

- `[FIRST-SLICE]` Event `sequence` is Mission-global.
- `[FIRST-SLICE]` Sequence allocation and append MUST occur under the same Mission event lock.
- `[FIRST-SLICE]` Action intent and execution-boundary allowed PolicyDecision MUST be durably committed before external side effect begins.
- `[FIRST-SLICE]` Final outcome MUST be durably committed before runtime reports successful completion to caller.
- `[FIRST-SLICE]` Durable commit MAY use `fsync`, `fdatasync`, or an equivalent durability guarantee.
- `[FIRST-SLICE]` Unknown event types that may affect first-slice projections MUST cause `unsupported_schema` or `reconciliation_required`, not silent success.
- `[FIRST-SLICE]` Trailing partial JSONL lines MUST be detected during recovery.

Projection rules:

- `[FIRST-SLICE]` JSON snapshot projections use temporary file plus atomic rename.
- `[FIRST-SLICE]` JSONL projections append under a projection lock or are rebuilt via temporary file plus atomic rename.

## 8. Managed Resource Model

### 8.1 ManagedResource

`[SCHEMA]`

```json
{
  "schema_version": 1,
  "resource_id": "res_...",
  "mission_id": "mission_...",
  "resource_type": "process|temp_directory",
  "ownership_origin": "created|adopted",
  "owned_by_actor_id": "actor_...",
  "cleanup_owner_actor_id": "actor_...",
  "registered_by_action_id": "action_...",
  "authorization_id": "auth_...",
  "cleanup_policy": {},
  "identity": {},
  "identity_digest": "sha256:...",
  "lifecycle_state": "planned|registered|active|stale|cleanup_pending|cleanup_attempted|cleaned|cleanup_failed|abandoned",
  "verification_state": "verified|unverified",
  "created_at": "2026-06-26T12:00:00.000Z",
  "updated_at": "2026-06-26T12:00:00.000Z"
}
```

Lifecycle transitions:

```text
planned -> registered | abandoned
registered -> active | abandoned
active -> stale | cleanup_pending
stale -> cleanup_pending | cleaned
cleanup_pending -> cleanup_attempted
cleanup_attempted -> cleaned | cleanup_failed
cleanup_failed -> cleanup_pending
```

Rules:

- `[FIRST-SLICE]` `ownership_origin` is not a lifecycle state.
- `[FIRST-SLICE]` `verification_state` is orthogonal to lifecycle.
- `[FIRST-SLICE]` At most one cleanup attempt may be active for the same `resource_id + identity_digest`.
- `[FIRST-SLICE]` Cleanup-attempt acquisition MUST be serialized.
- `[FIRST-SLICE]` Concurrent cleanup with a different idempotency key MUST return `cleanup_in_progress` if another attempt is active.

### 8.2 Pre-Registration

`[FIRST-SLICE]` Runtime-created resources MUST use pre-registration:

```text
1. Allocate resource_id.
2. Durably register planned resource and cleanup policy.
3. Create external resource.
4. Record observed identity.
5. Transition to registered / active.
```

If crash occurs after planned registration but before activation, recovery MUST reconcile the planned resource rather than dropping it.

## 9. Process Resource Contract

### 9.1 Process Identity

`[SCHEMA]`

```json
{
  "pid": 12345,
  "pgid": 12345,
  "started_at_os": "2026-06-26T12:00:00.000Z",
  "spawn_token": "spawn_...",
  "executable": "/opt/homebrew/bin/node",
  "argv": ["node", "script.js"],
  "cwd": "/Users/yuantian/Documents/Coding/Pi-topology-network",
  "command_digest": "sha256:...",
  "dedicated_process_group": true
}
```

`[FIRST-SLICE]` `command_digest` canonical input:

```text
executable realpath + argv JSON + cwd realpath
```

Rules:

- `[FIRST-SLICE]` PID alone is never sufficient cleanup identity.
- `[FIRST-SLICE]` PID absent at cleanup time returns `already_absent`.
- `[FIRST-SLICE]` PID present but start time, spawn token, PGID, executable, or command digest mismatch returns `skipped_identity_mismatch` and MUST NOT signal.
- `[FIRST-SLICE]` Current CLI PID, CLI ancestors, and any process group containing the current CLI MUST NOT be signaled.

### 9.2 Process Cleanup Policy

`[SCHEMA]`

```json
{
  "termination_scope": "pid|dedicated_process_group",
  "term_signal": "SIGTERM",
  "grace_period_ms": 5000,
  "allow_force_kill": false,
  "force_signal": "SIGKILL"
}
```

Rules:

- `[FIRST-SLICE]` Only runtime-created and registered dedicated process groups may receive group signal.
- `[FIRST-SLICE]` Non-dedicated processes default to PID signal only.
- `[FIRST-SLICE]` Force kill is allowed only when cleanup policy sets `allow_force_kill = true`.
- `[FIRST-SLICE]` Identity and CLI protection MUST be rechecked immediately before force kill.
- `[FIRST-SLICE]` A retry after cleanup failure MUST use a new idempotency key.

Supported OS method:

- `[FIRST-SLICE]` macOS is the initial supported OS for process identity probing.
- `[FIRST-SLICE]` The implementation plan MUST define the exact macOS probe for process start time, PGID, ancestors, and process-group membership before coding.

## 10. Temp Directory Resource Contract

### 10.1 Temp Directory Identity

`[SCHEMA]`

```json
{
  "approved_temp_root_id": "tmp_root_default",
  "approved_temp_root_realpath": "/private/tmp",
  "path": "/private/tmp/pi-topology-...",
  "path_realpath": "/private/tmp/pi-topology-...",
  "marker_path": "/private/tmp/pi-topology-.../.pi-topology-resource.json",
  "marker_digest": "sha256:..."
}
```

Marker schema:

```json
{
  "schema_version": 1,
  "mission_id": "mission_...",
  "resource_id": "res_...",
  "identity_digest": "sha256:...",
  "created_by_action_id": "action_..."
}
```

Rules:

- `[FIRST-SLICE]` Temp resource path MUST be inside an approved temp root.
- `[FIRST-SLICE]` Registered and cleanup-time paths MUST be canonicalized with `realpath`.
- `[FIRST-SLICE]` Target and marker MUST NOT be symlinks.
- `[FIRST-SLICE]` Marker mission/resource IDs and identity digest MUST match the ledger.
- `[FIRST-SLICE]` Empty path, root path, approved temp root itself, runtime state root, mission storage root, repository root, current CLI cwd, and cwd ancestors MUST be rejected.

### 10.2 Safe Temp Directory Cleanup Algorithm

`[FIRST-SLICE]` Temp directory cleanup MUST follow:

```text
1. Canonicalize approved root once.
2. lstat target and marker; both must not be symlinks.
3. Verify marker mission_id/resource_id/identity_digest.
4. Recheck protected paths.
5. Atomically rename target to a quarantine name under the same approved root.
6. Append cleanup-attempt observation.
7. Recursively remove quarantined path without following symlinks.
```

If target changes, marker changes, or symlink appears during cleanup, result MUST be failure or skipped safety result; runtime MUST NOT delete the replacement target.

## 11. Closeout Contract

### 11.1 CloseoutRecord

`[SCHEMA]`

```json
{
  "schema_version": 1,
  "closeout_id": "closeout_...",
  "mission_id": "mission_...",
  "disposition": "clean|conditional|abandoned",
  "verified_through_sequence": 123,
  "resource_snapshot_digest": "sha256:...",
  "residual_resource_ids": [],
  "owner_decision_id": null,
  "cleanup_owner_principal_id": null,
  "evidence_ids": [],
  "created_at": "2026-06-26T12:00:00.000Z"
}
```

### 11.2 Closeout Linearization

`[FIRST-SLICE]` Clean closeout MUST follow:

```text
1. Under Mission event lock, append closeout_started.
2. Transition Mission to closing.
3. Deny new resource creation and ordinary side effects.
4. Allow only cleanup, reconciliation, evidence publication, and closeout actions.
5. Verify resources through Mission sequence N.
6. Record closeout with verified_through_sequence = N and resource_snapshot_digest.
```

Rules:

- `[FIRST-SLICE]` Clean closeout is blocked if any owned resource is active, stale, cleanup_pending, cleanup_failed, or unverified.
- `[FIRST-SLICE]` Conditional closeout requires explicit owner decision, residual resource inventory, cleanup failure evidence, residual risk statement, and named cleanup owner.
- `[FIRST-SLICE]` Owner decision for conditional closeout MUST bind the same `verified_through_sequence` and `resource_snapshot_digest`.

## 12. Message And Evidence Scope For First Slice

`[FIRST-SLICE]` Full message retry/backpressure is deferred.

However:

- cleanup requests MUST use ActionRequest idempotency
- cleanup results MUST produce evidence references
- events and outcomes MUST be sufficient to reconstruct cleanup history

`[FIRST-SLICE]` Evidence subject for cleanup is:

```json
{
  "subject_type": "managed_resource",
  "resource_id": "res_...",
  "identity_digest": "sha256:...",
  "cleanup_attempt_id": "attempt_..."
}
```

Digest canonicalization for first-slice evidence MUST use deterministic JSON serialization for event, action, outcome, and marker payloads.

## 13. First-Slice Acceptance Tests

A first-slice-conformant implementation MUST verify:

1. Unregistered resources cannot be cleaned.
2. Cross-Mission cleanup is rejected.
3. Missing capability or authorization is rejected and recorded.
4. Process identity mismatch skips without signal.
5. Current CLI, ancestors, and CLI-containing process group are protected.
6. Cleanup is idempotent by idempotency key.
7. Process cleanup follows configured `SIGTERM -> grace period -> optional SIGKILL` policy.
8. Temp directory containment rejects escape, marker mismatch, symlink escape, root path, and empty path.
9. Success and failure both produce replayable evidence.
10. Cleanup intent without outcome enters reconciliation after restart.
11. Concurrent JSONL writes do not produce interleaved rows, duplicate sequence, or silent loss.
12. Clean closeout is blocked by residual active/stale/cleanup-pending/cleanup-failed resources.
13. Authorization revoked after acceptance but before execution denies cleanup and performs no external signal/delete.
14. Concurrent cleanup with different idempotency keys allows only one active attempt; the other returns `cleanup_in_progress`.
15. Crash after external effect but before outcome is reconciled without repeating dangerous side effects.
16. Crash after resource creation but before activation uses pre-registered planned record for reconciliation.
17. Mission entering `closing` rejects new `register_resource`.
18. Non-dedicated, non-runtime-owned process groups cannot receive group signal.
19. Temp-directory quarantine race safely fails when target, marker, or symlink state changes.
20. Fault injection verifies no external effect occurs before intent and execution-boundary allowed decision are durably committed.

## 14. Deferred From First Slice

The following are intentionally not first-slice deliverables:

- terminal session cleanup
- external session cleanup
- port reservation cleanup
- worktree or branch cleanup
- container cleanup
- test server cleanup
- full workspace write lease enforcement
- full message retry/backpressure/dead-letter implementation
- full artifact retention policy
- full v0.6 JSON Schema generation for every future kernel object

They remain compatible with the v0.6 kernel but are not required to start process/temp-directory cleanup implementation.

## 15. Implementation Plan Preconditions

Before assigning implementation to Pi, the plan doc MUST specify:

- exact macOS process probe commands/APIs
- exact Mission event lock strategy
- exact durable commit strategy
- exact deterministic JSON serialization strategy for digests
- exact approved temp root and marker filename
- exact test strategy for crash windows and fault injection
- exact abstraction for process inspector/killer so unit tests do not send real broad signals

## 16. Contract Summary

This document is narrow by design.

The first slice is not “cleanup by process name.” It is:

```text
mission-owned resource registration
durable action intent and policy decision
safe process/temp-directory identity verification
serialized cleanup attempts
replayable cleanup outcomes
closeout that cannot hide residual resources
```

Once this slice passes, v0.6 can safely continue toward broader authorization, write lease, evidence, and message reliability work.
