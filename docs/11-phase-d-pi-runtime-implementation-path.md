# Phase D Pi Runtime 实施路径（Pi-first）

日期：2026-06-15  
状态：执行路径草案（落地基线）

本文件在现有 `docs/09-phase-d-runtime-design.md`、`docs/10-phase-d-first-8h-test-plan.md`、`scripts/topology-supervisor.sh`、`scripts/topology-watchdog.sh` 基础上补齐“Pi runtime 实施路径”。  
核心原则：**以 Pi 为主线（Pi-first），OMP 只保留兼容对照；本文件不改 `pi-vs-cc` 仓库。**

## 1. 目标与边界

- 第一优先级是让 `topology-supervisor` 在 Pi 里承担 owner-facing runtime control plane，完成 intake → mission 审批 → 动态派生 → 证据可回放的闭环。
- 采用 `topology-supervisor.sh` 脚本化启动（打印或 launch）与 `topology-watchdog.sh` 审核模式，先跑“外壳级 MVP”，再同步到 `pi-vs-cc` extension 层。
- 不直接推动 OMP 固定五角色作为 Phase D 主形态；任何 OMP 运行实践只作为兼容/历史验证，不作为当前主运行路径。
- 保持 `docs/roles/` 的角色边界与 `shared protocol` 不变：`topology-supervisor` 唯一负责启动/恢复角色，`hq` 只派发且聚合，`repair` 唯一默认写代码角色，`runner` 负责 formal verification，`oracle` 只 review，不写代码。

## 2. 统一上线对象（Input → Control → Evidence）

### 2.1 输入资产（本仓库）

- 运行基线：`docs/09-phase-d-runtime-design.md`
- 验收跑法：`docs/10-phase-d-first-8h-test-plan.md`
- 入口执行：`scripts/topology-supervisor.sh`（打印/启动角色、注入 shared protocol + role prompt）
- 巡检执行：`scripts/topology-watchdog.sh`（status board + incidents 的非写业务巡检）
- 任务与文件模板：`templates/mission-card.phase-d.json`、`templates/status-board.phase-d.json`、`templates/incident-log.phase-d.jsonl`、`templates/runtime-events.phase-d.jsonl`

### 2.2 目标状态（runtime）

1. owner 打开一个 `topology-supervisor` Pi session（带 `coms.ts` + `damage-control-continue.ts` + `theme-cycler.ts`）。
2. owner 做 intake + mission card 审批后才允许派生 `hq` / `repair` / `runner` / `oracle`。
3. `topology-supervisor` 写入 `status board` 与 `incident log`，不以业务长文本替代结构化 packet。
4. `watchdog` 每 5–10 分钟复核 `checkpoint`、`pending`、`peer`、`context`、`owner gate`，仅输出巡检建议。

## 3. MVP implementation steps（Pi-first）

### Step 0：基线校验（启动前）

- 校验 `mission-card.phase-d.json` 包含：
  - `mission_id`、`project`、`workdir`、`runtime`、`owner`、`allowed_paths`、`forbidden_actions`、`checkpoint_interval_minutes`、`watchdog_interval_minutes`、`stop_conditions`。
- 校验 `scripts/topology-supervisor.sh --validate-only --mission <card>` 为通过状态。
- 定义 `PI_COMS_DIR` 与 `PI_TOPOLOGY_PROJECT`（同一次任务统一）；
  建议模板：`/tmp/pi-topology-<project>`.
- 明确 owner gate 条件（`scope expansion / destructive / git add|commit|push / 运行时决策歧义 / artifact 写回确认`）。

### Step 1：Supervisor 启动与 intake

- 先用 `pi` 命令在业务目录启动 `topology-supervisor`；
- supervisor 读取：
  - `AGENTS.md`、`README.md`、`docs/` 里的协议与状态文件；
  - `docs/09-phase-d-runtime-design.md`、`docs/10-phase-d-first-8h-test-plan.md`；
  - `templates/mission-card.phase-d.json`（mission 起草来源之一）。
- 生成或更新 `Today Topology Plan`，等待 owner explicit approval 后才走 spawn。

### Step 2：动态派生（由 supervisor 主控）

