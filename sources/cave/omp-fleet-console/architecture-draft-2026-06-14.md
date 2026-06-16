---
obsidian-note-type: architecture-draft
target: agent-lab
project: omp-fleet-console
status: draft-for-codex-review
date: 2026-06-14
author: agent (Cave knowledge steward)
related: [[Fleet-Console-可行性调研-2026-06-14]] [[Coms本地嵌入方案-2026-06-14]] [[严格评审-2026-06-14]]
tags: [omp, fleet-console, mesh, openclaw, architecture-draft, codex-discussion]
---

# omp-fleet-console 架构草案（2026-06-14）

> **本文件是草案**——目的是把核心架构落到纸面，让 Codex 参与讨论。
> **本文不写实现细节**——那是 Phase 1 的工作。
> **本文不写完整源码级调研**——参考 [[Fleet-Console-可行性调研-2026-06-14]]。

---

## 0. 决策摘要

| 问题 | 决策 | 原因 |
|------|------|------|
| **fork OMP 还是 fork OpenClaw 还是新项目？** | **新项目** | 避免 OMP 升级 rebase 成本；避免 OpenClaw coding 内核冲突 |
| **新项目名？** | `omp-fleet-console`（待定） | 见 §1 命名讨论 |
| **路径？** | `Agent-Lab/Agent工具/OMP/omp-fleet-console/`（待定） | 见 §1 路径讨论 |
| **和 Coms 项目的关系？** | **升格** | `coms-omp-lite.ts` 25KB + `coms-omp.ts` 51KB 直接搬入新项目 |
| **依赖 OMP SDK？** | ✅ 通过 `@oh-my-pi/pi-coding-agent` SDK 嵌入 | 不修改 OMP 源码 |
| **依赖 OpenClaw？** | ❌ 借鉴协议不借鉴代码 | OpenClaw 内核和我们的目标冲突 |
| **依赖 Hermes？** | ❌ 几乎不需要借鉴 | 见调研 §1.4 |

---

## 1. 命名与路径（待 Codex 讨论）

### 1.1 命名候选

| 候选 | 含义 | 优点 | 缺点 |
|------|------|------|------|
| **`omp-fleet-console`** | OMP 的 fleet console | 名字直接表达定位 | 略显通用 |
| `omp-mesh` | OMP 的 mesh | 强调 mesh 拓扑 | 弱化 control plane |
| `oms-fleet-console` | OMP Mesh Supervisor | 三个单词都点到了 | 长 |
| `omc-fleet` | OMP Mesh Control | 短 | 容易和 "omc" 别的项目撞 |
| `agent-fleet-console` | 不带 OMP 前缀 | 通用，可未来支持其他 agent | 失去 OMP 锚定 |

**推荐**：`omp-fleet-console`——和 Cave 现有 `pi-vs-claude-code移植/` 命名风格一致，明确 OMP 锚定。

### 1.2 路径候选

| 候选 | 含义 | 优点 | 缺点 |
|------|------|------|------|
| **`Agent-Lab/Agent工具/OMP/omp-fleet-console/`** | OMP 工具的兄弟 | 紧邻 pi-vs-claude-code移植/，可继承 Coms 工作 | 隐含"是 OMP 工具" |
| `Projects/omp-fleet-console/` | 长期项目 | 符合 Projects/ 已有命名风格 | 失去和 Coms 项目的近邻关系 |
| `Agent-Lab/实验与研究/omp-fleet-console/` | 实验项目 | 早期可实验 | 后期要迁移 |

**推荐**：`Agent-Lab/Agent工具/OMP/omp-fleet-console/`——和 Coms 项目同级，便于继承。

### 1.3 决策点（给 Codex）

> **Q1**：项目名是 `omp-fleet-console` 还是其他候选？
> **Q2**：路径是 `Agent-Lab/Agent工具/OMP/` 下还是 `Projects/` 下？
> **Q3**：是否升格 Coms 项目（搬入 `coms-omp-lite.ts` + `coms-omp.ts` + `themeMap-omp.ts`），还是 Coms 项目独立维护？

---

## 2. 架构总览

### 2.1 一句话定位

> **omp-fleet-console = OMP 的外层控制平面**：通过 OMP SDK 启动 N 个 OMP role session（hq-control / smoke-runner / oracle-reviewer / repair-engineer），通过借鉴自 OpenClaw 的 WebSocket 协议 + event bus 监督它们，通过 Coms Bus 让它们平级通信，通过 Web Control Plane 让人类 owner 可视化和干预。

### 2.2 分层架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Layer 7: Web Control Plane（Vite + Lit SPA）                            │
│   ├── Sessions List / Coms Graph / Session Detail / Approval Queue     │
│   ├── Health Dashboard (heartbeat / tick / git dirty)                  │
│   └── Device Pairing (loopback auto-approve + explicit approve remote) │
└─────────────────────────────────────────────────────────────────────────┘
                                ↓ WebSocket @ 18790
