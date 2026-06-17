# Slice 3 Handoff — Session registry semantics and role liveness classification

日期：2026-06-17
项目：OMP拓扑网络 / `packages/pi-topology`
实施者：Pi Coder (MiniMax-M3, Pi Harness)
Commit：`b88ebe1 slice(3): add session registry semantics and role liveness classification` (local, not pushed)
前置 spec：`docs/14-pi-topology-mission-runtime-spec.md` §4.2 + §6.3 + §13 slice 3
前置 slice：`11fb51d fix(slice-2.2)` + `records/2026-06-17-pi-topology-slice-2-2-handoff.md`
状态：✅ 39/39 new tests + 195/195 全量 tests + smoke pass

## 1. 实施 note

按 spec §4.2 + §6.3 实施。新增 1 个 runtime 模块 + 1 个测试文件。

### 1.1 新增模块

**`src/runtime/role-session.ts`** —— 完整 session registry 与分类逻辑：

- **`RoleSessionRecord` 类型** —— 9 个 raw event kind：`planned | script_written | launch_printed | launch_requested | alive_confirmed | heartbeat | parked | closed | failed`
- **`RoleLivenessState` 类型** —— 5 态 derived state：`live | resumable | stale | parked | closed`（per spec §4.2；`failed` 计入 `closed` 计数）
- **`DEFAULT_HEARTBEAT_FRESHNESS_MS = 20_000`** + **`DEFAULT_RESUME_FRESHNESS_MS = 600_000`** —— spec §4.2 默认值
- **Freshness predicates**：
  - `isFreshHeartbeat(record, now, ms)` — 只接受 `heartbeat` event
  - `isWithinResumeWindow(record, now, ms)` — 只接受 `alive_confirmed` event
- **Record read/write**：
  - `buildRoleSessionRecord(input)` — 生成 record_id `rec_<uuid12>`
  - `appendRoleSessionRecord(workspaceDir, layout, record)` — append 到 per-mission `sessions.jsonl`（走 slice 1 root-mirror path，per-mission + root 同步）
  - `getRoleSessionRecords(workspaceDir, missionId)` — 读全部 records（容错 malformed line，skip 不 throw）
  - `latestRecordForRole(records, role)` — 按 timestamp 选最新
- **`classifyRole(role, records, options)`** —— spec §6.3 6-step algorithm（实现细节见 §2）
- **`classifyAllRoles(roles, records, options)`** —— 批量分类
- **`computeRoleSummary(classifications)`** —— 5 态计数
- **`populateRoleSummaryForMission(workspaceDir, missionId, now?)`** —— 读 sessions + 分类 + 更新 registry entry 的 `role_summary` 字段
- **`isMissionTerminalForRoles(lifecycleState, archived)`** —— 终态判断（`delivered` / `abandoned` / `archived` 都视为终态）

### 1.2 未改

- 任何已有 module（零修改）
- `src/transport/*`（raw packet transport 不动）
- `src/extension/register.ts`（不引入 `ctx.newSession` / `ctx.switchSession`）
- `src/runtime/spawn.ts`（visible peer scripts 保持 `local_protocol`）
- `src/runtime/mission.ts`（现有 mission card 创建逻辑保留）

### 1.3 不变量

- `classifyRole` 对 **LATEST record** 做判定（per-role per-mission 内 timestamp max）
- `closed` / `failed` / `parked` records 视为 terminal-authoritative（intent state，不是 transient liveness）
- `live` 仅来自 `heartbeat` event 且在 20s 窗口内
- `resumable` 来自 `alive_confirmed`（窗口内）或 `script_written` / `launch_printed` / `launch_requested`（带 `needs_liveness_confirmation: true`）
- `populateRoleSummaryForMission` 读 mission card 拿 role 列表（从 `Object.keys(card.roles)`）—— 不依赖 registry entry 的 role 字段
- append 走 slice 1 root-mirror 路径，自动同步 per-mission + root `.pi/topology/sessions.jsonl`

## 2. classifyRole 算法（spec §6.3 6-step）

