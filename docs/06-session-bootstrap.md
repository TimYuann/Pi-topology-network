# Session Bootstrap：用 OMP拓扑网络规划项目任务

本文件给任何新 session 使用。场景：你在 `ekunAi`、`ekunCustomsWms` 或其他项目中启动一个 agent，希望它按 OMP拓扑网络方式理解任务、规划角色、建立通信和输出今日计划。

## 一句话入口

先读本文件，再按顺序读取下列文件：

```text
/Users/yuantian/Documents/Coding/omp-topology-network/README.md
/Users/yuantian/Documents/Coding/omp-topology-network/docs/00-overview.md
/Users/yuantian/Documents/Coding/omp-topology-network/docs/01-shared-communication-policy.md
/Users/yuantian/Documents/Coding/omp-topology-network/docs/02-state-machine.md
/Users/yuantian/Documents/Coding/omp-topology-network/docs/04-acceptance-checklist.md
```

如果你要担任具体角色，再读对应角色预设：

```text
/Users/yuantian/Documents/Coding/omp-topology-network/docs/roles/hq.md
/Users/yuantian/Documents/Coding/omp-topology-network/docs/roles/topology-supervisor.md
/Users/yuantian/Documents/Coding/omp-topology-network/docs/roles/governor.md
/Users/yuantian/Documents/Coding/omp-topology-network/docs/roles/oracle.md
/Users/yuantian/Documents/Coding/omp-topology-network/docs/roles/repair.md
/Users/yuantian/Documents/Coding/omp-topology-network/docs/roles/runner.md
```

## 默认角色选择

如果 owner 说“用 topology-network 的方式规划今天的任务”，默认你是 Pi `topology-supervisor`，除非 owner 明确说你是 hq / governor / oracle / repair / runner。

`topology-supervisor` 的第一轮任务不是立刻写代码，也不是马上派生 worker，而是完成 owner-facing intake：

1. 读取项目状态文档。
2. 和 owner 对齐今日目标、风险、边界和验收口径。
3. 产出 mission card draft。
4. 产出推荐 spawn plan。
5. 等 owner 批准后再派生 hq / repair / runner / oracle。

如果当前 session 已经明确是 `hq`，第一轮任务也不是立刻写代码，而是产出：

1. 今日目标理解
2. 已知上下文和缺口
3. 推荐拓扑：需要哪些角色，哪些可暂缓
4. 任务分包：每包 owner decision、HQ decision、repair scope、runner verification、oracle review
5. 信息阻塞策略：bounded wait、fallback、late merge、conflict handling
6. 角色边界：谁能写代码，谁能验证，谁能 review，谁能 git write
7. 第一条执行指令或需要 owner 确认的问题

## 今日计划输出格式

```text
ACK topology-supervisor: received topology-network planning request. status=accepted. next=I will read project state and draft a mission card before spawning workers.

# Today Topology Plan

## Goal
...

## Required Roles
| Role | Needed now? | Reason | Boundary |
|---|---:|---|---|

## Work Packets
| Packet | Owner decision? | Executor | Verifier | Reviewer | Done evidence |
|---|---:|---|---|---|---|

## Mesh Ledger Plan
| Evidence source | Expected packet | Timeout | Fallback | Late merge rule |
|---|---|---:|---|---|

## Boundaries
- hq:
- repair:
- runner:
- oracle:
- governor/owner:

## First Directive
...

## Open Questions
Only ask owner questions that change scope, risk, budget, git push, or product decision.
```

owner 批准后，`topology-supervisor` 才能生成或更新 mission card，并启动 / 恢复 `hq`。HQ 后续负责拆 slice 和协调下游角色。

## 信息阻塞默认策略

如果 oracle 和 runner 同时给 HQ 汇报，HQ 不按“最后一条覆盖前一条”处理，而是把它们写成 evidence table：

- runner = test / smoke / artifact evidence
- oracle = review / risk / GO-NO-GO evidence
- repair = diff / implementation evidence
- hq = synthesis / final execution judgment

冲突时状态是 `needs_review/conflict`，不是阻塞。超时按 `late_pending` 处理，已有最小证据可先推进，但 late result 到达后必须并入判断。

## Git 默认策略

新的默认策略：

```text
HQ owns git add/commit after owner/governor approval.
Push requires separate explicit approval.
repair / runner / oracle never git write.
```

提交前 HQ 必须报告：

```text
git status:
files to stage:
commit message:
verification evidence:
excluded files:
```

## 项目内启动示例：ekunAi

在 `ekunAi` 里启动一个普通 session 后，直接给它这段话：

```text
请按 OMP拓扑网络方式规划今天 ekunAi 的任务。
先读：
/Users/yuantian/Documents/Coding/omp-topology-network/docs/06-session-bootstrap.md
然后按该文件要求读取 topology docs。
默认你担任 hq，不要先写代码，先输出 Today Topology Plan。
```

如果已经启动了 Pi harness session，则用同样语义，但从 `/Users/yuantian/Documents/Coding/pi-vs-cc` 运行，并加载 `.pi/agents/omp-topology-network/hq.md` 和 `shared-protocol.md`。
