# Slice 1 Handoff — Mission registry and per-Mission directory layout

日期：2026-06-17
项目：OMP拓扑网络 / `packages/pi-topology`
实施者：Pi Coder (MiniMax-M3, Pi Harness)
Commit：`5c8584f` (local, not pushed)
前置 spec：`docs/14-pi-topology-mission-runtime-spec.md` §3 + §13 slice 1
前置 audit：`records/2026-06-17-pi-topology-mission-runtime-api-audit.md`

## 1. 实施 note

按 spec §3 directory layout + §13 slice 1 实施。新增 4 个 runtime 模块 + 1 个 lifecycle 类型模块 + 1 个测试文件，**完全不动** raw packet transport / `ctx.newSession` / `ctx.switchSession` / visible peer script 生成路径。

### 1.1 新增模块

- `src/runtime/mission-lifecycle.ts` —— Mission lifecycle 12 态类型 + 旧 status → lifecycle 映射
- `src/runtime/mission-registry.ts` —— `MissionRegistry` 类型 + 读写 + `addMissionToRegistry` / `findMissionInRegistry` / `setRegistryActiveMission` / `validateMissionRegistry`
- `src/runtime/mission-pointer.ts` —— `ActiveMissionPointer` 类型 + 读写 + clear + validate
- `src/runtime/mission-layout.ts` —— `missionLayoutPaths` 路径计算 + `createMissionLayout` 一次性创建完整 spec §3.1 文件骨架 + `expectedLayoutEntries` 验证清单
- `src/runtime/root-mirror.ts` —— spec §3.2 root 兼容镜像：`syncRootMirrorFromLayout` 全量同步 + `copyRootMirrorFile` 单文件 + `rootMirrorMatchesLayout` 校验 + `appendToJsonlLedger` append-only 同步

### 1.2 镜像的 root 文件（slice 1 范围）

| Per-mission | Root 兼容镜像 | 同步机制 |
| --- | --- | --- |
| `mission-card.json` | `.pi/topology/mission-card.json` | `syncRootMirrorFromLayout` |
| `status-board.json` | `.pi/topology/status-board.json` | `syncRootMirrorFromLayout` |
| `runtime-events.jsonl` | `.pi/topology/runtime-events.jsonl` | `syncRootMirrorFromLayout` + `appendToJsonlLedger` |
| `incident-log.jsonl` | `.pi/topology/incident-log.jsonl` | `syncRootMirrorFromLayout` + `appendToJsonlLedger` |
| `sessions.jsonl` | `.pi/topology/sessions.jsonl` | `syncRootMirrorFromLayout` + `appendToJsonlLedger` |

**不在 slice 1 镜像范围（deferred）**：
- `launch/` 脚本（spec §3.1 + §12.2，slice 6 migration 负责）
- `artifacts/`（slice 5 dashboard / slice 6）
- `packet-ledger.jsonl`（slice 4 inbox cleanup，且 raw packet transport 路由 slice 1 rule 禁止改）
- `evidence-index.jsonl`（slice 5 dashboard）
- `slices/<id>-notes.md`（按 slice 增长）

### 1.3 不变量（slice 1 强制）

- `createMissionLayout` **幂等**：同一 mission_id 二次调用不重写
- `clearActiveMissionPointer` **幂等**：第二次返回 `false`，不抛
- `syncRootMirrorFromLayout` **不删** 任何 per-mission 文件
- 切换 active Mission 时**只改 root mirror**，不删任何 per-mission folder（spec §3.2 + PRD review Gap 1.2 关联）
- `appendToJsonlLedger` **append-only**：per-mission 文件是 source of truth，root mirror 复制同内容

## 2. Changed files

| 文件 | 状态 | 行数 |
| --- | --- | --- |
| `packages/pi-topology/src/runtime/mission-lifecycle.ts` | new | 53 |
| `packages/pi-topology/src/runtime/mission-registry.ts` | new | 230 |
| `packages/pi-topology/src/runtime/mission-pointer.ts` | new | 99 |
| `packages/pi-topology/src/runtime/mission-layout.ts` | new | 167 |
| `packages/pi-topology/src/runtime/root-mirror.ts` | new | 149 |
| `packages/pi-topology/test/unit/mission-registry.test.ts` | new | 375 |

