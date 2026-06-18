# Pi Topology v0.5.1 Runtime Alignment Audit

date: 2026-06-18
auditor: Pi session (MiniMax-M3, Pi Harness)
scope: v0.5.1 runtime alignment audit
trigger: ekunCustomsWms dogfood 暴露 active Mission / per-mission canonical layout 未贯穿到所有 runtime surfaces
constraint: audit only — no code change, no git stage/commit/push, no real Ghostty launch, no new role session, no ekunCustomsWms deletion
output: this record

---

## TL;DR

**Verdict — Runtime alignment is INCOMPLETE.** v0.5 spec/implementation is internally consistent for the dashboard/migration slice (slice 5/6 are clean), but 6 of the 9 audited runtime surfaces still hard-code root `.pi/topology/*` legacy paths as their write/append target. After `topology_migrate mode=execute` runs on a workspace like ekunCustomsWms, the active Mission canonical files under `.pi/topology/missions/<id>/` are only read by the per-Mission dashboard; **all other surfaces (status tool, spawn, write_artifact, send, list, get, await, session_start, heartbeat, UI footer) continue to write root legacy paths**. This breaks spec §3.2 + §12.2's "root files are mirrors, not source of truth" contract in both directions: writes go to root (not canonical) and reads go to root (not canonical). The spec itself has the right shape; the implementation is half-finished.

Audit output: **3 P1 + 5 P2 + 4 P3 findings**. Suggested repair plan is in §3 below; do not implement until Reviewer approves.

---

## 0. Audit Setup

### 0.1 Local runtime state observed

`/Users/yuantian/Documents/Coding/omp-topology-network/.pi/topology/` 当前是 legacy single-Mission 状态（与 ekunCustomsWms 同构）：

```
.pi/topology/
├── mission-card.json          (legacy root)
├── status-board.json
├── runtime-events.jsonl       (271431 bytes)
├── sessions.jsonl             (41315 bytes)
├── incident-log.jsonl         (9755 bytes)
├── launch/{topology-supervisor,hq,runner,oracle,librarian,scott,repair}.sh
├── artifacts/{hq,runner,scott,topology-supervisor}/...
└── (no missions/, no mission-registry.json, no active-mission.json)
```

确认点：本 workspace 没有 `missions/` 子目录、没有 registry、没有 active pointer，因此当前是 §12.1 描述的 "legacy detection" 状态；audit 推演到 "legacy migrate 后" 的 per-mission 状态。

### 0.2 Scope discipline

- 不动代码、不 git 操作、不 Ghostty launch。
- 不删 ekunCustomsWms 任何文件（本 audit 不进入 ekunCustomsWms 路径）。
- 仅 audit + 报告。

### 0.3 Evidence classification

- **transport evidence**：直接 read / git grep 得到的源码事实
- **business evidence**：spec §3.2 / §12.2 / §3.3 / §10 / 角色 prompt / handoff 描述的设计契约
- **inference**：从以上两类证据组合推出的运行时行为结论；明确标注

---

## 1. Findings (sorted by severity)

### P1 — Spec contract violated; production dogfood 状态不安全

#### P1-1 `topology_write_artifact` 写入 root legacy path，不进入 per-mission artifacts

**Evidence path**：
- file: `packages/pi-topology/src/extension/tools.ts`
- function: `topology_write_artifact` execute handler
- lines: 585-617 (execute body, esp. line 588: `const dir = path.join(ctx.cwd, ".pi", "topology", "artifacts", params.role);`)

**Current behavior**：每次 `topology_write_artifact(role=KIND, kind=..., title=..., body=...)` 都把文件写到 `<cwd>/.pi/topology/artifacts/<role>/<timestamp>-<kind>-<title>.md`。这是 root legacy 路径。

**Correct behavior (spec §3.1 + §3.2 + §12.2)**：active Mission 模式下，artifact 必须写到 `<cwd>/.pi/topology/missions/<mission_id>/artifacts/<role>/` (canonical)；root `.pi/topology/artifacts/<role>/` 仅为 mirror。

**Risk**：dashboard (`readDashboardSnapshot` line 205-247) 只扫描 `layout.artifactsDir` (per-mission `artifacts/`)。在 legacy migrate 之后：
- `topology_write_artifact` 仍写 root `.pi/topology/artifacts/<role>/`。
- dashboard 扫描的是 `.pi/topology/missions/<id>/artifacts/`，找不到任何 artifact。
- `paths.artifacts_dir` 报告的是 per-mission 路径，但实际写入不在该路径。

**Spec §3.2 列举的 7 个 mirror 文件包括 `artifacts/*`** (docs/14 line 113-120)，但 `ROOT_MIRROR_FILES` (`src/runtime/root-mirror.ts` line 42-47) 只包含 5 个文件、不含 `artifacts/`。spec vs implementation 不一致；当前实现行为甚至更激进 (mirror 都没实现，只单写 root)。

**Test coverage**：test/unit/extension.test.ts line 1389-1434 ("writes role artifacts under mission topology folder") 只验证路径以 `.pi/topology/artifacts/<role>/` 开头 — **该断言在 migrate 之后是错的**，因为 per-mission 路径应该是 `.pi/topology/missions/<id>/artifacts/<role>/`。现有测试不能区分 legacy vs per-mission 模式。

**Recommended fix direction** (do not implement yet)：
- `topology_write_artifact` 改为先 `loadRuntimeState` → 解析 active mission → 写到 `layout.artifactRoleDirs[role]`；root 仅作 mirror。
- `root-mirror.ts` 把 `artifacts/` 加入 mirror 列表（仅在 active Mission 模式下 sync）。
- guard.ts line 145 的 hard-coded `.pi/topology/artifacts/${role}/` allowlist 改为允许 per-mission `<...>/missions/<id>/artifacts/${role}/`。

#### P1-2 `topology_status` / `topology_doctor` / `topology_smoke` / `topology_send` / `topology_list` / `topology_get` / `topology_await` 通过 `loadRuntimeState` 仍读 root mission-card.json

**Evidence path**：
- file: `packages/pi-topology/src/extension/tools.ts`
- function: `loadRuntimeState`
- lines: 820-862 (esp. line 822 `const missionPath = missionPathFor(cwd);`)

