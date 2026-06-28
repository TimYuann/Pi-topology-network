# Pi Topology v0.6 Collaboration Kernel Freeze Draft

Date: 2026-06-26
Project: Pi拓扑网络 / `packages/pi-topology`
Status: freeze draft; not yet an accepted implementation contract
Supersedes for review:

- `docs/17-pi-topology-v0.6-collaboration-kernel-spec.md`

Incorporates review from:

- `docs/Spec-review-5.5pro.md`

## 1. Purpose

This document absorbs the 5.5pro review into a stricter freeze draft for the v0.6 collaboration kernel.

The previous review draft established the right architecture line:

```text
Mission boundary
capability-first roles
append-only events
idempotent messaging
single-writer leases
independent evidence
resource ownership and cleanup
```

The review identified that the draft was still too ambiguous to freeze as an implementation contract. This freeze draft resolves the P0 semantic gaps needed before implementation planning.

## 2. Normative Language

This document uses the following terms:

- **MUST / MUST NOT**: required for a conforming implementation at the stated conformance level.
- **SHOULD / SHOULD NOT**: default requirement; deviation requires a recorded rationale.
- **MAY**: optional behavior.
- **Reserved**: schema or enum value may appear in the model, but runtime behavior is not required in the current conformance level.

Conformance levels:

| Level | Meaning |
|---|---|
| `schema-conformant` | Defines and validates the core schemas without enforcing every runtime behavior. |
| `first-slice-conformant` | Implements Foundation-0 plus process/temp-directory Resource Ledger and Cleanup Guard. |
| `v0.6-kernel-conformant` | Implements all MUST-level v0.6 collaboration kernel invariants in this document. |

The first implementation target is `first-slice-conformant`.

## 3. Threat Model

v0.6 policy enforcement protects runtime-controlled execution paths against:

- accidental misuse
- stale authorization
- duplicated requests
- role confusion
- message retries
- process identity reuse
- cleanup mistakes
- crash windows
- scope drift through peer messages

v0.6 does **not** claim OS-level sandbox containment against an actor that can bypass topology tools and directly mutate the filesystem, repository, or process table.

Therefore, “hard orchestration” in this spec means runtime-enforced policy for topology-managed actions. It does not mean adversarial security isolation from arbitrary shell access.

## 4. Core Invariants

The v0.6 kernel is organized around these invariants:

1. Every side-effecting topology-managed action MUST have an allowed `PolicyDecision`.
2. Every allowed `PolicyDecision` MUST reference a valid `ActionRequest`.
3. Every side-effecting result event MUST reference the successful `PolicyDecision` that allowed it.
4. Every authorization chain MUST terminate in a root `Principal` or system bootstrap authorization.
5. Peer messages MUST NOT implicitly expand authority or scope.
6. Controlled business targets MUST have at most one active writer per overlapping write scope.
7. Lease acquisition MUST be serialized across Missions for the same controlled target.
8. Runtime-created managed resources MUST have owner, cleanup policy, cleanup identity, and cleanup evidence.
9. Evidence and verdicts MUST bind to the exact reviewed subject revision or content digest.
10. A clean closeout MUST NOT be produced while owned managed resources remain active, stale, cleanup-pending, cleanup-failed, or unverified.

## 5. Principal, Actor, And Authority Root

### 5.1 Principal

`Principal` is the root identity model. It is distinct from a session or role actor.

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

- Owner authority MUST be represented as a `Principal`.
- System bootstrap authority MUST be represented as a `Principal`.
- Agent sessions MUST NOT be treated as root authority by role name alone.

### 5.2 Actor

`Actor` is a mission-scoped runtime identity.

```json
{
  "schema_version": 1,
  "actor_id": "actor_...",
  "principal_id": "principal_...",
  "mission_id": "mission_...",
  "role": "repair",
  "profile_id": "repair.default",
  "session_id": "session_...",
  "spawned_by_event_id": "evt_...",
  "capability_set_id": "capset_...",
  "policy_hash": "sha256:...",
  "status": "planned|launch_requested|alive_confirmed|live|stale|parked|closed|failed"
}
```

Rules:

- Actor identity MUST include `principal_id`.
- A role name MUST NOT be sufficient authorization.
- The same visible session acting on another Mission requires an explicit mission switch event.

### 5.3 Bootstrap Authority Chain

The intended authority chain is:

```text
Owner root principal
  -> mission approval authorization
  -> supervisor bounded delegation
  -> HQ / repair / runner scoped authorization
```

Each delegated authorization MUST reference:

- the granting principal
- the granting actor, if any
- the parent authorization
- whether delegation is allowed
- delegation depth
- risk ceiling
- policy hash at grant time

## 6. Capability, Grant, And Scope

### 6.1 Capability Registry

Capabilities are the runtime enforcement surface. Roles are profiles that request or receive capabilities.

The v0.6 capability registry SHOULD include:

```text
create_mission
select_mission
grant_scope
delegate_capability
spawn_actor
read_workspace
mutate_workspace
run_validation
publish_artifact
publish_evidence
read_artifact
issue_review
issue_verdict
merge_change
register_resource
terminate_resource
close_mission
```

Capability implication is not implicit. If `publish_evidence` requires `publish_artifact`, the profile or authorization MUST list both or the registry MUST define an explicit implication rule.

`allowed_actor_roles` MUST NOT be used as an authorization source. If the runtime keeps a role/profile constraint, it MUST be named `eligible_profiles` and treated only as an additional policy constraint.

### 6.2 Authorization

Authorization MUST be grant-based, not one shared scope for many capabilities.

```json
{
  "schema_version": 1,
  "authorization_id": "auth_...",
  "mission_id": "mission_...",
  "granted_by_principal_id": "principal_...",
  "granted_by_actor_id": "actor_...",
  "granted_under_authorization_id": "auth_parent_...",
  "granted_to_actor_id": "actor_...",
  "delegable": true,
  "delegation_depth": 1,
  "risk_ceiling": "medium",
  "policy_hash_at_grant": "sha256:...",
  "expires_at": "2026-06-26T14:00:00.000Z",
  "grants": [
    {
      "capability": "mutate_workspace",
      "scope": {
        "paths": ["packages/pi-topology/src/**"]
      },
      "risk_class": "medium"
    },
    {
      "capability": "publish_artifact",
      "scope": {
        "artifact_namespaces": ["repair/**"]
      },
      "risk_class": "low"
    }
  ],
  "created_by_event_id": "evt_...",
  "reason": "Scoped repair authorization"
}
```

Rules:

- Authorization grant records are immutable.
- Revocation, expiration, renewal, and replacement MUST be separate events.
- A child authorization MUST be a subset of the parent authorization.
- Delegation MUST check capability, scope, risk ceiling, expiration, and delegation depth.

### 6.3 Path Scope

Path scope MUST use repository-relative paths unless explicitly marked otherwise.

Path evaluation MUST:

- canonicalize with `realpath` where the path exists
- reject `..` escape
- reject symlink escape
- define glob syntax
- define case sensitivity for the host platform
- compute delegation with set intersection, not string prefix comparison

### 6.4 Command Scope

Command scope MUST be structured. A plain string such as `"npm test"` is not a security boundary.

```json
{
  "executable": "npm",
  "argv_patterns": [["test"], ["run", "typecheck"]],
  "cwd_scope": ["packages/pi-topology"],
  "shell": false,
  "environment_allowlist": []
}
```

If `shell: true`, effective risk MUST increase.

### 6.5 Risk Calculation

Effective risk MUST be calculated by policy, not lowered by grant text.

```text
effective_risk =
  max(
    capability_base_risk,
    target_resource_risk,
    scope_breadth_risk,
    environment_risk,
    operation_override_risk
  )
```

Authorization cannot reduce a capability's base risk by declaring a lower `risk_class`.

## 7. ActionRequest And PolicyDecision

### 7.1 ActionRequest

Every topology-managed side-effect MUST be represented as an `ActionRequest`.

```json
{
  "schema_version": 1,
  "action_id": "action_...",
  "mission_id": "mission_...",
  "actor_id": "actor_...",
  "capability": "terminate_resource",
  "target": {
    "resource_id": "res_..."
  },
  "authorization_id": "auth_...",
  "write_lease_id": null,
  "idempotency_key": "idem_...",
  "payload_digest": "sha256:...",
  "requested_at": "2026-06-26T12:00:00.000Z"
}
```

### 7.2 PolicyDecision

Every checked action MUST produce a `PolicyDecision`.

```json
{
  "schema_version": 1,
  "decision_id": "policy_decision_...",
  "action_id": "action_...",
  "mission_id": "mission_...",
  "result": "allowed|denied|requires_owner_gate|requires_reviewer_gate|requires_authorization|requires_write_lease|requires_resource_registration|stale_policy_hash|inactive_mission",
  "reason_codes": [],
  "authorization_chain": ["auth_root_...", "auth_..."],
  "write_lease_id": null,
  "evaluated_policy_hash": "sha256:...",
  "decided_at": "2026-06-26T12:00:00.000Z"
}
```

Rules:

