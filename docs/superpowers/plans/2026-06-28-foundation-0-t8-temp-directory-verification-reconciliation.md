# Foundation-0 T8 Temp-Directory Verification Projection + Reconciliation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a non-destructive temp-directory verification and replay/projection layer for T7-created resources, recording reconciliation-required signals when marker/path/identity state is unsafe, without quarantine or recursive delete.

**Architecture:** T8 is the next safe effect boundary after T7 because T7 can now create a managed temp directory and marker, but cleanup remains high risk. Before any quarantine/delete task, the runtime needs a reusable preflight that can reconstruct resource state from canonical Foundation-0 events, re-read the marker and filesystem identity, classify mismatch/missing/symlink/protected-path cases, and durably record reconciliation-required observations under the existing event ordering rules. T8 performs only read-only filesystem probes plus canonical event appends; it does not rename, delete, quarantine, spawn, signal, or integrate with v0.5.

**Tech Stack:** TypeScript with Node built-ins only; Node `node:test`; existing Foundation-0 modules under `packages/pi-topology/src/runtime/foundation0/`; no package dependency changes.

## Recommended T8 Scope

T8 should implement:

1. A replay/projection helper that reconstructs the latest temp-directory resource state from canonical events.
2. A read-only temp-directory verifier that checks:
   - approved-root registry resolution;
   - canonical path containment;
   - protected-path rejection;
   - target `lstat` / `realpath`;
   - marker `lstat` / read / validation;
   - marker mission/resource/identity digest match;
   - device/inode/owner/creation_nonce match against ledger identity.
3. A non-destructive reconciliation signal path that can durably append:
   - `action_requested`
   - `action_attempt_started`
   - `policy_decision_recorded`
   - `reconciliation_required`
   - optional `reconciliation_observed`
4. Tests proving every unsafe case is classified and recorded without deleting, renaming, or overwriting anything.

T8 is the correct next slice because it closes the read/replay gap left by T7. T7 can return `reconciliation_required` for crash and mismatch states, but the project still lacks a standalone verifier/reconciliation layer that later cleanup code can call before attempting quarantine. Implementing that layer before destructive cleanup keeps the Foundation-0 sequence reviewable:

```text
T6 durable cleanup acquisition
T7 temp directory creation + marker
T8 temp directory verification + reconciliation signals
T9 later, separately reviewed quarantine/cleanup preflight or execution
```

## Hard Non-Goals

- No temp-directory quarantine.
- No managed temp-directory rename.
- No recursive delete.
- No managed temp-directory unlink, rmdir, rm, or cleanup.
- No marker overwrite or marker repair.
- No adoption of an unmarked existing directory.
- No process spawn.
- No process probe.
- No process signal, `process.kill`, `kill`, `pkill`, `killall`, or process-group signal.
- No Ghostty launch.
- No Pi topology spawn.
- No `topology_spawn_role`.
- No dogfood.
- No v0.5 runtime integration.
- No package dependency changes.
- No commit, push, publish, broad cleanup, or branch merge from the Coder thread.

T8 may append Foundation-0 reconciliation events. That is a durable ledger effect, not an external resource effect. It must still require an execution-boundary `PolicyDecision` when recording reconciliation state.

## Context

Base/local HEAD expected:

```text
cd17d40 test(pi-topology): cover unsupported temp identity replay
```

T7 delivered:

- explicit approved-root registry;
- `ResourceCreationPlan` for `temp_directory` / `create_temp_directory`;
- pre-effect durable `action_requested`, `action_attempt_started`, `policy_decision_recorded`, `resource_planned`;
- exclusive `mkdir`;
- `.pi-topology-resource.json` marker write and verification;
- non-circular `TempDirectoryIdentity`;
- durable `resource_identity_observed`, `resource_registered`, `resource_activated`, `initial_outcome_recorded`;
- idempotent replay for marker-verified active resources;
- `reconciliation_required` classification for unsafe crash/mismatch states;
- no delete, no quarantine, no process effects.

Contract references:

