---
obsidian-note-type: architecture-survey
target: agent-lab
project: pi-vs-claude-code-to-omp
date: 2026-06-14
author: agent (Cave knowledge steward)
tags: [omp, coms, openclaw, hermes, fleet-console, mesh, hq, control-plane, web-ui, survey]
related: [[Coms本地嵌入方案-2026-06-14]] [[严格评审-2026-06-14]]
status: decision-support
---

# Fleet Console 可行性调研（OpenClaw / Hermes vs 我们的 OMP Mesh）

> **本文件不写"完整源码级调研"**——那是更下游的工作。
> **本文件直接给决策**：要不要把 OpenClaw / Hermes 的某些层拿来给 OMP Mesh 用？哪些能用、哪些不能、哪些是 OMP 独有的。
>
> **位置**：本调研的**真正上游**是 `Coms本地嵌入方案-2026-06-14.md`（Phase 1+2 已实跑：4 session 平级通信）。
> **本调研覆盖**：Phase 2+ 选型——跨网络 coms-net / Session Supervisor / Web Control Plane / HQ 编排 / 长期 mesh 监督。

---

## 0. 一句话结论（先读这段）

| 维度 | OpenClaw | Hermes | OMP 现状 | 决策 |
|------|----------|--------|---------|------|
| **Web Control UI** | ✅ Vite + Lit @ 18789（成熟） | ✅ 继承 | ❌ 无 | **借 OpenClaw schema** + 自己实现（不接 channel inbox） |
| **Session RPC 协议** | ✅ `sessions.list`/`send`/`abort`/`steer`（完整） | ✅ 继承 | ⚠️ SDK 只有 `prompt()` + typed events | **借 OpenClaw RPC 命名** + OMP SDK 包装 |
| **Heartbeat / Tick / Health** | ✅ 15s tick + heartbeat event | ✅ 继承 | ❌ 进程内无 | **直接照搬 OpenClaw 模式** |
| **Coms graph（多 session 拓扑）** | ❌ 无（按 channel 路由，不是 mesh） | ❌ 继承 | ⚠️ 本地 coms（Unix socket） | **必须自己造**——OpenClaw 不解决 |
| **Handoff（session 死了接班）** | ❌ 无 | ❌ 无 | ❌ 无 | **必须自己造** |
| **Git dirty state** | ❌ 无 | ❌ 无 | ⚠️ worktree 隔离 | **必须自己造**——`git status --porcelain` 集成 |
| **Coding agent 内核** | ⚠️ bash + read/write + canvas | ⚠️ 继承 | ✅ **LSP/DAP/Hashline/TTSR/IRC/Hindsight/native Rust** | **OMP 完胜**——这是用 OMP 的核心理由 |
| **Memory closed-loop** | ⚠️ QMD dreaming + commitments | ⚠️ MEMORY.md + USER.md 字符硬限 | ✅ Hindsight retain/recall/reflect | **OMP 不输 Hermes**（甚至更强） |
| **Long-running / overnight** | ✅ cron + fresh session per run | ✅ 继承 + no-agent mode | ⚠️ 进程生命周期 | **直接照搬 cron 模式** |

**总决策**：
- **不要 fork OpenClaw / Hermes 替代我们的 OMP Mesh**——它们的 coding 内核远远不如 OMP
- **借 OpenClaw 的"协议层"**（WebSocket 帧 schema + RPC method 命名 + event family + scope gating + device pairing）当作我们 Fleet Supervisor 的设计参考
- **自己造 4 个 OpenClaw 没有的能力**：Coms graph / Handoff protocol / Git dirty integration / HQ 两级编排
- **Hermes 几乎不需要借鉴**——它是 OpenClaw 的继任者（README 明确支持 `hermes claw migrate`），且 3 个独特点对 OMP 生态都没增量

---

## 1. 用户两个核心问题的直接答案

### 问题 1：OMP 外层 Fleet Console 和 OpenClaw 重叠多少？OpenClaw 能否实现？OMP 是不是"基础设施级别"更强？

**直接答案**：

> **OpenClaw 70% 可复用（基础设施层），30% 不能用（差异化能力）**。
> **OMP 的"agent runtime 内核"在 coding 场景下远超 OpenClaw**——这不是 MCP 能补的。

**为什么 OpenClaw 实现不了 OMP 做的事**——4 个具体证据：

