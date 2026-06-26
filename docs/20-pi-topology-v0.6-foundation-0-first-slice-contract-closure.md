# Pi Topology v0.6 Foundation-0 First-Slice Contract Closure

Date: 2026-06-26
Project: Pi拓扑网络 / `packages/pi-topology`
Status: first-slice contract closure candidate
Closes review for:

- `docs/19-pi-topology-v0.6-foundation-0-first-slice-contract.md`
- `docs/spec19-review-gpt5.5.md`

## 1. Purpose

This document closes the remaining P0 contract gaps identified in the review of spec 19.

It does not expand first-slice scope. The first slice remains:

```text
Foundation-0
+ process / temp-directory Resource Ledger
+ Cleanup Guard
```

This document is intentionally narrower than the v0.6 kernel. It exists to make the first slice machine-checkable and implementation-ready.

## 2. Document Precedence

For Foundation-0 and the first implementation slice:

1. This document supersedes conflicting first-slice semantics in `docs/19-pi-topology-v0.6-foundation-0-first-slice-contract.md`.
2. `docs/19-pi-topology-v0.6-foundation-0-first-slice-contract.md` remains normative where not contradicted here.
3. `docs/18-pi-topology-v0.6-collaboration-kernel-freeze-draft.md` remains normative only for deferred kernel areas not redefined by docs 19 or this closure.
4. Review documents are informative, not normative.

Implementation plans MUST cite this document as the current first-slice contract.

## 3. First-Slice Schema Requirement

Before coding begins, the implementation plan MUST create TypeScript discriminated unions or JSON Schema for the following first-slice objects:

```text
Principal
Mission
Actor
RootAuthorization
DelegatedAuthorization
ActionRequest
ActionAttempt
PolicyDecision
InitialOutcome
ReconciliationObservation
ReconciliationResolution
Event
ManagedResource
ProcessIdentity
ProcessCleanupPolicy
TempDirectoryIdentity
TempDirectoryMarker
TempDirectoryCleanupPolicy
Evidence
OwnerDecision
CloseoutRecord
```

These schemas MUST define:

- required fields
- optional fields
- nullable fields
- enum values
- discriminant fields
- string patterns
- timestamp format
- digest format
- ID grammar
- `additionalProperties` policy
- cross-field constraints required by this contract

Schema examples in docs 18 and 19 are illustrative. The first-slice schemas produced for implementation are the machine-checkable source for validation.

## 4. ID, Digest, And Timestamp Grammar

First-slice IDs used in paths or ledger references MUST match:

```text
^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$
```

This applies to:

```text
mission_id
principal_id
actor_id
authorization_id
action_id
action_attempt_id
policy_decision_id
event_id
resource_id
evidence_id
owner_decision_id
closeout_id
```

IDs MUST NOT contain path separators, `..`, shell metacharacter semantics, or leading dots.

Digest fields MUST use:

```text
sha256:<lowercase-hex>
```

Timestamps MUST use ISO-8601 UTC with millisecond precision unless an OS raw timestamp field is explicitly defined.

Mission storage path derivation MUST use the validated `mission_id`; it MUST NOT use unvalidated title or objective text.

## 5. First-Slice Capability Registry

The first-slice capability registry MUST define:

| Capability | Base risk | Target | Allowed Mission phases |
|---|---:|---|---|
| `create_managed_resource` | `low|medium` by resource type | resource | `active` |
| `register_resource` | `low` | resource | `active` |
| `terminate_resource` | `medium` | resource | `active|closing` |
| `reconcile_resource` | `low`, upgraded if side-effecting | resource/action | `active|closing` |
| `close_mission` | `medium` | mission | `active|closing` |

`create_managed_resource` is separate from `register_resource`.

Rules:

- `register_resource` records or adopts a resource.
- `create_managed_resource` authorizes creating the external process or temp directory described by the action payload.
- A single implementation command may perform both only if the ActionRequest includes both capabilities or an explicit composite policy rule.
- `system_bootstrap` MUST NOT authorize cleanup of arbitrary PID/path inputs.
- `system_bootstrap` MAY authorize reconciliation only for an already planned or registered resource in the same Mission, originally created under owner-rooted authorization, with owner-approved cleanup policy.

