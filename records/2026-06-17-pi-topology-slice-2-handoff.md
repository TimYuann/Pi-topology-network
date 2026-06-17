# Slice 2 Handoff — Supervisor mission picker and mission resume/create flow

日期：2026-06-17
项目：OMP拓扑网络 / `packages/pi-topology`
实施者：Pi Coder (MiniMax-M3, Pi Harness)
Commit：`81f26b4 slice(2): add supervisor picker and mission actions` (local, not pushed)
前置 spec：`docs/14-pi-topology-mission-runtime-spec.md` §5 + §5.3 + §6.1 + §13 slice 2
前置 slice：`5c8584f slice(1)` + `055e821 fix(slice-1)` + `d752a85 fix(slice-1.2)`
状态：✅ 49/49 new tests + 152/152 全量 tests + smoke pass

## 1. 实施 note

按 spec §5 Supervisor Mission Choice + §5.3 owner actions + §6.1 launch metadata 实施。新增 4 个 runtime 模块 + 4 个测试文件，扩展 1 个现有 module。

### 1.1 新增模块

- `src/runtime/supervisor-picker.ts` — `readPickerSnapshot(workspaceDir)` 返回 `PickerSnapshot`（mode: registry | legacy_root | intake）+ `classifyMission(entry, activeId)` 6 类别（new/active/resumed/archived/blocked/parked）+ `availableActionsForOption(option, mode)` spec §5.3 actions
- `src/runtime/mission-actions.ts` — `setActiveMissionFull`（**active pointer 唯一写入路径**）+ `resumeMission` + `createMissionFlow` + `archiveMission` + `parkMission` + `unparkMission` + `markMissionBlocked` + `requestRollback` + `inspectMission` + `readCurrentActiveMissionId`
- `src/runtime/launch-metadata.ts` — `LaunchMetadata` 类型（spec §6.1 12 字段）+ `buildLaunchMetadata` defaults per role（read-only roles → `allowed_paths: []`，repair → mission.allowed_paths，HQ/supervisor → mission.allowed_paths）+ `validateLaunchMetadata` 8 类失败
- `src/runtime/mission-events.ts` — 3 种 event 类型 builder（`mission_lifecycle_transition` / `mission_selected` / `mission_created`）+ `buildEventId` 生成 `evt_<iso>_<uuid8>`

### 1.2 修改模块

- `src/runtime/mission-registry.ts` — 新增 `updateRegistryEntry(registry, {mission_id, patch})` 支持 partial 更新（8 个可 patch 字段：title/objective/lifecycle_state/progress_status/owner_gate/blocked/archived/closeout_path）+ `setRegistryEntryLifecycle` convenience + `UnknownMissionRegistryEntryError` 类
- 不改 `setRegistryActiveMission` 行为（slice 1.1 闸保留）
- 不改 `readMissionRegistry` / `writeMissionRegistry` / `createEmptyRegistry` / `addMissionToRegistry` / `findMissionInRegistry` / `validateMissionRegistry`

### 1.3 Active pointer 闸执行

按 slice 1.2 闸规则，**所有** active pointer 写盘必须走 `setActiveMissionFull`：

```ts
// 唯一 canonical 路径（mission-actions.ts）
export function setActiveMissionFull(workspaceDir, missionId, opts) {
  const registry = readMissionRegistry(workspaceDir);
  if (!registry) throw new Error("registry missing");
  const nextRegistry = setRegistryActiveMission(registry, missionId, now);  // ← slice 1.1 静态闸
  // ... append event, write registry, write pointer, sync mirror
}
```

**`writeActiveMissionPointer` 仍 export**（slice 1 兼容 + 测试用），但所有新代码（mission-actions.ts）只走 `setActiveMissionFull`。Reviewer 在 slice 1.2 复审时点名的"别绕过闸"已通过架构保证：4 个新文件不直接 import `writeActiveMissionPointer`，只通过 `setActiveMissionFull` 间接调用。

### 1.4 不变量（slice 2 强制）

- `setActiveMissionFull` 失败 → 不修改任何文件系统（throw 在 read registry / gate / find entry 阶段）
- `createMissionFlow` 失败 → 不创建 mission folder（`createMissionLayout` 在创建前 throw）
- `createMissionFlow` 重复 mission_id → throw（`createMissionLayout` 返回 `created: false` 时 throw）
- 所有 lifecycle transition 写 `mission_lifecycle_transition` event（spec §4.1 9 必填字段）
- 所有 active pointer 切换写 `mission_selected` event（spec §3.3）
- 所有 active pointer 切换 sync root mirror（spec §3.2）
- `archive/park/unpark/blocked/rollback` 不改 active pointer（不动 active_mission_id），只改 entry 字段

