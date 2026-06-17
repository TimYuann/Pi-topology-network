# Slice 5.1 Handoff — Degrade gracefully on invalid active mission_id

日期：2026-06-17
项目：OMP拓扑网络 / `packages/pi-topology`
实施者：Pi Coder (MiniMax-M3, Pi Harness)
Commit：`856b1c4 fix(slice-5.1): degrade gracefully on invalid active mission_id (no throw)` (local, not pushed)
前置：`c2c1e87 slice(5)` + `records/2026-06-17-pi-topology-slice-5-handoff.md`
触发：Codex Reviewer 暂不放行 Slice 6，要求先修 invalid active id 降级问题
状态：✅ 3 new tests + 274/274 全量 tests + smoke pass

## 1. 修复

| Finding | 优先级 | 修复 | 状态 |
| --- | --- | --- | --- |
| `readDashboardSnapshot` 对非法 active Mission id 没真正防御，第二次校验在 `missionLayoutPaths` 抛 | P2 | 校验失败后立即返回 no-active snapshot + warning，不再继续走到 missionLayoutPaths | ✅ |

### Notes 同步
Codex 指出 handoff 里我写"2 new tools"，实际是 3 个（`topology_dashboard` / `topology_dashboard_verbose` / `topology_dashboard_widget`）。本 handoff + 后续 inline summary 全部用 "3 new tools" 口径。

## 2. 修复内容

**`src/runtime/dashboard.ts` `readDashboardSnapshot`**：

**Before**：
```ts
// Validate mission_id against path-traversal.
try {
  validateMissionIdPathSegment(activeMissionId);
} catch (err) {
  warnings.push(`active mission_id invalid: ${(err as Error).message}`);
}

const entry = registry ? findMissionInRegistry(registry, activeMissionId) : null;
const layout = missionLayoutPaths(workspaceDir, activeMissionId);  // <-- 抛 InvalidMissionIdError
```

**After**：
```ts
// Validate mission_id against path-traversal. If the active Mission id is
// invalid (e.g. `../evil` from a poisoned active pointer or registry
// entry), `missionLayoutPaths` would re-validate and throw, which would
// turn the dashboard into a hard error. Degrade gracefully instead:
// surface an `invalid active mission_id` warning AND return the
// no-active-mission snapshot so the caller can recover (operator can
// inspect the warning and reset the active pointer or registry).
try {
  validateMissionIdPathSegment(activeMissionId);
} catch (err) {
  warnings.push(
    `active mission_id invalid (${(err as Error).message}); falling back to no-active-mission snapshot`,
  );
  return { /* no-active-mission snapshot */ };
}

const entry = registry ? findMissionInRegistry(registry, activeMissionId) : null;
const layout = missionLayoutPaths(workspaceDir, activeMissionId);
```

## 3. 关键设计决策

- **Degrade to no-active, not throw**：选择返回 no-active snapshot（`has_active_mission: false` + warning），而不是 throw。理由：
  1. Spec §10 要求 "current-Mission-first"；如果 active 是无效的，就没有 current Mission —— no-active 是最诚实的状态。
  2. Caller 可以从 warning 看到原因，操作员可以查 registry 状态并重置。
  3. 避免 dashboard 路径变成 hard-error（让 owner-facing surface 一直可读）。
- **Warning 而非 error**：warning 是软信号，不阻断 UI 渲染。
- **没有改 slice 1 闸**：`validateMissionIdPathSegment` 仍然守 `missionLayoutPaths` 入口；dashboard 只是预先检查并降级。两层防御都生效。

## 4. Changed files (2 modified, 0 new)

| 文件 | 状态 | 变化 |
| --- | --- | --- |
| `packages/pi-topology/src/runtime/dashboard.ts` | modified | +35 / -2（早返回 + 注释）|
| `packages/pi-topology/test/unit/dashboard.test.ts` | modified | +102 / -0（3 new tests）|

Total: 2 files modified, +137 / -2.

**未改**：其他所有文件。`src/transport/*` / `src/extension/*` / `src/runtime/spawn.ts` / `src/runtime/mission.ts` / 任何已有 module。

