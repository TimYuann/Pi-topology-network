# Package Hub 就绪评估（v0.1）

面向 `pi-topology` 的发布前检查清单。  
目标：避免把未验证能力写成已验证事实。  
更新规则：仅当“本地实测 + 可复现证据”满足后再改为 `READY`。

## 就绪矩阵

| 项目 | 状态 | 证据 / 说明 | 风险 |
|---|---|---|---|
| `package.json` 包结构完整 | READY | `name/version/license/files/pi.extensions/pi.skills` 已配置 | 无 |
| 本地 transport（local-coms） | READY | `outbox.jsonl` + peer registry 写入/读取实现 | 无 |
| Packet-first schema 与 guard | READY_LOCAL | `topology_packet` + direct reply 守卫 + 写权限与范围门禁实现；`npm run guard-smoke` 写入 8 条 incident/runtime-event 证据；空 packet body 已被 schema 拦截 | 真实 Pi 内置写工具 hook 仍需在有写工具的会话中复测 |
| Mission card 产物 | READY | `createMissionDraft`/`validateMissionCard` 已有约束 | 需更多字段级约束用例 |
| status board / incident log / runtime event | READY | `.pi/topology/*` 持久化路径与 append 写入机制到位 | 需加跨进程并发覆盖 |
| `topology_init_mission` | READY_LOCAL | 2026-06-16 direct Pi offline smoke 与 MiniMax/Ghostty clean dogfood 写入 mission/status/runtime-events | 与 dashboard/UI 联动未验证 |
| `topology_status` | READY_LOCAL | 2026-06-16 supervisor 与 6 role direct Pi offline smoke、MiniMax/Ghostty role smoke 均调用通过 | 与 dashboard/UI 联动未验证 |
| `topology_doctor` | READY_LOCAL | 2026-06-16 direct Pi offline smoke 与 MiniMax/Ghostty clean dogfood 记录 watchdog_finding runtime events | 看门狗收口策略仍需更长 dogfood |
| `topology_smoke` | READY_LOCAL | 工具名和单元测试存在；script smoke 主路径使用 status/doctor/packet；真实 provider dogfood 已覆盖 supervisor/role 主路径 | 仍需更长任务流复测 |
| `topology_spawn_role` | READY_LOCAL | 支持 `initial_prompt` / `log_path`，launch script tee 落证；2026-06-16 MiniMax/Ghostty clean dogfood 通过 `mode=launch` 启动 HQ 并写入同一 runtime/outbox | 长时间多轮 spawn 仍需复测 |
| `topology_send` / `topology_get` / `topology_list` | READY_LOCAL | 2026-06-16 unit smoke + direct Pi offline smoke + MiniMax/Ghostty clean dogfood；outbox/inbox/runtime-events 均落盘 | HTTP/SSE transport 不在本地 ready 范围 |
| `topology_cleanup` | PARTIAL | 工具名和注册测试存在 | 清理幂等性与边界场景未验 |
| real `pi install .` | READY | 2026-06-16 本地执行 `pi install .`，输出 `Installed .` | 仍需发布前复跑 |
| 实际多 session Ghostty/Pi role smoke | READY_LOCAL | 2026-06-16 MiniMax M3 + Ghostty clean dogfood 覆盖 `hq` / `repair` / `runner` / `oracle` / `librarian` / `scott`，每个角色写入非空 local packet；run root `/tmp/pi-topology-dogfood-minimax-clean-2026-06-16` | 仅验证 local JSONL transport，不验证 HTTP/SSE |
| HTTP/SSE transport（net-coms） | COMPATIBILITY_TARGET | 代码中标注为 compatibility target | 视为未来版本目标，当前不纳入生产承诺 |
| package hub 发布与更新 | PENDING | 未走正式发布流程 | 阻塞 |

## 发布前最小门（建议）

- 先跑本地 dogfood：`install` -> `dogfood` -> `doctor` -> `cleanup`。
- 录入一次真实任务的 mission/status/incident/runtimelog 证据。
- 至少一次 `topology_doctor` 触发后无阻塞风险。
- `pi install .` + `pi` 加载 + 2 名角色 + 1 次 packet 往返通过手工复核。
- 通过后再评估 hub metadata 与版本发布策略。

## 处理策略

当任一 PENDING/COMPATIBILITY_TARGET 存在时，Hub 文档应保留以下标注：

- `此项未在真实运行环境验证，仅作为当前兼容目标`
- `变更此项需补充新的 smoke/test 证据再发布`

任何发布说明必须把 `owner gate`、`scope guard`、`incident log` 写入路径一并列出。

## 本地资源控制

- Ghostty dogfood 每轮使用独立 `PI_TOPOLOGY_RUN_ROOT`。
- 每轮完成或判定污染后，关闭该轮 Ghostty/Pi 进程；保留 `logs/`、`outbox.jsonl`、`runtime-events.jsonl` 作为证据。
- `ghostty-supervisor-smoke.sh` 与 `ghostty-role-smoke.sh` 默认不等待 Enter；只有显式设置 `PI_TOPOLOGY_WAIT_ON_EXIT=1` 才保留窗口。
