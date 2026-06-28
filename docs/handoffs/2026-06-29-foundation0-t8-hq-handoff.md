# Foundation-0 T8 HQ Handoff

Date: 2026-06-29
Project: Pi topology network / `packages/pi-topology`
Audience: New HQ Codex session
Prepared by: Previous HQ/Codex
Status: handoff after T8 commit/push; before T9 planning

## Executive Summary

Foundation-0 has progressed from schema/event foundations into the first safe effect boundary.

Latest pushed commit:

```text
bfa5262 feat(pi-topology): add foundation0 temp verification
```

Remote:

```text
origin/main -> bfa5262
https://github.com/TimYuann/Pi-topology-network
```

The current Foundation-0 line can:

- validate first-slice schema contracts;
- append canonical, digest-bound, mission-locked Foundation-0 events;
- model managed resource lifecycle and pre-registration;
- inspect host processes read-only;
- harden pre-effect boundaries;
- acquire durable cleanup attempts without performing cleanup;
- create one approved managed temp directory with marker and identity;
- verify/replay that temp directory non-destructively;
- record `reconciliation_required` for unsafe temp-resource states.

It cannot yet:

- launch or manage Pi topology / Ghostty / dogfood sessions;
- integrate Foundation-0 into the v0.5 runtime path;
- quarantine, delete, recursively clean, rename, or repair managed temp directories;
- perform owner-facing cleanup UX;
- be treated as an end-user runnable plugin workflow.

## Human Testing Readiness

This is ready for **developer/manual API-level testing** of Foundation-0 primitives, not for general end-user plugin testing.

Good manual tests now:

- create a test-owned mission directory;
- create an approved temp root under a throwaway temp directory;
- call the T7 temp-directory creation API;
- inspect the Foundation-0 event log and payload files;
- call the T8 verification API;
- intentionally corrupt marker/payload/log states in throwaway fixtures and confirm conservative classifications;
- confirm no real process spawn, signal, delete, quarantine, or managed-temp cleanup occurs.

Not ready yet:

- using this as an actual daily Pi topology cleanup tool;
- pointing it at real project temp roots expecting cleanup;
- relying on it to close Ghostty, Pi, OMP, or Codex sessions;
- letting it delete or quarantine files;
- dogfooding through the v0.5 runtime.

Plain-language verdict: the Foundation-0 safety ledger is now strong enough for controlled engineering smoke tests, but the product is still in "safe substrate" mode rather than "human-facing cleanup feature" mode.

## Workflow Agreement

Current working model:

```text
Owner/User -> HQ Codex -> OMP/Coder -> Reviewer -> HQ Codex -> commit/push/next plan
```

Known thread ids:

```text
Coder / OMP handoff thread: 019f0288-3fde-7b30-97c0-a7e5611e50a3
Reviewer thread:          019f0289-736e-7372-a240-d2ac2303d626
Writer / planning helper: 019f02de-88ca-7270-ae56-ced5ffd34087
```

Owner clarified during T8:

- HQ should produce task cards for OMP rather than directly implementing substantial tasks in the HQ thread.
- OMP/Coder implements.
- Reviewer sends conclusions back to HQ.
- HQ verifies, commits, pushes, and decides the next task.

## Current Repo State

Repo path:

```text
/Users/yuantian/Documents/Coding/Pi-topology-network
```

The Codex desktop sandbox may still show a different writable project root. Reads generally work, but edits/git operations against this repo may require escalation.

Expected clean tracked state:

```text
## main...origin/main
```

Known deferred untracked files at handoff time:

```text
docs/2026-06-28-side-review-b-aionui-cli-adapter.md
docs/2026-06-28-side-review-hermes-aionui-comparative.md
docs/handoffs/2026-06-28-foundation0-t5-hq-handoff.md
docs/superpowers/plans/2026-06-26-ghostty-single-instance-launch-research.md
records/2026-06-26-ghostty-single-instance-launch-research.md
```

Do not delete these. Prior docs audit recommendation:

- keep Hermes/AionUi side reviews pending owner/HQ decision;
- keep the old T5 handoff untracked or update/mark it historical before committing;
- commit Ghostty launch research later as its own topic-specific docs commit, not with Foundation-0 source work.

## Recent Commit Sequence

Key latest commits:

```text
bfa5262 feat(pi-topology): add foundation0 temp verification
5503f77 docs(pi-topology): plan foundation0 temp verification
cd17d40 test(pi-topology): cover unsupported temp identity replay
7e95a48 feat(pi-topology): add foundation0 temp directory creation
5322727 docs(pi-topology): plan foundation0 temp directory creation
2b3eb85 docs(pi-topology): add v0.6 architecture provenance
4c799b4 feat(pi-topology): add foundation0 cleanup acquisition
5244c02 feat(pi-topology): harden foundation0 before effects
```