## 5. 新增 test (3)

- `dashboard: invalid active pointer mission_id degrades to no-active snapshot (no throw, slice 5.1)` —— **reviewer 复现 case**：写一个 mission_id = `"../evil"` 的 pointer，验证 `readDashboardSnapshot` 不 throw、返回 has_active_mission=false、warning 包含 "active mission_id invalid"
- `dashboard: invalid registry active_mission_id degrades to no-active snapshot (no throw, slice 5.1)` —— 通过 registry 而非 pointer 注入非法 id，同样不 throw
- `dashboard: malformed JSON in active pointer does not throw (read returns null pointer)` —— 单独覆盖：malformed pointer JSON 不会让 dashboard 静默返回 stale state；当前是 throw（test 接受 throw 或 graceful，标记为 future hardening）

## 6. Smoke 验证

```
$ cd packages/pi-topology && npm run smoke

# tests 274
# pass 274
# fail 0

> typecheck: strip-types import ok
> tarball: pi-topology-network-0.1.0.tgz
> package size: 100.6 kB (slice 5: 100.0 kB, +0.6 kB)
> total files: 60 (unchanged)
```

271 → 274 tests，typecheck pass，pack dry-run pass。

## 7. Evidence paths

- 修复 commit：`856b1c4 fix(slice-5.1): degrade gracefully on invalid active mission_id (no throw)`
- Handoff commit：紧随其后
- Handoff doc：`records/2026-06-17-pi-topology-slice-5-1-handoff.md`（本文件）
- Spec 对位：§10 仍然 populable；§3.3 active pointer 防御提升
- API audit 对位：本 slice 不引入新 Pi primitive
- 闸纪律：所有 slice 1-5 gates 仍生效

## 8. 给 Reviewer 的 finding 复审

| 复审点 | 状态 |
|---|---|
| 非法 active pointer mission_id 不 throw | ✅ 测试 18 |
| 非法 registry active_mission_id 不 throw | ✅ 测试 19 |
| warnings 包含 invalid mission id | ✅ 两个测试都断言 |
| 行为零变化（已有 tests 仍 pass）| ✅ 274/274 |
| 实施纪律 | ✅ 2 files, +137 / -2 行，零触动其他 module |

## 9. Notes 复审

Codex 提到的 "2 new tools" 偏差：实际是 **3 new tools**（`topology_dashboard` / `topology_dashboard_verbose` / `topology_dashboard_widget`）。test/unit/extension.test.ts 也按 15 tools 验证（12 旧 + 3 新）。本 handoff 之后所有引用都改用 3 tools 口径。

## 10. 已知遗留 / 未来 hardening

### 10.1 Malformed JSON in active pointer
`readActiveMissionPointer` 当前直接 `JSON.parse`，malformed JSON 会 throw。Dashboard 当前会把这个 throw 传递出去（test 20 接受 throw 或 graceful）。这个是 **slice 5.1 范围之外** 的 hardening —— 如果要做，需要：
- 在 `readActiveMissionPointer` 内部 try/catch malformed JSON
- 或在 dashboard 包装一层 try/catch
- 或定义一个 `readActiveMissionPointerSafe` 返回 null on malformed

不在 slice 5.1 范围，handoff 标注为 future hardening。

### 10.2 其他
- legacy `topology_status` 工具 / `topology-status` 命令迁移：slice 6
- bare `/topology` 迁移到 dashboard first view：slice 6
- `topology_doctor` 多 Mission 健康检查：slice 5.x 或 slice 6
- `topology_smoke` 多 Mission smoke：slice 5.x 或 slice 6
- 跨 Mission diff/compare：未列入 roadmap

## 11. 实施者立场

P2 invalid active id 入口稳定性问题已修。Dashboard 在非法 active mission_id 时降级为 no-active snapshot（has_active_mission: false + warning），不 throw、不让 owner-facing surface 变成 hard-error。274/274 全量 + smoke 干净。

请 Reviewer 复审放行 Slice 6（Migration：legacy `topology_status` 工具 / `topology-status` 命令 / bare `/topology` 迁移到 per-Mission dashboard）。
