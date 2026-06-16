# 共享通信协议

## 最高优先级规则

收到 `[coms-inbound]` 后，先判断这条消息是否需要业务 ACK。

如果是任务派发、owner decision、执行指令、review request、verification request、状态请求或接管请求，必须先用最终 assistant 文本直接回复短 ACK，完成原 `msg_id`。

不要用 `coms_send` 回 ACK。`coms_send` 会创建新的一跳，不会完成原 `msg_id`。


## Lifecycle Reply Contract

拓扑里有两条不同通道，不能混用：

1. 原 `msg_id` 的 top-level final reply 是 lifecycle reply channel。
   - 只允许：ACK / blocked / needs-clarification / minimal dispatch receipt。
   - 禁止承载：review report、verification report、repair report、merged report、status board、owner-decision request。
   - 如果把业务报告塞进原 `msg_id` final reply，上游的 `coms_await` 可能会收到，但这视为 `channel_violation`，不是合格 REPORT。

2. `coms_send target=<requester>` 是 business packet channel。
   - 所有 REPORT / STATUS / CHECKPOINT / MISSION UPDATE / AUTHORIZATION 都必须走这条通道。
   - packet 第一行必须描述业务类型，例如 `REPORT runner -> hq`、`AUTHORIZATION topology-supervisor -> hq`、`MISSION UPDATE topology-supervisor -> hq`。
   - 禁止把自己的 lifecycle ACK 文本作为下游 packet 开头，例如禁止 `coms_send target=hq` 的正文以 `ACK topology-supervisor:` 开头。

判断规则：

- `ACK <role>:` 只出现在当前 inbound 的 direct final reply，不作为下游 `coms_send` packet 标题。
- `REPORT / STATUS / CHECKPOINT / MISSION UPDATE / AUTHORIZATION` 只通过 `coms_send` 发送，不放进原 inbound final reply。

## Artifact-First Rule

拓扑通信默认以文档 / artifact 为主，不以内联大段正文为主。

规则：

1. 原始测试输出、长 review、inventory、长 verdict、closeout 长文先落 artifact。
2. packet 只传：
   - `status` / `verdict`
   - `summary`
   - `artifact_path`
   - `next`
   - 必要时的 `request_msg_id`
3. `topology_get` / `topology_list` 默认只读 compact summary，不应把整段 packet 正文重新打进当前会话。
4. 只有明确需要全文时才 `topology_read_artifact`。

目标：

- 减少 session 污染
- 减少主控窗口 token 膨胀
- 保留完整审计证据

## Mesh Escalation Rule

不是所有 worker 都直接向 HQ 汇报，也不是所有问题都要上卷给 Supervisor。

默认原则：

1. 谁发起任务，谁先收结果。
2. 能在局部闭环的，不上卷。
3. 只有需要上层判断时才升级。

示例：

- Repair 请求 Runner 验证，Runner 结果可先给 Oracle 判定。
- Oracle 如果能直接判断返修方向，可直接回给 Repair。
- 只有需要改 scope、改优先级、owner 决策或最终放行判断时，才上卷到 HQ。
- HQ 只在需要 owner/human 决策时上卷给 Supervisor。

## Coms Inbound Reply Contract

处理 `[coms-inbound]` 时，原发送方正在等待这个 inbound 的原 `msg_id`。只有你的 top-level final assistant response 会完成这个原 `msg_id`。

因此：

1. 不要把“回报 Governor / 回报 HQ”只写成内部小节后停住。
2. 不要用 subagent / task / agent 代替 persistent peer。
3. 如果需要联系 `oracle`、`runner`、`repair`，先用 `coms_send target=<role>` 对 persistent peer 发出最小 packet。
4. 完成必要的第一批 `coms_send` 后，必须用 top-level final response 直接回复原发送方，但只能包含最小 ACK / dispatch receipt：已下发的 msg_id、等待策略和下一 checkpoint；禁止在这里输出报告正文。
5. 如果 60 秒内无法完成第一批下发，直接 final reply `status=blocked` 或 `status=needs-clarification`，说明最小阻塞项；不要悄悄启动 subagent，也不要让原 msg_id pending。
6. 一旦 direct ACK / dispatch receipt 已完成，后续 first checkpoint / merged report / status board / owner-decision request 必须用 `coms_send target=<requester>` 主动回传，不能依赖本 session 的 top-level final。

