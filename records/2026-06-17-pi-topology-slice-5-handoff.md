# Slice 5 Handoff — Per-Mission dashboard for multi-Mission state

日期：2026-06-17
项目：OMP拓扑网络 / `packages/pi-topology`
实施者：Pi Coder (MiniMax-M3, Pi Harness)
Commit：`c2c1e87 slice(5): add per-Mission dashboard for multi-Mission state` (local, not pushed)
前置 spec：`docs/14-pi-topology-mission-runtime-spec.md` §5.7 + §10 + §13 slice 5
前置 slice：`8a2d218 fix(slice-4.2)` + `records/2026-06-17-pi-topology-slice-4-2-handoff.md`
状态：✅ 24/24 new tests + 271/271 全量 tests + smoke pass

## 1. 实施 note

按 spec §10 实施。新增 1 个 runtime 模块 + 1 个测试 + 3 个新工具 + 2 个新命令 + 1 个测试更新。

### 1.1 新增模块

**`src/runtime/dashboard.ts`** —— 完整 per-Mission dashboard snapshot（spec §10 全部 8 字段）：

- **`DashboardSnapshot`** 接口：24 字段覆盖 spec §10 全部 8 字段 + 派生字段（pending_packet_total / stale_packet_count / picker_mode / available_actions / artifacts / warnings / paths / role_classifications）
- **`readDashboardSnapshot(workspaceDir, options?)`** —— 8 字段全部从 per-Mission 源读：
  1. active id/title ← `readActiveMissionPointer` + `readMissionRegistry`
  2. lifecycle_state ← registry entry
  3. owner_gate ← registry entry
  4. next_action ← `readPickerSnapshot` + `availableActionsForOption`
  5. role counts 5-state ← `getRoleSessionRecords` + `classifyAllRoles` + `computeRoleSummary`（**从 sessions.jsonl 重算**，不读 registry 缓存）
  6. pending packet count ← packet-ledger.jsonl（**重算**，不读 registry 缓存；用 `isActionableForRecipient` + `classifyPacketLiveness`）
  7. incident count ← incident-log.jsonl 重算
  8. closeout_path + artifacts ← registry + `artifacts/` scan（递归 role 子目录，列叶子文件）
- **`formatDashboardText`** —— 紧凑 8 字段文本（`/topology dashboard` 用）
- **`formatDashboardTextDetailed`** —— 详细 + paths + per-role classifications
- **`formatDashboardWidget`** —— 结构性 entries 给 `ctx.ui.setStatus` / `setWidget`（spec §11）

### 1.2 新增工具

| 工具 | 描述 | spec 对位 |
| --- | --- | --- |
| `topology_dashboard` | 紧凑 dashboard 快照 | §10 紧凑格式 |
| `topology_dashboard_verbose` | 详细 + paths + per-role classifications | §10 "/topology status must show detailed paths" |
| `topology_dashboard_widget` | 结构性 entries for UI | §11 `ctx.ui.setStatus` / `setWidget` |

### 1.3 新增命令

- `/topology dashboard` —— 紧凑
- `/topology dashboard-verbose` —— 详细 + paths

### 1.4 测试更新

`test/unit/extension.test.ts`：更新 tool registry 期望 list 加入 3 个新工具名（15 tools，从 12 → 15）。

### 1.5 未改

- 任何已有 module（除了 `tools.ts` / `commands.ts` 加新工具/命令）
- `src/transport/*`（raw packet transport 不动）
- `src/extension/register.ts`（不引入 `ctx.newSession` / `ctx.switchSession`）
- `src/runtime/spawn.ts`（visible peer scripts 保持 `local_protocol`）
- `src/runtime/mission.ts`（现有 mission card 创建逻辑保留）
- 现有 `topology_status` 工具 / `topology-status` 命令（保留 legacy 路径；slice 6 migration）

### 1.6 关键设计决策

#### 1.6.1 **Read-only by default**（不写 registry）
dashboard 不修改 registry。Role summary 和 pending packet count 都从 source-of-truth 文件（`sessions.jsonl` / `packet-ledger.jsonl`）**重新计算**，不读 registry 缓存字段。这样 dashboard 在其他操作未刷新 registry 时也是 current truth。

- **opt-in `persistToRegistry: true`**：给想要 write-back 的调用方（同步 slice 3/4 populate 行为）。默认 false。
- 这与 slice 3/4 的"populate" 函数互补：populate 是写回的，dashboard 是 read 的。