┌─────────────────────────────────────────────────────────────────────────┐
│ Layer 6: fleetctl CLI (Phase 1 主要交付)                                │
│   ├── fleetctl sessions list|status|send|abort|steer                   │
│   ├── fleetctl mesh graph|tail|replay                                  │
│   ├── fleetctl approval list|approve|deny                              │
│   └── fleetctl health|heartbeat|devices                                │
└─────────────────────────────────────────────────────────────────────────┘
                                ↓ in-process API
┌─────────────────────────────────────────────────────────────────────────┐
│ Layer 5: Control Plane（借鉴 OpenClaw 协议）                            │
│   ├── WS Server + RPC Handler (sessions.* / agent.* / mesh.*)          │
│   ├── Event Bus (heartbeat / tick / health / sessions.changed / ...)   │
│   └── Scope Gate (operator.read / operator.write / operator.admin)     │
└─────────────────────────────────────────────────────────────────────────┘
                                ↓ internal API
┌─────────────────────────────────────────────────────────────────────────┐
│ Layer 4: Fleet Supervisor（核心）                                        │
│   ├── Role Manager (4 role lifecycle: spawn / retire / replace)         │
│   ├── Session Registry (JSONL + file lock, 借鉴 oh-my-openagent)       │
│   ├── Handoff Protocol (serialize state → inject → ack)                │
│   ├── Git State Watcher (`git status --porcelain` → git.dirty event)  │
│   └── Heartbeat / Tick / Health Scheduler                              │
└─────────────────────────────────────────────────────────────────────────┘
                                ↓ Coms Bus API
┌─────────────────────────────────────────────────────────────────────────┐
│ Layer 3: Coms Bus（自 coms-omp-lite.ts 升格）                            │
│   ├── JSONL Append-only Store                                          │
│   ├── File Lock (PID-aware, stale detection)                            │
│   ├── Router (4 ↔ 4 ↔ 4 mesh 路由)                                      │
│   ├── Replay (回放 from offset)                                         │
│   └── Variable Interpolation + Shell Escape (防注入)                    │
└─────────────────────────────────────────────────────────────────────────┘
                                ↓ OMP SDK
┌─────────────────────────────────────────────────────────────────────────┐
│ Layer 2: OMP Agent Runtime（OMP SDK 嵌入，N 个实例）                    │
│   ├── hq-control (SessionManager + createAgentSession, 7×24 long-lived) │
│   ├── smoke-runner (ephemeral per task)                                 │
│   ├── oracle-reviewer (ephemeral per task)                              │
│   ├── repair-engineer (ephemeral per scoped fix)                       │
│   └── 每个 session 自带：IRC, checkpoint, rewind, retain/recall/reflect │
└─────────────────────────────────────────────────────────────────────────┘
                                ↓ native Rust
┌─────────────────────────────────────────────────────────────────────────┐
│ Layer 1: OMP Core（55,000 行 Rust，不修改，只用）                        │
│   ├── LSP / DAP / Hashline / TTSR                                       │
│   ├── 32 内建工具 (read/write/edit/ast_edit/lsp/debug/...)              │
│   ├── Hindsight (retain/recall/reflect)                                 │
│   └── Model Registry (40+ provider)                                     │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.3 关键设计原则

1. **不修改 OMP**——通过 OMP SDK 嵌入（`@oh-my-pi/pi-coding-agent`）
2. **不修改 OpenClaw**——借鉴协议 schema / 命名，不借鉴代码
3. **每层独立**——便于测试和替换
4. **Coms Bus 是底层**——所有 role 共享
5. **Fleet Supervisor 是核心**——所有 package 围绕它组织
6. **Web UI 只读 + 控制输入**——不修改 OMP 内核

---

## 3. Package 结构

> 暂定 monorepo（用 pnpm workspace，借鉴 OpenClaw 的 pnpm 工作流）。