**Current behavior**：`loadRuntimeState` 调用 `missionPathForWorkspace(cwd)` (defined in `src/runtime/mission-path.ts`)，它只检查：
- env var `PI_TOPOLOGY_MISSION_CARD` 是否指向 `<cwd>` 之内
- fallback 是 root `.pi/topology/mission-card.json`

**绝对没有**检查 `.pi/topology/mission-registry.json` 是否存在、`.pi/topology/active-mission.json` 是否存在、或 `.pi/topology/missions/<id>/mission-card.json` 是否存在。**该函数对 per-mission canonical 完全无感知**。

**Spec contract (§3.1 + §3.3 + §10)**：active Mission 决定时所有工具必须解析到 per-mission canonical，root mirror 仅作为 readable fallback。

**Risk**：legacy migrate 之后，`loadRuntimeState` 仍然返回 root `mission-card.json` + root `status-board.json` + root `incident-log.jsonl` + root `runtime-events.jsonl` + root `sessions.jsonl`。即：
- `topology_status` 报 root 路径（"not per-mission dashboard fields"）。
- `topology_doctor` 验 root mission-card.json schema。
- `topology_send` 写 `loaded.eventPath` = root runtime-events.jsonl。
- `topology_send` ACK 闭合链路用 `loaded.mission.project` (legacy card 字段) — 与 registry 中 active Mission 不一致。
- `topology_list / topology_get / topology_await` 都基于 `loaded.mission.mission_id` (legacy) 过滤 — 但 dogfood 显示 root runtime-events.jsonl 是来自 legacy mission，per-mission ledger 是新的；两套并存。

**Test coverage**：
- test/unit/extension.test.ts line 564-654 ("topology migrate applies legacy migration while migrate plan stays read-only") 测了 migrate 之后 `commands.topology.handler("status")` 输出 `mission_dir:`（来自 dashboard 路径），但**该测试不测 `topology_status` tool 在 migrate 之后是否仍读 root**。
- 缺一个关键回归测试：在 per-mission 工作区，`topology_status` tool 应返回 dashboard-format 字段，而非 root path 字段。

**Recommended fix direction** (do not implement yet)：
- `loadRuntimeState` 改为优先解析 active Mission (registry → pointer → `missions/<id>/mission-card.json`)，fallback 才走 root。
- 所有 `loaded.eventPath / loaded.sessionLedgerPath / loaded.statusPath` 应指向 per-mission canonical。
- `topology_status` tool 改为 thin wrapper 调用 dashboard 的 `formatDashboardText`；删除 root-path 输出格式。

#### P1-3 `topology_spawn_role` 写 launch script 到 root `.pi/topology/launch/<role>.sh`，且不写 per-mission canonical

**Evidence path**：
- file: `packages/pi-topology/src/runtime/spawn.ts`
- function: `writeRoleLaunchScript` / `writeRoleLaunchScriptSync`
- lines: 122-126 / 158-162 (both use `path.join(workdir, ".pi", "topology", "launch")`)

**Current behavior**：`writeRoleLaunchScript(workdir, plan)` 把 `<role>.sh` 写到 `<workdir>/.pi/topology/launch/<role>.sh`。这是 root legacy 路径。

**Spec §3.2 + §12.2 contract**：active Mission 模式下 launch script 应写到 `.pi/topology/missions/<mission_id>/launch/<role>.sh` (canonical)；root 仅作 mirror。

**Risk**：
- legacy migrate 之后，dogfood 实际启动的 `bash <script>` 仍指向 root `.pi/topology/launch/<role>.sh`。如果 migrate 把 legacy `launch/` 复制到 per-mission `missions/<id>/launch/`，root launch dir 就被废弃了。
- 但是 `topology_spawn_role` (tools.ts line 366-372) 调 `writeRoleLaunchScript(ctx.cwd, plan, ...)` 又把 script 写到 root — 与 migrate 已经搬到 per-mission 的 launch 目录并存。
- root `launch/` 与 per-mission `missions/<id>/launch/` 内容逐渐 drift；root mirror 没被 sync。
- spec §12.2 line 650 "Whenever active Mission canonical files change, update root compatibility mirrors for ... launch scripts" — 但 `appendToJsonlLedger` / `copyRootMirrorFile` (root-mirror.ts line 117-130) 都没处理 `launch/`。

**Test coverage**：
- test/unit/extension.test.ts line 810-960 测试 `topology_spawn_role` 的 output，但**所有测试都在 legacy 模式** (`mission_card.json` 写在 root，无 registry)。**没有任何测试在 per-mission 模式下验证 spawn 的 script 路径**。
- test/unit/migration.test.ts line 335-369 测了 "migration copies legacy launch scripts and artifacts into per-Mission canonical dirs" — 这只验证 migrate 搬运，不验证 spawn。

**env var 错误指向 root path**：
- file: `spawn.ts` line 261-272 (buildRoleLaunchPlan)
- env `PI_TOPOLOGY_INCIDENT_LOG` / `PI_TOPOLOGY_EVENT_LOG` 都指向 `<workdir>/<mission.incident_log_path>` 和 `<workdir>/<mission.event_log_path>`。这两字段在 mission-card.json 里 hardcoded 为 `.pi/topology/incident-log.jsonl` / `.pi/topology/runtime-events.jsonl`（见 mission.ts line 204-207）— 即 root legacy。
- 即 spawn 出去的 role 子 session 的 `PI_TOPOLOGY_INCIDENT_LOG` env 指向 root，而非 per-mission。子 session 若调 guard.ts line 51-53 用 `incident_log_path` 写 incident，会写到 root。

**Recommended fix direction** (do not implement yet)：
- `writeRoleLaunchScript` 接受 `MissionLayoutPaths`，写 `layout.launchDir/<role>.sh`；root 旧路径仅作 mirror sync。
- `buildRoleLaunchPlan` 接受 active Mission id，从 registry 查 per-mission 路径，注入 `PI_TOPOLOGY_INCIDENT_LOG` / `PI_TOPOLOGY_EVENT_LOG` / `PI_TOPOLOGY_MISSION_CARD` 全部 per-mission canonical。
- root-mirror.ts 把 `launch/` 加入 mirror 列表（cp -r semantics），与 spec §12.2 对齐。

