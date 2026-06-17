# 安装与接入（本地）

本页只写 **本地可操作** 的 install/use 流程。未明确标注为“已验证”前，不要当成生产可用承诺。

## 1. 检查 package 能力声明

`packages/pi-topology/package.json` 中关键字段：

- `pi.extensions: ["./index.ts"]`
- `pi.skills: ["./skills"]`

含义：

- Pi runtime 通过 `index.ts` 注册工具/命令；
- `skills` 作为包级技能入口纳入 Pi 的 discover 机制。
- 扩展还会在官方 `resources_discover` 事件中返回本包 `skills` 目录，用于覆盖 `pi -e ./index.ts` 这类开发期加载时 package manifest 未必完整生效的情况。

## 2. 本地加载方式（推荐）

在当前仓库路径直接测试时，优先用开发期加载而非强制发布链路：

- 命令行指定扩展入口。
- 先在目标会话设置 `PI_COMS_DIR`（或接受默认 `/tmp/pi-topology-<project>`）。

示例（示意）：

```bash
PI_COMS_DIR=/tmp/pi-topology-<project> \
pi -e packages/pi-topology/index.ts --cname topology-supervisor --project <project>
```

其中 `-e` 指向本包扩展入口，`--project` 与 `project` 名称将决定 registry/状态文件归属。

本地 package 安装链路已在 2026-06-16 验证：

```bash
cd packages/pi-topology
pi install .
```

期望输出：`Installed .`

开发期裸 `pi -e .../packages/pi-topology/index.ts` 验证时，`topology-runtime` skill 应通过 `resources_discover` 暴露；若出现 `/skill:topology-runtime` 去 `~/.pi/agent/skills/topology-runtime/SKILL.md` 查找的 ENOENT，先确认当前扩展代码是否已重新加载。

## 3. 典型启动序列

1. 先输入 `/topology`。如果已有 mission，它会显示状态；如果上一条 assistant 回复像任务卡，它会自动建立 mission draft；否则进入 intake/preflight。
2. 如果还没有可用任务卡，直接输入 `/topology <任务目标或任务卡>` 建立 mission card（含 owner objective / progress / allowed_paths / forbidden_actions）。
3. 输入 `/topology status` 或 `/topology doctor` 确认状态板进入 `mission_approval` / intake owner gate。
4. owner 确认要展开网状 session 后，再使用 `/topology spawn hq` 作为 HQ 扩展检查点，随后通过 `topology_spawn_role` 启动真实 HQ session。

`init` 和 `spawn hq` 的区别：

- `/topology <任务目标或任务卡>` / `init`：在当前 session 写入 mission/status/runtime/session-ledger/launch 证据，表示“这次目标模式成立”。
- `spawn hq`：在 mission 已明确后扩展 mesh，启动独立 HQ 协调角色；它不应替代任务卡确认。

## 4. 常用命令

- `/topology`：智能入口，恢复已有 mission，或从上一条 assistant 任务卡自动创建 mission draft
- `/topology <任务目标或任务卡>`：从 slash command 创建 mission/status/runtime-events/session-ledger/launch scripts
- `/topology init <任务卡>`：兼容/显式形式，行为等同于直接给 `/topology` 传任务正文
- `/topology status` / `/topology-status`：查看当前 mission paths 与 owner gate
- `/topology doctor`：只读 mission validation + watchdog summary
- `/topology packets`：查看最近 local outbox packets
- `/topology spawn hq`：解释并检查 HQ 扩展门，不自动跳过 owner gate
- `topology_init_mission`：初始化 mission card 与运行状态
- `topology_status`：查看 mission/state/peers/health/sla
- `topology_doctor`：执行看门狗与健康校验，输出异常与建议
- `topology_smoke`：MVP 冒烟命令（用途：快速验证 package 基础能力）
- `topology_spawn_role`：基于 mission card 生成/启动 HQ、repair、runner、oracle、librarian、scott 的真实 Pi 角色 session；支持 `initial_prompt` 与 `log_path`
- `topology_send`：发送结构化 local packet，并写入 runtime event
- `topology_get`：非阻塞读取某个 role inbox 中的 packet
- `topology_list`：非阻塞列出某个 role inbox 中的 packets
- `topology_cleanup`：清理会话间状态残留（用于本地复位）

## 5. 本地 transport 约定

- 默认传输是 local-coms（JSONL replay）。
- 出站包文件：`<transport_root>/projects/<project>/packets/outbox.jsonl`
- 角色 inbox：`<transport_root>/projects/<project>/packets/<role>-inbox.jsonl`
- peer 注册：`<transport_root>/projects/<project>/agents/<name>.json`
- 状态持久化：`.pi/topology/*.json` 与 `.pi/topology/*.jsonl`
- 派生 session 索引：`.pi/topology/sessions.jsonl`，记录 `script_written` / `launch_printed` / `launch_requested` 等工程状态；`session_id: null` 表示尚未被真实 role session 自证 alive。

## 6. 运行前置与限制

- 先确认 node 运行、Pi CLI、当前会话有目标项目写权限。
- 真实 HTTP/SSE transport 仅作为兼容目标。
- Hub 发布目前不作为已验证结论。
- 默认真实 role smoke 使用 MiniMax M3：`--provider minimax-cn --model MiniMax-M3 --thinking low`。
- 2026-06-16 已完成 MiniMax M3 + Ghostty clean dogfood：
  - run root: `/tmp/pi-topology-dogfood-minimax-clean-2026-06-16`
  - supervisor / spawned HQ / six role logs are under that run root's `logs/`
  - local outbox and runtime events are under the same run root
- 2026-06-17 当前 Mac 环境补充：
  - `launch_requested` 只表示终端 app 被请求打开脚本，不是 role alive 证据。
  - 本机 `open -n -a Ghostty --args -e ...` 会出现 failed-command window / abnormal-process log；简单 `touch` marker 可能延迟出现，但该 GUI lane 不能作为当前 E2E gate。
  - 当前本地验收使用 direct generated script lane：先检查 `hq.sh` 的 MiniMax lock，再在当前 terminal 直接执行脚本并用 sessions/status/runtime/log/packet 证据证明 `alive_confirmed`。
- 如需不出站本地验证，可使用 `PI_OFFLINE=1`；这只证明本地 Pi 工具和状态面，不证明第三方 provider 下的 Ghostty role dogfood。
- smoke scripts 默认不再在 Ghostty 中等待 Enter；需要保留窗口时设置 `PI_TOPOLOGY_WAIT_ON_EXIT=1`。
- 建议先在临时目录跑最小任务，确认：
  - mission card 可写
  - status board 可读
  - incident log 有 event 记录
  - 发送/读取 packet 路径可重放
- 权限门禁可用：

```bash
cd packages/pi-topology
npm run guard-smoke
```

该 smoke 直接触发 extension `tool_call` hook，写入 `/tmp/pi-topology-guard-smoke/.pi/topology/incident-log.jsonl` 与 `runtime-events.jsonl`。真实 Pi offline runner 写文件尝试可能因为没有可用 file-writing tool 而无法触发 hook，不能替代该 guard smoke。

本地开发包改动后，使用：

```bash
cd packages/pi-topology
pi install .
```

对当前这种相对路径开发安装，`pi install .` 是刷新本地 package 的可靠方式。`pi update` 更适合已登记/已发布来源的更新，不应作为确认工作区源码改动生效的主要手段。
