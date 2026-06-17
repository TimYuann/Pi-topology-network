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
- Direct generated script E2E root: `/tmp/pi-topology-direct-e2e-20260617-085218`
- Ghostty terminal-layer debug roots:
  - `/tmp/pi-topology-ghostty-debug-20260617-020528`
  - `/tmp/pi-topology-ghostty-postcleanup-20260617-021000`
  - `/tmp/pi-topology-ghostty-direct-20260617-021031`
  - `/tmp/pi-topology-ghostty-emptycfg-20260617-021131`
  - `/tmp/pi-topology-ghostty-noempty-20260617-021347`
  - `/tmp/pi-topology-ghostty-touch-20260617-021406`
  - `/tmp/pi-topology-ghostty-open-noempty-20260617-021426`

Important evidence files:

- `/tmp/pi-topology-full-e2e-20260617-014757/workdir/.pi/topology/mission-card.json`
- `/tmp/pi-topology-full-e2e-20260617-014757/workdir/.pi/topology/status-board.json`
- `/tmp/pi-topology-ghostty-e2e-postfix-20260617-015100/workdir/.pi/topology/runtime-events.jsonl`
- `/tmp/pi-topology-ghostty-e2e-postfix-20260617-015100/workdir/.pi/topology/sessions.jsonl`
- `/tmp/pi-topology-ghostty-e2e-postfix-20260617-015100/logs/supervisor-smoke.log`
- `/tmp/pi-topology-ghostty-e2e-postfix-20260617-015100/logs/hq-spawned.log`
- `/tmp/pi-topology-read-e2e-20260617-015900/workdir/.pi/topology/runtime-events.jsonl`
- `/tmp/pi-topology-direct-e2e-20260617-085218/workdir/.pi/topology/launch/hq.sh`
- `/tmp/pi-topology-direct-e2e-20260617-085218/workdir/.pi/topology/sessions.jsonl`
- `/tmp/pi-topology-direct-e2e-20260617-085218/workdir/.pi/topology/runtime-events.jsonl`
- `/tmp/pi-topology-direct-e2e-20260617-085218/workdir/.pi/topology/status-board.json`
- `/tmp/pi-topology-direct-e2e-20260617-085218/logs/hq-direct-terminal.log`

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
| HQ launch command evidence | Pass with repair | launch-mode artifacts now record `launch_command_issued=true`; this is explicitly not proof that Ghostty executed the role or that the role is alive |
| HQ role script | Pass | direct `hq.sh` execution wrote log, session/status/runtime evidence, and `alive_confirmed` |
| Direct generated HQ script lane | Pass | `/tmp/pi-topology-direct-e2e-20260617-085218` generated `hq.sh` in print mode, verified MiniMax lock, then direct execution recorded `alive_confirmed`, `session_alive`, status-board `hq.alive=true`, and a fresh HQ -> runner `STATUS` packet |
| Ghostty GUI execution via `open --args -e` | Blocked by terminal layer | marker evidence is inconsistent: `/usr/bin/touch` markers were eventually created, but Ghostty still showed failed-command windows and logged abnormal process exits |
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

5. Launch-mode evidence over-relied on `launch_requested`.
   - Evidence: local Ghostty probes could create marker files while still showing failed-command windows and abnormal-process logs, so issuing `open -n -a Ghostty --args -e <script>` is not proof of role execution.
   - Fix: launch-mode session records, runtime events, and status-board evidence now add `launch_command_issued=true` / `type:"launch_command_issued"` and inference text saying alive proof still requires `alive_confirmed`, `session_alive`, dashboard heartbeat, or registry evidence. Existing `launch_requested` peer state remains for UI compatibility.
   - Tests: `topology_spawn_role honors spawn mode lock over caller requested launch`, `topology spawn hq launches a visible HQ peer session from supervisor`, and `HQ launch clears owner gate and records owner approval`.

## Additional Ghostty Launch Diagnostics

The remaining launch gap was retested after the local fixes were committed.

