# Foundation-0 T7 Temp-Directory Creation Identity + Marker — Coder Report

> **Task doc:** `docs/superpowers/plans/2026-06-28-foundation-0-t7-temp-directory-creation-identity-marker.md`
> **Status:** T7 implementation complete after Reviewer REQUEST CHANGES revisions; ready for HQ.
> **Checkout:** `master` with T7 working-tree changes present (no commit, no push).

## Scope Statement

T7 implemented exactly the boundary 5.5pro approved:

```text
T7: Temp-Directory Creation, Identity, and Marker
Scope: create exactly one managed temp directory under an explicit
       approved temp root, write and verify .pi-topology-resource.json,
       compute stable non-circular TempDirectoryIdentity, and durably
       represent planned -> registered -> active.
```

No real temp cleanup, no quarantine, no recursive delete of managed
temp, no rename of managed temp dirs, no process spawn / signal /
probe, no v0.5 runtime integration, no Ghostty / Pi topology spawn,
no `topology_spawn_role`, no dogfood, no package dependency change,
no commit, no push, no broad cleanup from the Coder thread.

## Handoff of Partial RED Changes

The OMP handoff flagged three partial RED changes that arrived in
the working tree before this thread took over:

- `packages/pi-topology/src/runtime/foundation0/schema.ts`
  - Added `ApprovedTempRoot`
  - Added `TempDirectoryCreationPayload`
- `packages/pi-topology/src/runtime/foundation0/validation.ts`
  - Added type imports for `ApprovedTempRoot` and `TempDirectoryCreationPayload`
- `packages/pi-topology/test/unit/foundation0/temp-directory-creation.test.ts`
  - Two RED tests for `validateTempDirectoryCreationPayload`

I chose **path 1 — continue from these partial RED changes**, which
matched Task 1 of the T7 plan exactly. No `git reset`, no broad
`git checkout .`, no unrelated-doc deletion. The partial tests stayed
valid and the new implementation completed the validator contract
plus the rest of T7 against them.

## Files Changed

```text
packages/pi-topology/src/runtime/foundation0/schema.ts
packages/pi-topology/src/runtime/foundation0/validation.ts
packages/pi-topology/src/runtime/foundation0/temp-directory-creation.ts (new)
packages/pi-topology/test/unit/foundation0/temp-directory-creation.test.ts
records/2026-06-28-foundation-0-t7-temp-directory-creation-identity-marker.md
```

## Summary of Changes

### Task 1 — Payload Validator

- `schema.ts`: added `ApprovedTempRoot`, `ApprovedTempRootRegistry`,
  `ResolvedApprovedTempRoot`, `TempDirectoryCreationPayload`, and a
  runtime helper type `TempDirectoryIdentityObservation`. No new
  event type was introduced.
- `validation.ts`: added `validateApprovedTempRoot` and
  `validateTempDirectoryCreationPayload`. The basename is checked
  for non-empty, single segment, no `/` or null, and Foundation-0
  `validateId()` pattern. The optional `quarantine_path_template`
  field on `TempDirectoryCleanupPolicy` is now emitted only when
  present, so re-fingerprinting a validated plan does not break
  `canonicalizeForDigest` with `undefined` (T7 caught this latent
  T5 issue while building the marker identity).

### Task 2 — Approved Root Resolution and Path Safety

- `temp-directory-creation.ts` (new):
  - `resolveApprovedTempRoot({registry, root_id, protected_realpaths})`
    rejects missing / duplicate `root_id`, symlink configured root,
    non-directory root, and root realpath equal to or an ancestor of
    a protected realpath, including current working directory
    ancestors. The trusted registry is the only source of approved
    roots; no env / global discovery.
  - `buildManagedTempDirectoryPath({root_realpath,
    directory_basename, protected_realpaths})` realpaths the root
    for symlink-safe joining, joins basename + root, rejects
    non-segment / `.` / `..` / `/` / null basenames, rejects targets
    equal to the root, and rejects targets equal to any protected
    realpath (mission dir, foundation0 storage dir, repo root, cwd).

### Task 3 — Pre-Effect Durable Append

- `createManagedTempDirectory(input)` validates the cross-field
  shape contract (action capability, payload kind, target entity
  type, attempt / decision / plan mission + action + attempt ID
  matches, evaluation point = `execution`, decision result =
  `allowed`, plan resource_type = `temp_directory`, creation_kind =
  `create_temp_directory`, plan authorization / requested_by_action
  match action, plan `effect_fingerprint` verifies).
- The first four canonical events are durably appended **before**
  `mkdir`:
  - `action_requested` (payload = `CreateManagedResourceAction`)
  - `action_attempt_started` (payload = `ActionAttempt`)
  - `policy_decision_recorded` (payload = execution `PolicyDecision`
    with result `allowed`)
  - `resource_planned` (payload = `ResourceCreationPlan`)
