# Pi拓扑包狗粮计划

目的：先自己用自己跑一轮，确认该包能承担真实协作闭环的最小成本路径。

## 狗粮范围（MVP）

- 1 个 owner-facing mission
- 1 个 `topology-supervisor` 入口
- 1 次 `topology_init_mission`
- 1 次 `topology_status`（创建后与运行中两次）
- 1 次 `topology_doctor`
- 1 次 `topology_spawn_role`（至少 print；launch 需要记录 Ghostty/Pi 证据）
- 1 次 `.pi/topology/sessions.jsonl` 检查，确认脚本生成与 launch request 被结构化记录
- 1 次 `topology_send` / `topology_get` / `topology_list` packet 往返
- 1 次 `topology_cleanup`（回退）

## 准备

- 新建测试目录（如 `workspace/dogfood/<date>`）。
- 明确目标：限定到非破坏性变更（文案、注释、文档）
- 设定 allowed_paths（避免越权）
- 设定 forbidden_actions（如 git push、rm -rf、git reset --hard）

建议环境：

- `PI_COMS_DIR=/tmp/pi-topology-dogfood`
- mission workdir = 测试项目根
- 先清理：`rm -f .pi/topology/mission-card.json .pi/topology/status-board.json .pi/topology/incident-log.jsonl`
- 真实 provider dogfood 默认：`--provider minimax-cn --model MiniMax-M3 --thinking low`
- 无第三方 provider 的本地证据可用：`PI_OFFLINE=1 PI_TOPOLOGY_SPAWN_MODE=print`
- Ghostty 窗口默认应随 smoke 结束而关闭；只有需要人工观察时设置 `PI_TOPOLOGY_WAIT_ON_EXIT=1`

## 执行流程

### 1) 启动入口

```bash
pi -e packages/pi-topology/index.ts --cname topology-supervisor --project dogfood
```

在已安装 package 的交互会话中，优先从 slash command 开始：

```text
/topology
```

预期：

- 若当前项目已有 mission：显示 mission/progress/owner gate/下一步建议。
- 若当前项目没有 mission，且上一条 assistant 回复像任务卡：自动创建 mission draft、status board、runtime events 和 launch scripts。
- 若当前项目没有 mission，且上一条 assistant 回复不像任务卡：只做 intake/preflight，提示直接输入 `/topology <任务目标或任务卡>`。
- 不直接 spawn worker 角色。

### 2) 建立任务

slash command 路径：

```text
/topology <任务目标或任务卡>
```

`/topology init <任务卡>` 仍可作为兼容/显式形式使用，但不是日常推荐路径。

tool 路径：

- `topology_init_mission`
  - 入参建议包含 project、workdir、objective、allowed_paths
  - Owner 首次确认：`mission_card` 中的边界条件与 stop conditions

`/topology <任务目标或任务卡>` 表示 owner 已明确要为这张任务卡启动 topology 目标模式；它写 mission/status/runtime-events/sessions.jsonl/launch scripts，但仍保留 dynamic spawn 的 owner gate。

### 3) 状态核对

调用：

- `/topology status`
- `/topology doctor`
- `topology_status`
  - 确认 runtime phase
- 确认 peer 状态（至少 `topology-supervisor` 在 entry，其他 role in not_spawned）
  - 确认 next_gate 为 owner 决策门
  - 确认 allowed/forbidden 显式可见
- 检查 `.pi/topology/sessions.jsonl`
  - 初始化后应有各 role 的 `script_written`
  - `topology_spawn_role(mode=print)` 应追加 `launch_printed`
  - `topology_spawn_role(mode=launch)` 应追加 `launch_requested`
  - `session_id: null` 不可解释为 alive，必须等待 role 自证

### 4) 通信与审计检查

- 优先检查 local packet 首发路径存在且可重放（outbox）
- 用 `topology_send` 发送 HQ -> runner `STATUS` 或 `REQUEST`
- 用 `topology_get` / `topology_list` 非阻塞读取 runner/HQ inbox
- 检查 `incident log` 是否出现：
  - scope/edge case
  - owner gate
  - channel policy violation
- 预期不应出现 runner/oracle 写盘行为

### 5) 收口

- 预期 `topology_doctor` 输出：
  - 目标发现缺失 checkpoint / pending packet / health 告警
- 记录 `runtime event` 与 `incident` 用于复盘

### 6) 清理

- `topology_cleanup`
  - 关闭/复位临时会话状态
  - 保留 incident/event 以便复盘（仅清理状态面）

## 验收标准（该包本地狗粮版）

- mission card 结构完整，owner gate 明确
- status board 能重建关键运行事实
- sessions.jsonl 能重建脚本生成与 launch request 事实，且不把 launch request 当作 alive
- incident log 与 runtime events 有 append-only 记录
- local transport 可回放 packet
- 未出现未授权写越权

## 风险与未验证项（务必记录在狗粮记录内）

- `pi install .` 已完成本地安装验证：2026-06-16 输出 `Installed .`
- MiniMax M3 + Ghostty clean dogfood 已验证：2026-06-16，run root `/tmp/pi-topology-dogfood-minimax-clean-2026-06-16`
- 多角色 Ghostty + Pi smoke 已验证 `hq` / `repair` / `runner` / `oracle` / `librarian` / `scott` role prompt、tool load、一次非空 structured packet 发送
- `topology_spawn_role(mode=launch)` 已验证 spawned HQ 通过同一 mission workdir 写入 runtime event 与 local outbox：
  - spawned HQ packet: `pkt_93fd1b65-c5b3-4983-925d-6a0a9a6e32bd`
- 2026-06-16 本地 Pi offline smoke 已验证 supervisor 工具流和 `hq` / `repair` / `runner` / `oracle` / `librarian` / `scott` 角色脚本 smoke；日志在 `/tmp/pi-topology-script-offline-stability/logs/`
- MiniMax M3 + Ghostty 深度 dogfood 已在 owner 显式批准第三方 provider 数据传输风险后完成；不要把该结论外推到 HTTP/SSE transport
- HTTP/SSE transport 未实测：只按兼容目标记录，不纳入 MVP 结论
- package hub 发布未实测：发布前需走 `package-hub-readiness.md` 的通过项
- Scott 真实 dogfood 曾暴露重复空 REPORT 风险；当前 schema 已拒绝空 packet body，role smoke prompt 已限制一次 `topology_send`
