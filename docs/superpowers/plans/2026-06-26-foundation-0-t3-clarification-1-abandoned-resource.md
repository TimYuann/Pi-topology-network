# T3 Clarification 1: Abandoned Planned Resource

Date: 2026-06-26
Owner: HQ/Codex
Applies to: `docs/superpowers/plans/2026-06-26-foundation-0-t3-resource-lifecycle.md`

## Decision

Use option 1: introduce an explicit abandoned ManagedResource branch inside Foundation-0 schema/validation.

`planned -> abandoned` must remain valid for the case where external creation never happened. Do not require identity before abandoning a planned resource.

## Rationale

Doc 19 allows:

```text
planned -> registered | abandoned
```

Doc 20 says observed-resource identity is required only when lifecycle state is one of:

```text
registered
active
stale
cleanup_pending
cleanup_attempted
cleaned
cleanup_failed
```

`abandoned` is intentionally not in that observed list. It represents a terminal non-created or owner-abandoned resource state, not an observed external identity state.

## Implementation Guidance

Coder may extend the T3 scope to edit these Foundation-0 schema files:

- `packages/pi-topology/src/runtime/foundation0/schema.ts`
- `packages/pi-topology/src/runtime/foundation0/validation.ts`
- related Foundation-0 tests

Expected model:

- Keep `PlannedResource` as `lifecycle_state: "planned"`.
- Add an explicit `AbandonedResource` or equivalent ManagedResource union branch with `lifecycle_state: "abandoned"`.
- For abandoned-before-creation:
  - `identity: null`
  - `identity_digest: null`
  - `verification_state` should be able to express the no-external-resource case. If the existing enum cannot express it exactly, use the closest existing value and document the caveat in the T3 report.
- `validateManagedResource` must route `abandoned` to the abandoned branch, not to observed-resource validation.
- Observed-resource states must still require identity and identity_digest.
- Do not model planned-abandon as a separate non-ManagedResource decision object.
- Do not require identity before `planned -> abandoned`.

## Required Additional Tests

Add or adjust T3 tests to prove:

- `planned -> abandoned` succeeds without identity.
- An abandoned-before-creation ManagedResource validates.
- `abandoned` is not routed through observed-resource validation.
- Observed states still reject missing identity.
- Invalid transitions out of `abandoned` are rejected unless a later contract explicitly reopens them.

## Scope Note

This is still Foundation-0-only schema/lifecycle work. It does not authorize process probing, real cleanup, external resource creation, v0.5 runtime integration, Ghostty, Pi/topology spawn, commit, or push.
