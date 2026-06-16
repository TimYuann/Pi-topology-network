# Pi Topology Package 本地稳定性目标模式交接

日期：2026-06-16
项目：OMP拓扑网络 / `packages/pi-topology`
交接目的：新开一个 Codex session，使用目标模式，把当前 Pi topology package 从“已跑通 MVP + 初步 Ghostty dogfood”推进到“明早可本地稳定使用”的状态。

## 1. 本轮最高目标

目标不是 Package Hub 发布，也不是开源包装。

目标是：**在本机本地 Pi 使用场景中，让 `packages/pi-topology` 极大程度稳定、可用、可狗粮、可恢复、可审计。**

明早 owner 打开时，应该可以做到：

1. `pi install .` 稳定可用。
2. `topology-supervisor` 能真实启动。
3. supervisor 能创建/读取 mission card、status board、incident log、runtime event log。
4. supervisor 能任务感知地启动角色 session。
5. 至少 HQ / runner / oracle / repair / librarian / scott 这类角色有清晰 prompt、role policy、启动路径。
6. 本地 transport 至少能完成结构化 packet 往返 smoke。
7. role guard 能阻断 runner/oracle/librarian/scott 的写操作，repair 只能写 allowed_paths。
8. 真实 Ghostty + Pi 测试有 logs，可复盘，不靠肉眼猜。
9. README/docs 明确说明本地使用方式、已验证项、未验证项、故障恢复。

## 2. 执行速度策略：模型与 thinking

后续真实 Pi/Ghostty 测试统一使用 MiniMax M3，并降低思考强度。

建议所有真实 Pi 命令默认：

```bash
--provider minimax-cn --model MiniMax-M3 --thinking low
```

如果 `--thinking low` 在当前 Pi 版本不生效或不被 MiniMax provider 支持，则退化为：

```bash
--provider minimax-cn --model MiniMax-M3
```

如 Pi 支持关闭 thinking，可在非复杂 smoke 中使用：

```bash
--thinking off
```

原则：

- smoke / status / doctor / packet 往返：`low` 或 `off`。
- 真实修复/复杂审查：可以仍用当前 Codex 主 session 判断，但 Pi 角色测试不要默认高思考。
- 不要用慢模型做批量 Ghostty role smoke。
- 所有 dogfood 脚本都应把 provider/model/thinking 写进 log。

## 3. 长程任务执行策略：主 session + Codex Spark 子代理

这是一个长程稳定性任务，不要把所有探查、批量写文件和验证都塞进主 session。主 session 应尽量少压缩，职责是：

- 维护目标模式和验收门。
- 设计任务拆分。
- 审核子代理结果。
- 做关键集成和最终判断。

需要适当使用 `gpt-5.3-codex-spark` subagent 来减轻主 session 上下文压力。

### 3.1 适合派给 Codex Spark 的任务

- 读取/整理参考文件，输出短结论。
- 批量创建或更新角色 prompt，例如 librarian / scott / reviewer / planner。
- 批量更新 docs / records / README 的已验证项与未验证项。
- 写独立测试文件，例如 packet send/get/list、guard incident、spawn script。
- 跑局部验证并回报精简结果。
- 检查某个写集是否遗漏同步点。

### 3.2 不适合派给子代理的任务

- 最终架构取舍。
- 真实 Ghostty 测试结果的最终判定。
- 跨模块冲突修复。
- owner-facing closeout。
- 需要同时改同一批核心文件的工作。

### 3.3 子代理使用规则

- 子代理模型指定为 `gpt-5.3-codex-spark`。
- 每个子代理必须有清晰、互不重叠的写集。
- 子代理最终必须列出改动文件、验证命令、剩余风险。
- 主 session 不要重复子代理已完成的非关键探查，只做抽查和集成。
- 如需要多个独立任务，优先并行派发。

### 3.4 推荐并行拆分

启动实现前建议至少拆出这些子任务：

1. `roles-worker`：新增 librarian/scott/reviewer/planner prompts 与 role policy 文档。
2. `packet-worker`：实现/测试 `topology_send`、`topology_get`、`topology_list`。
3. `guard-worker`：补真实 guard smoke 脚本和 incident 验证。
4. `docs-worker`：跟随代码结果更新 README/docs/records，不夸大未验证项。