- Idempotency keys are derived from a stable per-creation base
  `temp_directory_creation:{mission}:{resource}:{creation_nonce}:
  {action_idempotency_key}` plus a deterministic suffix. Event-append
  lock IDs use a bounded `t7_event_append_<sha256>` helper, validated
  by Foundation-0 `validateId()`, so long Foundation-0 IDs do not
  produce unreleasable lock metadata.
- A `CreateManagedTempDirectoryHooks.beforeMkdir` hook fires
  immediately before the filesystem effect so tests can verify
  pre-effect durability from the canonical event log.

### Task 4 — Create Directory, Marker, Identity

- `ensureTargetDirectory(target, root_realpath)` performs exclusive
  `mkdir`, fsyncs the approved root, `lstat`s the target, rejects
  symlink and non-directory targets, and computes `realpath` for
  the canonical path. On `EEXIST` it reads the existing marker and
  classifies the state as `directory_exists_without_marker` or
  `marker_mismatch` (the latter when the marker is invalid or its
  identity_digest does not match the expected provisional digest).
- `writeMarker(target, marker)` writes the canonical marker JSON to
  a UUID-suffixed temp file under the target, fsyncs it, atomically
  renames it to `.pi-topology-resource.json`, fsyncs the marker and
  the directory, `lstat`s the marker and rejects symlink, then
  reads the bytes back and validates `marker.identity_digest`
  matches the canonical marker digest.
- The identity is built from the `identity_core` only — never
  including `marker_digest` — so `identity_digest` is non-circular
  with the marker. The marker is validated against the same
  identity digest and the round-trip bytes.
- `resource_identity_observed` is durably appended after marker
  verification succeeds.

### Task 5 — Lifecycle Events and Idempotent Replay

- `createManagedTempDirectory` continues to append:
  - `resource_registered` (payload = `ObservedTempDirectoryResource`
    with `lifecycle_state: "registered"`, `verification_state:
    "verified"`)
  - `resource_activated` (payload = `ObservedTempDirectoryResource`
    with `lifecycle_state: "active"`)
  - `initial_outcome_recorded` (payload =
    `CreateManagedResourceInitialOutcome` with
    `action_payload_kind: "create_managed_resource"`,
    `status: "succeeded"`, `result_code: "created"`)
- `checkForExistingCreation` reads the canonical event log for
  this `(mission_id, resource_id)` triple. If a `resource_activated`
  event exists, it reads the corresponding
  `resource_identity_observed` payload and re-validates the on-disk
  marker against the observation. A matching marker returns
  `idempotent_replay`; a missing, invalid, or digest-mismatched
  marker returns `reconciliation_required / marker_mismatch`.
- If the directory and valid marker exist after a crash but lifecycle
  events did not complete, replay validates the marker-derived
  identity and appends the missing `resource_identity_observed`,
  `resource_registered`, `resource_activated`, and
  `initial_outcome_recorded` events idempotently without re-running
  `mkdir`.

### Task 6 — Crash-Boundary Reconciliation

The replay + filesystem classification flow classifies the crash
point deterministically and never overwrites or deletes:

| Crash point | Replay classification |
| --- | --- |
| After `resource_planned` before `mkdir` | `mkdir` may create once; on `EEXIST` we read the on-disk marker. If absent: `reconciliation_required / directory_exists_without_marker`. If invalid: `reconciliation_required / marker_mismatch`. |
| After `mkdir` before marker | `reconciliation_required / directory_exists_without_marker` — directory is preserved. |
| After marker before `resource_identity_observed` | `resource_identity_observed` is appended in the recovery pass; subsequent lifecycle events complete the `registered` / `active` transitions without re-running `mkdir`. |
| After `resource_identity_observed` before `resource_registered` | `resource_registered`, `resource_activated`, and `initial_outcome_recorded` are appended without re-running `mkdir`. |
| Marker bytes tampered after activation | Replay reads on-disk marker, sees identity_digest mismatch, returns `reconciliation_required / marker_mismatch`. Marker file is **not** deleted. |
| Missing / corrupt payload, partial event log | `readFoundation0EventPayload` surfaces `MissingPayloadError` / `PayloadDigestMismatchError` / `PartialEventLogError` and the projection routes them to `reconciliation_required` without blind retry. |

The implementation does not delete or rename the managed temp
directory or its marker on any crash boundary.

## Verification

