# Pi Topology Package 目标模式交接

日期：2026-06-16
项目：Pi拓扑网络 / `Pi-topology-network`
交接目的：新开一个 Codex session，使用目标模式，把当前 topology 从项目内协议/草稿 runtime 推进为成熟 Pi package。

## 1. 术语说明：狗粮

“狗粮”来自英文 dogfooding / eat your own dog food。

在本项目语境里，它的意思是：我们自己先在真实开发项目里使用自己做的 topology package，让它真实承担开发协作、session 通信、权限控制、状态监控和验证闭环。只有经过这种自用压测，才继续考虑开源、发布到 GitHub 或 Pi package Hub。

## 2. 当前最新共识

Pi 是下一阶段主攻 runtime。OMP 是历史验证面和兼容参考，不是本轮产品化主线。

本轮目标不是继续修补 `pi-vs-cc` 里的零散 extension，而是把 topology 正式做成一个可安装、可狗粮、可开源、未来可发布到 Pi package Hub 的 Pi package。

理想架构是双层模型：

1. 第一层：真实 Pi session mesh。
   - topology-supervisor / governor、HQ、repair、runner、oracle 等角色都是真实 Pi session。
   - 它们通过 Coms / Coms Net 类通信 substrate 互相发现、发 packet、回报状态、记录事件。
   - 这些 session 应该是一等公民，而不是中心化 parent process 下的一次性 worker。

2. 第二层：每个真实 Pi session 自己仍可使用 Pi 的 subagent / package 能力。
   - 例如 HQ 可以局部调用短任务 worker 做研究、总结、验证。
   - repair 可以局部派生轻量 subagent 做代码探查。
   - 这层是节点内部执行能力，不是 topology 主编排模型。

## 3. 关于 Coms / Coms Net 的判断

Coms 不是 Pi 原生官方 session bus，而是基于 Pi extension API 创作出来的通信层。

当前本地参考实现：

```text
/Users/yuantian/Documents/Coding/pi-vs-cc/extensions/coms.ts
/Users/yuantian/Documents/Coding/pi-vs-cc/extensions/coms-net.ts
```

`coms.ts` 的核心机制：

- 同机 peer-to-peer 通信。
- POSIX 使用 Unix socket，Windows 使用 named pipe。
- 通过 `~/.pi/coms/projects/<project>/agents/<name>.json` 做 peer registry。
- 提供 `coms_list` / `coms_send` / `coms_get` / `coms_await`。
- 通过 `agent_end` 捕获普通 assistant final text，自动作为 inbound prompt 的 response 提交。

`coms-net.ts` 的核心机制：

- HTTP/SSE hub 版本。
- 提供 server URL、auth token、heartbeat、SSE inbound。
- 更适合跨进程/跨机器/未来 UI 监控。

当前倾向：不要在 Coms 上面无限叠层。更好的做法是把 Coms / Coms Net 的核心代码吸收到 topology package 里，作为 topology transport 模块进行改造和加强。最终命名由实现者决定，但建议避免让用户感知太多层级。

可选命名：

```text
topology-local-coms
topology-net-coms
topology-transport
topology_send / topology_get / topology_list / topology_status
```

必须保留和加强：

- peer registry
- heartbeat / context health
- msg_id / packet_id
- non-blocking get
- structured packet
- audit event
- hop policy
- inbound response capture

必须避免：

- 把长任务完成依赖 `await`。
- 把原 `msg_id` direct reply 当成业务报告通道。
- 让横向通信传递权限。

## 4. pi-crew 探查结论

本地已克隆：

```text
/Users/yuantian/Documents/Coding/Pi-topology-network/sources/external/pi-crew
```

已用 GitNexus 分析过。关键结论：

- pi-crew 很成熟，但核心是中心化任务编排。
- `team run` 由 parent/orchestrator 控制 task graph、batch、hooks、retries、status。
- child Pi worker 不是 topology 所需的一等公民 session。
- child-process runtime 默认 `resume: false`，worker 生命周期由 parent 拥有。
- 它有 transcript/status/event/manifest 等优秀基础设施，但不是 mesh runtime。

建议从 pi-crew 借鉴：

- Pi package 结构：`package.json` 的 `pi.extensions`、`pi.skills`、peerDependencies、files、CI。
- extension 入口：`index.ts` 接收 `ExtensionAPI`，注册工具/命令/事件。
- lazy import：避免 session 启动时加载重 runtime。
- state 体系：manifest、event log、active registry、health store、crash recovery。
- security 体系：safe paths、sensitive paths、role permission、tool_call guard、worktree isolation。
- UI 体系：status、widget、powerbar/footer、紧凑展示。
- doctor/status/cleanup/import/export 类工具面。

