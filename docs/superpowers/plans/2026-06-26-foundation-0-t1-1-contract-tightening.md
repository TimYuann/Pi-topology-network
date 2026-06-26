# Foundation-0 T1.1 Contract Tightening

Date: 2026-06-26
Owner: Pi
Reviewer: Codex
Status: ready for delegation

## Context

T1 created the first Foundation-0 schema/validator slice under `packages/pi-topology/src/runtime/foundation0/` and added focused unit coverage. Codex review confirms the implementation is close and verification is green, but T2 must not start until several contract-boundary issues are tightened.

This is a repair task for T1 only. Do not implement lockfiles, event append, lifecycle transitions, process inspection, cleanup execution, Ghostty launch changes, dogfood flows, or any runtime integration outside the Foundation-0 schema module.

## Scope

Edit only:

- `packages/pi-topology/src/runtime/foundation0/schema.ts`
- `packages/pi-topology/src/runtime/foundation0/validation.ts`
- `packages/pi-topology/test/unit/foundation0-schema.test.ts`

Do not modify existing runtime files outside `src/runtime/foundation0/`.

## Required Fixes

1. Harden authorization discriminants and nullability.

   - `validateRootAuthorization` must reject inputs whose `authorization_kind` is not exactly `"root"`.
   - Root authorization must reject non-null `granted_by_actor_id`.
   - Root authorization must reject non-null `granted_under_authorization_id`.
   - `validateDelegatedAuthorization` must reject inputs whose `authorization_kind` is not exactly `"delegated"`.
   - Delegated authorization must reject any non-null `root_basis`.
   - Add direct-validator tests, not only dispatcher tests.

2. Make `InitialOutcome` action-specific.

   The current `InitialOutcome` shape has one shared `result_code` enum. That is too soft for the first-slice contract because it allows outcome codes from one action family to be attached to another action family.

   Implement an action-specific discriminated union or equivalent closed schema so outcome result codes are constrained by action family. At minimum, tests must prove that cleanup/termination-only result codes cannot be accepted for `close_mission`, `register_resource`, or other non-cleanup action families.

3. Close and validate `AuthorizationGrant.scope`.

   `AuthorizationGrant.scope` must be machine-checkable in the first slice.

   - Remove the open `[extra: string]: unknown` escape hatch, or replace it with closed capability-specific scope interfaces.
   - Validator must reject unknown scope keys.
   - Validator must validate known scalar/array scope fields, including `mission_relation`, `ownership_relation`, and `cleanup_methods`, not only `resource_types` and `approved_temp_root_ids`.
   - Prefer capability-specific scope validation where practical.

## Acceptance

- Focused Foundation-0 schema tests pass.
- Full unit suite passes.
- Typecheck passes.
- New tests cover all three fixes above.
- No runtime files outside `packages/pi-topology/src/runtime/foundation0/` are modified.
- No T2 work is started.
- No Ghostty launch, dogfood, kill/pkill, commit, push, or publish.

## Verification Commands

Run from `packages/pi-topology/`:

```bash
node --experimental-strip-types --test test/unit/foundation0-schema.test.ts
node --experimental-strip-types --test test/unit/*.test.ts
npm run typecheck
```

## Inline Report

Return a short inline report:

```text
REPORT foundation0-t1.1
decision: ready_for_codex_review
files_changed: ...
tests: ...
typecheck: ...
runtime_modified_outside_foundation0: yes/no
t2_started: no
notes: ...
```