#### 1.1 LSP（Language Server Protocol）—— OMP 真接，OpenClaw 没有

| OMP（来自 `Cave/oh-my-pi-usage-deep-dive.md` 第 2.1 / 5.5） | OpenClaw |
|------|----------|
| 内置 `lsp` 工具，13 个 ops（diagnostics/navigation/symbols/rename/codeActions/raw） | 没有 `lsp` 工具 |
| Rust crate `omp-searcher` 1900 行 | 没有对应实现 |
| `lspmux.ts` 多语言 LSP multiplexer | 没有 |
| `clients/biome.ts` / `swiftlint.ts` 等具体语言 client | 没有 |
| `workspace/willRenameFiles` rename 写入通过 LSP | 完全没有 LSP 路径 |
| 写入时通过 `workspace/willRenameFiles` 把工具调用走 LSP | agent 改文件只能靠 read + 自己推理 |

**为什么 MCP 补不了**：
MCP server 可以包 LSP（如 Continue.dev 风格的 MCP），但那是**远程调用 + JSON RPC + 跨进程**——延迟 / 状态 / 编辑原子性都比不上 OMP 的 in-process Rust LSP client。
**MCP 包 LSP 是"看 LSP"，OMP 的 LSP 是"用 LSP 改"**——后者才能做 workspace rename / willRenameFiles 这种语义级编辑。

#### 1.2 DAP（Debug Adapter Protocol）—— OMP 真接，OpenClaw 没有

| OMP | OpenClaw |
|-----|----------|
| 内置 `debug` 工具，27 个 ops（breakpoints/stepping/threads/stack/variables） | 没有 debug 工具 |
| 支持 lldb / dlv / debugpy | 不支持 |
| agent 可断点 / 单步 / inspect 变量 | agent 只能靠 print debug 或 "describe" 推理 |

**为什么 MCP 补不了**：
DAP 调试需要**长连接 + stateful session**——MCP server 包 DAP 经常断连。
**OMP 的 DAP 是"真打断点 + 真 inspect"**——不是 print 替代品。

#### 1.3 Hashline / Time-Traveling Stream Rules —— OMP 独有

**Hashline 编辑**（OMP `edit` 工具）：
- 不用重打整个文件
- 用 content-hash 锚点（小段文本 + hash）做精准 edit
- hash 不匹配自动重读 → 防止 LLM 改错位置
- 节省大量 token（不必为了一次 edit 重发整个文件）

**TTSR（Time-Traveling Stream Rules）**：
- 模型走偏时 mid-token abort
- 注入规则
- **Injections 存活过 compaction**——fix 一次就永久生效
- `omp.sh/clips/ttsr-poster.webp` 有官方 demo

**OpenClaw 没有等价物**——它的 `edit` 工具是普通字符串替换 + diff。
**这不是 MCP 能补的**——这是**runtime 行为**（abort mid-token + inject system reminder），不是工具调用。

#### 1.4 IRC 进程内 subagent 通信 —— OMP 独有

OMP 的 `irc({ op: "send/list" })`：
- 进程内消息总线
- 零网络延迟
- subagent 之间真正实时协调
- `replyTo` 支持 request-response 模式
- **消息类型 + payload 自定义**——不只是 string

**OpenClaw 的跨 session 通信**：
- 必须经过 WebSocket 帧
- 走 JSON 序列化 + 反序列化
- 有网络延迟
- schema 受 OpenClaw 协议限制

**为什么这对我们 OMP Mesh 关键**：
> 4 个 OMP session 都在**同一台机器**——跨 session 通信**不需要网络**。OMP 的 IRC 设计哲学（in-process 通信）正是我们的场景。OpenClaw 的 WebSocket 通信是给**跨网络的 client** 用的，杀鸡用牛刀。

#### 1.5 Hindsight Memory —— OMP 不输 Hermes

| 系统 | 机制 | 限制 |
|------|------|------|
| **OMP Hindsight** | `retain` / `recall` / `reflect` 工具 + project-scoped bank | 项目级自动隔离 |
| **Hermes** | MEMORY.md (2200 chars) + USER.md (1375 chars) + frozen snapshot | 字符硬上限；不自动 compact |
| **OpenClaw QMD** | dreaming config + memory citations | 配置复杂 |

**OMP Hindsight 是项目级 bank**——切换项目自动换 bank，不需要 user model 抽象。
**Hermes 是 global bank**——所有项目共享 MEMORY.md + USER.md。
**对 OMP Mesh 场景（4 session 同一项目）OMP 更合适**——4 个 session 共享同一 project Hindsight bank。

