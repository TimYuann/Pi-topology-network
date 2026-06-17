# Slice 1.1 Handoff — Address 3 Reviewer Findings

日期：2026-06-17
项目：OMP拓扑网络 / `packages/pi-topology`
实施者：Pi Coder (MiniMax-M3, Pi Harness)
Commit：`055e821 fix(slice-1): address 3 reviewer findings (progress_status, path safety, active_id validation)` (local, not pushed)
前置：`5c8584f slice(1): add mission registry layout` + `records/2026-06-17-pi-topology-slice-1-handoff.md`
触发：Codex Reviewer block Slice 2 with 3 findings (2 P1 + 1 P2)
状态：✅ 3 findings 全部修复 + 9 新增 focused tests + smoke 通过 + 102/102 tests pass

## 1. 修复摘要

| Finding | 优先级 | 修复 | 状态 |
| --- | --- | --- | --- |
| [P1] Registry entry 缺 `progress_status` | P1 | 类型 + 输入参数 + 默认值 + validator + 3 tests | ✅ |
| [P1] `mission_id` 路径穿越风险 | P1 | `validateMissionIdPathSegment` + 路径 resolve containment check + 4 tests | ✅ |
| [P2] `active_mission_id` 可指向不存在 mission | P2 | `setRegistryActiveMission` 拒绝未知 id + validator 校验 + 2 tests | ✅ |

## 2. [P1] progress_status 字段

### 2.1 修复内容

**`src/runtime/mission-lifecycle.ts`** —— 新增 legacy status 列表与类型：
- `MISSION_LEGACY_PROGRESS_STATES` (7 值): `draft | awaiting_owner_confirmation | supervisor_ready | running | blocked | completed | abandoned`
- `MissionLegacyProgressStatus` 类型
- `isMissionLegacyProgressStatus()` 类型守卫
- `DEFAULT_MISSION_PROGRESS_STATUS = "awaiting_owner_confirmation"`（与 spec §3.4 示例一致）

**`src/runtime/mission-registry.ts`** —— 接通 progress_status：
- `MissionRegistryEntry` 加 `progress_status: MissionLegacyProgressStatus` 字段
- `NewMissionRegistryEntryInput` 加 `progress_status?: MissionLegacyProgressStatus` 可选参数
- `newMissionRegistryEntry()` 默认 `progress_status = DEFAULT_MISSION_PROGRESS_STATUS`
- `validateMissionRegistry()` 检查 `progress_status` 是 7 值之一（用 `isMissionLegacyProgressStatus` 守卫），缺失或非法 → 错误

### 2.2 设计要点

**`progress_status` 与 `lifecycle_state` 的关系**（按 spec §3.4 + §4.1）：
- `lifecycle_state` = 新版 12 态 Mission 生命周期
- `progress_status` = 旧版 7 态 `MissionProgress.status` 值（pre-slice-1 兼容）
- 二者**不**完全 1:1：例如旧 `supervisor_ready` 映射到新 `awaiting_owner_confirmation`（见 `MISSION_PROGRESS_TO_LIFECYCLE`）
- Reviewer 确认 `progress_status` 是关键兼容字段，必须保留旧 status 信息

**默认策略**：
- `progress_status` 默认 `awaiting_owner_confirmation`（spec §3.4 示例默认）
- 调用方可显式 override（如 `progress_status: "supervisor_ready"` 表达旧用法）
- 内部用 `isMissionLegacyProgressStatus` 类型守卫，TypeScript 编译时 + runtime validate 双重防御

### 2.3 新增 tests

- `newMissionRegistryEntry defaults progress_status to awaiting_owner_confirmation`
- `newMissionRegistryEntry accepts an explicit progress_status`（测 `supervisor_ready` legacy value）
- `validateMissionRegistry rejects entries with missing or invalid progress_status`（覆盖 missing + invalid value 两类）

## 3. [P1] mission_id 路径穿越防护

### 3.1 修复内容

**`src/runtime/mission-layout.ts`** —— 双层防御：