主 session 本地负责：

- 合并冲突。
- 跑完整 `npm run smoke`。
- 运行真实 Ghostty + Pi dogfood。
- 决定是否达到明早稳定可用标准。

## 4. 交接启动时状态摘要（已由第 13 节更新）

本节保留原始 handoff 启动时的状态，方便复盘从哪里开始。最新执行结果以第 13 节为准。

交接启动时 package 已存在：

```text
packages/pi-topology/
  package.json
  index.ts
  src/
  agents/
  skills/topology-runtime/SKILL.md
  docs/
  scripts/
  test/unit/
```

交接启动时已经完成并验证：

- `pi install .` 成功，输出 `Installed .`。
- `pi list` 能看到本地 package 指向当前仓库 `packages/pi-topology`。
- `npm run smoke` 通过：
  - 12 个 Node unit tests
  - strip-types import
  - `npm pack --dry-run`
- 真实 Ghostty + Pi supervisor smoke 跑通：
  - `topology_status`
  - `topology_init_mission`
  - `topology_doctor`
  - 后续加入 `topology_spawn_role`
- 真实 Ghostty + Pi role smoke 跑通：
  - `hq`
  - `runner`
  - `oracle`
- 已修复真实 Pi 暴露的问题：
  - `--cname` / `--project` 原本未注册，导致 `Unknown options`。
  - 已在 extension 中注册 flags。

交接启动时记录：

```text
records/2026-06-16-pi-topology-package-ghostty-dogfood.md
```

交接启动时 dogfood logs：

```text
/tmp/pi-topology-dogfood/logs/supervisor-smoke.log
/tmp/pi-topology-dogfood/logs/hq-smoke.log
/tmp/pi-topology-dogfood/logs/runner-smoke.log
/tmp/pi-topology-dogfood/logs/oracle-smoke.log
```

## 5. 交接启动时未完成但必须优先补齐（已由第 13 节收口）

本节列出启动时的待补项。第 13 节记录了本轮目标模式执行后的完成情况与仍不外推的边界。

### 5.1 Spawned role 的真实证据

当前 `topology_spawn_role(mode=launch)` 已由 supervisor 调用，并报告 HQ launch；也生成了：

```text
/tmp/pi-topology-dogfood/workdir/.pi/topology/launch/hq.sh
```

但还没有拿到“由 `topology_spawn_role` 启动出来的那个 HQ 窗口内部”的持续运行证据。

下一 session 必须补齐：

- `topology_spawn_role` 支持 `initial_prompt`。
- `topology_spawn_role` 支持 `log_path` 或 `smoke_log_path`。
- launch script 能将 spawned role 的 stdout/stderr tee 到指定 log。
- supervisor 调用 `topology_spawn_role(role=hq, mode=launch, initial_prompt=..., log_path=...)` 后，能在 log 中看到 HQ 调用 `topology_status` / `topology_doctor` / packet 工具。

### 5.2 Structured packet 往返

当前 local transport 有 registry/outbox JSONL，但还缺真实 role-to-role packet 往返。

下一 session 必须做：

- 增加工具：
  - `topology_send`
  - `topology_get`
  - `topology_list`
  - 可选：`topology_ack_packet`
- 或者把现有 local-coms 模块补到工具面。
- smoke 至少覆盖：
  - HQ -> runner: `STATUS` 或 `REQUEST`
  - runner -> HQ: `REPORT`
  - HQ 非阻塞读取并记录收到 packet
- packet 必须包含：
  - `packet_id`
  - `mission_id`
  - `type`
  - `from`
  - `to`
  - `body`
  - `timestamp`
  - `hops`
  - audit evidence 三分法：transport / business / inference

### 5.3 Runtime event log 真实落证

当前很多 evidence 还在 final text / log 文件里。

下一 session 必须让这些事件进入 `.pi/topology/runtime-events.jsonl`：

- `runtime_boot`
- `mission_initialized`
- `tool_registered` 或 `tool_surface_loaded`
- `spawn_request`
- `spawn_result`
- `packet_sent`
- `packet_received`
- `watchdog_finding`
- `owner_gate_enter`
- `guard_block`

