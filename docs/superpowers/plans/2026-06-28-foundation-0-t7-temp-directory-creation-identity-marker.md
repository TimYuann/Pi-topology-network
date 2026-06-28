# Foundation-0 T7 Temp-Directory Creation Identity + Marker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a managed temp-directory resource under an approved temp root, write and verify its marker, compute stable non-circular identity, and durably represent `planned -> registered -> active` without delete/quarantine/process effects.

**Architecture:** T7 is the first effectful Foundation-0 task, but its effect surface is intentionally tiny: create one directory under a trusted approved root and create one marker file inside it. The module must durably append create intent / attempt / execution policy / `ResourceCreationPlan` before `mkdir`, then make post-effect identity and lifecycle events replayable. Crash recovery is conservative: if the directory exists but ownership cannot be proven by marker + identity, T7 returns reconciliation-required and performs no cleanup.

**Tech Stack:** TypeScript with Node built-ins only; Node `node:test`; existing Foundation-0 modules under `packages/pi-topology/src/runtime/foundation0/`; no package dependency changes.

## Global Constraints

- T7 allowed effect: create managed temp directory under approved temp root.
- T7 allowed effect: write and verify `.pi-topology-resource.json` marker inside that directory.
- T7 may use atomic marker temp-file rename for marker durability.
- T7 MUST NOT delete, recursively remove, unlink managed temp content, or quarantine managed temp directories.
- T7 MUST NOT rename managed temp directories.
- T7 MUST NOT spawn processes.
- T7 MUST NOT signal processes, call `process.kill`, `kill`, `pkill`, `killall`, or process-group signal.
- T7 MUST NOT integrate with v0.5 runtime, Ghostty, Pi topology spawn, `topology_spawn_role`, or dogfood.
- T7 MUST NOT add package dependencies.
- T7 MUST NOT commit, push, publish, branch-merge, or perform broad cleanup from the Coder thread.
- `ResourceCreationPlan` MUST be durable before external creation.
- Execution-boundary `PolicyDecision` with `result: "allowed"` MUST be durable before external creation.
- Only approved temp roots from a trusted runtime registry may be used.
- Runtime MUST reject target paths outside the resolved approved root.
- Runtime MUST reject empty path, root path, approved temp root itself, runtime state root, mission storage root, repository root, current CLI cwd, and cwd ancestors.
- Runtime MUST reject symlink target directories and symlink marker paths.
- `TempDirectoryIdentity.identity_digest` MUST be computed from `identity_core` only.
- Marker MUST reference `identity_digest`; `marker_digest` MUST NOT participate in `identity_digest`.
- Crash after creation before activation MUST be replayable or reconciliation-required, never silently dropped.

---

## Context

T6 is committed as:

```text
4c799b4 feat(pi-topology): add foundation0 cleanup acquisition
```

T6 delivered durable cleanup-attempt acquisition. T7 is now unblocked for the narrow creation path, but delete/quarantine is still deferred to T8.

Contract references:

- `docs/19-pi-topology-v0.6-foundation-0-first-slice-contract.md` §8.2 pre-registration and §10 temp directory resource contract.
- `docs/20-pi-topology-v0.6-foundation-0-first-slice-contract-closure.md` §7.3 create managed resource, §9 managed resource union, and §13 temp directory identity / quarantine recovery.
- `docs/T1-T5-5.5-review-feedback.md` §3 and §6.1 T7 recommendation, plus §7 ResourceCreationPlan checks before real creation.
- `docs/superpowers/plans/2026-06-28-foundation-0-t6-durable-cleanup-attempt-acquisition.md` for pre-effect durable acquisition style, idempotency, and no-effect boundary discipline.

Relevant current implementation:

- `packages/pi-topology/src/runtime/foundation0/resource-creation-plan.ts`
  - Already creates and writes durable `resource_planned` events.
- `packages/pi-topology/src/runtime/foundation0/resource-lifecycle.ts`
  - Already creates planned registrations and transitions planned resources to `registered` / `active`.
- `packages/pi-topology/src/runtime/foundation0/schema.ts`
  - Already defines `TempDirectoryIdentityCore`, `TempDirectoryIdentity`, `TempDirectoryMarker`, `TempDirectoryCleanupPolicy`, `CreateManagedResourceAction`, and create outcome result codes.
- `packages/pi-topology/src/runtime/foundation0/validation.ts`
  - Already validates temp identity digest cycles when marker is supplied.
