# Pi Topology v0.6 Collaboration Kernel Spec

Date: 2026-06-26
Project: Pi拓扑网络 / `packages/pi-topology`
Status: review draft; not an implementation contract
Depends on:

- `docs/14-pi-topology-mission-runtime-spec.md`
- `docs/15-pi-topology-mission-runtime-v0.6-hardening-notes.md`
- `docs/16-pi-topology-collaboration-intro.md`
- `docs/Multi-agent-structure-review.md`

## 1. Purpose

This document turns the current multi-agent topology discussion into a reviewable v0.6 architecture spec.

The purpose is not to add more roles or immediately replace the Ghostty launcher. The purpose is to define the collaboration kernel that makes multi-agent work governable, auditable, recoverable, and safe to clean up.

The core claim is:

```text
Trusted multi-agent collaboration =
  controlled authorization
  x single active writer per controlled resource
  x independent evidence
  x replayable state
  x recoverable resources
```

If any part is missing, the system falls back to role-play coordination: useful, but not reliable enough for repeated real project work.

## 2. Scope

This spec covers the v0.6 collaboration kernel:

- Mission as the audit and consistency boundary.
- Capability and authorization as the runtime expression of authority.
- Role profiles as capability presets, not architecture primitives.
- Append-only events as the source of truth for state changes.
- Idempotent messages with explicit lifecycle semantics.
- Write leases for single-writer discipline.
- Evidence provenance for independent review.
- Resource ledger and cleanup contract for process and runtime resource ownership.
- Runtime policy enforcement as the soft/hard orchestration arbitrator.

This spec does not require:

- A new UI.
- A new terminal backend.
- Full event-sourcing migration in one release.
- Rewriting existing v0.5 mission storage.
- Removing root `.pi/topology/*` compatibility mirrors.
- Replacing all existing role prompts.

## 3. Design Principles

### 3.1 Information Mesh, Authority Hierarchy

Agents may exchange information horizontally. They must not transfer authority horizontally unless the receiving action references a valid authorization granted by an authorized upstream actor.

Information edges include:

- findings
- evidence references
- test output summaries
- review risks
- implementation notes
- status updates

Authority edges include:

- mission approval
- scope grant
- capability grant
- write lease
- resource cleanup permission
- rollback permission
- final verdict

Peer messages are information by default. A peer message may carry an authorization reference, but the authority comes from the referenced authorization object, not from the sender's prose.

### 3.2 Capability First, Role As Profile

The runtime should not treat role names as the source of truth for permission.

Roles remain useful human-facing profiles:

- `topology-supervisor`
- `hq`
- `oracle`
- `repair`
- `runner`
- `governor`

But enforcement must check capabilities and authorizations.

