# Pi Topology Native Alignment Devlog

日期：2026-06-16
项目：OMP拓扑网络 / `packages/pi-topology`
模式：边审计边减重

## 11:00 - 启动

目标：

- 把 `pi-topology-network` 尽量收回 Pi 原生 extension / package / session 能力。
- 非必要不新增轮子。
- 先解决最伤 token 的控制面重放问题。

依据：

- Pi 官方文档：
  - [Extensions](https://pi.dev/docs/latest/extensions)
  - [Packages](https://pi.dev/docs/latest/packages)
- 本地 transcript：
  - Supervisor `2026-06-16T11-11-37-457Z`
  - HQ `2026-06-16T11-14-25-772Z`

## 11:05 - 审计结论摘要

确认的高优先问题：

1. inbound packet 默认 `triggerTurn: true`，导致 terminal ACK / VERDICT 也进 LLM。
2. 缺少 `promptSnippet / promptGuidelines`，工具边界没有借助 Pi 原生工具提示前置。
3. duplicate / idempotent closure 没有在 runtime 吃掉，继续把旧包交给模型解释。
4. `list/get/await` 会把同一 packet 正文反复打进 transcript。

## 11:10 - 蓝图落库

已创建：

- `docs/12-pi-topology-native-alignment-blueprint.md`
- `records/2026-06-16-pi-topology-native-alignment-devlog.md`

执行策略：

1. 先补测试。
2. 先减控制面 token，再谈更深层 native session 收拢。
3. 保留审计证据，但不再把所有证据都变成 LLM turn。

## 待续

下一步进入测试与代码改动阶段。

## 11:20 - 第一波实现完成

本轮已落地的减重改动：

1. 为全部 `topology_*` 工具补上 `promptSnippet / promptGuidelines`
2. 新增 session 内 packet memory，用于：
   - 记录已见 packet
   - 记录已闭环 packet
3. inbound packet 现在先走原生 `appendEntry("topology-packet", ...)`
4. 只有 actionable packet 才继续 `sendMessage(... triggerTurn: true)`
5. 以下 packet 默认不再唤醒新 turn：
   - `ACK`
   - `VERDICT` with `next=stand_down`
   - idempotent `STATUS`
   - duplicate packet
6. 发送 `ACK` 时会把 `received_packet_id` 记为已闭环，后续再收到同 packet 可直接 no-op

本轮刻意没动的重结构：

- 没有强切 `topology_spawn_role` 到 `ctx.newSession / fork / switchSession`
- 没有删掉 mission/status/event/session ledger 文件
- 没有重写 local-coms transport

原因：

- 先把最伤 token 的“控制包进模型”切掉，收益最大，回归风险最小。

## 11:25 - 新增测试

新增/强化的回归覆盖：

1. `topology_*` 工具注册时必须带原生 prompt metadata
2. actionable inbound packet 仍会正常唤醒 follow-up turn
3. terminal / duplicate inbound packet 不再唤醒 follow-up turn

测试文件：

- `packages/pi-topology/test/unit/extension.test.ts`

## 11:30 - 局部验证

已运行：

```bash
node --experimental-strip-types --test packages/pi-topology/test/unit/extension.test.ts
```

结果：

- 21/21 通过
- 重点新用例通过：
  - actionable inbound wakes session
  - terminal / duplicate inbound stays append-only
  - tool prompt metadata present

## 待续

下一步跑 `packages/pi-topology` 的完整 smoke，并把结果写回本记录。

## 11:40 - 完整验证完成

已运行：

```bash
cd packages/pi-topology
npm run smoke
```

结果：

- `node --experimental-strip-types --test test/unit/*.test.ts`
  - 61/61 通过
- `node --experimental-strip-types -e "await import('./index.ts')"`
  - 通过
- `npm pack --dry-run`
  - 通过

新增验证信号：

1. 核心减重行为已进单元测试，不只靠 transcript 肉眼判断
2. terminal / duplicate inbound packet 的 append-only 分流未破坏现有 package smoke
3. tool prompt metadata 补齐后不影响打包与加载

## 当前收获

这一轮已经把最明显的 token 浪费口子先堵住一批：

- packet 不再默认“来一条就唤醒整轮 LLM”
- duplicate / terminal control packet 可以只落原生 entry，不再强迫 Supervisor / HQ 写长篇 closeout prose
- tool 使用边界前移到 Pi 原生 prompt metadata，而不是继续堆 role prompt 和 transcript

## 11:55 - 设计方向纠偏

根据人工测试和架构讨论，确认：

1. “轻量”不等于 terminal replacement。
2. 真正的轻量目标是：
   - 少 inline
   - 少重复 packet
   - artifact-first
   - 局部闭环后再上卷
3. 保留可见性 Mesh 比引入单 terminal native handoff 更重要。

因此本轮后续改为：

- 撤回 native replacement 主路径
- 恢复 Supervisor 作为唯一默认 human-facing 窗口
- 保留 HQ/Runner/Oracle/Repair 的 visible peer session 模型
- 把重点放在 `topology_get/list` 的紧凑化与 packet routing 语义

## 12:05 - Mesh 回推实现

已完成：

1. 删掉 replacement 主路径，不再让 `/topology spawn hq` 进入 native session handoff
2. `/topology spawn hq` 回到 visible mesh guidance：Supervisor 保持当前窗口，后续由 Supervisor 调用 `topology_spawn_role`
3. `topology_list` / `topology_get` 改为 compact-by-default
   - 默认只输出 packet 摘要
   - 摘要优先展示 `summary / verdict_summary / verdict / status / task / note`
   - 如有 `artifact_path`，直接提示
   - 只有显式 `verbose=true` 才回 JSON
4. 把这轮 Mesh routing 与 artifact-first 设计写进文档

新增测试：

1. `/topology spawn hq` 返回 visible mesh guidance，而不是 native replacement
2. `topology_list/get` 默认 compact 输出，不回放整块 packet JSON

## 12:10 - 最终验证

已运行：

```bash
node --experimental-strip-types --test packages/pi-topology/test/unit/extension.test.ts
cd packages/pi-topology && npm run smoke
```

结果：

- `extension.test.ts`: 23/23 通过
- package 全量 smoke：63/63 通过，`typecheck` 通过，`npm pack --dry-run` 通过

## 12:20 - registry/live-first 修正

针对人工测试暴露的两个问题继续修正：

1. ghost HQ 被 dashboard 误判为 live
2. `/topology spawn hq` 只给 guidance，不真正发起 HQ launch

本轮改动：

1. `transport/registry.ts`
   - 新增 fresh registry 读取
   - 新增 heartbeat freshness 判断
   - 新增 heartbeat refresh 写回
2. `extension/register.ts`
   - heartbeat 周期会同步刷新 peer registry
3. `extension/ui.ts`
   - Dashboard 改成 live-registry-first
   - 默认只显示：
     - 当前 session
     - heartbeat 新鲜的真实 live peer
     - 必要时的 `launch_requested`
4. `extension/commands.ts`
   - `/topology spawn hq` 在 Supervisor 当前窗口内真正触发 visible mesh launch
   - 仍不 replacement 当前 terminal
5. `extension/tools.ts`
   - `topology_list/get` 继续保持 compact-by-default

新增/更新测试：

1. UI 不再预列出不存在的 peer
2. stale peer 不再因旧 `alive_confirmed` 自动亮成 live
3. `/topology spawn hq` 真正发起可见 HQ 派生，而不是只返回 guidance

## 12:25 - 三次验证

已运行：

```bash
node --experimental-strip-types --test packages/pi-topology/test/unit/ui.test.ts
node --experimental-strip-types --test packages/pi-topology/test/unit/extension.test.ts
cd packages/pi-topology && npm run smoke
```

结果：

- `ui.test.ts`: 4/4 通过
- `extension.test.ts`: 23/23 通过
- package 全量 smoke：64/64 通过，`typecheck` 通过，`npm pack --dry-run` 通过

## 13:20 - 官方 API 复核与 skill discovery 修正

根据人工测试，裸 `/topology` / `/skill:topology-runtime` 曾出现退回全局 skill 路径的失败：

- 失败路径：`~/.pi/agent/skills/topology-runtime/SKILL.md`
- 实际期望：使用 package 内置 skill：`packages/pi-topology/skills/topology-runtime/SKILL.md`

复核的官方文档：

- [Sessions](https://pi.dev/docs/latest/sessions)
- [Extensions](https://pi.dev/docs/latest/extensions)
- [Skills](https://pi.dev/docs/latest/skills)
- [Packages](https://pi.dev/docs/latest/packages)

确认结论：

1. `pi install` 目录包会按 package manifest / conventional `skills/` 规则加载 skill。
2. `pi -e ./index.ts` 是开发期单 extension 加载，不等同于按目录 package 规则加载全部资源。
3. 官方 `resources_discover` 事件就是 extension 追加 `skillPaths / promptPaths / themePaths` 的入口。
4. 因此本插件应同时保留 `package.json` 的 `pi.skills`，并在 extension 层返回 package skill path。

本轮改动：

1. `extension/register.ts`
   - 注册 `pi.on("resources_discover", ...)`
   - 返回 `packages/pi-topology/skills`
2. `test/unit/extension.test.ts`
   - 新增回归测试，确保 extension 注册 `resources_discover`
   - 确保返回的 `skillPaths` 包含 package skill 目录
3. `docs/12-pi-topology-native-alignment-blueprint.md`
   - 补充官方 API 复核追加结论
4. `packages/pi-topology/docs/install.md`
   - 记录 `pi install` 与 `pi -e` 两条加载路径的区别

TDD 记录：

```bash
node --experimental-strip-types --test packages/pi-topology/test/unit/extension.test.ts
```

RED：

- 新增 `resources_discover` 用例失败，原因是 handler 未注册

GREEN：

- 注册 `resources_discover` 后，`extension.test.ts` 25/25 通过

真实 Pi 验证：

```bash
PI_OFFLINE=1 pi --offline --no-session -e /Users/yuantian/Documents/Coding/omp-topology-network/packages/pi-topology/index.ts --approve
```

在 TUI 中输入：

```text
/skill:topology-runtime
```

结果：

- Pi 显示 `[skill] topology-runtime`
- skill location 指向 `/Users/yuantian/Documents/Coding/omp-topology-network/packages/pi-topology/skills/...`
- 未再出现 `~/.pi/agent/skills/topology-runtime/SKILL.md` ENOENT
- 响应中能列出 `/topology` 与 `topology_*` 工具入口

关于“内置选择 UI”和“让我输入 1/2/3”的区别：

- 如果扩展代码调用 `ctx.ui.select / confirm / input` 或 `ctx.ui.custom()`，那是 Pi 官方 TUI 交互，属于确定性的 extension 行为。
- 如果 Supervisor bootstrap 后模型在普通 assistant turn 里写出“选 1/2/3”，那是模型按 prompt 生成的文本流程，不是官方选择控件。
- Pi 自带 `/tree` 切换分支时也可能出现 1/2/3 branch summary 选择，但这属于 session 树功能，不是 topology supervisor 第一步的自定义 UI。

当前建议：

- 默认启动继续保持 follow-up bootstrap，减少过早复杂化。
- 真正需要 owner gate / phase gate 时，再把选择点升级为 `ctx.ui.select` 或 `ctx.ui.custom` overlay。
- Dashboard / footer 继续使用官方 `ctx.ui.setStatus / setWidget`。

## 剩余重构面

下一批仍值得继续做，但不在本次已完成范围内：

1. `topology_spawn_role` 从外部脚本/外部终端迁移到 Pi 原生 session API
2. `topology_list/get/await` 的正文重放继续压缩
3. `session_ledger` 从“事实来源”降为“审计索引”
4. UI/entry/log 三层状态的进一步收敛

## 本轮收口

蓝图、实现、测试、devlog 已同步完成。

## 22:20 - 裸 `/topology` 启动退出修复

用户复测反馈：裸 `/topology` 仍会直接退出 Pi。

复现证据：

- transport evidence：用真实 Pi 进程运行 `PI_OFFLINE=1 pi --offline -e packages/pi-topology/index.ts --approve`，输入裸 `/topology` 后等待后台心跳窗口。
- business evidence：`/topology` 已能把当前 session 接管为 `topology-supervisor` 并渲染 topology widget。
- inference：Pi 退出不是 slash command intake 失败，而是接管后 5 秒心跳定时器触发未捕获异常。

根因：

- `extension/register.ts` 中 `heartbeatTopologySession()` 是模块级函数，却直接引用了 `registerPiTopology()` 内部局部变量 `liveEndpoint`。
- smoke/unit tests 之前只覆盖了启动同步路径，没有触发真实运行中的定时器回调，所以漏掉了 `ReferenceError: liveEndpoint is not defined`。

修复：

1. `extension/register.ts`
   - heartbeat 定时器调用 `heartbeatTopologySession(...)` 时显式传入当前 `liveEndpoint`。
   - `heartbeatTopologySession()` 不再隐式读取外层局部变量。
2. `extension.test.ts`
   - 新增 `session_start heartbeat refreshes live registry without crashing Pi`。
   - 测试通过截获 `setInterval` 回调直接触发 heartbeat，覆盖裸 `/topology` 启动后才会出现的异常路径。

验证：

```bash
node --experimental-strip-types --test packages/pi-topology/test/unit/extension.test.ts
cd packages/pi-topology && npm run smoke
PI_OFFLINE=1 pi --offline -e /Users/yuantian/Documents/Coding/omp-topology-network/packages/pi-topology/index.ts --approve
```

结果：

- `extension.test.ts`: 24/24 通过
- package 全量 smoke：65/65 通过，`typecheck` 通过，`npm pack --dry-run` 通过
- 真实 Pi 裸 `/topology` 等过 5 秒心跳窗口后未再出现 `uncaughtException`，进程没有因旧 `ReferenceError` 退出

备注：

- 真实 Pi 验证会触发当前项目 `.pi/topology` 的 runtime 状态读写；该副作用仅作为本轮 transport/business evidence，不视为新的协议事实。