- `packages/pi-topology/src/runtime/foundation0/event-append.ts`
  - Already provides durable event append and payload read/verify.

## Recommended T7 Scope Boundary

T7 should implement exactly:

1. Validate a temp-directory creation request and approved-root registry.
2. Build or accept a `ResourceCreationPlan` for `resource_type: "temp_directory"` / `creation_kind: "create_temp_directory"`.
3. Durably append:
   - `action_requested`
   - `action_attempt_started`
   - `policy_decision_recorded`
   - `resource_planned`
4. Resolve approved root through trusted registry.
5. Create exactly one managed directory under that approved root.
6. Write `.pi-topology-resource.json` marker inside the created directory.
7. Verify marker bytes/digest and lstat identity.
8. Compute `TempDirectoryIdentity` and `identity_digest` without digest cycles.
9. Durably append:
   - `resource_identity_observed`
   - `resource_registered`
   - `resource_activated`
   - `initial_outcome_recorded` with create result `created`
10. Provide a replay/projection helper that can classify:
   - no effect yet, creation can proceed;
   - active registered temp resource;
   - crash after directory creation before marker;
   - crash after marker before lifecycle events;
   - missing/corrupt payload or partial event log.

## Hard Non-Goals

- No temp-directory cleanup.
- No quarantine path computation except naming future-T8 non-goal in comments/docs.
- No recursive delete.
- No deletion of failed or partial directories.
- No process creation.
- No process probe.
- No process signal.
- No v0.5 runtime integration.
- No Ghostty or Pi topology spawn.
- No dogfood.
- No global approved-root discovery from environment variables.
- No implicit default root outside an explicit registry supplied to the T7 API.
- No "best effort" recovery that claims ownership of an unmarked existing directory.

## Proposed File Map

Source files:

- Create: `packages/pi-topology/src/runtime/foundation0/temp-directory-creation.ts`
  - Main T7 orchestration, approved-root resolution, path containment, directory creation, marker write/verify, identity construction, replay classification.
- Modify: `packages/pi-topology/src/runtime/foundation0/schema.ts`
  - Add small payload/helper types if needed: `ApprovedTempRoot`, `TempDirectoryCreationPayload`, `TempDirectoryCreationResultPayload`, `TempDirectoryCreationReconciliationPayload`.
  - Do not add new event types.
- Modify: `packages/pi-topology/src/runtime/foundation0/validation.ts`
  - Add validators for the new T7 helper payloads.
  - Reuse existing `validateTempDirectoryIdentity()` and `validateTempDirectoryMarker()`.
- Modify: `packages/pi-topology/src/runtime/foundation0/resource-creation-plan.ts`
  - Only if needed to expose a temp-specific helper or a bounded lockId helper for long IDs.
  - Do not change existing ResourceCreationPlan fingerprint semantics unless HQ explicitly expands T7.
- Modify: `packages/pi-topology/src/runtime/foundation0/durable-fs.ts`
  - Only if needed to add `mkdirDurably(path)` that fsyncs the created directory and its parent.
  - Do not add delete helpers.

Test/report files:

- Create: `packages/pi-topology/test/unit/foundation0/temp-directory-creation.test.ts`
  - Focused T7 unit tests, including crash-boundary tests.
- Modify: `packages/pi-topology/test/unit/foundation0/resource-creation-plan.test.ts`
  - Only if adding temp-specific creation payload validation or lockId regression.
- Create: `records/2026-06-28-foundation-0-t7-temp-directory-creation-identity-marker.md`
  - Coder report after implementation.

## Proposed Interfaces And Payload Shapes

Names may be adjusted during implementation, but semantics should stay fixed.