Example capability names:

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
issue_review
issue_verdict
merge_change
register_resource
terminate_resource
close_mission
```

Example role profiles:

```text
repair = read_workspace + mutate_workspace + publish_artifact
runner = read_workspace + run_validation + publish_evidence
oracle = read_artifact + issue_review
hq = decompose_work + grant_limited_scope + merge_change
topology-supervisor = create_mission + select_mission + spawn_actor + close_mission
```

Role profiles may vary per mission. A role name alone is never sufficient proof that an action is allowed.

### 3.3 Runtime Policy Arbitrates Soft And Hard Orchestration

Soft orchestration includes prompts, role docs, plan docs, inline tasks, packet wording, and social discipline.

Hard orchestration includes schemas, tool guards, path guards, capability checks, authorization checks, write leases, resource ownership checks, and cleanup guards.

When soft and hard orchestration disagree:

- Hard policy wins for side-effecting actions.
- The blocked attempt must be recorded as a policy decision or incident.
- The actor may request escalation, but may not bypass policy.
- Supervisor may explain, replan, or request a higher authorization; it is not root authority.

The policy engine is the arbitrator. Agent text is input to the policy engine, not a replacement for it.

## 4. System Invariants

The following invariants are the main output of this spec. v0.6 implementation work should be judged by whether these become runtime-checkable.

1. Every side-effecting action has a verifiable authorization.
2. Every controlled resource has at most one active writer at a time.
3. The actor that changes a controlled resource cannot independently issue the final acceptance verdict for that change.
4. ACK only represents lifecycle state; it never represents business completion.
5. Every event, message, artifact, evidence item, authorization, lease, and resource belongs to a Mission.
6. Peer messages cannot implicitly expand authority or scope.
7. Every runtime-created resource has an owner, cleanup policy, and cleanup evidence.
8. Runtime state changes are append-only first; mutable views are derived or materialized checkpoints.
9. Duplicate messages are safe to consume idempotently.
10. Mission closeout cannot claim complete cleanup while owned resources remain active or cleanup is unverified.

## 5. Core Object Model

### 5.1 Mission

Mission is the audit root and consistency boundary.

All durable side effects must reference a `mission_id`. Actions without a mission may inspect global configuration but must not mutate mission state, workspace state, registered resources, or evidence ledgers.

Mission owns:

- authorizations
- role instances
- messages
- state transitions
- tool calls
- artifacts
- evidence
- write leases
- resources
- verdicts
- cleanup records

Minimum Mission identity fields:

```json
{
  "schema_version": 1,
  "mission_id": "mission_20260626T120000Z_resource-ledger_ab12cd",
  "title": "Resource ledger hardening",
  "objective": "Define and validate owned runtime resource cleanup",
  "created_at": "2026-06-26T12:00:00.000Z",
  "created_by": "owner|topology-supervisor",
  "lifecycle_phase": "draft|awaiting_owner_confirmation|team_building|running|reviewing|delivering|delivered|archived|abandoned",
  "attention_state": "clear|blocked|parked|rollback_pending",
  "gate_required": "none|owner|reviewer|both"
}
```

v0.6 should prefer `lifecycle_phase + attention_state` over overloading one `lifecycle_state` field.

### 5.2 Actor

Actor is a runtime identity, not only a role name.

```json
{
  "actor_id": "actor_...",
  "mission_id": "mission_...",
  "role": "repair",
  "profile_id": "repair.default",
  "session_id": "agent-...",
  "spawned_by_event_id": "evt_...",
  "capability_set_id": "capset_...",
  "policy_hash": "sha256:...",
  "status": "planned|launch_requested|alive_confirmed|live|stale|parked|closed|failed"
}
```

The same role may have different capabilities in different missions. The same human-visible session may not act on two missions unless the runtime records an explicit mission switch event.

### 5.3 Capability

Capability describes an action class the runtime can authorize.

```json
{
  "capability": "mutate_workspace",
  "resource_types": ["worktree", "path"],
  "requires_authorization": true,
  "requires_write_lease": true,
  "allowed_actor_roles": ["repair"],
  "risk_class": "low|medium|high|critical"
}
```

Capability definitions are global policy, while authorization grants are mission-local.

### 5.4 Authorization

Authorization is the durable proof that an actor may perform a side-effecting action.

```json
{
  "schema_version": 1,
  "authorization_id": "auth_...",
  "mission_id": "mission_...",
  "granted_by_actor_id": "actor_supervisor_...",
  "granted_to_actor_id": "actor_repair_...",
  "capabilities": ["mutate_workspace", "publish_artifact"],
  "scope": {
    "paths": ["packages/pi-topology/src/**"],
    "commands": ["npm test", "npm run typecheck"],
    "resource_types": ["worktree", "artifact"]
  },
  "risk_class": "medium",
  "expires_at": "2026-06-26T14:00:00.000Z",
  "revocation_state": "active|revoked|expired",
  "created_by_event_id": "evt_...",
  "reason": "Scoped repair for resource ledger slice"
}
```

Rules:

- Authorization cannot exceed the granter's authority.
- Authorization must be scoped.
- Authorization must be revocable or expirable.
- A peer message without `authorization_id` cannot expand scope.
- High-risk capabilities require owner gate unless explicitly delegated by a higher-level owner authorization.

### 5.5 Write Lease

Write lease enforces single-writer discipline for controlled resources.

```json
{
  "schema_version": 1,
  "lease_id": "lease_...",
  "mission_id": "mission_...",
  "resource_id": "res_worktree_...",
  "resource_type": "worktree|path|branch|artifact|state_file",
  "holder_actor_id": "actor_repair_...",
  "authorization_id": "auth_...",
  "scope": {
    "paths": ["packages/pi-topology/src/runtime/**"]
  },
  "base_revision": "ad0bd5b",
  "expires_at": "2026-06-26T14:00:00.000Z",
  "status": "active|released|expired|revoked"
}
```

Rules:

- A resource may have only one active write lease for overlapping write scope.
- Read-only actors do not receive write leases.
- Runner and oracle may write runtime evidence artifacts without receiving business-code write leases.
- Lease release must be recorded before final closeout or handoff.

### 5.6 Event

Events are append-only records of runtime facts.

```json
{
  "schema_version": 1,
  "event_id": "evt_...",
  "mission_id": "mission_...",
  "event_type": "authorization_granted|message_received|resource_registered|cleanup_attempted",
  "entity_type": "mission|actor|message|authorization|lease|artifact|evidence|resource|decision",
  "entity_id": "auth_...",
  "actor_id": "actor_...",
  "actor_role": "hq",
  "correlation_id": "corr_...",
  "causation_id": "evt_...",
  "authorization_id": "auth_...",
  "resource_id": "res_...",
  "sequence": 42,
  "created_at": "2026-06-26T12:00:00.000Z",
  "payload_ref": "mission:mission_.../artifacts/hq/event-payloads/evt_....json",
  "summary": "Granted scoped repair authorization"
}
```

Rules:

- Append event first, then materialize state views.
- JSONL ledgers append complete lines only.
- JSON state files are materialized views and must be recoverable from events or reconciled with incidents.
- Root mirrors remain compatibility views, not canonical state, once mission registry exists.

### 5.7 Message

Message is a transport-level packet with lifecycle semantics.

Minimum message envelope:

```json
{
  "schema_version": 1,
  "message_id": "msg_...",
  "mission_id": "mission_...",
  "request_id": "req_...",
  "idempotency_key": "idem_...",
  "type": "RECEIVED|ACCEPTED|STARTED|PROGRESS|REPORT|FAILED|CANCELLED|CLOSED",
  "from_actor_id": "actor_hq_...",
  "to_actor_id": "actor_runner_...",
  "reply_target_actor_id": "actor_hq_...",
  "correlation_id": "corr_...",
  "causation_id": "msg_...",
  "authorization_id": "auth_...",
  "deadline_hint": "2026-06-26T12:15:00.000Z",
  "artifact_refs": [],
  "summary": "Run focused verification for slice A"
}
```

Rules:

- Direct ACK remains lifecycle reply only.
- Business reports travel as packets plus artifacts.
- ACK does not imply business success.
- Duplicate `idempotency_key` must not repeat side effects.
- Timeout means no response in the observed window, not peer failure.
- Cancellation must be explicit and should propagate through `causation_id` chains.

### 5.8 Artifact And Evidence

Artifact is durable content. Evidence is an artifact, packet, event, or digest that supports a verdict.

Artifact classes:

```text
working artifact   intermediate output that may be superseded
evidence artifact  immutable support for a conclusion
decision artifact  verdict and rationale
```

Evidence index record:

```json
{
  "schema_version": 1,
  "evidence_id": "ev_...",
  "mission_id": "mission_...",
  "artifact_id": "art_...",
  "kind": "test_log|smoke_log|review_note|terminal_log|packet|diff|closeout",
  "produced_by_actor_id": "actor_runner_...",
  "produced_by_role": "runner",
  "source_event_id": "evt_...",
  "correlation_id": "corr_...",
  "digest": "sha256:...",
  "status": "draft|referenced|reviewed|accepted|superseded|archived",
  "created_at": "2026-06-26T12:00:00.000Z"
}
```

Rules:

- Evidence used in a final verdict must be immutable or content-addressed.
- Oracle reviews evidence; it should not rely only on HQ-curated prose when raw evidence exists.
- Runner produces verification evidence but does not issue final acceptance.
- Repair may produce self-check artifacts, but they are not formal pass verdicts.

### 5.9 Resource

Resource is any runtime-created or runtime-owned thing that may need cleanup.

```json
{
  "schema_version": 1,
  "resource_id": "res_...",
  "mission_id": "mission_...",
  "resource_type": "process|terminal_window|temp_directory|worktree|branch|lock|port|test_server|container|artifact|external_session",
  "created_by_actor_id": "actor_runner_...",
  "owned_by_actor_id": "actor_runner_...",
  "registered_by_event_id": "evt_...",
  "authorization_id": "auth_...",
  "backend": "ghostty|shell|node|filesystem|git|unknown",
  "external_identifier": {
    "pid": 12345,
    "pgid": 12345,
    "path": "/tmp/pi-topology-...",
    "window_id": null
  },
  "cleanup_policy": "none|on_actor_close|on_mission_close|manual_owner_gate|required_before_closeout",
  "cleanup_owner_actor_id": "actor_supervisor_...",
  "lease_expires_at": "2026-06-26T14:00:00.000Z",
  "status": "registered|active|stale|cleanup_pending|cleanup_attempted|cleaned|cleanup_failed|adopted|abandoned"
}
```

Rules:

- Cleanup may only target resources registered to the mission or explicitly adopted by the mission.
- Cleanup must not rely only on process name or broad command-line matching.
- Cleanup must avoid the current CLI process and its ancestors unless explicitly authorized by owner.
- Cleanup attempts must append evidence.
- Mission closeout must report remaining active or failed-cleanup resources.

## 6. Policy Enforcement Model

### 6.1 Policy Decision Points

Runtime policy should be checked at these points:

- mission creation and selection
- role spawn and resume
- message send with authorization references
- artifact write
- business workspace mutation
- validation command execution
- resource registration
- resource cleanup
- decision and verdict publication
- mission closeout

### 6.2 Policy Decision Result

Every checked side-effecting action should produce one of:

```text
allowed
denied
requires_owner_gate
requires_reviewer_gate
requires_authorization
requires_write_lease
requires_resource_registration
stale_policy_hash
inactive_mission
```

Denied and gated decisions should be logged as events or incidents with enough evidence for review.

### 6.3 Supervisor Constraint

Supervisor is a control-plane actor, not absolute root.

Supervisor may:

- create mission drafts
- request owner approval
- spawn or resume roles under policy
- summarize state
- request escalations
- close mission when closeout conditions are met

Supervisor may not:

- bypass policy engine
- silently expand high-risk scope
- grant capabilities it does not hold
- mark cleanup complete when resources remain unverified
- issue final business verdict when policy requires owner or reviewer gate

## 7. Messaging Semantics

### 7.1 Lifecycle States

Messages should distinguish:

```text
RECEIVED   packet received
ACCEPTED   authorization and scope accepted
STARTED    work started
PROGRESS   intermediate state
REPORT     business result
FAILED     work failed
CANCELLED  work cancelled
CLOSED     requester accepted closure
```

Existing direct final text ACK maps to `RECEIVED` or `ACCEPTED`; it must not carry long business reports.

### 7.2 Delivery Model

The target model is:

```text
at-least-once delivery + idempotent consumption + dedupe ledger
```

The runtime should not promise exactly-once delivery.

For side-effecting requests:

- sender provides `request_id` and `idempotency_key`
- receiver records first accepted result
- duplicate request returns existing lifecycle state or report reference
- duplicate request must not rerun destructive or mutating side effects

### 7.3 Backpressure And Dead Letters

The runtime should eventually represent:

- pending
- late_pending
- stale
- dead_letter
- cancelled
- superseded

This review draft does not require all states in the first implementation slice, but the message envelope should not block them.

## 8. Review Independence Model

Oracle independence is a system property, not only a prompt instruction.

Minimum independence guarantees:

- Oracle cannot hold a business-code write lease for the resource under review.
- Oracle report must reference raw evidence or evidence artifacts, not only HQ summaries, when available.
- Repair cannot issue final acceptance of its own change.
- Runner evidence and oracle verdict must be separable artifacts.
- HQ may merge evidence, but final gate must show which evidence came from runner, oracle, repair, and inference.

Optional stronger guarantees:

- Oracle receives a bounded review packet with direct artifact refs and diff refs.
- Oracle context excludes repair's private scratch notes unless explicitly attached as evidence.
- Review verdicts are recorded in a decision ledger.

## 9. Resource Ledger And Cleanup Contract

### 9.1 Resource Ledger

Mission-local resource ledger:

```text
.pi/topology/missions/<mission_id>/resource-ledger.jsonl
```

Each resource lifecycle transition appends a record:

```json
{
  "schema_version": 1,
  "event_id": "evt_...",
  "resource_id": "res_...",
  "mission_id": "mission_...",
  "transition": "registered|activated|cleanup_requested|cleanup_attempted|cleaned|cleanup_failed",
  "actor_id": "actor_...",
  "authorization_id": "auth_...",
  "evidence_refs": [],
  "created_at": "2026-06-26T12:00:00.000Z"
}
```

### 9.2 Minimal Resource Types For First Slice

The first implementation slice should cover only:

- `process`
- `terminal_window` or `external_session`, if safely observable
- `temp_directory`

Worktree, branch, port, container, test server, and external service cleanup can remain schema-compatible future types.

### 9.3 Cleanup Guard

Cleanup must verify:

- resource belongs to active mission or explicitly selected mission
- resource was created or adopted by runtime
- cleanup actor has `terminate_resource`
- cleanup policy permits automatic cleanup
- target identifier still matches registered evidence
- target is not the current CLI process
- target is not an ancestor of the current CLI process
- broad process-name matching is not used as sole proof

Cleanup result must be recorded:

```json
{
  "cleanup_attempt_id": "cleanup_...",
  "resource_id": "res_...",
  "method": "signal_process_group|remove_temp_directory|close_terminal_backend|manual",
  "result": "cleaned|skipped|failed|requires_owner_gate",
  "evidence_refs": [],
  "error": null
}
```

## 10. Storage And Compatibility

v0.6 should preserve v0.5 per-mission storage.

Suggested additional files:

```text
.pi/topology/missions/<mission_id>/
  authorization-ledger.jsonl
  capability-snapshot.json
  write-leases.jsonl
  decision-log.jsonl
  resource-ledger.jsonl
  cleanup-log.jsonl
  artifact-index.jsonl
  evidence-index.jsonl
