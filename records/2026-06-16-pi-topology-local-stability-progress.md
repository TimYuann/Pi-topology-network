# Pi Topology Package Local Stability Progress

日期：2026-06-16
项目：OMP拓扑网络 / `packages/pi-topology`

## 目标

把 `packages/pi-topology` 从 MVP + 初步 Ghostty dogfood 推进到本地 Pi 可稳定使用、可恢复、可审计的状态。Package Hub 发布、HTTP/SSE transport 完整实现不在本轮范围。

## Transport Evidence

- `npm run smoke` 通过：
  - 25 个 Node unit tests
  - strip-types import
  - `npm pack --dry-run`
- `pi install .` 提权后通过，输出 `Installed .`。
- `pi list` 提权后显示当前 package：
  - `/Users/yuantian/Documents/Coding/omp-topology-network/packages/pi-topology`
- Direct Pi offline supervisor smoke 通过：
  - run root: `/tmp/pi-topology-script-offline-stability`
  - log: `/tmp/pi-topology-script-offline-stability/logs/supervisor-smoke.log`
- Direct Pi offline role smoke 通过：
  - `/tmp/pi-topology-script-offline-stability/logs/hq-smoke.log`
  - `/tmp/pi-topology-script-offline-stability/logs/repair-smoke.log`
  - `/tmp/pi-topology-script-offline-stability/logs/runner-smoke.log`
  - `/tmp/pi-topology-script-offline-stability/logs/oracle-smoke.log`
  - `/tmp/pi-topology-script-offline-stability/logs/librarian-smoke.log`
  - `/tmp/pi-topology-script-offline-stability/logs/scott-smoke.log`
- Runtime event log:
  - `/tmp/pi-topology-script-offline-stability/workdir/.pi/topology/runtime-events.jsonl`
  - 28 JSONL events observed after supervisor + role smoke.
- Local packet outbox:
  - `/tmp/pi-topology-script-offline-stability/coms/projects/pi-topology-dogfood/packets/outbox.jsonl`
  - 6 packets observed after supervisor + role smoke.
- Spawn script:
  - `/tmp/pi-topology-script-offline-stability/workdir/.pi/topology/launch/hq.sh`
  - contains role env, allowed/forbidden guard env, `--prompt`, and `tee -a` log capture.
- Guard hook smoke:
  - command: `npm run guard-smoke`
  - incident log: `/tmp/pi-topology-guard-smoke/.pi/topology/incident-log.jsonl`
  - runtime event log: `/tmp/pi-topology-guard-smoke/.pi/topology/runtime-events.jsonl`
  - result: 8 persisted guard incidents and 8 `guard_block` events.
- MiniMax M3 + Ghostty clean dogfood 通过：
  - run root: `/tmp/pi-topology-dogfood-minimax-clean-2026-06-16`
  - supervisor log: `/tmp/pi-topology-dogfood-minimax-clean-2026-06-16/logs/supervisor-smoke.log`
  - spawned HQ log: `/tmp/pi-topology-dogfood-minimax-clean-2026-06-16/logs/hq-spawned.log`
  - role logs:
    - `/tmp/pi-topology-dogfood-minimax-clean-2026-06-16/logs/hq-smoke.log`
    - `/tmp/pi-topology-dogfood-minimax-clean-2026-06-16/logs/repair-smoke.log`
    - `/tmp/pi-topology-dogfood-minimax-clean-2026-06-16/logs/runner-smoke.log`
    - `/tmp/pi-topology-dogfood-minimax-clean-2026-06-16/logs/oracle-smoke.log`
    - `/tmp/pi-topology-dogfood-minimax-clean-2026-06-16/logs/librarian-smoke.log`
    - `/tmp/pi-topology-dogfood-minimax-clean-2026-06-16/logs/scott-smoke.log`
  - runtime event log: `/tmp/pi-topology-dogfood-minimax-clean-2026-06-16/workdir/.pi/topology/runtime-events.jsonl`
  - local outbox: `/tmp/pi-topology-dogfood-minimax-clean-2026-06-16/coms/projects/pi-topology-dogfood/packets/outbox.jsonl`