```
omp-fleet-console/
├── packages/
│   ├── core/                    # Fleet Supervisor 核心
│   │   ├── supervisor.ts        # 主 supervisor
│   │   ├── role-manager.ts      # 4 role lifecycle
│   │   ├── session-registry.ts  # JSONL + file lock（搬自 coms-omp-lite.ts）
│   │   ├── heartbeat.ts         # 15s tick + heartbeat event
│   │   ├── health-snapshot.ts   # session 状态汇总
│   │   └── types.ts
│   │
│   ├── coms-bus/                # Coms Bus（自 coms-omp-lite.ts 升格）
│   │   ├── jsonl-store.ts       # JSONL append-only
│   │   ├── file-lock.ts         # PID-aware lock（已实现）
│   │   ├── router.ts            # 4 ↔ 4 ↔ 4 路由
│   │   ├── interpolation.ts     # {{key}} 模板（搬自 dispatcher.ts）
│   │   ├── shell-escape.ts      # 防 shell 注入
│   │   ├── replay.ts            # 消息回放
│   │   └── types.ts
│   │
│   ├── omp-runtime/             # OMP Agent Runtime 包装
│   │   ├── omp-client.ts        # OMP SDK 嵌入（createAgentSession 包装）
│   │   ├── task-spawner.ts      # ephemeral task 派单（task({isolated, worktree})）
│   │   ├── handoff.ts           # handoff protocol
│   │   ├── event-bridge.ts      # OMP typed events → fleet events
│   │   └── types.ts
│   │
│   ├── control-plane/           # 借鉴 OpenClaw 协议
│   │   ├── ws-server.ts         # WebSocket server @ 18790
│   │   ├── rpc-handler.ts       # sessions.* / agent.* / mesh.* / approval.*
│   │   ├── event-bus.ts         # heartbeat / tick / health / sessions.changed
│   │   ├── scope-gate.ts        # operator.read/write/admin + fail-closed
│   │   ├── device-pairing.ts    # loopback auto-approve + explicit approve
│   │   ├── version.ts           # PROTOCOL_VERSION = 1
│   │   └── schema/              # TypeBox schemas (协议 frame schema)
│   │       ├── frame.ts         # event/req/res schema
│   │       ├── handshake.ts     # connect challenge + hello-ok
│   │       └── policy.ts        # maxPayload / maxBufferedBytes / tickIntervalMs
│   │
│   ├── mesh/                    # Coms graph（自造）
│   │   ├── graph-state.ts       # mesh 拓扑状态
│   │   ├── graph-events.ts      # mesh.changed / graph.changed
│   │   ├── graph-snapshot.ts    # mesh.snapshot RPC
│   │   └── types.ts
│   │
│   ├── handoff/                 # Handoff protocol（自造）
│   │   ├── state-serialize.ts   # session state → JSON
│   │   ├── state-inject.ts      # JSON → new session system prompt
│   │   ├── ack-protocol.ts      # new session 确认接管
│   │   └── types.ts
│   │
│   ├── git-state/               # Git dirty state（自造）
│   │   ├── status-watcher.ts    # `git status --porcelain` polling
│   │   ├── dirty-event.ts       # git.dirty.changed event
│   │   └── types.ts
│   │
│   ├── bounded-autonomy/        # Per-task allow/deny tool list（自造）
│   │   ├── policy.ts            # 借鉴 OpenClaw sandbox.mode
│   │   ├── approval-queue.ts    # owner approval 队列
│   │   ├── stop-loss.ts         # 阈值检查
│   │   └── types.ts
│   │
│   ├── cli/                     # fleetctl CLI（Phase 1 主要交付）
│   │   ├── index.ts             # 入口
│   │   ├── sessions.ts          # sessions list|status|send|abort|steer
│   │   ├── mesh.ts              # mesh graph|tail|replay
│   │   ├── approval.ts          # approval list|approve|deny
│   │   ├── health.ts            # health|heartbeat|devices
│   │   └── handoff.ts           # handoff initiate|status|abort
│   │
│   └── web-ui/                  # Vite + Lit Web Control Plane（Phase 2）
│       ├── src/
│       │   ├── pages/
│       │   │   ├── sessions.tsx
│       │   │   ├── session-detail.tsx
│       │   │   ├── coms-graph.tsx     # Coms graph 可视化
│       │   │   ├── approval-queue.tsx
│       │   │   ├── health.tsx
│       │   │   └── devices.tsx
│       │   ├── ws-client.ts
│       │   ├── device-pairing.ts
│       │   └── main.tsx
│       ├── public/
│       └── vite.config.ts
│
├── config/                      # 配置文件
│   ├── roles/                   # 4 role 定义
│   │   ├── hq-control.yaml
│   │   ├── smoke-runner.yaml
│   │   ├── oracle-reviewer.yaml
│   │   └── repair-engineer.yaml
│   ├── mesh.yaml                # mesh 拓扑（4 ↔ 4 ↔ 4）
│   ├── fleet.yaml               # 总配置
│   └── bounded-autonomy.yaml    # per-task 授权
│
├── tests/                       # 集成测试
│   ├── 4-session-smoke.test.ts          # 4 session 并发启动
│   ├── handoff-protocol.test.ts         # handoff 全流程
│   ├── coms-graph.test.ts               # 4 ↔ 4 ↔ 4 消息可达性 100%
│   ├── git-dirty.test.ts                # git 状态实时反映
│   ├── heartbeat-fail.test.ts           # 3 次 missed → unhealthy
│   ├── crash-recovery.test.ts           # 故意 kill session → handoff
│   ├── bounded-autonomy.test.ts         # allow/deny 工具列表
│   ├── approval-queue.test.ts           # owner 审批流程
│   └── device-pairing.test.ts           # pairing + scope upgrade
│
├── docs/
│   ├── architecture.md                  # 本文档（升格）
│   ├── phase-1-cli-supervisor.md        # Phase 1 详细计划
│   ├── phase-2-web-dashboard.md         # Phase 2 详细计划
│   ├── phase-3-policy-lifecycle.md      # Phase 3 详细计划
│   ├── phase-4-overnight.md             # Phase 4 详细计划
│   ├── protocol-spec.md                 # 借鉴 OpenClaw 的协议规范
│   ├── coms-bus-spec.md                 # Coms Bus 协议
│   └── mesh-graph-spec.md               # Mesh graph 协议
│
├── scripts/
│   ├── dev-up.sh                        # 启动 4 session dev 环境
│   ├── dev-down.sh
│   └── integration-test.sh
│
├── package.json                         # pnpm workspace
├── pnpm-workspace.yaml
├── tsconfig.json
├── .gitignore
├── README.md
├── CHANGELOG.md
└── LICENSE
```