```

Compatibility rules:

- Existing `runtime-events.jsonl`, `sessions.jsonl`, `packet-ledger.jsonl`, and `incident-log.jsonl` remain valid.
- New ledgers may initially be derived from existing events where possible.
- Root mirrors remain active-mission compatibility views.
- No v0.6 work may reintroduce canonical writes to root `.pi/topology/*` after mission registry exists.

## 11. Implementation Phasing

This is a spec, not a plan. Still, the intended implementation order matters for review.

### Phase 1: Kernel Invariants

Define schemas and minimal enforcement for:

```text
Mission state model
Capability / authorization
Append-only event envelope
Message idempotency fields
Write lease model
Evidence provenance
Resource ledger
```

### Phase 2: Reliability

Add:

```text
timeout semantics
retry policy
dedupe ledger
cancellation propagation
backpressure states
crash recovery
stale detection
dead-letter handling
```

### Phase 3: Experience And Backend Flexibility

Add or improve:

```text
Ghostty backend abstraction
same-instance launcher option
mission dashboard
artifact browser
resource cleanup UI
alternative launchers
```

## 12. First Implementable Slice Recommendation

The first slice should be:

```text
Mission Resource Ledger + Cleanup Guard
```

Reason:

- It addresses the current real pain: tests and dogfood leave runtime-owned processes behind.
- It forces mission ownership, resource ownership, cleanup policy, and cleanup evidence into concrete objects.
- It is narrower than implementing the entire authorization system.
- It prepares for future Ghostty backend changes without making launcher choice the architecture.

Minimum deliverables for that slice:

- Resource schema.
- Mission-local `resource-ledger.jsonl`.
- Registration on role/process/temp-root creation where currently observable.
- Cleanup command or internal cleanup path that only targets registered resources.
- Guard against killing the current CLI process or its ancestors.
- Cleanup evidence appended to mission logs.
- Unit tests with process inspector/killer abstractions; no real broad `pkill`.
- Focused integration or dogfood smoke only when safe.

## 13. Open Questions For Review

Please review especially:

1. Is capability-first the right abstraction, or should v0.6 keep role-first enforcement for one more release?
2. Should write leases apply only to workspace/business resources, or also to runtime state files?
3. Should supervisor be allowed to grant medium-risk capabilities automatically after owner mission approval?
4. Is `lifecycle_phase + attention_state` worth introducing now, or should it remain a v0.7 cleanup?
5. Is resource ledger too broad for v0.6, or is it the right generalization over process cleanup?
6. What is the minimum oracle-independence mechanism that is worth enforcing at runtime?
7. Should artifact/evidence immutability be enforced by digest only, path convention only, or both?
8. Should cleanup failure block mission closeout, or allow conditional closeout with explicit residual risk?

## 14. Non-Goals

v0.6 collaboration kernel should not:

- Add more named roles as the main solution.
- Depend on Ghostty-specific behavior as an architectural invariant.
- Treat prompt wording as sufficient permission enforcement.
- Use broad process name matching for cleanup.
- Collapse runner, repair, and oracle responsibilities for convenience.
- Require owner to approve every low-risk action.
- Promise exactly-once message delivery.
- Hide cleanup failures behind a green closeout.

## 15. Review Summary

This spec proposes that Pi拓扑网络 v0.6 should move from role discipline to runtime-checkable collaboration invariants.

The central move is:

```text
role prompts
  -> capability and authorization objects

free-form reports
  -> idempotent packets and artifact references

mutable state files
  -> append-only events plus derived views

process cleanup
  -> mission-owned resource ledger and cleanup evidence
```

The first practical implementation should stay narrow: resource ledger and cleanup guard. The broader object model is included so that first slice does not become a one-off process-killing patch.
