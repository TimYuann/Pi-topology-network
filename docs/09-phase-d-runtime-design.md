# Phase D Pi-first Runtime Design

日期：2026-06-15
状态：Phase D 设计基线

## 1. 目标

Phase D 的目标不是再启动一组固定 session，而是在 Pi runtime / Extension 层形成一套轻量、可审计、可动态派生的多 Agent 工作网络。

最终入口体验：

```text
owner 打开一个 Pi topology session
owner 说明今天在哪个 workdir 工作、目标是什么
topology-supervisor 读取项目状态并和 owner 对齐计划
owner 批准 mission card
topology-supervisor 派生所需角色 session
网络开始执行、巡检、记录证据、在 owner gate 处暂停
```

`pi-vs-cc` 仓库用于理解和开发 Pi extension，但最终运行目标是 Pi runtime 内的 extension 组合。本项目保存 canonical 协议、角色预设、运行模板、测试计划和审计格式。

## 2. 运行面定位

主运行面：

```text
Pi runtime / Pi Extension
```

参考实现与开发仓库：

```text
/Users/yuantian/Documents/Coding/pi-vs-cc
```

Canonical 协议与运行资产：

```text
/Users/yuantian/Documents/Coding/omp-topology-network
```

OMP 是历史验证和兼容参照，不是 Phase D 主攻面。Phase D 文档、模板和脚本应按 Pi-first 设计；如提到 OMP，只说明兼容或历史证据。

## 3. 核心角色

### 3.1 topology-supervisor

第一个由 owner 打开的 Pi session。它是 owner-facing control plane，合并了早期 governor 的 owner 收口职责，并新增 runtime 管理职责。

职责：

- 读取项目状态：`AGENTS.md`、`README.md`、`PROGRESS`、handoff、git/worktree 状态。
- 和 owner 对齐今日目标、风险、边界、验收口径。
- 生成或更新 mission card。
- 决定需要派生哪些角色。
- 调用 supervisor 能力启动或恢复角色 session。
- 写入 status board、incident log、runtime event log。
- 监听 context health、heartbeat、pending packets、owner gate。
- 在 scope 扩张、破坏性命令、git write、权限不明时暂停并请 owner 决策。

禁止：

- 不直接做业务代码修复。
- 不把业务验证报告塞入 lifecycle reply。
- 不绕过 damage-control。

### 3.2 hq

开发工头。接收 mission，拆 slice，管理授权、证据合流和 verdict。

职责：

- 将 owner goal 拆成 scoped slices。
- 给 repair / runner / oracle 派发标准 packet。
- 合并 business evidence、transport evidence、inference。
- 产出 `GO` / `NO-GO` / `Conditional-GO` / `BLOCKED`。
- 在需要 owner 决策时回传 owner gate。

禁止：

- 不作为人工转发器阻塞等待所有下游。
- 不默认写代码。
- 不把 repair self_check 当正式验证。

### 3.3 repair

授权范围内的唯一默认 writer。

职责：

- 只改 mission / slice 明确授权的路径。
- 做最小 self_check。
- 回传 diff summary、risk、self_check、recommended verification。
- 如果 HQ packet 带有 `verification_contract`，可直接向 runner 发送 `VERIFY_REQUEST repair -> runner`。

禁止：

- 不扩大 scope。
- 不 commit / push。
- 不自行宣布 verification pass。

### 3.4 runner

正式验证来源。

职责：

- 执行 smoke、test、artifact 读取和复现。
- 接收 HQ 或 repair 按 contract 发来的 verify request。
- 将验证结果回传给 HQ。
- 可向 repair 发送 `INFO runner -> repair` 说明失败 artifact，但不授权 repair 扩 scope。

禁止：

- 不修改代码。
- 不做最终 scope 决策。

### 3.5 oracle

独立审查。

职责：

- 审查风险、证据质量、验收口径和角色边界。
- 给 HQ 回传 review verdict。

禁止：