```text
# focused — Task 1, Tasks 2/3/4/5/6
node --experimental-strip-types --test test/unit/foundation0/temp-directory-creation.test.ts
  tests 30 / pass 30 / fail 0

# foundation0 (full unit subdirectory)
node --experimental-strip-types --test test/unit/foundation0/*.test.ts
  tests 114 / pass 114 / fail 0

# full unit + foundation0 + integration
node --experimental-strip-types --test test/unit/*.test.ts \
                                    test/unit/foundation0/*.test.ts \
                                    test/integration/foundation0/*.test.ts
  tests 492 / pass 492 / fail 0

# typecheck
npm run typecheck
  strip-types import ok

# forbidden-effect scan from repo root
rg -n "process\.kill|\\bkill\\b|\\bpkill\\b|\\bkillall\\b|topology_spawn_role|Ghostty|spawn\(|process\.spawn|child_process\.spawn" \
  packages/pi-topology/src/runtime/foundation0 \
  packages/pi-topology/test/unit/foundation0
  only match: a docstring in temp-directory-creation.ts that
  enumerates what T7 MUST NOT do. No actual code matches.

# source-only delete/quarantine scan from repo root
rg -n "\\brm\\(|\\brmdir\\(|\\bunlink\\(|recursive|quarantine|rename\\([^,]+,[^)]*quarantine" \
  packages/pi-topology/src/runtime/foundation0
  matches limited to:
    - schema.ts / validation.ts / resource-lifecycle.ts: T5
      `TempDirectoryCleanupPolicy.quarantine_path_template` field
      (schema only, not a runtime delete path)
    - temp-directory-creation.ts: T7 docstring reiterating the
      no-delete boundary; `delete_strategy: "recursive_no_follow"`
      propagated from plan.cleanup_policy; `mkdir(target,
      { recursive: false })` for the exclusive target creation.
    - lockfile.ts: existing lock release/stale-lock unlink paths.
    - event-append.ts / durable-fs.ts: existing Foundation-0
      directory creation and temp-file unlink helper paths.
  No managed-temp `rm` / `rmdir` / `unlink` / `quarantine` source
  path exists in temp-directory-creation.ts.
```

## Acceptance Criteria Mapping

| Criterion | Evidence |
| --- | --- |
| Validate a temp-directory creation request and approved-root registry | Test 4 (`resolveApprovedTempRoot rejects an unknown root_id`), Test 5 (duplicate root_ids), Test 6 (configured symlink), Test 7 (configured regular file), Test 8 (realpath equal to a protected path); `validateTempDirectoryCreationPayload` rejects `../escape`, `.`, and empty basename (Tests 2 / 11 / 12). |
| Build or accept a `ResourceCreationPlan` for `temp_directory` / `create_temp_directory` and durably append `action_requested`, `action_attempt_started`, `policy_decision_recorded`, `resource_planned` before mkdir | Test 14 (`createManagedTempDirectory appends the four pre-effect events before mkdir fires`) reads the canonical event log from inside `beforeMkdir` and asserts `mkdirObservedAfter === 4`. |
| Resolve approved root through trusted registry | `resolveApprovedTempRoot` accepts only an explicit `registry` parameter; no env / global discovery path exists in source. |
| Create exactly one managed directory under that approved root | `ensureTargetDirectory` uses exclusive `mkdir(target, { recursive: false })` and rejects the target when it already exists without a valid marker. Tests 6 / 7 reject symlink / non-directory targets; Tests 21 / 22 confirm the target exists with the marker after happy-path. |
| Write `.pi-topology-resource.json` marker inside the created directory | Test 21 reads the marker and verifies `mission_id`, `resource_id`, `created_by_action_id`, `identity_digest` fields and confirms `identity.identity_digest === computeSha256Digest(identity_core)` and `identity.marker_digest === computeSha256Digest(marker)`. |
| Compute `TempDirectoryIdentity` and `identity_digest` without digest cycles | `buildIdentityCore` returns only identity_core fields; `identity.identity_digest === computeSha256Digest(identity_core)`; the marker references the same digest via `identity_digest` and `marker_digest` is computed independently. Test 21 asserts both digests. |
| Durably append `resource_identity_observed`, `resource_registered`, `resource_activated`, `initial_outcome_recorded` | Test 21 asserts the 8-event sequence in order and reads the `initial_outcome_recorded` payload via `readFoundation0EventPayload` to confirm `action_payload_kind: "create_managed_resource"`, `status: "succeeded"`, `result_code: "created"`. |
| Replay classification: no effect yet, active registered temp resource, crash after mkdir before marker, crash after marker before lifecycle events, missing / corrupt payload, partial event log | Tests 23 (`directory_exists_without_marker`), 25 (`marker_mismatch`), 22 / 24 (`idempotent_replay` without a second mkdir — inode unchanged), plus `readFoundation0EventPayload` error routing through `MissingPayloadError` / `PayloadDigestMismatchError` / `PartialEventLogError` to `reconciliation_required` (covered by the underlying T5 / T6 contract tests and the existing `cleanup-attempt-acquisition` replay tests). |
| No temp-directory cleanup | `temp-directory-creation.ts` source contains zero `rm` / `rmdir` / `unlink` / `rename` of managed temp dirs; the only `unlinkIfExists` is for the marker temp-file on rename failure (atomic-write teardown). |
| No quarantine path computation | No `quarantine_path_template` is built or written in T7 source. |
| No recursive delete | No `recursive: true` is passed when removing managed temp content; `mkdir(parent, { recursive: true })` is only used to create ancestor payload / lock directories. |
| No deletion of failed or partial directories | Test 23 explicitly asserts the unmanaged directory remains after `directory_exists_without_marker`; Test 25 asserts the tampered marker file remains on disk after `marker_mismatch`. |
| No process creation / probe / signal / v0.5 runtime integration / Ghostty / Pi topology spawn / dogfood | Forbidden-effect scan returns only a single docstring match enumerating the boundary; no actual process spawn / signal / Ghostty / `topology_spawn_role` source path exists in `temp-directory-creation.ts`. |
| No global approved-root discovery from environment variables / no implicit default root | `resolveApprovedTempRoot` accepts only the explicit `registry` input; tests map `tmp_root_default` to a test-owned `mkdtemp()` root (Tests 21 / 22 / 23 / 24 / 25). |
| No "best effort" recovery that claims ownership of an unmarked existing directory | `ensureTargetDirectory` returns `directory_exists_without_marker` (never silently creates) and `checkForExistingCreation` returns `reconciliation_required` for the same case in the active-replay path. |
| `ResourceCreationPlan` fingerprint semantics unchanged | `computeResourceCreationPlanFingerprint` is called exactly as T5 defined; the only fingerprint-adjacent change is the `quarantine_path_template` validator emission described in Task 1. |
| Deterministic `directory_basename` from durable `creation_nonce` and stable plan/action fields | Tests build `directory_basename` via `deriveDirectoryBasename(creation_nonce, plan)` which hashes `creation_nonce + mission_id + resource_id + plan_id` and prefixes `pi-topology-` plus the first 16 lowercase hex chars. The runtime does not use `mkdtemp()` randomness after `ResourceCreationPlan` is written. |
| Required tests + typecheck pass | 25 / 25 T7 tests + 109 / 109 foundation0 tests + 487 / 487 full unit + foundation0 + integration + typecheck all green. |
| Coder report at `records/2026-06-28-foundation-0-t7-temp-directory-creation-identity-marker.md` | This file. |