#### 1.6.2 **active pointer 优先 over registry**
dashboard 用 `activePointer?.mission_id ?? registry?.active_mission_id ?? null`。如果 pointer 和 registry 不一致：
- pointer 赢（active_mission_id 用 pointer 的）
- 输出一行 warning（`disagree`）

#### 1.6.3 **artifact scan：跳过 role 子目录**
`layout.artifactsDir` 下有 7 个 role 子目录（`hq/` / `repair/` / ...）+ 顶层文件。当前 scan 递归 role 子目录、列叶子文件（避免噪音）。目录不算 artifact。

#### 1.6.4 **additive，不动 legacy**
现有 `topology_status` 工具和 `topology-status` 命令继续读 legacy `mission-card.json` 路径。Slice 6 负责迁移。**这是一个有意识的非破坏性变更**——避免在 slice 5 中破坏现有 preflight flow。

#### 1.6.5 **mission_id 验证**
`validateMissionIdPathSegment(activeMissionId)` 防御性检查，避免 path traversal（slice 1 的闸纪律仍生效）。

### 1.7 不变量

- 8 spec §10 字段全部 populable
- 所有现有 slice 1-4 gates 仍生效（progress_status / path safety / registry_active_mission_id / event_id traceability / archived gate / freshness window / active reads 4-filter / mission_id defensive check）
- 不引入 `ctx.newSession` / `ctx.switchSession`
- 不改 raw transport
- 不动 legacy `topology_status` 工具
- dashboard 默认不写 registry（read-only）
- 防御：pointer vs registry 不同意时 surface warning

## 2. Changed files (2 new, 3 modified)

| 文件 | 状态 | 行数 |
| --- | --- | --- |
| `packages/pi-topology/src/runtime/dashboard.ts` | new | 540 行 |
| `packages/pi-topology/test/unit/dashboard.test.ts` | new | 656 行（24 tests）|
| `packages/pi-topology/src/extension/tools.ts` | modified | +75 / -0（3 新工具）|
| `packages/pi-topology/src/extension/commands.ts` | modified | +15 / -0（2 新命令 + 2 render 函数）|
| `packages/pi-topology/test/unit/extension.test.ts` | modified | +3 / -0（更新 tool registry list）|

Total: 2 new + 3 modified, +1319 / -1.

## 3. Focused tests (24 new)

### Empty / no-active cases (3)
- `returns snapshot with has_active_mission=false when workspace has no .pi/topology`
- `returns snapshot with has_active_mission=false when registry exists but no active_mission_id`
- `formatDashboardText for no-active-mission produces compact output`

### Active Mission: all 8 spec §10 fields (1)
- `active Mission populates all 8 spec §10 fields`

### Recompute (read-only vs cache) (3)
- `role summary is recomputed from sessions.jsonl, not from registry cache`
- `pending packet count is recomputed from packet-ledger.jsonl, not from registry cache`
- `stale packet count is recomputed from packet-ledger.jsonl`

### Other data sources (3)
- `incident count reads from incident-log.jsonl`
- `artifacts scan populates artifact list with file metadata` (recurses role subdirs)
- `empty incident log returns 0 incidents` / `empty artifacts dir returns empty artifacts array`

### Text / widget formatting (4)
- `formatDashboardText: compact text contains all 8 spec §10 fields`
- `formatDashboardTextDetailed: verbose text adds paths, artifacts, role classifications`
- `formatDashboardWidget: returns status entries + structured widget object`
- `formatDashboardWidget: no-active-mission returns minimal status + widget`

### Defensive / consistency checks (2)
- `warning when active pointer and registry.active_mission_id disagree`
- `missing mission-card.json produces a warning and empty role summary`

### Opt-in persistence (2)
- `persistToRegistry=true writes back role_summary + pending_packet_count`
- `persistToRegistry=false (default) does NOT mutate registry`

### Edge cases (6)
- `empty packet-ledger.jsonl returns zero counts`
- `malformed packet-ledger lines are skipped (no throw)`
- `snapshot includes generated_at ISO timestamp`
- `archived Mission is reflected (snapshot.archived=true)`
- `dashboard shape is stable (8 spec §10 fields + 3 derived)` (24 keys)
- `empty artifacts dir returns empty artifacts array`

## 4. Smoke 验证

```
$ cd packages/pi-topology && npm run smoke

# tests 271
# pass 271
# fail 0

> typecheck: strip-types import ok
> tarball: pi-topology-network-0.1.0.tgz
> package size: 100.0 kB (slice 4.2: 91.1 kB, +8.9 kB)
> total files: 60 (slice 4.2: 59, +1 new src)
```

