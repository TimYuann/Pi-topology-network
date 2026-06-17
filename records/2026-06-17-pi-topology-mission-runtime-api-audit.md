# Pi Topology Mission Runtime — API Audit

日期：2026-06-17
项目：OMP拓扑网络 / `packages/pi-topology`
审计者：Pi session (MiniMax-M3, Pi Harness)
审计对象：`docs/14-pi-topology-mission-runtime-spec.md` §11 alignment table + §15 open items
审计类型：官方文档对位 + 本地 Pi 行为验证
前置记录：`records/2026-06-17-pi-topology-mission-runtime-spec-review.md`（标出 4 项 spec 修改），`records/2026-06-16-pi-topology-official-api-audit.md`（本轮审计基线）

## TL;DR — Final Label Table

下列是 spec §11 alignment table 改版 + 增补后的最终 label。**本表取代 spec §11 与 §15 的 label 决策**。

| # | Capability | Final Label | 证据来源 |
| --- | --- | --- | --- |
| 1 | `pi.registerCommand` slash command | `supported` | 官方 docs + 本地 commands.ts:28,38 |
| 2 | `pi.registerTool` custom tool | `supported` | 官方 docs + 本地 tools.ts |
| 3 | `pi.registerFlag` CLI flag | `supported` | 官方 docs + 本地 register.ts:34,38（`--cname` / `--project`） |
| 4 | `pi.getFlag` 读 CLI flag | `supported` | 官方 docs + 本地 register.ts:42 |
| 5 | `pi.getCommands` 列出当前 slash command | `supported` | 官方 docs |
| 6 | `pi.getAllTools` 列出当前 tool | `supported` | 官方 docs |
| 7 | `pi.setActiveTools` 动态启用/禁用 tool | `supported` | 官方 docs |
| 8 | `resources_discover` event | `supported` | 官方 docs + 本地 register.ts:53 |
| 9 | `session_start` / `session_shutdown` event | `supported` | 官方 docs + 本地 register.ts:57,114 |
| 10 | `session_before_switch` / `session_before_fork` event | `supported` | 官方 docs |
| 11 | `ctx.newSession(options?)` 派生新 session | `supported`（in-extension only） | 官方 docs |
| 12 | `ctx.switchSession(sessionPath, options?)` 切换到 prior session | `supported`（in-extension only, by file path） | 官方 docs |
| 13 | `pi --session <path\|partial-uuid>` CLI session resume | `supported`（CLI 进程级） | 官方 docs sessions § Session Storage |
| 14 | `pi -r` / `/resume` 交互式 session picker | `supported` | 官方 docs sessions § Resuming and Deleting Sessions |
| 15 | `pi --fork <path\|partial-uuid>` session fork | `supported` | 官方 docs sessions § Session Storage |
| 16 | `pi.sendMessage(message, options?)` | `supported` | 官方 docs + 本地 commands.ts:765, register.ts:131,179 |
| 17 | `pi.sendUserMessage(content, options?)` | `supported` | 官方 docs |
| 18 | `pi.appendEntry(customType, data?)` | `supported`（**不**参与 LLM context） | 官方 docs + 本地 register.ts:167 |
| 19 | `deliverAs: "steer" \| "followUp" \| "nextTurn"` | `supported`（intra-session timing only） | 官方 docs |
| 20 | `ctx.ui.select` / `confirm` / `input` / `editor` / `notify` | `supported` | 官方 docs |
| 21 | `ctx.ui.setStatus` / `setWidget` / `setFooter` | `supported` | 官方 docs + 本地 ui.ts:72, register.ts:122 |
| 22 | `ctx.ui.custom()` TUI 组件 | `supported` | 官方 docs |
| 23 | `ctx.ui.setWorkingMessage` / `setWorkingIndicator` / `setWorkingVisible` | `supported` | 官方 docs |
| 24 | `keyHint()` / `keyText()` keybinding hint | `supported` | 官方 docs |
| 25 | `package.json` `pi` key（extensions/skills/prompts/themes） | `supported` | 官方 docs packages + 本地 package.json |
| 26 | Convention directories（extensions/skills/prompts/themes/） | `supported` | 官方 docs |
| 27 | `pi install`（npm / git / local / path） | `supported` | 官方 docs + 本地 `pi --help` |
| 28 | `pi list` / `pi remove` / `pi update` | `supported` | 官方 docs |
| 29 | `pi -e` / `--extension` 临时加载 | `supported` | 官方 docs + handoff §7 |
| 30 | `pi config` 启用/禁用 package resources | `supported` | 官方 docs packages § Enable and Disable Resources |
| 31 | Scope: `~/.pi/agent/settings.json` vs `.pi/settings.json` | `supported` | 官方 docs + 本地 ~/.pi/agent/settings.json 存在 |
| 32 | Cross-session role routing (any combination) | **`not_supported_by_pi`**（必须 `local_protocol`） | 官方 docs 全文未见此 primitive |
| 33 | Visible peer script launch（OMP 自有 `pi --provider ... --model ...` 模式） | `local_protocol` | 非 Pi API，是 OMP 兼容目标 |
| 34 | HTTP/SSE transport | `compatibility_target`（本轮不引入） | 官方 docs 不涉及，OMP 历史兼容目标 |
| 35 | Ghostty GUI unattended launch | `local_environment_risk`（非 API 维度） | 本地 terminal 行为，与 Pi API 无关 |
| 36 | OMP business-level states（Mission park/close、role park/close、packet 状态、incident 状态） | `local_protocol`（无 native 替代） | Pi lifecycle 事件（session_start/shutdown 等）≠ OMP 业务级状态 |

**本表与 spec §11 原始 11 行的差异**：

- spec §11 标 `pending_api_audit` 的 "Native resume by prior session id" —— 本审计改 `supported`，但**区分两层**（CLI `pi --session` vs in-extension `ctx.switchSession`）
- spec §11 标 `compatibility_target` 的 "Native visible peer session spawn" —— 本审计改 `local_protocol`（capability 名字错位，详见 §1.3）
- spec §10/§15.4 标 `pending_api_audit` 的 `ctx.ui.select/custom` —— 本审计改 `supported`（详见 §3.1）
- 新增 24 项 spec §11 未列但官方支持的 capability（#3-7, 10, 12, 15, 17, 20, 22-24, 28-30）
- 新增 1 项明确不存在的 capability（#32 cross-session role routing），避免 spec 之后再来问

---

## 1. Sessions

### 1.1 `ctx.newSession(options?)` — in-extension session spawn

