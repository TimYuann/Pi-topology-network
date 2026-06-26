# `pi-topology` Pi Package（草案）

本包是 Pi拓扑网络在 Pi 运行面的最小落地版，目标是把 `topology` 运行协议打包为可复用的 Pi package。

## 说明（已聚焦到可执行层）

- 入口控制面：`topology-supervisor`（owner-facing）
- 运行时核：`pi` + `package.json` 的 `pi` 字段（扩展 + 技能）
- 通信模型：packet-first（结构化 packet 优先），只允许 ACK/NL 类短回执走原生 final text
- 状态真相源：`mission card`、`status board`、`incident log`、`runtime event log`

## 包字段（必须确认）

`package.json` 当前约定：

- `pi.extensions`: `["./index.ts"]`
- `pi.skills`: `["./skills"]`

这意味着 Pi 会从本包 `index.ts` 注册工具/命令；技能目录作为可发现技能入口暴露。

## 维护者文档

详细架构、文件职责、启动流程、角色 prompt 注入、硬/软限制边界见：

- [`docs/usage-guide.md`](docs/usage-guide.md)
- [`docs/architecture.md`](docs/architecture.md)

## MVP 工具（`topology_*`）

以下为当前最小工具面，名称为已约定并通过本包注册测试覆盖的集合：

- `topology_init_mission`
- `topology_status`
- `topology_doctor`
- `topology_smoke`
- `topology_spawn_role`
- `topology_send`
- `topology_get`
- `topology_list`
- `topology_cleanup`

辅助命令：`topology`、`topology-status`（slash command surface）。

`/topology` 的定位是智能入口：优先复用当前项目已有 mission；如果没有 mission，会尝试读取当前 session 最近一条 assistant 回复并识别任务卡。识别成功，或用户直接输入 `/topology <任务目标或任务卡>` 时，它会创建 mission draft、状态文件和 launch scripts，并把当前 session 直接接管为 `topology-supervisor`。它不会直接启动 worker 角色，角色展开仍在 Supervisor/owner gate 之后。

常用 slash command 流程：

- `/topology`：智能入口。已有 mission 时显示状态；无 mission 且上一条 assistant 回复像任务卡时自动创建 mission draft，并把当前 session 接管为 Supervisor；否则显示 intake/preflight。
- `/topology <任务目标或任务卡>`：直接创建 mission card、status board、runtime events，生成 `.pi/topology/launch/*.sh`，并把当前 session 接管为 Supervisor；不需要再输入 `init`。
- `/topology init <任务卡>`：兼容/显式形式，保留给脚本或偏好明确子命令的用户；日常使用优先 `/topology <任务目标或任务卡>`。
- `/topology status`：显示 mission/status/incident/runtime/outbox 路径和当前 owner gate。
- `/topology doctor`：只读校验 mission 与 watchdog 状态。
- `/topology packets`：列出最近 local outbox packets。
- `/topology spawn hq`：解释并检查 HQ 扩展门；当前 session 已是 Supervisor 时，它会提示先拿 owner approval，再由 Supervisor 调用 `topology_spawn_role` 启动对应角色。
- `/topology-status`：`/topology status` 的兼容别名。

## 本地安装与引用（面向本仓库）

如果你要在本地把本包当作开发版引入，优先路径是：

1. 确认 `package.json` 的 `pi.extensions` / `pi.skills` 指向存在的文件。
2. 用 `index.ts` 作为扩展入口加载到 Pi session。
3. 使用时优先运行 `/topology`。如果上一条 assistant 回复已是任务卡，它会自动建立任务面并接管当前 session 为 Supervisor；否则直接运行 `/topology <任务目标或任务卡>`。
4. 在当前 Supervisor session 中完成 owner approval；通过后再由 Supervisor 启动 HQ / worker 脚本。

> 精确到现在：`pi install .` 已在 2026-06-16 本地验证通过（输出 `Installed .`）。Hub 安装/发布链路仍属于待验证链路。

## 现状：本地 Packet-first 传输

当前实现默认启用本地传输：

- Peer registry: `<transport_root>/projects/<project>/agents/<name>.json`（可通过 transport 根目录重定向）
- Outbound packet 落盘: `<transport_root>/projects/<project>/packets/outbox.jsonl`
- Role inbox: `<transport_root>/projects/<project>/packets/<role>-inbox.jsonl`
- 工具面：`topology_send` / `topology_get` / `topology_list`

`PI_COMS_DIR` 可用于自定义 transport 根目录（如 `/tmp` 下项目隔离目录）。

## Mission + 状态文件

当前默认产物：

- Mission card：`<workdir>/.pi/topology/mission-card.json`
- Status board：`<workdir>/.pi/topology/status-board.json`
- Incident log：`<workdir>/.pi/topology/incident-log.jsonl`
- Runtime event log：`<workdir>/.pi/topology/runtime-events.jsonl`
- Session ledger：`<workdir>/.pi/topology/sessions.jsonl`
- Launch scripts：`<workdir>/.pi/topology/launch/*.sh`