Total: 6 files new, 1073 insertions, 0 deletions, 0 modifications.

**未修改**（slice 1 rules 强制）：
- `src/transport/local-coms.ts` + `net-coms.ts` + `live-coms.ts` + `registry.ts`（raw packet transport 不动）
- `src/extension/register.ts`（不引入 `ctx.newSession` / `ctx.switchSession`）
- `src/runtime/spawn.ts`（visible peer generated scripts 保持 `local_protocol`）
- `src/runtime/mission.ts`（现有 mission card 创建 / validate / status board / watchdog 逻辑保留）

## 3. Focused tests

`test/unit/mission-registry.test.ts` —— 13 tests, 4 用户要求类别全覆盖：

### Registry creation (2 tests)
- `createEmptyRegistry returns a versioned, empty registry with no active mission` —— 数据形态
- `writes and reads registry JSON in a no-mission workspace` —— 写盘 + 读盘 + validate

### Active pointer (3 tests)
- `readActiveMissionPointer returns null when no pointer file exists` —— 不存在 pointer 时 null
- `writeActiveMissionPointer persists, reads back, validates, and clears` —— 完整写读清循环
- `setRegistryActiveMission flips active_mission_id and updates timestamp` —— registry 内 setActive（区别于 active-mission.json 写盘）

### Per-mission folders (2 tests)
- `missionLayoutPaths computes the spec §3.1 layout with all required subpaths` —— 13 个路径全在
- `createMissionLayout creates all expected files and dirs, and is idempotent on rerun` —— 创建 + 幂等

### Root mirror compatibility (3 tests)
- `syncRootMirrorFromLayout copies active mission files to root compatibility paths` —— 全量镜像 + 一致性校验
- `switching the active Mission updates root mirror and preserves old per-mission folder` —— 切 active 不删旧 folder
- `copyRootMirrorFile copies a single ledger when only one file changed` —— 单文件 copy
- `appendToJsonlLedger updates both per-mission and root mirror, leaving previously mirrored missions untouched` —— append-only + B 不受 A 影响

### Other (3 tests)
- `addMissionToRegistry adds a new entry and is idempotent on duplicate id` —— registry 增量
- `registry file is named per spec and lives at .pi/topology/mission-registry.json` —— 路径约定

## 4. Smoke 验证

```
$ cd packages/pi-topology && npm run smoke

> pi-topology-network@0.1.0 smoke
> npm run test && npm run typecheck && npm_config_cache=/tmp/pi-topology-npm-cache npm pack --dry-run

# tests 93
# pass 93
# fail 0

> tarball: pi-topology-network-0.1.0.tgz
> package size: 75.1 kB (was 69.1 kB, +6 kB)
> total files: 53 (was 48, +5 src files)
```

93 unit tests 全过（80 旧 + 13 新），typecheck 通过，`npm pack --dry-run` 干净。

## 5. Evidence paths

- 提交：`5c8584f slice(1): add mission registry layout` (local, master branch)
- 父提交：`888ad92 docs(pi-topology): audit mission runtime api alignment`
- 新增源文件（runtime layer）：
  - `packages/pi-topology/src/runtime/mission-lifecycle.ts`
  - `packages/pi-topology/src/runtime/mission-registry.ts`
  - `packages/pi-topology/src/runtime/mission-pointer.ts`
  - `packages/pi-topology/src/runtime/mission-layout.ts`
  - `packages/pi-topology/src/runtime/root-mirror.ts`
- 新增测试：
  - `packages/pi-topology/test/unit/mission-registry.test.ts`
- Spec 对位：
  - §3.1 directory layout —— `mission-layout.ts` 的 `missionLayoutPaths`
  - §3.2 compatibility files —— `root-mirror.ts` 的 5 个 ROOT_MIRROR_FILES
  - §3.3 active pointer —— `mission-pointer.ts` 完整结构
  - §3.4 mission registry —— `mission-registry.ts` 完整结构
  - §13 slice 1 —— 实施目标对齐

## 6. 已知风险 / 给 Reviewer 的问题

### 6.1 已知 / 已控风险