---

### P2 — Spec contract violated; runtime safety/UX 受影响但不会直接破坏 dogfood 证据

#### P2-1 UI `buildTopologyUiSnapshot` 优先读 root mission-card.json 与 root status-board.json

**Evidence path**：
- file: `packages/pi-topology/src/extension/ui.ts`
- function: `buildTopologyUiSnapshot`
- lines: 95-104 (esp. 98-103)

**Current behavior**：
```ts
const missionPath = process.env.PI_TOPOLOGY_MISSION_CARD ?? path.join(cwd, ".pi", "topology", "mission-card.json");
const statusPath = mission ? path.join(cwd, mission.status_board_path) : path.join(cwd, ".pi", "topology", "status-board.json");
const sessionLedgerPath = mission ? path.join(cwd, mission.session_ledger_path) : path.join(cwd, ".pi", "topology", "sessions.jsonl");
const incidentPath = mission ? path.join(cwd, mission.incident_log_path) : path.join(cwd, ".pi", "topology", "incident-log.jsonl");
```

**问题**：`mission` 来自 root mission-card.json (因为没 `PI_TOPOLOGY_MISSION_CARD` env var 就走 root fallback)。`mission.status_board_path` 字段本身又是 root `.pi/topology/status-board.json` 字符串 (mission.ts line 204)。所以 UI footer **永远读 root**，无论 workspace 是否已 migrate。

**Risk**：
- 在 per-mission 工作区，footer 报告的 peer status 来自 root status-board.json，而 active Mission 的 peer status 在 per-mission status-board.json。两者是分离的 (root 是 mirror, 不是 active source)。
- ekunCustomsWms migrate 后，footer 显示的 `incidents: N` 是 root legacy 计数，不是 active Mission incident count。

**Test coverage**：test/unit/ui.test.ts 测了 snapshot 行为但用 mock missionCard path — 没有测试 per-mission workspace 下的 fallback。

**Recommended fix direction** (do not implement yet)：
- `buildTopologyUiSnapshot` 与 `installTopologyUi` 改为优先解析 active Mission → 读 per-mission canonical paths。
- 删 root fallback，或将 root 路径标注为 "legacy mirror; prefer active Mission per-mission" warning。

#### P2-2 `session_start` / `markTopologySessionAlive` / `heartbeatTopologySession` 写 root `sessions.jsonl` / root `status-board.json`

**Evidence path**：
- file: `packages/pi-topology/src/extension/register.ts`
- functions:
  - `session_start` handler: line 57-60 → calls `startTopologyRuntimeForCurrentSession` (line 145-157) → `markTopologySessionAlive` (line 328-373)
  - `heartbeatTopologySession`: line 376-407

**Current behavior**：
- `markTopologySessionAlive` line 332: `const sessionLedgerPath = path.join(workdir, mission.session_ledger_path);` — `mission` 来自 `PI_TOPOLOGY_MISSION_CARD` env var 或读 root mission-card.json。两者都指向 root path。
- `markTopologySessionAlive` line 359-368: 写 `loaded.eventLog` 也走 root (since `mission.event_log_path` 来自 mission card 字段 = root hardcoded)。
- `heartbeatTopologySession` line 386: `const statusPath = path.join(workdir, mission.status_board_path);` 写 root status-board.json。

**Risk**：active Mission 的 `alive_confirmed` / `heartbeat` JSONL event 写到 root sessions.jsonl，不写到 per-mission `missions/<id>/sessions.jsonl`。Dashboard 读 per-mission sessions.jsonl 找不到 heartbeat records，role classification (`classifyRole` in role-session.ts) 会把所有 roles 判为 `stale`。

**Test coverage**：
- test/unit/extension.test.ts line 1697-1755 ("session_start writes heartbeat records through live transport") 只在 legacy mode 测试。
- test/unit/extension.test.ts line 1731-1810 ("session_start heartbeat refreshes live registry without crashing Pi") 同样 legacy mode。

**Recommended fix direction** (do not implement yet)：
- `session_start` / `markTopologySessionAlive` / `heartbeatTopologySession` 都用 active Mission pointer 解析 per-mission canonical paths；root 仅 mirror。

#### P2-3 `migrateLegacyToPerMission` 不调 `syncRootMirrorFromLayout`，导致迁移后 root mirror 失同步

**Evidence path**：
- file: `packages/pi-topology/src/runtime/migration.ts`
- function: `migrateLegacyToPerMission`
- lines: 340-625 (steps 1-7)

**Current behavior**：migrate 创建 `missions/<id>/` 目录、写 registry、写 active-mission.json、append `mission_migrated` event (line 625) — **不调 `syncRootMirrorFromLayout`**。

**Spec §12.2 contract**：
> Whenever active Mission canonical files change, update root compatibility mirrors for: mission card, status board, runtime event append, incident append, sessions append, launch scripts.

迁移是 "active Mission canonical files change" 的极端场景；但当前实现选择保留 legacy root 不动 ("non-destructive")，违反了 §12.2 mirror sync 强制要求。

**Risk**：
- migrate 后 root mission-card.json / status-board.json 仍是 legacy 内容 (虽然 `mission_id` 与 active Mission 一致)。
- 任何走 root fallback 的工具 (P1-2、P2-1) 都读 legacy content；mirror 与 canonical 不同步 → dogfood 会观察到 "per-mission dashboard 显示正确；topology_status tool 显示旧内容"。
- root sessions.jsonl / runtime-events.jsonl / incident-log.jsonl 在 migrate 时被 **cp -r 复制到 per-mission** (migration.ts line 488-543)，但 per-mission 后续 append 不再 mirror 回 root；之后 root 就 stale 永远。

**Test coverage**：
- test/unit/migration.test.ts line 335-369 (上述) — 不验证 root mirror sync 行为。
- test/unit/migration.test.ts 其他测试覆盖 migrate 自身行为但不覆盖 root mirror 状态。

**Recommended fix direction** (do not implement yet)：
- `migrateLegacyToPerMission` 在 step 7 之后追加 step 8: `syncRootMirrorFromLayout(workspaceDir, layout)`；或 `setActiveMissionFull(workspaceDir, { mission_id, reason: "migration" })`。
- 但这与 "non-destructive" 语义冲突 — 需要明确 root mirror 是 "replaced with active snapshot" 而不是 "leave as-is"。