- `docs/19-pi-topology-v0.6-foundation-0-first-slice-contract.md` §10.1 temp resource identity and containment.
- `docs/19-pi-topology-v0.6-foundation-0-first-slice-contract.md` §10.2 safe temp cleanup algorithm, steps 1-4 only for T8.
- `docs/20-pi-topology-v0.6-foundation-0-first-slice-contract-closure.md` §13 temp directory identity and quarantine recovery.
- `docs/superpowers/plans/2026-06-28-foundation-0-t7-temp-directory-creation-identity-marker.md`.
- `records/2026-06-28-foundation-0-t7-temp-directory-creation-identity-marker.md`.

Doc 20 supersedes conflicting first-slice semantics in doc 19.

## Expected File Map

Allowed source files:

- Create: `packages/pi-topology/src/runtime/foundation0/temp-directory-verification.ts`
  - Owns T8 projection, read-only verification, reconciliation-required recording, and non-destructive classification.
- Modify: `packages/pi-topology/src/runtime/foundation0/schema.ts`
  - Add small T8 payload/projection types if needed:
    - `TempDirectoryVerificationPayload`
    - `TempDirectoryVerificationObservationPayload`
    - `TempDirectoryReconciliationRequiredPayload`
    - `TempDirectoryResourceProjection`
- Modify: `packages/pi-topology/src/runtime/foundation0/validation.ts`
  - Add validators for new T8 payload/projection objects.
  - Reuse existing temp identity and marker validators.
- Modify: `packages/pi-topology/src/runtime/foundation0/temp-directory-creation.ts`
  - Only if needed to export already-proven helper constants or pure helpers such as marker filename, protected-path checks, or target path construction.
  - Do not broaden T7 creation behavior.
- Modify: `packages/pi-topology/src/runtime/foundation0/event-append.ts`
  - Only if a narrow payload replay helper is needed; preserve existing digest/sequence/lock semantics.

Allowed test/report files:

- Create: `packages/pi-topology/test/unit/foundation0/temp-directory-verification.test.ts`
  - Focused T8 unit tests.
- Modify: `packages/pi-topology/test/unit/foundation0/temp-directory-creation.test.ts`
  - Only for shared fixture exports or regressions that prevent duplicating large setup.
- Create: `records/2026-06-28-foundation-0-t8-temp-directory-verification-reconciliation.md`
  - Coder report after implementation.

Do not modify package manifests.

## Proposed Public Interfaces

Names may be adjusted during implementation, but semantics should stay fixed.

```ts
export type TempDirectoryVerificationStatus =
  | "verified_active"
  | "planned_no_effect"
  | "missing_target"
  | "target_not_directory"
  | "target_symlink"
  | "marker_missing"
  | "marker_symlink"
  | "marker_parse_error"
  | "marker_mismatch"
  | "identity_mismatch"
  | "protected_path"
  | "unsupported_resource_state"
  | "missing_payload"
  | "payload_digest_mismatch"
  | "partial_event_log"
  | "unsupported_schema";

export interface TempDirectoryResourceProjection {
  mission_id: string;
  resource_id: string;
  latest_lifecycle_state:
    | "planned"
    | "registered"
    | "active"
    | "stale"
    | "cleanup_pending"
    | "cleanup_attempted"
    | "cleaned"
    | "cleanup_failed"
    | "abandoned";
  latest_resource?: ManagedResource;
  identity?: TempDirectoryIdentity;
  identity_event_id?: string;
  activated_event_id?: string;
  created_outcome_event_id?: string;
  blocking_event_ids: string[];
}

export interface TempDirectoryVerificationInput {
  missionDir: string;
  repositoryRoot: string;
  currentWorkingDirectory: string;
  approvedTempRoots: ApprovedTempRoot[];
  resourceId: string;
}

export type TempDirectoryVerificationResult =
  | {
      status: "verified_active";
      projection: TempDirectoryResourceProjection;
      resource: ObservedTempDirectoryResource;
      identity: TempDirectoryIdentity;
      marker: TempDirectoryMarker;
      current_path: string;
    }
  | {
      status: Exclude<TempDirectoryVerificationStatus, "verified_active">;
      projection: TempDirectoryResourceProjection;
      resource_id: string;
      reason: string;
      current_path?: string;
      blocking_event_ids: string[];
    };

export async function readTempDirectoryResourceProjection(
  missionDir: string,
  resourceId: string,
): Promise<TempDirectoryResourceProjection>;

export async function verifyManagedTempDirectory(
  input: TempDirectoryVerificationInput,
): Promise<TempDirectoryVerificationResult>;
```

