# Slice 6.1 Handoff — Close two migration audit / entry-stability gaps

日期：2026-06-17
项目：OMP拓扑网络 / `packages/pi-topology`
实施者：Pi Coder (MiniMax-M3, Pi Harness)
Commit：`aaa884f fix(slice-6.1): close two migration audit / entry-stability gaps` (local, not pushed)
前置：`f63d337 slice(6)` + `records/2026-06-17-pi-topology-slice-6-handoff.md`
触发：Codex Reviewer 暂不放行 Slice 7，要求先修两个 P2 漏口
状态：✅ 4 new tests + 297/297 全量 tests + smoke pass

## 1. 修复

| Finding | 优先级 | 修复 | 状态 |
| --- | --- | --- | --- |
| 缺 legacy status-board.json 没记录 inferred-empty | P2 | legacy 缺 status board 时重写 per-Mission 副本加 `_meta.inferred_empty: true` + 加 status-board.json 到 files_created_empty | ✅ |
| Unsafe legacy mission_id 让 migration hard throw | P2 | validation 阶段显式跑 `validateMissionIdPathSegment`，失败返回 `validation_failed` + 零写入 | ✅ |

## 2. 修复内容

### 2.1 P2 (1): status-board inferred-empty

**`src/runtime/migration.ts` `migrateLegacyToPerMission`**：

**Before**：
```ts
const legacyStatusBoardMissing = !legacy.status_board;  // unused
const { created } = createMissionLayout({
  workspaceDir,
  missionCard: legacy.mission_card,
  initialStatusBoard: legacy.status_board ?? fallback,  // 无源
});
// status-board.json 写入时没 _meta，files_created_empty 也不含
```

**After**：
```ts
const legacyStatusBoardMissing = !legacy.status_board;
const initialStatusBoard: StatusBoard = legacy.status_board ?? fallback;
const { created } = createMissionLayout({ ... });
if (legacyStatusBoardMissing) {
  const raw = readFileSync(layout.statusBoardPath, "utf8");
  const parsed = JSON.parse(raw);
  writeFileSync(
    layout.statusBoardPath,
    `${JSON.stringify({ ...parsed, _meta: { inferred_empty: true } }, null, 2)}\n`,
    "utf8",
  );
  files_created_empty.push("status-board.json");
}
```

`createMissionLayout` 仍然成功创建所有 layout 目录和文件；仅当 legacy status board 缺时，per-Mission 副本被改写带 `_meta` 标记 + 加到 `files_created_empty`。

### 2.2 P2 (2): unsafe mission_id

**`src/runtime/migration.ts` `migrateLegacyToPerMission`**：

**Before**：
```ts
const validation = validateMissionCard(legacy.mission_card);
if (!validation.ok) return { mode: "validation_failed", ... };
// (没有 mission_id 校验) → 后续 missionLayoutPaths → throw
```

**After**：
```ts
const validation = validateMissionCard(legacy.mission_card);
if (!validation.ok) return { mode: "validation_failed", ... };

// Slice 6.1: defense in depth
try {
  validateMissionIdPathSegment(legacy.mission_id);
} catch (err) {
  return {
    ok: false,
    mode: "validation_failed",
    mission_id: legacy.mission_id,
    reason: `legacy mission_id invalid: ${(err as Error).message}`,
    files_migrated, files_created_empty, warnings, generated_at,
  };
}
```

校验阶段先于任何文件写入。失败 → `validation_failed` + 0 写入。

## 3. 关键设计决策

- **Defense in depth**：slice 1 闸 `validateMissionIdPathSegment` 在 `missionLayoutPaths` 入口已经守；现在 migration 也加了一层，让**校验阶段**就拦截 unsafe mission_id（不需要走到 layout 创建阶段才 throw）
- **Inferred-empty 区分**：per spec §12.1 reviewer 审计要求。present legacy → 原样迁移；missing legacy → inferred_empty 标记
- **Zero writes on failure**：unsafe mission_id 时 `files_migrated` / `files_created_empty` 都是空数组（默认初始化），保证 operator 看到 0 写入的明确信号