Findings:

- `open -n -a Ghostty --args -e <marker.sh> <marker.txt>` created a Ghostty process with the expected argv, but no marker output file was found in the script-marker roots checked.
- Direct `/Applications/Ghostty.app/Contents/MacOS/ghostty -e <marker.sh> <marker.txt>` also did not produce a marker output file in the checked root.
- `open -F -n -a Ghostty --args -e <marker.sh> <marker.txt>` did not prove stable script execution.
- Later reconciliation found that `/usr/bin/touch` marker files did exist:
  - `/private/tmp/pi-topology-ghostty-touch-20260617-021406/marker.txt`, timestamp `2026-06-17 02:16:46 +0800`, size `0`
  - `/private/tmp/pi-topology-ghostty-open-noempty-20260617-021426/marker.txt`, timestamp `2026-06-17 02:16:56 +0800`, size `0`
- This contradicts the earlier immediate observation that the `touch` markers were absent. The precise finding is not absolute non-execution; it is unstable/delayed command evidence plus Ghostty failure UI/logs.
- `ghostty +validate-config` exited 0.
- Ghostty's macOS Application Support config file is zero bytes:
  `/Users/yuantian/Library/Application Support/com.mitchellh.ghostty/config.ghostty`
- A reversible test moved that zero-byte config aside, launched the marker probe, and restored the file. It did not prove a stable Ghostty command lane, so the empty config is not the sole root cause.
- Narrow system logs around `02:14` to `02:17` included:
  - `error.FileIsEmpty path=/Users/yuantian/Library/Application Support/com.mitchellh.ghostty/config.ghostty`
  - `io_exec: shell could not be detected, no automatic shell integration will be injected`
  - `surface: abnormal process exit detected, showing error message`
- Earlier failed launches also logged `embedded_window: error initializing surface err=error.OutOfMemory` and opened `Configuration Errors` windows.
- Ghostty's own default config documentation says `-e` sets `quit-after-last-window-closed=true` and `shell-integration=detect`; it also treats commands that exit under `abnormal-command-exit-runtime = 250` ms as abnormal on macOS. This explains why a fast `/usr/bin/touch` probe can leave marker evidence while Ghostty still opens a failed-command window.

Conclusion:

The generated Pi role script and launch args are not the only failing boundary. Ghostty GUI command execution on this Mac is unstable for unattended probes: fast commands can execute, yet Ghostty still shows failed-command windows and logs abnormal process exits. No package launcher change was made from this evidence because the tested alternatives (`open -F`, direct binary launch, AppleScript `new window with configuration`, document open, explicit config file, temporary config home, and reversible removal of the zero-byte config) did not prove a stable Ghostty GUI command execution path.

## Local Environment Blockers

### `rg` Gatekeeper

- Active binary: `/opt/homebrew/Caskroom/codex/0.140.0/codex-path/rg`
- `file`: Mach-O 64-bit executable arm64
- Initial quarantine: `0381;6a318912;;46C4800B-ECB9-4211-B86B-C0B9A7710B44`
- Fix applied only to that exact binary:
  `xattr -d com.apple.quarantine /opt/homebrew/Caskroom/codex/0.140.0/codex-path/rg`
- Verification:
  - `rg --version` -> `ripgrep 15.1.0`
  - `rg -n "topology_spawn_role" packages/pi-topology/src packages/pi-topology/scripts` returned expected package references.

### Temporary E2E Acceptance

Until a minimal Ghostty GUI command probe is stable on this Mac, do not use unattended Ghostty GUI spawning as the E2E gate. The current acceptance lane is:

- `topology_spawn_role(mode=print)` generates the role script.
- Generated `hq.sh` contains the MiniMax lock: `--provider minimax-cn --model MiniMax-M3 --thinking low`.
- Direct execution of generated `hq.sh` in the current terminal is acceptable transport evidence when durable runtime/session/status/log or packet artifacts prove role startup.
- Ghostty GUI launch remains an environment compatibility target until `open -n -a Ghostty --args -e /usr/bin/touch /tmp/probe` runs without failed-command windows or abnormal-process logs.