```ts
export interface ApprovedTempRoot {
  root_id: string;
  path: string;
}

export interface ApprovedTempRootRegistry {
  roots: ApprovedTempRoot[];
}

export interface ResolvedApprovedTempRoot {
  root_id: string;
  configured_path: string;
  realpath: string;
}

export interface TempDirectoryCreationPayload {
  schema_version: 1;
  approved_temp_root_id: string;
  directory_basename: string;
  creation_nonce: string;
}

export interface TempDirectoryCreationRequest {
  missionDir: string;
  repoRoot: string;
  currentWorkingDirectory: string;
  approvedTempRoots: ApprovedTempRootRegistry;
  actionRequest: CreateManagedResourceAction;
  actionAttempt: ActionAttempt;
  allowedDecision: PolicyDecision;
  plan: ResourceCreationPlan;
  cleanupPolicy: TempDirectoryCleanupPolicy;
  nowIso?: () => string;
}

export type TempDirectoryCreationResult =
  | {
      result: "created";
      resource: ObservedTempDirectoryResource;
      identity: TempDirectoryIdentity;
      marker: TempDirectoryMarker;
      events: Event[];
    }
  | {
      result: "idempotent_replay";
      resource: ObservedTempDirectoryResource;
      identity: TempDirectoryIdentity;
      marker: TempDirectoryMarker;
      events: Event[];
    }
  | {
      result: "reconciliation_required";
      reason:
        | "directory_exists_without_marker"
        | "marker_mismatch"
        | "identity_mismatch"
        | "missing_payload"
        | "payload_digest_mismatch"
        | "partial_event_log"
        | "unsupported_schema";
      resource_id: string;
      planned_path?: string;
      events: Event[];
    };

export async function createManagedTempDirectory(
  input: TempDirectoryCreationRequest,
): Promise<TempDirectoryCreationResult>;

export async function readTempDirectoryCreationProjection(
  missionDir: string,
  resourceId: string,
): Promise<TempDirectoryCreationProjection>;
```

### Creation Payload Rules

`TempDirectoryCreationPayload` should be stored in `ResourceCreationPlan.creation_payload`.

Recommended fields:

```json
{
  "schema_version": 1,
  "approved_temp_root_id": "tmp_root_default",
  "directory_basename": "pi-topology-a1b2c3d4e5f6a7b8",
  "creation_nonce": "tmp_nonce_001"
}
```

Rules:

- `approved_temp_root_id` must pass Foundation-0 `validateId()`.
- `directory_basename` must be a single path segment.
- `directory_basename` must not be empty, `"."`, or `".."`.
- `directory_basename` must not contain `/` or `\0`.
- `directory_basename` should be generated from a short digest over `mission_id + resource_id + action_attempt_id + creation_nonce`, with an ID-safe prefix.
- `creation_nonce` must be generated before `ResourceCreationPlan` is written and must be included in the plan.
- Runtime must derive target path by joining resolved approved root realpath with `directory_basename`, then verifying containment.

### Approved Root Rules

`resolveApprovedTempRoot(registry, rootId)` must:

- find exactly one root by `root_id`;
- validate `root_id` with `validateId()`;
- reject missing/duplicate root IDs;
- `lstat` the configured path;
- reject configured root path if it is a symlink;
- require it to be a directory;
- resolve `realpath`;
- reject root realpath equal to mission storage root, repo root, current cwd, or cwd ancestors.

### Target Path Rules

`buildManagedTempDirectoryPath(root, creationPayload)` must:

- join only `root.realpath + directory_basename`;
- normalize/realpath parent only, not a user-supplied absolute target;
- reject any path outside `root.realpath`;
- reject target equal to root;
- reject target equal to mission dir, Foundation-0 storage dir, repo root, cwd, or cwd ancestors;
- create with exclusive `mkdir` semantics;
- if target exists before marker is valid, return `reconciliation_required`, not overwrite.

### Marker Rules

Marker file name:

```text
.pi-topology-resource.json
```

Marker payload:

```ts
const marker: TempDirectoryMarker = {
  schema_version: 1,
  mission_id,
  resource_id,
  identity_digest,
  created_by_action_id: actionRequest.action_id,
};
```

Rules:

- write marker only after `identity_digest` is computed from `identity_core`;
- write marker with canonical JSON + newline;
- fsync marker file;
- atomic rename marker temp file into marker path is allowed;
- fsync target directory after marker rename;
- lstat marker after write and reject symlink;
- read marker back and validate `marker_digest === sha256(canonical(marker))`;
- do not include `marker_digest` in `identity_digest` input.

### Identity Rules

Use existing schema:

```ts
const identityCore: TempDirectoryIdentityCore = {
  approved_temp_root_id,
  canonical_path,
  device_id,
  inode,
  owner_uid,
  creation_nonce,
};

const identity_digest = computeSha256Digest(identityCore);
const marker_digest = computeSha256Digest(marker);
const identity: TempDirectoryIdentity = {
  identity_core: identityCore,
  identity_digest,
  marker_digest,
};
```

Rules:

- `canonical_path` must be target directory realpath after creation.
- `device_id`, `inode`, and `owner_uid` must come from `lstat` of target directory.
- Target directory must not be symlink.
- `validateTempDirectoryIdentity(identity, { marker })` must pass before events are appended.
- Ledger `ObservedTempDirectoryResource.identity_digest` must equal `identity.identity_digest`.

