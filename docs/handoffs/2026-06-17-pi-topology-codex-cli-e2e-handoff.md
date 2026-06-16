# Pi Topology Codex CLI E2E Handoff

Date: 2026-06-17
Project: OMP topology network / `packages/pi-topology`
Owner goal: use Codex CLI to run a higher-fidelity local Pi/Ghostty E2E test and then repair only evidence-backed issues.

## 0. Why this handoff exists

Codex Desktop can inspect code, run unit tests, edit files, and read local evidence well. It is not ideal for true end-to-end validation of this plugin because the real path depends on Pi CLI, Ghostty/TUI sessions, installed package state, spawned interactive sessions, and runtime logs outside a single controlled process.

Codex CLI is a better runner for this specific E2E job because it can sit directly in the terminal workflow, run long shell sessions, inspect generated JSONL/logs, and iterate on local command evidence with less screenshot-driven human mediation.

This handoff is intentionally narrow: do not turn this into a redesign pass until the black-box E2E evidence says exactly what is broken.

## 1. Current known-good baseline

Local git history already tracks the current stabilization work. Start by confirming:

```bash
cd /Users/yuantian/Documents/Coding/omp-topology-network
git status --short
git log --oneline -5
```

Expected recent commits include:

```text
98e0a7a fix(pi-topology): lock spawned role model defaults
e14140a fix(pi-topology): isolate missions and compact inbox reads
4a7e57a fix: compact topology status output
0c7d2b3 test: align topology skill frontmatter
1205b9f chore: establish topology network baseline
```

If the worktree is dirty, inspect first. Do not revert user changes.

## 2. Bugs already fixed in the current branch

The CLI run must treat these as regression targets:

1. Spawned role model defaults are locked to:
   - provider: `minimax-cn`
   - model: `MiniMax-M3`
   - thinking: `low`
2. `topology_spawn_role` must not accept or honor caller-supplied `provider`, `model`, or `thinking` overrides.
3. `topology_spawn_role(mode=print)` must visibly report the resolved provider/model/thinking before launch.
4. `topology_list`, `topology_get`, and `topology_await` must default to current mission only; historical packets require `include_history: true`.
5. `topology_read_artifact` must default to compact preview; full content requires `full: true`.
6. `PI_TOPOLOGY_MISSION_CARD` must not let a temp/test process overwrite another workspace mission card.
7. The default launch set is Supervisor then HQ. Runner/scott/oracle/librarian are mission-gated; repair requires explicit scoped owner approval.

## 3. Known remaining suspect areas

These are the next repair candidates, but validate them before editing:

1. `topology_get` / `topology_list` de-noising:
   - Repeated reads should not create repeated runtime noise or encourage polling loops.
   - Default output should stay compact.
2. Cold restart vs resume:
   - A restarted Supervisor/HQ must clearly separate live worker evidence from stale/historical ACKs or REPORTs.
   - It must not silently reuse old worker evidence as current evidence.
3. Inbox cleanup:
   - Historical packets from earlier missions should not inflate current dashboard/inbox counts.
   - Pending stale packets should be markable/ignorable without deleting evidence.
4. Shell guard false positives:
   - Read-only shell commands with stderr redirects such as `2>/dev/null` are currently blocked as "cannot write through shell commands".
   - This is safe but noisy. Decide whether to relax only benign read redirects or update prompts/tools to avoid shell entirely.
5. Multi mission card selection:
   - Current single `.pi/topology/mission-card.json` flow causes ambiguity after multiple dogfood missions.
   - Consider a Supervisor-stage mission picker or `missions/` registry, but do not implement until the current E2E evidence confirms the shape.

## 4. E2E test lanes

Use a fresh run root so the current repo mission state is not polluted:

```bash
export REPO=/Users/yuantian/Documents/Coding/omp-topology-network
export RUN_ROOT=/tmp/pi-topology-cli-e2e-$(date +%Y%m%d-%H%M%S)
export PI_TOPOLOGY_RUN_ROOT="$RUN_ROOT"
export PI_PROVIDER=minimax-cn
export PI_MODEL=MiniMax-M3
export PI_THINKING=low
cd "$REPO"
```

### Lane A: deterministic local regression

```bash
cd "$REPO/packages/pi-topology"
npm run smoke
```

Record the result. If it fails, stop and fix the unit/type/pack failure first.

### Lane B: package install visibility

```bash
pi list
```

Expected: an installed local package entry pointing at:

```text
/Users/yuantian/Documents/Coding/omp-topology-network/packages/pi-topology
```

If not installed or stale, ask owner before reinstalling.

### Lane C: script/prompt sanity before real launch

Inspect:

```bash
sed -n '1,140p' "$REPO/packages/pi-topology/scripts/ghostty-supervisor-smoke.sh"
sed -n '1,140p' "$REPO/packages/pi-topology/scripts/ghostty-role-smoke.sh"
```