---

## 4. 与上游 Coms 项目的衔接

| Coms 项目现状 | omp-fleet-console 升格方式 |
|------------|------------------------|
| `ports/coms-omp/extensions/coms-omp-lite.ts` (25KB) | 拆分为 `packages/coms-bus/` 多个文件（jsonl-store / file-lock / router / interpolation） |
| `ports/coms-omp/extensions/coms-omp.ts` (51KB, 含 TUI) | 拆分为 `packages/coms-bus/` 核心 + `packages/web-ui/` UI 部件 |
| `ports/coms-omp/extensions/themeMap-omp.ts` (6.5KB) | 升格为 `packages/web-ui/` 主题 |
| `ports/coms-omp/tests/coms-omp.test.ts` | 升格为 `packages/coms-bus/__tests__/` |
| 4 session 实测（planner / reader / implementer / reviewer） | 重新命名为 hq-control / smoke-runner / oracle-reviewer / repair-engineer（or 保留两者都支持） |
| 协议语义（inbound 后直接 final text，`coms_send` 是新一跳） | 写入 `docs/coms-bus-spec.md` |

**注意**：Coms 项目是 OMP extension（运行在 OMP 进程内），**omp-fleet-console 是独立进程**。搬迁意味着 Coms 协议变成 in-process API，不再需要 OMP extension 加载机制。

---

## 5. 借鉴 OpenClaw 的具体协议（落地细节）

> 完整 spec 在 `docs/protocol-spec.md`——这里只列关键决策。

### 5.1 Wire Protocol（WebSocket 帧 schema）

```typescript
// 三种 frame type
type Frame = EventFrame | RequestFrame | ResponseFrame;

interface EventFrame {
  type: "event";
  event: string;            // event family name
  payload: unknown;
  seq?: number;             // per-client monotonic
  stateVersion?: number;    // global state version
}

interface RequestFrame {
  type: "req";
  id: string;               // UUID
  method: string;           // RPC method name
  params: unknown;
}

interface ResponseFrame {
  type: "res";
  id: string;               // matches request id
  ok: boolean;
  payload?: unknown;
  error?: { code: string; message: string; details?: unknown };
}
```

**完全照搬 OpenClaw 帧 schema**（`docs/gateway/protocol` 已验证）。

### 5.2 RPC Method 命名（直接照搬 + 扩展）

| OpenClaw 命名 | omp-fleet-console 沿用 | 用途 |
|--------------|----------------------|------|
| `sessions.list` | ✅ | role mesh 列表 |
| `sessions.subscribe` | ✅ | 订阅 session 变更 |
| `sessions.create` | ✅ | 创建 role session |
| `sessions.send` | ✅ | send message |
| `sessions.steer` | ✅ | interrupt + steer |
| `sessions.abort` | ✅ | abort 活动工作 |
| `sessions.messages.subscribe` | ✅ | 订阅 message 流 |
| `agent.wait` | ✅ | 等待 run 完成 |
| `agent.identity.get` | ✅ | 取 assistant identity |
| `health` | ✅ | gateway health |
| `status` | ✅ | gateway status |
| **新增（OpenClaw 无）** | | |
| — | `mesh.snapshot` | mesh 拓扑快照 |
| — | `mesh.subscribe` | 订阅 mesh 变化 |
| — | `graph.snapshot` | coms graph 当前状态 |
| — | `approval.request` | 请求 owner 审批 |
| — | `approval.resolve` | owner 审批决议 |
| — | `handoff.initiate` | 启动 session handoff |
| — | `handoff.ack` | 新 session 确认接管 |
| — | `git.dirty` | session 当前 working tree 状态 |
| — | `devices.list` | 列出待审批 device |
| — | `devices.approve` | 审批 device pairing |