#### 1.6 native Rust 性能 —— OMP 独有

OMP ~55,000 行 Rust core：

| Crate | 行数 | 作用 |
|-------|------|------|
| `omp-searcher` | 1,900 | 文件 / 文本搜索 |
| `keys` | 1,490 | Kitty keyboard protocol + PHF perfect-hash |
| `text` | 1,450 | ANSI-aware 宽度 / 截断 / 切片 |
| `summary` | 1,040 | Tree-sitter 源码 summarize |
| `ast` | 1,000 | ast-grep 模式匹配 |
| `fs_cache` | 840 | mtime-keyed 文件缓存 |
| `highlight` | (in syntect) | 11 语义类 + 30+ aliases |

**这不是"性能优化"**——这是**核心能力**：
- Tree-sitter 结构化源码 summarize 节省 61% token
- PHF perfect-hash 让 O(1) 命令查找
- ast-grep 模式匹配做结构性 edit
- fs_cache 让 read/grep/lsp 共享缓存

**MCP / secure / 远程 wrapper 补不了**——这是**和 OMP runtime 一起编译的 in-process crate**。

### 1.7 结论

> **OpenClaw 可以"实现"我们 70% 的需求，但实现出来的 coding agent 能力是 OpenClaw agent 的能力——不是 OMP 的能力**。
>
> **如果接受 OpenClaw 替代外层 OMP Mesh，就要放弃**：
> 1. LSP rename / willRenameFiles / semantic navigation
> 2. DAP 断点 / inspect 变量
> 3. Hashline 编辑（每次 edit 都要重打整文件）
> 4. TTSR（agent 走偏时无法 mid-token 干预）
> 5. IRC（subagent 通信要绕 HTTP / 走 OpenClaw session 协议）
> 6. Hindsight 项目级 bank（要拼凑 QMD + memory citations）
> 7. native Rust 性能（命令查找 / 源码 summarize / 文件缓存全变慢）
>
> **这就是为什么不能直接用 OpenClaw 替代 OMP Mesh**。
>
> **正确做法**：**OMP SDK 做 Agent Runtime**（每个 role session = 1 个 OMP SDK 实例）；**OpenClaw-style 协议做 Control Plane 协议**（WebSocket / RPC / events）。两者职责清晰分离。

---

### 问题 2：Hermes 的核心优势到底是什么？Memory / RPC / Research-Ready 对我们的真实价值？

**直接答案**：

| Hermes 独特点 | 真实价值 | 对 OMP Mesh 价值 |
|--------------|---------|-----------------|
| **Memory closed-loop** | 字符硬上限 + frozen snapshot + 不自动 compact | ❌ **低**——和 Pi 生态 memory / doc-as-memory / Graphify / Hermes 没差多少 |
| **Python RPC for tools** | 在主 agent context 外执行工具，结果不污染主 session | ⚠️ **有借鉴价值**——但 pi-subagents 也能近似 |
| **Research-ready** | batch trajectory generation + compression for training | ❌ **不直接用**——派生态 web-access + context-mode 已超过 |

#### 2.1 Memory closed-loop 真实评估

**Hermes MEMORY.md 设计的真相**：

```yaml
# ~/.hermes/memories/MEMORY.md
# Char limit: 2,200
# Frozen snapshot: session start 注入 system prompt
# 不自动 compact: 满了返回 error
```

**这本质是 OpenAI 风格的 prompt caching 哲学**：
- 把 memory 当作 **static system prompt injection** 来优化
- Frozen snapshot 保护 LLM prefix cache（不重算 KV cache）
- 字符硬上限强制 agent 自己做整理
- `add` / `replace` / `remove` 用 substring matching via `old_text`

**它比 Pi 生态强在哪**？

| 能力 | Hermes | Pi 生态 (Hindsight / Hermes / Graphify / doc-as-memory) |
|------|--------|------|
| 字符硬上限 | ✅ 2,200 + 1,375 | OMP Hindsight 没硬上限；doc-as-memory 由文档长度决定 |
| Frozen snapshot | ✅ | ❌ OMP Hindsight 是 project bank，每次 retain 立即生效 |
| LLM prefix cache 优化 | ✅ | ⚠️ 不显式 |
| 跨 session search | ✅ FTS5 + LLM summarization | ✅ context-mode FTS5 + 自动索引 |
| 自主 skill creation | ✅ | ⚠️ Pi skill 生态是用户写，不是 agent 自动创建 |
| Honcho dialectic user modeling | ✅ | ❌ Pi 没等价物（但我们也不需要） |

