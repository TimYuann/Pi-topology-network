# Foundation-0 First-Slice Planning Gate Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to complete this planning gate step-by-step. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a reviewable implementation plan and schema plan for Pi Topology v0.6 Foundation-0 first slice without changing runtime code.

**Architecture:** This is a planning gate, not an implementation task. The worker must translate docs 19 and 20 into machine-checkable schema work, implementation slices, test strategy, and open risk inventory. No `packages/pi-topology/src` runtime behavior may be modified in this task.

**Tech Stack:** Markdown planning docs, TypeScript/Node project inspection, existing `packages/pi-topology` tests only as read-only context unless explicitly noted.

## Global Constraints

- Source contracts: `docs/19-pi-topology-v0.6-foundation-0-first-slice-contract.md` and `docs/20-pi-topology-v0.6-foundation-0-first-slice-contract-closure.md`.
- Precedence: doc 20 supersedes conflicting first-slice semantics in doc 19.
- Output must be document-first. Full result goes to a record file; inline report must be short.
- Do not modify runtime code under `packages/pi-topology/src`.
- Do not modify tests in this planning gate.
- Do not run real cleanup, real process killing, real Ghostty launch, or dogfood.
- Do not use broad `pkill`, `kill`, or filesystem deletion.
- Do not commit.
- Treat all current untracked docs/review files as owner/Codex context; do not clean, restore, or stage them.
- If you discover that implementation needs codebase facts, inspect files read-only and cite exact paths.
- Final deliverable must be specific enough that Codex can review and then authorize a separate implementation plan.

---

## Deliverables

Create one full report:

```text
records/2026-06-26-foundation-0-first-slice-planning-gate.md
```

The report must contain:

1. Contract coverage matrix mapping doc 19/20 requirements to proposed implementation tasks.
2. First-slice schema inventory with exact TypeScript module/file recommendations.
3. ActionRequest / PolicyDecision / Event / ManagedResource / Evidence / Closeout object plan.
4. macOS process identity probe plan.
5. durable event append and lock strategy.
6. temp directory marker/quarantine algorithm plan.
7. reconciliation and crash recovery plan.
8. acceptance test plan for tests 1-32.
9. implementation task decomposition with review checkpoints.
10. blocker/open-question list.
11. explicit statement that no runtime code was modified.

Inline report format:

```text
REPORT planning-gate
decision: ready_for_codex_review | blocked
artifact: records/2026-06-26-foundation-0-first-slice-planning-gate.md
findings: <count>
blockers: <count>
next: <one sentence>
```

---

### Task 1: Read Contracts And Establish Scope

**Files:**
- Read: `docs/19-pi-topology-v0.6-foundation-0-first-slice-contract.md`
- Read: `docs/20-pi-topology-v0.6-foundation-0-first-slice-contract-closure.md`
- Create: `records/2026-06-26-foundation-0-first-slice-planning-gate.md`

**Interfaces:**
- Consumes: contract requirements in docs 19 and 20.
- Produces: report sections `Scope`, `Precedence`, and `Non-Goals`.

- [ ] **Step 1: Read the current contract docs**

Run:

```bash
sed -n '1,260p' docs/19-pi-topology-v0.6-foundation-0-first-slice-contract.md
sed -n '1,260p' docs/20-pi-topology-v0.6-foundation-0-first-slice-contract-closure.md
```

Expected: both files exist and state Foundation-0 + process/temp-directory Resource Ledger / Cleanup Guard as the first slice.

- [ ] **Step 2: Create the report skeleton**

Create `records/2026-06-26-foundation-0-first-slice-planning-gate.md` with these headings:

```markdown
# Foundation-0 First-Slice Planning Gate

Date: 2026-06-26
Status: planning-gate report
Scope: Foundation-0 + process/temp-directory Resource Ledger / Cleanup Guard

## Decision

## Scope And Precedence

## Non-Goals

## Contract Coverage Matrix

## Schema Inventory

## Object Model Plan

## Runtime Implementation Plan

## macOS Process Identity Probe Plan

## Durable Event Append And Lock Strategy

## Temp Directory Cleanup Plan

## Reconciliation And Crash Recovery Plan

## Acceptance Test Plan

## Implementation Task Decomposition

## Blockers And Open Questions

## Verification

## Inline Report Summary
```

- [ ] **Step 3: Fill scope and non-goals**

Include exactly these non-goals unless codebase inspection proves one is impossible to avoid:

```markdown
- No runtime code changes in this planning gate.
- No test changes in this planning gate.
- No real process cleanup or signal sending.
- No Ghostty launch.
- No dogfood.
- No commit.
- No full v0.6 kernel implementation.
- No terminal session, worktree, branch, port, container, test-server, or artifact cleanup.
```