- `topology-supervisor.sh --print --mission ... [role ...]` 作为第一阶段的派生执行器：
  - 输出统一 CLI：同 `PI_COMS_DIR`、同一 project、统一 `--append-system-prompt`；
  - 对应 role 注入：
    - shared protocol
    - role prompt (`topology-supervisor` / `hq` / `repair` / `runner` / `oracle`)
    - mission card
    - damage-control extension
- 若 `--launch` 启动，默认只允许 owner 允许的窗口内逐个拉起；否则打印命令由 owner 接手。
- 首轮派生策略最小化：`hq`（必需），`repair`/`runner`/`oracle` 按 mission 与风险最小化触发。

### Step 3：通信与状态写入

- 所有业务消息走 `coms_send`；
  - ACK 仍用 lifecycle final 回复（`ACK / BLOCKED / NEEDS_CLARIFICATION` 这类最小口径）；
  - 报告正文一律走 `REPORT/STATUS` packet，不进原 `msg_id` final 业务正文。
- `status board` 与 `incident log` 作为唯一 truth source：
  - `topology-supervisor` 维持 `runtime_phase`、`active_slice`、`owner_decisions`、`peer_status`、`pending_packets`、`allowed_paths`、`forbidden_actions`、`next_gate`、`evidence_index`。
  - `incident log` 记录 late/complete-empty/channel/gate/damage-control 等事件。
- `watchdog` 只读审计：发现问题只写 checklist 或 incident，不改业务文件，不 kill 进程。

### Step 4：8 小时最小闭环

- 以 `checkpoint`（30–60m）为调度粒度，保持 `owner-facing summary` 的持续可恢复性。
- 每 5–10m 执行一次 watchdog 检查（脚本版）；
- 缺失关键动作（repair 自测、runner 验证、owner gate、coms 回复词）一律挂起并要求 owner 再决策。

## 4. Verification gates（建议验收门禁）

### Gate A：启动门禁

- mission card、workdir、project、roles、PI_COMS_DIR 校验通过；
- owner 对 mission card 给出明确批准；
- `scripts/topology-supervisor.sh --validate-only` 成功；
- `incident log` 与 `status-board` 路径可落盘。

### Gate B：通信门禁

- 任务派发后，receiver 先直接 ACK；
- `coms_await` 不用于 repair / smoke / long verification completion；
- `coms_await` timeout 只允许当作“窗口未回”
  的状态，不得直接等同失败；
- 同一 `request_msg_id` 的 owner-facing 报告正文不通过 final 回复输出。

### Gate C：执行边界门禁

- `repair` 仅在 mission 的 `allowed_paths` 范围内写文件；
- `runner` / `oracle` 不写业务代码；
- `git add/commit/push`、destructive 命令进入 owner gate；
- 缺失 scope 扩张授权立即 pause。

### Gate D：治理门禁

- `damage-control` 触发必须有 `incident` 记录（至少一类：`damage_control_block` / `scope_violation` / `owner_gate`）；
- `late_pending / complete_empty / channel_violation / hop_limit / nudge_limit_exceeded` 出现时纳入 evidence；
- `topology-watchdog` 的检查项有明确建议，不能空跑。

### Gate E：8 小时恢复门禁

- 醒来可重建：owner goal、active slice、peer 状态、checkpoint 历史、verification evidence；
- 无未授权 git 写操作；
- 有 formal verification 的 runner report；
- HQ（或相应 control）有 verdict 前置证据三元组（transport/business/inference）；
- 所有 `owner gate` 有明确原因或已清晰关闭。

## 5. 未来 Web UI event model（未来阅读端）

当前脚本阶段仅产出 JSON/JSONL；未来 Web UI 按 event stream 统一渲染。

### 推荐 event schema（基线）

保留已有字段并新增可视化必要字段：

- `event_id`（全局唯一）
- `event_type`
- `timestamp`
- `mission_id`
- `slice_id`
- `actor`
- `target`
- `severity`（info/warn/error）
- `payload_ref`（status board/incident 里对应条目引用）
- `evidence_ref`（可选）
- `peer_state` / `context_used_pct`（可选）

### 推荐 event 类型（初版）

