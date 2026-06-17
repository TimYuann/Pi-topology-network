# v0.5 Release Readiness — Pi Topology Mission Runtime

日期：2026-06-17
项目：OMP拓扑网络 / `packages/pi-topology`
版本：v0.5
状态：✅ Ready for Reviewer approval
HEAD：`b02df33 docs(pi-topology): v0.5 release readiness`
范围：`docs/13` PRD v0.5 + `docs/14` Spec v0.5
**不实现**：`docs/15` v0.6 hardening notes（不是 PRD/Spec，也不是 v0.5 release blocker）

## 1. Scope Boundary

### 1.1 v0.5 IN-SCOPE（已完成）

Per `docs/13` PRD v0.5 + `docs/14` Spec v0.5:

| 文档章节 | 内容 |
|---|---|
| §3.1-3.4 | Per-Mission directory layout + active pointer + mission registry |
| §4.1 | Mission lifecycle state machine (12 states + 7 legacy progress states) |
| §4.2 | Session liveness (20s heartbeat / 10min resume / 5-state classification) |
| §4.4 | Packet state machine (11 states + ACTIVE/TERMINAL split) |
| §4.6 | Incident states |
| §5 | Supervisor mission picker (3 modes × 6 categories × 7 actions) |
| §6 | Role launch and resume (per-role policies + role lifecycle) |
| §7 | Inbox cleanup and stale packet marking |
| §10 | UI / Footer / Status (8-field dashboard) |
| §12 | Migration from legacy single-Mission layout |
| §13 | 7-slice implementation roadmap |

### 1.2 v0.5 NOT IN-SCOPE / Deferred（不在 roadmap 里）

- legacy `topology_status` 工具迁移到 dashboard（保留为可读 fallback；Reviewer 在 slice 6 接受不阻断）
- bare `/topology` 命令迁移（已升级为 3-branch routing，dashboard-first）
- `topology_doctor` / `topology_smoke` 多 Mission 检查
- 跨 Mission diff/compare
- `missions/<id>/closeout.json` 写入 helper
- Dashboard 自动 refresh（hook-based push）
- `include_history=true` 历史 viewer

### 1.3 v0.6 OUT-OF-SCOPE（per user instructions，本版本不实现）

Per user: **不要实现 docs/15 v0.6 hardening notes；不是本版 PRD/Spec，也不是 release blocker**。

`docs/15` v0.6 hardening notes 是 forward-looking parking lot，包含：
- Canonical Write and Root Mirror Invariants
- Active Mission Guard in Generated Launch Scripts（embedded_mission_id / embedded_role / embedded_policy_hash / embedded_script_generation_event_id）
- Resume Classification Precedence Audit
- Write Ordering Audit
- Schema Validation Completeness
- Error Precedence (defer hard failure vs soft warning)
- Recovery Rules
- Edge-Case Precedence

这些是 v0.6 的 backlog，**不阻塞** v0.5 release。

## 2. Roadmap Completion Evidence

### 2.1 Slice commits（7 main + 11 hotfix = 18）

```
5c8584f slice(1): add mission registry layout
055e821 fix(slice-1): address 3 reviewer findings (progress_status, path safety, active_id validation)
d752a85 fix(slice-1.2): close active_mission_id empty-missions boundary
81f26b4 slice(2): add supervisor picker and mission actions
230b464 fix(slice-2.1): address 2 reviewer findings (event_id traceability, archived gate)
11fb51d fix(slice-2.2): correct appendMission* Omit types to allow optional event_id
b88ebe1 slice(3): add session registry semantics and role liveness classification
36a4f11 fix(slice-3.1): close launch-attempt freshness window and revert mission-events type signature
7d911a3 slice(4): add inbox cleanup and stale packet marking
0e52daa fix(slice-4.1): close actionable-type leak in pending_packet_count and all-active reads
8a2d218 fix(slice-4.2): defensive mission_id filter in populatePendingPacketCountForMission
c2c1e87 slice(5): add per-Mission dashboard for multi-Mission state
856b1c4 fix(slice-5.1): degrade gracefully on invalid active mission_id (no throw)
f63d337 slice(6): migrate legacy single-Mission layout to per-Mission layout
aaa884f fix(slice-6.1): close two migration audit / entry-stability gaps
8ebe6f2 slice(7): final dogfood acceptance run with direct generated-script launches
2bdf3c3 fix(slice-7.1): cleanup pi-stub dir and tighten dogfood launch assertions
56abd2f fix(slice-7.2): close the remaining pi-stub-* leak in createPiStubDir
```

