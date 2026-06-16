# OMP拓扑网络

OMP拓扑网络是一个面向多 Agent 协作实践的项目库。它不是只服务 OMP，也不是某一次 ekunAi / ekunCustomsWms 任务的临时记录，而是把已经跑通的 persistent role mesh、direct ACK 纪律、状态机和角色预设沉淀成可审计、可复用的工作协议。

当前定位：

- Pi 是当前主攻运行面：Phase D 面向 Pi runtime / Extension 落地，利用 Pi 的 hook、widget、tool_call interception、context health 和 coms primitive 做动态派生与监管。
- OMP 是历史验证与兼容参照：本地 `coms-omp-lite` 已在 2026-06-14 四 session smoke 与 2026-06-15 五角色实践中使用，但后续工程化不以 OMP 为主线。
- 项目级原则是 `mesh communication + centralized authority + single-writer implementation + independent review`。

## 快速入口

| 目的 | 文件 |
|---|---|
| 总览与范围 | `docs/00-overview.md` |
| Pi package MVP | `packages/pi-topology/README.md` |
| 通信协议 | `docs/01-shared-communication-policy.md` |
| ACK / pending 状态机 | `docs/02-state-machine.md` |
| OMP / Pi 启动方式 | `docs/03-startup-runbook.md` |
| Phase D Pi-first runtime | `docs/09-phase-d-runtime-design.md` |
| Phase D 8 小时测试 | `docs/10-phase-d-first-8h-test-plan.md` |
| Ghostty 多 session 启动 | `templates/pi-ghostty-launch.md` |
| 新 session 启动 / 今日规划 | `docs/06-session-bootstrap.md` |
| 审核清单 | `docs/04-acceptance-checklist.md` |
| 角色预设 | `docs/roles/` |
| 昨天/今天实践记录 | `records/` |
| 原始迁移资料 | `sources/` |
| 启动模板 | `templates/` |

## 标准拓扑

默认五角色：

- `topology-supervisor`：Phase D 的 Pi-first owner 入口，做 intake、mission card、动态派生、巡检和 owner gate。
- `governor`：owner 入口，只做目标、节奏、决策收口，不直接写代码。
- `hq`：开发工头，接 governor goal，拆解、派发、收敛判断。
- `oracle`：独立审查，风险、证据质量、GO/NO-GO，不修代码。
- `repair`：授权范围内做 scoped fix，不越权扩散。
- `runner`：测试、smoke、artifact、复现和验证，不改代码。

小规模实践可退化为四角色：`hq` / `oracle` / `repair` / `runner`。此时 owner 直接对 `hq` 下发目标，`hq` 兼任入口。

## 源材料说明

`sources/cave/` 存放从 Cave 移入的专属实践资料：

- `pi-vs-claude-code移植/`：coms OMP 移植、smoke 方案、Pi/OMP 兼容调研。
- `omp-fleet-console/`：上层控制平面草案，已作为拓扑网络后续工程化方向的历史材料。

`sources/project-handoffs/` 存放从真实项目复制来的 handoff / closeout，用来证明协议来自实战而非空想。

## Maturity Roadmap

- [成熟路线：Phase A-D](docs/08-maturity-roadmap.md)

## Handoffs

- [Phase D 一次性开发交接说明](docs/handoffs/2026-06-15-phase-d-development-handoff.md)

## Phase D

- [Pi-first Phase D Runtime Design](docs/09-phase-d-runtime-design.md)
- [Phase D 首次 8 小时测试计划](docs/10-phase-d-first-8h-test-plan.md)
- [Phase D Pi Runtime 实施路径](docs/11-phase-d-pi-runtime-implementation-path.md)
- [Pi topology package MVP](packages/pi-topology/README.md)
- 模板：`templates/mission-card.phase-d.json`、`templates/status-board.phase-d.json`、`templates/incident-log.phase-d.jsonl`
- 脚本骨架：`scripts/topology-supervisor.sh`、`scripts/topology-watchdog.sh`