## 6. Authorization Discriminated Union

Authorization MUST be a discriminated union.

### 6.1 RootAuthorization

```json
{
  "authorization_kind": "root",
  "authorization_id": "auth_...",
  "mission_id": "mission_...",
  "granted_by_principal_id": "principal_owner_...",
  "granted_by_actor_id": null,
  "granted_under_authorization_id": null,
  "root_basis": "owner_approval|system_bootstrap",
  "granted_to_actor_id": "actor_...",
  "delegation_depth_remaining": 1,
  "risk_ceiling": "medium",
  "policy_hash_at_grant": "sha256:...",
  "expires_at": "2026-06-26T14:00:00.000Z",
  "grants": []
}
```

### 6.2 DelegatedAuthorization

```json
{
  "authorization_kind": "delegated",
  "authorization_id": "auth_...",
  "mission_id": "mission_...",
  "granted_by_principal_id": "principal_...",
  "granted_by_actor_id": "actor_...",
  "granted_under_authorization_id": "auth_parent_...",
  "root_basis": null,
  "granted_to_actor_id": "actor_...",
  "delegation_depth_remaining": 0,
  "risk_ceiling": "low|medium",
  "policy_hash_at_grant": "sha256:...",
  "expires_at": "2026-06-26T14:00:00.000Z",
  "grants": []
}
```

Rules:

- Child `delegation_depth_remaining` MUST be strictly less than parent.
- If any authorization in the chain is revoked, expired, replaced, or invalid under current policy, descendant authorizations are invalid for new execution.
- `stale_policy_hash` is non-allowed and requires re-evaluation under current policy.
- Authorization renewal MUST create a new authorization with `supersedes_authorization_id`; existing records are immutable.

## 7. ActionRequest Discriminated Union

ActionRequest MUST be a discriminated union. `target` and `payload` MUST match the capability.

### 7.1 Common Fields

All ActionRequests include:

```json
{
  "schema_version": 1,
  "action_id": "action_...",
  "mission_id": "mission_...",
  "actor_id": "actor_...",
  "authorization_id": "auth_...",
  "idempotency_key": "idem_...",
  "payload_ref": "foundation0/payloads/<payload_digest>.json",
  "payload_digest": "sha256:...",
  "effect_fingerprint": "sha256:...",
  "retry_of_action_id": null,
  "requested_at": "2026-06-26T12:00:00.000Z"
}
```

Runtime MUST recompute `payload_digest` and `effect_fingerprint` from canonical payload content. Caller-provided digest values are hints, not trusted facts.

### 7.2 RegisterResourceAction

```json
{
  "capability": "register_resource",
  "target": {
    "entity_type": "resource",
    "resource_id": "res_..."
  },
  "payload_kind": "register_resource"
}
```

### 7.3 CreateManagedResourceAction

```json
{
  "capability": "create_managed_resource",
  "target": {
    "entity_type": "resource",
    "resource_id": "res_..."
  },
  "payload_kind": "create_managed_resource"
}
```

Payload MUST include a creation plan for either process or temp directory. The plan is bound into `effect_fingerprint`.

### 7.4 TerminateResourceAction

```json
{
  "capability": "terminate_resource",
  "target": {
    "entity_type": "resource",
    "resource_id": "res_..."
  },
  "payload_kind": "terminate_resource"
}
```

Payload MUST include cleanup method, expected identity digest, and cleanup policy snapshot.

### 7.5 ReconcileResourceAction

```json
{
  "capability": "reconcile_resource",
  "target": {
    "entity_type": "resource",
    "resource_id": "res_..."
  },
  "payload_kind": "reconcile_resource"
}
```

If reconciliation performs another external side effect, it MUST create a new ActionAttempt with execution-boundary PolicyDecision.

### 7.6 CloseMissionAction

```json
{
  "capability": "close_mission",
  "target": {
    "entity_type": "mission",
    "mission_id": "mission_..."
  },
  "payload_kind": "close_mission"
}
```

Schema validation MUST reject a `close_mission` action targeting a resource and a `terminate_resource` action targeting a mission.

## 8. Event Catalog And Payload Durability

The first-slice Event schema MUST be a discriminated union.

The event catalog MUST include at least:

```text
mission_created
mission_phase_changed

authorization_granted
authorization_revoked
authorization_replaced

action_requested
action_attempt_started
policy_decision_recorded
initial_outcome_recorded

resource_planned
resource_identity_observed
resource_registered
resource_activated
resource_stale_observed
resource_cleanup_pending
resource_cleanup_attempted
resource_cleaned
resource_cleanup_failed
resource_abandoned

reconciliation_required
reconciliation_observed
reconciliation_resolved

closeout_started
closeout_recorded

projection_conflict_detected
unsupported_schema_detected
```

Each event type MUST define which references are required:

- `principal_id`
- `actor_id`
- `action_id`
- `action_attempt_id`
- `policy_decision_id`
- `entity_type`
- `entity_id`
- `payload_ref`
- `payload_digest`

Rules:

- Referenced payload content MUST be durably written and digest-verified before the event that references it is durably appended.
- Foundation-0 canonical payload refs use `foundation0/payloads/<payload_digest>.json` under the mission's `foundation0/` storage root.
- InitialOutcome MUST be durably committed before reporting any terminal result to the caller: `succeeded`, `failed`, `skipped`, or `indeterminate`.
- Missing payload or digest mismatch MUST produce reconciliation or unsupported-schema evidence, not a successful projection.

## 9. ManagedResource Union And Nullability

ManagedResource MUST be a discriminated union by `resource_type` and lifecycle phase.

### 9.1 Planned Resource

When `lifecycle_state = planned`:

```json
{
  "identity": null,
  "identity_digest": null,
  "verification_state": "unverified"
}
```

### 9.2 Observed Resource

When lifecycle state is one of:

```text
registered
active
stale
cleanup_pending
cleanup_attempted
cleaned
cleanup_failed
```

then:

```text
identity MUST be present
identity_digest MUST be present
cleanup_policy MUST match resource type
```

Resource cleanup policy MUST be one of:

```text
ProcessCleanupPolicy
TempDirectoryCleanupPolicy
```

## 10. Outcome Unions And Resource State Mapping

InitialOutcome MUST be action-specific, not one cleanup-only enum shared by all actions.

Cleanup outcome mapping:

| Outcome | Resource lifecycle | Verification |
|---|---|---|
| `cleaned` | `cleaned` | `verified` |
| `already_absent` | `cleaned` | `verified` |
| `skipped_identity_mismatch` | `cleanup_failed` | `unverified` |
| protected path / CLI protection | `cleanup_failed` | `unverified` |
| marker mismatch / target changed | `cleanup_failed` | `unverified` |
| ordinary cleanup failure | `cleanup_failed` | `unverified` |
| `indeterminate` | `cleanup_attempted` | `unverified` |
| `reconciled_succeeded` | `cleaned` | `verified` |
| `reconciled_failed` | `cleanup_failed` | `unverified` |

Active cleanup attempt:

```text
action_attempt_started exists
AND no final non-indeterminate terminal resolution exists
```

An `indeterminate` outcome no longer executes effects, but it blocks a new destructive attempt until reconciliation or explicit retry authorization.

## 11. Reconciliation Model

Reconciliation MUST distinguish observations from final resolution.

### 11.1 ReconciliationObservation

There may be zero or more observations:

```json
{
  "schema_version": 1,
  "observation_id": "recon_obs_...",
  "action_attempt_id": "attempt_...",
  "action_id": "action_...",
  "mission_id": "mission_...",
  "state": "still_unresolved|observed_cleaned|observed_failed|requires_manual",
  "reconciliation_action_id": "action_...",
  "reconciliation_actor_id": "actor_...",
  "policy_decision_id": "policy_decision_...",
  "evidence_ids": [],
  "observed_at": "2026-06-26T12:00:00.000Z"
}
```

### 11.2 ReconciliationResolution

At most one final resolution is allowed:

```json
{
  "schema_version": 1,
  "resolution_id": "resolution_...",
  "action_attempt_id": "attempt_...",
  "action_id": "action_...",
  "mission_id": "mission_...",
  "resolution": "reconciled_succeeded|reconciled_failed",
  "reconciliation_action_id": "action_...",
  "reconciliation_actor_id": "actor_...",
  "policy_decision_id": "policy_decision_...",
  "evidence_ids": [],
  "observed_at": "2026-06-26T12:00:00.000Z"
}
```