**真实价值**：
> Memory closed-loop **没比 Pi 生态强**——你自己说的"也就那样"是准确的。
> 真正可借鉴的是 **frozen snapshot 模式**（保护 prefix cache）+ **字符硬上限强制 agent 整理**——这两个是 OpenClaw / Hermes 都在用的工程经验，**可以借到 OMP Hindsight**（但 OMP Hindsight 现在没显式做这件事）。

**对 OMP Mesh 场景**：
> 4 个 OMP session 同一项目 → 共享 Hindsight bank → **不需要 global MEMORY.md**。
> Hindsight `retain` / `recall` / `reflect` 已经够用。

#### 2.2 Python RPC for tools（"zero-context-cost turns"）——**真正独特**

**Hermes 这点的真相**（来自 README）：

> "Spawn isolated subagents for parallel workstreams. Write Python scripts that call tools via RPC, collapsing multi-step pipelines into zero-context-cost turns."

**拆解**：
1. 写一个 Python 脚本
2. 脚本里调用工具（`@tool` decorator）via RPC
3. 主 agent 只看到**脚本的最终输出**
4. 脚本的中间步骤**不进入主 agent context**

**价值场景**：
- **复杂数据 ETL**——读 1000 个文件 + 提取字段 + join + 输出，主 agent 只看到 join 结果
- **多步研究**——5 个 sub-question 并行检索 + 合并，主 agent 只看到合并结论
- **deterministic pipeline**——固定 5 步操作，不必每次让 LLM 决定

**为什么 OMP 生态没有完全对等**：
- `pi-subagents` 有 subagent delegation（async / parallel / chain）
- **但 subagent 的每一步**仍然消耗父 session context
- OMP `task` 派单是**真 worktree 隔离**——比 subagent 更彻底，但**不是"脚本编排工具"**

**对我们 OMP Mesh 的价值**：
> **Coms Bus 的 message processing 可以用类似范式**：
> - 在 Strategic HQ 写 Python 脚本批量处理 coms log
> - 派单到 4 个 role session 不消耗 HQ context
> - Tactical HQ 可以"编排 + 不参与"——和 Hermes Python RPC 是同一思路

**借鉴方式**：
- 不需要从 Hermes 移植 Python RPC runtime
- **借鉴"zero-context-cost"的范式**——让 Strategic HQ 是"编排器"而不是"执行者"
- **用我们自己的 Coms Bus + JSONL** 实现这一层（已经在 `coms-omp-lite.ts` 的设计里部分有了）

#### 2.3 Research-ready trajectory generation

**Hermes 的真相**（来自 README）：

> "Batch trajectory generation. Trajectory compression for training the next generation of tool-calling models."

**这是为训练 tool-calling 模型准备数据**——不是普通用户用的功能。

**为什么派生态已经超过**：

| 能力 | Hermes Research-Ready | 派生态 |
|------|---------------------|--------|
| 批量轨迹生成 | ✅ `batch_runner.py` | ✅ `pi-subagents` 批量模式 + OpenCode batch |
| 训练数据准备 | ✅ trajectory compression | ⚠️ 需要自己写 |
| 库级代码搜索 + 文档 | ❌ | ✅ **`pi-web-access` librarian skill**——比 Hermes 强 |
| 自动 FTS5 索引 + 跨 session search | ✅ FTS5 session search | ✅ **`context-mode` FTS5 + auto-index**——派生态已经原生 |
| 实时文档索引 | ❌ | ✅ **`ctx_fetch_and_index` + 14 天 TTL** |

**真实价值**：
> Hermes Research-Ready **对训练团队有价值**。
> **对 OMP Mesh 场景（生产 mesh 监督）零价值**——我们要的不是"生成训练数据"，是"实时监督 + 干预"。

#### 2.4 Hermes 总结

> **Hermes 是 OpenClaw 的继任者**（README 明确支持 `hermes claw migrate`）——OpenClaw 实现的设计 Hermes 都继承。
> **3 个独特点中 2 个对 OMP Mesh 没增量**（Memory closed-loop / Research-ready）。
> **只有 Python RPC 有真实借鉴价值**——但可以用我们自己的 Coms Bus + JSONL 范式实现。
>
> **结论**：**Hermes 几乎不需要借鉴**——它解决的问题 OpenClaw 已经解决；它独有的 3 点里 2 点对 OMP 生态没增量。