#### P2-4 guard `isControlledCoordinationWrite` 的 hard-coded artifacts allowlist 不识别 per-mission canonical

**Evidence path**：
- file: `packages/pi-topology/src/runtime/guard.ts`
- function: `isControlledCoordinationWrite`
- line: 142-148

**Current behavior**：line 145 hard-code:
```ts
return normalized.startsWith("docs/") || normalized.startsWith(`.pi/topology/artifacts/${role}/`);
```

**问题**：per-mission canonical 路径是 `.pi/topology/missions/<id>/artifacts/<role>/`，**不在 allowlist 里**。所以 supervisor / hq 用 `write_file` 写到 per-mission artifacts 时会被 guard 拦下（"not the default writer role" / "outside allowed_paths"）。

**Risk**：
- v0.5 spec §6.3 明确规定 supervisor 与 hq 必须能写 artifacts；但 migrate 之后 canonical 路径变了，guard 仍按 root 路径 allowlist，结果是 supervisor/hq **写不进自己的 artifact dir**。
- 间接导致：supervisor 试图写 artifact → guard block → 触发 `guard_block` 事件 → supervisor 看到 reason "is not the default writer role" → 困惑为什么不能写自己 canonical 目录。

**Test coverage**：test/unit/guard.test.ts 与 guard-incident.test.ts 只测 legacy 路径；没有 per-mission 路径测试。

**Recommended fix direction** (do not implement yet)：
- `isControlledCoordinationWrite` 接受 active Mission layout，把 per-mission `<...>/missions/<id>/artifacts/<role>/` 也加入 allowlist。
- 同步：`evaluateToolCall` 的 incident_log_path 应指向 per-mission `layout.incidentLogPath` 而非 root。

#### P2-5 Guard feedback 没有告诉 supervisor/hq "为什么不能 shell/write" + "你应该用 topology_write_artifact"

**Evidence path**：
- file: `packages/pi-topology/src/extension/register.ts`
- function: `tool_call` handler
- lines: 67-114 (esp. 108-113)

**Current behavior**：
```ts
return {
  block: true,
  reason: decision.reason,
  details: { decision: decision.decision, incident: decision.incident },
};
```

`decision.reason` 来自 guard.ts，是单行字符串 (例如 `"topology-supervisor is not the default writer role"` 或 `"topology-supervisor cannot write through shell commands"`)。

**问题**：
- supervisor/hq 看到 "is not the default writer role" 不立刻知道：
  - 哪个工具可以写 (答案：topology_write_artifact)
  - 应该写到哪个目录 (答案：per-mission artifacts/<role>/)
  - 为什么 shell/write 被拒 (答案：per spec §6.3 只能通过 topology_artifact_write)
- 没有 incident 链接、没有文档指针、没有 "use topology_write_artifact instead" 的提示。

**Spec contract**：v0.5 spec §6.3 + handoff 都要求 supervisor 知道 "long reports → topology_write_artifact"；guard feedback 是首要暴露点。

**Test coverage**：test/unit/extension.test.ts line 1620-1670 (测了 guard_block 事件 + packet 行为)，但只测事件内容包含 `decision` / `reason` 字段，不测 feedback 是否包含引导说明。

**Recommended fix direction** (do not implement yet)：
- guard 返回值加 `tool_guidance: string[]` 字段，列出 "use topology_write_artifact" 等替代路径。
- `tool_call` block reason 用多行字符串拼接 tool_guidance；incident 也带 tool_guidance 方便 review。

---

### P3 — Documentation / UX gaps; non-breaking but spec drift

#### P3-1 Role prompts (topology-supervisor / hq / shared-protocol) 没有提及 per-mission canonical path

**Evidence path**：
- file: `packages/pi-topology/agents/topology-supervisor.md` / `hq.md` / `shared-protocol.md`
- 全文件

**Current behavior**：三个 role prompt 都说"用 topology_write_artifact 写长报告" / "用 topology_read_artifact 读" / "用 topology_status 看状态" — 但都没说这些 tool 内部写到 / 读自 per-mission canonical 还是 root mirror。

**Risk**：role 模型（LLM）不知道"该 tool 实际上写到根目录"，就会以为写到 per-mission。导致角色误判 "我的 artifact 在 `missions/<id>/artifacts/`" 但实际在 root `artifacts/`。

**Test coverage**：role prompt 没有结构化测试。

**Recommended fix direction** (do not implement yet)：
- shared-protocol.md 加一段 "Runtime Path Discipline" 解释 active Mission → per-mission canonical；root mirror 仅 fallback / 历史兼容。
- topology-supervisor.md / hq.md 各加一句 "本 mission 期间所有 topology_* tool 自动解析 active Mission canonical；遇到 tool 反馈说写到 `.pi/topology/...` 时那是 mirror 不是 canonical"。

#### P3-2 dashboard `paths.active_pointer_path` 显示 root `.pi/topology/active-mission.json`（设计 OK 但 dashboard verbose 不区分 root vs per-mission）

**Evidence path**：
- file: `packages/pi-topology/src/runtime/dashboard.ts`
- lines: 259-263

**Current behavior**：dashboard verbose 输出 `paths.active_pointer_path: <cwd>/.pi/topology/active-mission.json` — 这是正确的 root path（active pointer 本身是 root 文件，不是 per-mission）；但 dashboard 同时报告 `mission_dir: .pi/topology/missions/<id>` — owner 看到这两个路径会困惑 "为什么 dashboard 报告 root vs missions/ 不同的位置？"

**Risk**：低，UX 问题。

**Recommended fix direction** (do not implement yet)：在 dashboard verbose 标注 active_pointer_path 是 "root registry index" 而 mission_dir 是 "active Mission canonical root"。

#### P3-3 Legacy `sessions.jsonl` 中非 JSON marker 行会诱导模型自己写 Python / json.loads 并失败

**Evidence path**：
- workspace 当前 state：`.pi/topology/sessions.jsonl` (41315 bytes) 是合法 JSONL
- 但 v0.5 spec 写明 session record 可包含 `event_type: "migration_inferred_empty"` 与 `_meta.inferred_empty: true` 字段 (spec §12.1)
- role-session.ts line 183-198 (`getRoleSessionRecords`) 已用 try/catch 跳过 malformed lines