Recovery procedure MUST cover:

- planned resource without observed identity
- intent without policy decision
- allowed policy decision without outcome
- process cleanup interrupted after SIGTERM
- temp cleanup interrupted after quarantine rename
- indeterminate outcome without final reconciliation
- closeout_started without closeout_recorded
- trailing partial canonical event
- missing or digest-mismatched payload_ref

## 12. Process Identity And Signal Steps

`spawn_token` is renamed to `spawn_nonce`.

`spawn_nonce` is provenance. It is not a cleanup-time live probe unless the implementation plan defines a reliable live observation mechanism.

Process identity MUST include raw OS start time precision:

```json
{
  "pid": 12345,
  "pgid": 12345,
  "start_time_seconds": 1234567890,
  "start_time_microseconds": 123456,
  "spawn_nonce": "spawn_...",
  "executable": "/opt/homebrew/bin/node",
  "argv": ["node", "script.js"],
  "cwd": "/Users/yuantian/Documents/Coding/Pi-topology-network",
  "command_digest": "sha256:...",
  "dedicated_process_group": true
}
```

Rules:

- Identity, authorization, Mission phase, and CLI protection MUST be rechecked immediately before every signal operation.
- This includes SIGTERM, SIGKILL, process-group SIGTERM, and process-group SIGKILL.
- SIGTERM uses an execution PolicyDecision.
- If force kill is needed after grace period, the runtime MUST perform a new policy evaluation before SIGKILL.
- If authorization is revoked during grace period, SIGKILL MUST NOT be sent.

## 13. Temp Directory Identity And Quarantine Recovery

TempDirectoryIdentity MUST avoid digest cycles.

```json
{
  "identity_core": {
    "approved_temp_root_id": "tmp_root_default",
    "canonical_path": "/private/tmp/pi-topology-...",
    "device_id": 1,
    "inode": 123,
    "owner_uid": 501,
    "creation_nonce": "nonce_..."
  },
  "identity_digest": "sha256(canonical(identity_core))",
  "marker_digest": "sha256(canonical(marker))"
}
```

Marker references `identity_digest`. `marker_digest` does not participate in `identity_digest`.

Rules:

- Cleanup MUST resolve `approved_temp_root_id` through a trusted runtime registry, not only from the Resource record.
- Runtime MUST compare device/inode before destructive deletion.
- `quarantine_path` MUST be deterministic from `resource_id + action_attempt_id`.
- Quarantine path MUST be included in action payload, effect fingerprint, and durable intent before rename.
- After rename, runtime MUST lstat quarantine path and verify device/inode match pre-rename identity.
- Runtime MUST re-verify marker digest after rename.
- If recursive delete fails, Resource state MUST record `current_locator = quarantine_path`.
- Retry after quarantine failure targets quarantine path, not the disappeared original path.

## 14. First-Slice Evidence

Evidence MUST be defined for the first slice even though full artifact retention is deferred.

```json
{
  "schema_version": 1,
  "evidence_id": "ev_...",
  "mission_id": "mission_...",
  "source": {
    "entity_type": "event|action|outcome|payload",
    "entity_id": "evt_..."
  },
  "subject": {
    "subject_type": "managed_resource",
    "resource_id": "res_...",
    "identity_digest": "sha256:...",
    "action_attempt_id": "attempt_..."
  },
  "digest": "sha256:...",
  "produced_by_principal_id": "principal_...",
  "produced_by_actor_id": "actor_...",
  "created_at": "2026-06-26T12:00:00.000Z"
}
```

Canonical event payloads that support first-slice evidence MUST have minimum retention for Mission audit and cleanup reconstruction. They MUST NOT be treated as disposable working artifacts.

## 15. OwnerDecision And Closeout Completion

### 15.1 OwnerDecision

```json
{
  "schema_version": 1,
  "owner_decision_id": "owner_decision_...",
  "mission_id": "mission_...",
  "issued_by_principal_id": "principal_owner_...",
  "decision": "approve_conditional_closeout|reject_conditional_closeout|abandon",
  "verified_through_sequence": 123,
  "resource_snapshot_digest": "sha256:...",
  "residual_resource_ids": ["res_..."],
  "created_at": "2026-06-26T12:00:00.000Z"
}
```

