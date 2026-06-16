# Handoff: OMP Coms Governor / HQ ACK 阻塞与 Mesh 协议鲁棒性

Date: 2026-06-15
Project: ekunCustomsWms
Purpose: 给新 Codex session 系统性修复 OMP coms 五角色网络中的 ACK / pending / await 阻塞问题。

## 1. 当前上下文

本项目正在从原先四角色 persistent role mesh 扩展为五角色：

- `governor`: owner 入口，总进度和决策收口，不接触实际代码开发。
- `hq`: 实际开发 HQ / 工头，接 governor goal，拆任务，协调执行。
- `oracle`: 独立审查，风险、证据质量、GO/NO-GO，不修代码。
- `repair`: scoped fix 执行，必须在 HQ 授权范围内。
- `runner`: 测试、smoke、artifact、复现和验证，不改代码。

模型策略：

- `governor` + `oracle`: `openai-codex/gpt-5.5`
- `hq` / `repair` / `runner`: `minimax-cn/MiniMax-M3`

启动命令已人工测通，`--model`、`--thinking`、`--cname`、`--purpose`、`--project` 均可用。

## 2. 已查阅的上游设计资料

主要资料来自 Cave / Agent Lab：

- `/Users/yuantian/Documents/Cave/Agent-Lab/Agent工具/OMP/README.md`
- `/Users/yuantian/Documents/Cave/Agent-Lab/Agent工具/OMP/quickstart.md`
- `/Users/yuantian/Documents/Cave/Agent-Lab/Agent工具/OMP/collected/multi-agent-orchestration.md`
- `/Users/yuantian/Documents/Cave/Agent-Lab/Agent工具/OMP/pi-vs-claude-code移植/Coms本地嵌入方案-2026-06-14.md`
- `/Users/yuantian/Documents/Cave/Agent-Lab/Agent工具/OMP/pi-vs-claude-code移植/Fleet-Console-可行性调研-2026-06-14.md`
- `/Users/yuantian/Documents/Cave/Agent-Lab/Agent工具/OMP/omp-fleet-console/architecture-draft-2026-06-14.md`
- `/Users/yuantian/Documents/Cave/Dailynote/2026-06-14.md`
- `/Users/yuantian/Documents/Coding/omp-coms-port/docs/coms-omp-migration-log-2026-05-31.md`
- `/Users/yuantian/Documents/Coding/omp-coms-port/coms-to-omp-porting-handoff-2026-05-31.md`

关键设计结论：

- `coms-omp-lite` 是本地 Unix socket + registry 的 peer-to-peer primitive，不是完整 orchestrator。
- `coms_send` 发出的 prompt 需要接收方以最终 assistant text 直接回复，才能完成原 `msg_id`。
- 接收方如果收到 inbound 后再调用 `coms_send`，那是新的一跳，不是原 `msg_id` 的回复。
- `coms_await` timeout 不等于 peer 没有结果，只能说明本轮没有等到完成回复。
- 生产级推荐形态是 `mesh communication + centralized authority + single-writer implementation + independent review`。
- 横向通信是 information edge，不是 authority edge。
- Persistent role mesh 里的长期 session 可能 late，不应当按一次 timeout 判定失败。

## 3. 今天遇到的实际问题

### 3.1 Governor runtime abort

早些时候 governor 会话出现连续：

```text
Error: Request was aborted
usage 0/0
```

检查 OMP session JSONL 后确认：

- owner 的 ask 选择已经写入 session 记录。
- 失败发生在 governor 请求模型继续时。
- usage 为 `0/0`，说明请求未进入有效推理。

判断：这是 governor runtime / model request 层临时错误，不是 coms 网络或 mesh 架构本身坏了。

建议规则：

```text
如果 governor 连续 2 次 Request was aborted 且 usage 为 0/0，视为 governor runtime failure。
保留其他 session，重启 governor，并用最近 owner decision + last checkpoint 恢复。
不得重新询问 owner。
```

### 3.2 Governor 下发后等待 HQ ACK 阻塞