### 5.4 Guard 的真实 Pi tool_call 验证

当前 guard 有 unit test，但还需要真实 Pi tool_call smoke：

- runner/oracle/scott/librarian 试图写文件时应被 block。
- repair 写 allowed_paths 内文件应 allow。
- repair 写 allowed_paths 外文件应 block。
- shell 中 `git push` / `git reset --hard` / `rm -rf` 进入 owner gate 或 hard block。
- 每次 block 必须写 incident log。

## 6. 角色扩展要求

现有角色：

- `topology-supervisor`
- `hq`
- `repair`
- `runner`
- `oracle`

需要扩展更细的任务感知角色。建议至少新增：

### 6.1 librarian

定位：资料管理员 / evidence curator / 文档索引角色。

职责：

- 读取 docs/records/sources/package logs。
- 建立 evidence index。
- 汇总 transport/business/inference 三类证据。
- 帮 HQ 找历史 handoff、dogfood log、失败记录。
- 不写业务代码。
- 默认 read-only；允许写入 `records/` 或 `.pi/topology/evidence-index.json` 需 mission 授权。

### 6.2 scott

定位：调研员 / scout researcher / external reference scout。

职责：

- 调研 Pi package / extension API / pi-crew / coms 参考实现。
- 产出短研究 packet，不做最终 verdict。
- 不改代码，除非 owner mission 明确允许写 notes。
- 默认 read-only。
- 适合被 HQ/supervisor 按任务临时启动。

命名说明：

- 用户口头提到 “Scott 或 Librarian 这样的做调研用的角色”。
- 如实现者认为 `scout` 比 `scott` 更清楚，可使用 `scout`，但 handoff / docs 中要解释别名关系。

### 6.3 reviewer（可选）

定位：局部代码审查，不等同 oracle。

职责：

- 对 repair 的 patch 做局部 review。
- 不给最终 GO/NO-GO。
- 不改代码。

### 6.4 planner（可选）

定位：拆任务和生成 work slices。

职责：

- 帮 HQ 拆解，但不收口 verdict。
- 不改代码。

### 6.5 角色实现必须同步的文件

新增角色时至少同步：

```text
packages/pi-topology/agents/<role>.md
packages/pi-topology/src/runtime/mission.ts
packages/pi-topology/src/runtime/guard.ts
packages/pi-topology/src/runtime/spawn.ts
packages/pi-topology/src/roles/role-policy.ts
packages/pi-topology/src/roles/prompts.ts
packages/pi-topology/test/unit/*
packages/pi-topology/docs/*
packages/pi-topology/README.md
```

## 7. 深入本地测试要求

新 session 可以使用 computer use / Ghostty 启动真实 Pi 测试。用户已授权测试可以更长、更复杂。

测试必须尽可能深入，但仍要可控、可审计。

### 7.1 必跑测试

1. Unit / import / pack：

```bash
cd packages/pi-topology
npm run smoke
```

2. 安装：

```bash
cd packages/pi-topology
pi install .
pi list
```

3. Supervisor real smoke：

```bash
open -na Ghostty.app --args -e /Users/yuantian/Documents/Coding/omp-topology-network/packages/pi-topology/scripts/ghostty-supervisor-smoke.sh
```

4. Role real smoke：

```bash
open -na Ghostty.app --args -e /Users/yuantian/Documents/Coding/omp-topology-network/packages/pi-topology/scripts/ghostty-role-smoke.sh hq
open -na Ghostty.app --args -e /Users/yuantian/Documents/Coding/omp-topology-network/packages/pi-topology/scripts/ghostty-role-smoke.sh runner
open -na Ghostty.app --args -e /Users/yuantian/Documents/Coding/omp-topology-network/packages/pi-topology/scripts/ghostty-role-smoke.sh oracle
open -na Ghostty.app --args -e /Users/yuantian/Documents/Coding/omp-topology-network/packages/pi-topology/scripts/ghostty-role-smoke.sh repair
open -na Ghostty.app --args -e /Users/yuantian/Documents/Coding/omp-topology-network/packages/pi-topology/scripts/ghostty-role-smoke.sh librarian
open -na Ghostty.app --args -e /Users/yuantian/Documents/Coding/omp-topology-network/packages/pi-topology/scripts/ghostty-role-smoke.sh scott
```

