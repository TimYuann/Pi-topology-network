# Slice 4.1 Handoff — Close actionable-type leak in pending_packet_count

日期：2026-06-17
项目：OMP拓扑网络 / `packages/pi-topology`
实施者：Pi Coder (MiniMax-M3, Pi Harness)
Commit：`0e52daa fix(slice-4.1): close actionable-type leak in pending_packet_count and all-active reads` (local, not pushed)
前置：`7d911a3 slice(4)` + `records/2026-06-17-pi-topology-slice-4-handoff.md`
触发：Codex Reviewer 暂不放行 Slice 5，要求先封 1 个 P2 漏口
状态：✅ 8 new tests + 246/246 全量 tests + smoke pass

## 1. 修复摘要

| Finding | 优先级 | 修复 | 状态 |
| --- | --- | --- | --- |
| `pending_packet_count` 把"收件角色不可行动"的包也计入待处理 | P2 | 抽 `isActionableForRecipient` helper；`getAllActivePacketsForMission` / `populatePendingPacketCountForMission` / `getActivePacketsForMission` 三个函数都复用同一规则（per-packet，按 `entry.to` 的 actionable type set 过滤）| ✅ |

## 2. 修复内容

### 2.1 新增 `isActionableForRecipient` helper

**`src/runtime/packet-ledger.ts`**：

```ts
export function isActionableForRecipient(
  entry: PacketLedgerEntry,
  actionableTypesForRole: (role: TopologyRole) => ReadonlySet<PacketType> = defaultActionableTypesForRole,
): boolean {
  return actionableTypesForRole(entry.to).has(entry.type);
}
```

- **Per-packet** 检查：包地址是 `entry.to` 角色，类型是否在该角色的 actionable set
- **Default** = `defaultActionableTypesForRole`（spec §3 RolePolicy.report_target）
- **Override** 接受自定义函数（用于测试 / 未来 per-Mission 覆盖）

### 2.2 三处 filter 都加 actionable 检查

| 函数 | 之前 | 之后 |
| --- | --- | --- |
| `getActivePacketsForMission` (per-role) | `roleActionable.has(e.type)`（用角色名查 actionable set）| `isActionableForRecipient(e, actionable)`（helper，与 multi-role 一致）|
| `getAllActivePacketsForMission` (multi-role) | 只按 mission + liveness 过滤 | + `isActionableForRecipient(e, actionable)` |
| `populatePendingPacketCountForMission` | 只按 mission + liveness 计数 | + `isActionableForRecipient(e, actionableTypesForRole)`；新加可选 `actionableTypesForRole` 参数 |

### 2.3 关键设计决策：per-packet 检查（不是 per-role）

- `getAllActivePacketsForMission` 不是"对每个角色查一次再合并"，而是"对每个 packet 检查其 `to` 角色是否行动"
- 一个 packet **最多被一个角色看到**（recipient 是 `e.to`），所以 multi-role count 不会重复
- 这与 `getActivePacketsForMission(role, ...)` 的逻辑一致：那个函数的 `e.to === role` 已经隐含"包的 recipient 是 role"，`isActionableForRecipient` 进一步检查 type 是否在 role 的 set 中

### 2.4 行为变化示例（关键漏口）

| Packet | 之前 | 之后 |
| --- | --- | --- |
| `STATUS → librarian`，state=delivered | active + count++ ❌ | active but **excluded from count**（librarian 不 action STATUS）✅ |
| `STATUS → scott`，state=delivered | active + count++ ✅ | active + count++ ✅ |
| `REPORT → librarian`，state=delivered | active + count++ ✅ | active + count++ ✅ |
| `INCIDENT → repair`，state=delivered | active + count++ ❌（repair 不 action INCIDENT）| active but **excluded from count** ✅ |

## 3. Changed files (2 modified, 0 new)

| 文件 | 状态 | 变化 |
| --- | --- | --- |
| `packages/pi-topology/src/runtime/packet-ledger.ts` | modified | +30 / -5 行（helper + 三处 filter）|
| `packages/pi-topology/test/unit/packet-ledger.test.ts` | modified | +109 / -6 行（8 new tests + 1 test 重写）|