Fresh direct-lane proof:

- Run root: `/tmp/pi-topology-direct-e2e-20260617-085218`
- Supervisor smoke command ran with `SPAWN_MODE=print`, provider `minimax-cn`, model `MiniMax-M3`, thinking `low`.
- `runtime-events.jsonl` recorded `spawn_result` for `hq` with `mode:"print"` and `launch_requested:false`.
- `hq.sh` contains `--provider minimax-cn --model MiniMax-M3 --thinking low`; no `anthropic`, `claude`, or `sonnet` strings were found in the script/session evidence.
- Direct execution of `hq.sh` in the current terminal wrote:
  - `sessions.jsonl`: `state:"alive_confirmed"`, `role:"hq"`, `session_id:"hq-24126-1781657590269"`, provider `minimax-cn`, model `MiniMax-M3`
  - `runtime-events.jsonl`: `event_type:"session_alive"` for the same HQ session
  - `status-board.json`: `peer_status.hq.state:"alive"`, `alive:true`, `context_used_pct:1`
  - `logs/hq-direct-terminal.log`: HQ lifecycle receipt and boundary discipline notes
  - `outbox.jsonl` / `runner-inbox.jsonl`: fresh HQ -> runner `STATUS` packet `pkt_29d0a117-9c2c-4862-90e3-3ce6b63e8677`
- No role process remained after the direct script finished.
- The live registry file was not present at final inspection after process exit, so this run treats session ledger, status board, runtime event, terminal log, and packet evidence as the durable proof set.

### Fresh Continuation Evidence

Run root: `/tmp/pi-topology-cli-e2e-20260617-090208`

Commands:

- `cd packages/pi-topology && npm run smoke`
- `pi --version`
- `pi list`
- `SPAWN_MODE=print packages/pi-topology/scripts/ghostty-supervisor-smoke.sh`
- `/tmp/pi-topology-cli-e2e-20260617-090208/workdir/.pi/topology/launch/hq.sh`
- direct Pi runner read probe with repeated `topology_list` and `topology_get`
- `pi -e packages/pi-topology/index.ts ... -p "/topology status"`
- `pi -e packages/pi-topology/index.ts ... -p "/skill:topology-runtime"`

Evidence:

- `pi --version` -> `0.79.4`
- `pi list` showed the local package path:
  `/Users/yuantian/Documents/Coding/omp-topology-network/packages/pi-topology`
- Package version: `pi-topology-network@0.1.0`
- `npm run smoke` passed after the Ghostty/rg blocker record correction: 80 tests, typecheck, and `npm pack --dry-run`.
- Print-mode supervisor smoke generated `/tmp/pi-topology-cli-e2e-20260617-090208/workdir/.pi/topology/launch/hq.sh` and recorded `spawn_result` with `mode:"print"` and `launch_requested:false`.
- `hq.sh` contains `--provider minimax-cn --model MiniMax-M3 --thinking low`.
- No `anthropic`, `claude`, or `sonnet` strings were found in the fresh launch/session evidence.
- Direct execution of generated `hq.sh` in the current terminal wrote:
  - `sessions.jsonl`: `state:"alive_confirmed"`, `role:"hq"`, `session_id:"hq-48513-1781658185996"`, provider `minimax-cn`, model `MiniMax-M3`
  - `runtime-events.jsonl`: `event_type:"session_alive"` for the same HQ session
  - immediate post-run `status-board.json`: `peer_status.hq.state:"alive"`, `alive:true`, `context_used_pct:1`
  - `logs/hq-spawned.log`: direct terminal launch marker
  - `outbox.jsonl` / `runner-inbox.jsonl`: fresh HQ -> runner `STATUS` packet `pkt_c4c98905-e052-41c4-bd6b-92eafe683ec9`
