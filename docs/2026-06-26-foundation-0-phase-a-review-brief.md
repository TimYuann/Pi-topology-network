# Foundation-0 Phase A Review Brief

Date: 2026-06-26
Audience: 5.5pro external architecture review
Prepared by: HQ/Codex
Status: ready for external review

## Purpose

This brief summarizes the first executable slice of the Pi Topology v0.6 Foundation-0 work before the project moves into higher-risk macOS process probing and cleanup behavior.

The goal of this checkpoint is to confirm that the project is still aligned with the intended direction: a document-led, auditable Resource Ledger / Cleanup Guard foundation that can eventually prevent orphaned agent sessions, stale test resources, unsafe cleanup, and blocked coordination channels.

## Current Direction

Foundation-0 is being built as an isolated runtime module under:

```text
packages/pi-topology/src/runtime/foundation0/
```

At this stage, it is intentionally not integrated into the existing v0.5 topology command runtime. The current work creates contract-level primitives first, then later phases will connect them to real process/temp-directory operations.

This keeps the implementation reviewable:

- schemas before effects,
- durable event primitives before lifecycle projections,
- pure lifecycle state transitions before real cleanup,
- process identity before process termination,
- document/review gates before each higher-risk step.

## Completed Commits

### T1/T1.1: Foundation-0 Schema Contract

Commit:

```text
67e74e8 feat(pi-topology): add foundation0 schema contract
```

Implemented:

- Foundation-0 ID, digest, timestamp, and canonical JSON helpers.
- 21 first-slice schema object families.
- Per-object validators and dispatch validators.
- Action-specific `InitialOutcome`.
- Closed `AuthorizationGrant.scope`.
- Direct authorization validator discriminant/nullability enforcement.
- ManagedResource planned-vs-observed validation rules from the contract.

Verification:

```text
foundation0-schema.test.ts: PASS 53/53
full unit suite at the time: PASS 377/377
npm run typecheck: PASS
```

### T2: Mission Event Lock And Canonical Append

Commit:

```text
7c75a6b feat(pi-topology): add foundation0 event append lock
```

Implemented:

- Project-local `O_EXCL` lockfile helper, no new dependency.
- Mission-scoped event lock.
- Canonical payload digest computation.
- Payload durable-write-before-event append.
- Content-addressed payload storage.
- Idempotent append by deterministic event id.
- File-order sequence invariant validation.
- Partial trailing event row detection.
- Payload verification helper.

Storage layout:

```text
<missionDir>/foundation0/runtime-events.jsonl
<missionDir>/foundation0/payloads/<payload_digest>.json
<missionDir>/foundation0/locks/mission-events.lock
```

Verification:

```text
lockfile unit: PASS 4/4
event append unit: PASS 7/7
concurrent append integration: PASS 1/1
combined suite at the time: PASS 389/389
npm run typecheck: PASS
```

### T3: ManagedResource Lifecycle And Pre-Registration

Commit:

```text
ae18d96 feat(pi-topology): add foundation0 resource lifecycle
```

Implemented:

- Closed ManagedResource lifecycle transition helper.
- Runtime-created resource pre-registration sidecar model.
- Explicit `AbandonedResource` branch so `planned -> abandoned` can represent "external resource never created" without identity.
- In-memory cleanup-attempt coordination keyed by `resource_id + identity_digest`.
- Validation-preserving transitions with `updated_at` refresh.

Key clarification:

`abandoned` is not an observed-resource state. It is a ManagedResource terminal branch that can be identity-null when no external resource was ever created.

Verification:

```text
pre-registration unit: PASS 8/8
resource lifecycle unit: PASS 7/7
combined suite at the time: PASS 404/404
npm run typecheck: PASS
```

## Review Process Used

Work is now running through a three-thread Codex collaboration pattern:

```text
HQ/Codex -> Coder -> Reviewer -> HQ/Codex
```

Rules:

- HQ writes task docs and owns route decisions.
- Coder implements from docs.
- Reviewer reviews and either returns changes to Coder or sends approved result to HQ.
- HQ verifies, commits, and plans the next task.
- Large inline payloads are avoided; reports are written as docs/records.
- Pi/topology/Ghostty spawn is not used for code execution in this phase.

This workflow itself is a practice model for the eventual topology design: separate coordination channels, bounded roles, documented handoffs, and explicit review gates.

## Current Architectural Choices

### 1. Foundation-0 remains isolated

The new module is not yet wired into the existing topology runtime. This is deliberate. It avoids changing live behavior before the core ledger/guard contracts are stable.

### 2. No dependency added for locking

T2 uses a local `O_EXCL` lockfile helper instead of `proper-lockfile`. The choice keeps the first slice auditable and deterministic. Distributed or multi-host locking is explicitly out of scope.

### 3. Planned cleanup policy uses a sidecar

The T1 schema says planned resources have `cleanup_policy: null`. T3 therefore models pre-registration as:

```text
{ resource: PlannedResource, cleanup_policy: ProcessCleanupPolicy | TempDirectoryCleanupPolicy }
```

This keeps planned-resource nullability intact while still preserving the cleanup intent required before an external resource is created.

### 4. Abandoned-before-creation is identity-null

The contract allowed `planned -> abandoned`, and doc 20's observed-resource identity requirement did not include `abandoned`. T3 therefore adds an explicit `AbandonedResource` branch.

### 5. Cleanup attempt coordination is still in-memory

T3 only models the pure conflict rule:

```text
same resource_id + identity_digest + different idempotency key => cleanup_in_progress
```

Durable cross-process coordination is reserved for later integration with the T2 event/lock layer.

## Known Residual Risks

### Lock durability is local-only

The `O_EXCL` lock is appropriate for local filesystem coordination but does not claim distributed semantics.

### Parent-directory fsync is deferred

T2 fsyncs payload and event files, but richer crash recovery and parent-directory fsync are deferred to a later recovery task.

### Planned cleanup policy sidecar needs later integration

The sidecar is a clean pure-model compromise, but later event/projection work must decide how to durably store and replay this sidecar.

### Abandoned verification vocabulary is coarse

Abandoned-before-creation currently uses the existing `verification_state: "unverified"` because the enum lacks a more precise `never_created` value.

### No real process/temp identity yet

T1-T3 use fake but schema-valid identities. T4/T6 must introduce real macOS process identity and temp-directory identity probes carefully.

## Recommended Next Gate: T4

The next planned task is ProcessIdentity + Process Inspector Abstraction.

Before authorizing implementation, HQ should write a T4 task document that explicitly decides:

- macOS process start-time probe strategy,
- argv canonicalization limitations,
- cwd/executable realpath handling,
- injected fake inspector for tests,
- no real kill/signal behavior in T4 unless separately authorized,
- CLI/self/ancestor protection constraints.

T4 is higher-risk than T1-T3 because it touches live host process facts. It should remain read-only and test-injected first.

## Questions For 5.5pro

1. Is the current staged approach still aligned: schema -> event append -> lifecycle -> process identity -> cleanup execution?
2. Is the `AbandonedResource` branch the right interpretation of `planned -> abandoned` with no external creation?
3. Is the pre-registration sidecar acceptable, or should the schema be revised so planned resources can carry cleanup policy directly?
4. Is local `O_EXCL` locking sufficient for the first slice, given the stated non-distributed scope?
5. Should T4 remain strictly read-only process inspection, with actual signal/cleanup deferred to a separate task?
6. Are there any path-drift risks before moving from pure Foundation-0 primitives into host process identity?

## Current Recommendation

Proceed to T4 only after external review confirms no architectural drift in T1-T3.

T1-T3 establish a coherent foundation, but T4 is the first point where local machine state enters the contract. It deserves a fresh review gate before implementation.
