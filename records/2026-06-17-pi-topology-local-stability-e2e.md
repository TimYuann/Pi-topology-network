# Pi Topology Local Stability E2E

Date: 2026-06-17
Package: `packages/pi-topology`
Package version: `pi-topology-network@0.1.0`
Pi CLI: `0.79.4`

## Goal

Test and tighten `packages/pi-topology` toward a local state suitable for real project closeout work, using evidence-backed repairs only.

## Baseline

Commands:

- `git status --short`
- `git log --oneline -5`
- `cd packages/pi-topology && npm run smoke`
- `pi list`
- `pi --version`
- `pi --help`

Evidence:

- Latest starting commit included `d1c46e1 fix(pi-topology): denoise packet reads`.
- Worktree was clean at baseline.
- `npm run smoke` passed: 77 tests before this pass, then 80 tests after repairs, plus typecheck and pack dry-run.
- `pi list` showed the installed local package path:
  `/Users/yuantian/Documents/Coding/omp-topology-network/packages/pi-topology`
- Package manifest: `pi-topology-network@0.1.0`.

## Official Pi API Alignment

Official docs checked:

- `https://pi.dev/docs/latest/extensions`
- `https://pi.dev/docs/latest/sdk`
- `https://pi.dev/docs/latest/skills`
- `https://pi.dev/docs/latest/packages`
- `https://pi.dev/docs/latest/settings`

Findings:

- Extension factory shape matches docs: default export receives `ExtensionAPI`, registers tools, commands, flags, and event handlers.
- Long-lived runtime resources are started from `session_start` / role activation, not from the extension factory.
- `resources_discover` returns `skillPaths`, matching the documented resource event.
- `tool_call` guard returns `{ block: true, reason }`, matching Pi's documented blocking contract.
- Package skill discovery is aligned with package `skills/` convention and was verified by `/skill:topology-runtime`.
- HTTP/SSE network transport remains a compatibility target, not a verified fact. Local JSONL/socket transport is the verified runtime.
- Project trust matters for project-local resources, but this E2E used explicit `-e packages/pi-topology/index.ts`, so package loading did not depend on project-local trust.

## E2E Run Roots

- Command-path root: `/tmp/pi-topology-full-e2e-20260617-014757`
- Ghostty smoke root with initial print failure: `/tmp/pi-topology-ghostty-e2e-20260617-014757`
- Ghostty/read postfix root: `/tmp/pi-topology-ghostty-e2e-postfix-20260617-015100`
- Restarted-read postfix root: `/tmp/pi-topology-read-e2e-20260617-015900`

Important evidence files:

- `/tmp/pi-topology-full-e2e-20260617-014757/workdir/.pi/topology/mission-card.json`
- `/tmp/pi-topology-full-e2e-20260617-014757/workdir/.pi/topology/status-board.json`
- `/tmp/pi-topology-ghostty-e2e-postfix-20260617-015100/workdir/.pi/topology/runtime-events.jsonl`
- `/tmp/pi-topology-ghostty-e2e-postfix-20260617-015100/workdir/.pi/topology/sessions.jsonl`
- `/tmp/pi-topology-ghostty-e2e-postfix-20260617-015100/logs/supervisor-smoke.log`
- `/tmp/pi-topology-ghostty-e2e-postfix-20260617-015100/logs/hq-spawned.log`
- `/tmp/pi-topology-read-e2e-20260617-015900/workdir/.pi/topology/runtime-events.jsonl`

## Pass/Fail Table

| Check | Result | Evidence |
| --- | --- | --- |
| `npm run smoke` baseline | Pass | 77 tests, typecheck, pack dry-run |
| `pi list` local install | Pass | local package path points at repo package |
| `/topology <goal>` bare startup | Pass with repair | created mission, launch scripts, session ledger, Supervisor alive |
| `/topology` project flag | Failed then fixed | command initially used `workdir`; now honors `--project` / env |
| `/topology status` / doctor command path | Partial | non-interactive stdout is sparse, but state files/events update and unit command coverage passes |
| `skill:topology-runtime` visibility | Pass | Pi loaded skill and summarized command/tool workflow |
| Supervisor print-mode smoke | Failed then fixed | initial `SPAWN_MODE=print` still launched; spawn-mode lock now records `mode=print`, `launch_requested=false` |
| HQ launch request | Pass | `spawn_result mode=launch launch_requested=true` |
| HQ role script | Pass | direct `hq.sh` execution wrote log, registry, and `alive_confirmed` |
| Ghostty GUI execution via `open --args -e` | Risk | `open` returned 0 but did not execute the script in this environment |
| MiniMax lock | Pass | launch scripts and session ledger use `minimax-cn` / `MiniMax-M3` / `low`; no Anthropic/Claude strings found in relevant launch evidence |
| Current mission packet filtering | Pass | default list filters by mission; include-history behavior covered by tests |
| Repeated read de-noising in one process | Pass | unit regression |
| Repeated read de-noising across Pi restarts | Failed then fixed | real Pi probe now shows one `packet_received` for repeated list/get/await across two Pi processes |
| `topology_read_artifact` compact default | Pass | unit coverage verifies preview unless `full=true` |
| Role write guards | Pass with repair | read-only roles blocked from writes; repair remains scoped; stderr `/dev/null` false positives fixed |
| Cold restart/resume stale separation | Partial/pass | stale roles are marked stale in board; historical evidence is not treated as alive. Ghostty GUI launch gap remains separate risk |