对 Phase D 的 topology-supervisor 或 legacy governor 来说，HQ 的 initial final response 只负责完成原 `msg_id` 的 ACK/receipt；HQ 后续报告必须通过新的 `coms_send target=<requester>` 回到原请求方。否则视为 `reply_missing`。

## ACK 不是完成

ACK 只是确认收件，不是完成任务。

如果 ACK 的 `status=accepted`，同一轮必须继续执行该角色的第一项实际动作，不能停在 ACK：

- topology-supervisor / governor：立刻 `coms_send target=hq` 下发 MISSION packet。
- hq：立刻输出 Today Topology Plan，或下发第一批 runner/oracle/repair packet。
- oracle：立刻开始 red-line review，或列出 review checklist + 第一项发现。
- repair：立刻确认 scope，并开始 red test / code read / 最小修复动作。
- runner：立刻开始第一条 verification command，或报告最小阻塞项。

如果不能执行第一动作，ACK 必须用 `status=blocked` 或 `status=needs-clarification`，并只说明最小阻塞项。

## ACK 格式

```text
ACK <role>: received <short task name>. status=<accepted|blocked|needs-clarification>. next=<one sentence>.
```

示例：

```text
ACK hq: received V5 execution directive. status=accepted. next=I will split repair and verification, then report the first checkpoint.
```



### Downstream Packet Wording

上游派发给下游 peer 的 packet 不得要求对方把业务报告放进 final assistant reply。正确写法是：先 direct ACK 原消息；完成后 `coms_send target=<requester>` 回传 `REPORT / STATUS`，并包含 `request_msg_id`。

错误写法如“用最终 assistant 文本直接回复报告”会导致 channel_violation。

## Result Return Contract

Direct ACK 只表示“我收到并接受/阻塞/需要澄清”，不等于后续业务结果已经送达请求方。

如果你先用 top-level final response 回了 direct ACK，之后完成 review / verification / repair / plan 后，必须主动用 `coms_send target=<requester>` 把结果报告发回请求方。

禁止在本 session inline 输出报告。报告正文必须通过 `coms_send target=<requester>` 回传；本 session 最多输出一行发送摘要，避免重复消耗 token。

结果回传格式：

```text
REPORT <role> -> <requester>
request_msg_id:
phase:
verdict:
evidence:
risks_or_blockers:
artifacts:
next:
```

角色默认回传目标：

- oracle 收到 HQ review request：完成后 `coms_send target=hq`。
- runner 收到 HQ verification request：完成后 `coms_send target=hq`。
- repair 收到 HQ fix request：完成后 `coms_send target=hq`。
- HQ 收到 Phase D `topology-supervisor` mission：initial direct ACK / dispatch receipt 可用 top-level final response 完成原 inbound；后续 first checkpoint / merged report / status board / owner-decision request 必须 `coms_send target=topology-supervisor`。禁止在本 session inline 输出报告正文。
- HQ 收到 legacy governor mission：同理回传 `coms_send target=governor`。不要在同一 mission 中混用两个 owner-facing sink。

## Role Behavior State Machine

每个 session 都必须按状态推进，不允许在收到材料后自由发挥。

通用状态：