最新一轮 owner 对 governor 说：

```text
同意，下发执行吧。
```

governor 行为：

1. 创建 todo：
   - Send execution directive to HQ
   - Collect HQ acknowledgement
   - Report owner checkpoint
2. `coms_send` 给 `hq` 成功，得到 `msg_id 01KV4X4K56X9WHZMAWJ1YVQFRR`。
3. `coms_await` 30s timeout。
4. `coms_get` pending。
5. `coms_await` 120s timeout。
6. `coms_get` pending。
7. `coms_list` 显示 `hq` live。
8. governor 给 owner 短 checkpoint：已下发给 hq，但 hq 还没回 ACK。

owner 随后确认：HQ 实际收到了指令，但没有回复，导致 governor 一直等。

这不是纯 transport 问题，而是协议层和角色 prompt 层的组合问题：

- `hq` 没有遵守“收到 inbound 后必须直接 final text ACK”的纪律。
- governor 把 `Collect HQ acknowledgement` 当成同步必需项。
- coms 协议没有独立的 transport-level delivered/handled 状态暴露给上层。
- Todo 状态缺少 `degraded / ack pending / dispatched async` 这种中间态。

## 4. 根因假设

### 根因 A：ACK 语义混淆

当前 coms_send 返回的可能只是投递成功 / prompt ack，不等于目标 session 已完成业务 ACK。

业务 ACK 只有在目标 session 以 final assistant text 回复原 inbound 时，`coms_await(msg_id)` 才能拿到。

今天 HQ 收到了消息但没有 final 回复，因此 governor 的原 `msg_id` 一直 pending。

### 根因 B：角色 prompt 缺少强制入站 ACK 规则

昨天的四 session smoke 文档已经明确：

```text
收到 [coms-inbound] 后，如果任务要求“回复”，不要调用 coms_send；直接用最终 assistant 文本回答。
只有明确要求“转发/询问第三方 agent”时，才调用 coms_send。
```

但今天五角色启动 prompt 中，这条规则对 `hq` 不是硬约束，导致 HQ 可以进入执行而不回原消息。

### 根因 C：Governor 仍按同步 RPC 思维管理 HQ

governor 是总管，不是实时消息泵。下发给 HQ 后，只要：

- `coms_send` 成功；
- `coms_list` 显示 HQ live；
- msg_id 保持 pending；

就应进入 `dispatched / HQ ACK pending / async follow-up expected`，而不是继续长等。

### 根因 D：缺少系统级 deadlock policy

现在规则分散在 prompt 里，没有固化成可复用的状态机。

应把 peer pending、late result、ACK missing、runtime abort、owner checkpoint 的处理写成明确状态转移。

## 5. 建议系统性修复方向

### 5.1 Session prompt 级修复

所有非 governor session 的启动 prompt 增加硬规则：

```text
收到 [coms-inbound] 后，第一步必须判断是否需要业务 ACK。
如果是任务派发、owner decision、执行指令、review request、verification request 或状态请求，必须先用最终 assistant 文本直接回复一个短 ACK。
ACK 必须完成原 msg_id，不要用 coms_send 回 ACK。

ACK 格式：
ACK <role>: received <short task name>. status=<accepted|blocked|needs-clarification>. next=<one sentence>.

ACK 后如需通知其他 session，再另行 coms_send。
```

HQ 额外规则：

```text
收到 governor 下发的执行指令后，先直接 final 回复 ACK，再进入拆任务/派发。
不得因为准备计划、读文件、等 repair/runner 而延迟 ACK。
```

### 5.2 Governor prompt 级修复

governor 不应等待 HQ ACK 超过一个短窗口：

```text
Governor 向 HQ 下发后最多等待一次短 ACK，建议 30-60s。
如果 coms_await timeout 且 coms_get pending，但 coms_list 显示 HQ live：
- 状态标记为 dispatched / HQ ACK pending / async follow-up expected。
- 向 owner 做 partial checkpoint。
- 不继续长等。
- 不把 Collect HQ acknowledgement 标为 completed，只能标 pending/degraded。
```

