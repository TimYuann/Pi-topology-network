# Foundation-0 T1.1 Contract Tightening Report

Date: 2026-06-26
Role: Coder
Decision: ready_for_codex_review

## Summary

- Hardened direct authorization validators for exact `authorization_kind` and root/delegated nullability rules.
- Closed `AuthorizationGrant.scope` and added validation for `mission_relation`, `ownership_relation`, `cleanup_methods`, `resource_types`, and `approved_temp_root_ids`.
- Made `InitialOutcome` action-specific with an `action_payload_kind` discriminator and per-action result-code sets.
- Added focused regression coverage for the three T1.1 contract fixes.

## Verification

```text
node --experimental-strip-types --test test/unit/foundation0-schema.test.ts
PASS: 53/53

node --experimental-strip-types --test test/unit/*.test.ts
PASS: 377/377

npm run typecheck
PASS: strip-types import ok
```

## Scope

Files changed for implementation:

- `packages/pi-topology/src/runtime/foundation0/schema.ts`
- `packages/pi-topology/src/runtime/foundation0/validation.ts`
- `packages/pi-topology/test/unit/foundation0-schema.test.ts`

Report file:

- `records/2026-06-26-foundation-0-t1-1-contract-tightening.md`

No runtime files outside `packages/pi-topology/src/runtime/foundation0/` were modified for T1.1. No T2 work, Ghostty launch, dogfood flow, kill/pkill, commit, push, or publish was performed.

## Inline Report

```text
REPORT foundation0-t1.1
decision: ready_for_codex_review
files_changed: packages/pi-topology/src/runtime/foundation0/schema.ts; packages/pi-topology/src/runtime/foundation0/validation.ts; packages/pi-topology/test/unit/foundation0-schema.test.ts; records/2026-06-26-foundation-0-t1-1-contract-tightening.md
tests: node --experimental-strip-types --test test/unit/foundation0-schema.test.ts => PASS 53/53; node --experimental-strip-types --test test/unit/*.test.ts => PASS 377/377
typecheck: npm run typecheck => PASS (strip-types import ok)
runtime_modified_outside_foundation0: no
t2_started: no
notes: Foundation-0 files are currently untracked from prior T1 state in this worktree; implementation changes stayed within the T1.1 allowlist plus this record.
```
