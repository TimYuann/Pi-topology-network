# Pi Topology Package Architecture

本文件是 `pi-topology-network` 插件说明书，面向后续接手的 session、维护者、以及未来 GitHub README/Package Hub 文档。它说明代码放在哪里、Pi 如何加载它、每类文件负责什么、启动流程如何运作，以及当前哪些约束是代码硬限制、哪些仍是协议软限制。

## 1. 代码位置与安装形态

当前插件代码位于本仓库：

```text
/Users/yuantian/Documents/Coding/omp-topology-network/packages/pi-topology
```

它不是 `~/Documents/Coding` 下另一个独立项目。当前本机 Pi 安装的是这个本地路径 package：

```text
../../Documents/Coding/omp-topology-network/packages/pi-topology
```

本地开发更新后，刷新 Pi 安装使用：

```bash
cd /Users/yuantian/Documents/Coding/omp-topology-network/packages/pi-topology
pi install .
```

`pi update` 更适合已登记或已发布来源的更新；对当前这种本地路径开发包，`pi install .` 是确认工作区源码生效的可靠方式。

## 2. Package 加载入口

Pi 通过 `package.json` 的 `pi` 字段识别本包：

```json
{
  "pi": {
    "extensions": ["./index.ts"],
    "skills": ["./skills"]
  }
}
```

加载链路：

1. Pi 读取 package。
2. Pi 执行 `index.ts`。
3. `index.ts` 调用 `registerPiTopology(pi)`。
4. `registerPiTopology` 注册：
   - slash commands
   - `topology_*` tools
   - Pi flags
   - session start UI hook
   - tool-call guard hook

## 3. 运行模型

本包把 OMP拓扑网络协议落到 Pi 本地运行面。核心设计是：

- owner 优先只输入 `/topology`：已有 mission 时恢复状态；无 mission 时尝试从上一条 assistant 回复识别任务卡。
- 如果上一条 assistant 回复不是任务卡，owner 可以直接输入 `/topology <任务目标或任务卡>`，不需要再输入 `init`。
- `/topology init <任务卡>` 作为兼容/显式形式保留，不是日常推荐入口。
- mission/status/incident/runtime event 写入当前项目的 `.pi/topology/`。
- mission 初始化后，当前 session 会直接接管为 `topology-supervisor`，写入 `alive_confirmed`，安装 topology UI，并收到 Supervisor bootstrap follow-up；用户不需要复制粘贴 `topology-supervisor.sh`。
- owner gate 通过前不自动展开角色 mesh。
- 后续通过 `topology_spawn_role` 启动独立角色 session。
- 角色之间优先用 structured packet 通信，而不是让用户人工转发 inline 文本。

当前 verified transport 是 local JSONL：

```text
<transport_root>/projects/<project>/packets/outbox.jsonl
<transport_root>/projects/<project>/packets/<role>-inbox.jsonl
```

HTTP/SSE transport 仍是 compatibility target，不写成已验证。

## 4. Slash Command 语义

### `/topology`

智能入口。它检查当前项目：

- cwd
- trust 状态
- 是否已有 mission card
- status board / incident log / runtime event log
- local outbox
- 下一步建议

如果当前项目已有 mission，它展示状态与下一步建议；如果当前 session 已接管为 Supervisor，会提示继续在本 session 完成 owner approval，而不是提示复制 launch command。

如果当前项目没有 mission，它会读取当前 session 最近一条 assistant 回复：

- 如果内容明显像任务卡（包含目标、范围、验收、风险/下一步等结构），它会自动创建 mission draft、status board、runtime events 和 launch scripts，并把当前 session 接管为 `topology-supervisor`。
- 如果内容不像任务卡，它只显示 intake/preflight，并提示用户直接输入 `/topology <任务目标或任务卡>`。

它不会直接 spawn worker role。

### `/topology <任务目标或任务卡>`

这是日常推荐的显式启动方式。它直接创建本次 mission：

- `.pi/topology/mission-card.json`
- `.pi/topology/status-board.json`
- `.pi/topology/runtime-events.jsonl`
- `.pi/topology/sessions.jsonl`
- `.pi/topology/launch/topology-supervisor.sh`
- `.pi/topology/launch/<role>.sh`

并写入：

- `runtime_boot`
- `mission_initialized`
- `launch_scripts_written`
- `session_alive`（当前 session 接管为 `topology-supervisor` 时）