## Bugs Found And Fixed

1. Smoke print-mode was prompt-dependent.
   - Evidence: `/tmp/pi-topology-ghostty-e2e-20260617-014757/.../runtime-events.jsonl` showed `mode:"launch"` and `launch_requested:true` despite `SPAWN_MODE=print`.
   - Fix: `ghostty-supervisor-smoke.sh` exports `PI_TOPOLOGY_SPAWN_MODE_LOCK`; `topology_spawn_role` honors it.
   - Test: `topology_spawn_role honors spawn mode lock over caller requested launch`.

2. `/topology` ignored the Pi `--project` flag.
   - Evidence: command-path E2E invoked `--project pi-topology-e2e`, but mission project became `workdir`.
   - Fix: command registration passes a `projectName` hook from `pi.getFlag("project")` / `PI_TOPOLOGY_PROJECT`.
   - Test: `topology command uses project flag when drafting a mission`.

3. `packet_received` de-noising only worked in memory.
   - Evidence: real Pi read probe across sessions produced repeated `packet_received` rows for the same packet.
   - Fix: receive-event helper checks existing `runtime-events.jsonl` before appending.
   - Test: extended duplicate-read regression clears in-memory packet state between reads.
   - E2E: `/tmp/pi-topology-read-e2e-20260617-015900/.../runtime-events.jsonl` has one `packet_received` after repeated list/get/await across two Pi invocations.

4. Read-only shell stderr redirects were blocked as writes.
   - Evidence: `evaluateToolCall` blocked `ls /tmp 2>/dev/null`, `find ... 2>/dev/null`, `rg ... 2>/dev/null`, and `cat ... 2>/dev/null`.
   - Fix: shell-write detector ignores redirects to `/dev/null`, while preserving real write detection.
   - Test: `read-only shell commands may silence stderr to /dev/null`.

## Commands Run

Representative commands:

- `cd packages/pi-topology && npm run smoke`
- `pi list`
- `pi --version`
- `pi --help`
- `SPAWN_MODE=print packages/pi-topology/scripts/ghostty-supervisor-smoke.sh`
- `SPAWN_MODE=launch packages/pi-topology/scripts/ghostty-supervisor-smoke.sh`
- `pi -e packages/pi-topology/index.ts ... -p "/topology Verify bare startup..."`
- `pi -e packages/pi-topology/index.ts ... -p "/skill:topology-runtime"`
- `pi -e packages/pi-topology/index.ts ... -p "Use tools only. Call topology_list..."`
- `node --experimental-strip-types --test test/unit/extension.test.ts`
- `node --experimental-strip-types --test test/unit/guard.test.ts test/unit/extension.test.ts`

## Remaining Risks

- Ghostty GUI launch on this machine is not fully proven. `topology_spawn_role(mode=launch)` records launch requested, and the generated `hq.sh` works when executed directly, but `open -n -a Ghostty --args -e <script>` did not execute the script during this run. Treat this as the highest-priority remaining local terminal-invocation issue before relying on unattended Ghostty spawning.
- Non-interactive slash command stdout is sparse for `/topology status` and `/topology doctor`; file/event evidence is reliable, but operator-facing CLI output could be improved.
- A direct HQ run spawned runner and later marked HQ stale after the session was interrupted. The stale/resume behavior is explainable and evidence-backed, but longer multi-role closeout still needs a complete owner-approved mission run.
- Single mission-card flow remains workable for these fresh roots, but repeated dogfood in one workspace can still be ambiguous.

## Mission Card Selection Design Candidate

Do not implement multi mission-card selection yet. Proposed behavior:

- Keep `.pi/topology/mission-card.json` as the active mission pointer for compatibility.
- Add `.pi/topology/missions/<mission_id>/mission-card.json` registry storage later.
- On `/topology` when multiple mission records exist, Supervisor shows a mission picker with:
  - active mission
  - last updated time
  - phase
  - live/stale role summary
  - pending packet count for current mission only
- Acceptance criteria:
  - default path remains single-card for new users
  - historical packets never inflate active dashboard counts
  - switching missions writes an explicit owner decision event
  - no worker evidence from prior missions is treated as current live evidence

## Readiness

`packages/pi-topology` is closer to a real custom WMS closeout run and passes local smoke. It is ready for a supervised local pilot where the owner can manually run generated role scripts if Ghostty GUI launch does not execute. It is not yet fully ready for unattended Ghostty-based spawning until the macOS Ghostty `open` invocation issue is resolved or replaced with a proven terminal launch method.