---

### Task 2: Inspect Existing Runtime Surfaces Read-Only

**Files:**
- Read: `packages/pi-topology/src`
- Read: `packages/pi-topology/test`
- Read: `packages/pi-topology/package.json`
- Modify: only `records/2026-06-26-foundation-0-first-slice-planning-gate.md`

**Interfaces:**
- Consumes: existing runtime module layout and test layout.
- Produces: report sections `Runtime Implementation Plan` and `Implementation Task Decomposition`.

- [ ] **Step 1: List relevant files**

Run:

```bash
rg --files packages/pi-topology/src packages/pi-topology/test packages/pi-topology/tests packages/pi-topology/scripts 2>/dev/null
```

Expected: list of runtime, tests, and scripts. If a path does not exist, record that fact in `Verification`; do not fail the task.

- [ ] **Step 2: Locate mission runtime and event code**

Run:

```bash
rg "runtime-events|mission-registry|active-mission|resolveActiveMissionPaths|topology_spawn_role|topology_init_mission|sessions.jsonl|packet-ledger" packages/pi-topology -n
```

Expected: locations of existing mission storage, spawn, and event helpers.

- [ ] **Step 3: Locate cleanup or process-related code**

Run:

```bash
rg "cleanup|kill|SIGTERM|SIGKILL|pid|pgid|process|tmp|temp|run_root|Ghostty|open -n|spawn" packages/pi-topology -n
```

Expected: current process/temp/launcher surfaces.

- [ ] **Step 4: Record read-only findings**

In the report, add a concise table:

```markdown
| Area | Existing file(s) | Relevance | Risk |
|---|---|---|---|
| Mission paths | ... | ... | ... |
| Event append | ... | ... | ... |
| Launch/spawn | ... | ... | ... |
| Tests | ... | ... | ... |
```

Do not edit any source or test file.

---

### Task 3: Produce Machine-Checkable Schema Plan

**Files:**
- Modify: `records/2026-06-26-foundation-0-first-slice-planning-gate.md`
- Read-only reference: docs 19 and 20.

**Interfaces:**
- Consumes: schema requirements from doc 20 sections 3-15.
- Produces: `Schema Inventory` and `Object Model Plan`.

- [ ] **Step 1: Choose schema implementation location**

Recommend exact files for a future implementation. Use existing repo conventions if inspection finds a better location. If no strong local pattern exists, recommend:

```text
packages/pi-topology/src/extension/topology/foundation0/schema.ts
packages/pi-topology/src/extension/topology/foundation0/validation.ts
packages/pi-topology/src/extension/topology/foundation0/ids.ts
```

Record why these files are proposed and what each owns.

- [ ] **Step 2: Inventory required schema objects**

The report must list all required first-slice schema objects:

```text
Principal
Mission
Actor
RootAuthorization
DelegatedAuthorization
ActionRequest
ActionAttempt
PolicyDecision
InitialOutcome
ReconciliationObservation
ReconciliationResolution
Event
ManagedResource
ProcessIdentity
ProcessCleanupPolicy
TempDirectoryIdentity
TempDirectoryMarker
TempDirectoryCleanupPolicy
Evidence
OwnerDecision
CloseoutRecord
```

For each object, include:

```markdown
| Object | Discriminant | Required fields | Nullable fields | Validation notes |
|---|---|---|---|---|
```

- [ ] **Step 3: Specify ID/digest/timestamp validation**

Include exact validation rules from doc 20:

```text
ID pattern: ^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$
Digest pattern: sha256:<lowercase-hex>
Timestamp: ISO-8601 UTC with millisecond precision unless OS raw timestamp field is explicitly defined
```

- [ ] **Step 4: Specify discriminated unions**

The report must explicitly plan discriminated unions for:

```text
Authorization = RootAuthorization | DelegatedAuthorization
ActionRequest = RegisterResourceAction | CreateManagedResourceAction | TerminateResourceAction | ReconcileResourceAction | CloseMissionAction
Event = first-slice event catalog discriminated by event_type
ManagedResource = planned/observed process/temp resource variants
InitialOutcome = action-specific outcome variants
```

---

### Task 4: Plan Runtime Algorithms

**Files:**
- Modify: `records/2026-06-26-foundation-0-first-slice-planning-gate.md`

**Interfaces:**
- Consumes: docs 19/20 runtime requirements.
- Produces: algorithm sections for event append, process cleanup, temp cleanup, reconciliation, and closeout.

- [ ] **Step 1: Durable event append strategy**

Report a concrete strategy for:

```text
Mission event lock
sequence allocation under lock
payload durable-write-before-event
event durable commit before external effect
partial JSONL tail recovery
projection rebuild or append strategy
```