### 5.3 Event Family 命名（直接照搬 + 扩展）

**OpenClaw 已有（直接照搬）**：
- `heartbeat` / `tick` (15s) / `health`
- `sessions.changed` / `session.message` / `session.tool` / `session.operation`
- `cron` / `shutdown`

**新增（OpenClaw 无）**：
- `mesh.changed` — mesh 拓扑变化（role session 加入 / 离开 / 替换）
- `graph.changed` — coms graph 边变化
- `approval.requested` / `approval.resolved`
- `handoff.started` / `handoff.completed` / `handoff.failed`
- `git.dirty.changed` — working tree 状态变化
- `role.health.degraded` / `role.health.recovered`
- `bounded_autonomy.threshold_reached` — stop-loss 触发

### 5.4 Scope Gating（直接照搬）

```typescript
type Scope = "operator.read" | "operator.write" | "operator.admin";

interface ScopePolicy {
  // Default: fail-closed
  [eventFamily: string]: Scope[] | "unrestricted" | "forbidden";
}

// 借鉴 OpenClaw 默认值
const defaultPolicy: ScopePolicy = {
  // 需要 operator.read
  "session.message": ["operator.read", "operator.write", "operator.admin"],
  "session.tool": ["operator.read", "operator.write", "operator.admin"],
  "sessions.changed": ["operator.read", "operator.write", "operator.admin"],

  // 需要 operator.write
  "approval.requested": ["operator.write", "operator.admin"],
  "approval.resolved": ["operator.write", "operator.admin"],

  // 需要 operator.admin
  "mesh.changed": ["operator.admin"],
  "handoff.*": ["operator.admin"],
  "shutdown": ["operator.admin"],

  // unrestricted（任何认证连接都能收到，transport health）
  heartbeat: "unrestricted",
  tick: "unrestricted",
  health: "unrestricted",

  // 未知 event family 默认 forbidden
  // fail-closed by default
};
```

### 5.5 Device Pairing（直接照搬 + 简化）

**OpenClaw 流程**：
1. 新设备 → "disconnected (1008): pairing required"
2. Loopback auto-approve
3. Remote → `openclaw devices list` / `approve <requestId>` / `revoke`
4. Scope upgrade = approval upgrade

**omp-fleet-console 简化**：
1. 新设备 → "disconnected (1008): pairing required"
2. Loopback auto-approve
3. Remote → `fleetctl devices list` / `approve <requestId>` / `revoke --device <id>`
4. Scope upgrade = approval upgrade

### 5.6 Session Lifecycle（直接照搬）

**OpenClaw 语义**：
- Daily reset (4 AM) / Idle reset (`session.reset.idleMinutes`) / Manual reset (`/new` / `/reset`)
- **Heartbeat / cron / exec 不延长 session freshness**
- Reset 时：旧 session queued system-event notices 被 discarded

**omp-fleet-console 沿用**：
- hq-control → daily reset at 4 AM + idle reset after 6h
- smoke-runner / oracle-reviewer / repair-engineer → ephemeral（task scope 决定 lifetime）
- 退役时：state serialize → handoff protocol → new session inject → ack → 删旧 session

### 5.7 Sandbox / Bounded Autonomy（借鉴 schema，自造 per-task）

**OpenClaw schema**：
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

**omp-fleet-console 自造 per-task schema**：
```yaml
# config/bounded-autonomy.yaml
roles:
  hq-control:
    sandbox: false  # 不 sandbox（要 full access 做指挥）
    allow_tools: ["*"]
    deny_tools: []
    stop_loss:
      max_runtime: "12h"  # 12h 后强制 reset
      max_token: 1000000
      max_steps: 200

  smoke-runner:
    sandbox: "docker"  # Docker sandbox
    allow_tools: ["bash", "read", "write", "edit", "ast_edit", "ast_grep", "search", "task"]
    deny_tools: ["browser", "canvas", "irc", "checkpoint", "rewind"]
    stop_loss:
      max_runtime: "30m"  # 30m 后强制 abort
      max_token: 200000
      max_steps: 50

  oracle-reviewer:
    sandbox: "read-only"  # 只读 sandbox
    allow_tools: ["read", "search", "ast_grep", "task", "irc"]
    deny_tools: ["write", "edit", "bash", "browser"]
    stop_loss:
      max_runtime: "15m"
      max_token: 100000
      max_steps: 30

  repair-engineer:
    sandbox: "docker"  # Docker sandbox
    allow_tools: ["read", "write", "edit", "ast_edit", "ast_grep", "search", "bash", "task", "irc"]
    deny_tools: ["browser", "canvas", "checkpoint", "rewind"]
    stop_loss:
      max_runtime: "1h"
      max_token: 500000
      max_steps: 80
```