**Risk**：role 模型如果看到 `runtime-events.jsonl` 里 `_meta.inferred_empty: true` 的非标准字段，可能尝试自己解析 (`json.loads`) 然后失败，因为它不期望 `_meta` 字段 — 该字段属于 "migration metadata" 而不是 business event。

**Recommended fix direction** (do not implement yet)：
- shared-protocol.md / role prompts 加一段 "禁止手写 JSONL parser；用 topology_status / topology_dashboard / topology_dashboard_verbose tools"。
- _meta 字段前缀命名约定在 spec §12.1 中明文化（避免 role 模型误解）。

#### P3-4 Ghostty launch evidence 仍可能被误读为 role alive

**Evidence path**：
- file: `packages/pi-topology/src/extension/tools.ts`
- function: `topology_spawn_role` execute handler
- lines: 372-450 (esp. 410-417 inference line / 446 prompt feedback)

**Current behavior**：`spawn` 调 `open -a Ghostty --args -e <script>` → 写 `session_alive` 不存在，只写 `launch_requested` event。返回文本说："launch command issued for ... Verify alive_confirmed/session_alive evidence before marking the role live."

**问题**：terminal_app 参数由 caller 控制（`topology_spawn_role(terminal_app="Ghostty")`） — 如果 caller 用了非 Ghostty (例如 iTerm, Terminal)，launch contract 不一致。

**Risk**：低（contract 已经明示 "not proof of alive"）。但没有 post-launch verification contract。

**Recommended fix direction** (do not implement yet)：
- `topology_spawn_role` 增加 `expected_alive_within_ms` 参数；超期仍未收到 `session_alive` event 时 append `INCIDENT` packet to supervisor。
- launch metadata spec (§6.1) 增加 post-launch verification contract。

#### P3-5 缺一个核心回归测试 "legacy migrate 后真实工具链全部 per-mission"

**Test gap analysis**：
- test/unit/migration.test.ts 测 migrate 自身行为。
- test/unit/extension.test.ts line 564-654 测 migrate 之后 `/topology status` (commands.ts) 输出 dashboard-format；但**没测**以下工具链：
  - `topology_status` tool (vs command)
  - `topology_doctor` tool
  - `topology_smoke` tool
  - `topology_spawn_role` tool — script_path 写到哪里
  - `topology_write_artifact` tool — artifact_path 写到哪里
  - `topology_send` tool — event_log_path 写到哪里
  - `topology_list` / `topology_get` / `topology_await` tool — packet 过滤基于哪个 mission_id
  - `session_start` event — sessions.jsonl 写到哪里
  - heartbeat — status-board.json 写到哪里
  - UI `buildTopologyUiSnapshot` — footer 读哪些路径
  - `guard` — artifacts allowlist 是否包含 per-mission path
- test/integration/dogfood.test.ts 测 dogfood 全流程，但 dogfood 是 "create registry then simulate role activity" — **不模拟 legacy → migrate → operate path**。

**Recommended fix direction** (do not implement yet)：
- 新增 test/integration/per-mission-runtime.test.ts：模拟 legacy workspace → migrate → 跑 topology_status/spawn_role/write_artifact/send/session_start → 断言全部写到 per-mission canonical；root 仅 mirror。
- 这是 audit 最关键的下一步。

---

## 2. Cross-Cutting Observations

### 2.1 Spec §3.2 mirror list vs `ROOT_MIRROR_FILES` mismatch

spec §3.2 (docs/14 line 113-120) 列举 7 个 root mirror：
```
- .pi/topology/mission-card.json
- .pi/topology/status-board.json
- .pi/topology/runtime-events.jsonl
- .pi/topology/incident-log.jsonl
- .pi/topology/sessions.jsonl
- .pi/topology/launch/*
- .pi/topology/artifacts/*
```

实现 `ROOT_MIRROR_FILES` (root-mirror.ts line 42-47) 只有前 5 个；`launch/*` 与 `artifacts/*` 未实现 mirror 同步逻辑。这造成 §12.2 合同的部分违约。

audit 推论：v0.5.1 修复时必须把 mirror 列表扩展为 7 项；或在 spec 中明确 "launch 与 artifacts 不 mirror" 并实现 root-only canonical for these two。

### 2.2 `mission.ts` 默认 hardcoded 路径字段

`MissionCard` schema 在 `mission.ts` line 204-207 hardcoded：
```ts
status_board_path: ".pi/topology/status-board.json",
incident_log_path: ".pi/topology/incident-log.jsonl",
event_log_path: ".pi/topology/runtime-events.jsonl",
session_ledger_path: ".pi/topology/sessions.jsonl",
```

这导致所有 mission 卡的 4 个 `*_path` 字段都指向 root legacy。spec §3.1 + §3.4 应明确这些字段应该是 relative-to-mission-dir 路径（如 `status-board.json` 或 `../status-board.json`）— 当前实现混用 "root-relative" 与 "mission-relative" 两种语义。

audit 推论：这是 v0.5 设计期的语义不清晰遗留，v0.5.1 修复时应在 spec 明确这两条之一并同步实现。

### 2.3 root-mirror.ts 的 `appendToJsonlLedger` 设计合理性

`appendToJsonlLedger` (root-mirror.ts line 151-167) 实现是 "读源 + 写源 + 写镜像"（每次重写整个文件）。这在 append-only JSONL 上是 idempotent 但是 O(n^2) — Mission 运行久了会慢。

audit 推论：当前规模（13 events × 41 KB）OK；但 spec §13 提到 7-slice 后续 v0.6 hardening notes 中应考虑改为 streaming append + mirror。

### 2.4 既有 P1 测试覆盖

- test/unit/dashboard.test.ts line 1-700 (27 tests): 测 dashboard snapshot 在多种 active-mission 状态下的行为。
- test/unit/mission-registry.test.ts line 1-700 (23 tests): 测 registry CRUD。
- test/unit/mission-actions.test.ts (18 tests): 测 `setActiveMissionFull` 等。
- test/unit/migration.test.ts (23 tests): 测 migrate 自身。
- test/unit/role-session.test.ts (39 tests): 测 5-state classification。

