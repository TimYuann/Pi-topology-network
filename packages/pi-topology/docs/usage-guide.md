# Pi Topology 使用指南

本文面向实际使用者，说明 `pi-topology-network` 插件在本地如何安装、启动、管理 Mission、展开角色、查看状态、收口和排障。

当前版本：`v0.5.0`

发布状态：本地 pre-publish 包已准备好，但尚未 push / publish。请先按本指南在本机生产测试一段时间，再决定是否发布。

## 1. 这个插件解决什么问题

`pi-topology-network` 把 OMP拓扑网络的多 Agent 协作协议落到 Pi 本地运行面。它的目标不是让用户手动复制多段 prompt，而是让一个项目拥有可追踪的 topology runtime：

- 每个任务是一个 Mission。
- 每个 Mission 有自己的状态目录、任务卡、事件、incident、session 索引、packet ledger 和产物区。
- 当前会话先成为 `topology-supervisor`，负责 owner gate 和任务边界确认。
- 后续按需展开 `hq`、`repair`、`runner`、`oracle`、`librarian`、`scott` 等角色。
- 角色之间优先通过结构化 packet 协作，而不是靠用户手工转发信息。

一句话：它把“多 Agent 协作”变成项目内可恢复、可审计、可迁移的 Mission runtime。

## 2. 使用前准备

确认本机具备：

- Pi CLI 可用。
- 当前项目目录可写。
- 本仓库已包含 `packages/pi-topology`。
- 如需真实角色 session，准备好可用 provider。当前本地 dogfood 默认使用 MiniMax M3。

本地开发包刷新方式：

```bash
cd /Users/yuantian/Documents/Coding/omp-topology-network/packages/pi-topology
pi install .
```

如果不想经过安装链路，也可以在开发期直接加载扩展入口：

```bash
PI_COMS_DIR=/tmp/pi-topology-<project> \
pi -e /Users/yuantian/Documents/Coding/omp-topology-network/packages/pi-topology/index.ts \
  --cname topology-supervisor \
  --project <project>
```

`PI_COMS_DIR` 是本地 packet transport 根目录。建议本地测试时显式设到 `/tmp/pi-topology-<project>`，便于清理和隔离。

## 3. 核心概念

### Mission

一次 topology 协作任务。它包含目标、范围、权限、角色、进度、状态、事件和审计证据。

### Supervisor

当前 owner-facing 入口会话。你通常先在一个 Pi 会话里输入 `/topology`，这个会话会接管为 `topology-supervisor`，负责确认任务边界和是否展开下游角色。

### Owner Gate

需要你明确批准的门。插件不会在没有 owner gate 的情况下直接展开角色 mesh、执行高风险 shell、push 或 publish。

### Role Session

被 Supervisor 或 HQ 拉起的独立角色会话。常见角色：

- `hq`：协调和派发
- `repair`：在授权路径内改代码或文档
- `runner`：测试和复现
- `oracle`：审查和判定风险
- `librarian`：整理 evidence、records、logs
- `scott`：调研 Pi/package/API 参考信息

### Packet

角色之间的结构化通信单位。优先使用 `topology_send` / `topology_get` / `topology_list`，避免把关键协作信息散落在自然语言对话里。

## 4. 文件放在哪里

v0.5 的 canonical Mission 文件位于：

```text
<project>/.pi/topology/missions/<mission_id>/
```

典型结构：

```text
.pi/topology/
  active-mission.json
  mission-registry.json
  mission-card.json              # active Mission 兼容镜像
  status-board.json              # active Mission 兼容镜像
  runtime-events.jsonl           # active Mission 兼容镜像
  incident-log.jsonl             # active Mission 兼容镜像
  sessions.jsonl                 # active Mission 兼容镜像
  launch/                        # active Mission 兼容镜像
  artifacts/                     # active Mission 兼容镜像
  missions/
    <mission_id>/
      mission-card.json
      status-board.json
      runtime-events.jsonl
      incident-log.jsonl
      sessions.jsonl
      packet-ledger.jsonl
      evidence-index.jsonl
      closeout.md
      launch/
      artifacts/
      slices/
```