**Backends**（借鉴 OpenClaw）：Docker (default) / SSH / OpenShell

---

## 6. 借鉴自 Coms 项目（已经做过的工作）

| Coms 实现 | 搬入位置 | 改造点 |
|----------|---------|-------|
| `file-lock.ts` (PID-aware, 24h TTL, stale detection) | `packages/coms-bus/file-lock.ts` | 直接搬入 |
| `interpolation.ts` (`{{key}}` 模板) | `packages/coms-bus/interpolation.ts` | 直接搬入 |
| `shell-escape.ts` (防注入) | `packages/coms-bus/shell-escape.ts` | 直接搬入 |
| `jsonl-store.ts` (append-only) | `packages/coms-bus/jsonl-store.ts` | 直接搬入 |
| `registry.ts` (sessionId ↔ tmuxPaneId 关联) | `packages/core/session-registry.ts` | **改造**：去掉 tmux，改为 sessionId ↔ role ↔ status |
| `router.ts` (message routing) | `packages/coms-bus/router.ts` | **扩展**：加 4 ↔ 4 ↔ 4 mesh 路由 |
| `protocol/challenge.ts` (nonce 防重放) | `packages/control-plane/handshake.ts` | 直接搬入 |
| `daemon/spawn.ts` (detached process) | `packages/omp-runtime/omp-client.ts` | **改造**：从 OMP SDK 启动而非 spawn daemon |
| `daemon/state.ts` (PID + config signature) | `packages/core/health-snapshot.ts` | 直接搬入 |
| `daemon/lifecycle.ts` (SIGTERM + 等待 + SIGKILL) | `packages/core/role-manager.ts` | 直接搬入 |
| `sanitize.ts` (防控制字符注入) | `packages/coms-bus/shell-escape.ts` | 直接搬入 |
| `rate-limiter.ts` (60s 滑动窗口) | `packages/control-plane/scope-gate.ts` | **改造**：从 rate limit 改为 scope gate |

---

## 7. 实施 Phase 划分

> 详细 phase 文档在 `docs/phase-*.md`（Phase 1 时落具体内容）。

### Phase 0: 选型 + 决策（已完成于本次调研）
- ✅ OpenClaw / Hermes / OMP 调研
- ✅ Fork vs 新项目决策
- ✅ 命名 + 路径决策
- ✅ 借鉴 schema 命名
- ✅ 区分必须自造 vs 可借鉴

### Phase 1: 新项目骨架 + CLI Supervisor（4-6 周）

**目标**：4 OMP role session 跑起来，Fleet Supervisor 监督，Coms Bus 通信，CLI 控制。

**关键交付**：
1. **新项目骨架**（1 周）
   - pnpm workspace 搭建
   - TypeScript + ESM + strict mode
   - 基本 tsconfig / .gitignore / README / LICENSE
2. **搬 Coms 核心**（1 周）
   - `packages/coms-bus/` 完整搬入
   - 单元测试覆盖
3. **Fleet Supervisor 核心**（1-2 周）
   - `packages/core/role-manager.ts`
   - `packages/omp-runtime/omp-client.ts`（OMP SDK 嵌入）
   - 4 role 启动 / 停止 / 重启
4. **Control Plane 最小版**（1 周）
   - WebSocket server @ 18790
   - `sessions.list` / `sessions.send` / `sessions.abort` RPC
   - `heartbeat` / `tick` / `sessions.changed` events
5. **fleetctl CLI**（1 周）
   - `sessions list|status|send|abort`
   - `mesh graph|tail|replay`
   - `health|heartbeat`
6. **集成测试**（1 周）
   - 4 session 并发启动
   - 故意 kill 1 session → 验证 handoff
   - Coms graph 100% 消息可达性
   - Crash recovery

**Phase 1 验收**：
- 4 role session ≥ 24h 不崩
- 任意 1 session 崩溃 ≤ 60s 自动 handoff
- Coms graph 100% 消息可达
- WebSocket client 能列所有 session + 收所有 event
- CLI 能 send / abort / steer 任意 session

### Phase 2: Web Control Plane（4-6 周）

**目标**：从 CLI 升级到 Web dashboard，重点 coms graph + session mesh + approval queue。

**关键交付**：
1. **Web UI 基础**（2 周）
   - Vite + Lit SPA
   - 借鉴 OpenClaw 同端口 WebSocket 模式
   - 简化版 device pairing
   - Scope-gated 鉴权
2. **核心页面**（2-3 周）
   - Sessions List
   - Session Detail
   - **Coms Graph**（节点 / 边 / 实时事件流）
   - Approval Queue
   - Health Dashboard
3. **Git dirty state integration**（1 周）
   - `git status --porcelain` 集成
   - 实时显示 working tree 状态