这些 slice 1-7 测试覆盖度好；但 **cross-slice 的 "migrate 之后用 tool" path 不在 unit test 覆盖范围**。

---

## 3. Proposed Repair Plan (NOT IMPLEMENTED — Reviewer gate first)

### 3.1 Slice A — `loadRuntimeState` 与 `missionPathForWorkspace` per-mission 感知 (P1-2)

**目的**：让所有 topology_* tool 走 active Mission → per-mission canonical。

**Files expected to change**:
- `src/runtime/mission-path.ts` — 加 active-Mission resolver；fallback 才走 root
- `src/extension/tools.ts` — `loadRuntimeState` 用新 resolver；删除 root hardcoded
- `src/extension/commands.ts` — `loadTopologyState` 同步

**Tests**:
- 新 unit test：migrate 之后 `topology_status` 返回 dashboard-format fields (active_mission_id, role_summary, etc.) 而不是 root path fields。
- 新 unit test：`topology_send` 在 per-mission 工作区写 per-mission `runtime-events.jsonl`。
- 新 unit test：`topology_doctor` / `topology_smoke` 验 per-mission mission-card.json schema。

**Acceptance**:
- 在 migrate 之后 `topology_status` 输出与 `topology_dashboard` 一致。
- `loaded.eventPath` / `loaded.sessionLedgerPath` / `loaded.statusPath` 都是 per-mission path。
- root legacy files 不被新 tool 写入（除 mirror sync 之外）。

### 3.2 Slice B — `topology_spawn_role` / `writeRoleLaunchScript` / `buildRoleLaunchPlan` 写 per-mission launch + env 注入 per-mission path (P1-3)

**Files expected to change**:
- `src/runtime/spawn.ts` — `writeRoleLaunchScript` / `writeRoleLaunchScriptSync` 接受 `MissionLayoutPaths`，写 `layout.launchDir/<role>.sh`；`buildRoleLaunchPlan` 解析 active Mission → env 注入 per-mission 路径
- `src/runtime/root-mirror.ts` — `ROOT_MIRROR_FILES` 扩展含 `launch/` (目录 mirror) 与 `artifacts/` (目录 mirror)；新增 `syncRootMirrorDirectory()` helper
- `src/extension/tools.ts` — `topology_spawn_role` execute 调用新 spawn 路径
- `src/runtime/mission.ts` — `MissionCard` 默认 `*_path` 字段改为 relative-to-mission-dir (or add new field `per_mission: true`)

**Tests**:
- 新 unit test：`topology_spawn_role` 在 per-mission 工作区写 `missions/<id>/launch/<role>.sh`。
- 新 unit test：spawn 出去的 role 子 session env var `PI_TOPOLOGY_INCIDENT_LOG` / `PI_TOPOLOGY_EVENT_LOG` 指向 per-mission canonical。
- 新 unit test：mirror sync 把 per-mission launch script 复制到 root `.pi/topology/launch/<role>.sh`。

**Acceptance**:
- per-mission launch script 存在 + root launch script 同步存在 (mirror 同步由 syncRootMirrorDirectory 维护)。
- 子 session env var 全部 per-mission canonical。
- root mirror 与 canonical byte-for-byte 一致。

### 3.3 Slice C — `topology_write_artifact` / `topology_read_artifact` / guard 切换到 per-mission (P1-1 + P2-4 + P2-5)

**Files expected to change**:
- `src/extension/tools.ts` — `topology_write_artifact` / `topology_read_artifact` 解析 active Mission → 用 `layout.artifactRoleDirs[role]`
- `src/runtime/root-mirror.ts` — `syncRootMirrorDirectory` 支持 artifacts 目录
- `src/runtime/guard.ts` — `isControlledCoordinationWrite` 接受 active Mission layout，把 per-mission artifacts/<role>/ 加入 allowlist；feedback 加 tool_guidance
- `src/extension/register.ts` — `tool_call` block reason 用 guard 返回的 tool_guidance 拼接

**Tests**:
- 新 unit test：`topology_write_artifact` 在 per-mission 工作区写 `missions/<id>/artifacts/<role>/...md`。
- 新 unit test：dashboard `paths.artifacts_dir` 与 `topology_write_artifact` 实际写入位置一致。
- 新 unit test：guard 对 per-mission artifact 路径 allow；对 root artifact 路径仍 allow (backward compat)。
- 新 unit test：guard block reason 包含 "use topology_write_artifact" 指引。

**Acceptance**:
- artifact 写入位置 = dashboard 报告位置。
- guard 不再 block supervisor/hq 写 per-mission artifact。
- supervisor/hq 在 guard block 时收到明确指引。

### 3.4 Slice D — UI / session_start / heartbeat / migrate-mirror-sync + 跨切面回归测试 (P2-1, P2-2, P2-3, P3-5)

**Files expected to change**:
- `src/extension/ui.ts` — `buildTopologyUiSnapshot` 优先 active Mission per-mission，root 仅 mirror
- `src/extension/register.ts` — `markTopologySessionAlive` / `heartbeatTopologySession` 用 active Mission resolver
- `src/runtime/migration.ts` — `migrateLegacyToPerMission` 调 `syncRootMirrorFromLayout` (或 `setActiveMissionFull`) 在 step 7 之后
- `agents/topology-supervisor.md` / `hq.md` / `shared-protocol.md` — 加 "Runtime Path Discipline" 段 (P3-1)
- `docs/14-pi-topology-mission-runtime-spec.md` — 明确 `launch/*` 与 `artifacts/*` 是否 mirror（与 §3.2 + §12.2 对齐）
- 新增 `test/integration/per-mission-runtime.test.ts` — legacy → migrate → 跑全工具链 → 断言 per-mission canonical + root mirror 一致

**Tests**:
- 上面列的所有 regression test。
- integration test：完整 legacy → migrate → 跑 topology_status/spawn/write_artifact/send/session_start → 全部 per-mission；mirror 一致。

**Acceptance**:
- UI footer 读 active Mission canonical。
- session_start heartbeat 写到 per-mission sessions.jsonl + status-board.json。
- migrate 之后 root mirror 与 per-mission canonical 一致。
- 3 个 role prompt 提示路径纪律。
- spec 明确 mirror 列表（7 项 vs 5 项争议解决）。
- 1 个新 integration test 跑通整个 dogfood 在 per-mission workspace。