- A direct Pi runner read probe called `topology_list` twice and `topology_get` twice for packet `pkt_117a796e-d9f6-477b-b41c-b7afd1ae4ffc`. `runtime-events.jsonl` ended with exactly two `packet_received` rows for the two runner packets, one per packet:
  - `pkt_117a796e-d9f6-477b-b41c-b7afd1ae4ffc`: 1
  - `pkt_c4c98905-e052-41c4-bd6b-92eafe683ec9`: 1
- `/skill:topology-runtime` loaded and reported the mission, peer state, owner gate, and Ghostty caveat.
- Later status/skill inspections correctly marked the exited HQ and runner probe sessions stale, so final board staleness is expected and is not a contradiction of the immediate `session_alive` evidence.
- `/topology status` in non-interactive `pi -p` still produced sparse terminal-control output only. The command handler returns text and emits command text, so this remains an operator-facing Pi CLI rendering risk rather than evidence for a topology state bug.
- No matching direct-run Pi/HQ process remained after final inspection; the only matches were the inspection commands themselves.

Fresh launch-evidence repair proof:

- Run root: `/tmp/pi-topology-launch-evidence-20260617-091107`
- Command: `SPAWN_MODE=print packages/pi-topology/scripts/ghostty-supervisor-smoke.sh`
- `runtime-events.jsonl` recorded `spawn_result` for `hq` with `mode:"print"`, `launch_requested:false`, and `launch_command_issued:false`.
- `sessions.jsonl` recorded the `launch_printed` HQ row with `launch_command_issued:false`, provider `minimax-cn`, model `MiniMax-M3`, thinking `low`.
- Generated `hq.sh` retained the MiniMax lock: `--provider minimax-cn --model MiniMax-M3 --thinking low`.
- This lane did not open Ghostty.

## Commands Run

Representative commands:

- `cd packages/pi-topology && npm run smoke`
- `pi list`
- `pi --version`
- `pi --help`
- `SPAWN_MODE=print packages/pi-topology/scripts/ghostty-supervisor-smoke.sh`
- `SPAWN_MODE=launch packages/pi-topology/scripts/ghostty-supervisor-smoke.sh`
- `SPAWN_MODE=print packages/pi-topology/scripts/ghostty-supervisor-smoke.sh`
- `/tmp/pi-topology-direct-e2e-20260617-085218/workdir/.pi/topology/launch/hq.sh`
- `pi -e packages/pi-topology/index.ts ... -p "/topology Verify bare startup..."`
- `pi -e packages/pi-topology/index.ts ... -p "/skill:topology-runtime"`
- `pi -e packages/pi-topology/index.ts ... -p "Use tools only. Call topology_list..."`
- `node --experimental-strip-types --test test/unit/extension.test.ts`
- `node --experimental-strip-types --test test/unit/guard.test.ts test/unit/extension.test.ts`

## Remaining Risks

- Ghostty GUI launch on this machine is not fully proven. `topology_spawn_role(mode=launch)` records that the terminal app was asked to open a script, and the generated `hq.sh` works when executed directly, but `open -n -a Ghostty --args -e <script>` is not a stable proof of role startup on this Mac.
- The local Ghostty issue reproduces as failed-command windows and abnormal-process logs even for simple probes. `/usr/bin/touch` markers were eventually created, so do not describe this as absolute non-execution. Next fix should start outside `packages/pi-topology`: get a minimal `open -n -a Ghostty --args -e /usr/bin/touch /tmp/probe` working without failure UI/logs, then rerun the package HQ launch lane.
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

`packages/pi-topology` is closer to a real custom WMS closeout run and passes local smoke. It is ready for a supervised local pilot using direct generated role scripts as the E2E launch lane; `/tmp/pi-topology-direct-e2e-20260617-085218` proves that lane for HQ with MiniMax lock and durable alive evidence. It is not yet ready to use unattended Ghostty GUI spawning as the gate on this Mac until the local Ghostty command probe is stable and free of failed-command windows/abnormal-process logs.
