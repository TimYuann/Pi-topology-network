## 审阅结论

这份 Spec 的**架构主线已经成立**：Mission 作为审计边界、capability-first、append-only events、消息幂等、single-writer lease、独立证据以及 resource cleanup，这些核心方向不需要推翻。十条系统不变量也足以成为 v0.6 的骨架。

但它目前还不能原样“钉死”为 implementation contract。文档本身也仍标记为 review draft，并明确说明不是 implementation contract。当前阻碍实现的不是总体方向，而是若干关键语义仍可能产生两种以上合理但不兼容的实现。

建议先解决以下 P0 项，再冻结 Spec。

---

# 一、必须在 Spec Freeze 前解决的 P0 问题

## P0-1：定义规范语言、威胁模型和符合性标准

当前文档混用了 `must`、`should`、`may`、`eventually`，但没有说明哪些是强制合同，哪些只是推荐。例如十条 invariant 看起来是强制要求，而消息 backpressure 状态又明确不要求首个 slice 实现。

建议新增一个前置章节：

```text
Normative language

MUST / MUST NOT:
  v0.6 conforming implementation 的强制要求。

SHOULD / SHOULD NOT:
  默认要求；偏离时必须记录理由。

MAY:
  可选能力。

Reserved:
  schema 必须允许，但本版本不要求实现行为。
```

同时明确三个符合性等级：

```text
schema-conformant
first-slice-conformant
v0.6-kernel-conformant
```

否则“首个 slice 完成”和“v0.6 实现完成”会被混为一谈。

### 还需要明确威胁模型

Spec 把 hard orchestration 定义为 capability、authorization、path guard、tool guard 等运行时约束，并称 policy engine 为最终仲裁者。

但需要明确：

> v0.6 是防止合作型 Agent 的误操作、越权、重试、竞态和崩溃，还是要防止拥有任意 shell/filesystem 权限的恶意 Actor？

建议 v0.6 明确限定为：

```text
v0.6 policy enforcement protects runtime-controlled execution paths
against accidental, buggy, stale, duplicated, or improperly authorized actions.

It does not claim sandbox containment against an actor that can bypass
topology tools and directly mutate the operating system or repository.
```

否则“硬约束”容易被理解成安全隔离，但当前 Spec 并没有定义 sandbox、OS 权限隔离或日志防篡改。

---

## P0-2：补上权力链的根节点——Principal / Owner 模型

当前 `Actor` 是 runtime identity，`Authorization` 由另一个 Actor 授予；但最高层 owner 没有正式对象。Mission 的 `created_by` 又写成了 `"owner|topology-supervisor"`，不是稳定 ID。

与此同时，Authorization 规定“不得超过授予者的 authority”，但没有定义这条递归授权链最终如何落到根权限。

建议新增 `Principal`：

```json
{
  "principal_id": "principal_owner_...",
  "kind": "human_owner|agent|system",
  "display_name": "owner",
  "trust_domain": "local-runtime"
}
```

Actor 增加：

```json
{
  "principal_id": "principal_...",
  "actor_id": "actor_...",
  "session_id": "session_..."
}
```

Authorization 至少增加：

```json
{
  "granted_by_principal_id": "principal_...",
  "granted_by_actor_id": "actor_...",
  "granted_under_authorization_id": "auth_parent_...",
  "delegable": true,
  "delegation_depth": 1,
  "risk_ceiling": "medium",
  "policy_hash_at_grant": "sha256:..."
}
```

并正式定义 bootstrap：

```text
Owner root authority
  -> mission approval authorization
  -> supervisor bounded delegation
  -> HQ / repair / runner scoped authorization
```

没有这个根模型，owner gate、supervisor delegation 和“不得超越上级 authority”都无法由 runtime 严格验证。

---

## P0-3：Authorization 的 scope 必须从示例变成可计算语义

目前一个 Authorization 同时包含多个 capabilities，但只共享一个 `scope`：

```json
"capabilities": ["mutate_workspace", "publish_artifact"],
"scope": {
  "paths": [...],
  "commands": [...],
  "resource_types": [...]
}
```

不同 capability 实际需要不同的 scope 类型，这种结构容易产生歧义。