### 2.2 Handoff docs（22 个）

```
records/2026-06-17-pi-topology-mission-runtime-prd-review.md
records/2026-06-17-pi-topology-mission-runtime-spec-review.md
records/2026-06-17-pi-topology-mission-runtime-api-audit.md
records/2026-06-17-pi-topology-slice-1-handoff.md
records/2026-06-17-pi-topology-slice-1-1-handoff.md
records/2026-06-17-pi-topology-slice-1-2-handoff.md
records/2026-06-17-pi-topology-slice-2-handoff.md
records/2026-06-17-pi-topology-slice-2-1-handoff.md
records/2026-06-17-pi-topology-slice-2-2-handoff.md
records/2026-06-17-pi-topology-slice-3-handoff.md
records/2026-06-17-pi-topology-slice-3-1-handoff.md
records/2026-06-17-pi-topology-slice-4-handoff.md
records/2026-06-17-pi-topology-slice-4-1-handoff.md
records/2026-06-17-pi-topology-slice-4-2-handoff.md
records/2026-06-17-pi-topology-slice-5-handoff.md
records/2026-06-17-pi-topology-slice-5-1-handoff.md
records/2026-06-17-pi-topology-slice-6-handoff.md
records/2026-06-17-pi-topology-slice-6-1-handoff.md
records/2026-06-17-pi-topology-slice-7-handoff.md
records/2026-06-17-pi-topology-slice-7-1-handoff.md
records/2026-06-17-pi-topology-slice-7-2-handoff.md
records/2026-06-17-pi-topology-dogfood-run-smoke.md
```

### 2.3 关键模块（21 runtime modules）

```
src/runtime/mission.ts                          (legacy baseline, untouched)
src/runtime/mission-lifecycle.ts                (slice 1)
src/runtime/mission-registry.ts                 (slice 1)
src/runtime/mission-pointer.ts                  (slice 1)
src/runtime/mission-layout.ts                   (slice 1)
src/runtime/mission-events.ts                   (slice 2)
src/runtime/launch-metadata.ts                  (slice 2)
src/runtime/supervisor-picker.ts                (slice 2)
src/runtime/mission-actions.ts                  (slice 2)
src/runtime/mission-path.ts                     (legacy baseline)
src/runtime/role-session.ts                     (slice 3)
src/runtime/packet-ledger.ts                    (slice 4)
src/runtime/dashboard.ts                        (slice 5)
src/runtime/migration.ts                        (slice 6)
src/runtime/dogfood.ts                          (slice 7)
src/runtime/spawn.ts                            (legacy baseline)
src/runtime/root-mirror.ts                      (slice 1)
src/runtime/status-board.ts                     (legacy baseline)
src/runtime/packet.ts                           (legacy baseline)
src/runtime/guard.ts                            (legacy baseline)
src/runtime/watchdog.ts                         (legacy baseline)
```

### 2.4 Tests

| 类型 | 文件数 | 测试数 |
|---|---|---|
| Unit tests (`test/unit/`) | 20 | 297 |
| Integration tests (`test/integration/`) | 1 | 1 (dogfood) |
| **Total** | **21** | **298** |

Unit 测试包括：mission-registry, mission-events, launch-metadata, supervisor-picker, mission-actions, role-session, packet-ledger, dashboard, migration, extension, mission, packet, mission-pointer, mission-layout, state-transport, mission-lifecycle, root-mirror, launch-scripts, packet-pipeline, mission-actions-suite.

Integration tests：dogfood acceptance run。

### 2.5 Source size

```
src runtime modules: 21 files, ~9,852 lines of TypeScript
```

## 3. Final Release Readiness Validation

### 3.1 Pre-run cleanup（Node tmpdir）

```bash
$ find "$(node -e 'console.log(require("node:os").tmpdir())')" -maxdepth 1 -type d -name 'pi-stub-*' | wc -l
0
```

### 3.2 `npm test`（unit tests）

```
# tests 297
# pass 297
# fail 0
```

### 3.3 `npm run dogfood`（integration test）

