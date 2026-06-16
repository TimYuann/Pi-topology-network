# OMP 拓扑网络成熟路线

## 目标

在网络稳定、token 充裕的情况下，系统可以稳定自运行超过 8 小时，并通过 gate 防止乱跑、越权修改和无效 token 消耗。

## 成熟阶段

### Phase A — 固定 5 session，稳定协议

形态：

```text
governor / hq / oracle / repair / runner 常驻
```

目标：

- coms 通信稳定。
- Direct ACK / Result Return / Lifecycle Reply Contract 生效。
- HQ 不启动同名 subagent。
- Oracle / Runner / Repair 都通过 `coms_send` 回传 REPORT。
- Repair / Runner 验证边界清楚。

当前状态：基本完成，但仍需通过长任务回归验证。

### Phase B — HQ 请求派生，Supervisor 执行

形态：

```text
governor 常驻
hq 常驻
oracle / runner / repair 按需派生
```

目标：

- HQ 可以发 `SPAWN REQUEST` / `CLOSE REQUEST`。
- `topology-supervisor` 校验 role、scope、TTL、allowed_paths、forbidden_actions 后执行。
- HQ 不能直接 open/kill session。
- 派生 session 自动注入 shared protocol + role prompt。

必要 gate：

- spawn gate：只允许已知角色。
- scope gate：必须带 mission_id / slice_id / allowed_paths / forbidden_actions。
- budget gate：必须带 TTL / context limit / nudge limit。
- damage gate：repair 只能写授权路径；runner/oracle 禁止写。
- close gate：无 pending msg、report 已回传、status board 已更新后才能关闭。

### Phase C — Worker Pool + TTL + Auto Archive

形态：

```text
governor 常驻
hq 常驻
worker pool 动态增减
```

目标：

- worker 按 slice 派生。
- 每个 worker 有 TTL、context budget、scope budget。
- 完成后自动 archive session summary。
- status-board.json 维护 active / pending / archived / failed workers。
- late / complete_empty / channel_violation 自动进入 incident log。

### Phase D — Pi-first 8 小时自运行测试

形态：

```text
topology-supervisor 作为第一个 Pi session
hq 按 mission 必要派生
repair / runner / oracle 按需动态派生或复用
watchdog / supervisor 每 5-10 分钟巡检
```

目标：

- 自运行 8 小时不需要人工搬运消息。
- owner 先和 topology-supervisor 对齐项目状态与今日计划，再批准 mission card。
- supervisor 能启动或恢复所需角色 session。
- 不越权写文件。
- 不 commit / push。
- 不重复 nudge。
- 每 30-60 分钟产生 owner-facing checkpoint。
- 睡前启动后，醒来能看到完整 status board、incident log、artifacts、verification evidence。

Phase D 不追求“无人做所有决定”。遇到 owner-decision gate 必须暂停并等待 owner，不允许自作主张。

## Phase D 首次 8 小时测试准入

启动前必须满足：

- 启动脚本 preflight 通过。
- shared protocol 包含 Lifecycle Reply Contract、Role Behavior State Machine、Hop Policy、Wait Window / Nudge Policy。
- HQ prompt 包含 Downstream Packet Wording Contract、Verification Separation Gate、HQ Behavior State Machine。
- Repair prompt 包含 Repair / Runner Verification Separation。
- topology-supervisor 入口明确：先 intake / mission approval，再 dynamic spawn。
- 明确 mission card、allowed_paths、forbidden_actions。
- 明确 stop conditions。
- 禁止 git add / commit / push，除非 owner 单独授权。
- 确认 status board / incident log / devlog 落盘位置。

## Phase D 首次测试建议配置

当前 Phase D 目标是直接验证动态派生，但必须由 topology-supervisor 执行。HQ 可以请求 spawn/close，不能直接 open/kill session。若 Pi runtime 派生能力临时不可用，允许降级为 supervisor 打印 Ghostty 启动命令，由 owner 人工执行；这仍视为 supervisor-controlled dynamic spawn，不退回 OMP-first 固定五角色口径。

建议：

```text
mode: pi-dynamic-spawn
duration: 8h
entry_role: topology-supervisor
checkpoint_interval: 30-60m
watchdog_interval: 5-10m
repair_execution_window: 20-30m
repair_nudge_limit: 1 / 15m
commit_push: forbidden
owner_gate: required for scope expansion
```

固定五角色只作为 emergency fallback 或 protocol regression smoke，不再作为 Phase D 的目标形态。

## Stop Conditions

出现以下情况必须暂停并回报 owner：

- scope 外文件写入需求。
- destructive command 需求。
- git add / commit / push 需求。
- owner decision 不明确。
- HQ 连续两次 missing report。
- repair 触发 forbidden path / forbidden action。
- runner/oracle 尝试写代码。
- 同一 peer 重复 nudge 超限。
- context 接近上限且无 archive/summary。
- coms registry 异常或 peer 不可见。
- hop_limit 触发且无法确认是合法 reply-to-sender。
