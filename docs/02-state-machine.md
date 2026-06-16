# ACK / Pending 状态机

## 状态表

| 状态 | 含义 | 允许动作 |
|---|---|---|
| `draft` | 指令尚未发送 | 完善目标和接收方。 |
| `sent` | `coms_send` 成功并返回 `msg_id` | 短窗口等待 ACK。 |
| `delivered_if_inferable` | 有目标 live / inbound 可见等投递证据 | 等待业务 ACK 或降级。 |
| `ack_pending` | 原 `msg_id` 仍 pending | 不阻塞主控；记录 async follow-up。 |
| `business_acked` | 目标 final text 直接回复原消息 | 进入执行或验收。 |
| `running` | 目标已接单并执行 | 等 checkpoint / artifact。 |
| `late` | 超过等待窗口但目标仍 live | 后续结果并入判断，不重复派重任务。 |
| `degraded` | ACK 缺失但不影响继续推进 | 对 owner 做 partial checkpoint。 |
| `blocked` | 需要 owner 或上游输入 | 明确阻塞项和最小问题。 |
| `runtime_failed` | session / model request 层失败 | 保留其他 session，重启失败角色。 |
| `complete` | 结果和证据收口 | 归档记录。 |

## 角色行为状态机

拓扑网络不是普通多 agent 聊天。每个角色必须按状态流转，收到材料后不能自由发挥。

| 角色 | 收到输入后 | 收到下游结果后 | 只能输出给谁 | 禁止 |
|---|---|---|---|---|
| topology-supervisor | ACK owner；read-only intake；生成 mission card；owner 批准后派生/恢复 HQ | 把 HQ checkpoint 提炼成 owner 决策请求或终态；维护 status board / incident log | owner / HQ / spawned roles | 不写业务代码；不绕过 owner gate；不让 HQ 直接 open/kill session |
| governor | ACK owner；派 mission 给 HQ | 把 HQ checkpoint 提炼成 owner 决策请求或终态 | owner / HQ | 不写代码；不替 HQ 做 peer 合流 |
| HQ | ACK topology-supervisor 或 governor；派 oracle / runner / repair | merge_or_decide：合并 evidence、verdict、owner-decision request | topology-supervisor 或 governor / oracle / runner / repair | 不 inline 长报告；不启动同名 subagent；不自驱扩大 scope |
| oracle | ACK HQ；做 red-line review | 形成 review verdict | HQ | 不改代码；不替 runner 跑验证 |
| runner | ACK HQ 或带 HQ authority_source 的 Repair verify request；跑验证命令 | 形成 verification report | HQ | 不改代码；不做 scope 决策 |
| repair | ACK HQ；做 scoped fix；如有 verification_contract 可直连 runner 请求验证 | 回传 diff summary + self_check + verification request evidence | HQ / Runner(仅 verify request) | 不扩大范围；不 commit/push；无 HQ 预授权时不命令 runner |

### HQ 合流规则

当 HQ 已收到 Oracle review 和 Runner report，或等待窗口结束且有 partial evidence，HQ 必须立即进入 `merge_or_decide`：

1. 更新 status board。
2. 区分 transport evidence、business evidence、inference。
3. 判定 `GO` / `NO-GO` / `Conditional-GO` / `BLOCKED`。
4. 列 owner / topology-supervisor / governor 必决项。
5. 如果需要修复，只能请求授权或派发已授权 scoped repair。
6. 如果 repair packet 带 `verification_contract`，允许 repair 完成后直接向 runner 发 `VERIFY_REQUEST`，但 authority_source 必须指回 HQ 原 msg_id。
7. Phase D 用 `coms_send target=topology-supervisor` 回传 merged report；legacy governor mission 用 `coms_send target=governor`。本 session 不 inline 输出报告正文。


## 分层等待窗口

| 消息类型 | 默认等待 | timeout 后状态 | 是否 nudge |
|---|---:|---|---|
| direct ACK / dispatch receipt | 30-60 秒 | `ack_pending` | 可查 live，不立刻重复任务 |
| Oracle review | SLA 5-10 分钟 | `late_pending` | 超过 SLA 可 1 次 status nudge；不长 await |
| Runner verification | SLA 5-10 分钟或命令预计时长 | `late_pending` | 长命令不催；超过 SLA 可 1 次 status nudge；不长 await |
| Repair scoped fix ACK | 30-60 秒 | `ack_pending` | 可查 live |
| Repair first checkpoint | SLA 10 分钟 | `repair_late_pending` | live 时不急催 |
| Repair execution | SLA 20-30 分钟 | `repair_late_pending` | 15 分钟内最多 1 次 status nudge；不长 await |
| HQ merge report | 3-5 分钟 | `hq_late_pending` | governor 记录 async follow-up |

`complete` 但 payload 为空时，标记 `complete_empty / reply_missing`。这允许发一次 status nudge，但不允许把原任务重发给 peer。

## Governor 等待策略

Topology-supervisor / Governor 向 HQ 下发后最多等待一次短 ACK，建议 30-60 秒。

如果 `coms_await` timeout 且 `coms_get` pending，但 `coms_list` 显示 HQ live：

```text
state = dispatched / HQ ACK pending / async follow-up expected
```

此时 topology-supervisor / governor 要向 owner 做 partial checkpoint，不继续长等，不把 ACK 任务标为 completed。

## Runtime abort 策略

如果 governor 连续 2 次 `Request was aborted` 且 usage 为 `0/0`，视为 governor runtime failure。

处理：

1. 保留 hq / oracle / repair / runner session。
2. 重启 governor。
3. 用最近 owner decision + last checkpoint 恢复。
4. 不重新询问 owner 已经回答过的问题。
