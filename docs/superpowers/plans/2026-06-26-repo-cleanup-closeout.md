# Repository Cleanup Closeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cleanly close the current working tree after the Pi topology rename and v0.5.1.5 final review gate, without changing v0.5.1.5 runtime behavior.

**Architecture:** This is a cleanup and records slice. The worker must classify the dirty tree into housekeeping rename changes, generated evidence changes, process docs, and optional gate records; then either preserve or revert each class with explicit evidence. Product runtime code must not be refactored in this task.

**Tech Stack:** Git, Markdown records/docs, existing `packages/pi-topology` npm verification scripts.

## Global Constraints

- Repository path: `/Users/yuantian/Documents/Coding/Pi-topology-network`.
- Do not push.
- Do not publish.
- Do not run real Ghostty launch.
- Do not mutate `ekunCustomsWms`.
- Do not change `packages/pi-topology` runtime behavior.
- Preserve user/Codex rename work unless the diff is clearly an accidental generated artifact.
- Treat `ad0bd5b` v0.5.1.5 as already approved by Codex gate; do not re-open runtime alignment unless a new blocking fact is discovered.
- If you commit, make one cleanup commit only, with a message in the form `docs(pi-topology): close rename and review housekeeping`.

---

## Files And Responsibilities

- Inspect all dirty files with `git status --short`.
- Review rename housekeeping changes across root docs, templates, scripts, package docs/prompts, and `AGENTS.md`.
- Decide whether `records/2026-06-17-pi-topology-dogfood-run-smoke.md` is intentional evidence or generated verification noise.
- Keep `docs/superpowers/plans/2026-06-26-v0-5-1-5-final-review.md` as the first Codex-to-Pi plan-doc task.
- Create `records/2026-06-26-pi-topology-v0-5-1-5-codex-gate.md` if it does not already exist.

### Task 1: Classify Dirty Tree

**Files:**
- Inspect: all files returned by `git status --short`.

**Interfaces:**
- Consumes: current working tree.
- Produces: a classification list in the final report.

- [ ] **Step 1: Capture current status**

Run:

```bash
cd /Users/yuantian/Documents/Coding/Pi-topology-network
git status --short --branch
git diff --stat
```

Expected:

```text
Dirty tree contains rename housekeeping, the new final-review plan doc, possibly dogfood evidence, and possibly the final-review handoff file.
```

- [ ] **Step 2: Classify files**

Use these buckets:

```text
Bucket A - rename housekeeping: OMP -> Pi naming/path changes in docs, templates, scripts, prompts, package docs, and tests that only update project display/name literals.
Bucket B - process docs: docs/superpowers/plans/2026-06-26-v0-5-1-5-final-review.md and any Codex/Pi workflow docs created today.
Bucket C - gate record: records/2026-06-26-pi-topology-v0-5-1-5-codex-gate.md if created.
Bucket D - generated evidence: records/2026-06-17-pi-topology-dogfood-run-smoke.md.
Bucket E - unexpected runtime changes: any changes under packages/pi-topology/src that are not pure string/path rename housekeeping.
```

If Bucket E is non-empty, stop and report `hold`.

### Task 2: Review Rename Housekeeping

**Files:**
- Inspect: `AGENTS.md`
- Inspect: `README.md`
- Inspect: `docs/`
- Inspect: `templates/`
- Inspect: `scripts/`
- Inspect: `packages/pi-topology/README.md`
- Inspect: `packages/pi-topology/docs/`
- Inspect: `packages/pi-topology/agents/`
- Inspect: `packages/pi-topology/skills/topology-runtime/SKILL.md`
- Inspect: `packages/pi-topology/test/unit/mission.test.ts`

**Interfaces:**
- Consumes: Bucket A.
- Produces: approve/hold judgment for rename housekeeping.

- [ ] **Step 1: Search active surface for stale old project name**

Run:

```bash
cd /Users/yuantian/Documents/Coding/Pi-topology-network
rg -n "OMP拓扑网络|OMP 拓扑网络|OMP topology network|omp-topology-network|/Users/yuantian/Documents/Coding/omp-topology-network|\\.pi/agents/omp-topology-network|/tmp/omp-topology" AGENTS.md README.md docs templates scripts packages sources/README.md sources/pi-harness/README.md
```

Expected:

```text
No matches in active surface. Matches in records/ may remain historical and should not block.
```

- [ ] **Step 2: Search active surface for new project name**

Run:

```bash
cd /Users/yuantian/Documents/Coding/Pi-topology-network
rg -n "Pi拓扑网络|Pi-topology-network|pi-topology-network|pi-topology" AGENTS.md README.md docs templates scripts packages sources/README.md sources/pi-harness/README.md
```

Expected:

```text
Active docs and package docs consistently refer to Pi拓扑网络 and /Users/yuantian/Documents/Coding/Pi-topology-network where project paths are literal.
```

- [ ] **Step 3: Ensure no historical records were mass-edited except intentional current evidence**

Run:

```bash
cd /Users/yuantian/Documents/Coding/Pi-topology-network
git diff --name-only -- records
```

Expected:

```text
Only records/2026-06-17-pi-topology-dogfood-run-smoke.md and/or today's new records are dirty. Historical records should not be mass-renamed.
```

### Task 3: Decide Dogfood Evidence File

**Files:**
- Inspect: `records/2026-06-17-pi-topology-dogfood-run-smoke.md`

**Interfaces:**
- Consumes: Bucket D.
- Produces: either restored file or explicit evidence-change rationale.

- [ ] **Step 1: Inspect dogfood evidence diff**

Run:

```bash
cd /Users/yuantian/Documents/Coding/Pi-topology-network
git diff -- records/2026-06-17-pi-topology-dogfood-run-smoke.md
```

Expected:

```text
Diff is either generated verification refresh or a deliberate evidence update.
```

- [ ] **Step 2: Apply decision rule**

Use this rule:

```text
If the diff only reflects generated test/smoke timestamps, transient logs, or machine-local verification output, restore it and do not commit it.
If the diff records a meaningful new accepted evidence fact from today's final review, keep it and explain why in the final report.
```

If restoring, run:

```bash
cd /Users/yuantian/Documents/Coding/Pi-topology-network
git restore -- records/2026-06-17-pi-topology-dogfood-run-smoke.md
```

Expected:

```text
The file is no longer dirty unless intentionally kept as evidence.
```

### Task 4: Add Codex Gate Record

**Files:**
- Create: `records/2026-06-26-pi-topology-v0-5-1-5-codex-gate.md`

**Interfaces:**
- Consumes: delegate review result and Codex review-of-review.
- Produces: durable gate record.

- [ ] **Step 1: Create the gate record if absent**

Write exactly this content, adjusting only if the file already exists:

```markdown
# v0.5.1.5 Codex Gate

date: 2026-06-26
project: Pi拓扑网络 / `packages/pi-topology`
gate_owner: Codex
delegate_reviewer: Pi session
scope: v0.5.1.5 final review after `ad0bd5b`
decision: approve

---

## Summary

Codex accepts the delegated v0.5.1.5 final review. No blocking findings were reported. The v0.5.1.5 runtime alignment work at `ad0bd5b fix(pi-topology): v0.5.1.5 runtime alignment tail (P1 + P2 + P3)` is approved for the next release/readiness decision.

## Verification

- `npm test`: pass, 324/324
- `npm run test:integration`: pass, 2/2 after clean sequential run
- `npm run dogfood`: pass, 1/1 when run alone
- `npm run smoke`: pass, including typecheck and `npm pack --dry-run`

## Accepted Residual

The known non-blocking P3 residual remains: when the current session is not Supervisor, `/topology spawn hq` guidance may still point to the root `.pi/topology/launch/topology-supervisor.sh` fallback.

This does not block v0.5.1.5 because the supported clean-init flow promotes the current session to Supervisor, the active Supervisor spawn path writes per-mission launch scripts/env, and the regression is covered by `extension.test.ts` test 73.

## Notes

- Current OMP-to-Pi rename/documentation cleanup was treated as out-of-scope for v0.5.1.5 runtime review.
- A first integration run may fail if the fixed dogfood temp root is held by stale state from a prior run. Clean sequential integration and dogfood runs passed and are the accepted evidence.
```