Flag any prompt that still tells the model to pass provider/model/thinking into `topology_spawn_role`. The tool should ignore such parameters now, but the prompt should no longer teach that behavior.

### Lane D: Supervisor print-mode launch plan

Run a print-only smoke first:

```bash
SPAWN_MODE=print "$REPO/packages/pi-topology/scripts/ghostty-supervisor-smoke.sh"
```

Inspect generated files under `$RUN_ROOT`, especially:

```text
$RUN_ROOT/workdir/.pi/topology/mission-card.json
$RUN_ROOT/workdir/.pi/topology/status-board.json
$RUN_ROOT/workdir/.pi/topology/runtime-events.jsonl
$RUN_ROOT/workdir/.pi/topology/sessions.jsonl
$RUN_ROOT/workdir/.pi/topology/launch/hq.sh
```

Acceptance:

- `hq.sh` contains MiniMax lock only: `--provider minimax-cn --model MiniMax-M3 --thinking low`.
- No `anthropic`, `claude`, `sonnet`, or caller-injected model appears in launch scripts or new session ledger rows.
- `mode=print` does not launch HQ.

### Lane E: real HQ launch

Only after Lane D passes:

```bash
SPAWN_MODE=launch "$REPO/packages/pi-topology/scripts/ghostty-supervisor-smoke.sh"
```

Then inspect:

```bash
find "$RUN_ROOT" -maxdepth 5 -type f | sort
tail -n 80 "$RUN_ROOT/workdir/.pi/topology/runtime-events.jsonl"
tail -n 80 "$RUN_ROOT/workdir/.pi/topology/sessions.jsonl"
tail -n 80 "$RUN_ROOT/logs/supervisor-smoke.log"
tail -n 120 "$RUN_ROOT/logs/hq-spawned.log"
```

Acceptance:

- Supervisor starts on MiniMax.
- Spawned HQ starts on MiniMax.
- Session ledger has `launch_requested` and `alive_confirmed` for HQ.
- Status board marks HQ alive.
- Dashboard status does not show historical missions as current pending work.
- HQ does not spawn oracle/librarian/repair before evidence and owner gate.

### Lane F: queue/read idempotency probe

If a real HQ is live, ask it for one compact status and then stop. Do not make it poll.

Evidence to inspect:

```bash
grep -n '"packet_received"' "$RUN_ROOT/workdir/.pi/topology/runtime-events.jsonl" || true
grep -n '"topology_get"' "$RUN_ROOT/workdir/.pi/topology/runtime-events.jsonl" || true
```

If repeated `topology_get` on the same packet creates repeated durable receive events, record it as a bug. A read tool may return the same packet again, but it should not make the audit stream look like new transport activity every time.

## 5. Repair rules

After the E2E evidence is collected, repair only the smallest failing surfaces.

Priority order:

1. Remove stale provider/model/thinking prompt instructions from smoke scripts and prompts.
2. De-noise `topology_get` / `topology_list` repeated reads.
3. Add explicit stale-packet cleanup/marking or current-mission inbox count fixes.
4. Clarify cold restart/resume owner gates in prompts/runtime outputs.
5. Only then consider multi mission-card selection.

Do not implement multi mission-card selection as a first move. It is a plausible architecture answer, but it should follow the evidence.

## 6. Required final report

Return a concise report with:

```text
E2E run root:
Commands run:
Pass/fail table:
New logs/artifacts:
Regression checks:
- model lock:
- mission isolation:
- compact packet/artifact output:
- dashboard/inbox current-mission filtering:
- stale packet behavior:
Repairs made:
Tests run after repair:
Remaining risks:
Commit hash, if committed:
```

If code is changed, run:

```bash
cd "$REPO/packages/pi-topology"
npm run smoke
```

Then commit locally with a concise message. Do not push.

## 7. Paste-ready Codex CLI prompt

Use this in Codex CLI:

```text
You are working in /Users/yuantian/Documents/Coding/omp-topology-network.

Read docs/handoffs/2026-06-17-pi-topology-codex-cli-e2e-handoff.md completely, then execute it.

Goal: run a true local Pi/Ghostty E2E validation of packages/pi-topology, collect file/log evidence, and repair only evidence-backed failures. Preserve user changes. Do not push. Do not implement multi mission-card selection unless the E2E evidence makes it unavoidable; record it as a design candidate otherwise.

Start with git status and npm run smoke. Use a fresh PI_TOPOLOGY_RUN_ROOT under /tmp. Validate that spawned roles are locked to minimax-cn / MiniMax-M3 / thinking=low, that current-mission packet filtering works, and that repeated topology_get/list does not produce misleading durable receive noise. Produce the final report requested in section 6 and commit any code/docs fixes locally.
```
