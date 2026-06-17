# Spec Review: Pi Topology Mission Runtime

日期：2026-06-17
项目：OMP拓扑网络 / `packages/pi-topology`
评审者：Pi session (MiniMax-M3, Pi Harness)
评审对象：`docs/14-pi-topology-mission-runtime-spec.md` (reviewer draft)
前置 review：`records/2026-06-17-pi-topology-mission-runtime-prd-review.md`
评审类型：认知层面 review (Stage 2 of Codex Reviewer → Pi Coder 3-阶段工作流)
评审视角：**mesh 多 Agent 协作下，基础设施是否够支撑开发的顺利推进、Evidence 保存、状态的正确读取** — 同步核对官方 Pi docs

## 总体判定

Spec 在 3 个维度上**对 PRD 的 9 项 gap 给出了对应的实现级合约**（见 §1 覆盖度矩阵），是 reviewer-draft 状态里**可以直接进 Pi Coder 实现的草案**。

但有 4 处**官方文档对位不精确**需在 spec 启动前修：

1. §11 alignment table 中 "Native resume by prior session id" 标 `pending_api_audit` —— **官方已有 `ctx.switchSession(sessionPath)`**，只需把 "session by id" 重新定义为 "session by file path" 即可降为 `supported`。
2. §11 "Native visible peer session spawn" 标 `compatibility_target` —— 措辞不准。`ctx.newSession(options?)` 是官方原生 API，但产生的是 in-extension 派生 session；spec 真正要的是 "visible peer script" 这种**可见性模式**，那是 local_protocol。把 capability 名改成 "visible peer script launch" 才对位。
3. §15.4 "Native UI select/custom" 标 `pending_api_audit` —— **`ctx.ui.select()` / `ctx.ui.custom()` 官方已支持**，可直接降为 `supported`。这是 spec audit 自己的盲点。
4. §15.3 `deliverAs` 期望 "reduce local protocol surface" —— `deliverAs` 是 `pi.sendMessage` 的 delivery timing 模式（steer/followUp/nextTurn），**只控制当前 session 内的派发时机，不能跨 session 派发到不同 role**。spec 的跨 role 通信还是得走本地 packet 协议。spec 提问需重述。

其余 spec 内容（state machines、launch metadata 校验、cleanup 规则、rollback、migration）**未发现官方文档不支持的硬约束**。

---

## 1. PRD → Spec 覆盖度矩阵

PRD review 提的 4 必补 + 6 次要项，spec 是否落了：

| PRD gap | 描述 | spec 落点 | 状态 |
| --- | --- | --- | --- |
| **Gap 1.1** | 切片交付包缺模板 | §13 "Each slice handoff must include 7 项" | ✅ resolved |
| **Gap 1.2** | lifecycle 缺 rollback | §9.2 rollback 4 步决策门 | ✅ resolved |
| **Gap 1.3** | commit 粒度约定缺 | §13 "one atomic commit per approved slice, message: `slice(<id>): <summary>`" | ✅ resolved |
| **Gap 2.1** | evidence 路径约定缺 | §8 mission-scoped path convention（含 6 种 path form） | ✅ resolved |
| **Gap 2.2** | compaction 与 deletion 边界不清 | §7 "compaction / cleanup" 段显式 disallowed without owner gate | ✅ resolved（PRD 需同步加 definition）|
| **Gap 2.3** | 5 态缺 freshness window | §4.2 默认 20s 寄存器、10min resumable | ✅ resolved |
| **Gap 3.1** | 多 Mission picker 边界 | §5.1 "read-only snapshot at fetch time" | ✅ resolved |
| **Gap 3.2** | permission 边界无 enforce | §6.1 launch metadata 11 字段 + validate-before-launch + 不符就 block + incident | ✅ resolved（强）|
| **Gap 3.3** | "deliver" 无定义 | §9.1 closeout.md + owner_acknowledged_delivery event | ✅ resolved |
| 次要 §10 #8 | Pi API 对位 | §11 alignment table | ⚠️ 4 项需调整（见 §2）|

**结论**：10 项里 9 项 spec 已落实，1 项（API 对位表）需在启动前修。

---

## 2. Pi 官方文档对位

逐项核对 spec §11 + §15 各 claim。**"官方" = 文档明示**；"实测" 留给下一步 api-audit 报告。