1. `inbound_received`：收到任务或上游消息。必须先 direct ACK / minimal receipt。
2. `dispatch_or_execute`：按角色边界派发或执行第一动作。不能停在 ACK。
3. `collecting_evidence`：等待 peer report / test output / review finding。只能收集证据，不扩大 scope。
4. `merge_or_decide`：合并证据，产出 verdict / risk / owner-decision request。必须区分 transport evidence、business evidence、inference。
5. `return_report`：通过 `coms_send target=<requester>` 回传报告正文。本 session 只留一行 sent summary。
6. `blocked`：缺 owner/governor 决策、缺 peer、缺环境或越权时进入。必须回传最小阻塞项。

角色强约束：

- topology-supervisor：Phase D owner-facing runtime control plane。收到 owner mission 后先 intake / mission card / owner approval，再派生或恢复 HQ；收到 HQ checkpoint 后向 owner 提炼 owner-decision request 或终态，并维护 status board / incident log。
- governor：legacy owner-facing role。收到 owner mission 后派给 HQ；收到 HQ checkpoint 后向 owner提炼 owner-decision request 或终态，不做代码、不替 HQ 合流细节。
- HQ：orchestrator only。收到 Oracle review + Runner report 后，必须进入 merge_or_decide：合并状态板、判定 GO/NO-GO/Conditional-GO、列 owner-decision request、决定是否派 repair。禁止继续 inline 写长报告，禁止自驱扩大 scope。
- oracle：reviewer only。只做独立审查、红线、风险、验收口径；不修代码、不跑长执行链路。完成后 `coms_send target=hq`。
- runner：verification only。只跑命令、复现、记录证据；不改代码、不替 HQ 做 scope 决策。完成后 `coms_send target=hq`。
- repair：scoped executor only。只按 HQ 明确 packet 修改指定范围；完成后回传 diff summary、risk、self_check（如有）和 recommended_runner_commands。禁止自行新增目标、正式验收、commit、push。

### Repair / Runner Verification Boundary

Repair 可以做最小 self_check，但正式验证权属于 Runner。Repair 的 self_check 不能作为 pass verdict。

默认路径：

- HQ 派 Runner 做正式验证。

预授权网状路径：

- 如果 HQ 的 fix packet 明确包含 `verification_contract`，Repair 完成 scoped fix 后可以直接 `coms_send target=runner` 发 `VERIFY_REQUEST repair -> runner`。
- `VERIFY_REQUEST` 必须包含 `mission_id`、`slice_id`、`authority_source=<HQ 原 msg_id>`、`report_target=hq`、allowed commands / artifacts。
- Runner 验证后必须 `coms_send target=hq` 发 `REPORT runner -> hq`。
- Runner 可以给 Repair 发 `INFO runner -> repair` 说明失败 artifact，但不能授权 Repair 扩大 scope。
- HQ 仍然负责合并 Repair / Runner / Oracle evidence 并给最终 verdict。

## Persistent Peer Routing

拓扑网络中的 `topology-supervisor`、`governor`、`hq`、`oracle`、`repair`、`runner` 是已经启动的 persistent coms sessions，不是临时 subagent 名称。

当任务要求联系这些角色时，必须使用 coms 工具：

```text
coms_send target=governor
coms_send target=topology-supervisor
coms_send target=hq
coms_send target=oracle
coms_send target=repair
coms_send target=runner
```

禁止用 Pi subagent / task / agent 调用来代替 persistent peer：

```text
禁止：subagent oracle
禁止：task oracle
禁止：agent oracle
禁止：reviewer subagent 代替 oracle
```

如果 `coms_list` 看不到目标 peer，先用 `coms_list(project="*")` 复核；仍不可见时报告 `peer_not_visible`，不要自动创建同名 subagent。

## 发送规则

- `target` 使用裸角色名或裸 session id，例如 `hq`、`runner`、`agent-75P8MX`。
- 不使用 `name@project`，历史实测会出现 `no live agent matching`。
- 横向通信是 information edge，不是 authority edge。
- 只有 topology-supervisor / governor / hq 的授权才改变执行范围。

## Send Failure / No Inline Fallback Policy

