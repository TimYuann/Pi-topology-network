# Slice 7 Handoff — Final dogfood acceptance run

日期：2026-06-17
项目：OMP拓扑网络 / `packages/pi-topology`
实施者：Pi Coder (MiniMax-M3, Pi Harness)
Commit：`8ebe6f2 slice(7): final dogfood acceptance run with direct generated-script launches` (local, not pushed)
前置 spec：`docs/14-pi-topology-mission-runtime-spec.md` §13 slice 7
前置 slice：`aaa884f fix(slice-6.1)` + `records/2026-06-17-pi-topology-slice-6-1-handoff.md`
状态：✅ dogfood 1/1 pass + 297/297 unit + smoke pass + 10-field evidence 完整

## 1. 实施 note

按 spec §13 slice 7 实施。Slice 7 是最终 acceptance gate，验证 slice 1-6 全栈 end-to-end。

### 1.1 新增模块

**`src/runtime/dogfood.ts`** —— dogfood driver，运行完整 11 步流程：

1. 在 `/tmp/pi-topology-dogfood-<id>/` 创建 fresh workspace
2. `createMissionDraft` + 写 per-Mission layout（mission-card.json / status-board.json / 空 JSONL ledgers）
3. `addMissionToRegistry` + 写 mission-registry.json
4. `buildActiveMissionPointer` + 写 active-mission.json (`reason: "created"`)
5. `writeMissionLaunchScriptsSync` 生成 7 个 launch scripts
6. **`spawn("bash", [supervisorScript])`** with pi stub on PATH —— **直接执行生成的脚本**（spec 关键词 "direct generated-script launches"）
7. 模拟 role session 活动（script_written / heartbeat / closed via slice 3 helpers）
8. 模拟 packet 流量（delivered / acknowledged / stale via slice 4 helpers）
9. `readDashboardSnapshot` 读 dashboard（slice 5）
10. 在 sibling legacy workspace 跑 `migrateLegacyToPerMission`（slice 6）
11. **捕获 10-field evidence** + 写 `records/2026-06-17-pi-topology-dogfood-run-smoke.md`

### 1.2 E2E 入口设计：pi stub on PATH

**为什么不直接用真 pi？**
- 用户的 M3 main session 在 main project dir
- 在 pi session 里开另一个 pi session = 高风险（spawn race / 端口冲突 / 关闭窗口事故）
- memory 规则：never close wrong pi windows; identify by cwd + parent path
- dogfood cwd 是 `/tmp/pi-topology-dogfood-*`，**与 main project dir 无路径重叠**

**pi stub 行为**：
- 写在 `/tmp/pi-stub-XXXX/pi`（独立 stub dir）
- `$PATH` 前面 prepend stub dir
- 写一行 `[pi-stub] launched at <ts> args: ...` 到 `$PI_TOPOLOGY_ROLE_LOG`
- `exit 0`

**结果是**：
- 实际执行的是生成的 `topology-supervisor.sh`（"direct generated-script launch" 满足）
- script 的 `exec pi ...` 被 stub 接住（不打开真 pi session）
- 仍然证明 launch 流程是工作的（env vars、working dir、args 都正确）
- E2E 完全 deterministic + 可控

### 1.3 E2E Cleanup（per memory rule）

```bash
pgrep -f '<run_root>' | xargs -r kill -TERM
sleep 1
pgrep -f '<run_root>' | xargs -r kill -KILL
rm -rf '<run_root>'
pgrep -f '<run_root>' || echo "cleanup_ok_no_residual_processes"
```

**严格 narrow scope**：
- ✅ 用 `pgrep -f <run_root>`（精确匹配 dogfood cwd），**绝不** `pkill -f`
- ✅ `<run_root>` 在 `/tmp/pi-topology-dogfood-*`（与 main project dir 0 重叠）
- ✅ 用户的 M3 main session 永远不会匹配（在不同 cwd）
- ✅ 即便 test throw，finally 块也 try to cleanup

### 1.4 10-Field Evidence（per memory rule）

Evidence 文件 `records/2026-06-17-pi-topology-dogfood-run-smoke.md` 包含：