### 2.1 `pi.registerCommand` —— `supported` ✅
- spec §11 claim
- 官方文档 [extensions § pi.registerCommand](https://pi.dev/docs/latest/extensions#pi-registercommand-name-options)：支持，handler / description / getArgumentCompletions。同名命令按 load 顺序加 `:1` `:2` 后缀
- **结论**：spec 标对，可继续使用

### 2.2 `pi.registerTool` —— `supported` ✅
- spec §11 claim
- 官方文档 [extensions § pi.registerTool](https://pi.dev/docs/latest/extensions#pi-registertool-definition)：支持，可运行时动态注册，`promptSnippet` / `promptGuidelines` 接入
- **结论**：spec 标对

### 2.3 `resources_discover` skill discovery —— `supported` ✅
- spec §11 claim
- 官方文档 [extensions § resources_discover](https://pi.dev/docs/latest/extensions#resources-discover) + [packages § convention dirs](https://pi.dev/docs/latest/packages#convention-directories)：事件返回 `skillPaths / promptPaths / themePaths`，`pi.skills` package.json key 与 `skills/` 约定目录并存
- **结论**：spec 标对

### 2.4 `session_start` / `session_shutdown` —— `supported` ✅
- spec §11 claim
- 官方文档 [extensions § session_start](https://pi.dev/docs/latest/extensions#session-start) + [session_shutdown](https://pi.dev/docs/latest/extensions#session-shutdown)：lifecycle event 完整支持，event.reason ∈ {startup, reload, new, resume, fork}
- **结论**：spec 标对

### 2.5 `ctx.ui.setStatus` / `setWidget` —— `supported` ✅
- spec §11 claim
- 官方文档 [extensions § Widgets, Status, and Footer](https://pi.dev/docs/latest/extensions#widgets-status-and-footer)：支持，setStatus 写 footer、setWidget 写 editor 上方/下方、setFooter 整段替换
- **结论**：spec 标对

### 2.6 `pi.sendMessage` with `deliverAs` —— `supported` ✅（但 spec §15.3 提问需重述）
- spec §11 claim
- 官方文档 [extensions § pi.sendMessage](https://pi.dev/docs/latest/extensions#pi-sendmessage-message-options)：3 种 deliverAs 模式 (steer / followUp / nextTurn)，triggerTurn 只对 steer/followUp 有效
- **重要**：`pi.sendMessage` **只注入到当前 session**。spec §15.3 问 "can pi.sendMessage target a previous visible session?" —— 答案官方明示：**不能**。若要跨 session 派发到特定 role session，必须用本地 packet 协议。
- **结论**：spec §11 标对；spec §15.3 提问需重述（改成 "does Pi expose a cross-session message primitive?"）

### 2.7 `pi.appendEntry` —— `supported` ✅
- spec §11 claim
- 官方文档 [extensions § pi.appendEntry](https://pi.dev/docs/latest/extensions#pi-appendentry-customtype-data)：支持，**关键澄清**：appendEntry "does NOT participate in LLM context"，只用于状态持久化
- **spec 用途审视**：spec §11 说 "Use for non-actionable packet visibility"。但 appendEntry 不进 LLM context —— **如果 packet 状态想进 supervisor 的 LLM 视野，得走其他机制**。建议 spec 把这条改写为 "Use for non-actionable packet *state persistence* (does not enter LLM context)"。

### 2.8 Native resume by prior session id —— `pending_api_audit` → 应改为 `supported`（with scope）
- spec §11 claim
- 官方文档 [extensions § ctx.switchSession](https://pi.dev/docs/latest/extensions#ctx-switchsession-sessionpath-options)：原生支持，签名 `ctx.switchSession(sessionPath, options?)`，`withSession` 回调执行 post-switch 注入
- **重要边界**：switchSession **接受的是 session file path**（不是任意 id），并且 **只在当前 extension 进程的 command / event handler 上下文中可调**（不能在另一个 `pi` CLI 进程里调）
- **结论**：spec 把 "session by id" 重新定义为 "session by file path" 即可标 `supported`（with scope: in-extension only）。spec 也未指明 OMP role→session_file 的映射关系 —— **这是 spec 没填的洞**，但不属于 Pi API 限制

### 2.9 Native visible peer session spawn —— `compatibility_target` → **capability 名字错位**
- spec §11 claim
- 官方文档 [extensions § ctx.newSession](https://pi.dev/docs/latest/extensions#ctx-newsession-options)：原生支持，签名 `ctx.newSession({ parentSession, setup, withSession })`
- **关键区分**：`ctx.newSession()` 是 **in-extension 派生**（同一个 Pi 进程派生新 session file）；spec 关心的 "visible peer script" 是 **跨进程 shell 脚本派生**（新开终端跑 `pi --provider ... --model ...`）
- **结论**：spec 的 capability 名应改为 "Visible peer script launch"。这条是 `local_protocol`（OMP 自有 launch scripts），**不是 Pi API 兼容目标**。`ctx.newSession()` 另起一行标 `supported (in-extension only, not used for visible peer mesh)`

### 2.10 HTTP/SSE transport —— `compatibility_target` ✅
- spec §11 claim
- 官方文档无相关 API（HTTPS/SSE 不在 Pi 核心范围）。当前 OMP 用本地 JSONL 协议
- **结论**：spec 标对，本轮不引入

### 2.11 Ghostty unattended GUI —— `local_environment_risk` ✅
- spec §11 claim
- 这不是 Pi API 维度，是本地 terminal 行为。spec 标对
- **结论**：spec 标对

### 2.12 §15 open items 文档证据（7 项）

| §15 # | 提问 | 官方文档答案 | spec 是否需更新 |
| --- | --- | --- | --- |
| 1 | "Pi exposes reliable session resume by id" | `ctx.switchSession(sessionPath, options?)` 支持，**by file path**（非任意 id），**in-extension only** | **是**：把提问改成 "Pi exposes reliable session resume by file path? scope = in-extension only?" |
| 2 | "`pi.sendMessage` can target a previous visible session" | **不能**。sendMessage / sendUserMessage 都只注入当前 session | **是**：回答 "No, current Pi API only injects into current session" |
| 3 | "`deliverAs` can reduce local protocol surface" | `deliverAs` 只控制当前 session 派发时机（steer/followUp/nextTurn），**不**跨 session | **是**：回答 "deliverAs is intra-session timing; cross-session routing still requires local packet protocol" |
| 4 | "Native UI select/custom should replace text-only picker" | `ctx.ui.select()` / `ctx.ui.custom()` 官方都支持 | **是**：回答 "supported, ready to use; spec can drop pending_api_audit label" |
| 5 | "Footer/widget can read compact multi-Mission status" | `setWidget` / `setFooter` 官方都支持，多 Mission 聚合是**实现工作不是 API 缺** | **是**：回答 "supported; implementation work, not API gap" |
| 6 | "Package install / `pi -e ./index.ts` still discover skills" | `pi.skills` package.json key + `skills/` convention dirs + `resources_discover` 事件，已对齐 | **是**：回答 "supported, already verified by local records (`records/2026-06-16-pi-topology-official-api-audit.md`)" |
| 7 | "Native lifecycle hook can mark parked/closed more cleanly than local JSONL" | `session_shutdown` fires on session end，**不**提供 parked/closed 这种业务级 lifecycle | **是**：回答 "No native primitive for OMP's business-level parked/closed; local JSONL is correct" |

**§15 7 项里，5 项可由官方文档直接回答**，spec 的 audit 工作主要是"验证 spec claim 与官方文档一致"而非"等实测"。**2 项需要实测**（#6 package install 加载路径已在 `2026-06-16-…-api-audit.md` 验证；#7 无 native primitive 已知，本地 JSONL 仍用）。

---

## 3. Spec 内部一致性与红旗

### 3.1 §11 alignment table 不全
spec §11 有 11 行，但漏了以下官方支持的能力：

- `ctx.ui.select()` / `ctx.ui.confirm()` / `ctx.ui.input()` / `ctx.ui.editor()` / `ctx.ui.notify()` —— 5 个 dialog API，官方全支持，spec §10/§15 都引用了 select/custom 但表里没列
- `ctx.ui.setFooter()` —— 替换整个 footer，与 setWidget 配合
- `ctx.newSession(options?)` —— 派生 session
- `ctx.switchSession(sessionPath, options?)` —— 切换到 prior session
- `pi.getCommands()` —— 列出当前所有 slash commands，spec /topology 实现可用
- `pi.getAllTools()` —— 列出当前所有工具，supervisor 启动时 sanity check 可用
- `keybindings.json` —— 注册自定义 keybinding（spec 不一定要用，但 §11 应说明是否在范围）

**建议**：§11 加 1 节 "additional official Pi primitives reviewed"，把这 7 项列清 + 标 label。

### 3.2 物理 packet 目录 vs 逻辑 filter
- spec §2 baseline 说 raw packet 路径在 `.pi/topology/ 之外`（`<PI_COMS_DIR or /tmp/pi-topology-…>/projects/<project>/packets/`）
- spec §3.1 layout 把 `packet-ledger.jsonl` 放在 `.pi/topology/missions/<mission_id>/` 内部
- spec §7 default active reads "filter active reads by Mission id" —— 逻辑层 filter

**不一致点**：raw transport 跨 Mission 共享，per-Mission ledger 写在 mission folder 里。当 supervisor 写 ledger entry 时，是从 raw transport 拉 packet 写到 per-Mission ledger，还是 raw transport 路由到正确 mission folder？

**建议**：spec §2 加一节说明 raw transport 写入 + per-Mission ledger 是 **写时路由还是读时过滤**，否则 Pi Coder 在第 4 切片（inbox cleanup）会卡住。

### 3.3 §3.1 slice 文件布局 vs §13 handoff 要求
- spec §3.1 layout: `slices/<slice_id>-notes.md` + `<slice_id>-smoke.log`（2 文件）
- spec §13: "Each slice handoff must include 7 项"（notes / changed files / focused tests / smoke output / evidence paths / commit hash / risks）
- spec §14 tests 文件位置未规定

**不一致点**：layout 只放 2 文件，但 handoff 要 7 项。第 5/6/7 项（evidence paths / commit hash / risks）放哪里？layout 缺 `<slice_id>-commit.txt` 与 `<slice_id>-risks.md`。

**建议**：§3.1 加 5 个文件 OR 把 7 项统一放在 `<slice_id>-notes.md` 内（包含 changed files 列表 / commit hash / risks）。倾向后者：单 notes 文件包含全部 + 单独的 smoke.log 与 test 输出。

### 3.4 §3.4 mission-registry.json 字段冗余
每个 mission entry 同时有 `lifecycle_state` 和 `progress_status`，都设为 `awaiting_owner_confirmation`。spec 没解释为何要两个字段。

**建议**：合并为一个字段，或显式说 "lifecycle_state = Mission-level; progress_status = 当前 slice-level"。否则 reviewer 不知道哪个作 dashboard 真相源。

### 3.5 §4.2 session states 过多（11 个）
spec 把 `planned / script_written / launch_printed / launch_requested / alive_confirmed / live / resumable / stale / parked / closed / failed` 全部列了。PRD 只要 5 分类（live/resumable/stale/parked/closed）。

**分析**：spec 区分 `script_written / launch_printed / launch_requested` 主要是为了 §8 unacceptable evidence 那条 "launch_requested row ≠ alive"。**但用 3 个 state 来表达"还没活"是把同一类证据切 3 段，可能造成 dashboard 噪声**。

**建议**：保留 `alive_confirmed` / `live` 两态细分（spec 区分 evidence-level vs derived 是对的）。但 `script_written / launch_printed / launch_requested` 三态可合并为 `pre_launch`，附 `launch_step: "script_written" | "launch_printed" | "launch_requested"` 子字段。这样 dashboard 不需要判 3 个 state。

### 3.6 §4 state machine 缺 transition 规则
spec 列了 6 个 state machine 的 state 集合，但**没说哪些事件触发哪些 transition**。例如 session state 从 `script_written` 到 `alive_confirmed` 需要什么 event？没有 transition 表，reviewer 没法验证完整性。

**建议**：每个 state machine 至少给一个 transition table（state × event → next state），或者显式说 "transition logic is implementation detail, but every transition MUST append a `*_transition` event"。

### 3.7 §6.1 缺 read-only role 的 allowed_paths 约定
spec §6.1 写 "runner/oracle/librarian/scott are read-only"，但 launch metadata 11 字段里**`allowed_paths` 对 read-only role 没规则**。如果 allowed_paths 留空，runtime 不知道是"无路径限制"还是"禁止任何写"。

**建议**：§6.1 加 "read-only roles MUST set `allowed_paths: []` (empty list, no write paths) AND `write_policy: 'deny_all_writes'`"。

### 3.8 §6.2 缺 stop / park / close 启动模式
spec 列了 3 个 launch mode：`print / direct_script / launch`。但 §4.2 session states 有 `parked` 和 `closed`，§9.2 rollback 第 4 步 "park Mission"。

**不一致点**：**没有 stop / park launch mode**。owner 想把一个 live role 切到 parked 怎么操作？spec 没说。

**建议**：§6.2 加 `park` 与 `close` 模式（或单独 §6.5 "Lifecycle actions on running roles"），定义如何把 `live` role 转 `parked` / `closed` 而不删 evidence。

### 3.9 §12.1 inferred empty files 应打标
spec §12.1 migration "If copied files are missing, create empty compatible files and record inference"。

**问题**：空文件（`runtime-events.jsonl` 等空文件）后期会与真实空文件混淆。reviewer 看到空文件会以为 "Mission 没活动"，实际上是因为 migration 时没数据。

**建议**：migration 阶段生成的空文件必须带 `inferred_empty: true` 字段（JSON 头一行 comment 或 `_meta` 字段），spec §12.1 加这一条。

### 3.10 §13 切片依赖关系未声明
spec §13 列 7 个 slice，handoff §1 Step 5 也是 7 个，**但 spec 没说 slice 间依赖**。例如：
- slice 2 (Supervisor picker) 依赖 slice 1 (registry) ✅ 显然
- slice 3 (session registry) 依赖 slice 1 (目录) ✅
- slice 4 (inbox cleanup) 依赖 slice 1, slice 3
- slice 5 (dashboard) 依赖 slice 1, slice 3
- slice 6 (migration) 依赖 slice 1, slice 2, slice 3, slice 4, slice 5（必须等所有 per-Mission 操作稳定才能迁移）
- slice 7 (final dogfood) 依赖 1-6

**建议**：§13 加 dependency graph（"slice N 阻塞 slice M"），让 Pi Coder 知道并行 / 串行约束。

### 3.11 §14 dogfood evidence "string check" 脆弱
spec §14 "verify generated role scripts contain `--provider minimax-cn --model MiniMax-M3 --thinking low`"。

**问题**：模型名 / thinking level 改了，测试就挂。**fragile 到与 baseline 绑死**。

**建议**：spec 把 "MiniMax-M3" 改为占位符 `<<CURRENT_VERIFIED_MODEL>>`，或定义一个 `baseline.json` 文件专门存这些常量。

### 3.12 §6.1 缺 "policy change mid-mission" 行为
spec §6.1 "Mismatches block launch" —— 是 launch-time check。但 **Mission policy 在 Mission 跑了一半后改了**（owner 加权限、改 role 描述）怎么办？

- 已 live 的 role 行为？
- 已 planned 但未 launch 的 role 行为？
- launch metadata 的 `permission_source` 是 snapshot 还是 live pointer？

**建议**：§6.1 加 "Policy change does not retroactively affect already-launched roles. Planned but not yet launched roles must re-validate against new policy before launch." 

### 3.13 §15.3 + §11 deliverAs 期望
spec §15.3 问 "Whether `deliverAs` or equivalent delivery metadata can reduce local protocol surface"。

**文档证据**：deliverAs 是 `pi.sendMessage` 的 intra-session timing 模式（steer/followUp/nextTurn），**与跨 session 派发无关**。

**spec 真正想问的可能是**：能不能用 Pi 原生 API 替代本地 packet 协议做 role-to-role 通信？答案：当前 Pi API 不支持，OMP 必须用本地 packet 协议。

**建议**：spec §15.3 改述为 "Whether Pi exposes a cross-session message routing primitive that could replace parts of the local packet protocol"。这样 audit 给得出"否，本地协议保留"的明确答案。

### 3.14 §10 + §15 deterministic chooser 措辞
spec §10 "Deterministic chooser UI using Pi native select/custom controls is `pending_api_audit` for this round" + §15.4 问是否要用 native select/custom 替换 text-only picker。

**文档证据**：`ctx.ui.select()` 与 `ctx.ui.custom()` 都官方支持。

**结论**：**`pending_api_audit` 标错**。spec 想问的是"什么时候切到 native chooser 才合理"，不是"native chooser 是否存在"。

**建议**：§10 改为 "Native chooser UI is `supported`; this round keeps text-only picker for compatibility, with future-compat path to native chooser when the picker UX becomes a hot spot." §15.4 改成 "Identify conditions under which the text-only picker should be replaced by native chooser."

---

## 4. 关键建议（Spec 启动前必改）

按阻塞性排序：

1. **§11 alignment table 改名 / 调标**（2.8, 2.9, 2.13）
   - "Native resume by prior session id" → "Native session resume by file path" 标 `supported`（with scope: in-extension only）
   - "Native visible peer session spawn" → "Visible peer script launch" 标 `local_protocol`
   - 新增 `ctx.newSession()` 标 `supported`（in-extension only, not used for visible peer mesh）
   - 新增 `ctx.switchSession()` 标 `supported`（in-extension only, not role-to-session mapping）
   - 新增 5 个 dialog API 标 `supported`

2. **§15 open items 7 项改述 + 预填答案**（2.12）
   - 5 项官方文档已可答，写进 §15
   - 2 项（#2, #3）官方文档明确 "不能" —— spec 需重述提问

3. **§3.1 slice 文件布局补全**（3.3）
   - 加 `<slice_id>-commit.txt` 与 `<slice_id>-risks.md`，或合并进 notes

4. **§13 切片依赖图**（3.10）
   - 加 "slice 1-5 不依赖；slice 6 依赖 1-5；slice 7 依赖 1-6"

5. **§6.2 加 stop / park 模式**（3.8）
   - 或加 §6.5 "Lifecycle actions on running roles"

6. **§6.1 加 read-only role allowed_paths 约定**（3.7）
   - "read-only roles MUST set `allowed_paths: []` AND `write_policy: 'deny_all_writes'`"

7. **§12.1 inferred empty files 打标**（3.9）
   - migration 阶段生成空文件必须带 `inferred_empty: true` 字段

8. **§14 dogfood evidence 用占位符**（3.11）
   - "MiniMax-M3" → `<<CURRENT_VERIFIED_MODEL>>` 或 `baseline.json`

---

## 5. 次要建议（spec 阶段处理即可）

- §3.4 registry 字段冗余（3.4）—— 合并或显式分层
- §4.2 session 11 态合并（3.5）—— 3 个 pre-launch 态合并 + 子字段
- §4 state machine transition table（3.6）—— 加 transition rules
- §6.1 policy change 行为（3.12）—— 加 mid-mission policy change 规则
- §2 + §7 raw transport vs per-Mission ledger 关系（3.2）—— 加写时路由 vs 读时过滤
- §10 / §15.4 chooser 措辞（3.14）—— 改 "supported + future-compat" 措辞
- §3.3 event_id 格式—— 加 `evt_<ISO8601>_<hash>` 之类的具体语法
- §3.1 mission_id 格式—— `project-2026-06-17-001` 是 example，应给正式规则

---

## 6. Stage 2 总结

| 维度 | 状态 | 备注 |
| --- | --- | --- |
| PRD 覆盖度 | ✅ 9/10 必补项落实 | 10/10 需 spec 同步改后落实 |
| Pi 官方文档对位 | ⚠️ 2-3 项需调 | §11 + §15 8 处需改 |
| Spec 内部一致性 | ⚠️ 14 项红旗 | 见 §3（4 项必改 + 10 项次要）|
| 实施就绪度 | ✅ 主体就绪 | 改完 §4 关键 4 项后可交 Pi Coder |

**结论**：spec 是 reviewer-draft，**改完 §4 关键 4 项后可进 Pi Coder 实现阶段**。Pi Coder 应按 §13 切片顺序执行，每片带 §13 列的 7 项 handoff 材料 + §14 9 项 focused tests 中与本片相关的子集 + `npm run smoke` 通过日志。

**未在本 review 决议的事项**：

- 切 1-7 中哪一片先做，owner 决定（建议按 §13 顺序）
- PRD 是否同步补 4 项（spec 阶段只补 spec 的话，PRD 留作下一轮迭代）
- spec §11 调标后是否要出新版 `records/2026-06-17-pi-topology-mission-runtime-api-audit.md`（建议是）

---

## 7. Reviewer 立场

本 review 不修改 spec（Codex Reviewer 职责），仅提供 8 项必改 + 8 项次要建议。

后续流程：Codex Reviewer 决定是否采纳 → 改 spec → 出新版 spec → 启动 Stage 3 实施。Stage 3 启动时 Pi Coder 拿到的 spec 应**包含本 review 提的关键 4 项修改**（§11 + §15 + §3.1 + §13）。