- Allowed decisions MUST be recorded, not only denied or gated decisions.
- Every side-effect result event MUST reference an allowed decision.
- Authorization and lease validity MUST be rechecked at execution boundary, not only at message acceptance.
- If authorization is revoked after acceptance but before execution, execution MUST be denied or gated.

## 8. Controlled Target, Managed Resource, And Write Lease

### 8.1 Controlled Target

Controlled Targets exist for write coordination.

Examples:

```text
repository
worktree
branch
path_scope
state_projection
artifact_namespace
```

Controlled Targets are not cleanup resources.

```json
{
  "schema_version": 1,
  "target_id": "target_...",
  "mission_id": "mission_...",
  "target_type": "repository|worktree|branch|path_scope|state_projection|artifact_namespace",
  "controlled_resource_key": "repo:/abs/repo:path:packages/pi-topology/src/**",
  "scope": {
    "paths": ["packages/pi-topology/src/**"]
  }
}
```

### 8.2 Managed Resource

Managed Resources exist for lifecycle and cleanup.

Examples:

```text
process
temp_directory
terminal_session
container
port_reservation
test_server
```

Managed Resources are represented in the Resource Ledger. They may need cleanup.

### 8.3 Write Lease

Write Lease applies to Controlled Targets.

```json
{
  "schema_version": 1,
  "lease_id": "lease_...",
  "mission_id": "mission_...",
  "target_id": "target_...",
  "controlled_resource_key": "repo:/abs/repo:path:packages/pi-topology/src/**",
  "holder_actor_id": "actor_repair_...",
  "authorization_id": "auth_...",
  "fencing_token": 17,
  "lease_generation": 17,
  "scope": {
    "paths": ["packages/pi-topology/src/**"]
  },
  "base_revision": "git:ad0bd5b",
  "expires_at": "2026-06-26T14:00:00.000Z"
}
```

Rules:

- Lease acquisition MUST be serialized by `controlled_resource_key` across Missions.
- Every successful acquisition MUST issue a monotonically increasing fencing token.
- Every guarded write MUST present the current fencing token.
- Expired, revoked, or superseded tokens MUST be rejected.
- Lease renewal, release, revocation, and takeover MUST be formal events.
- Lease conflicts MUST be checked across Missions, not only inside one Mission.
- Kernel canonical ledgers do not use Actor-held business write leases; they use runtime append coordination, file locks, and atomic projection replacement.

## 9. Canonical Event Model

### 9.1 Source Of Truth

`runtime-events.jsonl` is the canonical state-change stream.

Domain ledgers are rebuildable projections or indexes:

```text
authorization-ledger.jsonl
write-leases.jsonl
decision-log.jsonl
resource-ledger.jsonl
cleanup-log.jsonl
artifact-index.jsonl
evidence-index.jsonl
```

If a domain ledger records a fact also represented in `runtime-events.jsonl`, the event stream is authoritative.

### 9.2 Side-Effect Ordering

For every side-effecting action, the runtime MUST:

1. Append action intent.
2. Append allowed policy decision.
3. Execute the external side effect.
4. Append exactly one observed outcome: `succeeded`, `failed`, `skipped`, or `indeterminate`.
5. Materialize projections.

A success event MUST NOT be appended before the external side effect is confirmed.

If an intent exists without an outcome after restart, the action is `interrupted` and requires reconciliation.

### 9.3 Event Append Rules

Rules:

- `sequence` is Mission-global, not Actor-local.
- Sequence allocation and append MUST occur in the same critical section.
- JSONL append MUST write exactly one complete line per record.
- Trailing partial JSONL lines MUST be detected and handled by recovery.
- Projections MUST be written by temporary file plus atomic rename.
- Unknown future event types MUST be preserved and ignored unless policy declares them required.

## 10. Message Model

Message kind and lifecycle state are separate.

```json
{
  "schema_version": 1,
  "message_id": "msg_...",
  "mission_id": "mission_...",
  "request_id": "req_...",
  "idempotency_key": "idem_...",
  "kind": "REQUEST|LIFECYCLE|REPORT",
  "operation": "run_validation|review_change|repair_slice|cleanup_resource",
  "lifecycle_state": "RECEIVED|ACCEPTED|STARTED|PROGRESS|FAILED|CANCELLED|CLOSED",
  "from_actor_id": "actor_hq_...",
  "to_actor_id": "actor_runner_...",
  "reply_target_actor_id": "actor_hq_...",
  "correlation_id": "corr_...",
  "caused_by": {
    "entity_type": "message",
    "entity_id": "msg_..."
  },
  "authorization_id": "auth_...",
  "payload_ref": "artifact_...",
  "payload_digest": "sha256:...",
  "deadline_hint": "2026-06-26T12:15:00.000Z",
  "summary": "Run focused verification"
}
```