### 3.5 Reviewer approve gate

| Slice | Severity | Approver | Implementation order |
|---|---|---|---|
| A | P1 | Reviewer | 1st (unblock other slices) |
| B | P1 | Reviewer | 2nd |
| C | P1 + P2 | Reviewer | 3rd |
| D | P2 + P3 | Reviewer | 4th (after A/B/C verified) |

每个 slice 完成后必须有：
- 至少 1 个新增 regression test 验证该 slice 修的问题。
- `npm test` 全部通过（既有 297 unit + 1 integration）。
- `npm run dogfood` 通过（端到端 per-mission 模式）。
- 一份 `<slice_id>-handoff.md` 记录 changed files / focused test / commit / risks。

### 3.6 Spec clarification needed (informs Slice D)

修复前建议 Reviewer 决断：
1. spec §3.2 列举的 7 个 root mirror 是否保留？还是要减为 5？
   - 保留 → `ROOT_MIRROR_FILES` 需扩展；增加 directory mirror logic。
   - 减为 5 → spec §3.2 改写；明确 "launch 与 artifacts 不 mirror，是 canonical 关系"。
2. spec §3.1 + §3.4 mission card `*_path` 字段语义：relative-to-mission-dir 还是 relative-to-cwd-root？
   - relative-to-mission-dir → 当前 hardcoded root 需要全部改写。
   - relative-to-cwd-root → 当前实现正确，但 spec §3.1 描述混乱需澄清。

---

## 4. Audit Conclusion

3 P1 findings 是 v0.5.1 必须修的核心：
- **P1-1**：topology_write_artifact 写 root 不写 per-mission → artifact 不出现在 dashboard。
- **P1-2**：loadRuntimeState / missionPathForWorkspace 完全无 per-mission 感知 → 所有 topology_* tool 在 migrate 之后仍走 root。
- **P1-3**：topology_spawn_role 写 launch script 到 root 不写 per-mission → launch 路径漂移。

5 P2 findings 是 spec 合同部分违约：
- **P2-1**：UI footer 优先 root。
- **P2-2**：session_start / heartbeat 写 root。
- **P2-3**：migrate 不 sync root mirror → migrate 后 root 是 legacy content。
- **P2-4**：guard allowlist hardcoded root artifact path。
- **P2-5**：guard feedback 不引导到 topology_write_artifact。

4 P3 findings 是 UX / doc drift，不破坏 dogfood 但影响 owner 决策可见性。

**Do not fix yet. Waiting for Reviewer gate.**

---
---

## Appendix A — Evidence Index (file:function:line)

| Finding | File | Function | Lines | Evidence type |
|---|---|---|---|---|
| P1-1 | `src/extension/tools.ts` | `topology_write_artifact` | 585-617 | transport |
| P1-1 | `src/runtime/root-mirror.ts` | `ROOT_MIRROR_FILES` | 42-47 | transport |
| P1-1 | `src/runtime/mission-layout.ts` | `TOPOLOGY_ROLES_FOR_ARTIFACTS` | 69-76, 119-122 | transport |
| P1-1 | `docs/14-pi-topology-mission-runtime-spec.md` | §3.2 mirror list | 113-120 | business |
| P1-1 | `test/unit/extension.test.ts` | artifact write test | 1389-1434 | transport (test only checks root path) |
| P1-2 | `src/extension/tools.ts` | `loadRuntimeState` | 820-862 | transport |
| P1-2 | `src/runtime/mission-path.ts` | `missionPathForWorkspace` | 1-13 | transport |
| P1-2 | `docs/14-pi-topology-mission-runtime-spec.md` | §3.1, §3.3, §10 | 95-180, 380-500 | business |
| P1-3 | `src/runtime/spawn.ts` | `writeRoleLaunchScript(Sync)` | 122-126, 158-162 | transport |
| P1-3 | `src/runtime/spawn.ts` | `buildRoleLaunchPlan` | 217-273 | transport |
| P1-3 | `src/runtime/mission.ts` | `MissionCard` defaults | 204-207 | transport |
| P1-3 | `docs/14-pi-topology-mission-runtime-spec.md` | §3.2, §12.2 | 113-120, 644-655 | business |
| P2-1 | `src/extension/ui.ts` | `buildTopologyUiSnapshot` | 95-104 | transport |
| P2-2 | `src/extension/register.ts` | `markTopologySessionAlive` | 328-373 | transport |
| P2-2 | `src/extension/register.ts` | `heartbeatTopologySession` | 376-407 | transport |
| P2-3 | `src/runtime/migration.ts` | `migrateLegacyToPerMission` | 340-625 (step 7 only) | transport |
| P2-3 | `src/runtime/mission-actions.ts` | `syncRootMirrorFromLayout` import + call | 41, 164 | transport |
| P2-4 | `src/runtime/guard.ts` | `isControlledCoordinationWrite` | 142-148 | transport |
| P2-5 | `src/extension/register.ts` | `tool_call` handler block return | 108-113 | transport |
| P2-5 | `src/runtime/guard.ts` | `GuardDecision.reason` shape | 60-70 | transport |
| P3-1 | `agents/topology-supervisor.md` / `hq.md` / `shared-protocol.md` | all | all | transport |
| P3-2 | `src/runtime/dashboard.ts` | `buildPathsForActive` | 259-263 | transport |
| P3-3 | `src/runtime/role-session.ts` | `getRoleSessionRecords` | 183-198 | transport |
| P3-4 | `src/extension/tools.ts` | `topology_spawn_role` execute | 372-450 | transport |
| P3-5 | `test/integration/` | missing per-mission-runtime.test.ts | n/a | inference (test gap) |

---

## Appendix B — Files Reviewed (audit-only read)

