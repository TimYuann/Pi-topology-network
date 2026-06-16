# Pi Topology Native Alignment Blueprint

日期：2026-06-16
项目：OMP拓扑网络 / `packages/pi-topology`
状态：执行中

## 目标

在保持 OMP拓扑网络最小可用能力的前提下，把 `pi-topology-network` 从“在 Pi 上再造一层重编排 runtime”收回到“优先复用 Pi 原生 extension / package / UI 能力，同时坚持可见性 Mesh”的轻量实现路径。

核心目标只有两个：

1. 降低无效 token 消耗，尤其是 Supervisor / HQ 因控制包、重复包、closeout 包而被反复唤醒和长篇解释的开销。
2. 降低自造 runtime 面积，但不把多角色可见性替换成单 terminal replacement 流程。

## 官方对齐基线

本轮以 Pi 官方文档为优先依据：

- [Extensions](https://pi.dev/docs/latest/extensions)
- [Packages](https://pi.dev/docs/latest/packages)

当前重构特别对齐这些能力面：

- `pi.sendMessage(...)`
- `pi.appendEntry(...)`
- `resources_discover`
- `session_start` / `session_shutdown`
- custom tool `promptSnippet` / `promptGuidelines`
- `ctx.ui.setStatus(...)` / `ctx.ui.setWidget(...)`

## 已确认的问题模型

基于 2026-06-16 11:11 / 11:14 这组 Supervisor / HQ transcript 和当前实现，重问题集中在四类：

1. 控制包直接进 LLM turn。
2. 同一 packet 被 `list/get/await` 多次重放进 transcript。
3. closeout 后仍继续 closure-of-closure。
4. packet inspection 与 closeout 汇总过重，把本应走 artifact 的正文反复灌进主会话。

## 重构原则

### 1. 可见性优先，原生减重为辅

凡是 Pi 已有明确原生能力的能力面，优先拿来做减重；但不以牺牲多角色可见性为代价：

- 非上下文持久状态：优先 `pi.appendEntry`
- UI 状态：优先 `setStatus / setWidget`
- tool 可见性与调用提示：优先 `promptSnippet / promptGuidelines`

不把 session replacement 作为 topology 主模式。Supervisor 继续是默认 human-facing 窗口；HQ/Runner/Oracle/Repair 保持可见 peer session。

### 2. packet 只承载必要角色间业务语义

保留 packet-first，但收缩 packet 的使用边界：

- 业务派发、业务 ACK、业务 REPORT、VERDICT：保留
- owner approval 记录：不走 packet
- generic log / checkpoint marker：不走 packet
- 已闭环 packet 的重复重投递：runtime 吃掉，不再触发新 turn

同时坚持：

- 原始证据优先落 artifact
- packet 只传摘要、状态、路径、下一步
- 不用 inline 大段 JSON / verdict body 污染会话

### 3. terminal packet 不再唤醒长思考

以下包默认视作终止型控制包：

- 已闭环 `ACK`
- `VERDICT` with `next=stand_down`
- idempotent duplicate ACK / STATUS

这些包应尽量：

- 只落持久记录
- 最多更新 UI / footer
- 不触发新的完整 LLM 回合

### 4. 最小化外部状态

外部 JSONL / JSON 文件只保留审计必需项，不再把它们扩成第二套 runtime：

- mission card：保留
- status board：保留，但减少从 packet replay 回写的噪声
- incident log：保留
- runtime events：保留
- session ledger：收缩用途，不再承担 session 真相来源

## Mesh 设计结论

### Supervisor

- 唯一默认 human-facing 窗口
- 负责 mission intake、owner gate、phase 切换、状态总览、最终 owner 汇报
- 不直接承受所有原始业务细节

### HQ

- 不是中心化“所有人都向我汇报”的 PM 总线
- 更接近收口层与判断层
- 只在需要它判断时接收信息

### Worker 闭环

默认原则：

1. 谁发起任务，谁先收结果。
2. 能在局部闭环的，不上卷。
3. Oracle 可直接给 Repair 下一步修复判断；HQ 只收需要升级判断的结果。
4. Supervisor 只在 owner 决策、phase 切换、终态 closeout 时介入。

### 三层通信

1. Data plane
   - 原始测试结果、review 长文、inventory
   - 走 artifact
2. Decision plane
   - `GO / NO-GO / CONDITIONAL-GO / BLOCKED / NEEDS-REVIEW`
   - 走 compact packet
3. Control plane
   - launch、gate、phase、closeout
   - 由 Supervisor / HQ 管理

## 本轮执行范围

### A. 立即执行

1. 给 `topology_*` 自定义工具补 `promptSnippet / promptGuidelines`
2. 收缩 inbound packet 处理：
   - terminal / duplicate 包不再 `triggerTurn`
   - 优先 `appendEntry`，必要时才 `sendMessage`
3. 增加 duplicate / terminal packet 判定
4. 为以上行为补回归测试
5. 记录 devlog 和验证结果

### B. 本轮继续执行

1. 减少 `topology_list/get/await` 对 transcript 的正文重放
2. 减少 `packet_received` 事件重复落盘
3. 收缩 `session_ledger` 的职责
4. 保持 `/topology spawn hq` 为 visible mesh guidance，而不是 terminal replacement

### C. 暂不在本轮改动

1. 全量移除 `topology_spawn_role` 的外部 launch script 机制
2. 完整替换 local-coms transport

## 设计落点

### Inbound handling 轻量化

当前：

- live endpoint 一收到包就 `sendMessage(..., triggerTurn: true)`
- 所有包一视同仁进入模型上下文

目标：

- 先分类 packet
- terminal / duplicate / idempotent 包：
  - `appendEntry("topology-log", ...)`
  - 最多 `setStatus` / `setWidget`
  - 默认不触发 turn
- actionable 包：
  - 再 `sendMessage`

### Live-First Dashboard

Dashboard / footer / widget 不应把 mission 里定义过的全部角色默认展开成“当前网络里存在的 session”。

正确来源顺序：

1. 当前 session
2. peer registry 中 heartbeat 新鲜的 live peer
3. 必要时补充 `launch_requested` 角色，作为 planned / pending，而不是 live

因此：

- 未真实派生的 HQ / Runner / Oracle 不应提前显示
- 旧 `alive_confirmed` 但 heartbeat 过期的 peer 不应继续显示为 live
- status board / session ledger 只能作为辅助证据，不能覆盖 live registry 真相

### Mesh Spawn

`/topology spawn hq` 在 visible mesh 模式下不是 replacement。

它应该：

1. 仍保持当前窗口是 Supervisor
2. 在 owner gate clear 后真正触发 HQ launch request
3. 由 registry / heartbeat 证明 HQ 是否成功成为 live peer

也就是说：

- `/topology spawn hq` 不是单纯 guidance
- 也不是当前 terminal handoff
- 而是 Supervisor 对 HQ 的可见 peer 派生入口

### Tool prompt 对齐

当前：

- `topology_*` 工具虽然注册了，但没有 `promptSnippet / promptGuidelines`

目标：

- 每个核心工具至少给一句 prompt snippet
- 高风险工具给 2-4 条简明 guidelines
- 让 Pi system prompt 自己把工具使用边界前置给模型

### Duplicate closure 收口

当前：

- 同一 request 链路关闭后，旧包 resurfaced 仍可能再次走模型

目标：

- 记录 closed request ids / terminal packet ids
- 再次遇到时只做 no-op persistence
- 不再要求 HQ / Supervisor 额外写解释性 closeout prose

## 验收标准

本轮不追求“全部 native 化”，而追求可量化减重且保留可见性：

1. terminal `ACK` / `VERDICT stand_down` 不再默认触发新 LLM turn
2. duplicate inbound packet 不再触发 closure-of-closure
3. `topology_*` 工具在注册面具备 prompt metadata
4. `topology_get/list` 默认只给 compact summary，不回放整块 packet JSON
5. `/topology spawn hq` 不再走 replacement 主路径
6. package skill 在 `pi install` 和 `pi -e ./index.ts` 开发加载两条路径下都能被 Pi 官方 skill discovery 找到
7. 现有单元测试与 smoke 仍通过
8. devlog 留下每一步决策、改动、验证和剩余风险

## 2026-06-16 官方 API 复核追加结论

补读 Pi 官方 Sessions / Extensions / Skills / Packages 文档后，确认本项目不应再把 package 内置 skill 只押在 `package.json` 的 `pi.skills` manifest 上。

`pi install` 目录包会按 package 规则加载 `skills/`，但开发期常用的 `pi -e /path/to/packages/pi-topology/index.ts` 是按单文件 extension 加载；此时如果扩展不额外返回 skill path，`/skill:topology-runtime` 可能退回到全局 skill 搜索，出现查找 `~/.pi/agent/skills/topology-runtime/SKILL.md` 的失败。

修正策略：

- 保留 `package.json` 的 `pi.skills`
- 扩展注册 `resources_discover`
- 由 `resources_discover` 返回 `packages/pi-topology/skills`

这样 package 安装路径与 `-e` 开发路径都走 Pi 官方资源发现机制，不再自造 skill resolver。

## 非目标

本轮不是：

- 重写整套 topology protocol
- 删除所有审计文件
- 直接把 mesh 改成单纯中心化 subagent
- 宣称 HTTP/SSE transport 已验证

## 执行说明

本蓝图批准后直接执行；无需额外 owner 审核门。所有实现改动与验证结果持续记录到：

- `records/2026-06-16-pi-topology-native-alignment-devlog.md`