所有脚本应改成 MiniMax M3 + low/off thinking。

### 7.2 新增 integration smoke

建议新增：

```text
packages/pi-topology/test/integration/
```

至少覆盖：

- mission init -> status -> doctor -> cleanup 的文件级流程。
- local packet send/get/list。
- guard incident append。
- spawn script 带 initial_prompt/log_path。
- role registry heartbeat 或 registry write/read。

### 7.3 长一点的 dogfood 流程

建议跑一个 20-40 分钟的本地 dogfood：

1. supervisor 创建 mission。
2. supervisor spawn HQ、runner、oracle、librarian、scott。
3. HQ 给 scott/librarian 发 research request packet。
4. scott 回 research report packet。
5. librarian 回 evidence index packet。
6. HQ 给 runner 发 verification request packet。
7. runner 回 verification report packet。
8. oracle 读取 evidence 后给 risk report packet。
9. supervisor 读取所有 packets，更新 status board，记录 checkpoint。

不要依赖 `coms_await` 等长任务完成。用非阻塞 get/list 和 status board 驱动。

## 8. 不做事项

本轮不考虑：

- Package Hub 发布。
- GitHub release。
- HTTP/SSE net transport 的完整实现，除非本地稳定性需要；可以保持 compatibility target。
- OS-level sandbox。
- 华丽 UI。

本轮只追求本地稳定、可用、可狗粮。

## 9. 权限与执行授权

用户已明确授权：

- 使用 computer use / Ghostty 启动真实 Pi 测试。
- 测试可以长一些、复杂一些。
- 使用 MiniMax M3 进行 Pi 角色测试。
- 将 thinking 设为 low 或 off。
- 在当前项目内创建/修改 package 源码、测试、脚本、文档、records。
- 运行 `npm run smoke`、`pi install .`、`pi list`、Ghostty smoke。

遇到 sandbox / macOS approval，直接请求 `require_escalated`。

建议 justification：

```text
用户已在 2026-06-16 handoff 补充中授权使用 Ghostty 启动真实 Pi 测试，并要求以 MiniMax M3 low/off thinking 进行较长、较深入的本地稳定性 dogfood。
```

## 10. 成功验收门

明早前，至少应达到：

- `npm run smoke` 通过。
- `pi install .` 通过。
- `pi list` 能看到当前 package。
- supervisor Ghostty smoke 通过。
- HQ / repair / runner / oracle / librarian / scott 至少各有一次真实 Ghostty role smoke log。
- `topology_spawn_role` 能启动 role 并自动写 role log。
- local packet 往返 smoke 通过，且证据写入 runtime event log。
- guard block smoke 通过，且 incident log 有记录。
- docs/readiness/records 准确标出已验证与未验证，不夸大。

## 11. 不允许带开放尾巴停下来

下一 session 不应在普通 closeout 中留下“还有几个未完成项”。只有两种结束方式：

### 11.1 成功结束

满足第 10 节成功验收门，并且 final report 只包含：

- 已完成项。
- 验证命令和结果。
- 真实 dogfood logs 路径。
- 仍未纳入本轮范围的事项，例如 Package Hub 或 HTTP/SSE net transport。

注意：这些“不纳入本轮范围”的事项不能写成未完成项。

### 11.2 阻塞结束

只有遇到外部不可控阻塞时才能停，例如：

- MiniMax/Pi provider 不可用。
- Ghostty/macOS 无法启动或权限被拒。
- Pi CLI 本身崩溃且三次复现。
- 需要 owner 提供凭据或人工选择。

阻塞结束必须提供：

- 阻塞复现命令。
- log 路径。
- 已尝试的至少三种恢复动作。
- 下一条最小 owner action。

如果只是测试失败、代码缺功能、文档没同步、角色没补齐、packet smoke 没写完，这不算可汇报阻塞；继续修。

## 12. 新 session 起始提示

建议新 session 第一条用户消息：

