# Slice 4 Handoff — Inbox cleanup and stale packet marking

日期：2026-06-17
项目：OMP拓扑网络 / `packages/pi-topology`
实施者：Pi Coder (MiniMax-M3, Pi Harness)
Commit：`7d911a3 slice(4): add inbox cleanup and stale packet marking` (local, not pushed)
前置 spec：`docs/14-pi-topology-mission-runtime-spec.md` §4.4 + §7 + §13 slice 4
前置 slice：`36a4f11 fix(slice-3.1)` + `records/2026-06-17-pi-topology-slice-3-1-handoff.md`
状态：✅ 38/38 new tests + 238/238 全量 tests + smoke pass

## 1. 实施 note

按 spec §4.4 + §7 实施。新增 1 个 runtime 模块 + 1 个测试文件。

### 1.1 新增模块

**`src/runtime/packet-ledger.ts`** —— 完整 per-Mission packet ledger 与 active reads 过滤：

- **11-state 状态机**（spec §4.4）：`queued | delivered | acknowledged | in_progress | reported | report_acknowledged | closed | ignored | stale | duplicate | preserved`
- **6 packet types**（spec §3.1）：`ACK | STATUS | REPORT | REQUEST | INCIDENT | VERDICT`
- **`PacketLedgerEntry` 类型**（13 字段，spec §4.4）：`packet_id` / `mission_id` / `type` / `from` / `to` / `request_msg_id` / `correlation_id` / `state` / `raw_transport_path` / `first_seen_at` / `last_seen_at` / `classification_reason` / `artifact_path`
- **`ACTIVE_READ_STATES`**（5 状态，spec §7 默认 dashboard 包含）+ **`TERMINAL_PACKET_STATES`**（6 状态，隐藏）
- **`DEFAULT_STALE_THRESHOLD_MS = 30 * 60 * 1000`**（30min，spec §7 stale 判定）
- **Read/write**：
  - `appendPacketLedger(workspaceDir, layout, entry)` —— per-mission 直写（packet-ledger **不在** spec §3.2 mirror list，slice 1 root-mirror 路径不接管）
  - `getPacketLedgerEntries(workspaceDir, missionId)` —— 容错 malformed line
  - `findPacketById(entries, id)`
- **Liveness / staleness**：
  - `classifyPacketLiveness(entry, now, thresholdMs)` —— terminal pass through，stored stale 保持 stale，active state + 过期 → stale
  - `isPacketStale(entry, now, thresholdMs)`
- **Default actionable types per role**（per spec §3 RolePolicy.report_target）：
  - topology-supervisor / hq: 6 types
  - repair: REQUEST / ACK / VERDICT
  - runner / oracle: REQUEST / ACK / INCIDENT / REPORT / VERDICT
  - librarian: REPORT / INCIDENT / VERDICT
  - scott: STATUS / REQUEST / REPORT
- **Active reads filter**（spec §7）：
  - `getActivePacketsForMission(workspaceDir, missionId, role, options)` —— 4-filter AND：mission_id + role (to === role) + state (effective liveness ∈ ACTIVE_READ_STATES) + type (actionable)
  - `getAllActivePacketsForMission(workspaceDir, missionId, options)` —— 跨 role 计数
- **Compactor helper**：
  - `compileRawPacketToLedger(raw, missionId, now?)` —— raw transport observation → ledger entry（**完整** compactor 走 raw outbox/inbox 留给未来 slice）
- **Registry integration**：
  - `populatePendingPacketCountForMission(workspaceDir, missionId, now?, thresholdMs?)` —— 读 ledger + 分类 + 写 registry entry 的 `pending_packet_count` 字段

### 1.2 未改

- 任何已有 module（零修改）
- `src/transport/*`（raw packet transport 不动）
- `src/extension/register.ts`（不引入 `ctx.newSession` / `ctx.switchSession`）
- `src/runtime/spawn.ts`（visible peer scripts 保持 `local_protocol`）
- `src/runtime/mission.ts`（现有 mission card 创建逻辑保留）
- `root-mirror.ts`（packet-ledger 走 per-mission 直写，不走 slice 1 mirror 路径——因为 spec §3.2 mirror list 明确不含 packet-ledger）

