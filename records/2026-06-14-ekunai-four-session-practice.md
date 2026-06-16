# 2026-06-14 ekunAi 四 session 实践记录

## 背景

目标是验证 `coms-omp-lite` 能否支撑真实项目中的多 session 协作，而不只是玩具通信。

## 关键事实

- 本地 OMP coms 从 `pi-vs-claude-code` 移植基线同步到 `--cname`。
- 新增 `coms-omp-lite.ts`，去掉 TUI 静态依赖，保留 `coms_list` / `coms_send` / `coms_get` / `coms_await`。
- `bun test` 3/3 通过，`bun build` 通过。
- `omp models ls -e /Users/yuantian/.omp/agent/experiments/coms-omp` 可加载 lite 入口。
- 双 OMP smoke 发现 target 必须使用裸 agent name / session id，不使用 `name@project`。
- 四 session 预热完成互相发现、星型分发、direct final text 回复、反向发送和退出清理。

## 拓扑结论

最初是 planner 星型派单，后续在 HS Code fresh smoke 中演进为 Hub-and-Mesh：

- HQ 保留目标、授权、止损和最终 verdict。
- Smoke / Oracle / Repair 之间允许直接通信。
- 横向边只传信息，不传权限。

由此形成核心命名：

```text
Persistent role mesh + ephemeral task swarm
```

## 实战价值

在 ekunAi HS fresh smoke 中，网络抓到 `test#10` 的真实 P0：repo seed 已修，但 fresh runtime `knowledge/kb.db` 未对齐，导致 `MOUNT ADAPTER` 仍回退 `8529`。

这证明 fresh smoke + mesh review 的价值：它能发现单 session 容易忽略的 runtime / DB / cache 不一致。

## 可靠性规则

- `coms_await` timeout 不等于 peer 无结果。
- HQ 必须 `coms_get` 或重新索取 last result。
- late result 必须并入 judgment。
- 接收方要直接 final text 回复原 inbound；调用 `coms_send` 是新链路。

