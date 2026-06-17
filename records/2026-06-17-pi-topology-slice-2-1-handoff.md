# Slice 2.1 Handoff — Address 2 Reviewer Findings

日期：2026-06-17
项目：OMP拓扑网络 / `packages/pi-topology`
实施者：Pi Coder (MiniMax-M3, Pi Harness)
Commit：`230b464 fix(slice-2.1): address 2 reviewer findings (event_id traceability, archived gate)` (local, not pushed)
前置：`81f26b4 slice(2): add supervisor picker and mission actions` + `records/2026-06-17-pi-topology-slice-2-handoff.md`
触发：Codex Reviewer 暂不放行 Slice 3，要求先修 2 项 P1
状态：✅ 4 new tests + 156/156 全量 tests + smoke pass

## 1. 修复摘要

| Finding | 优先级 | 修复 | 状态 |
| --- | --- | --- | --- |
| [P1] Active pointer 的 event_id 没有对应到 runtime event ledger | P1 | 3 个 event 类型加 `event_id` 字段 + `setActiveMissionFull` 生成单一 event_id 同步写 pointer + JSONL | ✅ |
| [P1] Archived Mission 仍可被 continue/resume | P1 | `setActiveMissionFull` 加 archived 闸（throw `ArchivedMissionError`）+ `availableActionsForOption` archived 早返回 `["inspect"]` | ✅ |

## 2. [P1] event_id traceability

### 2.1 修复内容

**`src/runtime/mission-events.ts`** —— 3 个 event 类型都加 `event_id` 字段：
- `MissionSelectedEvent` 加 `event_id: string`
- `MissionLifecycleTransitionEvent` 加 `event_id: string`
- `MissionCreatedEvent` 加 `event_id: string`
- 3 个 append 函数 `Omit<...Event, "event_type" | "event_id" | "timestamp">` — caller 可显式传 `event_id`，缺省时用 `buildEventId(now)` 自动生成

**`src/runtime/mission-actions.ts` `setActiveMissionFull`** —— event_id 单一生成 + 双向传递：
```ts
// 顺序：read registry → gate → archived check → generate event_id →
//        append event (with event_id) → build pointer (with same event_id) →
//        write registry → write pointer → sync mirror
const event_id = opts.event_id ?? buildEventId(now);
const selectedEvent = appendMissionSelected(ws, layout, {
  event_id,
  mission_id: missionId,
  ...
});
const pointer = buildActiveMissionPointer({
  event_id,  // 同 id
  ...
});
```

`SetActiveMissionResult` 加 `selectedEvent: MissionSelectedEvent | undefined` 字段，方便 caller 拿到 event 对象验证。

### 2.2 设计要点

**Spec §3.3 引文**："Changing the active pointer must append a `mission_selected` runtime event to the selected Mission" — event 必须存在；"event_id": "evt_..." 在 active pointer schema —— pointer 必须指向 event。**两者必须用同一 id** 才能 trace。

**Spec §4.1 引文**：mission_lifecycle_transition event 的必填字段列表（from_state/to_state/reason/actor/owner_decision_id/evidence）**不含 event_id**。但 spec 不禁止加 event_id，加 event_id 是审计增益而非 spec 冲突。`owner_decision_id` 也是类似的"audit id"字段，已有先例。

**事件可追溯**：每个 event 类型现在都有 event_id。Caller 在 append 时可传显式 id（如测试），缺省时 buildEventId 生成 `evt_<iso>_<uuid8>`。三条 event 类型同样处理，类型守卫 `isMissionLifecycleTransitionEvent` / `isMissionSelectedEvent` / `isMissionCreatedEvent` 不需要改。

### 2.3 新增 / 修改 tests

**`mission-events.test.ts`** —— 所有 event 测试补 `event_id` 输入 + 验证 JSONL line 含 event_id：
- `appendMissionLifecycleTransition writes a single JSONL line with all spec §4.1 fields`
- `appendMissionSelected writes spec §3.3 mission_selected fields` — 加 `event_id` 字段断言 + JSONL line event_id 一致
- `appendMissionCreated writes the new event type with initial state info`
- `appending three events yields three JSONL lines, each parseable` — 加 ids 一致性断言

**`mission-actions.test.ts`** —— 新增专门 traceability 测试：
- `setActiveMissionFull: pointer.event_id matches selectedEvent.event_id in JSONL (slice 2.1 traceability)`
  - 断言 `result.pointer.event_id === result.event_id`
  - 断言 `result.selectedEvent?.event_id === result.pointer.event_id`
  - 断言 `onDiskPointer.event_id === result.pointer.event_id`
  - 断言 JSONL line 的 `parsed.event_id === result.pointer.event_id`
- `resumeMission sets active and appends mission_selected event with reason=resumed` — 加 `event_id` 一致断言
- `createMissionFlow then archiveMission then resumeMission chain` — 加 sanity check `createdPointer.event_id === mission_selected.event.event_id`

## 3. [P1] Archived Mission gate

### 3.1 修复内容