- **`mission-registry.json` 不存在时** root 文件仍是 canonical（spec §3.2 migration 模式）。Slice 1 不引入 "root files are mirrors" 的 enforcement —— slice 6 migration 负责从单根 mission-card 形态迁出。本 slice 的 `readMissionRegistry` 返回 `null` 时，调用方应按 spec §5.1 的 fallback 流程处理。
- **`syncRootMirrorFromLayout` 只在调用方主动触发时执行**。未引入自动 hook（每次写 per-mission 都自动 mirror）。这意味着调用方需要：
  - 创建 Mission 后调一次 `syncRootMirrorFromLayout`
  - append JSONL ledger 时调 `appendToJsonlLedger`（已实现）
  - 改 mission-card.json / status-board.json 时调 `syncRootMirrorFromLayout`（**未**自动 hook —— 见 6.2）
- **append-only ledger 同步策略**：`appendToJsonlLedger` 读 per-mission 末尾 + append + 同步 root，**不** root-aware merge。如果调用方直接写 root mirror（绕开 helper），mirror 会与 per-mission 不一致。已加 `rootMirrorMatchesLayout` 校验 helper，建议后续 slice 集成时统一走 helper。
- **`missionDirRelative` 用 `.pi/topology/missions/<id>` 形式存储**，跨平台时 `path.join` 行为差异。Mac/Linux 上 `.pi/topology/...` 正确；Windows 上 `path.join` 会用 `\` —— 当前 OMP 仅 Mac 实测，跨平台未验证。

### 6.2 给 Reviewer / Spec 阶段的问题

1. **mission-card.json / status-board.json 的同步** 是否要加 event-driven hook（写 per-mission 即同步 root）？还是 slice 2 supervisor 显式调 `syncRootMirrorFromLayout`？当前是后者。
2. **`role_summary` 字段在 `newMissionRegistryEntry` 中默认全 0**。Slice 3 session registry 落地后应能 derive 当前值。Slice 1 接受初始 0，**不**伪造。
3. **`pending_packet_count` + `incident_count` 同样默认 0**。Slice 4 inbox cleanup + 现有 incident log 整合时同步 derive。
4. **closeout.md 切片时是 placeholder**。Spec §9.1 要求 deliver 时 closeout 含 final verdict / changed files / remaining risks 等。Slice 1 只生成 placeholder，slice 9 (final delivery) 负责。
5. **launch/ 目录 slice 1 创建空目录**，**不**复制 root `launch/*.sh` 脚本。复制逻辑在 slice 6 migration 负责。
6. **per-mission file 全部同步至 root，跨 mission 时会改 root**。这意味着 active 切换有 O(file-size) 同步开销。当前 5 个文件 × O(几百字节) = 几 ms 级别，可接受。Slice 6 migration 时如果文件增长需重新评估（增量同步 / 软链等）。
7. **Spec §3.2 "mirror updates must be centralized through path helpers to avoid double-write bugs"** —— slice 1 实现了 `appendToJsonlLedger` 集中点，但 mission-card.json / status-board.json 写盘 + 镜像需调用方主动组合。Reviewer 可决定是否加一层 `updatePerMissionMissionCardAndMirror()` 集成 helper。

### 6.3 不在 slice 1 范围（明确 defer）

- Picker / resume UI（slice 2）
- Mission 创建 CLI 入口（slice 2 入口 + slice 6 migration 兼顾）
- Session registry 5 态分类（slice 3）
- Inbox cleanup（slice 4）
- Dashboard / status multi-Mission 渲染（slice 5）
- 迁移 single-mission → per-mission（slice 6）
- 现有 `mission-card.json` 实际数据搬迁（slice 6）
- Launch script 复制到 per-mission（slice 6）
- `topology_status` / `topology_doctor` 切换到 per-mission 数据源（slice 5+）
- `ctx.newSession` / `ctx.switchSession` 任何使用（规则禁止）

## 7. 实施者立场

Slice 1 实施完成且 smoke 通过。**未**触发 raw packet transport 变更、**未**引入 `ctx.newSession` / `ctx.switchSession`、**未**修改 visible peer script 生成路径、**未**改现有 `mission.ts` 核心逻辑、**未**改 `register.ts` lifecycle handler。Reviewer 确认后即可进 slice 2（Supervisor mission picker and mission resume/create flow）。
