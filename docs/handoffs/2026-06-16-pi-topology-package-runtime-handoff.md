# Pi Topology Package 运行时交接

日期：2026-06-16
项目：Pi拓扑网络 / `packages/pi-topology`
交接目的：新开一个 Codex session，继续处理 `pi-topology` 在真实 Pi + Ghostty dogfood 中暴露的运行时问题，重点是 session mesh 稳定性、报告工作流、消息流治理。

## 1. 当前状态

当前 package 已经是可安装、可本地测试的 Pi package：

```text
/Users/yuantian/Documents/Coding/Pi-topology-network/packages/pi-topology
```

本轮结束时已确认：

1. `pi install .` 可成功安装。
2. `/topology` 已改成永远引导启动 `topology-supervisor`，不再把 HQ 作为首入口。
3. Supervisor 可见，且能在真实 Ghostty 中启动后续 session。
4. topology footer/widget 已恢复到更接近 Coms 的风格：
   - 彩色角色标识
   - `live/launch/idle/stale` 状态可视化
   - context 百分比与容量条
5. 长报告工作流已从“inline 大段文本”切到 artifact 模式：
   - `topology_write_artifact`
   - `topology_read_artifact`
6. `topology_status` / `topology_doctor` 的一次新 bug 已修复：
   - 原因是 `sessions.jsonl` 被错误当成 log file
   - 现在 session ledger 解析具备脏行容错
   - `log_path` 会自动净化，禁止写进 `.json` / `.jsonl` 状态文件

## 2. 最新已修复问题

### 2.1 `topology_status` / `topology_doctor` JSON 解析崩溃

用户报错：

```text
topology_status
Unexpected token 'o', "[topology] l"... is not valid JSON
```

根因已确认：

- 真实项目：
  `/Users/yuantian/Documents/Coding/ekunCustomsWms/.pi/topology/sessions.jsonl`
- 被写入了这些非 JSON 行：

```text
[topology] launch 2026-06-16T07:03:36Z role=runner
[topology] launch 2026-06-16T07:03:36Z role=oracle
[topology] launch 2026-06-16T07:03:36Z role=hq
```

- runtime-events 证据显示当时 `log_path` 被错误传成了：

```text
/Users/yuantian/Documents/Coding/ekunCustomsWms/.pi/topology/sessions.jsonl
```

代码修复：

1. `readJsonl` 改成跳过坏行，不再因一条脏日志导致整轮中断。
2. `countJsonl` 改为基于容错版 `readJsonl`。
3. `topology_spawn_role` 新增 `resolveRoleLogPath(...)`：
   - 如果传入 `.json` / `.jsonl`
   - 或命中 `mission-card.json` / `status-board.json` / `runtime-events.jsonl` / `incident-log.jsonl` / `sessions.jsonl`
   - 自动回退到默认安全路径，例如：
     `.pi/topology/runner.log`

测试已补：

- malformed session ledger 容错
- unsafe `log_path` 自动净化

### 2.2 报告工作流权限冲突

上一轮出现的问题：

- Runner / Oracle / HQ 没有 generic `write/edit`
- 但 prompt 又要求“报告写文件”
- 结果模型试图走 generic `write/read`，触发红色权限报错

修复方案：

- 不开放 generic `write/edit` 给 read-only 角色
- 改为受控报告工具：

```text
topology_write_artifact
topology_read_artifact
```

它们只允许访问：

```text
.pi/topology/artifacts/<role>/
```

Prompt 已同步：

- 写报告必须用 `topology_write_artifact`
- 读 `artifact_path` 必须用 `topology_read_artifact`
- 禁止用 generic `read/write/edit` 处理报告

## 3. 当前用户反馈中“还没完全收口”的问题

### 3.1 `stale` 状态的展示

截图：

```text
/var/folders/vq/dk3gntzd7dz529mp_57ybgyh0000gn/T/codex-clipboard-dc42b905-f0bf-4f91-a6ac-76c25fa8fa68.png
```

当前实现里：

- `idle` = 从未启动 / 没有 live 记录
- `live` = 当前 heartbeat 确认仍在
- `launch` = 已请求启动但未确认 alive
- `stale` = 历史上 live 过，但当前 heartbeat 已过期 / 本轮未重新确认

这在状态机语义上是成立的。

但用户反馈的关注点不是“有没有语义”，而是：

- 初始 dashboard 里 `stale` 的视觉权重太像错误
- 用户更关心它是否应当出现在当前起始视图

建议下一 session 处理：