不建议直接复用为主架构：

- `team-runner.ts`
- `task-graph-scheduler.ts`
- 中心化 parent -> child worker 编排模型。

一句话：pi-crew 是可复用的任务基础设施参考，topology 是 Pi session mesh governance package。

## 5. 已有 topology runtime 草稿

当前已有草稿在：

```text
/Users/yuantian/Documents/Coding/pi-vs-cc/extensions/topology-runtime.ts
/Users/yuantian/Documents/Coding/pi-vs-cc/extensions/topology-runtime-core.ts
/Users/yuantian/Documents/Coding/pi-vs-cc/tests/topology-runtime-core.test.ts
```

它已实现过：

- `topology_init_mission`
- `topology_status`
- `topology_watchdog`
- `topology_spawn_role`
- mission card
- status board
- incident log
- runtime event log
- dynamic spawn 初版

它的问题：

- 仍依附 `pi-vs-cc`。
- harnessRoot、role prompt、damage-control、theme、Coms 路径都有草稿期硬编码。
- 不是独立 package。
- 未完成成熟 mission-aware hard guard。
- 未完成 package 安装、发布、开源结构。

新 session 应该把这部分作为原型迁移和重构，不要把它当最终代码。

## 6. 本轮目标定义

目标：创建一个成熟的 Pi package 形态，可以本地安装到 Pi，并用于真实项目狗粮。

建议 package 名称二选一：

```text
pi-topology
pi-topology-network
```

建议先在当前仓库内开发，目录可由实现者决定，例如：

```text
packages/pi-topology/
```

成熟 MVP 验收：

1. `pi install .` 或等价本地安装方式可用。
2. package 通过 `package.json` 的 `pi.extensions` 注册入口。
3. 打开第一个 Pi session 后，它能作为 topology-supervisor / governor 入口。
4. supervisor 先进行项目 intake，而不是立即派生 worker。
5. supervisor 能根据用户目标创建 mission card。
6. mission card 包含 workdir、objective、allowed_paths、forbidden_actions、roles、stop_conditions。
7. 用户确认 mission 后，能动态派生 HQ / repair / runner / oracle 等真实 Pi session。
8. 各 session 通过 topology transport 通信，使用结构化 packet。
9. 原 `msg_id` direct reply 只允许 ACK 或短功能响应，业务报告走结构化 packet。
10. repair 写入受 allowed_paths 和 role guard 限制。
11. runner / oracle / reviewer 类角色默认 read-only。
12. 有 status/footer/widget 展示 session 健康、上下文、pending packet、incident。
13. 有 doctor / smoke / cleanup / status 等操作面。
14. 有测试覆盖 core runtime、mission schema、guard、packet rules。
15. README 清楚说明安装、使用、限制、未实测能力。

## 7. 建议工程结构

建议结构：

```text
packages/pi-topology/
  package.json
  index.ts
  src/
    extension/
      register.ts
      commands.ts
      tools.ts
      ui.ts
    runtime/
      mission.ts
      status-board.ts
      packet.ts
      watchdog.ts
      spawn.ts
      guard.ts
    transport/
      local-coms.ts
      net-coms.ts
      registry.ts
      response-capture.ts
    roles/
      role-policy.ts
      prompts.ts
    state/
      paths.ts
      event-log.ts
      incident-log.ts
      manifests.ts
    schemas/
      mission.schema.ts
      packet.schema.ts
      status.schema.ts
    utils/
      safe-paths.ts
      lazy.ts
  agents/
    topology-supervisor.md
    hq.md
    repair.md
    runner.md
    oracle.md
    shared-protocol.md
  skills/
    topology-runtime/SKILL.md
  docs/
    install.md
    dogfood.md
    package-hub-readiness.md
  test/
    unit/
    integration/
```

不要求完全照抄，但要保留这些边界：

- extension 注册层不要混入核心业务逻辑。
- runtime core 尽量可脱离 Pi 进程测试。
- transport 独立于 governance。
- guard 独立于 prompt。
- UI 只读 state，不反向承载决策。

## 8. 权限与执行授权

用户已明确授权新 session 在本轮目标模式中执行完成任务所需动作，包括但不限于：

- 在当前项目内创建/修改/移动 package 源码、测试、文档。
- 克隆任何需要参考的 Pi extension / Pi package / 多 agent 编排项目。
- 使用网络搜索和 GitHub 克隆调研 Pi package 结构。
- 使用 GitNexus / rg / AST / LSP 类工具做代码探查。
- 安装项目依赖。
- 运行 npm / bun / pnpm / tsc / test / pack / pi install / pi smoke。
- 读取本地 Pi 相关目录和 package 示例。
- 在必要时访问 `/Users/yuantian/Documents/Coding/pi-vs-cc` 读取和迁移参考代码。
- 在必要时启动本地 Pi session / Ghostty / package smoke。