```
# tests 1
# pass 1
# fail 0
# duration_ms 1028.811333
```

### 3.4 `npm run smoke`（typecheck + pack）

```
> typecheck: strip-types import ok
> tarball: pi-topology-network-0.1.0.tgz
> package size: 112.5 kB (slice 7.1: 112.4 kB, +0.1 kB)
> total files: 62
```

### 3.5 Post-run Node tmpdir cleanup check

```bash
$ find "$(node -e 'console.log(require("node:os").tmpdir())')" -maxdepth 1 -type d -name 'pi-stub-*' | wc -l
0

$ find "$(node -e 'console.log(require("node:os").tmpdir())')" -maxdepth 1 -type d -name 'pi-topology-dogfood-*' | wc -l
0

$ ls -d /tmp/pi-stub-* /tmp/pi-topology-dogfood-* 2>/dev/null | wc -l
0
```

**0 残留**（Node tmpdir + /tmp + system tmp 全部验证）。

### 3.6 Dogfood evidence (10 + 3 fields)

`records/2026-06-17-pi-topology-dogfood-run-smoke.md`:
1. launch_mode: `direct-script-with-pi-stub`
2. run_root: `/var/folders/.../T/pi-topology-dogfood-smoke`
3. generated_scripts: 7 launch scripts (topology-supervisor + hq/repair/runner/oracle/librarian/scott)
4. pi_session_file_path: n/a (pi stub used; sessions.jsonl record_id=sess-hq-dogfood-1)
5. pids: supervisor bash PID
6. sessions_path: per-mission sessions.jsonl
7. runtime_events_path: per-mission runtime-events.jsonl
8. terminal_log_path: `<run_root>/logs/topology-supervisor.log`
9. cleanup_command: narrow `pgrep -f <run_root>` + kill + rm
10. post_cleanup_ps_proof: `cleanup_ok_no_residual_processes`

Additional (slice 7.1):
- pi_stub_dir: `/var/folders/.../T/pi-stub-...`
- supervisor_exit_code: `0`
- post_cleanup_stub_proof: `cleanup_ok_stub_removed:<path>`

Dashboard (spec §10) populated:
- active_mission_id: `dogfood-smoke-2026-06-17-001`
- lifecycle_state: `running`
- owner_gate: `required`
- next_action: `inspect`
- role_summary: live=1 resumable=1 stale=4 parked=0 closed=1
- pending_packet_count: 3
- pending_packet_total: 3
- stale_packet_count: 1
- incident_count: 0
- closeout_path: (none)

Legacy migration step: `mode: "migrated"`, sibling workspace migrated successfully.

## 4. Compliance Checklist

### 4.1 Scope discipline（每个 slice 守）

| 闸规则 | 状态 |
|---|---|
| 不改 `src/transport/*` | ✅ 所有 slice 验证 |
| 不改 `src/extension/register.ts` | ✅ 无 `ctx.newSession` / `ctx.switchSession` 引入 |
| 不改 `src/runtime/spawn.ts`（仅 dogfood 用了 scripts） | ✅ |
| 不改 `src/runtime/mission.ts` mission card 创建逻辑 | ✅ |
| 不引入新 Pi primitive（除非 spec §11 显式 supported） | ✅ |
| 每个 slice 1 atomic commit | ✅ |
| 每 slice 跑 `npm run smoke` from `packages/pi-topology` | ✅ |
| 报告 4 项（changed files / tests / evidence / commit）| ✅ |

### 4.2 文档纪律

| 项 | 状态 |
|---|---|
| Slice handoff doc to `records/YYYY-MM-DD-*.md` | ✅ 19 handoffs + 2 review docs |
| `no push`（除非 owner 显式要）| ✅ 未 push |
| Codebase 闸纪律（防御性 mission_id 校验等）| ✅ 所有 slice 验证 |
| TypeScript 类型语义正确 | ✅ slice 3.1 revert 误修正 |

### 4.3 Memory rules

