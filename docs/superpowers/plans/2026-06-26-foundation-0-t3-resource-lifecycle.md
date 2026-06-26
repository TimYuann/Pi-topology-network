# Foundation-0 T3 ManagedResource Lifecycle And Pre-Registration

Date: 2026-06-26
Owner: HQ/Codex
Executor: Coder
Reviewer: Reviewer
Status: ready for delegation

## Context

T1/T1.1 established Foundation-0 schemas and validators. T2 added a mission-scoped lock and canonical event append primitive. T3 adds a narrow resource lifecycle primitive for ManagedResource state transitions and runtime-created resource pre-registration.

This task must remain isolated inside Foundation-0. It should create and test deterministic state-machine helpers. It must not inspect or create real processes, temp directories, Ghostty sessions, or external resources.

## Contract References

- `docs/19-pi-topology-v0.6-foundation-0-first-slice-contract.md` §8.1 ManagedResource
- `docs/19-pi-topology-v0.6-foundation-0-first-slice-contract.md` §8.2 Pre-Registration
- `docs/20-pi-topology-v0.6-foundation-0-first-slice-contract-closure.md` §9 ManagedResource Union And Nullability

Doc 20 supersedes conflicting semantics in doc 19.

## Scope

Allowed implementation files:

- `packages/pi-topology/src/runtime/foundation0/resource-lifecycle.ts`

Allowed test/report files:

- `packages/pi-topology/test/unit/foundation0/pre-registration.test.ts`
- `packages/pi-topology/test/unit/foundation0/resource-lifecycle.test.ts`
- `records/2026-06-26-foundation-0-t3-resource-lifecycle.md`

You may make minimal import/export adjustments inside `packages/pi-topology/src/runtime/foundation0/` if needed. Do not modify existing runtime files outside that folder.

## Non-Goals

- No integration into existing v0.5 topology command/runtime paths.
- No process inspector, process cleanup, signal sending, temp-directory cleanup, or real resource creation.
- No new package dependencies.
- No Ghostty, Pi/topology mission, dogfood, spawn, kill/pkill, commit, push, or publish.
- No T4/T5/T6 work.

## Required Behavior

### 1. Lifecycle State Machine

Implement a closed ManagedResource lifecycle transition helper.

Required allowed transitions:

```text
planned -> registered | abandoned
registered -> active | abandoned
active -> stale | cleanup_pending
stale -> cleanup_pending | cleaned
cleanup_pending -> cleanup_attempted
cleanup_attempted -> cleaned | cleanup_failed
cleanup_failed -> cleanup_pending
```

Required rules:

- Reject all transitions not listed above with a recognizable error.
- Preserve `ownership_origin` as data, never as a lifecycle state.
- Preserve `verification_state` orthogonally unless the transition explicitly updates it.
- Update `updated_at` on successful transition.
- Validate returned resources with existing Foundation-0 validators.
- Keep planned-resource nullability intact: planned resources have no observed identity.
- Keep observed-resource nullability intact: registered/active/stale/cleanup_pending/cleanup_attempted/cleaned/cleanup_failed resources require identity and identity digest.

### 2. Pre-Registration Flow Primitive

Implement helper functions for runtime-created resources using a deterministic 5-step flow:

```text
1. Allocate resource_id.
2. Durably register planned resource and cleanup policy.
3. External resource would be created by a later caller.
4. Record observed identity.
5. Transition to registered or active.
```

For T3, do not create the external resource. Model the boundary with explicit functions such as:

- create planned resource record from action/policy inputs,
- attach observed identity after the external boundary,
- activate/register the resource through valid lifecycle transition.

The helper must make crash recovery possible:

- A planned resource can remain planned without identity and still be valid.
- A planned resource can be abandoned if creation never happened.
- Attaching identity must happen before moving to registered/active.
- A resource cannot jump from planned directly to active unless the helper records/validates the observed identity and passes through or explicitly accounts for registered semantics.

### 3. Cleanup Attempt Coordination Primitive

Implement only the pure predicate/state helper needed by the first slice:

- At most one cleanup attempt may be active for the same `resource_id + identity_digest`.
- If another cleanup attempt is active for the same pair with a different idempotency key, return or throw a recognizable `cleanup_in_progress` result.
- This is in-memory/pure T3 logic only. Do not add cross-process locking here; T2 lock/event append is the future durability layer.

## Required Tests

Add focused tests covering:

- All allowed transitions succeed and validate the result.
- Representative invalid transitions fail (`planned -> active` without identity, `registered -> cleanup_attempted`, `cleaned -> cleanup_pending`, etc.).
- `ownership_origin` is preserved and not treated as a lifecycle state.
- `verification_state` remains orthogonal across non-cleanup transitions.
- Planned resource without identity is accepted.
- Observed resource without identity is rejected.
- Pre-registration creates a planned resource with cleanup policy and no identity.
- Crash after planned registration is representable as a valid planned resource.
- Attaching observed identity produces a valid registered or active resource.
- Planned resource can be abandoned when no external resource was created.
- Cleanup attempt acquisition returns/throws `cleanup_in_progress` for concurrent different idempotency key on same `resource_id + identity_digest`.
- Same idempotency key is treated idempotently, not as a second active cleanup.

Use fake process/temp-directory identities only. Do not probe the host system.

## Verification Commands

Run from `packages/pi-topology/`:

```bash
node --experimental-strip-types --test test/unit/foundation0/pre-registration.test.ts
node --experimental-strip-types --test test/unit/foundation0/resource-lifecycle.test.ts
node --experimental-strip-types --test test/unit/*.test.ts test/unit/foundation0/*.test.ts test/integration/foundation0/*.test.ts
npm run typecheck
```

If one of the two focused test files is intentionally collapsed into the other, record the exact command used and why.

## Report

Create:

```text
records/2026-06-26-foundation-0-t3-resource-lifecycle.md
```

The report must include:

- Files changed.
- State-machine summary.
- Pre-registration flow summary.
- Cleanup attempt coordination summary.
- Verification results.
- Explicit statement that no existing v0.5 runtime integration was modified.
- Caveats for T4/T5/T6/T7.

## Handoff To Reviewer

When done, send Reviewer thread `019f0289-736e-7372-a240-d2ac2303d626` a short message with:

- this task doc path,
- report path,
- changed files,
- verification summary,
- request for review.

Do not send a long inline implementation dump. The report is the source of truth.