注意：这份授权是 owner 语义授权。Codex / sandbox / macOS 仍可能要求系统级 approval。遇到这种情况，直接发起 `require_escalated`，justification 写明：

```text
用户已在 2026-06-16 handoff 中授权本轮目标模式克隆参考 Pi package、安装依赖、运行 Pi package smoke 或访问 Pi runtime 相关目录。
```

建议优先请求这些持久 prefix approval：

```text
["git", "clone"]
["npm", "install"]
["npm", "run"]
["npm", "pack"]
["bun", "install"]
["bun", "test"]
["bun", "run"]
["pi", "install"]
["pi", "-e"]
["/Users/yuantian/.nvm/versions/node/v22.22.2/bin/gitnexus"]
```

不要在未确认前执行破坏性动作：

- `rm -rf`
- `git reset --hard`
- `git clean -fd`
- 覆盖用户未提交业务代码
- 自动 commit / push

用户授权开发动作，不代表授权破坏性清理。

## 9. 推荐实施顺序

第一步：调研 package 结构。

- 读取 pi-crew `package.json`、`index.ts`、`src/extension/register.ts`。
- 再克隆 2-4 个 Pi package Hub 上的 extension package 参考结构。
- 输出 package 结构选择，不要陷入长篇架构论文。

第二步：创建 package skeleton。

- 建 `packages/pi-topology/`。
- 写 `package.json`、`index.ts`、`src/extension/register.ts`。
- 注册最小 `topology_status` / `topology_init_mission`。
- core runtime 先可单测。

第三步：迁移 runtime core。

- 从 `pi-vs-cc/extensions/topology-runtime-core.ts` 吸收 mission/status/watchdog/spawn plan。
- 去掉 harnessRoot 硬编码。
- role prompt 改为 package bundled agents。

第四步：吸收 transport。

- 从 `coms.ts` / `coms-net.ts` 提取必要核心。
- 优先本地可用，不急着跨机器。
- 改造成 topology packet-first。
- `await` 仅作为可选查询能力，不作为长任务主流程。

第五步：guard。

- tool_call 层实现 mission-aware guard。
- repair 只能写 allowed_paths。
- runner/oracle 默认 read-only。
- forbidden_actions 硬拦截或 owner confirm。
- incident log 记录所有 block/confirm。

第六步：UI / status。

- footer/widget 只展示短状态。
- 必须避免长内容无限渲染。
- 显示 mission、role、context health、pending packets、incidents。

第七步：dogfood smoke。

- 用一个小测试目录或当前项目模拟：
  - init mission
  - spawn role print
  - status
  - packet validation
  - guard block
  - watchdog
- 不要一上来就开 5 个长 session 压测。

第八步：文档和 closeout。

- README：安装/使用/架构/限制。
- dogfood runbook。
- package-hub readiness checklist。
- 记录未实测能力。

## 10. 必须保留的项目铁律

来自本项目 AGENTS.md：

- 收到入站任务时，先 direct final text ACK；不要用 `coms_send` 回 ACK。
- `coms_await` timeout 不等于 peer 没做，只能说明当前等待窗口未收到原 `msg_id` 回复。
- 横向通信只传信息，不传权限。
- governor / hq 才收口目标、授权、止损和最终 verdict。
- oracle 不修代码，repair 不审最终结论，runner 不改代码。
- 实践记录要区分 transport evidence、business evidence、inference。
- Pi 相关能力如果未实测，标为兼容目标或待接入，不写成已验证事实。

## 11. 当前不做或延后

本轮不需要实现 Web UI。

但事件模型必须面向未来 Web UI：

- graph nodes
- graph edges
- structured event log
- session health
- packet timeline
- incident timeline

本轮不需要做到 OS-level sandbox。

但需要做到 mission-aware tool guard：

- role-aware
- allowed_paths-aware
- forbidden_actions-aware
- owner confirmation-aware
- auditable

## 12. 新 session 开始提示

建议新 session 第一条用户消息可以是：

```text
请先阅读 /Users/yuantian/Documents/Coding/Pi-topology-network/docs/handoffs/2026-06-16-pi-topology-package-goal-handoff.md，然后开启目标模式，把 topology 正式做成成熟 Pi package。你拥有该 handoff 里列出的权限；遇到 sandbox approval 直接请求，不要反复问我架构方向。
```

新 session 读完后应先用短 ACK 确认理解，然后直接进入调研和实施。