**Layer 1: 格式校验**（在 `validateMissionIdPathSegment`）：
- 拒绝非字符串
- 拒绝空字符串 / `.` / `..`
- 拒绝非 `[A-Za-z0-9._-]+` 字符（包括 `/` `\` 空格 NUL 等）
- 拒绝以 `.` 开头的 segment（隐藏目录）

**Layer 2: 路径 containment check**（在 `missionLayoutPaths`）：
- `path.resolve(missionRegistryDir(workspaceDir))` 作为 root
- `path.resolve(missionDirAbsolute)` 必须等于 root 或以 `root + path.sep` 开头
- 否则抛 `InvalidMissionIdError`

**`InvalidMissionIdError` 类**（自定错误类型）：
- 继承 `Error`
- 包含 `missionId` 字段
- 携带可定位 message（含原始输入 + 拒绝原因）

**`missionLayoutPaths` 与 `createMissionLayout` 入口**：
- 两者都调 `missionLayoutPaths`（后者复用前者）
- 入口即校验，**所有下游路径**继承安全保证
- 抛 `InvalidMissionIdError` 时不修改文件系统（partial write 防护已天然成立 —— `mkdirSync` 之前就 throw）

### 3.2 设计要点

**Defense in depth**：
- 格式层拒绝**任何** unsafe char（即使绕过也无法构造合法 path.resolve 输入）
- 路径层兜底（即使格式层漏，escape 也被拦）
- 两层都用**同一种** error type，方便上游 catch

**Backward compat**：
- 现有 `createMissionDraft` 输出 `omp-2026-06-17-001` 等 slug（`[a-z0-9-]+`），全部通过校验
- 测试中用 `dogfood-alpha` / `dogfood-beta` 等都通过

**错误信息**：
- 包含原始输入（用 `JSON.stringify` 防止 NUL / 特殊字符干扰）
- 包含拒绝原因（如 `"must not be empty, '.', or '..'"` / `"must not start with '.'"`）
- 测试用 `err instanceof InvalidMissionIdError` 精确断言

### 3.3 新增 tests

- `validateMissionIdPathSegment rejects path-traversal and unsafe characters`（13 个负例 + 5 个正例）
- `missionLayoutPaths throws on path-traversal mission id`（4 个负例：`..` / `../etc` / `foo/bar` / `.hidden`）
- `createMissionLayout throws on path-traversal mission id`（验证抛错 + workspace 状态未污染）
- `missionLayoutPaths is robust against path.resolve attacks (defense in depth)`（验证 `escapes missions root` 错误路径被拦）

## 4. [P2] active_mission_id 一致性

### 4.1 修复内容

**`src/runtime/mission-registry.ts`**：

**`setRegistryActiveMission` 加 throw**：
- `missionId !== null` 时查 `registry.missions.some(m => m.mission_id === missionId)`
- 不存在则 throw `Error("setRegistryActiveMission: cannot set active_mission_id to unknown mission ...")`
- `null` 仍允许（清空 active 是合法操作）

**`validateMissionRegistry` 加 active_mission_id 校验**：
- 若 `r.active_mission_id` 是 string 且 `r.missions.length > 0`
- 校验 `r.missions[].mission_id` 是否包含 `r.active_mission_id`
- 不包含则错误：`active_mission_id "X" not found in missions[]`

### 4.2 设计要点

**两道闸**（按 Reviewer 建议"两者都做"）：
- **运行时闸**（`setRegistryActiveMission` throw）：代码路径上不能写出不一致状态
- **静态闸**（`validateMissionRegistry`）：从外部读 JSON 时也能发现不一致（防止读盘后被信任）

**Error 信息**：
- 含未知 id
- 含已知 mission_id 列表（方便诊断）

**现有测试**：
- `setRegistryActiveMission flips active_mission_id and updates timestamp` 用 `setRegistryActiveMission(b, "a")`（"a" 在 b.missions 内）—— **仍通过**

### 4.3 新增 tests

- `setRegistryActiveMission throws when mission id is not in the registry`（空 registry + 已知 registry + null 三场景）
- `validateMissionRegistry rejects active_mission_id that does not match any mission entry`

## 5. Changed files

| 文件 | 状态 | 变化 |
| --- | --- | --- |
| `packages/pi-topology/src/runtime/mission-lifecycle.ts` | modified | +37 行（legacy status type + default constant）|
| `packages/pi-topology/src/runtime/mission-registry.ts` | modified | +57 行（progress_status + active_mission_id 校验）|
| `packages/pi-topology/src/runtime/mission-layout.ts` | modified | +50 行（InvalidMissionIdError + validator + containment check）|
| `packages/pi-topology/test/unit/mission-registry.test.ts` | modified | +9 tests, 调整 1 existing test 加 `progress_status` 字段 |

Total: 4 files modified, +356 insertions, -1 deletion.

**未改**（slice 1.1 不应触发）：
- `src/runtime/mission-pointer.ts`（active-mission.json 写盘的 pointer 校验放在 slice 2 picker）
- `src/runtime/root-mirror.ts`（mirror 操作不涉及 mission_id 输入）
- `src/runtime/mission.ts`（旧 mission card 创建逻辑保留）
- `src/extension/register.ts`（不引入 `ctx.newSession` / `ctx.switchSession`）
- 任何 `src/transport/*`（raw packet transport 不动）

## 6. Smoke 验证

```
$ cd packages/pi-topology && npm run smoke

# tests 102
# pass 102
# fail 0

> typecheck: strip-types import ok
> tarball: pi-topology-network-0.1.0.tgz
> package size: 76.5 kB (slice 1: 75.1 kB, +1.4 kB)
> total files: 53 (unchanged)
```

新增 9 tests（80 旧 + 13 slice 1 + 9 slice 1.1 = 102 total），typecheck pass，pack dry-run pass。

## 7. Evidence paths

- 修复 commit：`055e821 fix(slice-1): address 3 reviewer findings (progress_status, path safety, active_id validation)`
- 父 commit：`297c41d docs(pi-topology): record slice 1 handoff`
- Spec 对位：
  - §3.4 mission registry `progress_status` 字段 ✅
  - §3.2 compatibility files 不变 ✅
  - §3.3 active pointer 不变（slice 2 picker 进一步接）✅
  - §3.1 directory layout 不变 ✅
- API audit 对位：见 `records/2026-06-17-pi-topology-mission-runtime-api-audit.md` §6 表格，本 slice 不引入新 primitive
- 清理规则（codex review 同步要求）：已存 `target=project` memory，slice 7 E2E 时必填

## 8. 给 Reviewer 的 3 项 finding 复审

### [P1] #1 progress_status
- ✅ 类型加好
- ✅ 输入参数加好（`NewMissionRegistryEntryInput.progress_status?`）
- ✅ 默认值加好（`DEFAULT_MISSION_PROGRESS_STATUS = "awaiting_owner_confirmation"`）
- ✅ validator 加好（`isMissionLegacyProgressStatus` + `validateMissionRegistry` 检查）
- ✅ 测试覆盖：默认 + 显式 override + 缺失拒绝 + 非法值拒绝

### [P1] #2 path traversal
- ✅ mission_id 格式校验（`[A-Za-z0-9._-]+`，拒绝 `..` / `.hidden` / 空 / 非法字符）
- ✅ resolve 后 containment check（layer 2 defense in depth）
- ✅ 负例测试：13 个 format 负例 + 4 个 layout 路径负例 + 1 个 createLayout 工作区未污染断言
- ✅ 正例测试：5 个合法 id 通过

### [P2] #3 active_mission_id 一致性
- ✅ `setRegistryActiveMission` 拒绝未知 id（throw with diagnostic message）
- ✅ `validateMissionRegistry` 检查 active_mission_id 在 missions[] 内
- ✅ 测试覆盖：空 registry 拒绝 + 已知 registry 拒绝未知 + null 仍允许 + validator 独立检查

## 9. 已知遗留 / 未来 slice 关注

### 9.1 仍未实现（不在 slice 1.1 范围）

- **active-mission.json 写盘时的 mission 存在性校验**：当前 `writeActiveMissionPointer` 不检查 `mission_id` 是否对应真实 Mission。Slice 2 picker 写 active pointer 时应调 `setRegistryActiveMission` 先校验再写盘。Codex 可决定是否在 slice 2 加强，或在 slice 1.2 加 helper 集成。
- **`missionId` 在 `missionLayoutPaths` 是 string 类型，TypeScript 层已防御**。运行时只有 `unknown`（如 JSON.parse 后）才需要校验。Slice 6 migration 读取 legacy mission-card.json 时，**必须**在传给 `missionLayoutPaths` 之前 `validateMissionIdPathSegment`，否则会被 layer 1 拦截（这是预期行为）。

### 9.2 Process cleanup evidence 规则（已存 memory）

Codex 同步：以后凡是 Pi CLI/E2E 会开新窗口或新 Pi 进程，handoff 必须附 "process cleanup evidence"（10 项字段）。已存 `target=project` memory。Slice 1.1 不涉及 E2E，但 **slice 7（final dogfood with direct generated-script launches）必填**。

### 9.3 实施者立场

3 findings 全部修复 + smoke 通过 + 102/102 tests pass + 9 新增 focused tests。请 Reviewer 复审 + 放行 Slice 2（Supervisor mission picker and mission resume/create flow）。