**`src/runtime/mission-actions.ts`** —— 新增 `ArchivedMissionError` 类 + `setActiveMissionFull` 加 archived 闸：

```ts
export class ArchivedMissionError extends Error {
  public readonly missionId: string;
  constructor(missionId: string) {
    super(`setActiveMissionFull: cannot activate archived mission ${JSON.stringify(missionId)}; archived Missions are inspectable only (spec §5.2)`);
    this.name = "ArchivedMissionError";
    this.missionId = missionId;
  }
}

// setActiveMissionFull 内：
const entry = findMissionInRegistry(nextRegistry, missionId);
if (!entry) throw new Error(...);
if (entry.archived) throw new ArchivedMissionError(missionId);
```

闸在 registry gate 之后、`event_id` 生成之前。Throw 时文件系统**零修改**（registry / pointer / event / mirror 都不写）。

**`src/runtime/supervisor-picker.ts` `availableActionsForOption`** —— archived 早返回 `["inspect"]`：

```ts
export function availableActionsForOption(option, mode) {
  if (mode === "intake") return ["create_new"];
  // Slice 2.1 fix (spec §5.2): archived Missions are "closed for normal work,
  // inspectable only". Return early so neither "continue" nor "resume" nor any
  // lifecycle-changing action is offered, even if a stale active pointer still
  // points to the archived Mission.
  if (option.archived) return ["inspect"];
  ...
}
```

**Defense in depth**：
- `setActiveMissionFull` 在写盘前抛 ArchivedMissionError（runtime 闸）—— 防止新建活跃 archived
- `availableActionsForOption` archived 早返回（picker 闸）—— 防止通过 picker UI 触发 continue/resume
- 即使 stale pointer 仍指向 archived Mission，UI 上无法操作；runtime 上 setActiveMissionFull 拒绝

### 3.2 设计要点

**Spec §5.2 引文**："archived: closed for normal work, inspectable only"。archived Mission 只能被 inspect，不能 continue/resume/archive(再次)/park/mark_blocked/request_rollback。

**未加 `unarchive` action**：spec §5.3 owner actions 列表（continue/resume/create_new/inspect/archive/park/unpark/mark_blocked/request_rollback）**不含 unarchive**。本次不加，等 spec 明确需要时再加（per Reviewer 提示"除非未来定义显式 unarchive action"）。

**保留 unarchive 路径可能性**：archived gate 只 block `setActiveMissionFull` / `resumeMission`，**不**修改 registry 或 pointer 文件。如果未来加 `unarchiveMission`，它直接调 `updateRegistryEntry({ archived: false })` 即可，闸不动。

**Error 类型**：`ArchivedMissionError` 类（在 mission-actions.ts 里，**不**在 mission-registry.ts）。区别于 `UnknownMissionRegistryEntryError`（registry 层错误）和 `InvalidMissionIdError`（layout 层错误）—— ArchivedMissionError 是 action 语义错误。

### 3.3 新增 / 修改 tests

**`supervisor-picker.test.ts`** —— archived 早返回验证（含 3 变体）：
- `archived, is_active: false` → `["inspect"]`
- `archived, is_active: true` → `["inspect"]`（**核心回归测试**：stale pointer case）
- `archived, lifecycle_state: "draft"` → `["inspect"]`（其他字段不影响判定）

**`mission-actions.test.ts`** —— archived 闸验证：
- `setActiveMissionFull throws ArchivedMissionError when entry is archived (slice 2.1)`
  - archive 之后调 setActiveMissionFull → 抛 ArchivedMissionError
  - 错误名是 `ArchivedMissionError`，message 含 "archived"
  - **抛错后 pointer file 不存在**（验证 throw 在 write 前发生）
- `resumeMission propagates ArchivedMissionError for archived Mission`
  - resumeMission 走 setActiveMissionFull 的闸 → 也抛 ArchivedMissionError
- `createMissionFlow on already-archived entry path does NOT exist` — sanity check（createMissionFlow 抛 duplicate mission_id，与 archived gate 互补）
- **重写** `createMissionFlow then archiveMission then resumeMission chain`：
  - 加 sanity check `createdPointer.event_id === mission_selected.event.event_id`（traceability）
  - archive 后 `reg.active_mission_id` 仍指向 archived Mission（stale pointer 状态）
  - resumeMission 抛 ArchivedMissionError
  - throw 后 registry 状态未变（gate 在 write 前生效）
  - throw 后 runtime-events.jsonl 没有新 mission_selected 行

## 4. Changed files (6 modified, 0 new)

| 文件 | 状态 | 变化 |
| --- | --- | --- |
| `packages/pi-topology/src/runtime/mission-events.ts` | modified | +27 行（event_id 字段 + 3 个 append 函数 Omit 类型扩展）|
| `packages/pi-topology/src/runtime/mission-actions.ts` | modified | +30 行（ArchivedMissionError 类 + 闸逻辑 + selectedEvent 字段）|
| `packages/pi-topology/src/runtime/supervisor-picker.ts` | modified | +5 / -3 行（archived 早返回）|
| `packages/pi-topology/test/unit/mission-events.test.ts` | modified | +6 tests' event_id 输入 + 4 JSONL 断言 |
| `packages/pi-topology/test/unit/mission-actions.test.ts` | modified | +3 tests（traceability + 2 archived 闸）+ 重写 chain 测试 |
| `packages/pi-topology/test/unit/supervisor-picker.test.ts` | modified | +2 archived 变体断言 |