Allowed lifecycle:

```text
REQUEST
  -> RECEIVED
  -> ACCEPTED
  -> STARTED
  -> PROGRESS*
  -> REPORT | FAILED | CANCELLED
  -> CLOSED
```

Immediate failure MAY skip `ACCEPTED` and `STARTED` only when the receiving actor cannot accept the request.

Idempotency:

```text
dedupe scope = mission_id + receiving_actor_id + idempotency_key
```

Rules:

- Same idempotency key and same payload digest returns existing lifecycle or result.
- Same idempotency key and different payload digest MUST be rejected as an idempotency conflict.
- Direct ACK maps to lifecycle reply and MUST NOT carry long business reports.

## 11. Artifact, Evidence, Decision, And Verdict

### 11.1 Artifact

```json
{
  "schema_version": 1,
  "artifact_id": "art_...",
  "mission_id": "mission_...",
  "class": "working|evidence|decision",
  "media_type": "application/json",
  "content_ref": "mission:mission_.../artifacts/runner/smoke.log",
  "digest": "sha256:...",
  "size_bytes": 1234,
  "produced_by_actor_id": "actor_...",
  "source_event_id": "evt_...",
  "supersedes_artifact_id": null,
  "created_at": "2026-06-26T12:00:00.000Z"
}
```

Digest is mandatory for formal evidence. Path convention is organizational only.

### 11.2 Evidence

Evidence source is a union, not always an artifact.

```json
{
  "schema_version": 1,
  "evidence_id": "ev_...",
  "mission_id": "mission_...",
  "source": {
    "entity_type": "artifact|event|message",
    "entity_id": "art_..."
  },
  "subject": {
    "target_id": "target_...",
    "revision": "git:abc123",
    "diff_digest": "sha256:..."
  },
  "digest": "sha256:...",
  "produced_by_actor_id": "actor_runner_...",
  "created_at": "2026-06-26T12:00:00.000Z"
}
```

### 11.3 Decision And Verdict

```json
{
  "schema_version": 1,
  "decision_id": "decision_...",
  "mission_id": "mission_...",
  "decision_type": "review_verdict|owner_gate|closeout",
  "subject_revision": "git:abc123",
  "subject_diff_digest": "sha256:...",
  "verdict": "accept|reject|conditional",
  "issued_by_actor_id": "actor_oracle_...",
  "evidence_ids": ["ev_..."],
  "evidence_set_digest": "sha256:...",
  "policy_hash": "sha256:...",
  "created_at": "2026-06-26T12:00:00.000Z"
}
```

Rules:

- A verdict is valid only for its exact subject revision and evidence set.
- Later mutation of the reviewed subject makes the verdict stale unless a new verdict explicitly reuses and revalidates prior evidence.
- Repair self-check may be evidence, but cannot become acceptance verdict.
- Oracle actor MUST NOT be the writer actor for the reviewed revision.
- Oracle session MUST NOT be the session that held the reviewed write lease.
- Oracle MUST NOT hold the target write lease when publishing verdict.

## 12. Resource Lifecycle And Cleanup Identity

### 12.1 Managed Resource Lifecycle

The Resource state machine is:

```text
planned
  -> registered
  -> active
  -> stale
  -> cleanup_pending
  -> cleanup_attempted
  -> cleaned | cleanup_failed

registered -> abandoned
active -> adopted
```

Runtime projections may derive `stale`; events should record observations and cleanup actions.

### 12.2 Process Identity

PID alone is not sufficient cleanup identity.

```json
{
  "pid": 12345,
  "pgid": 12345,
  "started_at_os": "2026-06-26T12:00:00.000Z",
  "spawn_token": "spawn_...",
  "executable": "/opt/homebrew/bin/node",
  "command_digest": "sha256:..."
}
```

Cleanup MUST skip with `skipped_identity_mismatch` if PID matches but start time, spawn token, process group, executable identity, or command digest does not match the registered identity.

Cleanup MUST reject:

- current CLI PID
- current CLI ancestor process
- any process group containing the current CLI
- targets identified only by process name or fuzzy command matching

### 12.3 Temp Directory Identity

Temp directory cleanup MUST verify:

- path is under runtime-approved temp root
- canonical `realpath` remains inside approved root
- ownership marker exists
- marker mission/resource IDs match ledger
- path is non-empty and not a root directory
- symlink escape is rejected

Repeated cleanup with the same idempotency key MUST return the first result without repeating dangerous side effects.

