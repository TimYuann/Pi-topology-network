# Slice 6 Handoff — Migrate legacy single-Mission layout to per-Mission layout

日期：2026-06-17
项目：OMP拓扑网络 / `packages/pi-topology`
实施者：Pi Coder (MiniMax-M3, Pi Harness)
Commit：`f63d337 slice(6): migrate legacy single-Mission layout to per-Mission layout` (local, not pushed)
前置 spec：`docs/14-pi-topology-mission-runtime-spec.md` §12 + §13 slice 6
前置 slice：`856b1c4 fix(slice-5.1)` + `records/2026-06-17-pi-topology-slice-5-1-handoff.md`
状态：✅ 19/19 new tests + 293/293 全量 tests + smoke pass

## 1. 实施 note

按 spec §12.1 实施。新增 1 个 runtime 模块 + 1 个工具 + 1 个命令 + 1 个新测试 + 1 个测试更新 + 1 个命令（bare `/topology` 升级为 dashboard-first per spec §10）。

### 1.1 新增模块

**`src/runtime/migration.ts`** —— 完整 spec §12.1 migration flow：

- **`detectLegacyLayout(workspaceDir)`** —— 触发条件：根 `.pi/topology/mission-card.json` 存在 AND 根 `mission-registry.json` 不存在
- **`isMigrationNeeded(workspaceDir)`** —— convenience wrapper
- **`readLegacyMissionData(workspaceDir)`** —— 读 legacy 5 文件元数据（mission-card / status-board / sessions / runtime-events / incident-log），返回 `null` 当 legacy 不存在或无效
- **`migrateLegacyToPerMission(workspaceDir, { now, dryRun })`** —— 完整 7 步流程（spec §12.1）：
  1. detect legacy
  2. read + validate legacy card
  3. create per-Mission layout via `createMissionLayout`
  4. copy legacy JSONL ledgers
  5. write mission-registry.json
  6. write active-mission.json (`reason: "migration"`)
  7. append `mission_lifecycle_transition` event (`from_state: "intake"`, `reason: "migrated from legacy single-Mission layout"`)
- **`formatMigrationResult(result)`** —— owner-facing text
- **Inferred-empty handling** (spec §12.1)：
  - 缺 legacy JSON 文件 → 写 `{ "_meta": { "inferred_empty": true } }`
  - 缺 legacy JSONL 文件 → 写 first row `{ "event_type": "migration_inferred_empty", "_meta": { "inferred_empty": true } }`
- **Idempotency**：
  - 再次运行 → `mode: "registry_present"`（不重复写）
  - 没有 legacy → `mode: "no_legacy"`
  - dryRun → 模拟不写
- **Non-destructive**：legacy 根文件保留
- **Validation failure** → `mode: "validation_failed"`，不写任何文件

### 1.2 新增工具

| 工具 | 描述 |
| --- | --- |
| `topology_migrate` (mode=plan) | 检测 legacy + 列文件元数据；不写 |
| `topology_migrate` (mode=execute) | 应用 migration |

### 1.3 新增命令

- `/topology migrate` —— plan
- `/topology migrate execute` —— execute

### 1.4 bare `/topology` 命令升级（spec §10 current-Mission-first）

3-branch routing:
1. **registry 存在** → `formatDashboardText(readDashboardSnapshot(cwd))`
2. **legacy 检测** → `renderMigrationPrompt(cwd)`（operator prompt）
3. **neither** → preflight (intake / no mission yet) —— 旧行为保留

### 1.5 未改

- 任何已有 module（除了 `tools.ts` / `commands.ts` 加新工具/命令 + bare `/topology` 升级）
- `src/transport/*`（raw packet transport 不动）
- `src/extension/register.ts`（不引入 `ctx.newSession` / `ctx.switchSession`）
- `src/runtime/spawn.ts`（visible peer scripts 保持 `local_protocol`）
- `src/runtime/mission.ts`（现有 mission card 创建逻辑保留）
- legacy `topology_status` 工具 / `topology-status` 命令（保留 legacy 路径；作为可读 fallback）

