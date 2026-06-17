# PRD Review: Pi Topology Mission Runtime

日期：2026-06-17
项目：OMP拓扑网络 / `packages/pi-topology`
评审者：Pi session (MiniMax-M3, Pi Harness)
评审对象：`docs/13-pi-topology-mission-runtime-prd.md` (reviewer draft)
评审类型：认知层面 review (Stage 1 of Codex Reviewer → Pi Coder 3-阶段工作流)
评审视角：**mesh 多 Agent 协作下，基础设施是否够支撑开发的顺利推进、Evidence 保存、状态的正确读取**

## 总体判定

PRD 已经在 PRD 层把 "状态 5 分类 (live/resumable/stale/parked/closed)"、"per-Mission 9 类记录"、"显式 non-goal (deletion-based cleanup / hidden permission transfer)" 立住了，**正反两面都列了证据清单** (§8 acceptable + unacceptable)。基础设施工具的形状是对的，**不**是另起炉灶，是**对当前单 mission-card 形态做有限外推**。

但 PRD 在 **3 个 mesh 协作关键缝隙** 上留了 spec 兜底——这些缝隙直接关系 "开发能否推进" 和 "状态能否被读对"。Spec 启动前建议先补 4 条到 PRD 层面（见第 6 节），否则 Pi Coder 在第 2-3 片会撞墙。

---

## 1. 开发的顺利推进（mesh 推进链路是否支撑）

### 1.1 强项

- **§3.5 reviewable slices** + **§7.9 reviewer inspect PRD/spec/audit/gap/notes/tests/evidence** —— 给 Pi Coder 留了一条 "做完一片就交、回滚有据" 的推进路径。
- **§3.4 7 段 lifecycle** + **"Moving between lifecycle states must write an explicit event"** —— 切片之间的状态转换有日志可查，**是 mesh 推进的最低基础设施**。
- **§8 unacceptable evidence** 显式列了 5 类假阳性：
  - Ghostty 窗开了 ≠ 活着
  - `launch_requested` ≠ 自证
  - historical session ≠ 新活
  - 混 Missions 计数 ≠ active
  - 删 packet ≠ 清理
  这等于把 owner/reviewer 最常踩的坑**预先排除**。

### 1.2 Gaps

#### Gap 1.1：切片间 handoff 缺模板
- §3.5 说 "reviewable slices"，但**没说每片交付包长什么样**。
- handoff §1 Step 5 暗示是 "implementation note + tests + smoke + commit"，**PRD 没把这个模板写进来**。
- 后果：Pi Coder 第 1 片按自己的理解交，Reviewer 第 2 片又换模板，**两片之间 reviewer 解读成本随片数线性涨**。
- **建议 PRD 补**："每切片交付包 = `{slice_id}-notes.md + focused tests + smoke log + changed files + commit hash}`，模板见 `templates/slice-handoff.md`（或 spec 阶段定）。"

#### Gap 1.2：rollback 路径未声明
- §3.4 lifecycle 7 步里**没有 "rollback"**。如果第 3 片 smoke 挂了，owner 是 "回到第 2 片状态" 还是 "标记 broken + 等决策"？PRD 未规定。
- **建议**：要么 lifecycle 加 rollback 步，要么显式说 "rollback 走 decision gate (§9) 触发"。

#### Gap 1.3：commit 粒度约定缺
- 当前 handoff §1 Step 5 说 "local commit"，但**未规定 atomic commit 还是 per-file commit**。
- **建议**：PRD 加 "evidence commit convention"：每片 = 1 atomic commit，message 格式 `slice(<id>): <summary>`，reviewer 用 `git log --grep` 直接定位。

---

## 2. Evidence 保存（mesh 协作中能否取证/审计）

### 2.1 强项

- **§3.2 "Mission state should live in project files, not only chat history"** —— 这条是整套 evidence 体系的**根**。Pi transcript 是 context，不是 evidence。PRD 直接划线。
- **§5.3 9 类 per-Mission 记录**：
  - mission card
  - status board
  - runtime event ledger
  - packet ledger / packet index
  - artifacts
  - role/session registry
  - launch scripts / launch metadata
  - incidents
  - closeout record
  一个 Mission folder 自成审计单元，**多 Mission 共存时不串**。
- **§5.6 cleanup "must not silently destroy"** —— 反 deletion 是 evidence 保存的硬约束，落到 non-goal (§6) 二次确认。
- **§6 非目标**显式列了 "deletion-based cleanup" 和 "replacement for Pi's own transcript/session storage" —— owner 不能用 PRD 当借口让 reviewer 把原始 `sessions.jsonl` 删了。

### 2.2 Gaps