The GitHub repository was initialized during this HQ run and `main` was pushed.

## Completed Foundation-0 Work

### T1/T1.1 Schema Contract

Established Foundation-0 IDs, digests, timestamps, canonical JSON helpers, schema object families, validators, authorization typing, action outcome validation, and managed-resource validation.

### T2 Event Lock + Canonical Append

Added mission-scoped event locking, content-addressed payloads, digest-bound event append, deterministic idempotency, fsync ordering, and partial/orphan payload handling.

### T3 Resource Lifecycle

Added managed-resource lifecycle transitions, pre-registration sidecar, `abandoned` terminal branch, and cleanup-attempt coordination primitives.

### T4 Read-Only Process Inspector

Added read-only host process inspection and protection facts for current CLI PID, ancestors, and process group. No process signals or process effects.

### T5 Before-Effects Hardening

Hardened first-slice behavior before effectful work. Commit:

```text
5244c02 feat(pi-topology): harden foundation0 before effects
```

### T6 Durable Cleanup-Attempt Acquisition

Commit:

```text
4c799b4 feat(pi-topology): add foundation0 cleanup acquisition
```

Implemented durable acquisition of cleanup attempts without cleanup execution:

- deterministic stale-lock clock injection;
- cleanup-attempt payload types and validators;
- durable acquisition core;
- active cleanup-attempt replay;
- crash-before-pending conservative reconciliation;
- ID-safe bounded lock IDs;
- partial event log and payload error mapping.

Important boundary: T6 does not delete, quarantine, signal, spawn, or clean anything.

### T7 Temp Directory Creation + Identity Marker

Plan commit:

```text
5322727 docs(pi-topology): plan foundation0 temp directory creation
```

Implementation commit:

```text
7e95a48 feat(pi-topology): add foundation0 temp directory creation
```

Follow-up coverage commit:

```text
cd17d40 test(pi-topology): cover unsupported temp identity replay
```

Implemented the first effectful Foundation-0 resource operation:

- explicit approved-temp-root registry;
- deterministic directory basename from durable creation payload;
- pre-effect events before `mkdir`;
- exclusive creation of one managed temp directory;
- `.pi-topology-resource.json` marker;
- non-circular `TempDirectoryIdentity`;
- lifecycle events through planned, registered, active, initial outcome;
- crash recovery around marker and identity;
- conservative reconciliation states for unsafe partial states.

Important boundary: no cleanup, no quarantine, no managed temp directory delete/rename, no spawn, no Ghostty/Pi topology integration.

### T8 Temp Directory Verification + Reconciliation

Plan commit:

```text
5503f77 docs(pi-topology): plan foundation0 temp verification
```

Implementation commit:

```text
bfa5262 feat(pi-topology): add foundation0 temp verification
```

Implemented non-destructive verification and reconciliation signaling for T7 resources:

- `readTempDirectoryResourceProjection(missionDir, resourceId)`
- `verifyManagedTempDirectory(input)`
- `recordTempDirectoryReconciliationRequired(input)`

T8 behavior:

- replays canonical events into a temp-resource projection;
- verifies approved root, protected paths, target type, marker, identity, device/inode/owner, digest, and lifecycle state;
- classifies unsafe states without filesystem mutation;
- records `reconciliation_required` only through canonical event append and only for append-safe states;
- refuses to append after `partial_event_log`;
- does not treat non-active lifecycle payloads as `verified_active`;
- treats cwd/repo/mission/Foundation-0 protected ancestors as protected.

T8 review loop:

- initial review returned two P1 findings:
  - non-active lifecycle could verify active;
  - approved-root/cwd ancestor protection was incomplete.
- OMP fixed both.
- Reviewer approved v2.
- HQ reran verification and committed/pushed.

Final HQ verification before commit:

```text
T8 tests: 14/14 pass
T7 temp-directory creation tests: 31/31 pass
Foundation-0 unit tests: 129/129 pass
Full unit + Foundation-0 + integration suite: 507/507 pass
npm run typecheck: pass
git diff --cached --check: clean
```

Forbidden-effect scan at commit time:

- process/spawn/Ghostty scan only hit a pre-existing T7 boundary comment;
- T8 narrow destructive scan only hit cleanup-policy fixture string and test setup `mkdir({ recursive: true })`;
- no T8 runtime delete/rename/quarantine/spawn/signal path.

## Important Plan And Report Files

Recent plans:

```text
docs/superpowers/plans/2026-06-28-foundation-0-t6-durable-cleanup-attempt-acquisition.md
docs/superpowers/plans/2026-06-28-foundation-0-t7-temp-directory-creation-identity-marker.md
docs/superpowers/plans/2026-06-28-foundation-0-t8-temp-directory-verification-reconciliation.md
```