建议改为逐项 grant：

```json
{
  "grants": [
    {
      "capability": "mutate_workspace",
      "scope": {
        "paths": ["packages/pi-topology/src/**"]
      },
      "risk_class": "medium"
    },
    {
      "capability": "publish_artifact",
      "scope": {
        "artifact_namespaces": ["repair/**"]
      },
      "risk_class": "low"
    }
  ]
}
```

还必须在 Spec 中定义：

### 路径 scope

* 基于 repo-relative path 还是绝对路径。
* 是否先执行 `realpath`。
* 如何防止 `..` 和 symlink escape。
* glob 使用哪套语法。
* 大小写规则。
* scope delegation 必须执行集合交集，不得仅比较字符串前缀。

### 命令 scope

不要把 `"npm test"` 当作安全边界。应使用结构化命令：

```json
{
  "executable": "npm",
  "argv_patterns": [["test"], ["run", "typecheck"]],
  "cwd_scope": ["packages/pi-topology"],
  "shell": false,
  "environment_allowlist": []
}
```

否则 shell operator、额外参数、cwd 和环境变量都可能扩大实际权限。

### risk 计算

Capability 和 Authorization 都包含 `risk_class`，但没有定义冲突时如何计算。建议固定：

```text
effective_risk =
  max(
    capability_base_risk,
    target_resource_risk,
    scope_breadth_risk,
    environment_risk,
    operation_override_risk
  )
```

Authorization 不能通过填写较低的 `risk_class` 来降低 capability 的基础风险。

---

## P0-4：增加统一的 ActionRequest 和 PolicyDecision 对象

Policy 部分目前定义了检查点和结果枚举，但没有定义 policy engine 实际接收什么，也没有定义允许后的副作用如何引用这次决策。

建议新增：

```json
{
  "action_id": "action_...",
  "mission_id": "mission_...",
  "actor_id": "actor_...",
  "capability": "terminate_resource",
  "target": {
    "resource_id": "res_..."
  },
  "authorization_id": "auth_...",
  "write_lease_id": null,
  "idempotency_key": "idem_...",
  "payload_digest": "sha256:...",
  "requested_at": "..."
}
```

以及：

```json
{
  "decision_id": "policy_decision_...",
  "action_id": "action_...",
  "result": "allowed|denied|requires_owner_gate|...",
  "reason_codes": [],
  "authorization_chain": ["auth_root_...", "auth_..."],
  "write_lease_id": null,
  "evaluated_policy_hash": "sha256:...",
  "decided_at": "..."
}
```

关键规则应写死：

```text
Every side-effect result event MUST reference a successful policy decision.

Allowed decisions MUST be recorded, not only denied or gated decisions.

Authorization and lease validity MUST be rechecked at the execution boundary,
not only when a request is initially ACCEPTED.
```

最后一条用于防止：

```text
request accepted
-> authorization revoked
-> action still executes
```

这种 TOCTOU 问题。

---

## P0-5：区分 Controlled Target 和 Managed Resource

这是当前对象模型中一个重要的类型冲突。

`WriteLease` 的 `resource_type` 包括：

```text
worktree | path | branch | artifact | state_file
```

而 `Resource` 被定义为“runtime-created or runtime-owned、可能需要 cleanup 的东西”，类型集合又不包含 `path` 和 `state_file`。

这两者实际上是不同概念：

### Controlled Target

用于并发写控制：

```text
repository
worktree
branch
path scope
state projection
artifact namespace
```

### Managed Resource

用于生命周期和 cleanup：

```text
process
temp directory
terminal session
container
port reservation
test server
```

建议把 `WriteLease.resource_id` 改成：

```json
{
  "target_id": "target_...",
  "controlled_resource_key": "..."
}
```

而 cleanup ledger 继续使用：

```json
{
  "resource_id": "res_..."
}
```

否则后续实现会被迫把所有受写控制的路径都注册成 cleanup resource，或者让 `resource_id` 指向一个并不存在的 Resource 对象。

---

## P0-6：Write Lease 必须定义原子获取和 fencing

当前 Write Lease 有 `expires_at` 和 `status`，但这不足以保证 single writer。

典型竞态是：