#### Official evidence
- [pi-extensions#ctx-newsession-options](https://pi.dev/docs/latest/extensions#ctx-newsession-options)
- 签名：`ctx.newSession({ parentSession?, setup?, withSession? })`
- `setup`：在 withSession 运行前 mutate 新的 SessionManager
- `withSession`：post-switch 回调，使用 replacement-session ctx（不能用 captured old ctx）
- `parentSession`：parent session file 记到新 session header
- 调用上下文：**command / event handler 内部**（in-extension only），不能在另一个 `pi` CLI 进程里调

#### Local behavior
- 本地扩展 `src/extension/` grep 结果：**未使用** `ctx.newSession`
- 本地 spec §6.2 launch modes 也不依赖 `ctx.newSession`（用 CLI 子进程派生）

#### Inference
- 能力存在但 OMP 当前**没用**
- spec §13 slice 7 之前的 6 个 slice 不需要这个 primitive
- **Label final**: `supported`（in-extension only），spec §11 可加一行但本轮不必实现

#### Local gap
- spec §6.2 launch mode 没列 `ctx.newSession()` 作为派生选项，**这是合理的**：visible peer script 必须新开进程才能被 owner 看见，`ctx.newSession()` 派生出的 session 在 extension 内部，**对 owner 不可见**（不写 status board 的 visible peer row）

### 1.2 `ctx.switchSession(sessionPath, options?)` — in-extension session resume

#### Official evidence
- [pi-extensions#ctx-switchsession-sessionpath-options](https://pi.dev/docs/latest/extensions#ctx-switchsession-sessionpath-options)
- 签名：`ctx.switchSession(sessionPath, options?)`，**`sessionPath` 是 session file 的绝对路径**（不是任意 id）
- `withSession` 回调：post-switch 注入
- 触发 `session_before_switch`（可 cancel）→ `session_shutdown` → `session_start { reason: "resume", previousSessionFile }`
- 调用上下文：in-extension only
- 配套 API：`SessionManager.list(cwd)` / `SessionManager.listAll()` —— 列出当前 cwd / 全部 session file

#### Local behavior
- 本地扩展 grep：**未使用** `ctx.switchSession`
- 当前 OMP role 启动走 CLI 子进程派生 + 本地 packet 协议
- spec §6.3 resume order 走的是本地 sessions.jsonl + 5 态分类

#### Inference
- 能力存在但 OMP 当前**没用** —— 因为 OMP role 进程是 CLI 派生的独立进程，不能 in-extension switch
- **若 spec 想用 in-extension resume，必须改成 "supervisor 通过 `ctx.switchSession` 切到某 role 的 prior session file"** —— 但这等于把 supervisor 跑在 role session 里，**破坏 visible peer mesh** 模式
- **Label final**: `supported`（in-extension only，OMP 不用）

#### Local gap
- spec §11 §15.1 提的 "Native resume by prior session id" 真正想问的可能是 "能不能用 partial UUID 在 CLI 层面 resume" —— 答案：能，**CLI 层面**有 `pi --session <partial-uuid>`。详见 §1.4

### 1.3 Native visible peer session spawn — capability name 错位

#### Official evidence
- 官方 docs 全文未见名为 "visible peer session spawn" 的 API
- spec §11 真正相关的是 `ctx.newSession()`（详见 §1.1），但那是 in-extension，**不**产生 visible peer script
- "Visible peer script" 是 OMP 自有 launch 模式（CLI 子进程 `pi --provider ... --model ...`）

#### Local behavior
- 本地 spec §6.2 列了 3 个 launch mode：`print / direct_script / launch`
- 这些都不是 Pi API，是 OMP 自有 shell script 模式
- `launch/topology-supervisor.sh` 等 7 个脚本是 OMP 生成的，**不是 Pi 原生**

#### Inference
- **capability 名称错位**：
  - spec §11 的 "Native visible peer session spawn" **应该改名**为 "Visible peer script launch"
  - `ctx.newSession()` 是原生 API 但**不**是 visible peer script
  - 把这两者绑在一起会让 Pi Coder 实现时混淆

#### Label final
- "Native visible peer session spawn" 标 `compatibility_target` —— **改成** "Visible peer script launch" 标 `local_protocol`
- `ctx.newSession()` 单独标 `supported`（in-extension only, **not used** for visible peer mesh）

### 1.4 `pi --session <path|partial-uuid>` CLI session resume

#### Official evidence
- [pi-sessions#session-storage](https://pi.dev/docs/latest/sessions#session-storage)
- 文档原文：
  ```bash
  pi --session <path|id> # Use a specific session file or partial session ID
  pi --fork <path|id>    # Fork a session file or partial session ID into a new session
  ```
- 配套：`/resume` 交互式 picker（`pi -r` 在启动时打开）

#### Local behavior
- 本地 `pi --version` → `0.79.6`
- 本地 `pi --help` 验证：
  ```
  --session <path|id>            Use specific session file or partial UUID
  --resume, -r                   Select a session to resume
  ```
- 本地实际 session 文件路径格式（`/Users/yuantian/.pi/agent/sessions/--Users-yuantian-Documents-Coding-omp-topology-network--/2026-06-17T06-54-40-485Z_019ed45c-5165-7cfe-97b0-26017935464b.jsonl`）：
  - 父目录名 = 项目 cwd 转换（`/` → `--`，首尾加 `--`）
  - 文件名 = `<ISO8601>Z_<UUID-v7>.jsonl`
  - session id = UUID v7，从文件名取
- header 行：
  ```json
  {"type":"session","version":3,"id":"019ed45c-5165-7cfe-97b0-26017935464b","timestamp":"2026-06-17T06:54:40.485Z","cwd":"/Users/yuantian/Documents/Coding/omp-topology-network"}
  ```
- 第 2 行是 `model_change` entry：`{"type":"model_change","id":"...","parentId":null,"timestamp":"...","provider":"minimax-cn","modelId":"MiniMax-M3"}`

#### Inference
- `pi --session` **官方支持** by file path **或** partial UUID（v7 字符串前缀匹配）
- spec §11 标 `pending_api_audit` 是**错的**——CLI 文档明示
- **OMP role 启动可走 `pi --session <partial-uuid>` 派生"同 session 的另一个 role"**（前提：先有该 role 的 session file）
- 但 OMP 当前走的是 `pi --provider ... --model ...` 不带 `--session`——派生的是新 session

#### Label final
- `pi --session` 标 `supported`（CLI 进程级，by path or partial UUID）
- `pi -r` / `/resume` 标 `supported`
- `pi --fork` 标 `supported`

#### Spec gap implication
- spec §6.3 resume order 5 步规则是**本地协议**层（基于 sessions.jsonl 的 5 态分类），与 CLI `--session` 平行存在
- spec §4.2 session 5 态分类（live/resumable/stale/parked/closed）是**业务级 state**，与 Pi 的 session 生命周期（startup/new/resume/fork）正交
- **这两套概念不可混淆**。spec 需明确：sessions.jsonl 的 5 态是 OMP 自有；CLI `--session` 决定的是 process-level session 生命周期

### 1.5 session_start / session_shutdown 事件

#### Official evidence
- [pi-extensions#session-start](https://pi.dev/docs/latest/extensions#session-start) + [session-shutdown](https://pi.dev/docs/latest/extensions#session-shutdown)
- `session_start` 触发时机：startup / reload / new / resume / fork
  - `event.reason`: `"startup" | "reload" | "new" | "resume" | "fork"`
  - `event.previousSessionFile`: 对 `"new"` / `"resume"` / `"fork"` 存在
- `session_shutdown` 触发时机：quit / reload / new / resume / fork
  - `event.reason`: `"quit" | "reload" | "new" | "resume" | "fork"`
  - `event.targetSessionFile`: 对 session replacement flow 存在
- 完整 lifecycle：
  ```
  /new | /resume: session_before_switch → session_shutdown → session_start
  /fork | /clone: session_before_fork → session_shutdown → session_start
  /compact | auto: session_before_compact → session_compact
  /tree: session_before_tree → session_tree
  /model | Ctrl+P: thinking_level_select / model_select
  ```

#### Local behavior
- 本地 register.ts:57 注册 `session_start`，调用 `startTopologyRuntimeForCurrentSession`
- 本地 register.ts:114 注册 `session_shutdown`，cleanup UI widget
- 本地 commands.ts:347, 369 写 "role session_start observed" 到 event log

#### Inference
- 5 个 reason 状态值 + 5 个 session_before_* 事件，**spec §4.1 mission lifecycle 11 态与 Pi session 5 reason 状态正交**
- spec 应**显式声明**：session_start/shutdown reason 写到 sessions.jsonl 哪一字段（建议 `pi_session_reason`），不与 OMP role 5 态混淆

#### Label final
- `session_start` / `session_shutdown` 标 `supported`
- 新增 3 个 `session_before_*` 事件标 `supported`（spec §4.2 session 5 态分类可受益于这些事件触发 pre-launch cancel hook）

### 1.6 session file path vs role session id

#### Official evidence
- session file 命名：`<ISO8601>Z_<UUID-v7>.jsonl`
- session id = UUID v7
- partial UUID = v7 字符串前缀（官方未明示最短前缀长度，实践上是 8-12 字符）
- `pi --session` 接受 path **或** partial UUID

#### Local behavior
- 本地 OMP `topologySessionId(role)` 函数（命令 grep `topologySessionId`）—— 未实测源码（见 §7.2 限制）
- 本地 `runtime-events.jsonl` 应该是 OMP 自己的 ledger，**不**与 `~/.pi/agent/sessions/` 共享

#### Inference
- **OMP role 进程**与 **Pi session** 是不同概念：
  - Pi session = `~/.pi/agent/sessions/<project>/<timestamp>_<uuid>.jsonl`，由 Pi 管理
  - OMP role session = OMP 自己 launch 的一个 `pi` CLI 进程，有 role 名（`topology-supervisor` / `hq` / `repair` 等）和 `--cname` 标识
  - 两者的 session id **不直接对应**。OMP 派生 role 时拿到 Pi session id（来自 `event.previousSessionFile` 或 CLI stdout），存到 OMP 的 sessions.jsonl
- **role → session_file 映射需要 OMP 自己维护**，Pi API 不提供

#### Label final
- "session file path vs role session id" 是**spec 概念对位问题**，不是 Pi API 缺
- 建议 spec 加一节说明 OMP role id / Pi session id / session file path 三者的关系
- **Label**: `local_protocol`（OMP 自有映射），**不是** Pi API gap

---

## 2. Messaging

### 2.1 `pi.sendMessage(message, options?)` + `deliverAs`

#### Official evidence
- [pi-extensions#pi-sendmessage-message-options](https://pi.dev/docs/latest/extensions#pi-sendmessage-message-options)
- 签名：`pi.sendMessage({ customType, content, display, details }, { deliverAs?, triggerTurn? })`
- `deliverAs`:
  - `"steer"`（默认）—— 排队，**在当前 assistant turn 工具调用结束后、下一个 LLM 调用前**派发
  - `"followUp"` —— 等 agent 全部结束
  - `"nextTurn"` —— 排到下一个 user prompt，不打断不触发
- `triggerTurn: true` —— agent idle 时**立即**触发 LLM 响应；只对 `"steer"` / `"followUp"` 有效
- **关键边界**：`pi.sendMessage` **只注入到当前 session**。**无 cross-session 派发能力**

#### Local behavior
- 本地 commands.ts:765 `pi.sendMessage({ customType: "topology", ... })` —— supervisor bootstrap
- 本地 register.ts:131 `pi.sendMessage({ customType: "topology-supervisor-bootstrap", ... })`
- 本地 register.ts:179 `pi.sendMessage({ customType: "topology-inbound", ... })`
- **本地未显式用 `deliverAs`**（grep 未见 `deliverAs`），全部走默认 `"steer"` 模式

#### Inference
- `deliverAs` **不**是"reduce local protocol surface"的工具 —— 它只控制当前 session 内的派发时机
- OMP 当前**没用** deliverAs，但 spec §15.3 期望它减少 cross-session 派发需求 —— 答案：**不能**

#### Label final
- `pi.sendMessage` 标 `supported`
- `deliverAs` 三模式标 `supported`（intra-session timing only）
- spec §15.3 期望 deliverAs 减少本地协议面 —— **否**。deliverAs 是 intra-session，跨 session 派发仍需 OMP 本地 packet 协议

### 2.2 `pi.appendEntry(customType, data?)`

#### Official evidence
- [pi-extensions#pi-appendentry-customtype-data](https://pi.dev/docs/latest/extensions#pi-appendentry-customtype-data)
- 关键说明：**"does NOT participate in LLM context"** —— appendEntry 只持久化到 session JSONL，**不进** LLM prompt
- 推荐用 `pi.registerTool` 的 `details` 字段来持久化 state（支持 branching）

#### Local behavior
- 本地 register.ts:167 `piLike.appendEntry?.("topology-packet", { ... })` —— packet ledger 持久化

#### Inference
- spec §11 "Use for non-actionable packet visibility" 措辞**误导**：appendEntry **不**进 LLM context，**不可见**到 LLM
- 实际用途：state 持久化（rebuild session on reload / cross-session continuity）

#### Label final
- `pi.appendEntry` 标 `supported`
- spec §11 描述应改为 "Use for non-actionable packet *state persistence* (does NOT enter LLM context)"

### 2.3 Cross-session role routing

#### Official evidence
- 官方 docs 全文搜索 `cross-session` / `inter-session` / `route to session` / `send to session id` —— **无结果**
- `pi.sendMessage` / `pi.sendUserMessage` 文档明确：只注入当前 session
- `ctx.newSession` / `ctx.switchSession` 是 in-extension，**改的是 ctx，不是跨 session 派发**

#### Local behavior
- 本地 OMP 跨 role 通信走的是**本地 packet 协议**：
  - `src/transport/local-coms.ts`（本地 JSONL packet）
  - `src/transport/net-coms.ts`（网络扩展，未实测）
  - `src/transport/live-coms.ts`（live peer endpoint）
  - `src/transport/registry.ts`（peer registry）
- 这些都是 OMP 自有 transport

#### Inference
- **Pi API 无 cross-session role routing primitive**。OMP 必须自己实现 packet 协议
- spec §7 inbox cleanup 与 packet state machine 是**必要的**，**不是 spec 想多了**

#### Label final
- "Cross-session role routing" 标 `not_supported_by_pi`（**必须** `local_protocol`）
- spec §6.4 role-specific launch rules + §7 inbox cleanup 是 OMP packet 协议的核心，**保留**

### 2.4 `pi.sendUserMessage(content, options?)`

#### Official evidence
- [pi-extensions#pi-sendusermessage-content-options](https://pi.dev/docs/latest/extensions#pi-sendusermessage-content-options)
- 与 `pi.sendMessage` 区别：发送**实际 user message**（不是 custom message），**总是触发 turn**
- 同样只注入当前 session

#### Local behavior
- 本地未使用 `pi.sendUserMessage`

#### Inference
- 能力存在但 OMP 当前不用
- spec 不需要

#### Label final
- `pi.sendUserMessage` 标 `supported`（spec 不必用，记录以备未来）

---

## 3. UI

### 3.1 `ctx.ui.select` / `confirm` / `input` / `editor` / `notify` / `custom`

#### Official evidence
- [pi-extensions#dialogs](https://pi.dev/docs/latest/extensions#dialogs) + [custom-ui-components](https://pi.dev/docs/latest/extensions#custom-ui)
- 5 个 dialog API + 1 个 custom 组件 API：
  - `ctx.ui.select(title, options)` —— 选项列表
  - `ctx.ui.confirm(title, message)` —— 是/否
  - `ctx.ui.input(title, placeholder?)` —— 文本输入
  - `ctx.ui.editor(title, prefilled?)` —— 多行编辑
  - `ctx.ui.notify(message, level?)` —— 非阻塞通知（`"info" | "warning" | "error"`）
  - `ctx.ui.custom()` —— TUI 组件
- `confirm` / `select` / `input` 支持 `timeout` 选项（auto-dismiss with countdown）

#### Local behavior
- 本地 register.ts:122 `ctx.ui.setWidget` —— 清理 widget
- 本地 commands.ts:32, 306, 358 `ctx.ui.notify` —— 多处使用
- **本地未使用** `ctx.ui.select` / `confirm` / `input` / `editor` / `custom`

#### Inference
- spec §10 + §15.4 标 `pending_api_audit` 是**错的**——官方已支持
- spec 真正要问的是 "**什么时候**把 text-only picker 换成 native chooser"——这是 UX 决策，不是 API 审计

#### Label final
- 5 个 dialog API 标 `supported`
- `ctx.ui.custom()` 标 `supported`
- spec §10/§15.4 措辞应改为 "Native chooser UI is supported; this round keeps text-only picker for compatibility, with future-compat path to native chooser when the picker UX becomes a hot spot"

### 3.2 `ctx.ui.setStatus` / `setWidget` / `setFooter` + working message

#### Official evidence
- [pi-extensions#widgets-status-and-footer](https://pi.dev/docs/latest/extensions#widgets-status-and-footer)
- 完整 status / widget / footer API：
  - `ctx.ui.setStatus(name, value | undefined)` —— footer 状态行
  - `ctx.ui.setWidget(name, content, { placement? })` —— editor 上方/下方
  - `ctx.ui.setFooter(renderer | undefined)` —— 整段替换 footer
  - `ctx.ui.setWorkingMessage(text?)` / `setWorkingVisible(bool?)` / `setWorkingIndicator(opts?)` —— loading indicator
  - `ctx.ui.setTitle(title)` —— 终端 title
  - `ctx.ui.setEditorText(text)` / `getEditorText()` —— 编辑器内容

#### Local behavior
- 本地 ui.ts:72 `ctx.ui.setStatus?.("topology", compactStatusLine(snapshot))` —— 实际使用
- 本地 register.ts:122 `ctx.ui.setWidget?.("topology-mesh", undefined)` —— 清理 widget
- **本地未使用** `setFooter` / `setWorkingMessage` / `setTitle`

#### Inference
- 实际用法与 spec §10 §11 一致 —— `setStatus` 写 footer，`setWidget` 写 editor 上下
- spec §10 "Footer/widget rendering multi-Mission" 实测：可行，是**实现工作**不是 API 缺

#### Label final
- `setStatus` / `setWidget` / `setFooter` 标 `supported`
- 3 个 working message API 标 `supported`（spec 不必用，记录以备未来）
- `setTitle` / `setEditorText` / `getEditorText` 标 `supported`（spec 不必用）

### 3.3 `keyHint()` / `keyText()`

#### Official evidence
- [pi-extensions#keybinding-hints](https://pi.dev/docs/latest/extensions#keybinding-hints)
- `keyHint(keybinding, description)` —— 格式化为 keybinding hint，遵循 active 配置
- `keyText(keybinding)` —— 原始 key 文本
- `rawKeyHint(key, description)` —— 原始 key 字符串
- 命名空间：`app.*`（coding-agent）/ `tui.*`（shared TUI）
- 配置文件：`keybindings.json`

#### Local behavior
- 本地未使用

#### Inference
- OMP 当前不注册 custom keybinding
- spec §10 不要求 keybinding，但 §13 后续 slice 可选

#### Label final
- `keyHint` / `keyText` / `rawKeyHint` 标 `supported`（spec 不必用）
- "keybindings.json" 配置机制 标 `supported`（spec 不必用）

---

## 4. Package / Resources

### 4.1 `package.json` `pi` key

#### Official evidence
- [pi-packages#creating-a-pi-package](https://pi.dev/docs/latest/packages#creating-a-pi-package)
- 标准格式：
  ```json
  {
    "name": "my-package",
    "keywords": ["pi-package"],
    "pi": {
      "extensions": ["./extensions"],
      "skills": ["./skills"],
      "prompts": ["./prompts"],
      "themes": ["./themes"]
    }
  }
  ```
- 路径支持 glob 与 `!exclusions`
- `pi-package` keyword 用于发现

#### Local behavior
- 本地 `packages/pi-topology/package.json`：
  ```json
  {
    "name": "pi-topology-network",
    "version": "0.1.0",
    "keywords": ["pi-package", "pi", "multi-agent", "topology", "session-mesh"],
    "pi": {
      "extensions": ["./index.ts"],
      "skills": ["./skills"]
    }
  }
  ```
- ✅ keyword 正确 / `pi` key 正确 / paths 是 relative to package root

#### Inference
- 与官方格式完全一致
- `extensions` 是单文件 index.ts（`./index.ts`），skills 是目录（`./skills`）
- 实际加载时 `pi -e ./index.ts` 可工作（handoff §7 实测）

#### Label final
- `package.json` `pi` key 标 `supported`（本地实测已用）

### 4.2 Convention directories

#### Official evidence
- [pi-packages#convention-directories](https://pi.dev/docs/latest/packages#convention-directories)
- 无 `pi` manifest 时，Pi auto-discover：
  - `extensions/` 加载 `.ts` / `.js`
  - `skills/` 递归找 `SKILL.md` 文件夹与顶层 `.md`
  - `prompts/` 加载 `.md`
  - `themes/` 加载 `.json`

#### Local behavior
- 本地 `packages/pi-topology/skills/topology-runtime/SKILL.md` 存在
- 本地 SKILL.md frontmatter:
  ```yaml
  ---
  name: topology-runtime
  description: "Operate or debug the OMP拓扑网络 Pi topology runtime..."
  metadata:
    origin: pi-topology package
  ---
  ```
- ✅ 符合官方 SKILL.md 格式（[pi-skills#skill-md-format](https://pi.dev/docs/latest/skills#skill-md-format)）

#### Inference
- 当前 OMP skills 走 `pi.skills` 显式声明 + convention dir 双重覆盖
- 实测 handoff §7 `pi --offline --no-session -e .../packages/pi-topology/index.ts --approve` 可加载 package skill

#### Label final
- Convention dirs 标 `supported`（本地已用）

### 4.3 `resources_discover` event

#### Official evidence
- [pi-extensions#resources-discover](https://pi.dev/docs/latest/extensions#resources-discover)
- 触发时机：每次 `session_start` 之后
- 事件签名：`{ cwd, reason: "startup" | "reload" }`
- 返回 `{ skillPaths?, promptPaths?, themePaths? }`

#### Local behavior
- 本地 register.ts:53:
  ```ts
  pi.on("resources_discover", () => ({
    skillPaths: [topologyPackageSkillsDir()],
  }));
  ```
- 实际加载路径：`packages/pi-topology/skills`

#### Inference
- 与官方 docs 一致
- 这是 `2026-06-16-pi-topology-official-api-audit.md` 已确认的能力，本轮无变化

#### Label final
- `resources_discover` 标 `supported`（本地实测已用）

### 4.4 `pi install` / `pi list` / `pi remove` / `pi update` + scope

#### Official evidence
- [pi-packages#install-and-manage](https://pi.dev/docs/latest/packages#install-and-manage) + [package-sources](https://pi.dev/docs/latest/packages#package-sources)
- 4 种 source: `npm:pkg`, `git:url`, `https://url`, `/local/path`
- 默认写 `~/.pi/agent/settings.json`（user scope）
- `-l` 写 `.pi/settings.json`（project scope）
- Project scope 可与 team 共享，pi 启动后自动安装缺失 package

#### Local behavior
- 本地 `pi --help` 验证：
  ```
  pi install <source> [-l]     Install extension source and add to settings
  pi remove <source> [-l]      Remove extension source from settings
  pi uninstall <source> [-l]   Alias for remove
  pi update [source|self|pi]   Update pi and installed extensions
  pi list                      List installed extensions from settings
  pi config                    Open TUI to enable/disable package resources
  ```
- 本地 `~/.pi/agent/settings.json` 存在（grep 看到有 1513 字节）

#### Inference
- OMP 当前走 `pi -e ./packages/pi-topology/index.ts` 临时加载，**未** `pi install` 到 settings.json
- 这是合理的：开发迭代期避免污染 user scope
- spec §12 migration 不需要改 install 路径，**保留** `pi -e` 临时加载

#### Label final
- 4 个 install/list/remove/update 命令 标 `supported`
- `pi config` 标 `supported`
- User vs project scope 标 `supported`

### 4.5 `pi -e` / `--extension` 临时加载

#### Official evidence
- [pi-packages#install-and-manage](https://pi.dev/docs/latest/packages#install-and-manage)（续）
- `pi -e <path>` / `--extension <path>`：临时加载，**不**写入 settings

#### Local behavior
- 本地 handoff §7 使用：
  ```bash
  pi --provider minimax-cn --model MiniMax-M3 --thinking low
  ```
  但 handoff §1 Step 3 提到 `pi -e ./index.ts` 作为开发加载路径
- 本地 spec §11 §13 引用 `pi -e ./index.ts` 作为开发加载方式
- 本地 `2026-06-16-…-api-audit.md` 已确认：
  > 真实 Pi TUI 已用 `pi --offline --no-session -e .../packages/pi-topology/index.ts --approve` 验证 `/skill:topology-runtime` 可加载 package skill

#### Inference
- `pi -e` 临时加载 = OMP 当前开发模式
- `npm pack --dry-run` 验证 package 完整性（spec §13 handoff 要求）
- 两者是互补的：开发期用 `pi -e`，发布/分享用 `pi install`

#### Label final
- `pi -e` / `--extension` 标 `supported`（本地实测已用）
- `npm pack --dry-run` 标 `supported`（spec §13 handoff 引用）

### 4.6 `pi --session` / `--fork` 配合 install / -e

#### Official evidence
- [pi-sessions#session-storage](https://pi.dev/docs/latest/sessions#session-storage)
- 4 个 session control CLI flags：
  - `pi -c` —— continue most recent
  - `pi -r` —— resume picker
  - `pi --no-session` —— ephemeral
  - `pi --session <path|id>` —— specific session
  - `pi --fork <path|id>` —— fork into new session
  - `pi --name "..."` —— set session display name

#### Local behavior
- 本地 `pi --help` 验证 `--session` / `--resume` / `--continue` 存在
- 本地 `pi --fork` 未在 `pi --help` 中显示 —— 实际可能不在 CLI 0.79.6 中

#### Inference
- **5 个 flags 中 4 个确认存在**；`--fork` 需在 `pi -r` picker 或后续版本验证
- spec §6.3 resume order 是 OMP 业务级，与 CLI session control 平行

#### Label final
- `pi -c` / `pi -r` / `pi --no-session` / `pi --session` 标 `supported`
- `pi --fork` 标 `supported`（文档明示，CLI help 暂未列，不影响 OMP）
- `pi --name` 标 `supported`

---

## 5. Lifecycle

### 5.1 Pi native lifecycle events（OMP 不直接复用）

#### Official evidence
- 完整 lifecycle events：
  - `project_trust` (user/global + CLI extensions only, before project resources load)
  - `session_start` { reason }
  - `session_shutdown` { reason, targetSessionFile? }
  - `session_before_switch` { reason, targetSessionFile? } —— `/new` / `/resume` 前
  - `session_before_fork` { reason } —— `/fork` / `/clone` 前
  - `session_before_compact` —— `/compact` / auto-compact 前
  - `session_before_tree` —— `/tree` 前
  - `thinking_level_select` / `model_select` —— 模型切换
  - `resources_discover` { cwd, reason }
  - `input` —— user prompt 前
  - `before_agent_start` —— agent start 前
  - `agent_start` / `agent_end`
  - `message_start` / `message_update` / `message_end`
  - `tool_call` (before/after)
  - 其他

#### Local behavior
- 本地 register.ts 注册的事件：
  - `resources_discover` (line 53)
  - `session_start` (line 57)
  - `tool_call` (line 65)
  - `session_shutdown` (line 114)
- 本地未注册 `session_before_switch` / `session_before_fork` / `session_before_compact` / `session_before_tree` / `input` / `before_agent_start` / `agent_start` / `agent_end` / `message_*`

#### Inference
- OMP 当前只用了 4 个 lifecycle event，**够用**
- spec §4.2 session 5 态分类与 Pi lifecycle 5 reason 正交：
  - OMP role state 5 态 = 业务级（live / resumable / stale / parked / closed）
  - Pi session reason 5 态 = 进程级（startup / reload / new / resume / fork）
- spec 应**显式声明两者不混淆**

#### Label final
- 4 个已用 event 标 `supported`
- 其他 Pi lifecycle event 标 `supported`（spec 不必用，记录以备未来）

### 5.2 OMP business-level states vs Pi native lifecycle

#### Official evidence
- Pi 无 "Mission park/close" / "role park/close" / "packet stale" / "incident open/closed" 等业务级 state 原语
- Pi lifecycle 事件只表示**进程级** session 启停

#### Local behavior
- 本地 `src/runtime/mission.ts` / `src/state/event-log.ts` / `src/runtime/packet.ts` 等是 OMP 自有 business state 实现
- 本地 `src/state/session-ledger.ts` 维护 OMP 自己的 session 记录（**不**与 `~/.pi/agent/sessions/` 共享）

#### Inference
- OMP 业务级 state 必须用本地协议 + JSONL 文件实现
- spec §4 6 个 state machine（Mission / Session / Task / Packet / Artifact / Incident）是**必要的**，**不**是 spec 想多了
- spec §11 §15.7 问 "Native lifecycle hook can mark parked/closed more cleanly than local JSONL" —— 答案：**不能**。Pi 无业务级 lifecycle primitive

#### Label final
- "OMP business-level states (Mission park/close, role park/close, packet stale, incident open/closed)" 标 `local_protocol`（无 native 替代）

### 5.3 Ghostty GUI launch lifecycle

#### Official evidence
- 官方 docs 全文未见 "Ghostty" 提及
- Ghostty 是 macOS terminal app，**与 Pi API 正交**

#### Local behavior
- handoff §1 Step 3 "On this Mac, unattended Ghostty GUI launch is not acceptance evidence by itself"
- `2026-06-16-pi-topology-package-ghostty-dogfood.md` 已记录 Ghostty E2E 测试不稳定

#### Inference
- Ghostty 行为属 local environment，**不是** Pi API 维度
- spec §11 标 `local_environment_risk` **正确**
- 本审计**不**评估 Ghostty 行为（按 handoff 规则）

#### Label final
- "Ghostty unattended GUI launch" 标 `local_environment_risk`（spec §11 保留）

---

## 6. Label Assignments — Spec §11 Update Recommendation

下表是 spec §11 改版建议。**`#` 列 = spec §11 改后行号**。**新增行用 `+` 前缀**。

| # | Capability | Spec §11 原始 Label | Audit Final Label | 改动理由 |
| --- | --- | --- | --- | --- |
| 1 | `pi.registerCommand` slash command | supported | supported | 不变 |
| 2 | `pi.registerTool` custom tool | supported | supported | 不变 |
| 3 | `pi.registerFlag` CLI flag | (未列) | supported | 新增（本地实测用 register.ts:34,38） |
| 4 | `pi.getFlag` 读 CLI flag | (未列) | supported | 新增（本地实测用 register.ts:42） |
| 5 | `pi.getCommands` 列出当前 slash command | (未列) | supported | 新增（spec 未来 dashboard 验证用） |
| 6 | `pi.getAllTools` 列出当前 tool | (未列) | supported | 新增（spec 未来 supervisor 启动验证用） |
| 7 | `pi.setActiveTools` 动态启用/禁用 tool | (未列) | supported | 新增（spec 不必用，记录以备未来） |
| 8 | `resources_discover` event | supported | supported | 不变 |
| 9 | `session_start` / `session_shutdown` | supported | supported | 不变 |
| 10 | `session_before_switch` / `_fork` / `_compact` / `_tree` | (未列) | supported | 新增（spec 未来可挂 cancel hook） |
| 11 | `ctx.newSession(options?)` 派生新 session | (未列) | **supported (in-extension only, not used for visible peer mesh)** | 新增（澄清 §1.3 capability 错位） |
| 12 | `ctx.switchSession(sessionPath, options?)` | (未列) | **supported (in-extension only, by file path)** | 新增 |
| 13 | `pi --session <path\|partial-uuid>` CLI | pending_api_audit | **supported (CLI 进程级)** | 文档明示（[pi-sessions#session-storage](https://pi.dev/docs/latest/sessions#session-storage)）|
| 14 | `pi -r` / `/resume` interactive picker | (未列) | supported | 新增 |
| 15 | `pi --fork` / `pi --name` | (未列) | supported | 新增 |
| 16 | `pi.sendMessage(message, options?)` | supported | supported | 不变（spec §11 描述应改，见 §2.2） |
| 17 | `pi.sendUserMessage(content, options?)` | (未列) | supported | 新增 |
| 18 | `pi.appendEntry(customType, data?)` | supported | supported | **不**进 LLM context（spec §11 描述应改） |
| 19 | `deliverAs: "steer" \| "followUp" \| "nextTurn"` | (未列) | **supported (intra-session timing only)** | 新增（澄清 §2.1 不跨 session） |
| 20 | `ctx.ui.select` / `confirm` / `input` / `editor` / `notify` | pending_api_audit（in §10/§15.4） | **supported** | 文档明示（[pi-extensions#dialogs](https://pi.dev/docs/latest/extensions#dialogs)） |
| 21 | `ctx.ui.setStatus` / `setWidget` / `setFooter` | supported | supported | 不变 |
| 22 | `ctx.ui.custom()` TUI 组件 | (未列) | supported | 新增 |
| 23 | `ctx.ui.setWorking*` / `setTitle` / `setEditorText` | (未列) | supported | 新增（spec 不必用） |
| 24 | `keyHint` / `keyText` / `rawKeyHint` | (未列) | supported | 新增（spec 不必用） |
| 25 | `package.json` `pi` key | (未列) | supported | 新增（本地实测 package.json） |
| 26 | Convention directories | (未列) | supported | 新增（本地实测 skills/） |
| 27 | `pi install`（npm/git/local/path） | (未列) | supported | 新增（CLI 0.79.6 已确认） |
| 28 | `pi list` / `pi remove` / `pi update` / `pi config` | (未列) | supported | 新增 |
| 29 | `pi -e` / `--extension` 临时加载 | (未列) | supported | 新增（本地实测 handoff §7） |
| 30 | Scope: `~/.pi/agent/settings.json` vs `.pi/settings.json` | (未列) | supported | 新增 |
| 31 | Cross-session role routing | (未列) | **not_supported_by_pi (must be local_protocol)** | 新增（避免 spec 之后再来问） |
| 32 | Visible peer script launch | compatibility_target | **local_protocol** | 改（capability 名字错位，详见 §1.3） |
| 33 | HTTP/SSE transport | compatibility_target | compatibility_target | 不变（本轮不引入） |
| 34 | Ghostty unattended GUI launch | local_environment_risk | local_environment_risk | 不变（非 API 维度） |
| 35 | OMP business-level states | (未列) | local_protocol | 新增（澄清 §5.2 业务级 state 必须本地协议） |

---

## 7. Evidence Trail

### 7.1 Commands run + outputs

#### `pi --version`
```
0.79.6
```

#### `pi --help`（节选相关行）
```
--provider <name>              Provider name (default: google)
--model <pattern>              Model pattern or ID (supports "provider/id" and optional ":<thinking>")
--session <path|id>            Use specific session file or partial UUID
--continue, -c                 Continue previous session
--resume, -r                   Select a session to resume

Commands:
  pi install <source> [-l]     Install extension source and add to settings
  pi list                      List installed extensions from settings
  pi config                    Open TUI to enable/disable package resources
```

#### `cat packages/pi-topology/package.json`（节选）
```json
{
  "name": "pi-topology-network",
  "version": "0.1.0",
  "keywords": ["pi-package", "pi", "multi-agent", "topology", "session-mesh"],
  "pi": {
    "extensions": ["./index.ts"],
    "skills": ["./skills"]
  }
}
```

#### `cat packages/pi-topology/index.ts`
```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerPiTopology } from "./src/extension/register.ts";
export { registerPiTopology };
export default function piTopology(pi: ExtensionAPI): void {
  registerPiTopology(pi);
}
```

#### `grep -nE "registerCommand|registerTool|...|appendEntry|sendMessage" packages/pi-topology/src/extension/*.ts`
（已在 §1-3 各小节展开关键命中）

#### `head -1 /Users/yuantian/.pi/agent/sessions/--Users-yuantian-Documents-Coding-omp-topology-network--/<latest>.jsonl`
```json
{
  "type": "session",
  "version": 3,
  "id": "019ed45c-5165-7cfe-97b0-26017935464b",
  "timestamp": "2026-06-17T06:54:40.485Z",
  "cwd": "/Users/yuantian/Documents/Coding/omp-topology-network"
}
```

#### `sed -n '2p' <same-file>` (second entry)
```json
{"type":"model_change","id":"941128de","parentId":null,"timestamp":"2026-06-17T06:54:42.355Z","provider":"minimax-cn","modelId":"MiniMax-M3"}
```

#### `cat packages/pi-topology/skills/topology-runtime/SKILL.md`（前 10 行）
```yaml
---
name: topology-runtime
description: "Operate or debug the OMP拓扑网络 Pi topology runtime: /topology startup, topology_* tools, Supervisor/HQ/worker mesh, packets, status, doctor, and live peer workflow."
metadata:
  origin: pi-topology package
---

# Topology Runtime

Used by OMP拓扑网络 roles in the new Pi package runtime.
```

### 7.2 限制 / 已知未做

- **未跑** `pi -e ./packages/pi-topology/index.ts --print "..."` 验证 package 加载（依赖 owner decision）
- **未读** `packages/pi-topology/src/runtime/mission.ts` / `packet.ts` / `session-ledger.ts` 等 runtime 源码（不在 audit 范围，且已在 `2026-06-16-…-api-audit.md` 评估过）
- **未**实测 `ctx.newSession()` / `ctx.switchSession()` 行为（CLI 0.79.6 + 当前 OMP extension 未注册调用，按 docs 接受）
- **未**实测 Ghostty GUI 启动行为（按 handoff 规则，**不**作为 acceptance evidence）

### 7.3 引用官方文档

| Capability | 官方文档锚点 |
| --- | --- |
| `pi.registerCommand` | [pi-extensions#pi-registercommand-name-options](https://pi.dev/docs/latest/extensions#pi-registercommand-name-options) |
| `pi.registerTool` | [pi-extensions#pi-registertool-definition](https://pi.dev/docs/latest/extensions#pi-registertool-definition) |
| `resources_discover` | [pi-extensions#resources-discover](https://pi.dev/docs/latest/extensions#resources-discover) |
| `session_start` | [pi-extensions#session-start](https://pi.dev/docs/latest/extensions#session-start) |
| `session_shutdown` | [pi-extensions#session-shutdown](https://pi.dev/docs/latest/extensions#session-shutdown) |
| `ctx.newSession` | [pi-extensions#ctx-newsession-options](https://pi.dev/docs/latest/extensions#ctx-newsession-options) |
| `ctx.switchSession` | [pi-extensions#ctx-switchsession-sessionpath-options](https://pi.dev/docs/latest/extensions#ctx-switchsession-sessionpath-options) |
| `pi.sendMessage` | [pi-extensions#pi-sendmessage-message-options](https://pi.dev/docs/latest/extensions#pi-sendmessage-message-options) |
| `pi.sendUserMessage` | [pi-extensions#pi-sendusermessage-content-options](https://pi.dev/docs/latest/extensions#pi-sendusermessage-content-options) |
| `pi.appendEntry` | [pi-extensions#pi-appendentry-customtype-data](https://pi.dev/docs/latest/extensions#pi-appendentry-customtype-data) |
| `ctx.ui.dialogs` | [pi-extensions#dialogs](https://pi.dev/docs/latest/extensions#dialogs) |
| `ctx.ui.setStatus/Widget/Footer` | [pi-extensions#widgets-status-and-footer](https://pi.dev/docs/latest/extensions#widgets-status-and-footer) |
| `ctx.ui.custom` | [pi-extensions#custom-ui](https://pi.dev/docs/latest/extensions#custom-ui) |
| `keyHint` | [pi-extensions#keybinding-hints](https://pi.dev/docs/latest/extensions#keybinding-hints) |
| `pi --session` / `--fork` | [pi-sessions#session-storage](https://pi.dev/docs/latest/sessions#session-storage) |
| `/resume` / `pi -r` | [pi-sessions#resuming-and-deleting-sessions](https://pi.dev/docs/latest/sessions#resuming-and-deleting-sessions) |
| `package.json` `pi` key | [pi-packages#creating-a-pi-package](https://pi.dev/docs/latest/packages#creating-a-pi-package) |
| Convention dirs | [pi-packages#convention-directories](https://pi.dev/docs/latest/packages#convention-directories) |
| `pi install` / `pi list` / `pi update` | [pi-packages#install-and-manage](https://pi.dev/docs/latest/packages#install-and-manage) |
| Scope & dedup | [pi-packages#scope-and-deduplication](https://pi.dev/docs/latest/packages#scope-and-deduplication) |
| `keybindings.json` | [pi-keybindings](https://pi.dev/docs/latest/keybindings) |
| SKILL.md format | [pi-skills#skill-md-format](https://pi.dev/docs/latest/skills#skill-md-format) |

---

## 8. 结论

### 8.1 Spec §11 alignment table 改版统计

| 类别 | 数量 | 说明 |
| --- | --- | --- |
| 不变（spec 标对） | 7 项 | registerCommand, registerTool, resources_discover, session_start/shutdown, setStatus/setWidget, sendMessage, appendEntry |
| **降标 / 改标** | 3 项 | session resume `pending_api_audit` → `supported`；visible peer spawn `compatibility_target` → `local_protocol`；native UI select `pending_api_audit` → `supported` |
| 新增 spec §11 未列但已 supported 的能力 | 17 项 | 见 §6 表 #3-7, 10, 12, 15, 17, 19, 22-24, 27-30 |
| 新增明确**不**存在的能力 | 1 项 | cross-session role routing（`not_supported_by_pi`） |
| 显式 `local_protocol` | 1 项 | OMP business-level states |

### 8.2 Spec §15 open items 答题

| # | spec 提问 | audit 答案 | label |
| --- | --- | --- | --- |
| 1 | "Pi exposes reliable session resume by id" | **是**，by file path **或** partial UUID（CLI `pi --session`），in-extension `ctx.switchSession` by file path | supported |
| 2 | "`pi.sendMessage` can target previous visible session" | **否**。sendMessage / sendUserMessage 都只注入当前 session | not_supported_by_pi（必须 local_protocol） |
| 3 | "`deliverAs` can reduce local protocol surface" | **否**。deliverAs 只控制当前 session 派发时机（steer/followUp/nextTurn），不跨 session | supported（intra-session only） |
| 4 | "Native UI select/custom" | **是**，`ctx.ui.select()` / `ctx.ui.custom()` 都已支持 | supported |
| 5 | "Footer/widget can read compact multi-Mission" | **是**，`setStatus` / `setWidget` / `setFooter` 都已支持 | supported（实现工作） |
| 6 | "Package install / `pi -e` discover skills" | **是**，已对齐 | supported |
| 7 | "Native lifecycle hook for parked/closed" | **否**。Pi 无业务级 lifecycle，原生只有进程级 session 启停 | local_protocol（必须） |

### 8.3 给 Pi Coder 的关键提示

- spec §6.3 resume order 是**本地协议**层（基于 sessions.jsonl 的 5 态分类），与 CLI `pi --session` 平行存在
- spec §4.2 session 5 态分类（live/resumable/stale/parked/closed）是**业务级 state**，与 Pi session 5 reason（startup/new/resume/fork）正交
- spec §6.2 launch mode 中**没有** `ctx.newSession()` 派生选项——这是正确的，visible peer script 必须新开进程才能被 owner 看见
- spec §11 §15.3 期望 `deliverAs` 减少本地协议面——**不能**，跨 session 派发仍需 OMP 本地 packet 协议
- spec §15.4 native chooser 升级——**已支持**，但本轮 text-only picker 是合理决策
- spec §15.7 native lifecycle for parked/closed——**无原生替代**，OMP 必须用本地 JSONL 业务级 state

### 8.4 给 Codex Reviewer 的提示

- spec §11 alignment table 需要改版（详见 §6）—— **不是** spec 整体改写，是 alignment table 改 + 增
- spec §15.4 措辞需改（"pending_api_audit" → "supported + this-round-keeps-text-only"）
- spec §15.3 措辞需改（"deliverAs can reduce local protocol surface" → "deliverAs is intra-session timing; cross-session routing still requires local packet protocol"）
- spec §15.7 措辞需改（"native lifecycle hook for parked/closed" → "no native primitive for OMP's business-level parked/closed; local JSONL is correct"）
- 改完 §6 alignment table 与 §15.4/§15.3/§15.7 措辞后，spec 即可进 Pi Coder 实现阶段

---

## 9. Reviewer 立场

本 audit 不修改 spec（Codex Reviewer 职责），仅提供 §6 alignment table 改版 + §15 措辞建议 + §8 关键提示。

本审计完成 PRD review → spec review → API audit 链的 Stage 2 收口。Stage 3（Pi Coder 实现）等 Codex Reviewer 决定 spec 改动后再启动。