任务目标会进入 `mission-card.json` 的 `objective`；任务来源进入 `progress.source`，用于后续 session 继承。当前 session 会收到 Supervisor bootstrap follow-up，继续负责 preflight、owner approval 和下游角色启动。

### `/topology init <任务卡>`

兼容/显式形式。它与 `/topology <任务目标或任务卡>` 创建同一组 mission 文件：

- `.pi/topology/mission-card.json`
- `.pi/topology/status-board.json`
- `.pi/topology/runtime-events.jsonl`
- `.pi/topology/sessions.jsonl`
- `.pi/topology/launch/topology-supervisor.sh`
- `.pi/topology/launch/<role>.sh`

并写入：

- `runtime_boot`
- `mission_initialized`
- `launch_scripts_written`
- `session_alive`（当前 session 接管为 `topology-supervisor` 时）

这表示 owner 已经明确要为这张任务卡启动 topology 目标模式。默认下一步不是直接启动所有角色，而是把当前 session 接管为 `topology-supervisor`。Supervisor 是入口 session，后续仍保留 owner gate。`topology-supervisor.sh` 仍会生成，作为 fallback 或手动恢复入口。

### Mission progress 字段

`mission-card.json` 必须包含 `progress`，这是跨 session 继承时判断任务推进状态的锚点：

```json
{
  "progress": {
    "status": "awaiting_owner_confirmation",
    "percent": 5,
    "current_step": "Current session is topology-supervisor; waiting for owner confirmation before dynamic role spawn.",
    "completed_steps": ["mission_drafted", "start_topology_supervisor"],
    "pending_steps": [
      "owner_confirm_mission",
      "spawn_hq_after_owner_gate",
      "execute_and_verify",
      "owner_closeout"
    ],
    "source": "manual",
    "source_entry_id": "optional-session-entry-id"
  }
}
```

`source` 用来区分任务来自手动输入还是上一条 assistant 任务卡。`status/percent/current_step/completed_steps/pending_steps` 用来避免下游 session 误判 mission 是否已完成、是否还在 owner gate、是否可以继续派生角色。

### Project session ledger

`.pi/topology/sessions.jsonl` 是项目级派生 session 索引。它是 append-only 工程记录，不是 Pi 全量 transcript 的替代品。

当前记录状态：

- `script_written`：已生成某个 role 的启动脚本，不代表 session 已启动。
- `launch_printed`：`topology_spawn_role(mode=print)` 已输出/准备启动命令，不代表 session 已启动。
- `launch_requested`：`topology_spawn_role(mode=launch)` 已向终端 app 发起打开请求，不代表 session 已经 alive。
- `alive_confirmed`：预留给后续角色自证 heartbeat / registry / packet 确认。
- `closed` / `failed`：预留给后续收口与失败记录。

`session_id` 初始为 `null`，只有真实派生 role session 自证后才应写入具体 session id。这个边界用于避免把 Ghostty 窗口打开误判为 Pi role session 成功。

### `/topology status` / `/topology-status`

显示当前 mission/status/incident/runtime/outbox 路径，以及 phase、owner gate、incident count、packet count。

### `/topology doctor`

只读校验：

- mission schema
- status board watchdog
- incident count
- owner gate / checkpoint missing 等 finding

### `/topology packets`

列出最近 local outbox packets，方便快速确认 packet flow。

### `/topology spawn hq`

解释并检查 HQ 扩展门。它和 `init` 不同：

- `init` 建立任务状态面。
- `spawn hq` 是 owner 确认 mission 后，提示 Supervisor 可以使用 `.pi/topology/launch/hq.sh` 另开 HQ 协调 session。

当前 slash command 不直接绕过 owner gate 自动 launch。真实入口优先使用 mission 初始化生成的 launch scripts；`topology_spawn_role` 只表示 launch request，不能单独证明 session alive。

## 5. 角色清单

当前预设角色：

| 角色 | 类型 | 默认权限 | 职责 |
|---|---|---|---|
| `topology-supervisor` | entry / owner-facing | 不写业务代码 | preflight、mission intake、owner gate、最终对 owner 汇报 |
| `hq` | coordinator | 不写业务代码 | 拆任务、派发、收集证据、合并判断 |
| `repair` | executor | 只可写 `allowed_paths` | 在明确授权内修复代码或文档 |
| `runner` | verifier | read-only | 复现、测试、验证、产出报告 |
| `oracle` | reviewer | read-only | 独立审查、风险判断、不修代码 |
| `librarian` | evidence curator | read-only | 整理 evidence、docs、records、logs |
| `scott` | scout / researcher | read-only | 调研 Pi/package/API/参考实现 |