```text
repair-A 读取：没有 lease
repair-B 读取：没有 lease
repair-A 追加 active lease
repair-B 追加 active lease
```

两个 Actor 都会认为自己拿到了 lease。

另一个问题是 lease 过期后，旧 holder 可能仍在执行。如果新 holder 已经接管，仅靠 `expires_at` 无法阻止旧 writer 继续写。

建议要求：

```json
{
  "controlled_resource_key": "...",
  "fencing_token": 17,
  "lease_generation": 17
}
```

规范写死：

1. Lease acquisition 必须通过单一序列化点完成，例如文件锁、原子 lockfile 或 runtime lease service。
2. 同一个 `controlled_resource_key` 的 token 单调递增。
3. 每一个 guarded write 必须携带当前 fencing token。
4. 过期 holder 即使仍在运行，其旧 token 也必须被拒绝。
5. Lease renewal、release、revocation 和 takeover 都必须是正式事件。
6. Lease 冲突必须跨 Mission 检查，而不能只检查 mission-local ledger。

最后一点非常重要：两个 Mission 完全可能指向同一个 repository/worktree。Mission 是审计边界，不代表物理资源天然隔离。

### 关于 runtime state file

建议明确：

> Write lease 只用于业务资源和业务 workspace。Kernel ledger 不使用 Actor 持有的业务 write lease，而由 runtime append coordinator、文件锁和原子 projection replacement 保证一致性。

否则 Agent 为了写一条 event，还要先获取 state-file lease，容易形成自举和死锁问题。

---

## P0-7：Event source of truth 与多个 ledger 的关系必须唯一化

Spec 一方面规定 append-only events 是 source of truth，另一方面又增加 authorization、write lease、decision、resource、cleanup、artifact、evidence 等多个 JSONL ledger。

这里必须选择一种模型，不能让每个实现自行决定。

建议定稿为：

```text
runtime-events.jsonl
  = canonical state-change stream

resource-ledger.jsonl
authorization-ledger.jsonl
write-leases.jsonl
decision-log.jsonl
evidence-index.jsonl
  = rebuildable projections / indexes
```

如果坚持 domain ledger 是 canonical，也必须明确另一个 ledger 只能保存 reference，不能双写同一事实。

否则会出现：

```text
runtime-events 已写成功
resource-ledger 写失败
```

之后无法判断哪个是真相。

### “Append event first”也需要改写

当前规则“Append event first, then materialize state views”容易被理解成在外部副作用完成之前记录成功事实。

建议改为：

```text
For side-effecting actions:

1. Append action intent and policy decision.
2. Execute the external side effect.
3. Append succeeded / failed / indeterminate outcome.
4. Materialize projections.

A success fact MUST NOT be appended before the external effect is confirmed.
```

这也给 crash recovery 留下明确语义：

```text
intent exists + no outcome
  = interrupted / reconciliation required
```

还应写死：

* `sequence` 是 mission-global sequence，而不是 actor-local sequence。
* sequence 分配与 append 在同一临界区完成。
* trailing partial JSONL line 的恢复方式。
* projection 使用临时文件加 atomic rename。
* Event schema evolution 和 unknown event handling。

---

## P0-8：Message envelope 缺少“请求消息”类型

当前 Message 的 `type` 只有：

```text
RECEIVED
ACCEPTED
STARTED
PROGRESS
REPORT
FAILED
CANCELLED
CLOSED
```

这些都是 lifecycle 或结果状态，没有表示最初业务请求的类型，也没有 `operation` 或请求 payload。

建议拆成两个正交字段：

```json
{
  "kind": "REQUEST|LIFECYCLE|REPORT",
  "operation": "run_validation|review_change|repair_slice|cleanup_resource",
  "lifecycle_state": null,
  "payload_ref": "artifact_...",
  "payload_digest": "sha256:..."
}
```

例如：

```json
{
  "kind": "REQUEST",
  "operation": "run_validation",
  "lifecycle_state": null
}
```

以及：

```json
{
  "kind": "LIFECYCLE",
  "operation": "run_validation",
  "lifecycle_state": "ACCEPTED"
}
```

还要定义正式状态机：