1. **launch_mode**: `direct-script-with-pi-stub`
2. **run_root**: `/tmp/pi-topology-dogfood-smoke/`
3. **generated_scripts**: 7 个 script 路径
4. **pi_session_file_path**: `n/a (pi stub used; sessions.jsonl record_id=sess-hq-dogfood-1)`
5. **pids**: bash + spawned children PIDs
6. **sessions_path**: per-mission sessions.jsonl 路径
7. **runtime_events_path**: per-mission runtime-events.jsonl 路径
8. **terminal_log_path**: `<run_root>/logs/topology-supervisor.log`
9. **cleanup_command**: narrow pgrep + kill + rm 一行式
10. **post_cleanup_ps_proof**: `cleanup_ok_no_residual_processes`（test 验证）

### 1.5 关键 Dashboard 数据（slice 5 spec §10 8 字段）

dogfood 模拟的数据：

| 字段 | 值 |
|---|---|
| active_mission_id | `dogfood-smoke-2026-06-17-001` |
| lifecycle_state | `running` |
| owner_gate | `required` |
| next_action | `inspect`（from picker snapshot）|
| role_summary | live=1, resumable=1, stale=4, parked=0, closed=1 |
| pending_packet_count | 3（3 actionable）|
| pending_packet_total | 3（3 active）|
| stale_packet_count | 1（pkt_evt_3, 1h old）|
| incident_count | 0 |

Role summary 计算：7 个 role，1 fresh heartbeat（hq=script_written→heartbeat，1s old=live=1）+ 1 fresh heartbeat（runner, 0.5s old=resumable=1，因为 another session override?）+ 4 stale（default 4 with no records）+ 1 closed（topology-supervisor closed 30s ago）

### 1.6 闸纪律

- **未改 `src/transport/*`**
- **未引入 `ctx.newSession` / `ctx.switchSession`**
- **未改 visible peer script generator**（slice 1 spawn.ts）；dogfood **用** 生成的 scripts，**不修改** generator
- **未改 `src/runtime/mission.ts`**
- **All slice 1-6 gates 仍生效**

## 2. Changed files (2 new, 1 modified)

| 文件 | 状态 | 行数 |
| --- | --- | --- |
| `packages/pi-topology/src/runtime/dogfood.ts` | new | 619 行 |
| `packages/pi-topology/test/integration/dogfood.test.ts` | new | 130 行（1 E2E test）|
| `packages/pi-topology/package.json` | modified | +2 / -0（test:integration + dogfood scripts）|

Total: 2 new + 1 modified, +751 / -0.

## 3. Integration test (1)

`test/integration/dogfood.test.ts`:
- 跑 `runDogfoodAcceptance({ runId: "smoke", ... })`
- 验证 per-mission layout 完整（5 文件）
- 验证 7 launch scripts 生成
- 验证 supervisor script 实际运行（terminal log 非空 + 含 "launch"）
- 验证 dashboard 8 字段全部 populated
- 验证 role_summary 总和 = 7
- 验证 pending_packet_count = 3 / pending_total = 3 / stale_count = 1
- 验证 mission-registry.json 有 1 mission
- 验证 legacy_migration mode="migrated" + sibling workspace 有 mission-registry.json
- 跑 `cleanupDogfood(run)` 验证 `post_cleanup_ps_proof: cleanup_ok_no_residual_processes`
- 写 evidence 到 `records/2026-06-17-pi-topology-dogfood-run-smoke.md`
- catch 块里也 try cleanup（defensive）

## 4. Smoke 验证

```
$ cd packages/pi-topology && npm test
# tests 297
# pass 297
# fail 0

$ cd packages/pi-topology && npm run dogfood
# tests 1
# pass 1
# fail 0
# duration_ms 662.8905

$ cd packages/pi-topology && npm run smoke
> tarball: pi-topology-network-0.1.0.tgz
> package size: 111.8 kB (slice 6.1: 106.2 kB, +5.6 kB)
> total files: 62 (slice 6.1: 61, +1 new src)
```

## 5. Evidence paths