## Durable Event Order

For a new creation, append in this order:

1. `action_requested`
   - payload: `CreateManagedResourceAction`
   - idempotency key: T7 base key + `:action_requested`
2. `action_attempt_started`
   - payload: `ActionAttempt`
   - idempotency key: T7 base key + `:attempt_started`
3. `policy_decision_recorded`
   - payload: execution-boundary `PolicyDecision` with `result: "allowed"`
   - idempotency key: T7 base key + `:execution_policy`
4. `resource_planned`
   - payload: complete `ResourceCreationPlan`
   - idempotency key: plan id
5. external effect: `mkdir` target directory under approved root
6. external effect: write marker file and verify
7. `resource_identity_observed`
   - payload: identity observation containing `identity`, `marker`, and `observed_at`
8. `resource_registered`
   - payload: `ObservedTempDirectoryResource` with lifecycle `registered`
9. `resource_activated`
   - payload: `ObservedTempDirectoryResource` with lifecycle `active`
10. `initial_outcome_recorded`
   - payload: `CreateManagedResourceInitialOutcome` with status `succeeded`, result code `created`

All event appends must use `appendFoundation0Event`.

If replay sees the same idempotent events and valid marker/identity/resource, return `idempotent_replay` without creating a second directory.

## Task 1: Schema And Validator Surface For T7 Payloads

**Files:**

- Modify: `packages/pi-topology/src/runtime/foundation0/schema.ts`
- Modify: `packages/pi-topology/src/runtime/foundation0/validation.ts`
- Test: `packages/pi-topology/test/unit/foundation0/temp-directory-creation.test.ts`

**Interfaces:**

- Consumes existing `TempDirectoryIdentity`, `TempDirectoryMarker`, `ResourceCreationPlan`.
- Produces validators for `ApprovedTempRoot`, `TempDirectoryCreationPayload`, and any T7 event payload helper objects.

- [ ] **Step 1: Write failing validator tests**

Add tests proving:

```ts
validateTempDirectoryCreationPayload({
  schema_version: 1,
  approved_temp_root_id: "tmp_root_default",
  directory_basename: "pi-topology-a1b2c3",
  creation_nonce: "tmp_nonce_001",
});

assert.throws(
  () => validateTempDirectoryCreationPayload({
    schema_version: 1,
    approved_temp_root_id: "tmp_root_default",
    directory_basename: "../escape",
    creation_nonce: "tmp_nonce_001",
  }),
  Foundation0ValidationError,
);
```

- [ ] **Step 2: Run validator tests and confirm RED**

Run:

```bash
node --experimental-strip-types --test test/unit/foundation0/temp-directory-creation.test.ts
```

Expected: fail because validators/types do not exist.

- [ ] **Step 3: Implement minimal schema and validators**

Add only T7 helper types and validators. Do not add event types.

- [ ] **Step 4: Run validator tests and confirm GREEN**

Run the same command.

Expected: pass validator subset.

## Task 2: Approved Root Resolution And Path Safety

**Files:**

- Create/modify: `packages/pi-topology/src/runtime/foundation0/temp-directory-creation.ts`
- Test: `packages/pi-topology/test/unit/foundation0/temp-directory-creation.test.ts`

**Interfaces:**

- Produces `resolveApprovedTempRoot()` and `buildManagedTempDirectoryPath()`.
- These helpers perform no creation effects.

- [ ] **Step 1: Write failing tests**

Cover:

- unknown approved root id is rejected;
- duplicate approved root ids are rejected;
- configured root symlink is rejected;
- target basename with slash is rejected;
- target is contained under root realpath;
- mission dir / repo root / current cwd / cwd ancestor are rejected as roots or protected targets.

- [ ] **Step 2: Run and confirm RED**

Run:

```bash
node --experimental-strip-types --test test/unit/foundation0/temp-directory-creation.test.ts
```

- [ ] **Step 3: Implement root/path helpers**

Use only `lstat`, `realpath`, `join`, `relative`, and existing Foundation-0 validators. Do not create or delete directories in these helpers.

- [ ] **Step 4: Run and confirm GREEN**

Run the same test command.

## Task 3: Durable Plan/Intent Gate Before `mkdir`

**Files:**