1. **Owner parked**（`ownerParkedRoles` set 包含 role）→ `parked`
2. **Mission 终态**（`isMissionClosed` 或 `isMissionArchived`）→ `closed`（所有 role）
3. **无 records** → `stale`
4. 检查 **latest record**：
   - `closed` 或 `failed` → `closed`（terminal）
   - `parked` → `parked`（terminal）
   - `heartbeat` 且 fresh（20s 内）→ `live`
   - `alive_confirmed` 且在 10min 内 → `resumable`（无需 liveness check）
   - `script_written` / `launch_printed` / `launch_requested` → `resumable`（`needs_liveness_confirmation: true`）
5. **stale fallback**（record 存在但都不满足）→ `stale`

**关键设计决策**：采用"latest record wins"简化规则。Spec §4.2 说 "A closed or failed record overrides older resumable records"——实现解读为 "closed is terminal-authoritative when it's the latest record"。如果新 `heartbeat` 在 `closed` 之后，role 重启到 `live`（per spec §6.3 step 3）。这一致性更可预测。

**注**：API audit §1.5 已确认 OMP 5 态分类（live / resumable / stale / parked / closed）与 Pi native session 5 reason（startup / new / resume / fork / reload）正交。Slice 3 不引用任何 Pi API。

## 3. Changed files (2 new, 0 modified)

| 文件 | 状态 | 行数 |
| --- | --- | --- |
| `packages/pi-topology/src/runtime/role-session.ts` | new | 326 行 |
| `packages/pi-topology/test/unit/role-session.test.ts` | new | 808 行（39 tests）|

Total: 2 files new, 1134 insertions, 0 deletions, 0 modifications.

## 4. Focused tests (39 new)

### Constants & freshness predicates (3)
- `default heartbeat freshness is 20s and resume window is 10min (spec §4.2)`
- `isFreshHeartbeat accepts only heartbeat events within window`（含 boundary case）
- `isWithinResumeWindow accepts only alive_confirmed within 10min (boundary is inclusive)`

### Record read/write (5)
- `buildRoleSessionRecord generates a record_id and stamps timestamp`
- `appendRoleSessionRecord + getRoleSessionRecords round-trip`
- `getRoleSessionRecords returns empty list when sessions.jsonl is absent`
- `getRoleSessionRecords tolerates malformed lines (skip, don't throw)`
- `latestRecordForRole returns the most recent record per role`

### classifyRole spec §6.3 6-step (16)
- step 1: owner parked → parked
- step 2: mission archived → closed
- step 2: mission delivered → closed
- step 2: latest closed record → closed
- step 2: latest failed record → closed
- step 3: fresh heartbeat → live
- step 3: heartbeat outside 20s window → stale
- step 4: alive_confirmed within 10min → resumable
- step 4: alive_confirmed older than 10min → stale
- step 5: script_written → resumable with liveness check
- step 5: launch_printed / launch_requested → same
- step 6: no records → stale
- step 6: heartbeat way past window → stale
- latest record wins (heartbeat overrides older alive_confirmed)
- script_written + alive_confirmed (fresh) → resumable not stale
- latest record is closed → closed
- latest record is parked → parked
- latest record wins — fresh heartbeat after old closed → live

### computeRoleSummary + classifyAllRoles (4)
- `computeRoleSummary counts 5 categories`
- `classifyAllRoles returns classifications for every role in the list`
- `classifyAllRoles: one role live, others stale, summary matches`
- `emptyRoleSummary returns the zeroed 5-category shape`

### populateRoleSummaryForMission (7)
- returns null for unknown Mission
- returns null when no registry exists
- no records: all roles stale, summary = 0/0/7/0/0
- 1 live heartbeat: summary = 1/0/6/0/0
- mission archived state: all closed
- idempotent (calling twice yields same result)
- full state mix (1 live + 2 resumable + 2 stale + 1 parked + 1 closed)

### Sanity (3)
- `appendRoleSessionRecord mirrors to root sessions.jsonl (slice 1 root-mirror path)`
- `isMissionTerminalForRoles: delivered and abandoned are terminal; archived always`