- [ ] **Step 2: Verify gate record is present**

Run:

```bash
cd /Users/yuantian/Documents/Coding/Pi-topology-network
sed -n '1,220p' records/2026-06-26-pi-topology-v0-5-1-5-codex-gate.md
```

Expected:

```text
Gate record exists and says decision: approve.
```

### Task 5: Run Cleanup Verification

**Files:**
- Use: `packages/pi-topology/package.json`

**Interfaces:**
- Consumes: cleaned working tree.
- Produces: verification evidence for cleanup commit.

- [ ] **Step 1: Run active package verification**

Run:

```bash
cd /Users/yuantian/Documents/Coding/Pi-topology-network/packages/pi-topology
npm_config_cache=/tmp/pi-topology-npm-cache npm test
npm_config_cache=/tmp/pi-topology-npm-cache npm run typecheck
```

Expected:

```text
npm test passes 324/324.
typecheck prints strip-types import ok.
```

- [ ] **Step 2: Re-check active old-name search**

Run:

```bash
cd /Users/yuantian/Documents/Coding/Pi-topology-network
rg -n "OMP拓扑网络|OMP 拓扑网络|OMP topology network|omp-topology-network|/Users/yuantian/Documents/Coding/omp-topology-network|\\.pi/agents/omp-topology-network|/tmp/omp-topology" AGENTS.md README.md docs templates scripts packages sources/README.md sources/pi-harness/README.md
```

Expected:

```text
No matches.
```

### Task 6: Commit Or Report Ready-To-Commit

**Files:**
- Stage only files approved by Tasks 1-5.

**Interfaces:**
- Consumes: classified and verified cleanup diff.
- Produces: either one local commit or a ready-to-commit report.

- [ ] **Step 1: Review final diff**

Run:

```bash
cd /Users/yuantian/Documents/Coding/Pi-topology-network
git diff --stat
git diff --name-only
```

Expected:

```text
Diff contains rename housekeeping, process plan doc, Codex gate record, and possibly intentionally kept evidence only.
```

- [ ] **Step 2: Stage approved cleanup files**

If committing, run:

```bash
cd /Users/yuantian/Documents/Coding/Pi-topology-network
git add AGENTS.md README.md docs templates scripts sources/README.md sources/pi-harness/README.md packages/pi-topology records/2026-06-26-pi-topology-v0-5-1-5-codex-gate.md
```

Then correct staging by reviewing:

```bash
cd /Users/yuantian/Documents/Coding/Pi-topology-network
git status --short
git diff --cached --name-only
```

If the broad `git add` command stages an unintended file, unstage it with:

```bash
cd /Users/yuantian/Documents/Coding/Pi-topology-network
git restore --staged <path>
```

- [ ] **Step 3: Commit if allowed by owner/Codex**

Run:

```bash
cd /Users/yuantian/Documents/Coding/Pi-topology-network
git commit -m "docs(pi-topology): close rename and review housekeeping"
```

Expected:

```text
One local commit created. No push performed.
```

- [ ] **Step 4: Final report**

Use this format:

```text
Findings:
- No blocking findings.

Cleanup:
- Rename housekeeping: kept/rejected with reason.
- Dogfood evidence: restored/kept with reason.
- Plan doc: kept.
- Codex gate record: created.
- Commit: <hash or "not committed; ready to commit">.

Verification:
- npm test: pass/fail.
- npm run typecheck: pass/fail.
- old-name active search: pass/fail.

Notes:
- No push.
- No publish.
- No real Ghostty launch.
- No runtime behavior changes.
```

## Self-Review

- Spec coverage: This plan covers cleanup items 1, 2, 3, and 4 from Codex's closeout recommendation.
- Placeholder scan: No TBD/TODO/fill-in placeholders are present.
- Type consistency: Paths and command names match the renamed project path and current package scripts.