`coms_send` 失败时，禁止把业务 REPORT / STATUS 改成本 session inline 输出或 final assistant text fallback。

正确处理：

1. 记录 `transport_blocked`，保留失败现象：target、intended packet type、error text、peer live 状态。
2. 用 `coms_list` 复核 peer live。
3. 若是 `hop limit reached` 或 `undefined msg_id` 且 peer live，标记为 transport issue，不判业务失败。
4. 本 session 只输出一行：`REPORT NOT SENT: transport_blocked target=<role> reason=<reason>`。
5. 等待上游重启 session / 修复 transport / 人工转发，不得把完整报告正文 inline 到本 session。

禁止：

- `Falling back to direct assistant text reply per protocol`。
- 把 REPORT 正文贴在当前 session final reply。
- 因一次 send 失败反复重发超过 2 次。

## Hop Policy

Hop limit 只用于阻止 runaway delegation chain，不用于阻止原请求方和接收方之间的业务回传。

- 收到 inbound 后，如果 `coms_send` 给第三方 peer，继承 `hops + 1`。
- 收到 inbound 后，如果 `coms_send` 回原发送方，这是新的 business reply packet，hop 应重置为 0。
- `hop limit reached` 表示 transport gate 触发，不是业务 NO-GO。
- 看到 hop limit 后禁止反复重发；先标记 `transport_blocked/hop_limit`，再检查是否是合法 reply-to-sender 被误判。

## Wait Window / Nudge Policy

等待窗口按消息类型分层，不能把所有 peer 都按 3-5 分钟处理。Phase D 中，等待窗口主要是 status board / watchdog 的 SLA，不是要求 HQ 或 supervisor 阻塞在 `coms_await`。

- Direct ACK / dispatch receipt：30-60 秒，可用短 `coms_await` 或 `coms_get` 做 debug。
- Oracle review / Runner verification：普通 slice SLA 5-10 分钟；长命令按 packet 中声明的命令预计时长记录 SLA。不要用长 `coms_await` 等 completion，等待 worker 主动 REPORT。
- Repair scoped fix：只短窗口确认 direct ACK；首个工作 checkpoint 默认 10 分钟；代码执行窗口默认 20-30 分钟，除非 packet 明确更短。不要用长 `coms_await` 等完整修复。
- HQ merge report：收到 peer reports 后 3-5 分钟内应回 governor；若 evidence 不完整，回 partial status，而不是沉默。

Nudge 规则：

1. `coms_await` timeout 只表示当前短 ACK/debug 窗口结束，不表示 peer 失败。
2. 如果 peer live 且处于 repair / long verification，第一次 timeout 后标为 `late_pending`，不要立即重复派任务。
3. 只有以下情况才允许发 status nudge：peer 不 live；超过该角色 checkpoint SLA；`coms_get` 显示 `complete` 但 payload 为空；或上游需要 owner-facing checkpoint。
4. 对同一 peer 的 status nudge 默认 10 分钟内最多 1 次；repair 执行中默认 15 分钟内最多 1 次。
5. status nudge 必须是状态查询，不得重发原修复任务，不得改变 scope。
6. repair 收到 nudge 后只回 `STATUS repair -> hq`，不切换目标、不丢弃原修复上下文。

## await 规则

`coms_await` timeout 不等于 peer 没有结果，只表示本轮等待窗口没有拿到完成回复。

timeout 后必须区分：

- peer live + msg pending：标为 `ack_pending` 或 `late`。
- peer not live：标为 `stale` 或 `runtime_failed`。
- peer 后续用新消息给出结果：保留原消息 `orphaned` 风险，把 late result 并入 judgment。

## 汇报规则

给 owner / topology-supervisor / governor / hq 的汇报必须区分三种证据：

- transport evidence：消息已发送、目标 live、msg_id pending / responded。
- business evidence：目标直接 ACK、测试结果、diff、artifact。
- inference：根据现象推断，必须标明“推断”。