建议默认路径为：`./.pi/topology/*`。

`.pi/topology/` 是当前项目下的 topology 工程记录目录。它保存 mission、状态、事件、incident、派生脚本和派生 session 索引，但不替代 Pi 自己的全量 session transcript 存储。

Mission card 必须包含 `progress` 字段，用作跨 session 继承锚点：

- `status`：`awaiting_owner_confirmation` / `supervisor_ready` / `running` / `blocked` / `completed` 等。
- `percent`：当前完成度数字。
- `current_step`：当前正在等待或执行的下一步。
- `completed_steps` / `pending_steps`：已经完成与尚待完成的阶段标记。
- `source` / `source_entry_id`：任务来源，区分手动输入与上一条 assistant 任务卡。

## Mission card / status board / incident 的关系

- `topology_init_mission` 负责写入 mission card（含 progress、owner gate、roles、allowed/forbidden、stop conditions）。
- `topology_status` 读取并展示 status board 的当前 runtime 阶段、peer、pending packet、健康信息、上次 checkpoint。
- 所有异常、阻断、边界冲突都应进入 incident log，供 `topology_doctor` 及审计复盘。
- `runtime-events` 负责结构化 trace，供 incident 重建与后续 UI 接入。
- `sessions.jsonl` 负责记录 role session 工程索引：`script_written`、`launch_printed`、`launch_requested`、后续可扩展到 `alive_confirmed` / `closed`。`session_id: null` 表示尚未由真实 role session 自证 alive。

## 角色与权限约束（当前规则）

- 默认只允许 `repair` 在 mission allowed_paths 内写。
- `runner` / `oracle` / `librarian` / `scott` 默认 read-only。
- `hq` 默认不直接执行 write 工具。
- 触发 owner gate（如高风险 shell）时记录阻断 evidence。
- `librarian` 负责 evidence index / docs / records / logs 汇总；`scott`（scout alias）负责 Pi 参考调研，两者不输出最终 verdict。

## 已知限制（本文件范围内）

- 已实测：`pi install .` 本地安装链路（2026-06-16，输出 `Installed .`）
- 已实测：早期真实 Ghostty + Pi 角色 smoke（2026-06-16，`hq` / `runner` / `oracle` 以 `--cname` 启动并调用 topology 工具）
- 已实测：本地 Pi offline smoke（2026-06-16）调用 `topology_init_mission` / `status` / `doctor` / `send` / `get` / `list` / `spawn_role(mode=print)`，runtime-events 与 local-coms outbox 均落盘。
- 已实测：本地 Pi offline 角色 smoke（2026-06-16）覆盖 `hq` / `repair` / `runner` / `oracle` / `librarian` / `scott`，日志在 `/tmp/pi-topology-script-offline-stability/logs/`。
- 已修正：`/topology` / `/topology <任务>` 现在生成 `topology-supervisor.sh` 与各角色 launch script，同时把当前 session 接管为 `topology-supervisor`；持久脚本仍作为 fallback 与 worker 启动机制保留，`topology_spawn_role(mode=launch)` 的返回值仍不能单独当作 session alive 证据。
- 已修正：`.pi/topology/sessions.jsonl` 现在记录每个生成脚本和 spawn request，`launch_requested` 与 `alive_confirmed` 分离，避免把打开窗口误判成 session 成功。
- 已实测：`npm run guard-smoke` 触发 extension `tool_call` guard，验证 runner/oracle/librarian/scott 写入阻断、repair allowed/outside 写入策略、危险 shell owner gate，并写入 incident/runtime-event JSONL。
- 已知边界：`topology_spawn_role(mode=launch)` 只能证明 launch request 已发出；必须通过新 session、runtime event、packet 或 registry 证据确认角色 alive。
- 已实测：packet schema 会拒绝空 body；该修复来自 Scott 真实 dogfood 中重复空 REPORT 的发现。
- 已实测：Ghostty smoke scripts 默认不等待 Enter，避免测试窗口堆积；需要观察窗口时显式设置 `PI_TOPOLOGY_WAIT_ON_EXIT=1`。
- 未实测：HTTP/SSE transport（网络侧）
- 未实测：package hub 发布/安装
- 当前文档面向“当前 MVP 与本地验证边界”，非生产可发布承诺

## 下一步（可直接执行）

1. 先读 `usage-guide.md`，按真实使用流程建立一个小 Mission。
2. 用 `install.md` 搭建或刷新本地可用路径。
3. 按 `dogfood.md` 在一个小项目执行一轮 mission + status + cleanup。
4. 按 `package-hub-readiness.md` 补齐未验证项后再做发布。