### Reconciliation Recording Interfaces

Recording reconciliation state is separate from read-only verification. It requires action, attempt, and policy objects.

```ts
export interface RecordTempDirectoryReconciliationInput {
  missionDir: string;
  verification: TempDirectoryVerificationResult;
  actionRequest: ReconcileResourceAction;
  actionAttempt: ActionAttempt;
  allowedDecision: PolicyDecision;
  reconciliationActorId: string;
  nowIso?: () => string;
}

export type TempDirectoryReconciliationRecordResult =
  | {
      result: "recorded";
      verification_status: TempDirectoryVerificationStatus;
      events: Event[];
    }
  | {
      result: "idempotent_replay";
      verification_status: TempDirectoryVerificationStatus;
      events: Event[];
    };

export async function recordTempDirectoryReconciliationRequired(
  input: RecordTempDirectoryReconciliationInput,
): Promise<TempDirectoryReconciliationRecordResult>;
```

Validation rules:

- `actionRequest.payload_kind` must be `reconcile_resource`.
- `actionRequest.capability` must be `reconcile_resource`.
- `actionRequest.target.entity_type` must be `resource`.
- `actionRequest.target.resource_id` must match `verification.resource_id` or `verification.projection.resource_id`.
- `actionRequest.mission_id`, `actionAttempt.mission_id`, and `allowedDecision.mission_id` must match.
- `actionAttempt.action_id` and `allowedDecision.action_id` must match `actionRequest.action_id`.
- `allowedDecision.action_attempt_id` must match `actionAttempt.action_attempt_id`.
- `allowedDecision.evaluation_point` must be `execution`.
- `allowedDecision.result` must be `allowed`.
- `reconciliationActorId` must be a valid Foundation-0 ID.
- `verified_active` should not append `reconciliation_required`; it may append `reconciliation_observed` only if HQ explicitly keeps that in scope. Default recommendation: do not append on `verified_active`.

## Payload / Schema / Validator Changes

Add a small canonical payload for reconciliation-required records. Suggested shape:

```ts
export interface TempDirectoryReconciliationRequiredPayload {
  schema_version: 1;
  mission_id: string;
  resource_id: string;
  verification_status: Exclude<TempDirectoryVerificationStatus, "verified_active">;
  identity_digest?: string;
  current_path?: string;
  expected_identity?: TempDirectoryIdentity;
  observed_marker?: TempDirectoryMarker;
  blocking_event_ids: string[];
  observed_at: string;
}
```

Rules:

- Use existing ID/digest/timestamp validators.
- `verification_status` is closed over the T8 non-verified statuses.
- `identity_digest`, if present, must match Foundation-0 digest grammar.
- `current_path`, if present, is observational evidence only; it must not be used as an untrusted cleanup target without re-verification in a later task.
- `blocking_event_ids` must be valid Foundation-0 IDs.
- The payload must be canonicalized and digest-bound by `appendFoundation0Event`.

Optional observation payload:

```ts
export interface TempDirectoryVerificationObservationPayload {
  schema_version: 1;
  mission_id: string;
  resource_id: string;
  verification_status: TempDirectoryVerificationStatus;
  identity_digest?: string;
  current_path?: string;
  observed_at: string;
}
```

Do not add new event types unless the existing catalog cannot safely represent the payload. Preferred existing event types:

- `reconciliation_required` for unsafe/non-verified states.
- `reconciliation_observed` only for optional non-terminal read observations.

## Durable Event Ordering And Lock Ordering

Read-only verification:

```text
read canonical event log
read/verify referenced payloads as needed
inspect filesystem with lstat/read/realpath
return classification
```

