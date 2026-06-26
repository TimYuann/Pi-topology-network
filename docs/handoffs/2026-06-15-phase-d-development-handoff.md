# Phase D 一次性开发交接说明

日期：2026-06-15
项目：Pi 拓扑网络 / `Pi-topology-network`
目标：在本项目中一次性推进到 Phase D，并在睡前启动第一次 8 小时自运行测试。

## 1. 当前判断

当前系统已从“能通信”推进到“可治理拓扑雏形”。coms 已经不是单纯 copy/paste 工具，而是承担：

- peer addressing
- msg_id / await / timeout
- transport evidence
- role boundary
- incident log / lessons learned
- Phase D 长跑前的 runtime contract

但系统还不是完整 production runtime。今晚 Phase D 首测建议仍使用固定 5 session，不直接启用 HQ 动态派生。动态派生属于 Phase B/C 的后续能力，需要 supervisor 承担执行权。

## 2. 关键目录

Canonical 文档项目：

```text
/Users/yuantian/Documents/Coding/Pi-topology-network
```

Pi harness / 实际启动脚本与 prompt：

```text
/Users/yuantian/Documents/Coding/pi-vs-cc
/Users/yuantian/Documents/Coding/pi-vs-cc/scripts/launch-pi-topology-ghostty.sh
/Users/yuantian/Documents/Coding/pi-vs-cc/.pi/agents/pi-topology-network/
```

当前业务项目 workdir：

```text
/Users/yuantian/Documents/Coding/ekunCustomsWms
```

## 3. 已落地协议与事故修复

### 3.1 Direct ACK / Result Return

规则：

- ACK 不是完成。
- top-level final reply 只用于 ACK / blocked / needs-clarification / minimal dispatch receipt。
- REPORT / STATUS / CHECKPOINT / AUTHORIZATION 必须走 `coms_send`。
- 禁止在本 session inline 输出报告正文。

落点：

```text
pi-vs-cc/.pi/agents/pi-topology-network/shared-protocol.md
Pi-topology-network/docs/01-shared-communication-policy.md
```

### 3.2 Lifecycle Reply Contract

事故：Runner 按 HQ 错误指示，把验证报告放进原 `msg_id` final reply，HQ 的 `coms_await` 能收到，但这属于 channel violation。

修复：

- 原 `msg_id` final reply = lifecycle channel。
- `coms_send target=<requester>` = business packet channel。
- 下游 packet 禁止以 `ACK <role>:` 开头。

### 3.3 HQ Downstream Packet Wording

事故：HQ 派发 V-A 时写“必须以最终 assistant 文本直接回复 HQ”，带偏 Runner。

修复：HQ 下游 packet 必须写：

```text
direct ACK this message first
do not put report body in final assistant reply
after completion, coms_send target=hq with REPORT <role> -> hq
include request_msg_id=<original msg_id>
```

### 3.4 Repair / Runner Verification Separation

事故：Repair 改完代码后自行跑正式测试。

修复：

- Repair 只允许最小 `self_check`。
- Runner 是正式验证来源。
- HQ 不能把 Repair self_check 当成 verification pass。
- HQ 收到 repair report 后必须派 Runner 复验。

### 3.5 Wait Window / Nudge Policy

规则：

- ACK：30-60 秒。
- Oracle / Runner：5-10 分钟，长命令按预计时长。
- Repair 首 checkpoint：10 分钟。
- Repair 执行窗口：20-30 分钟。
- Repair nudge：15 分钟内最多 1 次。
- `complete` 但 payload 空：`complete_empty / reply_missing`。

### 3.6 Hop Policy

事故：Governor 处理 HQ inbound 后向 HQ 发送授权，撞到 `hop limit reached (5 >= 5)`。

根因：旧 coms 把“回原发送方的业务 packet”也当作第三方转发，累加 hops。

修复：

- 发给第三方 peer：`hops + 1`。
- 发回当前 inbound 原发送者：视为新的 business reply packet，`hops = 0`。

代码落点：

```text
pi-vs-cc/extensions/coms.ts
pi-vs-cc/extensions/coms-net.ts
```

注意：已启动的旧 session 不会自动加载这次修复，必须重启。

### 3.7 Send Failure / No Inline Fallback

事故：Repair 多次 `coms_send target=hq` 返回 `undefined msg_id` 后，尝试 fallback 到 direct assistant text reply。

修复：

- `coms_send` 失败时禁止 inline fallback。
- 只能输出一行：

```text
REPORT NOT SENT: transport_blocked target=<role> reason=<reason>
```

然后等待 transport 修复 / session 重启 / owner 人工处理。

## 4. 当前成熟路线

见：

```text
docs/08-maturity-roadmap.md
```

阶段：

```text
Phase A: 固定 5 session，稳定协议
Phase B: HQ 可请求 spawn/close，但 supervisor 执行
Phase C: worker pool + TTL + auto archive
Phase D: 8 小时自运行测试
```

今晚目标：Phase D 首测。

重要判断：第一次 8 小时测试不要直接启用动态派生。先用固定 5 session + 强 gate 跑通长程稳定性。

## 5. Phase D 一次性开发目标

本次开发要补齐 Phase D 需要的最小 runtime 资产，不追求完整平台化。

必须交付：

1. `mission-card` 模板
2. `status-board` 模板/示例
3. `incident-log` 模板/示例
4. `phase-d-runbook` 或补强现有 runbook
5. `watchdog` 最小脚本或伪实现
6. `supervisor` 最小接口说明或脚本骨架
7. 启动前 preflight checklist
8. 睡前 8 小时测试 checklist
9. 醒来验收 checklist

