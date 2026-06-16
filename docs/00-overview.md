# OMP拓扑网络总览

## 一句话

OMP拓扑网络 = 长驻角色网格 + 短生命周期任务群，用明确的权限边界和 ACK 状态机，把多个 Agent 从“互相聊天”变成“可审计地协同工作”。

## 核心结论

生产级 agentic coding 的推荐形态不是纯单 session、纯中心化或纯网状，而是：

```text
mesh communication + centralized authority + single-writer implementation + independent review
```

解释：

- mesh communication：角色之间允许直接传递信息，减少所有消息都压到中心的延迟。
- centralized authority：目标、授权、止损和最终 verdict 收口到 governor / hq。
- single-writer implementation：同一代码面尽量只允许一个执行角色写，避免多 writer 冲突。
- independent review：审查角色不修代码，保持判断独立。

## 适用对象

本项目保留两类运行面的资料，但当前 Phase D 主攻 Pi：

| 运行面 | 状态 | 使用方式 |
|---|---|---|
| Pi | 当前主攻 | 在 Pi runtime / Extension 中组合 coms、damage-control、widget、context health 和动态派生能力。 |
| OMP | 历史验证与兼容参照 | 使用 `coms-omp-lite` + `--cname` 的实践证明了 direct ACK、状态机和角色边界的必要性。 |

## 两类 Agent

| 类型 | 生命周期 | 用途 |
|---|---|---|
| Persistent role mesh | 长驻 | governor / hq / oracle / repair / runner，承接项目级责任。 |
| Ephemeral task swarm | 短生命周期 | 局部搜索、probe、测试、diff review、一次性验证。 |
| Topology supervisor | 入口控制面 | owner-facing Pi session，读取项目状态、生成 mission card、派生角色、巡检和维护 status board。 |

长驻角色负责连续性和审计，短生命周期任务负责吞吐和隔离。

## 已知实践来源

- 2026-06-14 ekunAi HS fresh smoke：四 session 从星型派单演进为 Hub-and-Mesh，并抓到 `MOUNT ADAPTER` runtime DB 未对齐的真实 P0。
- 2026-06-15 ekunCustomsWms：五角色加入 `governor` 后暴露出 HQ direct ACK 缺失，推动 ACK / pending 状态机规范化。