### 1.3 不变量

- `appendPacketLedger` 直写 per-mission `packet-ledger.jsonl`（slice 1 root-mirror 不接管）
- `getPacketLedgerEntries` 容错 malformed line（per spec §7: don't rewrite raw；ledger 同理）
- `classifyPacketLiveness` 边界 inclusive（与 slice 3 `isWithinResumeWindow` 一致）
- `getActivePacketsForMission` 4-filter AND：所有都满足才入 active reads
- `populatePendingPacketCountForMission` 只数 active states（不算 stale / terminal），写 registry entry 的 `pending_packet_count`
- 不改 raw transport（spec §7 disallowed：delete / rewrite / etc.）

## 2. Changed files (2 new, 0 modified)

| 文件 | 状态 | 行数 |
| --- | --- | --- |
| `packages/pi-topology/src/runtime/packet-ledger.ts` | new | 386 行 |
| `packages/pi-topology/test/unit/packet-ledger.test.ts` | new | 651 行（38 tests）|

Total: 2 files new, 1037 insertions, 0 deletions, 0 modifications.

## 3. Focused tests (38 new)

### Constants & enums (6)
- `PACKET_STATES has all 11 spec §4.4 states`
- `PACKET_TYPES has all 6 spec §3.1 packet types`
- `ACTIVE_READ_STATES = {queued, delivered, acknowledged, in_progress, reported}`
- `TERMINAL_PACKET_STATES = {closed, report_acknowledged, ignored, stale, duplicate, preserved}`
- `ACTIVE_READ_STATES and TERMINAL_PACKET_STATES are disjoint and together cover all 11 states`
- `default stale threshold is 30 minutes`

### defaultActionableTypesForRole (5)
- `topology-supervisor + hq see all 6 types`
- `repair sees REQUEST / ACK / VERDICT`
- `runner / oracle see REQUEST/ACK/INCIDENT/REPORT/VERDICT`
- `librarian sees REPORT / INCIDENT / VERDICT`
- `scott sees STATUS / REQUEST / REPORT`

### Read / write (5)
- `appendPacketLedger + getPacketLedgerEntries round-trip`
- `getPacketLedgerEntries returns empty list when packet-ledger.jsonl is absent`
- `getPacketLedgerEntries tolerates malformed lines (skip, don't throw)`
- `appendPacketLedger writes per-mission only (packet-ledger is NOT in slice 1 root-mirror list per spec §3.2)`
- `findPacketById returns the matching entry or null`

### classifyPacketLiveness + isPacketStale (6)
- `stored stale stays stale`
- `terminal states pass through unchanged`
- `active state with old last_seen_at → stale`
- `active state with recent last_seen_at → unchanged`
- `active state at exact threshold is still active (boundary inclusive)`
- `isPacketStale is a thin wrapper over classifyPacketLiveness`

### getActivePacketsForMission (spec §7 filter) (8)
- `filters by mission_id`
- `filters by recipient role (to === role)`
- `filters out terminal states`
- `reclassifies stale-by-freshness as excluded`
- `filters by actionable type`
- `respects custom actionableTypesForRole override`
- `full filter (mission + role + state + type) intersection`
- `getAllActivePacketsForMission: counts across all roles`

### compileRawPacketToLedger (2)
- `maps a raw observation to a ledger entry`
- `honors state_hint and optional correlation fields`

### populatePendingPacketCountForMission (6)
- `returns null for unknown Mission`
- `returns null when no registry exists`
- `empty ledger → pending_packet_count = 0`
- `counts active packets and excludes terminal/stale`
- `is idempotent`
- `count is independent of recipient role (any role counts)`

## 4. Smoke 验证