```text
REQUEST
  -> RECEIVED
  -> ACCEPTED
  -> STARTED
  -> PROGRESS*
  -> REPORT | FAILED | CANCELLED
  -> CLOSED
```

并明确哪些跳转允许被省略。例如一个立即失败的请求是否允许：

```text
RECEIVED -> FAILED
```

### 幂等语义也要写死

建议：

```text
Dedupe key scope =
  mission_id + receiving_actor_id + idempotency_key
```

并要求保存请求 fingerprint：

```text
same idempotency key + same payload digest
  -> return existing lifecycle/result

same idempotency key + different payload digest
  -> reject as idempotency conflict and record incident
```

`causation_id` 当前在 Event 中像 event ID，在 Message 中又像 message ID。建议改成 typed reference：

```json
{
  "caused_by": {
    "entity_type": "message",
    "entity_id": "msg_..."
  }
}
```

---

## P0-9：Artifact、Evidence 和 Verdict 模型尚未闭合

Spec 说 Evidence 可以是 artifact、packet、event 或 digest，但 Evidence record 又强制要求 `artifact_id`。这是直接的模型矛盾。

此外：

* 没有完整 Artifact schema。
* 没有 Decision/Verdict schema。
* Evidence 没有绑定被验证的 revision。
* Verdict 没有绑定 change/diff。
* 后续修改发生后，旧 evidence 是否自动失效没有定义。

建议增加 Artifact：

```json
{
  "artifact_id": "art_...",
  "mission_id": "mission_...",
  "class": "working|evidence|decision",
  "media_type": "application/json",
  "content_ref": "...",
  "digest": "sha256:...",
  "size_bytes": 1234,
  "produced_by_actor_id": "actor_...",
  "source_event_id": "evt_...",
  "supersedes_artifact_id": null,
  "created_at": "..."
}
```

Evidence 改成 union source：

```json
{
  "evidence_id": "ev_...",
  "source": {
    "entity_type": "artifact|event|message",
    "entity_id": "art_..."
  },
  "subject": {
    "resource_id": "target_...",
    "revision": "git:abc123",
    "diff_digest": "sha256:..."
  },
  "digest": "sha256:..."
}
```

Decision/Verdict 至少需要：

```json
{
  "decision_id": "decision_...",
  "mission_id": "mission_...",
  "decision_type": "review_verdict|owner_gate|closeout",
  "subject_revision": "git:abc123",
  "subject_diff_digest": "sha256:...",
  "verdict": "accept|reject|conditional",
  "issued_by_actor_id": "actor_oracle_...",
  "evidence_ids": ["ev_..."],
  "evidence_set_digest": "sha256:...",
  "policy_hash": "sha256:...",
  "created_at": "..."
}
```

必须加入这条 invariant：

```text
A verdict is valid only for its exact subject revision and evidence set.
Any later mutation of the reviewed subject makes that verdict stale
unless a policy-defined equivalence rule proves otherwise.
```

否则 runner 在 revision A 上通过测试，repair 随后改成 revision B，oracle 仍可能引用 A 的测试结果放行 B。

### Oracle independence 不能只检查 role

目前约束 Oracle 不持有被审资源的 business-code lease，这是正确的，但还需检查身份连续性。

最低 runtime 保证建议为：

* Oracle actor 不得是该 revision 的 writer actor。
* Oracle session 不得是持有该 revision write lease 的 session。
* Oracle 不得在 verdict 发布时持有目标写 lease。
* Verdict 必须绑定原始 evidence 和确切 revision。
* Repair 自己产生的 self-check 只能是 evidence，不能升级为 acceptance。

---

## P0-10：Resource 生命周期和 cleanup identity 需要形式化

当前 Resource snapshot 的状态集合，与 resource-ledger transition 集合并不一致：

```text
Resource status:
registered, active, stale, cleanup_pending, cleanup_attempted,
cleaned, cleanup_failed, adopted, abandoned

Ledger transition:
registered, activated, cleanup_requested,
cleanup_attempted, cleaned, cleanup_failed
```



建议给出唯一状态机：

```text
planned
  -> registered
  -> active
  -> stale
  -> cleanup_pending
  -> cleanup_attempted
  -> cleaned | cleanup_failed

registered -> abandoned
active -> adopted
```

