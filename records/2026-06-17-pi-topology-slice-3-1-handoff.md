# Slice 3.1 Handoff — Close launch-attempt freshness window + revert mission-events type signature

日期：2026-06-17
项目：OMP拓扑网络 / `packages/pi-topology`
实施者：Pi Coder (MiniMax-M3, Pi Harness)
Commit：`36a4f11 fix(slice-3.1): close launch-attempt freshness window and revert mission-events type signature` (local, not pushed)
前置：`b88ebe1 slice(3)` + `records/2026-06-17-pi-topology-slice-3-handoff.md`
触发：Codex Reviewer 暂不放行 Slice 4，要求先修 2 项 finding
状态：✅ 5 new tests + 200/200 全量 tests + smoke pass

## 1. 修复摘要

| Finding | 优先级 | 修复 | 状态 |
| --- | --- | --- | --- |
| [P1] script_written / launch_printed / launch_requested 不受 resume freshness window 约束 | P1 | `classifyRole` step 4e 加 `age <= resumeMs` 检查；窗口内 resumable + liveness check，窗口外 stale | ✅ |
| [P2] Slice 2.2 的类型"小尾巴"还没真正修干净 | P2 | `mission-events.ts` 3 个 `appendMission*` 签名 revert 到正确形式：`Omit<Event, "event_type" \| "event_id" \| "timestamp"> & { event_id?: string }` | ✅ |

## 2. [P1] launch-attempt freshness window

### 2.1 修复内容

**`src/runtime/role-session.ts` `classifyRole` step 4e**：

**Before**：
```ts
if (LAUNCH_ATTEMPT_EVENTS.has(latest.event_type)) {
  return { state: "resumable", needs_liveness_confirmation: true, reason: "..." };
}
```

**After**：
```ts
if (LAUNCH_ATTEMPT_EVENTS.has(latest.event_type)) {
  const age = options.now.getTime() - Date.parse(latest.timestamp);
  if (Number.isFinite(age) && age >= 0 && age <= resumeMs) {
    return { state: "resumable", needs_liveness_confirmation: true, reason: "launch attempted within resume window, liveness check needed (spec §6.3 step 5)" };
  }
  // Outside the resume window: fall through to step 5 (stale).
}
```

launch-attempt event 在 `resumeMs`（默认 10min）窗口内 → `resumable` with liveness check；窗口外 → falls through 到 step 5 (`stale` fallback)。

### 2.2 设计要点

**Spec §4.2 引文**：
> A session record may be `resumable` for up to the Mission resume freshness window. Default: 10 minutes after the latest usable session event.

**关键解读**：**all** resumable classifications 受窗口约束，不仅是 `alive_confirmed`。Slice 3 的实现只对 `alive_confirmed` 应用了 `isWithinResumeWindow` 检查，漏了对 `script_written` / `launch_printed` / `launch_requested` 的窗口检查。

**为什么 reviewer 视为 P1**：liveness 信号（heartbeat / alive_confirmed）有过期风险时，role 不能再 `resumable` —— 否则 spec §6.3 "Supervisor must not send work to `resumable` or `stale` roles until liveness is confirmed" 的核心保证被绕过（owner 可能把 stale role 当 resumable 派活）。

**Boundary 行为**：与 `isWithinResumeWindow` 一致，**inclusive**（10min 整点仍在窗口内），与 `isFreshHeartbeat` 的 inclusive 行为一致。

### 2.3 新增 tests（5 个）

**`role-session.test.ts`**：

- `classifyRole step 5: old script_written (11 min) is stale, not resumable (slice 3.1)` —— 11min 前的 `script_written` → `stale`
- `classifyRole step 5: old launch_printed (11 min) is stale, not resumable (slice 3.1)` —— 11min 前的 `launch_printed` → `stale`
- `classifyRole step 5: old launch_requested (11 min) is stale, not resumable (slice 3.1)` —— 11min 前的 `launch_requested` → `stale`
- `classifyRole step 5: script_written at exact resume-window boundary is still resumable` —— 10min 整点 inclusive → `resumable`
- `classifyRole step 5: alive_confirmed and script_written share the same resume-window rule (10min)` —— 同一时间窗口下两个 event type 行为一致

## 3. [P2] mission-events.ts type signature revert

### 3.1 修复内容

**`src/runtime/mission-events.ts`** 3 个 `appendMission*` 签名：

**Before（slice 2.2 误改）**：
```ts
input: Omit<MissionLifecycleTransitionEvent, "event_type" | "timestamp"> & { event_id?: string }
```

**After（正确形式）**：
```ts
input: Omit<MissionLifecycleTransitionEvent, "event_type" | "event_id" | "timestamp"> & { event_id?: string }
```

`"event_id"` 重新加回 Omit 列表。

### 3.2 之前的错误 + 当前正确的语义

**Slice 2.2 的错误推理**（我搞错了 TypeScript intersect 语义）：
- `Omit<…, "event_type" | "timestamp">` —— event_id 仍在类型中（required）
- `& { event_id?: string }` —— intersect 类型是 `string` 和 `string | undefined` 的交集，仍是 `string`（required）
- 结果：caller **必须** 传 event_id（required），实现 `??` fallback 是 dead code