governor 不直接管理 repair/runner，也不把 Oracle 当探活工具。

### 5.3 coms / fleet 层修复候选

如果要动代码或做正式 supervisor，建议补这些概念：

- `delivery_ack`: socket 投递成功，目标进程已接收 envelope。
- `business_ack`: 目标 assistant 已 final 回复原 msg_id。
- `late`: 超过 await window，但 peer live。
- `stale`: peer 不 live 或 registry/socket stale。
- `orphaned`: 原 msg_id 长期 pending，但目标后续通过新 msg 或 owner visible 文本处理了任务。

对工具层可考虑新增：

- `coms_status(msg_id)`: 返回 delivery / pending / responded / target live / age / hops。
- `coms_nudge(msg_id, prompt?)`: 对原 target 请求 last status，但明确这是新消息，不是原 msg 的回复。
- `coms_mark_degraded(msg_id, reason)`: 由 orchestrator 记录降级状态，避免无限等。

这不一定要立刻实现；短期可以通过 prompt 纪律解决。

## 6. 推荐给新 Codex session 的任务

Mission: 系统性修复 OMP coms 五角色 mesh 的 ACK / pending / await 鲁棒性。

目标：

1. 审查当前 `~/.omp/agent/experiments/coms-omp` 的实现和工具描述，确认 `coms_send` / `coms_await` / inbound final reply 的协议语义。
2. 审查今天五角色启动 prompt，找出哪里没有强制 HQ / peers direct ACK。
3. 写一版新的 mesh system prompt 包：
   - governor prompt
   - hq prompt
   - oracle prompt
   - repair prompt
   - runner prompt
   - shared communication policy
4. 明确状态机：
   - sent
   - delivered if inferable
   - ack pending
   - business acked
   - late
   - degraded
   - blocked
   - runtime failed
5. 给出最小手工验收脚本：
   - governor -> hq 下发，HQ 必须 10 秒内 direct ACK。
   - HQ ACK 后再派发 runner/repair。
   - runner 不 ACK 的情况下，HQ 可 fallback 最小验证并标 late。
   - governor 不因 HQ ACK pending 长等。
   - inbound 后误用 coms_send 回 ACK 的行为能被 prompt 明确禁止。

## 7. 非目标

本轮不要做这些事，除非 owner 另行批准：

- 不改 ekunCustomsWms 业务代码。
- 不 stage / commit / push。
- 不清理 `~/.omp/coms` 或 registry，除非只是读状态。
- 不改 OMP core。
- 不把 coms-net 纳入本轮。
- 不引入 Web Fleet Console 实现；只可作为中期设计参考。

## 8. 新 session 启动建议 prompt

```text
你要系统性修复 OMP coms 五角色 mesh 的 ACK / pending / await 鲁棒性。

请先读：
1. /Users/yuantian/Documents/Coding/ekunCustomsWms/docs/reports/2026-06-15-omp-coms-governor-ack-handoff.md
2. /Users/yuantian/Documents/Cave/Agent-Lab/Agent工具/OMP/pi-vs-claude-code移植/Coms本地嵌入方案-2026-06-14.md
3. /Users/yuantian/Documents/Cave/Dailynote/2026-06-14.md
4. /Users/yuantian/Documents/Cave/Agent-Lab/Agent工具/OMP/omp-fleet-console/architecture-draft-2026-06-14.md

不要改业务代码。先做协议和 prompt 层分析。
输出：
- root cause
- revised shared communication policy
- revised role prompts for governor / hq / oracle / repair / runner
- manual acceptance checklist
- 是否需要改 coms-omp-lite 的工具描述或状态 API
```

## 9. 当前一句话判断

今天的阻塞不是 “HQ 没收到” 或 “coms 网络坏了”，而是：HQ 收到 inbound 后没有 direct final ACK，governor 又把业务 ACK 当成同步必需项等待，导致 persistent mesh 被误用成阻塞 RPC 链。