4. **Polishing**（1 周）
   - reconnection 逻辑
   - event buffering + replay
   - keyboard shortcuts

**Phase 2 验收**：
- 4 role session 实时显示在 Coms Graph
- Session Detail 页面能看到 live transcript + tool calls
- Approval Queue 能 list / approve / deny
- Git dirty state 实时反映
- WebSocket 重连后 5s 内恢复

### Phase 3: Policy-Driven Lifecycle（3-4 周）

**目标**：bounded autonomy envelope、owner approval gates、stop-loss 阈值。

**关键交付**：
1. **Sandbox policy**（1 周）—— 借鉴 OpenClaw schema，自造 per-task
2. **Approval gates**（1 周）—— 借鉴 `exec.approval.*` events
3. **Stop-loss 阈值**（1-2 周）—— 自造 threshold checker
4. **Handoff protocol**（1 周）—— serialize state → inject → ack

### Phase 4: Overnight Run Supervisor（2-3 周）

**目标**：HQ sleep / wake + task swarm coordination。

**关键交付**：
1. **HQ cron-like scheduler**（借鉴 Hermes cronjob tool）
2. **Task swarm coordination**（Strategic HQ 编排 4 role session）
3. **Overnight mode**（owner 离线时自动监督）
4. **Morning briefing**（第二天汇报昨晚 mesh 状态）

---

## 8. 决策点（给 Codex 讨论）

> **本节是 Codex 评审的入口**——下面 5 个问题是本架构草案需要 Codex 拍板的关键点。

### 8.1 战略级决策（必须先答）

**Q1：项目名 + 路径**
- 选项 A：`omp-fleet-console` + `Agent-Lab/Agent工具/OMP/omp-fleet-console/`（推荐）
- 选项 B：`omp-mesh` + `Projects/omp-mesh/`
- 选项 C：其他（Codex 提议）

**Q2：是否升格 Coms 项目**
- 选项 A：升格（`pi-vs-claude-code移植/` 整合进 `omp-fleet-console/`，Coms 是 Phase 1 子任务）
- 选项 B：保留独立（Coms 项目作为子模块，omp-fleet-console 是新上层）
- 选项 C：用户决定

**Q3：Phase 1 范围边界**
- 选项 A：完整 Phase 1（搬 Coms + Fleet Supervisor + Control Plane 最小 + fleetctl，6 周）
- 选项 B：精简 Phase 1（只搬 Coms + Fleet Supervisor 最小，4 周）
- 选项 C：先做 PoC（只跑通 4 session 启动，2 周）

### 8.2 战术级决策（Phase 1 内部）

**Q4：OMP SDK 嵌入方式**
- 选项 A：直接 `import` `@oh-my-pi/pi-coding-agent`（每 role 1 个 SessionManager.inMemory()）
- 选项 B：通过 OMP CLI 进程通信（每 role 1 个 `omp -e` 子进程，IPC 通信）
- 选项 C：混合（HQ 用 SDK 嵌入，ephemeral task 用 CLI 进程）
- 备注：选项 A 性能好但需要 SDK API 稳定；选项 B 隔离好但有 IPC 开销；选项 C 平衡但复杂度高

**Q5：Coms Bus 持久化层**
- 选项 A：JSONL + file lock（搬 Coms 项目，最简）
- 选项 B：SQLite + FTS5（借鉴 Hermes `hermes_state.py`，更强 search）
- 选项 C：JSONL 写 + SQLite 索引（双层）

### 8.3 给 Codex 评审的输入清单

> 供 Codex 评审时使用的关键资料：

| 资料 | 路径 |
|------|------|
| 本架构草案 | `Agent-Lab/Agent工具/OMP/omp-fleet-console/architecture-draft-2026-06-14.md` |
| 上游调研 | `Agent-Lab/Agent工具/OMP/pi-vs-claude-code移植/Fleet-Console-可行性调研-2026-06-14.md` |
| Coms 项目实跑 | `Agent-Lab/Agent工具/OMP/pi-vs-claude-code移植/Coms本地嵌入方案-2026-06-14.md` |
| Coms 严格评审 | `Agent-Lab/Agent工具/OMP/pi-vs-claude-code移植/严格评审-2026-06-14.md` |
| OpenClaw 架构 | https://docs.openclaw.ai/concepts/architecture |
| OpenClaw 协议 | https://docs.openclaw.ai/gateway/protocol |
| OMP SDK 文档 | https://omp.sh/docs/sdk |
| OMP 深度笔记 | `Agent-Lab/oh-my-pi-usage-deep-dive.md` |

---

## 9. 风险与反向信号