### 15.2 CloseoutRecord Residuals

CloseoutRecord MUST use per-resource residual entries:

```json
{
  "residual_resources": [
    {
      "resource_id": "res_...",
      "lifecycle_state": "cleanup_failed",
      "verification_state": "unverified",
      "residual_risk_statement": "...",
      "cleanup_owner_principal_id": "principal_...",
      "evidence_ids": ["ev_..."]
    }
  ]
}
```

Clean closeout is allowed only when every owned resource is either:

- `cleaned + verified`, or
- `abandoned + verified as never externally created`

Clean closeout is blocked by:

- planned resources
- registered resources
- active resources
- stale resources
- cleanup_pending resources
- cleanup_attempted resources
- cleanup_failed resources
- unverified resources
- unfinished ActionAttempt
- indeterminate ActionAttempt without final reconciliation
- closeout-relevant unsupported event

### 15.3 Final Closeout Algorithm

The final closeout algorithm is:

```text
1. Under Mission event lock, record closeout_started and transition to closing.
2. Release lock.
3. Complete cleanup / reconciliation.
4. Reacquire Mission event lock.
5. Rebuild from canonical events to latest sequence N.
6. Verify all resources satisfy closeout conditions.
7. In the same critical section, append closeout_recorded and Mission closed transition.
8. Durably commit, then release lock.
```

Conditional closeout requires OwnerDecision bound to the same `verified_through_sequence`, `resource_snapshot_digest`, and residual resource set.

## 16. Additional Acceptance Tests

The 20 tests in doc 19 remain required. Add:

21. Schema cross-field validation: `planned` Resource may lack identity; `active` Resource without identity is rejected.
22. Action target validation: wrong target type for `close_mission` or `terminate_resource` is rejected.
23. Payload/fingerprint integrity: runtime recomputation mismatch prevents execution.
24. System-bootstrap confinement: system principal cannot clean unregistered resources or arbitrary PID/path.
25. Temp identity digest is non-circular and independently verifiable.
26. Temp inode replacement protection: same path/marker text but different inode is not deleted.
27. Quarantine crash recovery: rename succeeded but delete not recorded can be recovered from durable intent.
28. Signal-step reauthorization: authorization revoked after SIGTERM prevents SIGKILL.
29. Reconciliation can progress after unresolved observations to final result.
30. Complete closeout blocking covers planned, registered, cleanup_attempted, and unverified resources.
31. Missing event payload recovery: missing or digest-mismatched payload triggers reconciliation, not successful projection.
32. Conditional closeout binding: OwnerDecision, snapshot digest, and residual inventory mismatch is rejected.

## 17. Updated Implementation Preconditions

Before implementation begins, the plan doc MUST specify:

- first-slice TypeScript unions or JSON Schemas
- normative document precedence rule
- ID grammar and mission-path derivation rule
- first-slice capability/risk/scope registry
- typed ActionRequest payloads and target unions
- root/delegated/system-bootstrap authorization schemas
- complete event catalog and event payload schemas
- payload durable-write-before-event strategy
- Mission event lock strategy and lock ordering
- cleanup-attempt serialization strategy
- canonical JSON and all digest input definitions
- resource outcome-to-state transition table
- exact crash recovery and reconciliation procedure
- exact macOS raw process-start probe
- spawn nonce semantics
- exact argv, cwd, and executable observation method
- policy recheck strategy for SIGTERM and SIGKILL
- trusted approved-temp-root registry
- temp identity core and non-circular digest rules
- quarantine path derivation and residual locator rules
- first-slice Evidence and OwnerDecision schemas
- resource snapshot digest canonicalization
- closeout final critical-section algorithm
- fault-injection and no-real-broad-signal test strategy

## 18. Closure Summary

After this closure, the first-slice contract is no longer blocked by architecture questions.

Remaining work before coding is procedural:

```text
write the implementation plan
produce machine-checkable first-slice schemas
define the exact macOS probes and locking/durability strategy
then implement against tests 1-32
```

The first slice MUST stay narrow. It should not add terminal session cleanup, broad workspace write leases, message backpressure, or new resource types.