## 2. Changed files

| 文件 | 状态 | 行数 |
| --- | --- | --- |
| `packages/pi-topology/src/runtime/mission-registry.ts` | modified | +95 行（`updateRegistryEntry` + `setRegistryEntryLifecycle` + `UnknownMissionRegistryEntryError`）|
| `packages/pi-topology/src/runtime/mission-events.ts` | new | 178 行 |
| `packages/pi-topology/src/runtime/launch-metadata.ts` | new | 248 行 |
| `packages/pi-topology/src/runtime/supervisor-picker.ts` | new | 226 行 |
| `packages/pi-topology/src/runtime/mission-actions.ts` | new | 372 行 |
| `packages/pi-topology/test/unit/mission-events.test.ts` | new | 199 行（6 tests）|
| `packages/pi-topology/test/unit/launch-metadata.test.ts` | new | 309 行（14 tests）|
| `packages/pi-topology/test/unit/supervisor-picker.test.ts` | new | 297 行（11 tests）|
| `packages/pi-topology/test/unit/mission-actions.test.ts` | new | 422 行（18 tests）|

Total: 1 modified + 4 new src + 4 new tests = 9 files changed, ~2346 insertions.

**未改**（slice 2 rules 强制）：
- `src/transport/*`（raw packet transport 不动）
- `src/extension/register.ts`（不引入 `ctx.newSession` / `ctx.switchSession`）
- `src/runtime/spawn.ts`（visible peer scripts 保持 `local_protocol`）
- `src/runtime/mission.ts`（现有 mission card 创建逻辑保留）
- `src/extension/commands.ts`（不动 slash command wiring，slice 5 dashboard）
- `src/runtime/mission-pointer.ts`（仅 consumer，`writeActiveMissionPointer` 保留给 slice 1 兼容 + 测试）

## 3. Focused tests (49 new)

### mission-events.test.ts (6)
- `buildEventId returns evt_<iso>_<uuid8>` + 唯一性
- `appendMissionLifecycleTransition writes a single JSONL line with all spec §4.1 fields`（9 必填字段）
- `appendMissionSelected writes spec §3.3 mission_selected fields`
- `appendMissionCreated writes the new event type with initial state info`
- `appending three events yields three JSONL lines, each parseable`
- `missionLayoutPaths without prior createMissionLayout still computes paths`

### launch-metadata.test.ts (14)
- `buildLaunchMetadata returns 12 fields per spec §6.1`（全部 12 字段断言）
- `buildLaunchMetadata for read-only roles forces allowed_paths to []`（runner/oracle/librarian/scott 4 个）
- `buildLaunchMetadata for repair copies mission.allowed_paths`
- `buildLaunchMetadata throws when role is not in mission.roles`
- `validateLaunchMetadata passes for valid metadata`
- 8 个失败场景：`mission_id mismatch` / `write_policy downgrade` / `read_only_role_with_write_paths` / `allowed_paths_not_subset` / `forbidden_actions_missing` / `permission_source_missing` / `script_path_outside_workspace` / `/tmp` 例外
- `permission_source defaults to mission.workdir/mission-card.json`

### supervisor-picker.test.ts (11)
- 3 mode：`intake` / `legacy_root` / `registry`
- `classifyMission` 6 类别 + 优先级（archived > blocked > parked > active > resumed）
- `readPickerSnapshot` 各种 fallback（pointer vs registry）
- `findMissionOption` linear search
- `availableActionsForOption` 6 mode × spec §5.3 actions 矩阵
- pointer/registry 一致性 sanity tests

### mission-actions.test.ts (18)
- 2 个 **gate throw tests**：registry 缺失 / mission_id 未知
- `setActiveMissionFull` success path（写 pointer/registry/event/mirror 全验证）
- `setActiveMissionFull` switching active（previous_active_mission_id 正确）
- `resumeMission` 完整 happy path
- `createMissionFlow` 完整（layout + entry + pointer + events + mirror）
- `createMissionFlow` 重复 mission_id throw
- `archiveMission` / `parkMission` + `unparkMission` / `markMissionBlocked` / `requestRollback` 各 1 个
- `inspectMission` read-only summary
- `inspectMission` unknown throw
- `readCurrentActiveMissionId` pointer vs registry 优先级
- `updateRegistryEntry` unknown throw + `previous` 字段语义
- `createMissionFlow → archive → resume` chain consistency