No event lock is required for pure read-only verification.

Recording reconciliation:

```text
1. Run verifyManagedTempDirectory first.
2. If status == verified_active:
     return without appending reconciliation_required by default.
3. Acquire mission event lock through appendFoundation0Event for each event.
4. Append action_requested with ReconcileResourceAction payload.
5. Append action_attempt_started with ActionAttempt payload.
6. Append policy_decision_recorded with execution allowed PolicyDecision payload.
7. Append reconciliation_required with TempDirectoryReconciliationRequiredPayload.
8. Release locks through existing appendFoundation0Event behavior.
```

Rules:

- Preserve T2/T5/T6/T7 canonical event invariants.
- Do not bypass `appendFoundation0Event`.
- Do not write payload files manually except through existing durable helpers.
- Let `appendFoundation0Event` compute payload digest; do not trust caller hints.
- Use deterministic idempotency keys so retrying the same reconciliation action does not duplicate events.
- Use bounded lock IDs that pass Foundation-0 ID validation.
- If `readFoundation0Events` throws `PartialEventLogError`, return/record `partial_event_log` and do not attempt filesystem cleanup.
- If `readFoundation0EventPayload` throws missing/digest mismatch, return/record `missing_payload` or `payload_digest_mismatch` and do not attempt filesystem cleanup.

## Crash / Replay Boundaries

T8 must be conservative and replayable:

| Situation | T8 behavior |
| --- | --- |
| No `resource_planned` event | `unsupported_resource_state`; do not inspect arbitrary paths. |
| Planned resource but no identity observed | `planned_no_effect`; no cleanup target exists. |
| Active resource with matching marker + device/inode/owner | `verified_active`. |
| Active resource target missing | `missing_target`; append reconciliation-required if recording path is called. |
| Target exists but is symlink | `target_symlink`; no follow, no delete. |
| Marker missing | `marker_missing`; no marker repair. |
| Marker is symlink | `marker_symlink`; no follow, no delete. |
| Marker parse/validation fails | `marker_parse_error`; leave bytes untouched. |
| Marker mission/resource/identity mismatch | `marker_mismatch`; leave file untouched. |
| Device/inode/owner/creation_nonce mismatch | `identity_mismatch`; leave target untouched. |
| Target resolves to protected path | `protected_path`; do not proceed. |
| Missing/digest-mismatched payload | `missing_payload` / `payload_digest_mismatch`; do not infer from filesystem alone. |
| Partial event log | `partial_event_log`; no append unless append path can safely record the issue after HQ-approved behavior. |

T8 must not mark resources `cleaned`, must not transition to `cleanup_attempted`, and must not produce terminal cleanup outcomes. It may only produce reconciliation-needed state for later, higher-risk tasks.

## Test Plan

### Projection Tests

- Reconstructs a T7-created active temp resource from canonical events.
- Returns `planned_no_effect` for a resource with only `resource_planned`.
- Returns `unsupported_resource_state` for unknown resource id.
- Returns `missing_payload` when a required T7 payload file is absent.
- Returns `payload_digest_mismatch` when a required payload digest does not match.
- Returns `partial_event_log` on a trailing partial JSONL row.
- Does not inspect filesystem for unknown/unplanned resources.

### Verification Tests

- `verified_active` for a valid T7-created directory + marker.
- `missing_target` when the active resource path is absent.
- `target_symlink` when the target path is a symlink.
- `target_not_directory` when the target path is a regular file.
- `marker_missing` when target exists but marker does not.
- `marker_symlink` when marker path is a symlink.
- `marker_parse_error` when marker bytes are not valid JSON or fail schema.
- `marker_mismatch` when marker mission_id/resource_id/identity_digest differs.
- `identity_mismatch` when lstat device/inode/owner differs from ledger identity.
- `protected_path` when projected path equals repo root, mission dir, Foundation-0 storage dir, cwd, or a configured protected path.
- Verifier never overwrites marker bytes.
- Verifier never renames target.
- Verifier never deletes target or marker.

### Reconciliation Recording Tests