Include whether implementation should use existing file helpers or add new helpers.

- [ ] **Step 2: macOS process identity probe plan**

Report exact candidate probes for:

```text
pid existence
pgid
raw process start time
ancestor process list
process group membership
executable
argv
cwd
```

If any probe is uncertain, mark it as blocker/open question. Do not run destructive commands.

- [ ] **Step 3: process cleanup algorithm plan**

Specify future implementation algorithm:

```text
pre-register planned process resource
create process or adopt registered process only under capability
record observed identity
before each signal: recheck identity, authorization, Mission phase, CLI protection
SIGTERM under execution decision
grace period
new policy evaluation before SIGKILL
record InitialOutcome
enter reconciliation on indeterminate
```

- [ ] **Step 4: temp directory cleanup algorithm plan**

Specify future implementation algorithm:

```text
pre-register planned temp resource
create directory and marker
identity_core digest excludes marker_digest
trusted approved-temp-root registry
deterministic quarantine_path from resource_id + action_attempt_id
durably bind quarantine_path into action payload/effect_fingerprint before rename
rename under approved root
lstat quarantine path and compare device/inode
re-verify marker digest
delete without following symlinks
record current_locator if delete fails
```

- [ ] **Step 5: closeout algorithm plan**

Specify future implementation algorithm:

```text
lock: closeout_started + mission closing
release lock for cleanup/reconciliation
reacquire lock
rebuild events to latest sequence N
verify all resources cleaned+verified or abandoned+verified-never-created
append closeout_recorded + mission closed in same critical section
durable commit
```

---

### Task 5: Produce Acceptance Test Plan

**Files:**
- Modify: `records/2026-06-26-foundation-0-first-slice-planning-gate.md`

**Interfaces:**
- Consumes: acceptance tests 1-32 from docs 19 and 20.
- Produces: `Acceptance Test Plan`.

- [ ] **Step 1: Create test coverage table**

Create a table with all 32 tests:

```markdown
| # | Contract behavior | Proposed test file | Test style | Real side effects? | Notes |
|---|---|---|---|---|---|
```

Test style must be one of:

```text
unit
integration-with-fakes
fault-injection
manual/smoke-deferred
```

- [ ] **Step 2: Require no real broad signals**

State that process cleanup tests must use injected process inspector/killer abstractions by default. Real signal tests, if any, require a later explicit owner-approved smoke plan.

- [ ] **Step 3: Identify minimal implementation checkpoints**

Group tests into checkpoints:

```text
Checkpoint A: schema and validation
Checkpoint B: canonical event append and idempotency
Checkpoint C: resource lifecycle and pre-registration
Checkpoint D: process cleanup safety with fakes
Checkpoint E: temp cleanup safety with sandboxed temp dirs
Checkpoint F: reconciliation and closeout
```

---

### Task 6: Decompose Future Implementation Without Coding

**Files:**
- Modify: `records/2026-06-26-foundation-0-first-slice-planning-gate.md`

**Interfaces:**
- Consumes: all prior report sections.
- Produces: `Implementation Task Decomposition`, `Blockers And Open Questions`, `Verification`, `Inline Report Summary`.

- [ ] **Step 1: Propose implementation tasks**

List future implementation tasks. Each task must include:

```markdown
### Future Task N: <name>

Files:
- Create:
- Modify:
- Test:

Goal:

Review gate:

Verification:
```

Do not write code.

- [ ] **Step 2: Identify blockers**

Blockers must distinguish:

```text
contract blocker
codebase discovery blocker
platform probe blocker
test safety blocker
none
```

- [ ] **Step 3: Verification**

Run only read-only/safe checks:

```bash
git status --short
rg "T[O]DO|T[B]D|F[I]XME" records/2026-06-26-foundation-0-first-slice-planning-gate.md
```

Expected:

```text
git status shows only expected docs/records changes
rg finds no placeholder markers in the report
```

- [ ] **Step 4: Final inline report**

Return only:

```text
REPORT planning-gate
decision: ready_for_codex_review | blocked
artifact: records/2026-06-26-foundation-0-first-slice-planning-gate.md
findings: <count>
blockers: <count>
next: <one sentence>
```

No long inline report. The artifact is the full report.

---

## Reviewer Notes For Codex

Codex should review Pi's report before any implementation is authorized.

Review questions:

1. Does Pi preserve the first-slice boundary and avoid runtime code changes?
2. Are schema object locations and validation semantics concrete enough?
3. Are macOS process probes feasible and non-destructive?
4. Does the event append plan include durable commit before external effects?
5. Does the temp cleanup plan avoid digest cycles and quarantine orphaning?
6. Are all 32 tests mapped to concrete future test styles?
7. Are blockers explicit rather than hidden in vague implementation notes?