角色 prompt 位于：

```text
packages/pi-topology/agents/
```

公共协议：

```text
packages/pi-topology/agents/shared-protocol.md
```

## 6. Prompt / Session 注入方式

对被 `topology_spawn_role` 拉起的角色，launch plan 会注入：

```text
agents/shared-protocol.md
agents/<role>.md
.pi/topology/mission-card.json
```

并把一次性的 `initialPrompt` 作为交互 session 的初始消息传入；当前不使用 `-p` 非交互模式，避免出现“窗口打开但没有持久 session”的问题。

例：spawn `runner` 时，它会携带：

```text
shared-protocol.md
runner.md
mission-card.json
initialPrompt
```

这就是当前的 session prompt / pre-injection 机制。

`topology-supervisor` 有两层定义：

- 代码层：它是 `entry_role`，也是 slash command 的 owner-facing 控制面。
- prompt 层：`agents/topology-supervisor.md` 定义它在真实 Pi session 中的行为规范。

## 7. 文件职责索引

### 根文件

| 文件 | 职责 |
|---|---|
| `package.json` | package metadata、Pi extension/skill 声明、test/smoke 脚本 |
| `index.ts` | Pi extension 入口，调用 `registerPiTopology` |
| `README.md` | 顶层说明、已验证项、安装与边界 |

### `src/extension/`

| 文件 | 职责 |
|---|---|
| `register.ts` | 注册 flags、commands、tools、session_start UI、tool_call guard |
| `commands.ts` | slash commands：`/topology`、`/topology <任务>`、`/topology init`、`status`、`doctor`、`packets`、`spawn hq` |
| `tools.ts` | `topology_*` tool 实现：init/status/doctor/spawn/send/get/list/cleanup |
| `ui.ts` | 状态行/compact UI 辅助 |

### `src/runtime/`

| 文件 | 职责 |
|---|---|
| `mission.ts` | Mission card、status board、roles、watchdog 数据结构与生成/校验 |
| `packet.ts` | Packet schema、packet 创建、packet 校验、direct reply 限制辅助 |
| `guard.ts` | 角色权限与 tool_call guard：写权限、allowed_paths、危险 shell owner gate |
| `spawn.ts` | 构造 role launch plan、写 Ghostty/Pi launch script、prompt/env 注入 |
| `status-board.ts` | status board re-export/兼容入口 |
| `watchdog.ts` | watchdog re-export/兼容入口 |

### `src/transport/`

| 文件 | 职责 |
|---|---|
| `local-coms.ts` | local JSONL packet outbox/inbox，`topology_send/get/list` 底层实现 |
| `registry.ts` | peer registry 文件写读 |
| `net-coms.ts` | HTTP/SSE transport placeholder，目前是 compatibility target |
| `response-capture.ts` | response capture placeholder/辅助 |

### `src/state/`

| 文件 | 职责 |
|---|---|
| `event-log.ts` | append-only runtime event JSONL |
| `incident-log.ts` | append-only incident JSONL |
| `session-ledger.ts` | append-only role session 工程索引，记录 script/launch/session 状态 |
| `manifests.ts` | manifest/state 辅助 |
| `paths.ts` | path 辅助 |

### `src/roles/`

| 文件 | 职责 |
|---|---|
| `role-policy.ts` | 导出角色列表与角色默认权限 |
| `prompts.ts` | 根据 package root 返回 bundled prompt 路径 |

### `src/schemas/`

| 文件 | 职责 |
|---|---|
| `mission.schema.ts` | mission schema 草案 |
| `packet.schema.ts` | packet schema 草案 |
| `status.schema.ts` | status schema 草案 |

### `agents/`

| 文件 | 职责 |
|---|---|
| `shared-protocol.md` | 所有角色共享协议：ACK、packet-first、证据三分法、inline 限制 |
| `topology-supervisor.md` | owner-facing supervisor prompt |
| `hq.md` | HQ 协调角色 prompt |
| `repair.md` | 修复角色 prompt |
| `runner.md` | 验证角色 prompt |
| `oracle.md` | 独立审查角色 prompt |
| `librarian.md` | evidence curator prompt |
| `scott.md` | scout/research prompt |

### `scripts/`