#### Gap 2.1：evidence 路径约定缺
- §8 列出 acceptable evidence 但**没说每条 evidence 必须有稳定可链接的 path**。
- 如果 reviewer 想从 `records/2026-06-17-…-prd-review.md` 跳到某条 evidence，路径是 `runs/<mission_id>/artifacts/<file>` 还是 `<mission_id>/runtime-events.jsonl:L42`？**约定缺**。
- **建议**：PRD 加 "evidence path convention"：每条 evidence 必须有 mission-scoped 的可引用路径，具体语法留给 spec。

#### Gap 2.2："compaction" 与 "deletion" 边界不清
- §5.6 说 cleanup 可以 "mark, filter, compact, or index" 但 "must not silently destroy" —— **那 compaction 算不算 destroy？**
- 例：把 N 条 packet 合并成 1 条 summary 算 compaction 吗？合并后原 N 条还在吗？PRD 没答。
- **建议**：PRD 加 "compaction" 定义 —— 只允许**生成新 summary 索引**，**原 evidence 不动**。这样 compaction ≠ deletion。

#### Gap 2.3：历史 session 转为 evidence 的门槛
- §3.3 给了 5 分类 (live/resumable/stale/parked/closed)，但**"resumable" → "stale" 之间没有自动转化的证据门槛**。
- 例：一条 `sessions.jsonl` 里的 role session，3 天没新 event 了，是 resumable 还是 stale？PRD 没规则。**这条不写 spec，会出现 reviewer A 判 stale，reviewer B 判 resumable 的扯皮**。
- **建议**：PRD 加 "freshness window" 概念（具体阈值留给 spec），让 resumable → stale 的自动转化有据。

---

## 3. 状态的正确读取（owner/reviewer 能否读对当前态）

### 3.1 强项

- **§3.3 5-state classification** (live/resumable/stale/parked/closed) —— 这是**状态读取正确性的核心抽象**，5 态互相排斥，1 角色只可能落 1 态。
- **§5.1 picker 列出 8 字段**：
  - active marker
  - title / objective
  - lifecycle state
  - last updated time
  - owner gate state
  - live/stale/parked role summary
  - pending packet count (Mission only)
  - blocked / incident marker
  owner 在 `/topology` 入口就能**一眼读出 Mission 健康度**，不需要开 JSON。
- **§5.7 dashboard compact + current-Mission-first + historical discoverable** —— 防止 "历史 Mission 噪声淹没当前 Mission"，是 state reading 最常翻车的点。
- **§8 显式列 "packet count that includes other Missions as active work" 为 unacceptable** —— 反例即规约，reviewer 有据判错。

### 3.2 Gaps

#### Gap 3.1：多 Mission 并发读取没边界
- §5.1 说 "/topology" 展示 picker。**当 owner 跑 `/topology` 时，3 个 Mission 正在被不同 role session 推进** —— picker 是 read-only（不阻塞）还是 "暂停所有 Missions 让 owner 选"？
- 后果：如果 read-only，owner 选了 "create new Mission" 时，**另一个 Mission 的 HQ 正在 launch runner** —— 并发状态变更下，picker 列表可能秒级过期。
- **建议**：PRD 加 "/topology picker is read-only snapshot at fetch time; mutations to other Missions during picker display do not roll back the owner's choice." 这条 spec 一定要写。

#### Gap 3.2：permission 边界**声称了但没工程化**
- §5.8 "Mission resume must not elevate a role's permissions" + §4 "horizontal communication only transfers information, not authority" —— 这两条是 OMP 的核心信条，**但 PRD 没规定 runtime 怎么 enforce**。
- 是约定俗成？还是 launch metadata 里带 role allow-list？还是 reviewer 在每个 slice 手动审计？
- 后果：如果只靠约定，Pi Coder 在某次 "relaunch runner" 时把 role 从 `runner(read-only)` 升级成 `runner+exec`，**没有 infra 拦**。
- **建议**：PRD 加 "permission enforcement" 一条：launch metadata 必须带 `role:scopes[]` 显式 allow-list，runtime 启动前校验。这条**必须落到 spec 的 state machine 里**，否则 OMP 信条会随切片累积慢慢漏。

#### Gap 3.3："Deliver result" 步骤无定义
- §3.4 lifecycle 第 5 步 "Deliver result" —— **什么是 deliver？**
  - 是 closeout record 写盘？
  - 是 Supervisor 跟 owner 口头确认？
  - 是 handoff 给下一个 Mission？
  - 还是把 artifacts 移到 `deliverables/` 目录？
- **建议**：PRD 加 deliver 的判定形式：必须产生 `closeout.md`（或类似）+ owner ack 事件，二者缺一不算 deliver。

---

## 4. Pi Harness 现状视角（当前 Pi session 实操观察）

我作为**当前 Pi session** 跑过 `topology_status`、`topology_doctor`、`topology_write_artifact` 这些 tool，知道 MCP 集成是有的。Spec 阶段做 API 审计时，有 4 条**实操层面**的提示：