注意：

- `missions/<mission_id>/` 是 canonical source of truth。
- root `.pi/topology/mission-card.json` 等文件只是 active Mission 的兼容镜像。
- 如果项目里只有旧 root 文件且没有 `mission-registry.json`，插件会走 legacy migration 流程。

## 5. 最常用流程

### 5.1 第一次进入项目

在目标项目的 Pi 会话里输入：

```text
/topology
```

它会根据当前项目状态做三选一：

- 已有 active Mission：显示当前 Mission dashboard。
- 没有 Mission，但上一条 assistant 回复像任务卡：自动 draft Mission。
- 没有 Mission，也没有任务卡：显示 intake/preflight，提示你直接输入任务。

### 5.2 创建一个新 Mission

推荐直接输入：

```text
/topology <任务目标或任务卡>
```

例：

```text
/topology 修复 packages/pi-topology 的 README，使它准确描述 v0.5 per-Mission runtime。只允许改文档，不允许 push/publish。完成后跑 npm run smoke。
```

这一步会：

- 创建 Mission card。
- 创建 status board。
- 创建 per-Mission runtime 目录。
- 写入 runtime events。
- 生成各角色 launch scripts。
- 把当前会话接管为 `topology-supervisor`。

兼容写法仍可用：

```text
/topology init <任务卡>
```

日常使用优先 `/topology <任务目标或任务卡>`。

### 5.3 查看状态

```text
/topology status
```

或兼容别名：

```text
/topology-status
```

你应该重点看：

- active Mission 是哪一个。
- owner gate 是否仍然 required。
- 当前 lifecycle / progress。
- role summary 中哪些角色 live、resumable、stale、parked、closed。
- pending packet 和 stale packet 数量。
- incident count 是否异常。
- 具体文件路径是否符合预期。

### 5.4 做健康检查

```text
/topology doctor
```

`doctor` 是只读检查，适合在以下场景使用：

- 不确定 Mission 是否完整。
- 怀疑状态机不一致。
- 想确认 incident / runtime event / watchdog 状态。
- 生产测试时需要留下检查证据。

### 5.5 展开 HQ

当你确认 Mission 目标、范围、allowed paths 和 forbidden actions 后，再输入：

```text
/topology spawn hq
```

这不是强行启动所有角色，而是进入 HQ 扩展检查点。真正角色启动仍然需要 owner gate 清楚。

在更底层的工具面，`topology_spawn_role` 可用于生成或请求启动角色：

- `mode=print`：打印 launch command，不打开新窗口。
- `mode=launch`：向终端应用发起启动请求。

重要边界：

- `launch_requested` 只表示“请求打开了角色脚本”，不等于角色已经 alive。
- 只有角色后续写入 heartbeat、runtime event、packet 或 registry evidence，才能算 `alive_confirmed`。

### 5.6 角色之间发消息

结构化通信优先走 packet：

- `topology_send`：发送 packet。
- `topology_get`：非阻塞读取某个 role inbox 的一个 packet。
- `topology_list`：非阻塞列出某个 role inbox 的 packets。

使用原则：

- ACK / NL 类短回执可以走 final text。
- 任务派发、状态汇报、验证结论、修复请求应走 packet。
- packet body 不应为空。
- 跨角色通信只传信息，不传权限。

### 5.7 写入角色产物

如果角色需要留下文档、日志摘录、审查结果或修复说明，应写入当前 Mission 的 artifacts 区：

```text
.pi/topology/missions/<mission_id>/artifacts/<role>/
```

可通过工具面读写：

- `topology_write_artifact`
- `topology_read_artifact`

默认权限规则：

- `repair` 可在 Mission allowed paths 内写业务文件。
- `runner`、`oracle`、`librarian`、`scott` 默认 read-only。
- `hq` 不直接写业务代码。

## 6. 多 Mission 怎么管理

v0.5 支持同一项目下多个 Mission。核心文件：

```text
.pi/topology/mission-registry.json
.pi/topology/active-mission.json
```