- Clean dogfood packet ids:
  - supervisor HQ -> runner STATUS: `pkt_37d96d7e-a124-4b70-b016-85c6b14a5d64`
  - spawned HQ -> runner STATUS: `pkt_93fd1b65-c5b3-4983-925d-6a0a9a6e32bd`
  - scott -> hq REPORT: `pkt_883204cd-b682-4be2-952b-d26373739584`
  - repair -> hq STATUS: `pkt_641e8fbd-7404-4b63-84a3-3cda917f5020`
  - runner -> hq REPORT: `pkt_f71dafc9-8788-4494-ade2-178816b5757b`
  - oracle -> hq REPORT: `pkt_cf084567-eb4c-4475-9a55-8d6c68859687`
  - librarian -> hq REPORT: `pkt_18236a1c-60f7-4ba1-9562-0ae90f1d19d4`
  - hq -> runner REQUEST: `pkt_dadc4ac6-a1e8-496a-9d6a-114e2c7fbc98`

## Business Evidence

- Added/verified tools:
  - `topology_send`
  - `topology_get`
  - `topology_list`
- Added/verified roles:
  - `librarian`
  - `scott` (`scout` alias)
- Mission draft now includes `librarian` and `scott` as `on_demand` + `read_only`.
- Role launch plans now default every role to:
  - `--provider minimax-cn`
  - `--model MiniMax-M3`
  - optional `--thinking low`
- `topology_spawn_role` supports:
  - `initial_prompt`
  - `log_path`
  - `provider`
  - `model`
  - `thinking`
- Runtime events now include:
  - `runtime_boot`
  - `mission_initialized`
  - `watchdog_finding`
  - `spawn_request`
  - `spawn_result`
  - `packet_sent`
  - `packet_received`
  - `guard_block`
- Packet validation now rejects empty packet body objects. This was added after a real MiniMax Scott smoke generated repeated empty REPORT packets in a contaminated run root.
- Guard smoke now persists incident JSONL when `incident_log_path` is supplied.
- Extension `tool_call` guard passes incident/event log env paths into guard and writes `guard_block`.
- `npm run guard-smoke` covers runner/oracle/librarian/scott write blocks, repair allowed write, repair out-of-scope block, and `git push` / `git reset --hard` / `rm -rf` owner gates.
- Direct Pi offline smoke exercised:
  - `topology_init_mission`
  - `topology_status`
  - `topology_doctor`
  - `topology_send`
  - `topology_get`
  - `topology_list`
  - `topology_spawn_role(mode=print)`
- Direct Pi offline role smoke exercised all six requested roles:
  - `hq`
  - `repair`
  - `runner`
  - `oracle`
  - `librarian`
  - `scott`
- MiniMax M3 + Ghostty role smoke exercised all six requested roles in a clean run root:
  - `hq`
  - `repair`
  - `runner`
  - `oracle`
  - `librarian`
  - `scott`
- Pi local config was adjusted for smoother local dogfood:
  - `~/.pi/agent/trust.json` trusts `/Users/yuantian/Documents/Coding/omp-topology-network`
  - `~/.pi/agent/settings.json` has `quietStartup: true`
- Ghostty lifecycle policy was tightened:
  - scripts no longer wait for Enter unless `PI_TOPOLOGY_WAIT_ON_EXIT=1`
  - after each run root is accepted or rejected, close that run's Ghostty/Pi processes and keep evidence in logs/outbox/runtime files only

## Inference

- Local package install/list, extension load, mission/status/doctor, local packet send/get/list, runtime event append, guard incident append, and role prompt loading are now strongly covered by automated tests plus direct Pi offline smoke.
- The offline role smoke is useful local stability evidence, but it does not prove MiniMax M3 behavior because it uses `PI_OFFLINE=1`.
- MiniMax M3 + Ghostty `mode=launch` deep dogfood is now verified for local package stability after owner approval of third-party provider data transfer risk. The verified boundary is local JSONL transport and role/tool behavior, not HTTP/SSE transport.
- A direct Pi offline runner write attempt did not trigger a guard block because no file-writing tool was available to that runner session; the authoritative local guard evidence is the extension hook smoke above, not that attempted Pi run.
- The real dogfood exposed two implementation gaps that were fixed before the clean run was accepted:
  - `topology_spawn_role` initially generated invalid Pi CLI flags (`--purpose`, `--prompt`); fixed to `--name` and `-p`.
  - spawned HQ initially wrote events outside the mission workdir; fixed by exporting `PI_TOPOLOGY_WORKDIR` and `cd`-ing before `exec`.
- The real dogfood also exposed a role prompt/schema gap: Scott could repeat empty REPORT packets. Fixed by banning empty packet bodies and tightening the role smoke prompt to exactly one `topology_send`.

## Remaining Non-Goals / Next Evidence

- HTTP/SSE transport remains a compatibility target, not a verified transport.
- Package Hub publication remains pending.
- A future longer dogfood should exercise owner approval after intake so `checkpoint_missing` and `owner_gate` can transition into a post-approval runtime phase.