247 → 271 tests，typecheck pass，pack dry-run pass。

## 5. Evidence paths

- 实施 commit：`c2c1e87 slice(5): add per-Mission dashboard for multi-Mission state`
- Handoff commit：紧随其后
- Handoff doc：`records/2026-06-17-pi-topology-slice-5-handoff.md`（本文件）
- Spec 对位：
  - §10 8 字段全部 populable ✅
  - §10 "/topology status must show detailed paths" → `topology_dashboard_verbose` ✅
  - §11 `ctx.ui.setStatus` / `setWidget` → `topology_dashboard_widget` ✅
  - §13 slice 5 实施目标对齐
- API audit 对位：本 slice 不引入新 Pi primitive（`ctx.*` / `pi.*`），纯 runtime + 3 个 wrapper tools
- 闸纪律：所有 slice 1-4 gates 仍生效（progress_status / path safety / registry_active_mission_id / event_id traceability / archived gate / freshness window / active reads 4-filter / mission_id defensive check）
- E2E window governance：本 slice 无新进程 / 无 CLI 窗口，slice 7 必填规则仍未触发

## 6. 给 Reviewer 的关键确认

| 闸规则 | 状态 |
|---|---|
| 仅 `src/runtime/*` 新增 + `extension/*` 增量添加 | ✅ 新模块 `dashboard.ts`；tools/commands 各加 3/2 个，零删除 |
| 不改 raw packet transport | ✅ `src/transport/*` 零修改 |
| 不引入 `ctx.newSession` / `ctx.switchSession` | ✅ 零 Pi API 引用 |
| 不改 visible peer script 生成路径 | ✅ `src/runtime/spawn.ts` 零修改 |
| 不改现有 `mission.ts` mission card 创建逻辑 | ✅ 零修改 |
| 不动 legacy `topology_status` 工具 / `topology-status` 命令 | ✅ 保留给 slice 6 迁移 |
| `npm run smoke` 通过 | ✅ 271/271 + typecheck + pack |

## 7. 已知遗留 / 未来 slice 关注

### 7.1 仍未实现（不在 slice 5 范围）

- **legacy `topology_status` 迁移**：现有 `topology_status` 工具 / `topology-status` 命令仍读 legacy `mission-card.json`。Slice 6 负责迁移到 per-Mission paths。
- **bare `/topology` 命令迁移**：当前 bare `/topology` 调用 `resumeExistingMission`（active mission 时）或 `renderPreflight`（无 mission 时）。未改成 dashboard first view。Spec §10 说"/topology output must be current-Mission-first" — 但修改此行为会改变 preflight 流程，slice 5 保留原行为，slice 6 迁移。
- **`topology_doctor` 多 Mission 健康检查**：当前 doctor 仍走 legacy paths。Slice 5.1（如果 reviewer 要求）可加 per-Mission doctor checks（per-mission 目录存在、mirror 一致性、sessions.jsonl 完整性、packet-ledger 完整性等）。
- **`topology_smoke` 多 Mission smoke**：当前 smoke 仍走 legacy paths。同上。
- **active history viewer**：`include_history=true` 历史 viewer（spec §7 mentioned）仍未实现。
- **dashboard 自动 refresh**：`topology_dashboard_widget` 当前是 pull-based（每次调用 read）。未来可以加 hook-based push（`ctx.ui.setStatus` on session heartbeat / packet lifecycle event）。
- **dashboard diff/compare**：跨 Mission 对比 / 跨时间对比仍未实现。
- **`missions/<id>/closeout.json` 写入 helper**：dashboard 只读 closeout_path（从 registry）。closeout 写入流程（spec §9）留给 slice 7 dogfood。

### 7.2 Process cleanup evidence
本 slice 无 E2E / 无新进程。slice 7 必填 10 项规则（已存 `target=project` memory）仍未触发。

### 7.3 实施者立场

slice 5 落地干净：24/24 new tests + 271/271 全量 tests + smoke pass。Dashboard 是 read-only by default，3 个新工具 + 2 个新命令都是 add-only（不动 legacy）。Spec §10 8 字段全部 populable，spec §11 widget format 已暴露。

请 Reviewer 复审 + 决定是否进 slice 6（Migration: legacy `topology_status` 工具 + `topology-status` 命令迁移到 per-Mission paths，bare `/topology` 改为 dashboard first view）。
