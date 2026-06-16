# 2026-06-15 ekunCustomsWms 五角色 ACK 复盘

## 背景

四角色实践后，网络扩展为五角色：`governor` / `hq` / `oracle` / `repair` / `runner`。

目的：让 owner 面向 governor 做决策，由 governor 下发给 hq，hq 再协调执行。

## 事件

owner 对 governor 说：

```text
同意，下发执行吧。
```

governor 行为：

1. `coms_send` 给 `hq` 成功，返回 `msg_id 01KV4X4K56X9WHZMAWJ1YVQFRR`。
2. `coms_await` 30 秒 timeout。
3. `coms_get` 显示 pending。
4. `coms_await` 120 秒 timeout。
5. `coms_get` 仍 pending。
6. `coms_list` 显示 `hq` live。
7. governor 向 owner 汇报：已下发，HQ 还没回 ACK。

owner 后续确认：HQ 实际收到了指令，但没有回复原 inbound。

## 判断

这不是纯 transport 问题，而是协议层和角色 prompt 层的问题：

- hq 没有遵守“收到 inbound 后必须直接 final text ACK”的纪律。
- governor 把 `Collect HQ acknowledgement` 当成同步必需项。
- coms 没有独立暴露 transport-level delivered / handled 状态。
- Todo 状态缺少 `degraded / ack pending / dispatched async`。

## 规范化结果

本项目把问题固化为三份规范：

- `docs/01-shared-communication-policy.md`
- `docs/02-state-machine.md`
- `docs/roles/hq.md`

关键规则：HQ 收到 governor 执行指令后，必须先 direct ACK，再做拆解和派发。

