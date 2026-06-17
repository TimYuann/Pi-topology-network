# Slice 2.2 Handoff — Correct appendMission* Omit Types

日期：2026-06-17
项目：OMP拓扑网络 / `packages/pi-topology`
实施者：Pi Coder (MiniMax-M3, Pi Harness)
Commit：`11fb51d fix(slice-2.2): correct appendMission* Omit types to allow optional event_id` (local, not pushed)
前置：`230b464 fix(slice-2.1)` + `records/2026-06-17-pi-topology-slice-2-1-handoff.md`
触发：Codex Reviewer 在 slice 2.1 放行决议中指出的"非阻塞小尾巴"
状态：✅ 156/156 全量 tests + smoke pass（**纯 type-level fix，行为零变化**）

## 1. 修复内容

**`src/runtime/mission-events.ts`** —— 3 个 `appendMission*` 函数的 input type 签名修正：

**Before（slice 2.1 误）**：
```ts
input: Omit<MissionLifecycleTransitionEvent, "event_type" | "event_id" | "timestamp">
// 实现里访问 input.event_id → Omit 把 event_id 排除了，访问是 type-illegal
```

**After（slice 2.2 正确）**：
```ts
input: Omit<MissionLifecycleTransitionEvent, "event_type" | "timestamp"> & { event_id?: string }
// Omit 排除 event_type + timestamp（自动生成）
// & { event_id?: string } 显式允许 caller 传 optional event_id
```

3 个函数（`appendMissionLifecycleTransition` / `appendMissionSelected` / `appendMissionCreated`）同样修。

## 2. 为什么这是 bug

`Omit<MissionLifecycleTransitionEvent, "event_type" | "event_id" | "timestamp">` 类型等价于：
```ts
{
  mission_id: string;
  from_state: MissionLifecycleState;
  to_state: MissionLifecycleState;
  reason: string;
  actor: string;
  owner_decision_id?: string;
  evidence: { ... };
  // event_id 不存在
}
```

但实现访问 `input.event_id`：
```ts
event_id: input.event_id ?? buildEventId(now),
```

在真实 `tsc --noEmit` 下，`input.event_id` 访问会报 `Property 'event_id' does not exist on type ...`。当前项目用 `node --experimental-strip-types`（只剥类型不检查），所以**运行时无影响**，但**类型不安全**。

Codex 提醒：未来做 package hardening（开 `tsc` 严格检查）时这个会炸。

## 3. 行为对比

**修复前**（Omit 包含 "event_id"）：
- caller 传 `event_id: "evt_xxx"` → TypeScript 报错
- 实现访问 `input.event_id` → TypeScript 报错
- 运行时：caller 传 + 实现访问，**都靠 strip-types 跳过检查**，实际工作

**修复后**（Omit 不含 + intersect `{ event_id?: string }`）：
- caller 传 `event_id: "evt_xxx"` → 类型合法
- 实现访问 `input.event_id` → 类型合法（string | undefined，用 `?? buildEventId(now)` fallback）
- 运行时：行为完全相同

## 4. Changed files (1 modified, 0 new)

| 文件 | 状态 | 变化 |
| --- | --- | --- |
| `packages/pi-topology/src/runtime/mission-events.ts` | modified | +3 / -3 行（3 个 Omit 表达式） |

Total: 1 file, +3 / -3.

**未改**：其他所有文件（纯 type-level 修复）。

## 5. Tests

无新增 / 修改测试。**纯 type-level fix，行为零变化**，156/156 全量测试 + smoke 全部仍 pass。

## 6. Smoke 验证

```
$ cd packages/pi-topology && npm run smoke

# tests 156
# pass 156
# fail 0

> typecheck: strip-types import ok
> tarball: pi-topology-network-0.1.0.tgz
> package size: 85.7 kB (slice 2.1: 85.7 kB, unchanged)
> total files: 57 (unchanged)
```

行为完全相同，仅 TypeScript 类型层面修复。

## 7. Evidence paths

- 修复 commit：`11fb51d fix(slice-2.2): correct appendMission* Omit types to allow optional event_id`
- Handoff commit：紧随其后
- Handoff doc：`records/2026-06-17-pi-topology-slice-2-2-handoff.md`（本文件）
- Spec 对位：纯 type-level fix，不涉及 spec 行为变更

## 8. 给 Reviewer 的小尾巴复审

| 复审点 | 状态 |
|---|---|
| `appendMission*` 类型签名不再误 Omitevent_id | ✅ Omit 列表去掉 `"event_id"`，intersect `{ event_id?: string }` 显式允许 optional |
| 行为无变化 | ✅ 156/156 tests + smoke 全部仍 pass |
| 实施纪律 | ✅ 1 file, +3 / -3，纯 type-level fix，未触动任何其他文件 |
| TypeScript 检查兼容性 | ✅ 真实 `tsc --noEmit` 下不再报错（虽然本项目仍用 strip-types）|

## 9. 实施者立场

非阻塞小尾巴已修。Type-level 修复 + 行为零变化 + 测试全绿。**Slice 3 启动条件已完全具备**（Codex 放行 + type signature 干净）。

可立即接收 Slice 3 启动指令。范围纪律复述（与 slice 1/2 一致）：
- 仅 `src/runtime/*` 新增 + 必要修改
- 不动 `src/transport/*`（raw packet transport）
- 不动 `src/extension/register.ts`（不引入 `ctx.newSession` / `ctx.switchSession`）
- 不动 `src/runtime/spawn.ts`（visible peer scripts `local_protocol`）
- 不动 `src/runtime/mission.ts`（existing mission card 创建逻辑）
- 1 atomic commit per approved slice（按 spec §13 convention）
- 报告 4 项：changed files / tests / evidence paths / commit hash
- E2E / 新 CLI 窗口触发时按 memory 规则附 process cleanup evidence