- `runtime_boot`
- `spawn_request`
- `spawn_result`
- `packet_sent`
- `packet_reported`
- `packet_timeout`
- `lifecycle_ack`
- `owner_gate_enter`
- `owner_gate_exit`
- `checkpoint`
- `watchdog_finding`
- `verification_contract`
- `verification_result`
- `damage_control_block`
- `incident`

### UI 渲染建议

- 左上：runtime topology graph（节点=角色，边=packet 方向）  
- 中央：owner gate inbox（阻塞原因 + owner action）  
- 右上：事件时间线（packet / gate / watchdog）  
- 下方：evidence 面板（transport/business/inference 分类）  
- 状态栏：`runtime_phase / peer_health / pending_count / next_checkpoint_due_at`

## 6. Damage-control integration（接入方案）

### 6.1 目标规则映射（mission -> damage-control）

- `allowed_paths` -> `readOnlyPaths`（runner/oracle）、`readWritePaths`（repair）  
- `forbidden_actions` -> `bashToolPatterns`（阻断命令）、`zeroAccessPaths`（禁入路径）  
- `owner_gate_required_for` -> 触发 supervisor 发送 owner gate 事件 + incident（不直接执行）

### 6.2 当前阶段落地方式

- `topology-supervisor` 读取 mission，生成临时 rule 文件（如 `.pi/topology/damage-control-rules.generated.yaml`）；
- `pi` 启动时通过环境变量/参数注入该路径，供 `damage-control-continue.ts` 读取；
- block 发生时必须：
  1) 直接终止原 tool 调用；  
  2) 将原因写入 incident；  
  3) 由 supervisor/HQ 汇报 owner gate 或 retry strategy；  
  4) 禁止 silent retry 或换路径绕过。

### 6.3 未来落地到 `pi-vs-cc` 的建议文件清单（不在本次改动中执行）

- `/Users/yuantian/Documents/Coding/pi-vs-cc/extensions/coms.ts`
  - 原因：已具备 `coms-log` 与 inbound/outbound trace，但缺少对 `mission/slice/owner_gate` 的结构化 runtime-event 输出；应接收统一 event contract。
- `/Users/yuantian/Documents/Coding/pi-vs-cc/extensions/coms-net.ts`
  - 原因：v2 通信层正在演进，未来应与 coms 的 status board + topology gate 语义对齐，避免双栈口径不一致。
- `/Users/yuantian/Documents/Coding/pi-vs-cc/extensions/damage-control.ts` 与 `extensions/damage-control-continue.ts`
  - 原因：目前按项目/全局规则加载，需要支持 mission 级 overlay（allowed_paths/forbidden_actions/owner_gate）和标准化 block artifact。
- `/Users/yuantian/Documents/Coding/pi-vs-cc/extensions/theme-cycler.ts`
  - 原因：未来需给 topology 专用状态提示（owner gate / checkpoint / watchdog 视觉 cue），减少文本噪音。
- `/Users/yuantian/Documents/Coding/pi-vs-cc/scripts/launch-pi-topology-ghostty.sh`  
  - 原因：当前脚本以 governor/五角色为主线；需新增 `topology-supervisor` 入口和 mission-driven spawn policy。
- `/Users/yuantian/Documents/Coding/pi-vs-cc/scripts/coms-net-server.ts`
  - 原因：如后续切到 network 形态，需接入 topology runtime 事件总线（peer health + incident 事件转发）。
- `/Users/yuantian/Documents/Coding/pi-vs-cc/extensions/agent-team.ts`
  - 原因：应屏蔽与 topology 的历史重叠行为，避免将 topology 角色误判为 dispatch tool 或短任务 pool。

## 7. 与 OMP 兼容但不收口

- Pi-first 的目标不变：先打通 `topology-supervisor` + 动态派生 + structured packet + damage-control gate；
- OMP 兼容路径在 `docs/` 中保留原 OMP 参考，但不再作为 Phase D 主目标；
- `pi-vs-cc` 仅在“最终同步”阶段落地，不在当前任务中改任何外部文件。

## 8. 本次变更回报

- 已新建并仅修改文件：`docs/11-phase-d-pi-runtime-implementation-path.md`