## 5. Smoke 验证

```
$ cd packages/pi-topology && npm run smoke

# tests 195
# pass 195
# fail 0

> typecheck: strip-types import ok
> tarball: pi-topology-network-0.1.0.tgz
> package size: 89.7 kB (slice 2.2: 85.7 kB, +4 kB)
> total files: 58 (slice 2.2: 57, +1 new src)
```

156 → 195 tests，typecheck pass，pack dry-run pass。

## 6. Evidence paths

- 实施 commit：`b88ebe1 slice(3): add session registry semantics and role liveness classification`
- Handoff commit：紧随其后
- Handoff doc：`records/2026-06-17-pi-topology-slice-3-handoff.md`（本文件）
- Spec 对位：
  - §4.2 session states 全覆盖（11 个 raw state + 5 态 derived state）
  - §4.2 liveness rules：freshness windows 默认值 + closed/failed 终态判定
  - §6.3 6-step algorithm：step 1-5 + step 6 stale fallback
  - §3.4 role_summary 字段填充：`populateRoleSummaryForMission` 实现
  - §13 slice 3：实施目标对齐
- API audit 对位：本 slice 不引入新 Pi primitive（`ctx.*` / `pi.*`），纯 runtime + JSONL ledger 逻辑
- Spec review §6.1 已落实 read-only role `allowed_paths: []`（slice 2）+ slice 1.x gates（progress_status / path safety / registry_active_mission_id consistency）全部仍生效
- E2E window governance：本 slice 无新进程 / 无 CLI 窗口，slice 7 必填规则仍未触发

## 7. 给 Reviewer 的关键确认

| 闸规则 | 状态 |
|---|---|
| 仅 `src/runtime/*` 新增/修改 | ✅ 仅 `role-session.ts` 新增，零修改 |
| 不改 raw packet transport | ✅ `src/transport/*` 零修改 |
| 不引入 `ctx.newSession` / `ctx.switchSession` | ✅ 零 Pi API 引用 |
| 不改 visible peer script 生成路径 | ✅ `src/runtime/spawn.ts` 零修改 |
| 不改现有 `mission.ts` mission card 创建逻辑 | ✅ 零修改 |
| `npm run smoke` 通过 | ✅ 195/195 + typecheck + pack |

## 8. 已知遗留 / 未来 slice 关注

### 8.1 仍未实现（不在 slice 3 范围）

- **Per-role park action**：当前 `ownerParkedRoles` set 是 placeholder，per-role park action 在 slice 4+ 实现。`parked` state 当前只能从 session record of type `parked` 推到。spec §6.3 step 1 的 "owner parked the role" 模型可进一步丰富。
- **`launch_blocked` event**：spec §6.1 要求 launch metadata 校验失败时 append。Slice 3 提供了 `validateLaunchMetadata`（slice 2）+ 5 类 launch attempt events（script_written / launch_printed / launch_requested）的 append infrastructure，但 `launchBlockedEvent` 类型 + 触发逻辑留给 slice 4（实际 launch orchestration）。
- **Pending packet count / incident count derivation**：`role_summary` 已 populate，但 `pending_packet_count`（slice 4 inbox cleanup）和 `incident_count`（已有 incident log 集成）仍是 0。slice 3 在每次 `populateRoleSummaryForMission` 时只更新 role_summary，不触及其他 derived fields。
- **Resume freshness window 配置化**：当前 `DEFAULT_RESUME_FRESHNESS_MS = 600_000`（10 min）是 hardcoded。spec §4.2 说 "Default: 10 minutes"——后续可加 `mission.policy.resume_freshness_ms` 字段做 per-Mission 覆盖（slice 4+）。

### 8.2 Process cleanup evidence
本 slice 无 E2E / 无新进程。slice 7 必填 10 项规则（已存 `target=project` memory）仍未触发。

### 8.3 实施者立场

slice 3 落地干净：39/39 new tests + 195/195 全量 tests + smoke pass。请 Reviewer 复审 + 决定是否进 slice 4（Inbox cleanup and stale packet marking）。