---

## 2. OpenClaw Web Control UI / Gateway 协议——哪些**协议层**可借鉴

> **本节只列**"借鉴协议 schema / 命名"——不借鉴 OpenClaw 的 coding agent 内核。

### 2.1 WebSocket 帧 schema（直接照搬）

**来源**：`https://docs.openclaw.ai/gateway/protocol`（已直接 fetch 验证）

```typescript
// 3 种 frame type：event / req / res
{type: "event", event: "heartbeat", payload: {...}, seq?, stateVersion?}
{type: "req", id: "...", method: "sessions.list", params: {...}}
{type: "res", id: "...", ok: true, payload: {...} | error: {...}}
```

**借鉴的命名**（直接对应我们的需求）：

| OpenClaw 命名 | 我们的等价 | 用途 |
|--------------|----------|------|
| `sessions.list` | `sessions.list` | role mesh 列表 |
| `sessions.subscribe` | `sessions.subscribe` | 订阅 session 变更 |
| `sessions.create` | `sessions.create` | 创建 role session |
| `sessions.send` | `sessions.send` | send message |
| `sessions.steer` | `sessions.steer` | interrupt + steer |
| `sessions.abort` | `sessions.abort` | abort 活动工作 |
| `sessions.messages.subscribe` | `sessions.messages.subscribe` | 订阅 message 流 |
| `agent.wait` | `agent.wait` | 等待 run 完成 |
| `agent.identity.get` | `agent.identity.get` | 取 assistant identity |

**新增的 mesh-specific RPC**（OpenClaw 没有）：

| 新 RPC | 用途 |
|--------|------|
| `mesh.snapshot` | 当前 mesh 拓扑快照 |
| `mesh.subscribe` | 订阅 mesh 变化 |
| `graph.snapshot` | coms graph 当前状态 |
| `approval.request` | 请求 owner 审批 |
| `approval.resolve` | owner 审批决议 |
| `handoff.initiate` | 启动 session handoff |
| `handoff.ack` | 新 session 确认接管 |
| `git.dirty` | session 当前 working tree dirty 状态 |

### 2.2 Event family 命名（直接照搬 + 扩展）

**OpenClaw 已有**（直接照搬）：
- `heartbeat` — heartbeat event stream
- `tick` — 15s periodic keepalive
- `health` — gateway health snapshot
- `sessions.changed` — session index / metadata 变化
- `session.message` / `session.tool` / `session.operation` — session 流
- `cron` — cron run / job 变化
- `shutdown` — gateway shutdown

**新增的 mesh-specific event**（OpenClaw 没有）：
- `mesh.changed` — mesh 拓扑变化（role session 加入 / 离开 / 替换）
- `graph.changed` — coms graph 边变化
- `approval.requested` / `approval.resolved` — owner 审批
- `handoff.started` / `handoff.completed` / `handoff.failed` — handoff lifecycle
- `git.dirty.changed` — working tree 状态变化
- `role.health.degraded` / `role.health.recovered` — role 健康度变化

### 2.3 Scope gating（直接照搬）

**OpenClaw 的 scope 设计**（来自 docs/gateway/protocol）：

| Scope | 可访问 |
|-------|-------|
| `operator.read` | chat / agent / tool-result frames |
| `operator.write` | plugin / write ops |
| `operator.admin` | admin ops |
| **unrestricted** | heartbeat / presence / tick（transport health） |

**fail-closed by default**——未知 event family 默认拒绝。

**直接照搬到我们的 mesh**：
- 4 个 role session 各自有 scope
- Tactical HQ 订阅 `session.message` / `session.tool`
- Strategic HQ 订阅 `mesh.changed` / `approval.*` / `git.dirty`
- Web Control UI owner = `operator.admin`
- 未声明 scope 的 event 默认 drop

### 2.4 Device pairing 鉴权（直接照搬 + 简化）

**OpenClaw 流程**（来自 docs/web/control-ui）：
1. 新设备首次连接 → "disconnected (1008): pairing required"
2. Loopback auto-approve（127.0.0.1 / localhost）
3. Remote → `openclaw devices list` / `approve <requestId>` / `revoke --device <id>`
4. **Scope upgrade = approval upgrade**（不是 silent reconnect）