## 4. Smoke 验证

```
$ cd packages/pi-topology && npm run smoke

# tests 152
# pass 152
# fail 0

> typecheck: strip-types import ok
> tarball: pi-topology-network-0.1.0.tgz
> package size: 85.2 kB (slice 1.2: 76.6 kB, +8.6 kB)
> total files: 57 (slice 1.2: 53, +4 new src + 0 new dirs)
```

103 → 152 tests，typecheck pass，pack dry-run pass。

## 5. Evidence paths

- 实施 commit：`81f26b4 slice(2): add supervisor picker and mission actions`
- Handoff commit：紧随其后（`docs(pi-topology): record slice 2 handoff`）
- Handoff doc：`records/2026-06-17-pi-topology-slice-2-handoff.md`（本文件）
- Spec 对位：
  - §3.2 root 兼容镜像：slice 1 已实现，slice 2 调用 `syncRootMirrorFromLayout`
  - §3.3 active pointer：slice 1 + 1.1 + 1.2 + 2 完整闭环
  - §3.4 mission registry：slice 1 + 2 `updateRegistryEntry` + `UnknownMissionRegistryEntryError`
  - §4.1 mission lifecycle transition event：slice 2 `appendMissionLifecycleTransition` 9 必填字段
  - §5.1 bare `/topology` 加载顺序：slice 2 `readPickerSnapshot` 3 mode fallback
  - §5.2 mission categories：slice 2 `classifyMission` 6 类别
  - §5.3 owner actions：slice 2 `availableActionsForOption` + 9 actions（archive/park/unpark/mark_blocked/request_rollback 等）
  - §6.1 launch metadata 12 字段：slice 2 `LaunchMetadata` + `buildLaunchMetadata` + `validateLaunchMetadata`
  - §13 slice 2：实施目标对齐
- API audit 对位：本 slice 不引入新 Pi primitive（`ctx.*` / `pi.*`），纯 runtime + 持久化逻辑
- Spec review §6.1 Gap：read-only role `allowed_paths: []` 强制 — slice 2 已落实（`buildLaunchMetadata` for runner/oracle/librarian/scott 强制空列表）

## 6. 给 Reviewer 的关键确认

| 闸规则 | 状态 |
|---|---|
| 所有 active pointer 写入先过 `setRegistryActiveMission` 闸 | ✅ 通过 `setActiveMissionFull` 架构保证 |
| 不引入 `ctx.newSession` / `ctx.switchSession` | ✅ 4 新文件零 Pi API 引用 |
| 不改 raw packet transport | ✅ `src/transport/*` 零修改 |
| 不改 visible peer script 生成路径 | ✅ `src/runtime/spawn.ts` 零修改 |
| 不改现有 `mission.ts` mission card 创建逻辑 | ✅ 零修改 |
| `npm run smoke` 通过 | ✅ 152/152 + typecheck + pack |

## 7. 已知遗留 / 未来 slice 关注

### 7.1 仍未实现（不在 slice 2 范围）

- **TUI / CLI wiring**：spec §5.1 `/topology` 命令实际注册到 Pi 扩展（`src/extension/register.ts`）— slice 5 dashboard。Slice 2 提供纯函数 `readPickerSnapshot` + `*Mission` action handlers，调用方由 slice 5 接。
- **`role_summary` derivation**：注册表 entry 的 `role_summary` 字段当前全 0（slice 1 默认）。Slice 3 session registry 落地后应 derive live/resumable/stale/parked/closed 5 态计数。
- **Mission 创建 CLI prompt**：owner 怎么填 `objective / allowed_paths / project` — slice 5 或更后提供 UX。
- **Migration**：单根 `mission-card.json` → per-Mission folder 的实际搬迁 — slice 6（slice 2 picker 在 `legacy_root` mode 只"检测 + 提示"，不搬）。
- **Text-only picker vs `ctx.ui.select`**：当前 picker 是纯数据；slice 5 决定是否切到 native chooser（API audit 已确认 `ctx.ui.select/custom` 是 `supported`，本 round spec 仍标"待接入"）。

### 7.2 Process cleanup evidence

本 slice 无 E2E / 无 CLI 窗口 / 无新进程。slice 7 必填 10 项字段规则（已存 `target=project` memory）暂未触发。

### 7.3 实施者立场

slice 2 落地干净：49/49 new tests + 152/152 全量 tests + smoke pass。请 Reviewer 复审 + 决定是否进 slice 3（Session registry semantics for role session IDs and stale/alive evidence）。