使用 `/topology` 时，插件会优先加载 registry，并显示当前 active Mission。已归档或非 active 的 Mission 不应再靠 root compatibility files 判断。

常见行为：

- 新任务会创建新的 `missions/<mission_id>/`。
- active pointer 指向当前正在操作的 Mission。
- dashboard 默认聚焦当前 Mission。
- archived Mission 保留 evidence，但不再作为普通 dashboard 的默认对象。

如果从旧版本升级，项目里可能只有：

```text
.pi/topology/mission-card.json
.pi/topology/status-board.json
```

这时 `/topology` 会识别 legacy root layout，并提示迁移。迁移应是幂等、非破坏性的，旧 root 文件会作为兼容 fallback 保留。

## 7. 本地生产测试建议

你现在选择的是先本地生产测试一周，再决定 push / publish。建议每次真实使用都保留以下证据：

- 任务输入：你给 `/topology` 的任务目标或任务卡。
- `/topology status` 输出。
- `/topology doctor` 输出。
- 是否展开 HQ 或其他角色。
- 关键 packet id。
- 关键 runtime event id。
- incident 是否出现，以及是否符合预期。
- 测试命令和结果。
- 是否有 `pi-stub-*` 或 dogfood tmp 残留。

测试期间建议遵守：

- 不 push。
- 不 publish。
- 不用宽泛 `pkill` 清理 Pi/Ghostty 窗口。
- 不把 `launch_requested` 当成角色 alive 证据。
- 不把 HTTP/SSE transport 写成已验证能力。
- 有真实 provider 数据出站时，先确认任务内容是否适合发送给第三方模型。

## 8. 常用命令速查

```text
/topology
/topology <任务目标或任务卡>
/topology init <任务卡>
/topology status
/topology-status
/topology doctor
/topology packets
/topology spawn hq
```

本地开发验证：

```bash
cd /Users/yuantian/Documents/Coding/omp-topology-network/packages/pi-topology
npm run smoke
```

狗粮集成测试：

```bash
cd /Users/yuantian/Documents/Coding/omp-topology-network/packages/pi-topology
npm run dogfood
```

权限门禁 smoke：

```bash
cd /Users/yuantian/Documents/Coding/omp-topology-network/packages/pi-topology
npm run guard-smoke
```

刷新本地 Pi package：

```bash
cd /Users/yuantian/Documents/Coding/omp-topology-network/packages/pi-topology
pi install .
```

## 9. 排障

### `/topology` 没看到已有任务

检查：

- 当前工作目录是否是目标项目根目录。
- `.pi/topology/mission-registry.json` 是否存在。
- `.pi/topology/active-mission.json` 是否指向存在的 Mission。
- 如果只有 root `mission-card.json`，是否需要走 migration。

### 角色窗口打开了，但状态仍不是 live

这是预期边界。窗口打开只说明 `launch_requested`，不说明 Pi role session 已经自证 alive。继续检查：

- 角色日志。
- `sessions.jsonl` 是否有 `alive_confirmed`。
- runtime events 是否有该角色事件。
- 是否有 packet 从该角色发出。

### packet 看不到

检查：

- `PI_COMS_DIR` 是否一致。
- `project` 名称是否一致。
- packet 的 `mission_id` 是否等于 active Mission。
- recipient role 是否正确。
- body 是否为空。

### 不确定能不能让角色写文件

先看 Mission card 里的 `allowed_paths` 和 `forbidden_actions`。默认只有 `repair` 能在 allowed paths 内写业务文件，其他角色应当 read-only。

### 想清理本地测试状态

优先使用插件提供的 cleanup 或按测试 run root 精确删除。不要用宽泛进程清理命令误伤其他 Pi 会话。

## 10. 当前未承诺事项

以下能力不是 v0.5 已验证承诺：

- package hub 发布 / 安装链路。
- HTTP/SSE transport。
- 真实跨机器 transport。
- 自动关闭所有真实 Pi/Ghostty 测试窗口的通用保证。
- 不经 owner gate 的自动角色 mesh 展开。

这些项目应继续作为 v0.6 或后续发布前 checklist 的一部分处理。