建议文件：

```text
templates/mission-card.phase-d.json
templates/status-board.phase-d.json
templates/incident-log.phase-d.jsonl
docs/09-phase-d-runtime-design.md
docs/10-phase-d-first-8h-test-plan.md
scripts/topology-watchdog.sh
scripts/topology-supervisor.sh
```

如果暂时不做真正 supervisor，也必须写清楚：HQ 不能直接 open/kill session；spawn/close 只能作为 request，由人工或 supervisor 执行。

## 6. Phase D Runtime 设计要求

### 6.1 Mission Card

必须包含：

```json
{
  "mission_id": "p6-phase-d-8h-001",
  "project": "customs-long",
  "workdir": "/Users/yuantian/Documents/Coding/ekunCustomsWms",
  "objective": "...",
  "allowed_paths": [],
  "forbidden_actions": ["git add", "git commit", "git push", "destructive commands"],
  "owner_gates": [],
  "checkpoint_interval_minutes": 30,
  "stop_conditions": []
}
```

### 6.2 Status Board

必须追踪：

```text
mission_id
phase
active_slice
owner_decisions
peer_status
pending_msgs
active_workers
allowed_paths
forbidden_actions
next_gate
last_checkpoint_at
incidents
```

### 6.3 Incident Log

必须记录：

```text
late_pending
complete_empty
channel_violation
packet_wording_violation
transport_blocked/hop_limit
undefined_msg_id
nudge_limit_exceeded
scope_violation
role_boundary_violation
```

### 6.4 Watchdog

最小能力：

- 每 5-10 分钟提醒检查 status board。
- 检查是否超过 checkpoint interval。
- 检查是否出现 pending 太久。
- 检查是否出现 repeated nudge。
- 检查是否需要 owner gate。

第一版可以是 shell 脚本输出 checklist，不要求自动操作 session。

### 6.5 Supervisor

第一版可以是脚本骨架，不直接接管进程。

必须定义：

```text
SPAWN REQUEST
CLOSE REQUEST
ARCHIVE REQUEST
```

但 Phase D 首测默认不启用动态派生。

## 7. Phase D 首测启动命令

固定 5 session：

```bash
cd /Users/yuantian/Documents/Coding/pi-vs-cc
./scripts/launch-pi-topology-ghostty.sh --launch --stagger 2   --workdir /Users/yuantian/Documents/Coding/ekunCustomsWms   customs-long
```

2 session smoke：

```bash
cd /Users/yuantian/Documents/Coding/pi-vs-cc
./scripts/launch-pi-topology-ghostty.sh --launch   --workdir /Users/yuantian/Documents/Coding/ekunCustomsWms   customs-long hq runner
```

启动脚本现在会做 prompt hardening preflight。若缺以下 marker，应拒绝启动：

- Lifecycle Reply Contract
- Hop Policy
- Send Failure / No Inline Fallback Policy
- Role Behavior State Machine
- Downstream Packet Wording Contract
- Verification Separation Gate

## 8. 睡前准入条件

睡前启动 8 小时测试前必须确认：

- [ ] 5 session 全部重启，加载最新 `coms.ts` 和 prompt。
- [ ] `coms_list *` 能看到 governor / hq / oracle / repair / runner。
- [ ] 运行 hq->runner 最小 REPORT smoke，确认 Runner 用 `coms_send target=hq` 回传。
- [ ] 运行 governor->hq authorization smoke，确认不会再触发 hop limit。
- [ ] mission card 已写入。
- [ ] status board 已初始化。
- [ ] incident log 已初始化。
- [ ] 禁止 git add / commit / push。
- [ ] allowed_paths 和 forbidden_actions 明确。
- [ ] owner-decision gate 明确。

## 9. 醒来验收标准

通过标准：

- 8 小时内无 scope violation。
- 无未授权 git add / commit / push。
- 无 inline report fallback。
- 无把业务 report 塞进原 `msg_id` final reply。
- Repair 只做 self_check，Runner 做正式验证。
- 每 30-60 分钟有 checkpoint / pending reason / owner gate。
- incident log 可解释所有异常。
- status board 能重建整个 8 小时过程。

失败但可接受：

- peer late_pending，但有 incident 记录。
- owner gate 暂停。
- transport_blocked 被识别并停止，没有乱重发。

失败且必须停机：

- scope 外写入。
- destructive command。
- unauthorized commit/push。
- role boundary 连续失守。
- session 自行绕过 owner gate。

## 10. 一次性开发建议顺序

1. 读本交接说明。
2. 读 `docs/08-maturity-roadmap.md`。
3. 读 `docs/03-startup-runbook.md` 和 `docs/04-acceptance-checklist.md`。
4. 创建 Phase D runtime 设计文档。
5. 创建 mission/status/incident 模板。
6. 创建 watchdog/supervisor 最小脚本骨架。
7. 更新 README 和 runbook 入口。
8. 跑启动脚本 dry-run。
9. 给 owner 输出 Phase D 首测启动 checklist。

## 11. 当前不做

- 不做完整动态派生 runtime。
- 不让 HQ 直接 open/kill session。
- 不做自动归档生产实现。
- 不做真实 Web UI。
- 不接入真实告警系统。
- 不自动 commit/push。

## 12. 交接给下一位 Codex 的一句话

你要把 Pi 拓扑网络从“固定 5 session 的协议实践”推进到“Phase D 首次 8 小时自运行测试可启动”。重点不是多写 prompt，而是补齐 mission/status/incident/watchdog/supervisor/checklist 这几个 runtime 资产，并确保所有事故都被 gate 吸收。