### 4.1 "direct generated-script launch" 与 "Ghostty GUI launch" 的技术区分必须写清
- 当前实操：`pi --provider minimax-cn --model MiniMax-M3 --thinking low` 在终端跑 = generated-script lane；Ghostty = 在 macOS GUI 里开一个终端窗口跑同一条命令。**两者 spawn 的 process group 不一样**，runtime-evidence 落点也不一样。
- PRD §5.5 把两者分开说 "前者支持后者不算 evidence" —— **但没说区分点**。Spec 阶段 audit 一下 Ghostty 出的 stdout/stderr 能不能进 `runtime-events.jsonl`，如果能，它就**不是 evidence-disabled**，只是 **evidence-degraded**，PRD 措辞要调。

### 4.2 "session resume" 在当前 Pi 里的能力边界
- 当前 Pi session 有 `pi.sendMessage`（Harness 内部 message passing）但**没有 documented 的 "resume a prior session by ID"**。
- Spec 阶段 audit 时，这条很可能落 `compatibility_target` 或 `local_protocol` —— PRD §5.4 留了 fallback 空间，OK。

### 4.3 Footer / widget 怎么写状态（§10 #7 留的开放问题）
- 当前 Pi session 有 footer status line。Spec 阶段 audit 要查：footer 是否能读 `.pi/topology/status-board.json` 的内容？还是要走 MCP tool 渲染？**这条直接影响 "状态能否被正确读取" 在 HUD 层的可见性**。
- 参考已有对齐：`records/2026-06-16-pi-topology-official-api-audit.md` 已确认 `ctx.ui.setStatus` / `ctx.ui.setWidget` 与官方对齐，可复用。

### 4.4 Native session spawn 的现实
- 参考 `records/2026-06-16-pi-topology-official-api-audit.md` 末行 "Native session spawn 仍以 visible peer launch script 为主 — 待接入"。PRD §5.4 的 "prefer Pi-native session resume" 在当前 Pi 里**没有可用的 native primitive**，要按 `compatibility_target` 处理。

---

## 5. Reviewer 结论矩阵

| 维度 | 状态 | 阻塞性 |
| --- | --- | --- |
| 开发的顺利推进 | ✅ 路径清楚，**rollback 缺** | 阻塞第 2-3 片 |
| Evidence 保存 | ✅ 主体立住，**compaction 边界 + 路径约定缺** | 阻塞多 Mission 共存验证 |
| 状态的正确读取 | ✅ 5 态分类强，**并发 picker + permission enforce 缺** | 阻塞 OMP 信条审计 |
| Pi Harness 现状 | ⚠️ §5.5 措辞需调；§10 开放项要落 spec audit | Spec 阶段必查 |

---

## 6. PRD 补漏建议（Spec 启动前必补 4 条）

按优先级（从阻塞性最强的开始）：

1. **§5.8 加 permission enforce 机制**（launch metadata 带 `role:scopes[]`，runtime 启动前校验）
   - 阻塞：OMP 信条审计
   - 来源：Gap 3.2
2. **§3.3 5 态分类加 "freshness window" 概念**（具体阈值留 spec）
   - 阻塞：状态判定一致性
   - 来源：Gap 2.3
3. **§5.6 显式定义 "compaction ≠ deletion"**（原 evidence 不可变，可生成 summary index）
   - 阻塞：多 Mission evidence 共存
   - 来源：Gap 2.2
4. **§3.4 lifecycle 加 "rollback" 步**（或显式指向 §9 decision gate 触发）
   - 阻塞：第 2-3 片异常处理
   - 来源：Gap 1.2

补这 4 条后，Spec 阶段可以照 §10 8 个开放问题直接展开，不用回头改 PRD。

---

## 7. 次要建议（Spec 阶段处理即可，PRD 可不改）

- Gap 1.1 切片交付包模板 → 落到 `templates/slice-handoff.md`，spec 引用
- Gap 1.3 commit 粒度约定 → 写入 spec 的 reviewer checklist
- Gap 2.1 evidence 路径约定 → 写入 spec 的 state machine 字段
- Gap 3.1 picker 快照语义 → 写入 spec 的 `/topology` 行为规约
- Gap 3.3 "deliver" 判定形式 → 写入 spec 的 lifecycle state machine transition
- Gap 4.1 §5.5 措辞调整 → 写到 spec 阶段 audit 结论中（如果是 evidence-degraded 而非 evidence-disabled，PRD 措辞再调）

---

## 8. Reviewer 立场

本 review 不修改 PRD（Codex Reviewer 职责），仅提供 4 条必补 + 6 条次要建议给 Codex Reviewer。

后续流程：等 Codex Reviewer 决定是否补 PRD（建议补 4 条），或直接进 Spec 阶段把次要项写入 spec。等 Spec 路径到位后，Stage 2 认知 review 再启动。