1. 降低 `stale` 的视觉强度：
   - dim / warning
   - 不用强红
2. 考虑在 supervisor 首轮 preflight 后，如果 mission 是新轮次，可把历史 stale 折叠或隐藏。

### 3.2 消息流治理还没有进入“任务链路”模式

用户的真实意图不是简单 role-to-role 白名单，而是：

- session 应有自主性
- HQ 更像 PM / merge layer
- 某个执行者可以基于当前 slice 去请求下游协作
- 下游结果应回复给发起它的人，不一定总是回 HQ

也就是说，后续需要的不是“所有包都只能发给 HQ”，而是：

```text
request lineage
authority_source
slice ownership
expected return target
dependency chain
```

当前 package 还没实现这个层次。

## 4. 当前代码层面的限制情况

这是下一 session 需要明确继承的现状。

### 4.1 已有硬限制

1. Runner / Oracle / Librarian / Scott 默认没有 generic `write/edit`。
2. 非 repair 的 shell 写操作会被 guard 拦截。
3. `topology_await` 不在自动派生角色工具列表里。
4. 角色可使用：
   - `topology_send`
   - `topology_write_artifact`
   - `topology_read_artifact`
   - `topology_get`
   - `topology_list`

### 4.2 还没有的硬限制

还没有代码级 route policy。也就是说：

- 角色之间仍可以技术上相互 `topology_send`
- 只是 prompt 在约束它们应该怎么做

下一 session 如果继续推进消息流治理，建议方向是：

1. 在 packet schema 或 send guard 中加入：
   - `slice_id`
   - `authority_source`
   - `reply_target`
   - `requested_by`
2. 做 mission-aware routing contract，而不是一刀切白名单。

## 5. 真实项目证据位置

当前 dogfood 项目：

```text
/Users/yuantian/Documents/Coding/ekunCustomsWms
```

拓扑 runtime 痕迹：

```text
/Users/yuantian/Documents/Coding/ekunCustomsWms/.pi/topology/
```

重点文件：

```text
mission-card.json
status-board.json
runtime-events.jsonl
sessions.jsonl
incident-log.jsonl
launch/
hq.log
runner.log
oracle.log
runner-artifacts/
```

这轮特别关键的证据：

- `sessions.jsonl` 第 25-27 行有脏日志
- `runtime-events.jsonl` 第 76-81 行记录了错误的 `log_path=sessions.jsonl`

## 6. 当前测试结果

截至本交接文档写入时：

```text
npm test -- --runInBand
54 / 54 passed
```

```text
npm run smoke
passed
```

```text
pi install .
Installed .
```

也就是说：**仓库内 package 状态和本地 Pi 安装状态已经同步到最新修复。**

## 7. 下一 session 的优先级建议

建议严格按这个顺序推进：

1. 先继续真实 Ghostty / Pi 测试
   - 确认 `topology_status` / `topology_doctor` 不再因 `sessions.jsonl` 脏行中断
   - 确认 artifact workflow 不再触发 generic read/write 红色报错
2. 收口 `stale` 的展示策略
   - 不是先删状态机语义
   - 而是先优化视觉和初始视图的认知负担
3. 开始设计消息流 contract
   - 不要直接上“只准回 HQ”的白名单
   - 转向 slice-aware task chain / request lineage

## 8. 建议给新 Codex session 的启动提示

新 session 可以直接读这几个文件：

```text
/Users/yuantian/Documents/Coding/Pi-topology-network/docs/handoffs/2026-06-16-pi-topology-package-runtime-handoff.md
/Users/yuantian/Documents/Coding/Pi-topology-network/packages/pi-topology/src/extension/tools.ts
/Users/yuantian/Documents/Coding/Pi-topology-network/packages/pi-topology/src/extension/ui.ts
/Users/yuantian/Documents/Coding/Pi-topology-network/packages/pi-topology/src/runtime/spawn.ts
/Users/yuantian/Documents/Coding/ekunCustomsWms/.pi/topology/runtime-events.jsonl
/Users/yuantian/Documents/Coding/ekunCustomsWms/.pi/topology/sessions.jsonl
```

推荐启动语：

```text
继续处理 pi-topology 的真实运行时稳定性。先基于 runtime handoff 和 ekunCustomsWms 的 .pi/topology 证据，验证新修复的 session ledger 容错与 artifact workflow 是否在真实 Ghostty dogfood 中生效；随后收口 stale 状态展示，再开始设计 slice-aware 消息流 contract。
```

