# Foundation-0 T3 Resource Lifecycle Report

Date: 2026-06-26
Role: Coder
Decision: ready_for_codex_review
Base: `7c75a6b`

## Plan Inputs

- `docs/superpowers/plans/2026-06-26-foundation-0-t3-resource-lifecycle.md`
- `docs/superpowers/plans/2026-06-26-foundation-0-t3-clarification-1-abandoned-resource.md`

HQ clarification 1 is applied: Foundation-0 now has an explicit `AbandonedResource` ManagedResource branch, so `planned -> abandoned` is valid without identity when external creation never happened.

## Files Changed

- `packages/pi-topology/src/runtime/foundation0/schema.ts`
- `packages/pi-topology/src/runtime/foundation0/validation.ts`
- `packages/pi-topology/src/runtime/foundation0/resource-lifecycle.ts`
- `packages/pi-topology/test/unit/foundation0/pre-registration.test.ts`
- `packages/pi-topology/test/unit/foundation0/resource-lifecycle.test.ts`
- `records/2026-06-26-foundation-0-t3-resource-lifecycle.md`

Clarification document included in handoff context:

- `docs/superpowers/plans/2026-06-26-foundation-0-t3-clarification-1-abandoned-resource.md`

No package dependencies were added.

## State Machine Summary

`resource-lifecycle.ts` implements a closed ManagedResource transition helper with these allowed transitions:

```text
planned -> registered | abandoned
registered -> active | abandoned
active -> stale | cleanup_pending
stale -> cleanup_pending | cleaned
cleanup_pending -> cleanup_attempted
cleanup_attempted -> cleaned | cleanup_failed
cleanup_failed -> cleanup_pending
```

Invalid transitions throw `ResourceLifecycleTransitionError`. Successful transitions update `updated_at`, preserve `ownership_origin`, preserve `verification_state` unless an explicit replacement is provided, and validate the returned resource with existing Foundation-0 validators.

Schema/validation now includes `AbandonedResource`:

- `lifecycle_state: "abandoned"`
- `identity: null`
- `identity_digest: null`
- `cleanup_policy: null`
- `verification_state` uses the existing `verified|unverified` enum; abandoned-before-creation uses `unverified`.

Observed states still require identity, identity digest, and cleanup policy.
The exported `ObservedResourceLifecycleState` TypeScript alias excludes both
`planned` and `abandoned`, matching runtime validation.

## Pre-Registration Flow Summary

T3 keeps `PlannedResource` schema nullability intact: planned resources still have `identity: null`, `identity_digest: null`, and `cleanup_policy: null`.

Because T1/T1.1 schema requires planned cleanup policy to be null, pre-registration stores the cleanup policy as a sidecar in `PlannedResourceRegistration`:

```text
{ resource: PlannedResource, cleanup_policy: ProcessCleanupPolicy | TempDirectoryCleanupPolicy }
```

The pure helpers model the 5-step boundary without creating external resources:

- `createPlannedResourceRegistration` allocates a valid planned resource record and validates the sidecar cleanup policy against the requested resource type.
- A crash after planned registration is representable as the valid planned resource.
- `attachObservedIdentity` takes the sidecar cleanup policy plus fake observed identity and returns a valid `registered` or explicitly-accounted `active` observed resource.
- `abandonPlannedResource` handles the no-external-resource-created case via `planned -> abandoned`.

Review revision:

- Process pre-registration now rejects temp-directory cleanup policy sidecars.
- Temp-directory pre-registration now rejects process cleanup policy sidecars.
- Valid process and temp-directory pre-registrations remain accepted.

## Cleanup Attempt Coordination Summary

`CleanupAttemptCoordinator` is an in-memory pure helper keyed by:

```text
resource_id + identity_digest
```

For the same key:

- the same idempotency key returns the existing active attempt record,
- a different idempotency key throws `CleanupInProgressError` with result `cleanup_in_progress`.

Different resource ids or identity digests can acquire independent attempts. No cross-process locking was added in T3.

## Verification

```text
node --experimental-strip-types --test test/unit/foundation0/pre-registration.test.ts
PASS: 8/8

node --experimental-strip-types --test test/unit/foundation0/resource-lifecycle.test.ts
PASS: 7/7

node --experimental-strip-types --test test/unit/*.test.ts test/unit/foundation0/*.test.ts test/integration/foundation0/*.test.ts
PASS: 404/404

npm run typecheck
PASS: strip-types import ok
```

## Scope Statement

No existing v0.5 runtime integration was modified. No process probing, real resource creation, real cleanup, signal sending, temp-directory deletion, Pi/topology mission, Ghostty, spawn, dogfood, kill/pkill, commit, push, publish, or dependency install was performed.

## Caveats For T4/T5/T6/T7

- Cleanup policy for planned pre-registration is intentionally modeled as a sidecar because current planned-resource schema requires `cleanup_policy: null`.
- Abandoned-before-creation uses `verification_state: "unverified"` because the existing enum has no more precise "not_created" value.
- Cleanup attempt coordination is in-memory only; durable cross-process coordination belongs with later T2-backed event/lock integration.
- Identity digests in T3 tests are fake schema-valid values; real process/temp identity observation is deferred to later tasks.