## 13. Closeout Semantics

Closeout disposition:

```json
{
  "closeout_disposition": "clean|conditional|abandoned",
  "residual_resource_ids": [],
  "owner_decision_id": null,
  "residual_risk_statement": null
}
```

Rules:

- Clean closeout MUST be blocked while owned resources remain active, stale, cleanup-pending, cleanup-failed, or unverified.
- Conditional closeout MAY proceed only with explicit owner decision, residual resource inventory, cleanup failure evidence, residual risk statement, and named cleanup owner.
- `delivered` may mean business result delivered; it MUST NOT imply clean archived state.

## 14. First Implementation Slice

The first slice is:

```text
Foundation-0 + Resource Ledger / Cleanup Guard
```

Foundation-0 MUST include:

- Mission identity
- Principal and Actor identity
- `register_resource` and `terminate_resource` capabilities
- minimal scoped authorization validation
- ActionRequest and PolicyDecision
- canonical event append
- resource lifecycle projection

First-slice Managed Resources:

```text
process
temp_directory
```

Deferred Resource types:

```text
terminal_window
external_session
worktree
branch
port
container
test_server
artifact cleanup
```

Artifact cleanup is deferred because artifacts are retention/provenance objects, not active runtime resources.

## 15. First-Slice Acceptance Tests

A first-slice-conformant implementation MUST verify:

1. Unregistered resources cannot be cleaned.
2. Cross-Mission cleanup is rejected.
3. Missing capability or authorization is rejected and recorded.
4. Process identity mismatch skips without signal.
5. Current CLI, ancestors, and CLI-containing process group are protected.
6. Cleanup is idempotent by idempotency key.
7. Process cleanup follows `SIGTERM -> grace period -> optional SIGKILL` policy.
8. Temp directory containment rejects escape, marker mismatch, symlink escape, root path, and empty path.
9. Success and failure both produce replayable evidence.
10. Cleanup intent without outcome enters reconciliation after restart.
11. Concurrent JSONL writes do not produce interleaved rows, duplicate sequence, or silent loss.
12. Clean closeout is blocked by residual active/stale/cleanup-pending/cleanup-failed resources.

## 16. Decisions From Prior Open Questions

The eight open questions from the previous review draft are resolved as:

1. v0.6 is capability-first with role-to-capability compatibility adapters.
2. Write leases apply to business controlled targets, not kernel canonical ledgers.
3. Supervisor may grant medium-risk capabilities only inside explicit owner delegation envelope.
4. `lifecycle_phase + attention_state` is adopted; gate state should be a derived pending-gate set.
5. Resource Ledger stays general, but first slice implements only process and temp directory.
6. Oracle independence requires different actor, different session, no reviewed write lease, revision-bound raw evidence, and runtime rejection of self-acceptance.
7. Evidence digest is mandatory; path convention is optional organization.
8. Cleanup failure blocks clean closeout; conditional closeout requires explicit owner decision.

## 17. Deferred Or Reserved

The following are intentionally deferred from first-slice conformance:

- full UI for authorization delegation
- full workspace write-lease enforcement
- full message retry/backpressure/dead-letter implementation
- terminal window control
- external session cleanup
- worktree/branch/port/container/test-server cleanup
- artifact retention policy
- generated JSON Schema or TypeScript schema generation

Schema generation is still required before `v0.6-kernel-conformant` status.

## 18. Remaining Freeze Gates

Before this document can become an accepted implementation contract, the project still needs:

- final schema files or TypeScript discriminated unions
- transition table for Mission lifecycle and attention state
- capability registry file
- exact glob semantics
- exact process start time probe method per supported OS
- JSONL lock strategy
- crash recovery procedure for interrupted actions

Until those are written, this document remains a freeze draft, not an implementation contract.

## 19. Review Position

Accepted from the 5.5pro review:

- normative language and conformance levels
- explicit threat model
- Principal root authority
- grant-based Authorization
- computable path/command/risk scope
- ActionRequest and PolicyDecision
- Controlled Target vs Managed Resource split
- lease serialization and fencing
- canonical event source with side-effect outcome ordering
- REQUEST/LIFECYCLE/REPORT message split
- artifact/evidence/verdict revision binding
- process and temp directory cleanup identity
- Foundation-0 dependency for first slice
- concrete first-slice acceptance tests

Not adopted as first-slice implementation:

- terminal window or external session cleanup
- artifact cleanup as a Managed Resource
- full JSON Schema generation
- full retry/backpressure/dead-letter runtime

These are not rejected architecturally; they are deferred to keep the first implementation slice testable.