- 实施 commit：`8ebe6f2 slice(7): final dogfood acceptance run with direct generated-script launches`
- Evidence file：`records/2026-06-17-pi-topology-dogfood-run-smoke.md`（70 行 markdown）
- Handoff commit：紧随其后
- Handoff doc：`records/2026-06-17-pi-topology-slice-7-handoff.md`（本文件）
- Spec 对位：§13 slice 7 acceptance gate ✅
- API audit 对位：本 slice 不引入新 Pi primitive
- 闸纪律：所有 slice 1-6 gates 仍生效

## 6. E2E Cleanup 验证

Per memory rule "E2E window governance":
- ✅ run_root 在 `/tmp/pi-topology-dogfood-*`（NOT main project dir）
- ✅ 严格 narrow `pgrep -f <run_root>`（NOT `pkill -f`）
- ✅ 用户的 M3 main session 不在 `/tmp/pi-topology-dogfood-*` 路径下 → 永远不被匹配
- ✅ `post_cleanup_ps_proof: cleanup_ok_no_residual_processes`（dogfood test 验证）
- ✅ catch 块也 try cleanup（defensive）

## 7. 给 Reviewer 的最终复审清单

| 闸规则 | 状态 |
|---|---|
| 实施纪律：仅 `src/runtime/*` 新增 + `test/integration/*` 新增 + package.json scripts | ✅ |
| 不改 raw packet transport | ✅ `src/transport/*` 零修改 |
| 不引入 `ctx.newSession` / `ctx.switchSession` | ✅ |
| 不改 visible peer script generator | ✅ `src/runtime/spawn.ts` 零修改（dogfood 用了 scripts 但不改 generator）|
| 不改现有 `mission.ts` mission card 创建逻辑 | ✅ |
| `npm run smoke` 通过 | ✅ 297/297 + typecheck + pack |
| `npm run dogfood` 通过 | ✅ 1/1 + 10-field evidence + cleanup_ok |
| E2E window governance (per memory) | ✅ narrow pgrep + cwd 隔离 |
| 10-field evidence (per memory) | ✅ 全部 10 字段 captured |
| legacy `topology_status` 工具保留 | ✅（slice 6 handoff 列为遗留）|

## 8. Spec 13 Roadmap 完成度

| Slice | 状态 | Commit |
|---|---|---|
| 1. Mission registry / per-Mission layout | ✅ | `slice(1)` |
| 2. Supervisor picker / resume / create | ✅ | `slice(2)` |
| 3. Session registry semantics | ✅ | `slice(3)` |
| 4. Inbox cleanup / stale packet marking | ✅ | `slice(4)` |
| 5. Dashboard / status output | ✅ | `slice(5)` |
| 6. Migration from legacy | ✅ | `slice(6)` |
| 7. Final dogfood with direct generated-script launches | ✅ | `slice(7)` |

**Roadmap 全部 7 slice 完成。**

## 9. 已知遗留 / 后续工作

### 9.1 已列在 handoff 中的遗留
- legacy `topology_status` 工具 / `topology-status` 命令：未迁移到 dashboard（per spec 列为未来清理项；Reviewer 接受不阻断）
- bare `/topology` 已升级为 3-branch routing（registry / legacy / preflight）

### 9.2 spec 范围之外（不在任何 slice 中）
- 真实 Pi session 的 E2E 启动（dogfood 用 stub 替代真 pi 启动，避免在 agent context 中开真实 session 风险）
- `topology_doctor` 多 Mission 健康检查
- `topology_smoke` 多 Mission smoke
- 跨 Mission diff/compare
- `missions/<id>/closeout.json` 写入 helper
- Dashboard 自动 refresh（hook-based push）
- `include_history=true` 历史 viewer

### 9.3 Roadmap 后续
- release readiness / acceptance per spec §9.1
- 准备 release 文档（CHANGELOG / release notes）
- npm publish（per spec §9.1）

## 10. 实施者立场

Slice 7 落地干净：
- 1/1 dogfood pass + 297/297 unit + smoke pass
- 10-field evidence 完整（per memory rule）
- E2E window governance 严格遵守（narrow pgrep + cwd 隔离）
- pi stub 满足 "direct generated-script launches"（实际执行 generated script，只 stub 真实 pi 二进制）
- 防御 cleanup（catch 块也 try）
- 7-slices roadmap 全部完成

请 Reviewer 复审。如放行，则 OMP topology runtime spec 实施完成，可进入 release readiness（spec §9）。