## 4. Changed files (2 modified, 0 new)

| 文件 | 状态 | 变化 |
| --- | --- | --- |
| `packages/pi-topology/src/runtime/migration.ts` | modified | +45 / -3（status-board rewrite + mission_id 校验）|
| `packages/pi-topology/test/unit/migration.test.ts` | modified | +125 / -5（4 new tests）|

Total: 2 files modified, +170 / -8.

**未改**：其他所有文件。`src/transport/*` / `src/extension/*` / `src/runtime/spawn.ts` / `src/runtime/mission.ts` / 任何已有 module。

## 5. 新增 test (4)

- `migration: missing legacy status-board.json marks per-Mission status-board as inferred_empty (slice 6.1)` —— **reviewer 复现 case**：`has_status_board: false` → per-Mission status-board 有 `_meta.inferred_empty: true` + `files_created_empty` 包含 `status-board.json`
- `migration: present legacy status-board.json does NOT mark per-Mission copy as inferred_empty (slice 6.1)` —— 验证：present legacy board **不**带 inferred_empty 标记
- `migration: unsafe legacy mission_id returns validation_failed (no throw, no writes, slice 6.1)` —— **reviewer 复现 case**：`mission_id: "../evil"` → `validation_failed`，0 写入（验证：no `missions/` dir、no `mission-registry.json`、no `active-mission.json`）
- `migration: legacy mission_id with embedded slash returns validation_failed (no throw, slice 6.1)` —— `mission_id: "subdir/escape"` 同样 `validation_failed`

## 6. Smoke 验证

```
$ cd packages/pi-topology && npm run smoke

# tests 297
# pass 297
# fail 0

> typecheck: strip-types import ok
> tarball: pi-topology-network-0.1.0.tgz
> package size: 106.2 kB (slice 6: 105.6 kB, +0.6 kB)
> total files: 61 (unchanged)
```

293 → 297 tests，typecheck pass，pack dry-run pass。

## 7. Evidence paths

- 修复 commit：`aaa884f fix(slice-6.1): close two migration audit / entry-stability gaps`
- Handoff commit：紧随其后
- Handoff doc：`records/2026-06-17-pi-topology-slice-6-1-handoff.md`（本文件）
- Spec 对位：§12.1 inferred-empty 区分 ✅ / §3.3 mission_id 防御 ✅
- API audit 对位：本 slice 不引入新 Pi primitive
- 闸纪律：所有 slice 1-6 gates 仍生效

## 8. 给 Reviewer 的 finding 复审

### [P2] status-board inferred-empty
- ✅ legacy 缺 status board → per-Mission 副本加 `_meta.inferred_empty: true` + `status-board.json` 在 `files_created_empty`
- ✅ legacy 有 status board → 原样迁移，不加 inferred_empty 标记
- ✅ 测试 20 + 21 验证

### [P2] unsafe mission_id
- ✅ validation 阶段先跑 `validateMissionIdPathSegment`，失败 → `validation_failed` + 0 写入
- ✅ 测试 22 (`../evil`) + 23 (`subdir/escape`) 验证
- ✅ 已有 19 个 slice 6 tests 仍 pass（行为零变化 for valid cases）

## 9. 已知遗留 / 未来 slice 关注

### 9.1 仍未实现（不在 slice 6.1 范围）

- **legacy `topology_status` 工具迁移到 dashboard**：仍是 legacy fallback。slice 5 handoff + slice 6 handoff 都标为遗留；Reviewer 同意不阻断。
- **legacy `topology-status` 命令迁移**：同上
- **`topology_doctor` 多 Mission 健康检查**：slice 7 之前
- **`topology_smoke` 多 Mission smoke**：slice 7 之前
- **E2E window governance**：slice 7 必填 10 项规则仍未触发

### 9.2 实施者立场

P2 两漏口已修。Status-board inferred-empty 区分 + mission_id 入口稳定性。297/297 全量 + smoke 干净。

请 Reviewer 复审放行 Slice 7（Final dogfood Mission with direct generated-script launches）。