**简化到我们的 mesh**：
- Web Control UI loopback auto-approve（默认）
- 远端 owner 首次连接需要 explicit approve
- `fleetctl devices list` / `approve <requestId>` 命令

### 2.5 Session lifecycle 语义（直接照搬）

**OpenClaw session 语义**（来自 docs/concepts/session）：

- Daily reset（4 AM local）
- Idle reset（`session.reset.idleMinutes`）
- Manual reset（`/new` / `/reset` / `/new <model>`）
- **关键**：heartbeat / cron / exec system-event turns **不延长 session freshness**（避免假活跃）
- Reset 时：旧 session queued system-event notices **被 discarded**（不污染新 session）

**直接对应我们的 mesh**：
- hq-control 跑 7×24 → daily reset at 4 AM + idle reset after 6h
- smoke-runner / oracle-reviewer / repair-engineer → 按需 spawn（ephemeral lifetime ≤ task scope）
- 退役时序列化 state → 新 session 注入 → ack → 删旧 session
- **关键**：heartbeat 不延长 freshness——确保长期 OMP session 不会因为"假活跃"而不 reset

### 2.6 Sandbox / Bounded Autonomy Envelope（直接照搬 schema）

**OpenClaw `sandbox.mode`**（来自 docs/concepts/session 安全章节）：

```json5
{
  agents: {
    defaults: {
      sandbox: {
        mode: "non-main"  // 非 main session 自动 sandbox
      }
    }
  }
}
```

**默认 allowlist**（non-main session）：
- `bash`, `process`, `read`, `write`, `edit`
- `sessions_list`, `sessions_history`, `sessions_send`, `sessions_spawn`

**默认 denylist**：
- `browser`, `canvas`, `nodes`, `cron`, `discord`, `gateway`

**Backends**: Docker (default) / SSH / OpenShell

**直接照搬 schema**——但**调整 policy**：
- hq-control 不用 sandbox（要 full access 做指挥）
- smoke-runner / repair-engineer 用 Docker sandbox
- oracle-reviewer 只读 sandbox

### 2.7 不要借鉴的 OpenClaw 设计

| OpenClaw 设计 | 为什么不要 |
|--------------|----------|
| 30+ channel inbox（WhatsApp/Telegram/Discord/...） | 我们不接 chat apps——人和 mesh 通信走 Web Control UI |
| Live Canvas / A2UI | 完全不同维度——我们要 coms graph 不是 agent UI |
| Honcho dialectic user modeling | 不适合 multi-agent peer-to-peer mesh |
| plugin system | 我们要静态 role mesh——不需要动态插件 |
| iOS/Android/macOS apps | Web-only |

---

## 3. 必须自己造的能力（OpenClaw / Hermes 都没有）

| 能力 | 为什么 OpenClaw 不解决 | 我们怎么造 |
|------|----------------------|----------|
| **Coms graph** | OpenClaw 是 chat user ↔ agent 拓扑，不是 mesh | 自己造 `mesh.snapshot` / `mesh.subscribe` / `graph.changed` event + JSONL 持久化 |
| **Handoff protocol** | OpenClaw 没有 session death 概念（用户重开就行） | 自己造 `handoff.{initiate, ack, complete}` + state serialization |
| **Git dirty state** | OpenClaw 不感知 git（chat agent 不用关心） | 自己造 `git.dirty.changed` event + `git status --porcelain` integration |
| **HQ 两级编排** | OpenClaw multiAgent 是平级（per-channel 路由） | 自己造 Strategic HQ ↔ Tactical HQ 协议 |
| **bounded autonomy envelope**（per-task） | OpenClaw sandbox 是 per-user（不是 per-task） | 自己造 per-task allow/deny tool list + stop-loss 阈值 |
| **Overnight autonomous run supervisor** | OpenClaw cron 是单 task | 自己造 "HQ sleep / wake + task swarm coordination" |

---

## 4. 与上游 `Coms本地嵌入方案-2026-06-14.md` 的衔接

