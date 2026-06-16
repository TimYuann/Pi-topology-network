# Pi Topology Package Ghostty Dogfood

日期：2026-06-16
项目：OMP拓扑网络 / `packages/pi-topology`

## 目标

验证 `pi-topology-network` 不只通过单元测试和 `npm pack`，也能在真实 Ghostty + Pi 入口中加载 package、注册工具、建立 mission，并以不同 `--cname` 角色启动。

## Transport Evidence

- `pi install .` 在 `packages/pi-topology` 下执行成功，输出 `Installed .`。
- `pi list` 显示本地 package 指向 `/Users/yuantian/Documents/Coding/omp-topology-network/packages/pi-topology`。
- Ghostty supervisor smoke 脚本：
  - `/Users/yuantian/Documents/Coding/omp-topology-network/packages/pi-topology/scripts/ghostty-supervisor-smoke.sh`
  - verified MiniMax clean log: `/tmp/pi-topology-dogfood-minimax-clean-2026-06-16/logs/supervisor-smoke.log`
- 角色 Ghostty smoke 脚本：
  - `/Users/yuantian/Documents/Coding/omp-topology-network/packages/pi-topology/scripts/ghostty-role-smoke.sh`
  - verified MiniMax clean logs:
    - `/tmp/pi-topology-dogfood-minimax-clean-2026-06-16/logs/hq-smoke.log`
    - `/tmp/pi-topology-dogfood-minimax-clean-2026-06-16/logs/repair-smoke.log`
    - `/tmp/pi-topology-dogfood-minimax-clean-2026-06-16/logs/runner-smoke.log`
    - `/tmp/pi-topology-dogfood-minimax-clean-2026-06-16/logs/oracle-smoke.log`
    - `/tmp/pi-topology-dogfood-minimax-clean-2026-06-16/logs/librarian-smoke.log`
    - `/tmp/pi-topology-dogfood-minimax-clean-2026-06-16/logs/scott-smoke.log`
- `topology_spawn_role` 生成 HQ launch script：
  - `/tmp/pi-topology-dogfood-minimax-clean-2026-06-16/workdir/.pi/topology/launch/hq.sh`
- spawned HQ log:
  - `/tmp/pi-topology-dogfood-minimax-clean-2026-06-16/logs/hq-spawned.log`
- runtime event log:
  - `/tmp/pi-topology-dogfood-minimax-clean-2026-06-16/workdir/.pi/topology/runtime-events.jsonl`
- local packet outbox:
  - `/tmp/pi-topology-dogfood-minimax-clean-2026-06-16/coms/projects/pi-topology-dogfood/packets/outbox.jsonl`

## Business Evidence

- Supervisor Ghostty run:
  - 首轮暴露缺陷：`Unknown options: --cname, --project`。
  - 修复：package extension 注册 `cname` 和 `project` flags。
  - 重跑后通过：`topology_status`、`topology_init_mission`、`topology_doctor` 在真实 Pi 非交互 session 中执行。
  - 进一步重跑：`topology_spawn_role` 被真实 Pi supervisor 调用，并报告 HQ launch requested/launched。
  - MiniMax clean run: supervisor executed `topology_status` / `topology_init_mission` / `topology_doctor` / `topology_send` / `topology_spawn_role(mode=launch)` and launched HQ through Ghostty.
- Role Ghostty runs:
  - `hq` 以 `--cname hq` 启动，加载 shared protocol、HQ prompt、mission card，发送 REQUEST `pkt_dadc4ac6-a1e8-496a-9d6a-114e2c7fbc98`。
  - spawned `hq` 通过 `topology_spawn_role(mode=launch)` 启动，发送 STATUS `pkt_93fd1b65-c5b3-4983-925d-6a0a9a6e32bd`。
  - `repair` 发送 STATUS `pkt_641e8fbd-7404-4b63-84a3-3cda917f5020`。
  - `runner` 发送 REPORT `pkt_f71dafc9-8788-4494-ade2-178816b5757b`。
  - `oracle` 发送 REPORT `pkt_cf084567-eb4c-4475-9a55-8d6c68859687`。
  - `librarian` 发送 REPORT `pkt_18236a1c-60f7-4ba1-9562-0ae90f1d19d4`。
  - `scott` 发送 REPORT `pkt_883204cd-b682-4be2-952b-d26373739584`。
- Package smoke:
  - `npm run smoke` 通过，包含 25 个 Node unit tests、strip-types import、`npm pack --dry-run`。
- Resource cleanup:
  - Previous Ghostty instances were closed after logs/outbox/runtime files were captured.
  - Scripts now only wait for Enter when `PI_TOPOLOGY_WAIT_ON_EXIT=1`.

## Inference

- 已验证：本地 package 安装、Pi extension 加载、CLI flag 注册、mission/status/doctor 工具调用、真实 MiniMax M3 + Ghostty 多角色启动。
- 已验证：`topology_spawn_role(mode=launch)` 由 supervisor 工具调用并生成/发起 HQ launch，spawned HQ 写入同一 runtime event log 与 local outbox。
- 已验证：structured local packet flow 在真实 MiniMax M3 + Ghostty 角色中落盘，可由 outbox/runtime-events 复核。
- 未验证：HTTP/SSE transport、Package Hub 发布。本地 JSONL structured packet flow 已验证。

## Follow-up Status

1. 已补：`topology_spawn_role` 支持 `initial_prompt` / `log_path`，launch script 会 tee stdout/stderr 到指定 log。
2. 已补：local-coms 增加 `topology_send` / `topology_get` / `topology_list`，unit 与 direct Pi offline smoke 覆盖 HQ -> runner 与 role -> HQ packet。
3. 已补：`topology_doctor` 的 watchdog finding、packet send/receive、spawn request/result、guard block 都会进入 runtime event log。
4. 已补：`npm run guard-smoke` 触发 extension `tool_call` hook，写入 8 条 incident 与 8 条 `guard_block` runtime events。
5. 已补：MiniMax M3 + Ghostty `mode=launch` 深度 dogfood 在 owner 明确批准第三方 provider 数据传输风险后完成。
6. 已补：packet schema 拒绝空 `body`，role smoke prompt 限制一次 `topology_send`；该修复来自 Scott 真实 dogfood 中重复空 REPORT 的发现。
