# 2026-06-15 Pi 拓扑网络纠偏经验

## 结论

coms 的第一层价值是替代人工 copy/paste；真正价值是给多 session 协作提供可寻址消息、ACK/timeout 语义、状态机、审计证据和角色边界。

## 必须沉淀的规则

- ACK 不是完成；accepted 后必须继续执行第一项实际动作。
- top-level final 只用于当前 inbound 的最小 ACK / dispatch receipt。
- 所有后续 report / checkpoint / status board 必须用 `coms_send target=<requester>` 回传。
- 禁止在本 session inline 输出报告正文；本 session 最多输出一行 sent summary。
- persistent peer 不是 subagent；必须 `coms_send target=oracle|runner|repair|hq|governor`。
- HQ 收到 Oracle review + Runner report 后必须进入 `merge_or_decide`。
- Repair 是默认 coder，但必须 scoped；Runner / Oracle / Governor / HQ 默认都不写代码。

## HQ 收到 review/report 后的唯一正确下一步

1. 标记每份 peer report 的状态：received / missing / late / blocked。
2. 合并 status board。
3. 区分 transport evidence、business evidence、inference。
4. 判定 `GO` / `NO-GO` / `Conditional-GO` / `BLOCKED`。
5. 列 owner/governor 必决项。
6. 若需修复，只能请求授权或派发已授权 scoped repair。
7. `coms_send target=governor` 回传 merged report。

## 启动脚本落点

Pi 启动脚本：

```text
/Users/yuantian/Documents/Coding/pi-vs-cc/scripts/launch-pi-topology-ghostty.sh
```

脚本注入：

```text
/Users/yuantian/Documents/Coding/pi-vs-cc/.pi/agents/pi-topology-network/shared-protocol.md
/Users/yuantian/Documents/Coding/pi-vs-cc/.pi/agents/pi-topology-network/<role>.md
```

因此运行时生效规则以 Pi harness 下 `.pi/agents/pi-topology-network/` 为准，`Pi-topology-network/docs/` 为 canonical 经验与审核文档。

## 等待节奏纠偏

- 5 分钟 timeout 对 repair 不是失败，也不应立即判 degraded；它通常只是首 checkpoint 观察窗。
- Repair 默认执行窗口应给 20-30 分钟，status nudge 15 分钟内最多 1 次。
- `complete` 但 payload 空要标记为 `complete_empty / reply_missing`，可以发一次状态查询，但不能重发原任务。
- Nudge 是 status request，不是 retry，不改变 scope。

## 消息穿墙错觉纠偏

`coms_await` 能收到原 `msg_id` 的 final reply，不代表业务 REPORT 合规送达。原 `msg_id` final reply 是 lifecycle reply channel，只能承载 ACK / blocked / needs-clarification / minimal dispatch receipt。

业务内容必须走 `coms_send target=<requester>`：

- Runner 验证结果：`REPORT runner -> hq`
- Oracle 审查结果：`REPORT oracle -> hq`
- Repair 状态/修复结果：`STATUS repair -> hq` / `REPORT repair -> hq`
- HQ 合流报告：`REPORT hq -> governor`
- Governor 授权下发：`AUTHORIZATION governor -> hq`

禁止把 `ACK <role>:` 文本作为下游 packet 标题转发。ACK 只属于当前 inbound 的 direct final reply。

## HQ packet wording 纠偏

事故：HQ 在派发 V-A 给 Runner 时写了“必须以最终 assistant 文本直接回复 HQ”。Runner 服从后把验证报告放进原 `msg_id` final reply，HQ 的 `coms_await` 能收到，但这是 `channel_violation`。

修复：HQ 下游 packet 必须写清：先 direct ACK；报告正文不得放进 final assistant reply；完成后 `coms_send target=hq` 发 `REPORT <role> -> hq`，并带 `request_msg_id`。

## Repair 自测越界纠偏

事故：Repair 改完代码后自行跑正式测试。虽然没有造成损害，但会削弱拓扑网络的职责分离。

修复：Repair 只允许做最小 `self_check`，用于避免交付明显坏代码；正式验证必须由 Runner 执行。HQ 不能把 Repair 的 self_check 当成 verification pass，收到 repair report 后应派 Runner 复验。

## Hop limit 误拦截纠偏

事故：Governor 在处理 HQ 的 Slice B 合流 inbound 后，向 HQ 下发 Slice B2 授权，`coms_send target=hq` 返回 `hop limit reached (5 >= 5)`。HQ live，但 msg_id undefined。

根因：coms 把“回原发送方的业务 packet”也当成 inbound 里的继续转发，继承并累加 hops。长任务中 HQ ↔ Governor 多轮治理闭环会自然撞到 MAX_HOPS=5。

修复：transport 语义调整为：发给第三方 peer 才 `hops + 1`；发回当前 inbound 的原发送者视为新的 business reply packet，hops 重置为 0。保留 runaway delegation chain 防护。

操作规则：看到 hop limit 后不要重复重发；标记 `transport_blocked/hop_limit`，检查是否为 reply-to-sender 误判。

## coms_send 失败后 inline fallback 纠偏

事故：Repair 完成 Slice B2 后多次 `coms_send target=hq` 返回 `undefined msg_id`，随后执行了 “Falling back to direct assistant text reply per protocol”。这会重新引入 inline 报告和 channel 混用。

判断：当 `coms_list` 显示 HQ live，但 `coms_send hq` 和 `coms_send hq ping` 都返回 `undefined msg_id`，优先判断为 transport issue（常见原因：旧 session 未加载 hop 修复、hop limit、send failure UI 未暴露 error），不是业务失败。

修复：`coms_send` 失败时禁止 inline fallback。角色只能输出一行 `REPORT NOT SENT: transport_blocked ...`，保留报告在本地上下文，等待重启/transport 修复/人工转发。
