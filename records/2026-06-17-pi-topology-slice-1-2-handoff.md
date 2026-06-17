# Slice 1.2 Handoff — Close active_mission_id empty-missions boundary

日期：2026-06-17
项目：OMP拓扑网络 / `packages/pi-topology`
实施者：Pi Coder (MiniMax-M3, Pi Harness)
Commit：`d752a85 fix(slice-1.2): close active_mission_id empty-missions boundary` (local, not pushed)
前置：`055e821 fix(slice-1): address 3 reviewer findings` + `records/2026-06-17-pi-topology-slice-1-1-handoff.md`
触发：Codex Reviewer 发现 P2 finding 边界漏口

## 1. 修复内容

**`src/runtime/mission-registry.ts`** `validateMissionRegistry` —— 去掉 `&& r.missions.length > 0` 守卫：

```diff
-    if (typeof r.active_mission_id === "string" && r.missions.length > 0) {
+    if (typeof r.active_mission_id === "string") {
       const ids = r.missions.map((m) => (m as MissionRegistryEntry).mission_id);
       if (!ids.includes(r.active_mission_id)) {
         errors.push(`active_mission_id "${r.active_mission_id}" not found in missions[]`);
       }
     }
```

**根因**：原守卫逻辑是"只在 missions 非空时检查"。这把 `active_mission_id: "ghost"` + `missions: []` 这种**最危险的 corrupt 形态**漏掉——空 registry 本应 `active_mission_id: null`，任何非空 active_id 都应被拒绝。

**修复后语义**：
- `active_mission_id: null` + `missions: []` ✅ 合法（真正空 registry）
- `active_mission_id: null` + `missions: [...]` ✅ 合法
- `active_mission_id: "x"` + `missions: []` ❌ 拒绝（id 找不到）
- `active_mission_id: "x"` + `missions: [{id: "y"}]` ❌ 拒绝（id 找不到）
- `active_mission_id: "x"` + `missions: [{id: "x"}]` ✅ 合法

## 2. Changed files (2 modified, 0 new)

| 文件 | 状态 | 变化 |
| --- | --- | --- |
| `packages/pi-topology/src/runtime/mission-registry.ts` | modified | -1 / +4 行（去守卫 + 加注释说明覆盖两个 case）|
| `packages/pi-topology/test/unit/mission-registry.test.ts` | modified | +1 test (23 行) |

Total: +28 / -1。

**未改**（slice 1.2 不应触发）：
- 任何其他 module（修复集中在一个函数内）
- 任何 `src/transport/*`（raw packet transport 不动）
- `src/extension/register.ts`（不引入 `ctx.newSession` / `ctx.switchSession`）

## 3. Tests (1 new, 103/103 pass, smoke clean)

`test/unit/mission-registry.test.ts` 从 22 → 23 tests。

新增 test：
- `validateMissionRegistry rejects active_mission_id when missions[] is empty (slice 1.2 boundary fix)`
  - 负例：`{ active_mission_id: "ghost", missions: [] }` 必须被 validator 拒绝
  - 正例（边界 sanity）：`{ active_mission_id: null, missions: [] }` 仍通过

`npm run smoke`：
- 103 tests pass（80 旧 + 13 slice 1 + 9 slice 1.1 + 1 slice 1.2 = 103 total）
- typecheck pass
- `npm pack --dry-run`：76.6 kB / 53 files（slice 1.1: 76.5 kB，+0.1 kB）

## 4. Evidence paths

- 修复 commit：`d752a85 fix(slice-1.2): close active_mission_id empty-missions boundary`
- Handoff commit（本记录）：`83722f1 docs(pi-topology): record slice 1.1 reviewer-finding handoff` 是上一轮；本轮 handoff commit 见 §6
- Spec 对位：§3.4 mission registry 一致性约束，slice 1.2 收尾
- API audit 对位：见 `records/2026-06-17-pi-topology-mission-runtime-api-audit.md` §6，无 primitive 变更

## 5. 给 Reviewer 的 finding [P2] 复审

| 复审点 | 状态 |
| --- | --- |
| 边界漏口修复 | ✅ 去掉 `&& r.missions.length > 0`，覆盖 `active_mission_id: "x" + missions: []` |
| 负例测试 | ✅ 新增 `{ active_mission_id: "ghost", missions: [] }` 拒绝测试 |
| 正例 sanity | ✅ 新增 `{ active_mission_id: null, missions: [] }` 通过测试（确保未过度收紧）|
| Smoke | ✅ 103/103 tests + typecheck + pack dry-run |
| 其他原 finding 状态 | ✅ progress_status / path safety / setRegistryActiveMission throw 仍 OK |

## 6. Commit hash

```
d752a85 fix(slice-1.2): close active_mission_id empty-missions boundary
```

local master, **未 push**。Handoff commit 紧随其后。

## 7. 实施者立场

P2 finding 边界漏口已封。103/103 tests + smoke 干净。请 Reviewer 复审放行 Slice 2。