- Non-verified status appends `action_requested`, `action_attempt_started`, `policy_decision_recorded`, `reconciliation_required` in order.
- `reconciliation_required` payload includes verification status, resource id, blocking event ids, and observed timestamp.
- Same idempotency key returns `idempotent_replay` without duplicate events.
- `verified_active` does not append `reconciliation_required` by default.
- Reconcile action with wrong capability/payload kind is rejected.
- PolicyDecision with non-`allowed` result is rejected.
- Cross-mission action/attempt/decision is rejected.
- Event payloads are digest-bound and readable through `readFoundation0EventPayload`.

### Regression / Forbidden-Effect Tests

- Test monkeypatch or static scan proves T8 code path does not call `rename` for managed target paths.
- Test/static scan proves no `rm`, `rmdir`, `unlink` of managed target or marker.
- Test/static scan proves no `spawn`, `process.kill`, `kill`, `pkill`, `killall`, Ghostty, `topology_spawn_role`, or dogfood references in T8 source/tests except explicit forbidden-effect test strings.

## Verification Commands

Run from `packages/pi-topology/`:

```bash
node --experimental-strip-types --test test/unit/foundation0/temp-directory-verification.test.ts
node --experimental-strip-types --test test/unit/foundation0/temp-directory-creation.test.ts
node --experimental-strip-types --test test/unit/foundation0/*.test.ts
node --experimental-strip-types --test test/unit/*.test.ts test/unit/foundation0/*.test.ts test/integration/foundation0/*.test.ts
npm run typecheck
```

Forbidden-effect scans from repo root:

```bash
rg -n "process\\.kill|\\bkill\\b|\\bpkill\\b|\\bkillall\\b|topology_spawn_role|Ghostty|spawn\\(|process\\.spawn|child_process\\.spawn" \
  packages/pi-topology/src/runtime/foundation0 \
  packages/pi-topology/test/unit/foundation0

rg -n "\\brm\\(|\\brmdir\\(|\\bunlink\\(|recursive|quarantine|rename\\(" \
  packages/pi-topology/src/runtime/foundation0/temp-directory-verification.ts \
  packages/pi-topology/test/unit/foundation0/temp-directory-verification.test.ts
```

Expected scan results:

- No actual process/spawn/signal calls.
- No managed target delete/rename/quarantine implementation.
- Mentions in comments, schema fields, or test names must be reviewed and reported explicitly.

## Report

Create:

```text
records/2026-06-28-foundation-0-t8-temp-directory-verification-reconciliation.md
```

Report must include:

- Files changed.
- Projection behavior summary.
- Verification status matrix.
- Reconciliation event ordering.
- Digest/payload verification behavior.
- Crash/replay behavior.
- Verification command results.
- Forbidden-effect scan results.
- Explicit statement: no source path performs temp quarantine/delete/rename, process spawn/probe/signal, Ghostty/Pi topology spawn, dogfood, v0.5 integration, package changes, commit, or push.
- Remaining next-step recommendation for T9.

## Open HQ Questions

Firm recommendation: T8 should not perform quarantine or recursive delete. It should stop at verification and reconciliation-required recording.

Questions for HQ:

1. Should `verified_active` append a lightweight `reconciliation_observed` event, or should T8 keep successful verification read-only?
   - Recommendation: keep successful verification read-only to avoid event noise until closeout/reconciliation policy needs positive observations.
2. Should `partial_event_log` be recordable as `reconciliation_required`, or should it return only an error classification because appending after a partial log may be unsafe?
   - Recommendation: return classification only; do not append after partial event log in T8.
3. Should T9 be quarantine preflight or temp-directory quarantine execution?
   - Recommendation: T9 should be quarantine preflight / deterministic quarantine intent payload first, with delete still deferred unless HQ explicitly accepts a destructive task.

## Paste-Ready OMP Implementation Task Card