- 不修代码。
- 不替 runner 跑正式验证链路。

## 4. 启动路径

### 4.1 owner 入口

owner 在业务项目 workdir 打开第一个 Pi topology session：

```bash
cd /Users/yuantian/Documents/Coding/ekunAi
pi \
  -e /Users/yuantian/Documents/Coding/pi-vs-cc/extensions/coms.ts \
  -e /Users/yuantian/Documents/Coding/pi-vs-cc/extensions/damage-control-continue.ts \
  -e /Users/yuantian/Documents/Coding/pi-vs-cc/extensions/theme-cycler.ts \
  --cname topology-supervisor \
  --project ekunai-topology \
  --purpose "Owner-facing topology supervisor"
```

未来应收敛成一个 `topology-runtime.ts` 或 launcher 命令；第一版可由 `topology-supervisor.sh` 打印或执行等价命令。

### 4.2 intake

topology-supervisor 首轮只做 read-only intake：

1. 读取项目 `AGENTS.md` / `README.md` / `PROGRESS` / handoff。
2. 读取本项目 topology protocol。
3. 输出 Today Topology Plan。
4. 等 owner 批准 mission card。

### 4.3 dynamic spawn

owner 批准后，topology-supervisor 根据 mission card 派生角色：

```text
required_roles = hq + roles_needed_by_plan
optional_roles = oracle / repair / runner
```

派生时必须注入：

- shared protocol。
- role prompt。
- mission card 摘要。
- allowed_paths / forbidden_actions。
- report target。
- context / TTL / nudge limits。

第一版可通过 Ghostty / `open -n` 启动独立 Pi session；后续可由 Pi extension 内部 `spawn("pi", args)` 启动 headless 或 foreground worker。

## 5. 通信模型

Phase D 不以 `coms_await` 作为长任务主控。长任务使用 event-driven packet 回传。

### 5.1 三类通道

1. `lifecycle_reply`
   - 原 `msg_id` 的 direct final reply。
   - 只允许 `ACK` / `BLOCKED` / `NEEDS_CLARIFICATION` / `DISPATCH_RECEIPT`。
   - 用于完成当前 inbound，不承载业务正文。

2. `business_packet`
   - `coms_send target=<peer>`。
   - 承载 `MISSION` / `REPORT` / `STATUS` / `CHECKPOINT` / `VERIFY_REQUEST` / `AUTHORIZATION`。
   - 必须结构化，包含 `mission_id`、`slice_id`、`request_msg_id`、`authority_source`。

3. `runtime_event`
   - 写入 status board / incident log / future Web UI event stream。
   - 记录 spawn、heartbeat、context health、damage block、late pending、owner gate。

### 5.2 await 口径

`coms_await` 只保留两类用途：

- 短窗口 direct ACK smoke / debug。
- 手工排查某个 msg_id 的 lifecycle reply。

禁止把 `coms_await` 用作 repair、smoke、long verification 的 completion wait。HQ / supervisor 应记录 packet 后回到调度态，由 worker 主动 REPORT。

### 5.3 packet envelope

标准 packet 第一行：

```text
<TYPE> <sender> -> <target>
```

必填字段：

```text
mission_id:
slice_id:
request_msg_id:
authority_source:
packet_type:
expected_response:
report_target:
allowed_paths:
forbidden_actions:
deadline_or_sla:
payload:
```

## 6. Repair / Runner 预授权网状流

为减少 HQ 人工转发，HQ 给 repair 的 packet 可以包含 `verification_contract`：

```text
verification_contract:
  runner_target: runner
  allowed_commands:
  allowed_artifacts:
  report_target: hq
  authority_source: <hq_msg_id>
```

流程：