Total: 2 files modified, +139 / -11.

**未改**：其他所有文件。`src/transport/*` / `src/extension/*` / `src/runtime/spawn.ts` / `src/runtime/mission.ts` / 任何已有 module。

## 4. 新增 / 修改 tests (8 new, 1 modified)

### 新增 8 个 tests

**`packet-ledger.test.ts`**：

- `isActionableForRecipient: STATUS → librarian is NOT actionable (slice 4.1)` —— **核心 reviewer 漏口**
- `isActionableForRecipient: STATUS → scott IS actionable (slice 4.1)` —— **核心 reviewer 验证**
- `isActionableForRecipient: INCIDENT → repair is NOT actionable` —— 补充：repair 不看 INCIDENT
- `isActionableForRecipient: REQUEST → repair IS actionable` —— 补充：repair 看 REQUEST
- `getAllActivePacketsForMission: STATUS → librarian excluded (slice 4.1 leak fix)` —— multi-role 行为验证
- `populatePendingPacketCountForMission: STATUS → librarian does NOT inflate count (slice 4.1)` —— 核心 reviewer 验证
- `populatePendingPacketCountForMission: terminal/stale excluded as before, plus actionable check` —— 综合（active + actionable + terminal + stale）
- `populatePendingPacketCountForMission: actionableTypesForRole override is honored (slice 4.1)` —— override 机制

### 修改 1 个 test

- `getActivePacketsForMission: full filter (mission + role + state + type) intersection` —— 移除对不可能 case 的注释（library 内代码已统一用 helper）

## 5. Smoke 验证

```
$ cd packages/pi-topology && npm run smoke

# tests 246
# pass 246
# fail 0

> typecheck: strip-types import ok
> tarball: pi-topology-network-0.1.0.tgz
> package size: 91.0 kB (slice 4: 90.7 kB, +0.3 kB)
> total files: 59 (unchanged)
```

238 → 246 tests，typecheck pass，pack dry-run pass。

## 6. Evidence paths

- 修复 commit：`0e52daa fix(slice-4.1): close actionable-type leak in pending_packet_count and all-active reads`
- Handoff commit：紧随其后
- Handoff doc：`records/2026-06-17-pi-topology-slice-4-1-handoff.md`（本文件）
- Spec 对位：
  - §7 line 531: "default active reads must include only packets actionable for the requesting role" ✅
  - §3 RolePolicy.report_target → actionable type map ✅
  - §3.4 pending_packet_count 字段 ✅（与单角色读语义一致）
- API audit 对位：本 slice 不引入新 Pi primitive
- 闸纪律：所有 slice 1-4 gates 仍生效（progress_status / path safety / registry_active_mission_id / event_id traceability / archived gate / freshness window / active reads 4-filter）

## 7. 给 Reviewer 的 1 项 finding 复审

### [P2] actionable-type leak
- ✅ `isActionableForRecipient` helper 抽出，三处 filter 复用同一规则
- ✅ `getActivePacketsForMission` / `getAllActivePacketsForMission` / `populatePendingPacketCountForMission` 全部加 actionable check
- ✅ Reviewer 指定的 2 个核心 tests：STATUS → librarian 不计 / STATUS → scott 计入 ✅
- ✅ 4 个补充 tests：helper 边界 + 2 个其他 actionable cases + 综合 case
- ✅ 现有所有 slice 4 tests 仍 pass（行为零变化：原来 actionable 包的 case 行为不变）

### 其他未触动项
- ✅ progress_status / path safety / registry_active_mission_id / archived gate / event_id traceability / freshness window / 其他 slice 1-4 闸 仍 OK
- ✅ Slice 4.1 未引入 `ctx.newSession` / `ctx.switchSession`
- ✅ Slice 4.1 未触动 `src/transport/*` / `src/extension/register.ts` / `src/runtime/spawn.ts` / `src/runtime/mission.ts`

## 8. 实施者立场

P2 actionable-type 漏口已封。三处 filter 用同一 helper，行为与单角色读一致。246/246 全量 tests + smoke 干净。请 Reviewer 复审放行 Slice 5（Dashboard / status output for multi-Mission state）。
