---
obsidian-note-type: project-index
target: agent-lab
project: pi-vs-claude-code-to-omp
created: 2026-06-14
source-priority: official-github-source
tags: [omp, pi, harness, extension, migration, coms]
---

# pi-vs-claude-code -> OMP 移植

> 目标：把 `disler/pi-vs-claude-code` 里适合 Agent Lab / OMP 的 harness primitive 做成可维护的 OMP 应用路线，而不是一次性搬代码。

## 当前结论

`pi-vs-claude-code` 是一个 Pi extension playground / harness 样板库。它自身更新不算频繁，但它依赖的 OMP 下游更新极快，所以真正风险不在源仓库，而在 OMP ExtensionAPI / CLI / TUI / session internals 的持续变化。

当前建议：

| 优先级 | 对象 | 处理方式 |
|---|---|---|
| P0 | `coms` | 已有历史 OMP port，可继续维护；先补兼容 smoke |
| P0 | `damage-control-continue` | 高价值，建议移植为 OMP hook / extension 安全层 |
| P0 | `system-select` | 可吸收为 persona / agent prompt 切换层 |
| P1 | `cross-agent` | 概念高价值，但 OMP 已有多生态 skills/agents 加载，先做差异审计 |
| P1 | `purpose-gate` / `tilldone` | 工作纪律能力，适合轻量移植 |
| P2 | `agent-team` / `agent-chain` / `subagent-widget` / `pi-pi` | 与 OMP `task` / Agent Hub 重叠，优先提炼模式，不急着搬代码 |

## 本地资料

| 类型 | 路径 |
|---|---|
| 本轮严格评审 | [[严格评审-2026-06-14]] |
| Coms 本地嵌入方案 | [[Coms本地嵌入方案-2026-06-14]] |
| **上层 Fleet Console 选型调研** | **[[Fleet-Console-可行性调研-2026-06-14]]**（OpenClaw / Hermes vs 我们的 OMP Mesh，决策清单） |
| Cave 内 coms 端口基线 | `ports/coms-omp/` |
| 源仓库 clone | `Agent-Lab/Raw/GitHub备份/pi-vs-claude-code/` |
| OMP 官方源码 clone | `Agent-Lab/Raw/GitHub备份/oh-my-pi/` |
| 上轮 Codex handoff | `/Users/yuantian/Documents/Codex/2026-06-14/omp-hard-disk-omp-harness-subagent/outputs/pi-vs-claude-code-initial-handoff.md` |
| 历史 OMP coms port | `/Users/yuantian/Documents/Coding/omp-coms-port/`（Cave 外，只读吸收） |

## 维护原则

1. 所有真正移植代码要有最小 smoke：extension load、flag parse、tool schema registration、一个真实工具调用。
2. 优先用 OMP 当前公开 API：`pi.zod` / `pi.typebox`、`registerTool`、`registerCommand`、`registerFlag`、`sendMessage`、`sendUserMessage`、稳定 lifecycle events。
3. 避免依赖 OMP 内部 session storage / TUI renderer / undocumented object shape。必须依赖时，把路径和版本写进评审表。
4. 每次 OMP 升级后先跑兼容 smoke，再谈功能扩展。

## 下一轮入口

1. **Coms 项目**——先做 `coms` 的现状复核：

- 把 `/Users/yuantian/Documents/Coding/omp-coms-port` 的经验整理进 Cave。
- 用本机 OMP `v15.12.4` 与源码 `v15.12.6` 重新跑 `coms-omp.ts` 的 extension load / flag parse / two-session transport smoke。
- 删除过时验证命令中的 `--list-models`，改为 `omp models ...`。
- 当前 Cave 端口已改为 `--cname`，跟上源仓库 2026-06-03 最新变动。
- 直接从 Cave 深路径 `-e` 会因为 `@oh-my-pi/*` 解析失败；第一轮已改为 `coms-omp-lite.ts`，默认安装到 `~/.omp/agent/experiments/coms-omp` 后显式 `-e`。
- 2026-06-14 实测：`coms-omp-lite.ts` 在 Cave 内 `bun test` 3/3 通过、`bun build` 通过，并能被本机 `omp models ls -e /Users/yuantian/.omp/agent/experiments/coms-omp` 加载；剩余报错来自本机既有插件，不是 coms。