| 风险 | 触发条件 | 缓解 |
|------|---------|------|
| **OMP SDK API 不稳定** | SDK 频繁改 session / event 签名 | 锁定 SDK 版本 + 集成测试兜底；Phase 1 不引入过深的 OMP 依赖 |
| **OpenClaw 协议借鉴踩坑** | 我们学的不是真的可复用部分 | Phase 1 拿 OpenClaw 协议做参考 + 实测，不是直接 fork |
| **Coms 项目搬入丢功能** | 25KB + 51KB 重构时漏逻辑 | 搬入前先跑 Coms Phase 1 smoke；搬入后跑同一 smoke 验证 |
| **4 session 长期跑内存泄漏** | OMP SDK 跑 7×24 未知行为 | Phase 1 跑 24h 验证 + 加 watchdog；Phase 2 做 daily reset |
| **WebSocket client 兼容** | 浏览器 / CLI 客户端 ws 库差异 | 选成熟库（ws / undici），加 protocol version 协商 |
| **Device pairing 流程漏考虑** | owner 移动端首次访问失败 | 借鉴 OpenClaw 流程简化版 + 完整 test |

---

## 10. 不做的事（明确边界）

> 这是和 OpenClaw / Hermes / OMP 集成的硬约束：

1. **不修改 OMP 源码**——只通过 SDK 嵌入
2. **不修改 OpenClaw 源码**——只借鉴协议 schema / 命名
3. **不接外部 chat app**（WhatsApp / Telegram / Discord）——owner 通知走 Web Control Plane
4. **不做 Live Canvas / A2UI**——Web Control Plane 只读 + 控制输入
5. **不做 plugin system**——role mesh 静态配置
6. **不做 iOS / Android / macOS 客户端**——Web-only
7. **不做 Honcho 风格 user modeling**——peer-to-peer mesh 不需要

---

## 11. 命名约定（避免冲突）

| 类型 | 命名 | 例子 |
|------|------|------|
| Role session | `<role-name>` | `hq-control`, `smoke-runner` |
| Project context | `<project-name>` | `ekunAi`, `cave-knowledge` |
| Coms message | `<role-name>.<msg-type>` | `hq-control.request`, `smoke-runner.finding` |
| Event family | `<scope>.<event>` | `mesh.changed`, `session.tool` |
| RPC method | `<noun>.<verb>` | `sessions.list`, `mesh.snapshot` |
| CLI subcommand | `fleetctl <noun> <verb>` | `fleetctl sessions list` |
| 配置文件 | `config/<type>.yaml` | `config/mesh.yaml` |
| 状态文件 | `~/.omp-fleet/<scope>/<key>.json` | `~/.omp-fleet/sessions/hq-control.state.json` |

---

## 12. 验证清单（Phase 1 完成后自检）

- [ ] 4 OMP role session 跑通启动 / 停止 / 重启
- [ ] 4 ↔ 4 ↔ 4 coms graph 100% 消息可达
- [ ] 任意 1 session 崩溃后 ≤ 60s 自动 handoff
- [ ] WebSocket client 能列所有 session + 收所有 event
- [ ] fleetctl 能 send / abort / steer 任意 session
- [ ] 24h 长跑无内存泄漏（用 `process.memoryUsage()` 监控）
- [ ] Daily reset at 4 AM 触发成功
- [ ] Idle reset after 6h 触发成功
- [ ] Heartbeat 不延长 session freshness（验证：heartbeat 后 idle counter 仍递增）
- [ ] Device pairing loopback auto-approve 工作
- [ ] Device pairing remote 需 explicit approve 工作
- [ ] Scope upgrade = approval upgrade（不是 silent reconnect）
- [ ] JSONL 写锁不死锁（PID 死了自动释放）
- [ ] Coms graph 持久化（重启后可回放）

---

## 13. 文档地图

```
omp-fleet-console/
├── README.md                                # 项目主页
├── architecture-draft-2026-06-14.md         # ← 你在这
├── CHANGELOG.md
├── LICENSE
├── docs/
│   ├── architecture.md                      # 升格本文件
│   ├── phase-1-cli-supervisor.md            # Phase 1 详细
│   ├── phase-2-web-dashboard.md             # Phase 2 详细
│   ├── phase-3-policy-lifecycle.md          # Phase 3 详细
│   ├── phase-4-overnight.md                 # Phase 4 详细
│   ├── protocol-spec.md                     # WebSocket 协议规范
│   ├── coms-bus-spec.md                     # Coms Bus 协议
│   ├── mesh-graph-spec.md                   # Mesh graph 协议
│   └── handoff-protocol.md                  # Handoff 协议
└── ...
```

---

*本架构草案基于 2026-06-14 直接 fetch OpenClaw / Hermes / OMP 官方仓库 + Cave 内部 Coms 项目实测记录。*
*草案目的：让 Codex 参与 §8 的 5 个决策点讨论；不写实现细节；不修改任何 Cave 外项目。*