| Coms 项目现状（2026-06-14） | 本调研覆盖 |
|------------------------|----------|
| ✅ Phase 1: 本地 coms（Unix socket 平级通信）`coms-omp-lite.ts` 25KB | — |
| ✅ Phase 2 实跑：4 session 通信（planner / reader / implementer / reviewer） | — |
| ✅ 协议语义澄清：inbound 后直接 final text；`coms_send` 是新一跳 | — |
| ⏳ Phase 3: 跨网络 coms-net | 本调研 §2 给出"借鉴 OpenClaw WebSocket 协议"的具体 RPC 命名 |
| ⏳ Phase 4: OMP-native package | 本调研 §1.7 给出"OMP SDK 做 Runtime + OpenClaw 协议做 Control Plane"的分层 |
| ❌ Session Supervisor / Web Control UI | 本调研 §2 完整给出"借鉴 OpenClaw 协议"的具体 schema |
| ❌ HQ 两级编排 | 本调研 §3 标出"必须自己造" |
| ❌ Handoff protocol | 本调研 §3 标出"必须自己造" |
| ❌ Git dirty state | 本调研 §3 标出"必须自己造" |

**结论**：本调研**不重复 Coms 项目的工作**——它做的是"通信原语 + 本地 mesh"，本调研做的是"上层控制平面 + 长期监督"。

---

## 5. 决策清单

### 5.1 直接复用（schema / 命名）

- [ ] WebSocket frame schema（`event` / `req` / `res`）
- [ ] Session RPC 命名（`sessions.*` / `agent.*`）
- [ ] Event family 命名（`heartbeat` / `tick` / `health` / `sessions.changed`）
- [ ] Scope gating（`operator.read` / `operator.write` / `operator.admin` + fail-closed）
- [ ] Device pairing 流程（loopback auto-approve + explicit approve remote）
- [ ] Session lifecycle 语义（daily / idle / manual reset，heartbeat 不延长 freshness）
- [ ] Sandbox policy schema（`sandbox.mode: "non-main"` + allow/deny tool list）

### 5.2 不复用（自造）

- [ ] Coms graph（节点 / 边 / 实时事件流可视化）
- [ ] Handoff protocol（state serialize + inject + ack）
- [ ] Git dirty state integration
- [ ] HQ 两级编排（Strategic ↔ Tactical）
- [ ] bounded autonomy envelope per-task
- [ ] Overnight run supervisor（HQ sleep / wake）

### 5.3 不复用也不需要（OpenClaw 专属）

- [x] 30+ channel inbox（不接 chat apps）
- [x] Live Canvas / A2UI
- [x] Honcho user modeling
- [x] plugin system
- [x] iOS/Android/macOS apps

### 5.4 借鉴但不照搬

- [ ] **Hermes Python RPC**——借鉴"zero-context-cost"范式，但用我们自己的 Coms Bus + JSONL 实现
- [ ] **OMP Hindsight** —— 借鉴 Hermes frozen snapshot 模式（保护 LLM prefix cache），但保留 OMP project-scoped bank

### 5.5 不要做的事

- [ ] 不要 fork OpenClaw 替代 OMP Mesh（coding 内核差距太大）
- [ ] 不要迁移到 Hermes（它解决的问题 OpenClaw 已解决，独特点对 OMP 生态没增量）
- [ ] 不要先做 Web Control UI（先做 Fleet Supervisor + Coms Bus + CLI）
- [ ] 不要接外部 chat app（owner 通知走 Web Control UI）

---

## 6. 证据来源（不重复正文细节）

### 6.1 OpenClaw（379k stars）

| 资源 | URL | 验证方式 |
|------|-----|---------|
| GitHub | https://github.com/openclaw/openclaw | 379k stars, 58,866 commits, 79.2k forks |
| 架构页 | https://docs.openclaw.ai/concepts/architecture | Gateway daemon + WebSocket 18789 + Canvas host |
| Session 模型 | https://docs.openclaw.ai/concepts/session | daily / idle / manual reset 语义 |
| Gateway 协议 | https://docs.openclaw.ai/gateway/protocol | 完整 RPC methods + event families + scope gating |
| Web Control UI | https://docs.openclaw.ai/web/control-ui | Vite + Lit @ 18789 + device pairing |
| 配置参考 | https://docs.openclaw.ai/gateway/configuration-reference | `agents.defaults.heartbeat` + `commitments.maxPerDay` + `cron.maxConcurrentRuns` |

### 6.2 Hermes（193k stars）