## Residual Risk

- **Crash-after-`resource_planned` before `mkdir` and crash-after-mkdir-before-marker both surface `reconciliation_required` and never overwrite.** If a concurrent owner wants to adopt a marker-less directory, a later reconciliation task will need a non-T7 path; T7 leaves the directory untouched and routes to reconciliation rather than guessing ownership.
- **`TempDirectoryCreationResult.events` contains only the events appended during this call.** Callers that need to see the full lifecycle history from the canonical log should call `readFoundation0Events(missionDir)`. The `idempotent_replay` path returns only the four pre-effect events for the current call; the existing `resource_identity_observed` / `resource_registered` / `resource_activated` / `initial_outcome_recorded` events are already on disk from the original creation and can be replayed independently.
- **Marker temp-file cleanup is allowed but localized.** The atomic-write rename uses a `.pi-topology-marker-<uuid>.tmp` file under the target; on rename failure we call `unlinkIfExists` for that temp file only. The managed temp directory and the canonical `.pi-topology-resource.json` are not touched on failure.

## Handoff

- No commit, push, or branch merge was performed.
- Checkout observed during revision: `master` with T7 working-tree changes present.
- Report: `records/2026-06-28-foundation-0-t7-temp-directory-creation-identity-marker.md`.
- Implementation: `packages/pi-topology/src/runtime/foundation0/temp-directory-creation.ts`.
- Tests: `packages/pi-topology/test/unit/foundation0/temp-directory-creation.test.ts`.
- Reviewer focus: see `docs/superpowers/plans/2026-06-28-foundation-0-t7-temp-directory-creation-identity-marker.md` §"Reviewer Focus" (T7 does not broaden scope into real effects; pre-effect ordering precedes `mkdir`; approved-root resolution is explicit and rejects symlinks and protected-path collisions; `identity_digest` is computed from `identity_core` only and never includes `marker_digest`; marker is written atomically and verified by read-back; lifecycle transitions are observable from the canonical event log; idempotent replay does not re-run `mkdir`; crash boundaries route to `reconciliation_required` with no delete / rename / overwrite; tests prove happy path, idempotent replay, marker tamper, and directory-without-marker cases).
