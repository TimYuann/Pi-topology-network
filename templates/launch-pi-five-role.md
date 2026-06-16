# Pi 五角色实践模板

Pi 侧先复用角色协议，不假设已经存在 OMP 的 `coms_await` 等工具。

## 启动思路

每个 Pi session 注入：

1. `docs/01-shared-communication-policy.md`
2. `docs/02-state-machine.md`
3. 对应 `docs/roles/<role>.md`

## 传输层映射

| 协议语义 | Pi 侧实现方式 |
|---|---|
| list peers | Pi extension / package 提供，或人工维护 session 表。 |
| send message | Pi extension / package 提供，或人工复制 inbound。 |
| await reply | Pi extension / package 提供，或人工确认 direct ACK。 |
| get status | Pi extension / package 提供，或记录在共享日志。 |

## 最小实践

没有自动传输层时，仍可先验证角色纪律：

- 每条任务先 direct ACK。
- 横向消息不改变授权。
- timeout 不等于失败。
- hq 收口，oracle 独立审查，repair scoped fix，runner 只验证。