并说明哪些是事件、哪些是派生状态。

### Process identity 不能只有 PID

PID 会复用。Cleanup 前至少应匹配：

```text
pid
process start time
pgid
spawn token / runtime marker
executable identity or command digest
```

建议 Process identifier：

```json
{
  "pid": 12345,
  "pgid": 12345,
  "started_at_os": "...",
  "spawn_token": "spawn_...",
  "executable": "...",
  "command_digest": "sha256:..."
}
```

Cleanup 时如果 PID 相同但 start time 或 token 不一致：

```text
result = skipped_identity_mismatch
不得发送 signal
```

还要拒绝：

* 当前 CLI PID。
* 当前 CLI 的祖先进程。
* 包含当前 CLI 的 process group。
* 仅凭进程名或模糊命令匹配的目标。

### Temp directory 需要独立安全规则

建议要求：

* 必须位于 runtime-approved temp root。
* 注册和删除前都使用 canonical realpath。
* 目录内存在 ownership marker。
* marker 中的 mission_id/resource_id 与 ledger 一致。
* symlink escape、root directory、空路径一律拒绝。
* 重复 cleanup 返回已有结果，不重复产生危险副作用。

---

# 二、首个实现 Slice 存在一个依赖矛盾

Spec 选择：

```text
Mission Resource Ledger + Cleanup Guard
```

作为第一实现 slice，这个方向正确，也确实比一次实现完整授权系统更窄。

但 cleanup guard 同时要求：

* cleanup actor 具有 `terminate_resource`；
* resource 有 authorization；
* policy 允许 cleanup；
* cleanup 结果要生成 evidence。

这意味着第一 slice 无法完全绕过 capability/authorization/policy 基础设施。Cleanup Guard 自身就是 side-effecting policy enforcement。

建议把第一 slice 定义为：

```text
Foundation-0 + Resource Ledger / Cleanup Guard
```

其中 Foundation-0 只实现最小子集：

```text
Mission identity
Actor identity
register_resource capability
terminate_resource capability
minimal scoped authorization validation
ActionRequest / PolicyDecision
canonical event append
resource lifecycle projection
```

不需要在第一 slice 实现：

* 完整授权委托树 UI。
* 通用 workspace write lease。
* Oracle review flow。
* 全消息 retry/backpressure。
* 所有 resource 类型。

### 第一 slice 的范围应写死

建议只支持：

```text
process
temp_directory
```

将以下内容明确延期：

```text
terminal_window
external_session
worktree
branch
port
container
test_server
artifact cleanup
```

目前“terminal_window or external_session, if safely observable”不是可验收合同，因为实现者可以做，也可以完全不做。

---

# 三、第一 Slice 建议采用的验收标准

至少应包含以下行为测试：

1. **未注册资源不可清理**
   输入任意 PID 或路径时，runtime 必须拒绝，不得执行 signal 或 delete。

2. **跨 Mission 清理被拒绝**
   Actor 不能借当前选中 Mission 清理另一个 Mission 的资源。

3. **缺少 capability 或 authorization 被拒绝**
   拒绝结果必须写入 policy decision/event。

4. **Process identity mismatch 安全退出**
   PID 存在但 start time、spawn token 或 process group 不匹配时，不发送 signal。

5. **CLI 自保护**
   当前 CLI、祖先进程以及包含当前 CLI 的 process group 都不可被自动清理。

6. **Cleanup 幂等**
   同一 `idempotency_key` 重复调用，不重复发 signal 或删除目录，返回第一次结果。

7. **Process cleanup 有正式终止策略**
   明确 `SIGTERM -> grace period -> optional SIGKILL`，不能由实现自行决定是否直接强杀。

8. **Temp directory containment**
   目录越界、marker 不匹配、symlink escape、根路径等情况全部拒绝。

9. **成功和失败都产生证据**
   `cleanup_requested`、`cleanup_attempted`、`cleaned|cleanup_failed` 均可回放。

10. **Crash window 可恢复**
    存在 cleanup intent 但没有 outcome 时，重启后进入 reconciliation，而不是直接假定成功或重新无条件执行。