### 1.6 关键设计决策

#### 1.6.1 Migration 是 opt-in，不是自动
虽然 spec §12.1 没有强制 operator 必须跑 migration，但**默认行为是不自动 migration**：
- 理由：migration 会写多个文件、改变 workspace 拓扑结构；operator 应该先看到 plan，确认后再 execute
- `topology_migrate` 工具分 `plan` / `execute` 两步
- `/topology migrate` (bare) 是 plan
- 已有 dashboard 可以在不 migration 的情况下工作（per spec §10：spec 没强制要求 migration 才能用 dashboard）

#### 1.6.2 Non-destructive
legacy 根文件保留。即使 migration 完成，root `mission-card.json` 和 `status-board.json` 仍可读。理由：
- 旧工具（`topology_status` / `topology-status`）继续可用
- operator 可以验证 migration 正确后再决定是否手动清理
- 防止一次性删除造成回滚困难

#### 1.6.3 Idempotency
多次运行 migration 是安全的：
- 第二次运行时，registry 已存在 → `mode: "registry_present"`
- 不会出现重复 Mission 记录
- 不会出现"覆盖"风险

#### 1.6.4 Inferred-empty handling
per spec §12.1 "Reviewers must be able to distinguish 'truly no events yet' from 'legacy file was missing during migration.'"。本 slice 实现：
- 缺 JSON 文件 → 写 `{ "_meta": { "inferred_empty": true } }`
- 缺 JSONL 文件 → first row `{ "event_type": "migration_inferred_empty", "_meta": { "inferred_empty": true } }`

#### 1.6.5 mission_lifecycle_transition event
不用新 `mission_migrated` 事件类型；复用 `mission_lifecycle_transition` with reason="migrated from legacy single-Mission layout"。context 字段记录 files_migrated / files_created_empty。这样下游 dashboard / doctor 不需要新增事件类型支持。

#### 1.6.6 复用 slice 1 闸纪律
- `validateMissionIdPathSegment` 在 `missionLayoutPaths` 入口仍然守
- `missionRegistry` 写仍走 `addMissionToRegistry` + `writeMissionRegistry` 闸
- 防御性 mission_id 校验在 dashboard 层已加（slice 5.1）

### 1.7 不变量

- 所有现有 slice 1-5 gates 仍生效
- 不引入 `ctx.newSession` / `ctx.switchSession`
- 不改 raw transport
- legacy `topology_status` 工具 / `topology-status` 命令保留
- 不动 dashboard 行为（仅加 1 个 dashboard 入口：bare `/topology` 优先级提升）
- migration 完成后所有 slice 5 8-field dashboard 数据可读

## 2. Changed files (2 new, 3 modified)

| 文件 | 状态 | 行数 |
| --- | --- | --- |
| `packages/pi-topology/src/runtime/migration.ts` | new | 489 行 |
| `packages/pi-topology/test/unit/migration.test.ts` | new | 490 行（19 tests）|
| `packages/pi-topology/src/extension/tools.ts` | modified | +57 / -0（1 新工具）|
| `packages/pi-topology/src/extension/commands.ts` | modified | +60 / -0（1 新命令 + bare `/topology` 3-branch routing）|
| `packages/pi-topology/test/unit/extension.test.ts` | modified | +1 / -0（更新 tool registry list 15→16）|

Total: 2 new + 3 modified, +1110 / -0.

## 3. Focused tests (19 new)

### Detection (3)
- `detectLegacyLayout returns false when workspace has no .pi`
- `detectLegacyLayout returns true when root mission-card.json exists without registry`
- `detectLegacyLayout returns false when registry exists`

### readLegacyMissionData (3)
- `readLegacyMissionData returns null for missing card`
- `readLegacyMissionData returns null for invalid card (no mission_id)`
- `readLegacyMissionData surfaces all 5 file paths with exists + bytes`