| Path | LoC read | Purpose |
|---|---|---|
| `packages/pi-topology/src/extension/tools.ts` | full | tools.ts 全部 1142 行 |
| `packages/pi-topology/src/extension/commands.ts` | partial (~770 lines) | commands.ts status/spawn/migrate/session_start 入口 |
| `packages/pi-topology/src/extension/register.ts` | full (~430 lines) | session_start + heartbeat + tool_call guard |
| `packages/pi-topology/src/extension/ui.ts` | full (~315 lines) | UI snapshot / footer / widget |
| `packages/pi-topology/src/runtime/dashboard.ts` | full (620 lines) | dashboard snapshot |
| `packages/pi-topology/src/runtime/mission.ts` | full (~280 lines) | MissionCard schema + defaults |
| `packages/pi-topology/src/runtime/mission-pointer.ts` | full (~115 lines) | active Mission pointer |
| `packages/pi-topology/src/runtime/mission-registry.ts` | full (~325 lines) | registry |
| `packages/pi-topology/src/runtime/mission-layout.ts` | full (~230 lines) | per-mission layout |
| `packages/pi-topology/src/runtime/mission-actions.ts` | partial | setActiveMissionFull |
| `packages/pi-topology/src/runtime/mission-events.ts` | full (~165 lines) | event builders |
| `packages/pi-topology/src/runtime/migration.ts` | full (~680 lines) | migrateLegacyToPerMission |
| `packages/pi-topology/src/runtime/root-mirror.ts` | full (~170 lines) | mirror sync |
| `packages/pi-topology/src/runtime/role-session.ts` | full (~492 lines) | 5-state classification |
| `packages/pi-topology/src/runtime/spawn.ts` | full (~340 lines) | launch script + plan |
| `packages/pi-topology/src/runtime/guard.ts` | full (~165 lines) | tool guard |
| `packages/pi-topology/src/runtime/launch-metadata.ts` | partial | permission envelope |
| `packages/pi-topology/src/runtime/dogfood.ts` | partial (~250 lines + cleanup) | dogfood run + mirror |
| `packages/pi-topology/src/runtime/supervisor-picker.ts` | partial (~80 lines) | picker mode detection |
| `packages/pi-topology/src/runtime/status-board.ts` | partial (~120 lines) | status board write helpers |
| `packages/pi-topology/src/state/session-ledger.ts` | full (~75 lines) | session record write |
| `packages/pi-topology/src/state/event-log.ts` | full (~28 lines) | event write |
| `packages/pi-topology/agents/topology-supervisor.md` | full | role prompt |
| `packages/pi-topology/agents/hq.md` | full | role prompt |
| `packages/pi-topology/agents/shared-protocol.md` | full | shared role protocol |
| `docs/14-pi-topology-mission-runtime-spec.md` | partial (§3.1-3.3, §10, §12.1-12.2) | spec contract |
| `test/unit/extension.test.ts` | partial (~600 lines) | existing test baseline |
| `test/unit/migration.test.ts` | partial (~150 lines) | migration test baseline |
| `test/integration/dogfood.test.ts` | partial (~60 lines) | dogfood baseline |
| `records/2026-06-17-pi-topology-v0.5-final-deep-review.md` | partial (first 200 lines) | prior audit baseline |
| `records/2026-06-18-pi-topology-v0.5-prepublish-prep.md` | full | prepublish baseline |
| `/Users/yuantian/.pi/AGENTS.md` | (system context) | sbt / solo-builder methodology |
| local `.pi/topology/` state listing | (runtime context) | confirmed legacy single-Mission |

---

## Appendix C — Tooling Traceability (for Reviewer)

| Runtime surface | Reviewed file:lines | Audit verdict |
|---|---|---|
| `topology_init_mission` | tools.ts 50-138 | ✅ per-mission (calls `writeMissionLaunchScripts` + writes registry/pointer) |
| `topology_status` (tool) | tools.ts 144-170 | ❌ root (loadRuntimeState → root path) |
| `topology_dashboard` | tools.ts 188-200 | ✅ per-mission (readDashboardSnapshot) |
| `topology_migrate` | tools.ts 213-260 | ⚠️ migrate body is per-mission but doesn't sync mirror (P2-3) |
| `topology_dashboard_verbose` | tools.ts 263-275 | ✅ per-mission |
| `topology_dashboard_widget` | tools.ts 278-289 | ✅ per-mission |
| `topology_doctor` | tools.ts 292-308 | ❌ root (loadRuntimeState) |
| `topology_smoke` | tools.ts 311-321 | ❌ root (loadRuntimeState) |
| `topology_spawn_role` | tools.ts 324-451 | ❌ root (writeRoleLaunchScript → root launch dir) |
| `topology_send` | tools.ts 495-548 | ❌ root (loaded.eventPath = root) |
| `topology_write_artifact` | tools.ts 561-617 | ❌ root (line 588) |
| `topology_read_artifact` | tools.ts 621-660 | ❌ root (line 642 resolveArtifactPath checks root path only) |
| `topology_list` | tools.ts 663-690 | ⚠️ uses loaded.mission.mission_id (root legacy card) |
| `topology_await` | tools.ts 695-746 | ⚠️ same as list |
| `topology_get` | tools.ts 749-779 | ⚠️ same |
| `topology_cleanup` | tools.ts 782-794 | ✅ (clean root, by design) |
| `session_start` | register.ts 57-60 → 145-157 | ❌ root (writes to mission.session_ledger_path = root) |
| `markTopologySessionAlive` | register.ts 328-373 | ❌ root |
| `heartbeatTopologySession` | register.ts 376-407 | ❌ root |
| `tool_call` (guard) | register.ts 67-114 | ⚠️ guard feedback incomplete (P2-5) |
| `installTopologyUi` | ui.ts 50-78 | ❌ root (buildTopologyUiSnapshot uses root path fallback) |
| `refreshTopologyUi` | ui.ts 80-89 | ❌ root |
| `buildTopologyUiSnapshot` | ui.ts 95-104 | ❌ root |
| `setActiveMissionFull` | mission-actions.ts 86-167 | ✅ per-mission (writes registry + pointer + sync mirror) — **the canonical entry point** |
| `migrateLegacyToPerMission` | migration.ts 340-625 | ⚠️ per-mission but no post-migrate mirror sync (P2-3) |

Legend: ✅ per-mission canonical (correct) · ❌ root legacy (P1/P2 finding) · ⚠️ mixed (P2/P3 finding)

---

**End of audit. No code changed. Awaiting Reviewer gate.**