11. **JSONL 并发写不损坏**
    并发注册资源时，不能出现交错行、重复 sequence 或静默丢失。

12. **Clean closeout 检查 residual resources**
    仍有 `active`、`stale`、`cleanup_pending` 或 `cleanup_failed` 资源时，不得生成 clean closeout。

---

# 四、对八个 Open Questions 的建议定稿答案

Spec 已把八个关键决策留在 Open Questions 中；这些问题必须在 Freeze 前从文档中移除，改成正式决策。

## 1. capability-first 还是继续 role-first

**建议：v0.6 立即 capability-first。**

允许保留兼容适配器：

```text
legacy role
  -> capability profile
  -> mission-local capability snapshot
```

但 policy engine 最终只能检查 capability、authorization 和 scope，不能把 role name 当成授权凭据。

---

## 2. Write lease 是否覆盖 runtime state files

**建议：不覆盖 kernel canonical ledgers。**

* Business workspace、branch、path 使用 write lease。
* Kernel event append 使用 runtime-owned append coordinator 和文件锁。
* Materialized state 使用 atomic replace。
* Evidence/artifact 使用 actor namespace 或 immutable content-addressed write。

这样避免为“记录 lease 事件”先申请“写 lease ledger 的 lease”这种递归问题。

---

## 3. Supervisor 是否可自动授予 medium-risk capability

**建议：允许，但只能在 owner 明确委托的 envelope 内。**

不能使用：

```text
owner approved mission
  => supervisor automatically owns all medium-risk authority
```

应使用：

```text
owner authorization:
  capabilities: [...]
  scope ceiling: [...]
  risk ceiling: medium
  delegation depth: 1
  expires_at: ...
```

Supervisor 只能在该 envelope 内做子授权。

---

## 4. 是否现在引入 lifecycle_phase + attention_state

**建议：现在引入。**

这个拆分是正确的，可以避免：

```text
running_blocked
running_rollback_pending
reviewing_blocked
reviewing_rollback_pending
```

这种组合状态爆炸。

但需要补一张正式 transition table，并把 `gate_required` 改成派生的 pending gate 集合，而不是 Mission 上可被随意覆盖的单一字段。

---

## 5. Resource ledger 是否过度泛化

**建议：抽象保持通用，首个实现保持极窄。**

通用 Resource ledger 是正确方向；但 v0.6 first slice 只实现：

```text
process
temp_directory
```

并建议暂时不要把 `artifact` 作为 cleanup resource。Artifact 更接近 retention/provenance 对象，而不是需要主动终止的 runtime resource。

---

## 6. Oracle 最低独立性机制

**建议最低要求为：**

```text
different actor identity
different runtime session
no write lease on reviewed target
no prior write lease for reviewed revision
raw evidence reference
exact revision binding
runtime rejection of self-acceptance
```

仅在 prompt 中告诉 Oracle“保持独立”不够。

---

## 7. Artifact/Evidence immutability 使用 digest 还是 path convention

**建议：digest 是强制机制，path convention 只是组织方式。**

更具体地说：

```text
digest: MUST
content-addressed snapshot for final evidence: SHOULD
path convention: MAY / organizational
```

只靠路径约定无法检测内容被覆盖。只把 digest 和文件放在同一个可任意修改的位置，也只能提供一致性校验，不能提供对恶意写入的防篡改保证；这一点应与威胁模型保持一致。

---

## 8. Cleanup failure 是否阻塞 Mission closeout

**建议区分 clean closeout 和 conditional closeout。**

```text
clean closeout:
  MUST be blocked while residual owned resources remain

conditional closeout:
  MAY proceed only with explicit owner decision,
  residual_resource_ids,
  cleanup failure evidence,
  residual risk statement,
  named cleanup owner
```

建议新增：

```json
{
  "closeout_disposition": "clean|conditional|abandoned"
}
```

`delivered` 可以表示业务结果已经交付，但 `archived` 不应在 cleanup 状态不明时被默认为 clean。

---

# 五、需要同步修正的内部不一致

这些问题不一定改变架构，但应在 Freeze 前清理。

## Capability 名称不一致

Capability 列表中没有：

```text
read_artifact
decompose_work
grant_limited_scope
```