```
$ cd packages/pi-topology && npm run smoke

# tests 238
# pass 238
# fail 0

> typecheck: strip-types import ok
> tarball: pi-topology-network-0.1.0.tgz
> package size: 90.7 kB (slice 3.1: 89.8 kB, +0.9 kB)
> total files: 59 (slice 3.1: 58, +1 new src)
```

200 → 238 tests，typecheck pass，pack dry-run pass。

## 5. Evidence paths

- 实施 commit：`7d911a3 slice(4): add inbox cleanup and stale packet marking`
- Handoff commit：紧随其后
- Handoff doc：`records/2026-06-17-pi-topology-slice-4-handoff.md`（本文件）
- Spec 对位：
  - §4.4 11-state packet state machine ✅
  - §4.4 13-field PacketLedgerEntry ✅
  - §7 allowed cleanup actions（mark / write ledger / filter active reads）✅
  - §7 disallowed actions（delete raw / rewrite history / etc.）—— 未做
  - §7 default active reads filter（mission_id + state + actionable）✅
  - §3.4 pending_packet_count in registry entry ✅
  - §13 slice 4 实施目标对齐
- API audit 对位：本 slice 不引入新 Pi primitive（`ctx.*` / `pi.*`），纯 runtime + JSONL ledger 逻辑
- 闸纪律：所有 slice 1-3 gates 仍生效（progress_status / path safety / registry_active_mission_id / event_id traceability / archived gate / freshness window）
- E2E window governance：本 slice 无新进程 / 无 CLI 窗口，slice 7 必填规则仍未触发

## 6. 给 Reviewer 的关键确认

| 闸规则 | 状态 |
|---|---|
| 仅 `src/runtime/*` 新增/修改 | ✅ 仅 `packet-ledger.ts` 新增，零修改 |
| 不改 raw packet transport | ✅ `src/transport/*` 零修改 |
| 不引入 `ctx.newSession` / `ctx.switchSession` | ✅ 零 Pi API 引用 |
| 不改 visible peer script 生成路径 | ✅ `src/runtime/spawn.ts` 零修改 |
| 不改现有 `mission.ts` mission card 创建逻辑 | ✅ 零修改 |
| `npm run smoke` 通过 | ✅ 238/238 + typecheck + pack |

## 7. 已知遗留 / 未来 slice 关注

### 7.1 仍未实现（不在 slice 4 范围）

- **完整 compactor**：当前只提供 `compileRawPacketToLedger` helper 把 raw observation 编译为 ledger entry。完整 compactor 走 raw outbox/inbox（来自 `src/transport/local-coms.ts`）并自动 tag mission_id，留给 slice 5 dashboard 或专用 compactor slice。
- **`include_history=true` filter**：spec §7 提到的"include_history may show preserved stale or historical packets, but the output must label them as historical"。当前 `getActivePacketsForMission` 只返回 active，historical viewer 留给 slice 5。
- **重复 detection / dedup**：spec §4.4 有 `duplicate` state，但未提供 packet_id 已见检查的 helper。Compactor 写 ledger 时需要去重（用 `findPacketById` + 已见则更新 `last_seen_at` 而非新行）。留给完整 compactor slice。
- **incident_count 字段**：registry entry 已有 `incident_count` 字段（默认 0），但 incident log 集成未做（spec §4.6 incident states 与 packet states 平行）。完整 incident 集成留给 future slice。
- **per-packet `in_progress` 自动 transition**：当 owner 从 active reads 中"take"一个 packet 时，packet 应该从 `delivered` → `in_progress`。当前未实现（需要 owner-action handler）。spec §5.3 隐含。

### 7.2 Process cleanup evidence
本 slice 无 E2E / 无新进程。slice 7 必填 10 项规则（已存 `target=project` memory）仍未触发。

### 7.3 实施者立场

slice 4 落地干净：38/38 new tests + 238/238 全量 tests + smoke pass。请 Reviewer 复审 + 决定是否进 slice 5（Dashboard / status output for multi-Mission state）。