```text
请先阅读 /Users/yuantian/Documents/Coding/omp-topology-network/docs/handoffs/2026-06-16-pi-topology-package-local-stability-handoff.md，然后开启目标模式。你的目标不是 Package Hub 发布，而是让 packages/pi-topology 在本地 Pi + Ghostty 中稳定可用。真实 Pi 测试全部优先使用 MiniMax M3，thinking low 或 off。请适当使用 gpt-5.3-codex-spark subagent 分担探查、批量写入和局部验证，主 session 负责调度、集成和最终判断。请补齐 spawned role 自动落证、local packet 往返、runtime event log、guard 真实 smoke，并扩展 librarian/scott 调研角色。不要在 closeout 里留下本轮未完成项；除非遇到外部不可控阻塞，否则持续修到第 10 节验收门通过。遇到 sandbox/macOS approval 直接请求。
```

## 13. 2026-06-16 执行结果

本 handoff 的本地稳定性目标已完成到本轮定义边界：本地 Pi + Ghostty + MiniMax M3 可狗粮、可审计、可恢复；HTTP/SSE transport 与 Package Hub 发布仍明确不纳入本轮。

### 已满足的验收门

- `npm run smoke` 通过：25 个 Node unit tests、strip-types import、`npm pack --dry-run`。
- `npm run guard-smoke` 通过：8 条 persisted incident + 8 条 `guard_block` runtime event。
- `pi install .` 通过，输出 `Installed .`。
- `pi list` 显示本地 package 指向 `/Users/yuantian/Documents/Coding/omp-topology-network/packages/pi-topology`。
- supervisor MiniMax M3 + Ghostty smoke 通过。
- spawned HQ 通过 `topology_spawn_role(mode=launch)` 启动，并写入同一 mission workdir 的 runtime event 与 local outbox。
- `hq` / `repair` / `runner` / `oracle` / `librarian` / `scott` 六个角色均有 MiniMax M3 + Ghostty role smoke log。
- 本地 structured packet flow 写入 outbox/inbox/runtime-events，可复核。
- docs/readiness/records 已更新，不把 HTTP/SSE transport 或 Package Hub 写成已验证。

### 关键证据路径

- clean run root: `/tmp/pi-topology-dogfood-minimax-clean-2026-06-16`
- supervisor log: `/tmp/pi-topology-dogfood-minimax-clean-2026-06-16/logs/supervisor-smoke.log`
- spawned HQ log: `/tmp/pi-topology-dogfood-minimax-clean-2026-06-16/logs/hq-spawned.log`
- role logs: `/tmp/pi-topology-dogfood-minimax-clean-2026-06-16/logs/`
- runtime events: `/tmp/pi-topology-dogfood-minimax-clean-2026-06-16/workdir/.pi/topology/runtime-events.jsonl`
- local outbox: `/tmp/pi-topology-dogfood-minimax-clean-2026-06-16/coms/projects/pi-topology-dogfood/packets/outbox.jsonl`
- guard smoke: `/tmp/pi-topology-guard-smoke/.pi/topology/incident-log.jsonl` and `/tmp/pi-topology-guard-smoke/.pi/topology/runtime-events.jsonl`

### 真实 dogfood 暴露并修复的问题

- Pi launch script 曾使用无效 flags `--purpose` / `--prompt`，已修为 `--name` / `-p`。
- spawned role 曾未进入 mission workdir，导致 runtime events 不在同一证据面，已通过 `PI_TOPOLOGY_WORKDIR` + `cd` 修复。
- Scott 真实 MiniMax run 曾重复发送空 `REPORT`，已通过 packet schema 禁止空 body，并收窄 role smoke prompt 到一次 `topology_send`。
- Ghostty 窗口曾因脚本在 TTY 下等待 Enter 而堆积；现在默认不等待，只有 `PI_TOPOLOGY_WAIT_ON_EXIT=1` 才保留窗口。测试轮次结束或污染后应关闭对应 Ghostty/Pi 进程，只保留日志和 JSONL 证据。

### 本轮仍不外推的边界

- HTTP/SSE transport 仍是 compatibility target。
- Package Hub 发布/安装仍未实测。
- owner gate 之后的长任务 checkpoint 流程还需要后续更长 dogfood 复测。
