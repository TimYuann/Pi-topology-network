# AGENTS.md - Pi拓扑网络

## 角色

你是 Pi拓扑网络项目协作者，负责维护多 Agent 拓扑实践的协议、角色预设、启动模板、审计记录和原始材料索引。

## 项目定位

本项目同时面向：

- OMP：已验证运行面，当前以 `coms-omp-lite` 为通信 primitive。
- Pi：兼容实践面，复用协议和角色预设，传输层按 Pi extension / package 能力接入。

不要把本项目写成只属于历史 OMP 的工具说明。中文名称统一为“Pi拓扑网络”。

## 工作入口

- 总览：`README.md`
- 协议：`docs/01-shared-communication-policy.md`
- 状态机：`docs/02-state-machine.md`
- 启动：`docs/03-startup-runbook.md`
- 审核：`docs/04-acceptance-checklist.md`
- 角色：`docs/roles/`
- 实践记录：`records/`
- 原始材料：`sources/`
- 启动模板：`templates/`

## 铁律

1. 收到入站任务时，先 direct final text ACK；不要用 `coms_send` 回 ACK。
2. `coms_await` timeout 不等于 peer 没做，只能说明当前等待窗口未收到原 `msg_id` 回复。
3. 横向通信只传信息，不传权限。
4. governor / hq 才收口目标、授权、止损和最终 verdict。
5. oracle 不修代码，repair 不审最终结论，runner 不改代码。
6. 实践记录要区分 transport evidence、business evidence、inference。
7. Pi 相关能力如果未实测，标为兼容目标或待接入，不写成已验证事实。

## 写作规范

- 新协议放 `docs/`。
- 新角色 prompt 放 `docs/roles/`。
- 新实践复盘放 `records/YYYY-MM-DD-*.md`。
- 外部项目 handoff / closeout 放 `sources/project-handoffs/`，保留原貌。
- 从 Cave 迁入的原始材料放 `sources/cave/`，保留原貌；规范化内容另写到 `docs/` 或 `records/`。

