# Slice 4.2 Handoff — Defensive mission_id filter in populatePendingPacketCountForMission

日期：2026-06-17
项目：OMP拓扑网络 / `packages/pi-topology`
实施者：Pi Coder (MiniMax-M3, Pi Harness)
Commit：`8a2d218 fix(slice-4.2): defensive mission_id filter in populatePendingPacketCountForMission` (local, not pushed)
前置：`0e52daa fix(slice-4.1)` + `records/2026-06-17-pi-topology-slice-4-1-handoff.md`
触发：Codex Reviewer 暂不放行 Slice 5，要求先补 mission_id 漏口
状态：✅ 1 new test + 247/247 全量 tests + smoke pass

## 1. 修复

| Finding | 优先级 | 修复 | 状态 |
| --- | --- | --- | --- |
| `populatePendingPacketCountForMission` 漏 `e.mission_id === missionId` 检查 | P2 | 循环开头加 `if (e.mission_id !== missionId) continue;` | ✅ |

## 2. 修复内容

**`src/runtime/packet-ledger.ts` `populatePendingPacketCountForMission`**：

**Before**：
```ts
for (const e of all) {
  const liveness = classifyPacketLiveness(e, now, staleThresholdMs);
  if (liveness === "stale") { staleCount += 1; }
  else if (ACTIVE_READ_STATES.has(liveness) && isActionableForRecipient(e, actionableTypesForRole)) {
    activeCount += 1;
  }
}
```

**After**：
```ts
for (const e of all) {
  // Slice 4.2: defensive mission_id filter. The per-mission ledger file is
  // path-scoped to this Mission, but a stray entry with a different
  // mission_id (e.g., from a compactor bug, manual edit, or future schema
  // migration) must not inflate pending_packet_count. Mirrors the same
  // check in getActivePacketsForMission / getAllActivePacketsForMission.
  if (e.mission_id !== missionId) continue;
  const liveness = classifyPacketLiveness(e, now, staleThresholdMs);
  ...
}
```

3 个 filter 函数现在都有同样的 `mission_id` 防御检查：
- `getActivePacketsForMission`（slice 4 已有）
- `getAllActivePacketsForMission`（slice 4 已有）
- `populatePendingPacketCountForMission`（slice 4.2 新增）

## 3. 设计要点

**为什么需要这道防御**：per-mission `packet-ledger.jsonl` 路径上是 `missionId` 限定的，正常情况下不会有错位 entry。但以下场景可能引入：
- compactor 写错（写包时用错 mission_id）
- 手动文件编辑（运维场景）
- 未来 schema migration（重写 ledger）
- 测试或调试时直接 append

错位 entry 不应抬高其他 Mission 的 `pending_packet_count`（与单角色 active reads 行为不一致——单角色 active reads 已过滤 mission_id）。

**行为零变化**：所有现有 tests 仍 pass（因为现有测试都用正确 mission_id 的 entry）。

## 4. Changed files (2 modified, 0 new)

| 文件 | 状态 | 变化 |
| --- | --- | --- |
| `packages/pi-topology/src/runtime/packet-ledger.ts` | modified | +7 行（comment + check）|
| `packages/pi-topology/test/unit/packet-ledger.test.ts` | modified | +33 行（1 new test）|

Total: 2 files modified, +40 / -0.

**未改**：其他所有文件。`src/transport/*` / `src/extension/*` / `src/runtime/spawn.ts` / `src/runtime/mission.ts` / 任何已有 module。

## 5. 新增 test (1)

- `populatePendingPacketCountForMission: wrong-mission entries do NOT inflate count (slice 4.2)` —— 在 Mission A 的 ledger 文件里同时 append 一个正确 mission_id 的 entry 和一个错 mission_id 的 entry，验证 `pending_packet_count = 1`（只算正确的那个）

## 6. Smoke 验证

```
$ cd packages/pi-topology && npm run smoke

# tests 247
# pass 247
# fail 0

> typecheck: strip-types import ok
> tarball: pi-topology-network-0.1.0.tgz
> package size: 91.1 kB (slice 4.1: 91.0 kB, +0.1 kB)
> total files: 59 (unchanged)
```

246 → 247 tests，typecheck pass，pack dry-run pass。

## 7. Evidence paths

- 修复 commit：`8a2d218 fix(slice-4.2): defensive mission_id filter in populatePendingPacketCountForMission`
- Handoff commit：紧随其后
- Handoff doc：`records/2026-06-17-pi-topology-slice-4-2-handoff.md`（本文件）
- Spec 对位：§7 line 531 "default active reads must include only `packet.mission_id === active_mission_id`" —— 三个 filter 函数现在都强制这个不变式 ✅
- API audit 对位：本 slice 不引入新 Pi primitive
- 闸纪律：所有 slice 1-4 gates 仍生效

## 8. 给 Reviewer 的 finding 复审

| 复审点 | 状态 |
|---|---|
| `if (e.mission_id !== missionId) continue;` 加上 | ✅ 与 `getActivePacketsForMission` / `getAllActivePacketsForMission` 的同名检查一致 |
| wrong-mission entry 不影响 `pending_packet_count` | ✅ 新 test 验证 |
| 行为零变化（已有 tests 仍 pass）| ✅ 247/247 |
| 实施纪律 | ✅ 1 file, +7 +33 行，零触动其他 module |

## 9. 实施者立场

P2 mission_id 漏口封死。三个 filter 函数 mission_id + actionable + liveness 防御一致。247/247 全量 + smoke 干净。请 Reviewer 复审放行 Slice 5（Dashboard / status output for multi-Mission state）。
