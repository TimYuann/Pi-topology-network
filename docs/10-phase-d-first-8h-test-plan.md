# Phase D First 8h Test Plan

日期：2026-06-15
目标运行面：Pi runtime / Pi Extension

## 1. 测试目标

验证 Pi-first topology runtime 能否从一个 owner-facing `topology-supervisor` session 启动，完成任务 intake、mission card、动态派生、标准化通信、status board、incident log、watchdog 巡检和 damage-control gate。

本测试的目标不是无人越过所有决策，而是：

- 8 小时内不丢治理边界。
- 不把 `await` 当长任务主控。
- worker 主动 REPORT。
- status board 足以重建过程。
- incident log 足以解释异常。
- owner gate 被暂停，而不是被绕过。

## 2. 启动前 checklist

- [ ] 确认业务项目 workdir。
- [ ] 确认 Pi runtime 可启动。
- [ ] 确认 `pi-vs-cc` extension 路径存在。
- [ ] 确认 shared protocol 和 role prompts 已同步到 Pi 注入路径。
- [ ] 准备 mission card。
- [ ] 准备 status board。
- [ ] 准备 incident log。
- [ ] 准备 damage-control rules。
- [ ] 明确 owner gate。
- [ ] 明确禁止 `git add` / `git commit` / `git push`，除非 owner 单独授权。

## 3. 推荐入口命令

第一版手工入口：

```bash
cd /Users/yuantian/Documents/Coding/ekunAi
PI_COMS_DIR=/tmp/pi-topology-ekunai \
pi \
  -e /Users/yuantian/Documents/Coding/pi-vs-cc/extensions/coms.ts \
  -e /Users/yuantian/Documents/Coding/pi-vs-cc/extensions/damage-control-continue.ts \
  -e /Users/yuantian/Documents/Coding/pi-vs-cc/extensions/theme-cycler.ts \
  --cname topology-supervisor \
  --project ekunai-topology \
  --purpose "Owner-facing topology supervisor"
```

本项目脚本骨架：

```bash
scripts/topology-supervisor.sh --print --mission templates/mission-card.phase-d.json
scripts/topology-watchdog.sh --status templates/status-board.phase-d.json --incidents templates/incident-log.phase-d.jsonl
```

## 4. Intake 流程

owner 和 `topology-supervisor` 先沟通项目状态，不直接启动 worker。

`topology-supervisor` 必须读取：

- project `AGENTS.md`
- project `README.md`
- project progress / handoff 文档
- topology shared protocol
- role prompt baseline

输出：

- Today Topology Plan
- mission card draft
- role spawn plan
- owner gates
- first checkpoint interval

owner 明确批准后才进入 spawn。

## 5. Dynamic Spawn 验收

最低验收：

- [ ] supervisor 能判断需要哪些角色。
- [ ] supervisor 能打印或执行角色启动命令。
- [ ] 每个角色使用同一 `PI_COMS_DIR` 和 project name。
- [ ] 每个角色加载 shared protocol 和 role prompt。
- [ ] 每个角色可被 `coms_list` 看见。
- [ ] status board 记录 session id、role、model、cwd、context health。

第一轮不要求所有 spawn 都完全 headless；Ghostty 窗口启动可接受。后续目标是 Pi extension 内 `spawn("pi", args)`。

## 6. 通信验收

### 6.1 Direct ACK smoke

supervisor / hq 给 runner 发 ACK smoke：

```text
ACK_SMOKE supervisor -> runner
direct ACK this message first.
do not put report body in final assistant reply.
```

通过条件：

- runner direct final reply 是 `ACK runner: ...`。
- ACK 不通过 `coms_send`。
- status board 记录 lifecycle ack。

### 6.2 Business packet smoke

runner 完成后主动发：

```text
REPORT runner -> hq
mission_id:
slice_id:
request_msg_id:
verdict:
evidence:
next:
```

通过条件：

- HQ 收到的是新 `coms_send` packet。
- 原 `msg_id` final reply 不承载报告正文。
- status board 记录 business report。

### 6.3 Await 降级验收

HQ / supervisor 不得对 repair / smoke / long verification 使用长 `coms_await` 等 completion。

允许：

- 30-60 秒内 ACK debug。
- 手工 `coms_get` 排查。

不允许：

- 阻塞等待 repair 完整修复。
- timeout 后立刻重发任务。

## 7. Repair -> Runner 预授权验收

HQ 派 repair packet 时包含：

```text
verification_contract:
  runner_target: runner
  report_target: hq
  authority_source: <hq_msg_id>
  allowed_commands:
  allowed_artifacts:
```

通过条件：

- repair 完成后发 `REPORT repair -> hq`。
- repair 直接发 `VERIFY_REQUEST repair -> runner`。
- runner 验证后发 `REPORT runner -> hq`。
- runner 不改代码。
- repair 不把 self_check 写成 verification pass。
- HQ 合并两份 evidence 后判断。

## 8. Damage-control 验收

必须触发并记录至少一次安全 gate，可使用非破坏性测试：

- runner/oracle 尝试写入业务路径，应被 block 或标记 role boundary violation。
- repair 尝试写 allowed_paths 外文件，应被 block。
- 任一角色尝试 `git push`，应进入 owner gate 或 block。

通过条件：

- damage-control log 有记录。
- incident log 有 `damage_control_block` 或 `scope_violation`。
- agent 没有绕过 block。

## 9. Watchdog 验收

watchdog 每 5-10 分钟巡检：

- checkpoint 是否超时。
- pending packet 是否超过 SLA。
- peer 是否不可见。
- context 是否高于阈值。
- owner gate 是否 pending。
- nudge 是否超限。

通过条件：

- watchdog 输出可操作 checklist。
- 不直接修改业务文件。
- 不直接杀进程。
- 不绕过 owner gate。

## 10. 睡前 checklist

- [ ] owner goal 已写入 mission card。
- [ ] status board 有 active slice。
- [ ] incident log 文件存在。
- [ ] damage-control active。
- [ ] `coms_list` 能看到当前 active roles。
- [ ] HQ 不在长 `await` 中卡住。
- [ ] repair 没有 scope 外 diff。
- [ ] runner 是正式验证来源。
- [ ] oracle 未改代码。
- [ ] 下一 checkpoint 时间明确。
- [ ] owner gate 无 pending 或已明确暂停。

## 11. 醒来验收

- [ ] 8 小时内每 30-60 分钟有 checkpoint、pending reason 或 owner gate。
- [ ] status board 能重建 active slices、peer reports、verdict。
- [ ] incident log 覆盖 late / channel / transport / scope / damage-control 事件。
- [ ] 没有未授权 git add / commit / push。
- [ ] 所有写入在 allowed_paths。
- [ ] runner verification evidence 存在。
- [ ] repair self_check 没被当成 final verification。
- [ ] HQ merged report 存在。
- [ ] supervisor owner-facing summary 存在。
- [ ] future Web UI 所需 event 字段没有缺关键主键：mission_id、slice_id、actor、target、event_type、timestamp。

## 12. NO-GO 条件

出现以下任一项，Phase D 首测判 NO-GO 或 BLOCKED：

- 原 `msg_id` final reply 承载业务报告正文且未被标记 incident。
- HQ 长时间阻塞在 `await`，无人维护 status board。
- repair scope 外写入未被拦截。
- runner/oracle 写代码未被拦截。
- git add / commit / push 未授权发生。
- owner gate 被自动绕过。
- status board 缺失，无法重建过程。
- incident log 缺失，无法解释异常。
- Pi 注入路径没有加载最新 shared protocol / role prompts。