```text
Task: Foundation-0 T8 Temp-Directory Verification Projection + Reconciliation

Repo: /Users/yuantian/Documents/Coding/Pi-topology-network
Base HEAD expected: cd17d40 test(pi-topology): cover unsupported temp identity replay

Task doc:
docs/superpowers/plans/2026-06-28-foundation-0-t8-temp-directory-verification-reconciliation.md

Goal:
Implement a non-destructive temp-directory verification and replay/projection layer for T7-created resources. T8 must reconstruct temp-resource state from canonical Foundation-0 events, re-read marker/path/device/inode identity, classify unsafe states, and durably record reconciliation_required for non-verified states when supplied a valid reconcile action/attempt/execution PolicyDecision.

Hard non-goals:
- No quarantine.
- No managed temp-directory rename.
- No recursive delete.
- No managed temp-directory unlink/rmdir/rm/cleanup.
- No marker repair/overwrite.
- No adoption of unmarked directories.
- No process spawn/probe/signal.
- No Ghostty/Pi topology spawn/dogfood/v0.5 integration.
- No package dependency changes.
- No commit/push.

Allowed source files:
- create packages/pi-topology/src/runtime/foundation0/temp-directory-verification.ts
- modify packages/pi-topology/src/runtime/foundation0/schema.ts if small T8 payload/projection types are needed
- modify packages/pi-topology/src/runtime/foundation0/validation.ts if validators are needed
- modify packages/pi-topology/src/runtime/foundation0/temp-directory-creation.ts only to export pure constants/helpers; do not broaden creation behavior
- modify packages/pi-topology/src/runtime/foundation0/event-append.ts only for a narrow replay helper if necessary

Allowed tests/report:
- create packages/pi-topology/test/unit/foundation0/temp-directory-verification.test.ts
- modify packages/pi-topology/test/unit/foundation0/temp-directory-creation.test.ts only for shared fixtures/regressions
- create records/2026-06-28-foundation-0-t8-temp-directory-verification-reconciliation.md

Required public interfaces:
- readTempDirectoryResourceProjection(missionDir, resourceId)
- verifyManagedTempDirectory(input)
- recordTempDirectoryReconciliationRequired(input)

Required behavior:
- verified active T7 temp resource returns verified_active.
- missing target, symlink target, marker missing, marker symlink, marker parse error, marker mismatch, identity mismatch, protected path, missing payload, payload digest mismatch, partial event log are classified without delete/rename/overwrite.
- recording path appends action_requested, action_attempt_started, policy_decision_recorded, reconciliation_required in that order.
- all event payloads go through appendFoundation0Event and digest verification.
- idempotent retry does not duplicate reconciliation events.

Verification:
Run from packages/pi-topology:
node --experimental-strip-types --test test/unit/foundation0/temp-directory-verification.test.ts
node --experimental-strip-types --test test/unit/foundation0/temp-directory-creation.test.ts
node --experimental-strip-types --test test/unit/foundation0/*.test.ts
node --experimental-strip-types --test test/unit/*.test.ts test/unit/foundation0/*.test.ts test/integration/foundation0/*.test.ts
npm run typecheck

Forbidden-effect scans:
rg -n "process\\.kill|\\bkill\\b|\\bpkill\\b|\\bkillall\\b|topology_spawn_role|Ghostty|spawn\\(|process\\.spawn|child_process\\.spawn" packages/pi-topology/src/runtime/foundation0 packages/pi-topology/test/unit/foundation0
rg -n "\\brm\\(|\\brmdir\\(|\\bunlink\\(|recursive|quarantine|rename\\(" packages/pi-topology/src/runtime/foundation0/temp-directory-verification.ts packages/pi-topology/test/unit/foundation0/temp-directory-verification.test.ts

Report:
records/2026-06-28-foundation-0-t8-temp-directory-verification-reconciliation.md

Do not stage, commit, push, delete unrelated files, or touch pre-existing untracked docs.
```

## Self-Review

- Spec coverage: T8 covers the non-destructive parts of doc 19 §10.2 steps 1-4 and doc 20 §13 verification requirements; destructive quarantine/delete remains explicitly deferred.
- Placeholder scan: No TBD/TODO/fill-in placeholders are present.
- Type consistency: Proposed names align with existing T6/T7 modules and event catalog.