Recent reports:

```text
records/2026-06-28-foundation-0-t6-durable-cleanup-attempt-acquisition.md
records/2026-06-28-foundation-0-t7-temp-directory-creation-identity-marker.md
records/2026-06-28-foundation-0-t8-temp-directory-verification-reconciliation.md
```

Architecture docs:

```text
docs/18-pi-topology-v0.6-collaboration-kernel-freeze-draft.md
docs/19-pi-topology-v0.6-foundation-0-first-slice-contract.md
docs/20-pi-topology-v0.6-foundation-0-first-slice-contract-closure.md
```

Doc 20 supersedes conflicting first-slice semantics from doc 19 where applicable.

## Current Capability Boundary

Foundation-0 is now a durable, auditable substrate for resource accounting. It is not yet a user-facing cleanup system.

Safe capabilities:

- event-log replay;
- payload digest verification;
- lock-protected append;
- read-only process inspection;
- durable cleanup-attempt acquisition;
- approved temp directory creation in test-owned roots;
- temp directory marker/identity verification;
- reconciliation-required event recording for unsafe states.

Unsafe/not implemented:

- actual cleanup;
- quarantine;
- recursive delete;
- managed temp directory rename;
- process kill/signal/probe effects;
- Ghostty launch/close;
- Pi topology spawn;
- v0.5 runtime integration;
- production owner-facing UX.

## Recommended Next Step

Do not jump straight into recursive delete.

Recommended T9:

```text
Foundation-0 T9 Temp-Directory Quarantine Preflight / Intent
```

Suggested T9 scope:

- no actual quarantine execution yet;
- no recursive delete;
- model deterministic quarantine intent payloads;
- verify T8 preflight result immediately before intent recording;
- record policy decision and intended quarantine target under a safe root;
- prove that a later destructive task would have enough durable evidence to act.

Alternative if owner wants a pause before higher-risk work:

- prepare an external review brief for Foundation-0 T6-T8;
- ask whether the sequence is safe to proceed toward quarantine preflight;
- resolve deferred docs/untracked artifact grouping.

## New HQ Startup Checklist

1. Read this handoff.
2. Run:

   ```bash
   cd /Users/yuantian/Documents/Coding/Pi-topology-network
   git status --short --branch
   git log --oneline --decorate -8
   ```

3. Confirm `main...origin/main` points to `bfa5262`.
4. Check that only the known deferred docs are untracked.
5. Decide whether to:
   - write T9 plan/task card;
   - run an external review brief for T6-T8;
   - cleanly commit/defer the remaining untracked docs.
6. If dispatching work, produce an OMP task card. Do not implement substantial T9 source directly in HQ.
7. Reviewer should review before any HQ commit.

## Commands Useful For Verification

From `packages/pi-topology`:

```bash
node --experimental-strip-types --test test/unit/foundation0/temp-directory-verification.test.ts
node --experimental-strip-types --test test/unit/foundation0/temp-directory-creation.test.ts
node --experimental-strip-types --test test/unit/foundation0/*.test.ts
node --experimental-strip-types --test test/unit/*.test.ts test/unit/foundation0/*.test.ts test/integration/foundation0/*.test.ts
npm run typecheck
```

From repo root:

```bash
rg -n "process\\.kill|\\bkill\\b|\\bpkill\\b|\\bkillall\\b|topology_spawn_role|Ghostty|spawn\\(|process\\.spawn|child_process\\.spawn" packages/pi-topology/src/runtime/foundation0 packages/pi-topology/test/unit/foundation0
rg -n "\\brm\\(|\\brmdir\\(|\\bunlink\\(|recursive|quarantine|rename\\(" packages/pi-topology/src/runtime/foundation0/temp-directory-verification.ts packages/pi-topology/test/unit/foundation0/temp-directory-verification.test.ts
git diff --check
```

Expected scan notes:

- broad process scan may hit the T7 boundary comment mentioning Ghostty;
- T8 narrow destructive scan may hit test fixture strings and test setup only;
- any new runtime delete/rename/quarantine/spawn/signal match should block progress.

## Final Notes

The project is in a much stronger place than at T5: it has crossed the first effect boundary and then added a non-destructive verifier before cleanup. That is the right shape for this kind of runtime safety work.

The next HQ should preserve the discipline that made T6-T8 survivable:

- small task slices;
- written plan before implementation;
- OMP/Coder implementation, not HQ improvisation;
- Reviewer approval before HQ commit;
- fresh HQ verification before push;
- no destructive filesystem/process effects until the contract and preflight evidence are stronger.