但 role profile 示例使用了这些名称；列表中实际存在的是 `grant_scope`。另外没有任何示例 profile 获得 `issue_verdict`。

建议建立唯一 capability registry，所有 schema、role profile 和测试均引用同一份定义。

同时明确 capability implication。例如：

```text
publish_evidence
```

是否自动包含：

```text
publish_artifact
```

建议默认不做隐式包含；所有依赖显式声明。

## `allowed_actor_roles` 与 capability-first 的关系

Capability schema 中仍有：

```json
"allowed_actor_roles": ["repair"]
```

这可能重新把 role 变成权限基础。

两种可接受处理：

1. 删除该字段。
2. 改名为 `eligible_profiles`，明确它只是 capability grant 的额外 policy constraint，不能单独授权。

## Snapshot 与 canonical record 混用

Authorization 有 `revocation_state`，Lease 有 `status`，Resource 有 `status`。如果 append-only events 是 source of truth，这些字段应明确标注为：

```text
materialized snapshot fields
```

而不是授权创建记录的一部分。

例如 Authorization grant 本身应不可变；revocation 应是另一个事件：

```text
authorization_granted
authorization_revoked
authorization_expired
```

## JSON 示例不是正式 Schema

很多 JSON 示例把 enum 写成：

```json
"status": "active|released|expired|revoked"
```

这既不是有效实例，也不是机器可验证 Schema。

建议 Spec Freeze 时附带：

```text
JSON Schema
或
TypeScript discriminated unions + generated JSON Schema
```

并明确：

* required 字段；
* optional / nullable；
* `additionalProperties`；
* enum；
* schema ID；
* schema version 升级规则。

---

# 六、建议加入 Spec 的四段关键规范文本

## 1. Side-effect event ordering

```text
For every side-effecting action, the runtime MUST append an action intent
and an allowed policy decision before execution.

After execution, the runtime MUST append exactly one observed outcome:
succeeded, failed, skipped, or indeterminate.

A success event MUST NOT precede confirmation of the external side effect.
```

## 2. Lease correctness

```text
Lease acquisition MUST be serialized by controlled_resource_key across missions.

Every successful acquisition MUST issue a monotonically increasing fencing token.

Every guarded write MUST present the current fencing token.
An expired, revoked, or superseded token MUST be rejected.
```

## 3. Evidence revision binding

```text
Every formal evidence item and verdict MUST identify the exact reviewed subject,
including revision or content digest.

A subsequent mutation to that subject MUST make the verdict stale unless a new
verdict explicitly reuses and revalidates the prior evidence.
```

## 4. Closeout semantics

```text
A mission MUST NOT produce a clean closeout while any owned resource remains
active, stale, cleanup_pending, cleanup_failed, or otherwise unverified.

Conditional closeout requires an explicit owner decision and a complete residual
resource inventory.
```

---

# 最终建议

这份 Spec 可以保留现有总体架构，但在进入 implementation 前，应至少完成以下 freeze gate：

```text
[ ] 定义 MUST / SHOULD / MAY 与 conformance levels
[ ] 明确 v0.6 threat model
[ ] 增加 Principal 和 root authorization chain
[ ] 增加 ActionRequest / PolicyDecision
[ ] 形式化 scope、risk 和 delegation 语义
[ ] 分离 Controlled Target 与 Managed Resource
[ ] 定义跨 Mission lease 原子性和 fencing
[ ] 选定唯一 canonical event source
[ ] 修正 Message request/lifecycle 模型
[ ] 增加 Artifact、Evidence、Decision/Verdict schema
[ ] 将 evidence/verdict 绑定到精确 revision
[ ] 定义 Resource 和 Mission closeout 状态机
[ ] 解决全部八个 Open Questions
[ ] 写死 first-slice 范围和验收测试
```

完成这些修改后，文档状态才适合从：

```text
review draft; not an implementation contract
```

改为：

```text
v0.6 implementation contract
```

第一实现仍应保持为 **process + temp directory Resource Ledger / Cleanup Guard**，但必须携带最小的 actor、authorization、policy-decision 和 canonical-event 基础，避免它退化成一段独立的进程清理补丁。