| 文件 | 职责 |
|---|---|
| `ghostty-supervisor-smoke.sh` | 真实 Ghostty + Pi supervisor dogfood |
| `ghostty-role-smoke.sh` | 真实 Ghostty + Pi role smoke |
| `guard-smoke.mjs` | 直接触发 extension tool_call guard，验证 incident/runtime event |

### `test/unit/`

| 文件 | 职责 |
|---|---|
| `extension.test.ts` | extension 注册、slash command、runtime event flow、guard hook |
| `mission.test.ts` | mission/status/watchdog |
| `packet.test.ts` | packet schema/direct reply |
| `packet-tools.test.ts` | local-coms send/get/list |
| `guard.test.ts` | 角色写权限和 owner gate |
| `guard-incident.test.ts` | guard incident 持久化 |
| `roles.test.ts` | role policy/prompt path |
| `spawn.test.ts` | role launch plan/script |
| `state-transport.test.ts` | registry/outbox/event append |

## 8. 当前硬限制与软限制

### 已有代码硬限制

- `runner` / `oracle` / `librarian` / `scott` 写文件会被 block。
- `hq` / `topology-supervisor` 默认不能写业务代码。
- `repair` 只能写 `allowed_paths` 内文件。
- 危险 shell action 如 `git push`、`git reset --hard`、`rm -rf` 进入 owner gate。
- packet 需要合法 role、合法 recipient、非空 body、hop limit、audit arrays。

### 仍是协议/Prompt 软限制

- `repair` 不应自己跑 test；应交给 `runner`。
- `hq` 不应无判断转发 repair 报告给 runner。
- worker 不应把 business report 放 inline final。
- 不同 packet 类型的合法路由还未完全代码化。
- HQ dispatch 是否带足 `scope/evidence_refs/hq_decision/request_msg_id` 还未硬拦截。

这些软限制是下一轮应补的重点。建议实现：

- packet route policy
- role action policy
- HQ dispatch gate
- final-output / inline report guard

## 9. 典型启动流程

1. 用户在目标项目中输入：

   ```text
   /topology
   ```

2. 系统检查当前状态。若已有 mission，则显示进度和下一步；若上一条 assistant 回复像任务卡，则自动创建 mission draft 并把当前 session 接管为 Supervisor；否则进入 intake/preflight。

3. 如果还没有任务卡，用户直接输入：

   ```text
   /topology <任务目标或任务卡>
   ```

4. 系统创建 mission/status/runtime event，生成 `.pi/topology/launch/*.sh`，把当前 session 标记为 `topology-supervisor alive_confirmed`，并发送 Supervisor bootstrap follow-up。`/topology init <任务卡>` 仍可用，但只是兼容/显式形式。

5. 用户检查：

   ```text
   /topology status
   /topology doctor
   ```

6. 当前 session 已经是 Supervisor entry session。Supervisor 先 direct ACK，再调用 `topology_status` / `topology_doctor`，提出 launch set，并等待 owner approval。

7. 用户确认要展开 mesh：

   ```text
   APPROVE
   ```

8. Supervisor 在 owner 批准后调用 `topology_spawn_role(mode="launch")` 启动 HQ 和已批准 worker。生成的 `topology-supervisor.sh` 只作为 fallback 或手动恢复入口。

9. HQ 根据 mission 和 owner gate 拉起或请求 runner/oracle/repair/librarian/scott。

## 10. 验证命令

本地开发基本验证：

```bash
cd packages/pi-topology
npm run smoke
npm run guard-smoke
pi install .
pi list
```

真实 Ghostty dogfood：

```bash
PI_TOPOLOGY_RUN_ROOT=/tmp/pi-topology-dogfood-<date> \
open -na Ghostty.app --args -e \
/Users/yuantian/Documents/Coding/omp-topology-network/packages/pi-topology/scripts/ghostty-supervisor-smoke.sh
```

脚本默认不会等待 Enter，避免 Ghostty 实例堆积。需要保留窗口时设置：

```bash
PI_TOPOLOGY_WAIT_ON_EXIT=1
```

## 11. 已验证与未验证边界

已验证：

- 本地 `pi install .`
- slash command 智能入口/init 兼容路径单测
- local JSONL packet flow
- runtime events / incident log
- MiniMax M3 + Ghostty clean dogfood
- guard smoke

未验证：

- HTTP/SSE transport
- Package Hub 发布/安装
- 长时间 owner gate 后 checkpoint 流
- 完整代码级 route/action/final-output guard