| 资源 | URL | 验证方式 |
|------|-----|---------|
| GitHub | https://github.com/NousResearch/hermes-agent | 193k stars, 11,680 commits |
| 架构 | https://hermes-agent.nousresearch.com/docs/developer-guide/architecture | AIAgent + 6 terminal backends + 70+ tools + 28 toolsets |
| Memory | https://hermes-agent.nousresearch.com/docs/user-guide/features/memory | MEMORY.md (2,200 chars) + USER.md (1,375 chars) + frozen snapshot |
| Cron | https://hermes-agent.nousresearch.com/docs/user-guide/features/cron | cronjob tool + no-agent mode + 防止递归 cron |
| 迁移 | `hermes claw migrate` | README 显式说明从 OpenClaw 迁移 |

### 6.3 OMP（12.4k stars）

| 资源 | URL | 验证方式 |
|------|-----|---------|
| GitHub | https://github.com/can1357/oh-my-pi | 8,713 commits |
| 官方 SDK 文档 | https://omp.sh/docs/sdk | 4 entry points（Interactive / One-shot / RPC/ACP / SDK） |
| Cave 深度笔记 | `Cave/Agent-Lab/oh-my-pi-usage-deep-dive.md` | 17KB 详细 OMP 内部文档 |
| 6 个核心差异点 | 同上 §10.1 | LSP / IRC / Eval / 模型等价 / 上下文升级 / 本地模型自动发现 |

### 6.4 Cave 内本地资料

| 路径 | 关联 |
|------|------|
| `Agent-Lab/oh-my-pi-usage-deep-dive.md` | OMP 32 工具 + LSP 6 个 client + 13 个 Rust crate 详细 |
| `Agent-Lab/Agent工具/OMP/pi-vs-claude-code移植/Coms本地嵌入方案-2026-06-14.md` | 上游：4 session 实测通信 |
| `Agent-Lab/Agent工具/OMP/pi-vs-claude-code移植/严格评审-2026-06-14.md` | 源仓库 17 个 extension 评审 |
| `Agent-Lab/Agent工具/OMP/pi-vs-claude-code移植/ports/coms-omp/extensions/coms-omp-lite.ts` | 25KB coms 协议实现 |
| `Agent-Lab/Agent工具/OMP/pi-vs-claude-code移植/ports/coms-omp/extensions/coms-omp.ts` | 51KB 完整 coms（含 TUI） |
| `Agent-Lab/Agent工具/OMP/pi-vs-claude-code移植/ports/coms-omp/extensions/themeMap-omp.ts` | 主题映射 |
| `Agent-Lab/Agent工具/OpenClaw/OpenClaw.md` + `OpenClaw-Design-Patterns.md` | OpenClaw 13 种设计模式（方法论层） |
| `Agent-Lab/实验与研究/Harness-Engineering/Harness-Engineering.md` | Harness Engineering 6 层架构（方法论） |

---

## 7. 下一步

> 本调研**不输出 Phase 1+2 实现**——那是 `Coms本地嵌入方案` 已经做的工作。
> 本调研**只输出"选型决策"**——给上游 Coms 项目做 Phase 3+ 的参考。

**建议落点**：
1. 把本调研的"决策清单"（§5）作为 `Coms本地嵌入方案-2026-06-14.md` 末尾的"Phase 3+ 选型"附录
2. 把"借鉴的 OpenClaw RPC 命名"（§2.1）作为 `coms-omp-lite.ts` v2 的接口设计起点
3. **不**写新的 Phase 1+2 代码——等 Coms 项目 Phase 2 跑通后再做 Phase 3+
4. **不**马上做 Web Control UI——先做 Fleet Supervisor + Coms Bus + CLI

**给用户的关键提示**：

> **不要被 OpenClaw 的"成熟度"诱惑**——它的 379k stars 是 chat user 场景的；
> **我们的场景是 OMP coding agent 长期 mesh**——coding 内核 OMP 远超 OpenClaw，mesh 监督我们必须自己造。
> **OpenClaw 的价值不在它的"成品"，在它的"协议 schema 命名 + scope gating + device pairing 流程"**——这些是工程经验，可借鉴。
> **Hermes 对我们几乎没用**——它是 OpenClaw 继任者，独有的 3 点对 OMP 生态没增量。

---

*本调研基于 2026-06-14 直接 fetch OpenClaw / Hermes / OMP 官方仓库 + Cave 内部 OMP 笔记。*
*调研不修改任何 Cave 外项目。所有 OMP / ekunAi 实测由用户在 Ghostty 中按上游 Coms 文档执行。*