Total: 6 files modified, +214 / -16.

**未改**：`src/runtime/mission-registry.ts` / `src/runtime/mission-pointer.ts` / `src/runtime/mission-layout.ts` / `src/runtime/root-mirror.ts` / `src/runtime/launch-metadata.ts` / `src/runtime/mission-lifecycle.ts` / 任何 `src/transport/*` / `src/extension/*` / `src/runtime/spawn.ts` / `src/runtime/mission.ts`。

## 5. Smoke 验证

```
$ cd packages/pi-topology && npm run smoke

# tests 156
# pass 156
# fail 0

> typecheck: strip-types import ok
> tarball: pi-topology-network-0.1.0.tgz
> package size: 85.7 kB (slice 2: 85.2 kB, +0.5 kB)
> total files: 57 (unchanged)
```

152 → 156 tests，typecheck pass，pack dry-run pass。

## 6. Evidence paths

- 修复 commit：`230b464 fix(slice-2.1): address 2 reviewer findings (event_id traceability, archived gate)`
- Handoff commit：紧随其后（`docs(pi-topology): record slice 2.1 handoff`）
- Handoff doc：`records/2026-06-17-pi-topology-slice-2-1-handoff.md`（本文件）
- Spec 对位：
  - §3.3 active pointer event_id traceability ✅
  - §3.4 mission registry `updateRegistryEntry` 不影响 archived gate（archived 是 registry entry 字段，update 是局部操作，gate 在 setActiveMissionFull 路径）
  - §4.1 lifecycle transition event 仍 9 必填字段（event_id 是 spec §4.1 之外的附加字段，类型守卫兼容）
  - §5.2 archived category "closed for normal work, inspectable only" ✅
  - §5.3 owner actions 9 个（含 inspect，archived 只允许 inspect）✅
- API audit 对位：本 slice 不引入新 Pi primitive，纯 runtime 闸与 event schema 扩展
- Slice 1.1 gate 仍生效（archived gate 是额外的闸，不替换 `setRegistryActiveMission` 闸）

## 7. 给 Reviewer 的 2 项 finding 复审

### [P1] #1 event_id traceability
- ✅ 3 个 event 类型加 `event_id` 字段
- ✅ `setActiveMissionFull` 单一生成 + 同步传递
- ✅ `SetActiveMissionResult.selectedEvent` 暴露 event 对象
- ✅ 新增 traceability 测试覆盖：pointer ↔ selectedEvent ↔ JSONL line 三处 event_id 一致
- ✅ `resumeMission` / `createMissionFlow` 同样验证（自动继承因 setActiveMissionFull 是中央路径）
- ✅ "chain" 测试加 sanity check

### [P1] #2 archived gate
- ✅ `setActiveMissionFull` 加 ArchivedMissionError 闸
- ✅ `resumeMission` 走 setActiveMissionFull 路径，自动继承
- ✅ `availableActionsForOption` archived 早返回 `["inspect"]`
- ✅ 3 个 archived 变体测试（含 stale active pointer case = Reviewer 复现的输出）
- ✅ 重写 chain 测试，验证 archive 后 resume 抛错 + 零文件修改

### 其他未触动项
- ✅ progress_status / path safety / setRegistryActiveMission / 其他 slice 1.x gates 仍 OK
- ✅ Slice 2.1 未引入 `ctx.newSession` / `ctx.switchSession`
- ✅ Slice 2.1 未触动 `src/transport/*` / `src/extension/register.ts` / `src/runtime/spawn.ts`

## 8. 已知遗留 / 未来 slice 关注

### 8.1 仍未实现（不在 slice 2.1 范围）

- **`unarchive` action**：spec §5.3 owner actions 列表不含。等 spec 明确需要时再加。当前 archived Mission 的"恢复"路径只剩"创建新 Mission"。
- **`mission_lifecycle_transition` 事件的 event_id 与 owner_decision_id 关系**：当前两者独立。是否需要 binding（如 owner_decision_id === event_id）由 spec §4.1 决定，slice 2.1 暂不引入。
- **stale active pointer recovery**：如果某 Mission archive 了但 active pointer 仍指向它，`clearActiveMissionPointer` 或新的"select another"动作能恢复。slice 2.1 加了 picker / action 闸，但**没**主动修复 stale pointer。这留给 slice 5 dashboard UX 决定。

### 8.2 Process cleanup evidence
本 slice 无 E2E / 无新进程 / 无 CLI 窗口。slice 7 必填 10 项规则（已存 memory）仍未触发。

### 8.3 实施者立场

2 项 P1 finding 全部修复 + 测试 + smoke 干净。请 Reviewer 复审放行 Slice 3（Session registry semantics for role session IDs and stale/alive evidence）。