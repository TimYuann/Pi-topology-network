# 审核清单

## 启动审核

- [ ] 所有角色使用同一个 `OMP_COMS_DIR` / project name。
- [ ] 每个角色有唯一 `--cname`。
- [ ] 每个角色 prompt 包含 direct ACK 规则。
- [ ] `coms_list` 能看到预期 peer。
- [ ] target 使用裸角色名或裸 session id。

## 通信审核

- [ ] 任务派发后，接收方先 direct final text ACK。
- [ ] ACK 没有通过 `coms_send` 返回。
- [ ] `coms_await` timeout 后没有被解释成“对方没做”。
- [ ] late result 被重新并入判断。
- [ ] 横向通信没有改变授权边界。

## 角色审核

- [ ] governor 不写代码，不直接管理 repair / runner。
- [ ] hq 负责拆解、派发、收口，不把所有执行都塞给自己。
- [ ] oracle 只审查，不修代码。
- [ ] repair 只做授权范围内的 scoped fix。
- [ ] runner 只做验证、复现、artifact，不改代码。

## 完成审核

- [ ] 最终汇报区分 transport evidence、business evidence、inference。
- [ ] 所有关键 msg_id / artifact / test command 可追溯。
- [ ] 没有把 `needs_review` 写成 full pass。
- [ ] 没有把 runtime DB / cache / artifact 混进代码提交，除非 owner 明确授权。

## Phase D 8 小时自运行验收

- [ ] 启动脚本 preflight 通过。
- [ ] 第一个入口是 Pi `topology-supervisor` session，并先完成项目 intake / mission card / owner approval。
- [ ] supervisor 派生或恢复的 session 全部加载 shared protocol + role prompt。
- [ ] HQ 只能请求 spawn/close；实际 open/kill 由 supervisor 或 owner 执行。
- [ ] mission card 明确 allowed_paths / forbidden_actions / stop conditions。
- [ ] mission card 明确 spawn policy / report target / verification contract。
- [ ] 8 小时内没有 scope 外写入。
- [ ] 8 小时内没有未授权 git add / commit / push。
- [ ] 每 30-60 分钟有 checkpoint、pending reason 或 owner gate。
- [ ] Runner 是正式验证来源；Repair 只提供 self_check。
- [ ] Repair 如直接请求 Runner 验证，必须引用 HQ 的 `verification_contract` / `authority_source`。
- [ ] Oracle 不写代码，只提供 review verdict。
- [ ] HQ 所有下游 packet 遵守 Downstream Packet Wording Contract。
- [ ] REPORT / STATUS / CHECKPOINT / AUTHORIZATION 均走 `coms_send` business packet channel。
- [ ] 原 `msg_id` final reply 未承载业务报告正文。
- [ ] `coms_await` 未被用于等待 repair / smoke / long verification completion。
- [ ] nudge 没有超过限频。
- [ ] incident log 包含 late / complete_empty / channel_violation / packet_wording_violation。
- [ ] damage-control block / owner gate / context_high 事件进入 incident log 或 status board。
- [ ] 醒来后能从 status board + devlog + artifacts 重建 8 小时过程。
