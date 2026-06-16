# Pi Topology Official API Audit

日期：2026-06-16
项目：OMP拓扑网络 / `packages/pi-topology`
结论：整体已接近 Pi 官方 extension / package / session 模型，当前最大缺口是 native session 派生尚未实装，skill discovery 已在本轮修正。

## 审计范围

官方文档：

- [Sessions](https://pi.dev/docs/latest/sessions)
- [Extensions](https://pi.dev/docs/latest/extensions)
- [Skills](https://pi.dev/docs/latest/skills)
- [Packages](https://pi.dev/docs/latest/packages)

本地参考：

- `sources/external/pi-crew/package.json`
- `sources/external/pi-crew/index.ts`
- `sources/external/pi-crew/src/extension/register.ts`
- `sources/external/pi-crew/src/ui/pi-ui-compat.ts`
- `sources/external/pi-crew/src/extension/registration/commands.ts`
- `sources/external/pi-crew/src/extension/registration/viewers.ts`

## 官方 API 对齐表

| 能力面 | 当前实现 | 官方对齐状态 | 备注 |
| --- | --- | --- | --- |
| Extension entry | `packages/pi-topology/index.ts` default export | 已对齐 | 与 Pi package extension 入口模型一致 |
| Package manifest | `package.json` 的 `pi.extensions` / `pi.skills` | 已对齐 | 目录包安装应按 package 规则发现资源 |
| Skill discovery | `resources_discover` 返回 package `skills` 目录 | 本轮修正 | 覆盖 `pi -e ./index.ts` 开发加载路径 |
| Custom commands | `/topology` / `/topology-status` / `/topology-dashboard` | 已对齐 | 使用 `pi.registerCommand` |
| Custom tools | `topology_*` 工具 | 已对齐 | 已补 `promptSnippet / promptGuidelines` |
| Runtime lifecycle | `session_start` / `session_shutdown` | 已对齐 | 后台 endpoint 与 UI heartbeat 在 session 生命周期内启动/清理 |
| Session entries | inbound packet 先 `appendEntry("topology-packet", ...)` | 已对齐 | 非行动型 packet 不再默认触发 LLM turn |
| Agent wake-up | `sendMessage(... followUp, triggerTurn: true)` | 已对齐 | 仅用于 actionable packet 和 supervisor bootstrap |
| UI dashboard | `ctx.ui.setStatus` / `ctx.ui.setWidget` | 已对齐 | 底部 Dashboard 属于官方 widget/status 能力 |
| Deterministic choice UI | 尚未用于 supervisor gate | 待接入 | 需要固定选择体验时应使用 `ctx.ui.select` 或 `ctx.ui.custom` |
| Native session spawn | 仍以 visible peer launch script 为主 | 待接入 | 未来可评估 `ctx.newSession / fork / switchSession`，但不能破坏可见性 Mesh |
| HTTP/SSE transport | 文档中仍作为兼容方向 | 待接入 | 未实测，不写成已验证事实 |

## 本轮已修问题

问题：

- 裸 `/topology` 或 `/skill:topology-runtime` 在开发加载路径下可能找不到 package 内置 skill。
- 失败时 Pi 会尝试全局路径：`~/.pi/agent/skills/topology-runtime/SKILL.md`。

原因：

- `package.json` 的 `pi.skills` 适合 package 目录加载。
- `pi -e /path/to/index.ts` 是单 extension 开发加载，不保证按 package 资源规则收集 skill。
- 扩展原先没有实现官方 `resources_discover`。

修复：

- 在 extension 注册 `resources_discover`。
- 返回 `packages/pi-topology/skills`。
- 新增单测锁住该行为。

## pi-crew 可借鉴点

已借鉴：

- `resources_discover` 返回 extension/package 的 skill directory。
- background resources 延迟到 `session_start`，并在 `session_shutdown` 做 best-effort cleanup。

可继续借鉴：

- `ctx.ui.custom` overlay dashboard：适合未来 owner gate 或 role selection。
- `ctx.ui.select`：适合把当前“选 1/2/3”的文本流程升级成官方 TUI 选择。
- UI compatibility wrapper：适合未来把 `setWidget / setStatus / custom` 的兼容判断集中到一处。

暂不借鉴：

- pi-crew 的 worker skill prompt 注入体系更重，目前 OMP拓扑网络只需要让 Pi 官方 skill discovery 找到 package skill。

## 关于第一步终点不一致

当前观察到两类现象：

1. 出现 Pi 内置选择组件。
2. 模型让用户输入 1/2/3。

判断：

- 官方组件只会来自 extension 代码显式调用 `ctx.ui.select / confirm / input / custom`，或 Pi 自身内置命令如 `/tree` 的 session branch summary 流程。
- `/topology` supervisor bootstrap 当前主要通过 `pi.sendMessage(... followUp, triggerTurn: true)` 注入任务文本，因此后续“选 1/2/3”通常是模型生成的文本交互。
- 如果要让 topology 第一阶段终点稳定为内置选择，应该把 owner gate / phase gate 改为明确的 `ctx.ui.select` 或 `ctx.ui.custom`。

## 剩余风险

1. 真实 Pi TUI 已用 `pi --offline --no-session -e .../packages/pi-topology/index.ts --approve` 验证 `/skill:topology-runtime` 可加载 package skill，未复现全局路径 ENOENT。
2. visible peer launch script 仍是当前可见性 Mesh 的核心，尚未替换为 Pi native session API。
3. `.pi/topology` 是运行证据目录，当前被 `.gitignore` 排除；这符合本地状态不入库的原则，但关键复盘必须继续写入 `records/`。
4. Pi 相关未实测能力必须继续标注为兼容目标或待接入。