- Create/modify: `packages/pi-topology/src/runtime/foundation0/temp-directory-creation.ts`
- Test: `packages/pi-topology/test/unit/foundation0/temp-directory-creation.test.ts`

**Interfaces:**

- Consumes `CreateManagedResourceAction`, `ActionAttempt`, execution `PolicyDecision`, and `ResourceCreationPlan`.
- Produces pre-effect append helper for the first four events.

- [ ] **Step 1: Write failing test**

Test that `createManagedTempDirectory()` appends the first four durable events before any `mkdir` call. Use an injected effect hook:

```ts
const calls: string[] = [];
await createManagedTempDirectory({
  ...validInput,
  hooks: {
    beforeMkdir: async () => calls.push("mkdir"),
    afterEventAppend: async (event) => calls.push(event.event_type),
  },
});
assert.deepEqual(calls.slice(0, 4), [
  "action_requested",
  "action_attempt_started",
  "policy_decision_recorded",
  "resource_planned",
]);
assert.equal(calls[4], "mkdir");
```

- [ ] **Step 2: Run and confirm RED**

Expected: function/hook does not exist.

- [ ] **Step 3: Implement pre-effect durable append**

Validate:

- action capability/payload kind is `create_managed_resource`;
- action target resource id equals plan resource id;
- attempt/action/policy mission and action ids match;
- policy decision is `execution` and `allowed`;
- plan is temp-directory plan and effect fingerprint verifies.

- [ ] **Step 4: Run and confirm GREEN**

Run focused tests.

## Task 4: Create Directory, Marker, Identity

**Files:**

- Create/modify: `packages/pi-topology/src/runtime/foundation0/temp-directory-creation.ts`
- Test: `packages/pi-topology/test/unit/foundation0/temp-directory-creation.test.ts`

**Interfaces:**

- Produces `createTempDirectoryAndMarker()` internal helper and `createManagedTempDirectory()` happy path.

- [ ] **Step 1: Write failing happy-path test**

Assert:

- result is `created`;
- directory exists under approved root;
- marker exists at `.pi-topology-resource.json`;
- marker mission/resource/action fields match;
- `identity.identity_digest === computeSha256Digest(identity.identity_core)`;
- `identity.marker_digest === computeSha256Digest(marker)`;
- `validateTempDirectoryIdentity(identity, { marker })` passes;
- no directory is created outside approved root.

- [ ] **Step 2: Run and confirm RED**

Expected: creation not implemented.

- [ ] **Step 3: Implement minimal creation**

Use:

- exclusive `mkdir` for target directory;
- fsync approved root directory after target directory creation;
- lstat target and reject symlink;
- canonical path from target `realpath`;
- durable marker file write;
- read marker back and verify digest.

Do not delete or quarantine on failure.

- [ ] **Step 4: Run and confirm GREEN**

Run focused tests.

## Task 5: Lifecycle Events And Idempotent Replay

**Files:**

- Create/modify: `packages/pi-topology/src/runtime/foundation0/temp-directory-creation.ts`
- Test: `packages/pi-topology/test/unit/foundation0/temp-directory-creation.test.ts`

**Interfaces:**

- Consumes `attachObservedIdentity()` from `resource-lifecycle.ts`.
- Produces active `ObservedTempDirectoryResource` and replay projection.

- [ ] **Step 1: Write failing lifecycle/replay tests**

Assert:

- event order includes `resource_identity_observed`, `resource_registered`, `resource_activated`, `initial_outcome_recorded`;
- registered resource payload validates as lifecycle `registered`;
- activated resource payload validates as lifecycle `active`;
- same idempotency key returns `idempotent_replay`;
- replay does not call `mkdir` a second time.

- [ ] **Step 2: Run and confirm RED**

- [ ] **Step 3: Implement lifecycle append and projection**

Use `appendFoundation0Event` with stable idempotency keys. Rebuild state from canonical events and payloads. Missing/corrupt payloads must return `reconciliation_required`.

- [ ] **Step 4: Run and confirm GREEN**

Run focused tests.

## Task 6: Crash-Boundary Reconciliation Tests

**Files:**

- Create/modify: `packages/pi-topology/src/runtime/foundation0/temp-directory-creation.ts`
- Test: `packages/pi-topology/test/unit/foundation0/temp-directory-creation.test.ts`

**Interfaces:**

- Produces explicit reconciliation classifications.

- [ ] **Step 1: Write failing crash-boundary tests**

Required cases:

1. Crash after `resource_planned` before `mkdir`: retry may create exactly once.
2. Crash after `mkdir` before marker: retry returns `reconciliation_required / directory_exists_without_marker`; no overwrite, no delete.
3. Crash after marker before `resource_identity_observed`: retry validates marker and completes lifecycle events.
4. Crash after `resource_identity_observed` before `resource_registered`: retry completes registration/activation without creating another directory.
5. Marker mismatch: retry returns `reconciliation_required / marker_mismatch`; no delete.
6. Payload missing/digest mismatch/partial event log: retry returns `reconciliation_required`; no create.

- [ ] **Step 2: Run and confirm RED**

- [ ] **Step 3: Implement replay branches**

Replay must prefer durable event evidence over filesystem guesses. Filesystem ownership is proven only by matching marker + identity.

- [ ] **Step 4: Run and confirm GREEN**

Run focused tests.

## Verification Commands

Run from `packages/pi-topology/`:

```bash
node --experimental-strip-types --test test/unit/foundation0/temp-directory-creation.test.ts
node --experimental-strip-types --test test/unit/foundation0/resource-creation-plan.test.ts
node --experimental-strip-types --test test/unit/foundation0/resource-lifecycle.test.ts
node --experimental-strip-types --test test/unit/foundation0/*.test.ts
npm run typecheck
node --experimental-strip-types --test test/unit/*.test.ts test/unit/foundation0/*.test.ts test/integration/foundation0/*.test.ts
```

Run from repo root:

```bash
rg -n "process\\.kill|\\bkill\\b|\\bpkill\\b|\\bkillall\\b|topology_spawn_role|Ghostty|spawn\\(|process\\.spawn|child_process\\.spawn" packages/pi-topology/src/runtime/foundation0 packages/pi-topology/test/unit/foundation0
```

Expected: no process/Ghostty/spawn/signal matches.

Run source-only delete/quarantine scan from repo root:

```bash
rg -n "\\brm\\(|\\brmdir\\(|\\bunlink\\(|recursive|quarantine|rename\\([^,]+,[^)]*quarantine" packages/pi-topology/src/runtime/foundation0
```

Expected:

- no managed-temp delete/quarantine source paths;
- marker temp-file cleanup or existing shared `durable-fs.ts` helpers may need explicit review if matched;
- marker atomic file rename is allowed only for marker write, not directory quarantine.

## Reviewer Focus

- Verify durable event order: intent/attempt/policy/plan before `mkdir`.
- Verify only explicit approved temp roots are accepted.
- Verify `directory_basename` cannot escape root.
- Verify target/marker symlinks are rejected.
- Verify marker references `identity_digest`, while `identity_digest` excludes `marker_digest`.
- Verify `marker_digest` is computed from canonical marker.
- Verify `planned -> registered -> active` is represented with canonical events and payloads.
- Verify crash after directory creation before activation is replayable or reconciliation-required.
- Verify no delete/quarantine/source cleanup exists.
- Verify no process/Ghostty/Pi topology spawn/v0.5 integration exists.

## HQ Decisions Before Implementation

1. **Approved temp root registry source:** T7 MUST use an explicit `approvedTempRoots` input. It MUST NOT discover approved roots from env vars or global defaults. Tests should map `tmp_root_default` to a test-owned `mkdtemp()` root, not to `/private/tmp`.
2. **Test teardown delete allowance:** T7 source code MUST NOT delete managed temp directories or managed temp contents. Unit tests MAY remove test-owned temp roots in `finally` blocks with `rm(..., { recursive: true, force: true })` to avoid leaking local test artifacts. Any delete/unlink/rm matches in tests must be reported as test-harness cleanup, not runtime behavior.
3. **InitialOutcome in T7:** T7 SHOULD append `initial_outcome_recorded` with `action_payload_kind: "create_managed_resource"`, `status: "succeeded"`, and `result_code: "created"` after `resource_activated`.
4. **ResourceCreationPlan fingerprint:** T7 MUST NOT change existing `ResourceCreationPlan` fingerprint semantics. The current `created_at` inclusion is deferred unless a separate contract-tightening task is authorized.
5. **Creation path determinism:** T7 MUST use a deterministic `directory_basename` derived from durable `creation_nonce` and stable plan/action fields. It MUST NOT use `mkdtemp()` randomness after `ResourceCreationPlan` is written.

## Implementation Handoff

HQ has confirmed this plan. Coder should implement T7 task-by-task with TDD and send to Reviewer. Do not commit or push from the Coder thread.