### Migration happy paths (5)
- `migrateLegacyToPerMission copies mission-card + status-board to per-Mission dir`
- `migrateLegacyToPerMission copies sessions/runtime_events/incident_log to per-Mission dir`
- `writes mission-registry.json with the migrated mission`
- `writes active-mission.json with reason=migration`
- `appends mission_lifecycle_transition event to runtime-events.jsonl`

### Edge cases (6)
- `missing sessions.jsonl creates inferred_empty file (per spec §12.1)`
- `keeps legacy root files intact (non-destructive)`
- `is idempotent — second call returns mode=registry_present (no duplicate Mission)`
- `no-legacy mode when workspace has no mission-card.json`
- `registry_present mode when registry already exists`
- `dry-run does not write any files`

### Validation + format (2)
- `invalid mission-card.json returns validation_failed`
- `formatMigrationResult includes ok, mode, mission_id, files_migrated, files_created_empty`

## 4. Smoke 验证

```
$ cd packages/pi-topology && npm run smoke

# tests 293
# pass 293
# fail 0

> typecheck: strip-types import ok
> tarball: pi-topology-network-0.1.0.tgz
> package size: 105.6 kB (slice 5.1: 100.6 kB, +5.0 kB)
> total files: 61 (slice 5.1: 60, +1 new src)
```

274 → 293 tests，typecheck pass，pack dry-run pass。

## 5. Evidence paths

- 实施 commit：`f63d337 slice(6): migrate legacy single-Mission layout to per-Mission layout`
- Handoff commit：紧随其后
- Handoff doc：`records/2026-06-17-pi-topology-slice-6-handoff.md`（本文件）
- Spec 对位：
  - §12.1 7 步流程全部实现 ✅
  - §12.1 inferred-empty handling 实现 ✅
  - §12.2 Mirror updates 由 slice 1 `root-mirror.ts` 负责（无需在 slice 6 重复）✅
  - §13 slice 6 实施目标对齐
- API audit 对位：本 slice 不引入新 Pi primitive
- 闸纪律：所有 slice 1-5 gates 仍生效

## 6. 给 Reviewer 的关键确认

| 闸规则 | 状态 |
|---|---|
| 仅 `src/runtime/*` 新增 + `extension/*` 增量添加 | ✅ 新模块 `migration.ts`；tools/commands 各加 1/1 + bare 升级 |
| 不改 raw packet transport | ✅ `src/transport/*` 零修改 |
| 不引入 `ctx.newSession` / `ctx.switchSession` | ✅ 零 Pi API 引用 |
| 不改 visible peer script 生成路径 | ✅ `src/runtime/spawn.ts` 零修改 |
| 不改现有 `mission.ts` mission card 创建逻辑 | ✅ 零修改 |
| 不动 legacy `topology_status` 工具 / `topology-status` 命令 | ✅ 保留 |
| `npm run smoke` 通过 | ✅ 293/293 + typecheck + pack |

## 7. 已知遗留 / 未来 slice 关注

### 7.1 仍未实现（不在 slice 6 范围）

- **legacy `topology_status` 工具迁移到 dashboard**：当前仍读 root `mission-card.json`。Operator 用 dashboard 后可以忽略 legacy 工具。彻底迁移是 5.1 之后清理项。
- **legacy `topology-status` 命令迁移**：同上。保留 `loadTopologyState`。
- **`topology_doctor` 多 Mission 健康检查**：slice 6 之后可加。
- **`topology_smoke` 多 Mission smoke**：slice 6 之后可加。
- **per-Mission doctor 集成 doctor 到 dashboard**：当前 doctor 是单 Mission。

### 7.2 E2E window governance
本 slice 无 E2E / 无新进程。slice 7 必填 10 项规则仍未触发。

### 7.3 实施者立场

slice 6 落地干净：19/19 new tests + 293/293 全量 tests + smoke pass。Migration 是 opt-in（plan → execute 两步），idempotent，non-destructive，inferred-empty 区分，bare `/topology` 升级为 spec §10 current-Mission-first 3-branch routing。

请 Reviewer 复审 + 决定是否进 slice 7（Final dogfood Mission with direct generated-script launches, 1 workspace，E2E 验证）。