| Memory 项 | 状态 |
|---|---|
| **E2E cleanup evidence (10 fields)** mandatory for slice 7 | ✅ 全部 10 字段 captured |
| **E2E window governance** never close wrong pi windows; narrow `pgrep -f` not broad `pkill -f` | ✅ cleanupDogfood 用 narrow pgrep；run_root 与 main project dir 无路径重叠 |
| **Slice 3.1 type signature** `Omit<Event, "event_type" \| "event_id" \| "timestamp"> & { event_id?: string }` | ✅ 已正确实现 |
| **Slice 4.1 actionable-type leak** `isActionableForRecipient` helper | ✅ 三处 filter 复用 |
| **Slice 4.2 mission_id defensive check** | ✅ 三处 filter 防御 |
| **Slice 5.1 invalid active mission_id degrade gracefully** | ✅ 早返回 no-active snapshot |
| **Slice 6.1 status-board inferred-empty + unsafe mission_id** | ✅ 两项都修 |
| **Slice 7.1 pi-stub cleanup + tightened assertions** | ✅ |
| **Slice 7.2 createPiStubDir path determinism** | ✅ 单次 makeRunId 调用 |

### 4.4 Git state

| 项 | 值 |
|---|---|
| Local master HEAD | `b02df33 docs(pi-topology): v0.5 release readiness` |
| 总 commit 数 | 55 |
| Slice 主 commit 数 | 7 |
| Slice hotfix commit 数 | 11 |
| Handoff doc commit 数 | ~13 |
| Working tree | clean (release doc + regenerated evidence both committed) |

## 5. Known Limitations / Deferred Items

### 5.1 v0.5 内已记录 + Reviewer 接受不阻断

- **legacy `topology_status` 工具**：仍读 root `mission-card.json`（slice 6 handoff 列为遗留）
- **legacy `topology-status` 命令**：同上
- **bare `/topology` 命令**：已升级为 3-branch routing（registry → dashboard / legacy → migration prompt / neither → preflight）

### 5.2 v0.6 backlog（per docs/15，**不实现**）

- Canonical Write and Root Mirror Invariants
- Active Mission Guard in Generated Launch Scripts
- Resume Classification Precedence Audit
- Write Ordering Audit
- Schema Validation Completeness
- Error Precedence (defer hard failure vs soft warning)
- Recovery Rules
- Edge-Case Precedence

### 5.3 不在任何 roadmap 里（既不在 v0.5 也不在 v0.6）

- 跨 Mission diff/compare UI
- Dashboard 自动 refresh（hook-based push）
- `include_history=true` 历史 viewer
- `missions/<id>/closeout.json` 写入 helper
- 真实 Pi session 的 E2E 启动（dogfood 用 stub 替代，避免在 agent context 中开真实 session 风险）

## 6. Working Tree

Both the release readiness doc (`records/2026-06-17-pi-topology-v0.5-release-readiness.md`) and the regenerated dogfood evidence (`records/2026-06-17-pi-topology-dogfood-run-smoke.md`) are committed at `b02df33 docs(pi-topology): v0.5 release readiness`. `git status --short` is clean.

## 7. Next Steps

1. Codex Reviewer 复审
2. 如放行：进入 release readiness 后续步骤（CHANGELOG / release notes / npm publish per spec §9.1）

## 8. Quick Reference

| 项 | 路径 |
|---|---|
| PRD | `docs/13-pi-topology-mission-runtime-prd.md` |
| Spec | `docs/14-pi-topology-mission-runtime-spec.md` |
| v0.6 parking lot（**不实现**） | `docs/15-pi-topology-mission-runtime-v0.6-hardening-notes.md` |
| Latest commit | `b02df33 docs(pi-topology): v0.5 release readiness` |
| Handoff docs | `records/2026-06-17-pi-topology-*.md` |
| Dogfood evidence | `records/2026-06-17-pi-topology-dogfood-run-smoke.md` |
| Package | `packages/pi-topology/package.json` |
| Source | `packages/pi-topology/src/runtime/` |
| Tests | `packages/pi-topology/test/unit/`, `packages/pi-topology/test/integration/` |

## 9. 实施者立场

v0.5 已完成 readiness 验证：
- 全部 7 slice + 11 hotfix patches 完成（18 feature commits since slice 1）
- 297 unit tests + 1 integration test 全部 pass
- Dogfood 1/1 pass + 10 + 3 字段 evidence 完整
- **0 残留**（Node tmpdir + /tmp 都验证）
- Typecheck + pack dry-run 干净
- 闸纪律全程守（不动 transport/extension/register/spawn/mission core）
- 范围严格遵守（v0.6 不实现）

请 Reviewer 复审放行 v0.5 release。