**正确语义**（reviewer 指出）：
- `Omit<…, "event_type" | "event_id" | "timestamp">` —— event_id 被 **Omit 排除**（不在类型中）
- `& { event_id?: string }` —— intersect 把 event_id 作为 optional 加入
- 结果：caller 可以 **省略** event_id（`event_id?: string`），实现 `?? buildEventId(now)` 是真正的 fallback

**为什么本项目没暴露**：`npm run typecheck` 跑的是 `node --experimental-strip-types -e "await import('./index.ts')"`，只检查 import 能否解析，**不**做 `tsc --noEmit` 严格类型检查。运行时正确（因为 `input.event_id` 实际访问总是有值），但 type signature 撒谎。

### 3.3 影响范围

| 行为 | Slice 2.2 (broken) | Slice 3.1 (correct) |
| --- | --- | --- |
| 实际调用方：caller 不传 event_id | TypeScript 报错（required 字段缺失） | OK（caller 可省略，函数自动生成） |
| 实际调用方：caller 传 event_id | OK | OK（使用 caller 提供的 id） |
| 实现 `input.event_id ?? buildEventId(now)` | dead code（input.event_id 总有值） | 真正的 fallback |
| TypeScript strict 检查 | 必报错 | 通过 |

**现有测试**：所有现有调用方（`setActiveMissionFull` / `performLifecycleTransition` / `createMissionFlow`）**都传了** event_id，所以行为零变化。**新签名只是恢复 caller 可以省略的契约**。

### 3.4 行为变化

| 调用方 | 之前 | 之后 |
| --- | --- | --- |
| `setActiveMissionFull(workspaceDir, missionId, { event_id, ... })` | OK | OK（行为零变化） |
| `setActiveMissionFull(workspaceDir, missionId, { ... })` —— 省略 event_id | **TypeScript 报错** | OK（自动 `buildEventId`） |

## 4. Changed files (3 modified, 0 new)

| 文件 | 状态 | 变化 |
| --- | --- | --- |
| `packages/pi-topology/src/runtime/role-session.ts` | modified | +14 / -2 行（step 4e 加窗口检查）|
| `packages/pi-topology/src/runtime/mission-events.ts` | modified | +3 / -3 行（3 个 Omit 加回 "event_id"）|
| `packages/pi-topology/test/unit/role-session.test.ts` | modified | +5 tests（3 old launch-attempt + 1 boundary + 1 alive_confirmed parity）|

Total: 3 files modified, +86 / -13.

**未改**：其他所有文件。`src/transport/*` / `src/extension/register.ts` / `src/runtime/spawn.ts` / `src/runtime/mission.ts` 零修改。

## 5. Smoke 验证

```
$ cd packages/pi-topology && npm run smoke

# tests 200
# pass 200
# fail 0

> typecheck: strip-types import ok
> tarball: pi-topology-network-0.1.0.tgz
> package size: 89.8 kB (slice 3: 89.7 kB, +0.1 kB)
> total files: 58 (unchanged)
```

195 → 200 tests，typecheck pass，pack dry-run pass。

## 6. Evidence paths

- 修复 commit：`36a4f11 fix(slice-3.1): close launch-attempt freshness window and revert mission-events type signature`
- Handoff commit：紧随其后
- Handoff doc：`records/2026-06-17-pi-topology-slice-3-1-handoff.md`（本文件）
- Spec 对位：
  - §4.2 resume freshness window applies to all resumable classifications ✅
  - §4.2 stale fallback for old launch-attempt records ✅
  - §4.2 inclusive boundary at 10min ✅
  - mission-events type signature correct per TypeScript semantics ✅
- API audit 对位：本 slice 不引入新 Pi primitive
- Slice 1-3 闸纪律全部仍生效（progress_status / path safety / registry_active_mission_id / event_id traceability / archived gate / freshness window）

## 7. 给 Reviewer 的 2 项 finding 复审

### [P1] launch-attempt freshness window
- ✅ Step 4e 加 `age <= resumeMs` 检查
- ✅ 窗口内 `resumable` + liveness check，窗口外 falls through 到 step 5 (stale)
- ✅ 5 个新 tests：3 负例（11min 前的 script_written / launch_printed / launch_requested）+ 1 边界（10min 整点 inclusive）+ 1 alive_confirmed parity
- ✅ Inclusive boundary 与 `isWithinResumeWindow` 一致

### [P2] mission-events type signature
- ✅ 3 个 `appendMission*` 签名 revert 到 `Omit<Event, "event_type" | "event_id" | "timestamp"> & { event_id?: string }`
- ✅ caller 现在可以省略 event_id（真实 optional）
- ✅ 行为零变化（所有现有调用方都传 event_id）
- ✅ TypeScript strict 检查现在通过

### 其他未触动项
- ✅ progress_status / path safety / registry_active_mission_id / archived gate / event_id traceability / 其他 slice 1-3 闸 仍 OK
- ✅ Slice 3.1 未引入 `ctx.newSession` / `ctx.switchSession`
- ✅ Slice 3.1 未触动 `src/transport/*` / `src/extension/register.ts` / `src/runtime/spawn.ts` / `src/runtime/mission.ts`

## 8. 实施者立场

2 项 finding 全部修复 + 5 个新 tests + 200/200 全量 tests + smoke 干净。请 Reviewer 复审放行 Slice 4（Inbox cleanup and stale packet marking）。