1. HQ 派 `FIX_REQUEST hq -> repair`，包含 `verification_contract`。
2. Repair 完成 scoped fix。
3. Repair 发送 `REPORT repair -> hq`。
4. Repair 同时发送 `VERIFY_REQUEST repair -> runner`，必须带 `authority_source=<hq_msg_id>`。
5. Runner 验证后发送 `REPORT runner -> hq`。
6. Runner 可发送 `INFO runner -> repair` 提供失败 artifact，但不授权 repair 扩 scope。
7. HQ 合并 repair / runner / oracle evidence 后做 verdict。

这允许横向通信减少摩擦，同时保留授权来源。

## 7. Damage Control

Pi 已有 `damage-control.ts` 和 `damage-control-continue.ts`，可在 `tool_call` 层拦截：

- dangerous bash。
- zero access paths。
- read-only paths。
- no-delete paths。

Phase D 应新增 mission-aware rule overlay：

```text
mission card -> role policy -> damage-control rules
```

示例：

- oracle / runner：全部业务路径 read-only。
- repair：只有 `allowed_paths` 可写。
- 所有角色：`git add` / `git commit` / `git push` 默认 forbidden，owner 单独授权后才临时放行。
- destructive commands 默认 block 或 owner confirm。

第一版可生成 `.pi/topology/damage-control-rules.generated.yaml`，并在 launcher 中复制或合并到 `.pi/damage-control-rules.yaml`。后续可在 extension 中动态 overlay，不落盘覆盖用户已有规则。

## 8. Status Board

status board 是 runtime truth source，不是汇报文案。

必须追踪：

- mission_id
- runtime_phase
- owner_goal
- active_slice
- owner_decisions
- peer_status
- pending_packets
- active_workers
- allowed_paths
- forbidden_actions
- next_gate
- last_checkpoint_at
- context_health
- incidents

status board 必须允许 future Web UI 直接读取和渲染。

## 9. Incident Log

incident log 使用 append-only JSONL。

必须记录：

- `late_pending`
- `complete_empty`
- `channel_violation`
- `packet_wording_violation`
- `transport_blocked`
- `hop_limit`
- `undefined_msg_id`
- `nudge_limit_exceeded`
- `scope_violation`
- `role_boundary_violation`
- `damage_control_block`
- `owner_gate`
- `context_high`
- `peer_not_visible`

incident 不等于业务失败；它是审计证据。

## 10. Watchdog

watchdog 是巡检器，不是执行者。

第一版能力：

- 每 5-10 分钟读取 status board。
- 检查 checkpoint 是否超时。
- 检查 pending packet 是否超过 SLA。
- 检查同一 peer nudge 是否超限。
- 检查 context health 是否接近阈值。
- 检查 owner gate 是否 pending。
- 输出下一步建议，不直接改业务文件。

后续可接入 Pi widget / Web UI。

## 11. Future Web UI Readiness

所有事件必须结构化，避免未来 Web UI 只能解析自然语言。

建议 event stream：

```json
{
  "event_id": "evt_...",
  "event_type": "packet_sent",
  "mission_id": "p6-phase-d-8h-001",
  "slice_id": "slice-a",
  "actor": "hq",
  "target": "runner",
  "timestamp": "2026-06-15T00:00:00Z",
  "payload_ref": "status-board.pending_packets[0]",
  "severity": "info"
}
```

未来 UI 可以是：

- topology graph。
- wireless canvas。
- role health board。
- packet timeline。
- owner gate inbox。
- evidence / artifact panel。

## 12. 外部方法论借鉴

本设计借鉴但不照搬以下模式：

- OpenAI Agents SDK：manager-style agents-as-tools 适合中心合流；handoff 适合专家接管。
- Claude Code subagents：独立上下文、工具权限、后台任务有利于成本和上下文隔离。
- LangGraph：routing、parallelization、orchestrator-worker 和 state graph 适合表达长流程。
- OpenHands：GUI / REST API / sandbox / 多界面说明未来控制平面应把执行、观察和权限分离。

本项目选择轻量 Pi extension 路线：用 Pi 的 hook、widget、session、tool_call interception 和 coms primitive 组合出足够 robust 的工作网络。
