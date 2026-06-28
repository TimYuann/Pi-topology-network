## 审核结论

第 19 版已经是第一份**真正接近可执行合同**的版本。它不再尝试一次冻结整个 v0.6，而是明确收口为：

```text
Foundation-0
+ process / temp-directory Resource Ledger
+ Cleanup Guard
```

同时保留了 Mission、capability、ActionRequest、PolicyDecision、canonical events、resource cleanup 和 closeout 这条既定架构主线。这个收口是正确的，不需要再重新讨论整体架构。

我的结论是：

| 审核项                        | 结论         |
| -------------------------- | ---------- |
| 总体架构                       | 通过         |
| First-slice 范围             | 通过         |
| Conformance 分层             | 通过         |
| 20 条验收测试方向                 | 通过         |
| 作为 implementation contract | **尚未完全通过** |
| 是否可以立即开始编码                 | **暂不建议**   |

当前状态应继续保持：

```text
first-slice implementation contract candidate
```

还不能改为：

```text
accepted first-slice implementation contract
```

原因不再是架构问题，而是存在几处直接的 schema 矛盾、状态闭环缺口和安全算法未闭合。以下 P0 项关闭后即可进入 implementation plan 和编码。

---

# 一、本轮已经钉死、不应再重新讨论的部分

## 1. Conformance 范围已经清晰

`[SCHEMA]`、`[FIRST-SLICE]`、`[KERNEL]` 的适用层级已经解决了上一版“所有 MUST 是否都要求首个 slice 实现”的问题；完整 write lease、消息 backpressure、terminal cleanup 等也被明确延期。

## 2. Canonical storage 已经明确

Mission-local `runtime-events.jsonl` 是唯一 authoritative stream，Resource、Cleanup 和 Closeout 文件是 rebuildable projection。这个判断可以冻结。

## 3. Action 生命周期已经基本成形

本版加入：

```text
ActionRequest
ActionAttempt
PolicyDecision
InitialOutcome
ReconciliationResolution
```

这使 action intent、执行边界检查、外部副作用和崩溃恢复开始具备正式对象，而不是依赖日志文本推断。

## 4. Resource pre-registration 方向正确

先持久化 planned resource，再创建外部资源，是防止：

```text
资源已经创建
-> runtime 崩溃
-> 资源从未登记
```

这一 ghost-resource 窗口的正确办法。

## 5. Process、temp directory 和 closeout 的验收边界已经足够聚焦

PID reuse、CLI 自保护、process-group overreach、temp root containment、quarantine rename、closeout linearization 和 fault injection 都已经进入合同及测试范围。

---

# 二、正式 Freeze 前必须修复的 P0

## P0-1：`[SCHEMA]` 目前仍是示例，不是可验证 Schema

文档要求 first-slice implementation 满足所有本文件中的 `[SCHEMA]`，但当前代码块仍使用：

```json
"kind": "human_owner|agent|system"
```

这种展示式写法，且没有正式定义：

* required / optional / nullable；
* `additionalProperties`；
* enum；
* string pattern；
* ID grammar；
* digest pattern；
* timestamp format；
* discriminated union；
* 跨字段约束。

与此同时，第 14 节只应延期“所有未来 v0.6 对象的完整 schema generation”，不应延期 first-slice 自身的 schema。否则 `schema-conformant` 无法客观验收。

### 建议定稿

在实现前必须提交以下对象的 TypeScript discriminated unions 或 JSON Schema：

```text
Principal
Mission
Actor
Authorization
ActionRequest
ActionAttempt
PolicyDecision
InitialOutcome
ReconciliationResolution
Event
ManagedResource
ProcessIdentity
ProcessCleanupPolicy
TempDirectoryIdentity
TempDirectoryMarker
TempDirectoryCleanupPolicy
CloseoutRecord
Evidence
OwnerDecision
```

同时定义 ID grammar，例如：

```text
mission_id / resource_id / action_id / event_id
MUST match: ^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$
```

因为 `mission_id` 被直接用于存储路径，不能允许 `/`、`..` 或路径分隔符。

### 文档优先级也要补一条

本文件目前同时依赖 freeze draft 和 review 文档。

建议加入：

```text
For Foundation-0 and the first implementation slice, this document
supersedes conflicting first-slice semantics in document 18.

Review documents are informative, not normative.
Document 18 remains normative only for deferred kernel areas not
redefined by this contract.
```

实现者不应被要求在多个存在历史差异的文档之间自行判断优先级。

---

## P0-2：ActionRequest 尚未形成 discriminated action contract

当前 `ActionRequest.capability` 包含：

```text
register_resource
terminate_resource
close_mission
```

但 `target` 永远只有：

```json
{
  "resource_id": "res_..."
}
```

因此 `close_mission` 没有合法 target。同时 ActionRequest 只有 `payload_digest`，没有 `payload_ref` 或 typed payload，无法从 canonical state 重建：

* cleanup method；
* process termination policy；
* expected identity；
* temp quarantine path；
* closeout disposition；
* resource creation plan。



建议改成 discriminated union：

```typescript
type ActionRequest =
  | RegisterResourceAction
  | CreateManagedResourceAction
  | TerminateResourceAction
  | ReconcileResourceAction
  | CloseMissionAction;
```

例如：

```json
{
  "capability": "terminate_resource",
  "target": {
    "entity_type": "resource",
    "resource_id": "res_..."
  },
  "payload_ref": "...",
  "payload_digest": "sha256:...",
  "effect_fingerprint": "sha256:..."
}
```

以及：

```json
{
  "capability": "close_mission",
  "target": {
    "entity_type": "mission",
    "mission_id": "mission_..."
  }
}
```

### `register_resource` 与“创建资源”也要分开

Pre-registration 流程明确包含：

```text
durably register planned resource
-> create external resource
```

但创建 process 或 temp directory 本身也是外部副作用。仅有 `register_resource` capability 时，无法判断它是否顺便授权：

* spawn process；
* create directory；
* create marker；
* establish process group。

建议增加：

```text
create_managed_resource
```

并保留：

```text
register_resource
```

用于登记或受控 adoption。

如果坚持不增加 capability，则必须明确写死：

```text
register_resource with registration_mode = create
authorizes exactly the creation plan bound into effect_fingerprint.
```

否则 capability 的名字、scope 和实际副作用不一致。

### Digest 必须由 runtime 重算

`payload_digest` 和 `effect_fingerprint` 不能信任调用方提供值。Runtime 必须根据 canonical payload 自行重算并比较，否则攻击或 bug 可以提交一个安全 fingerprint，却执行另一个 payload。

---

## P0-3：Authorization 的 root、delegated 和 system-bootstrap 形态仍需分型

当前 Authorization 示例是 root grant：

```json
"granted_by_actor_id": null,
"granted_under_authorization_id": null,
"root_basis": "owner_approval|system_bootstrap"
```

但同一个 schema 又包含 delegation depth 和 descendant invalidation 规则。

建议拆为：

```text
RootAuthorization
DelegatedAuthorization
```

Root：

```json
{
  "authorization_kind": "root",
  "granted_by_actor_id": null,
  "granted_under_authorization_id": null,
  "root_basis": "owner_approval|system_bootstrap"
}
```

Delegated：

```json
{
  "authorization_kind": "delegated",
  "granted_by_actor_id": "actor_...",
  "granted_under_authorization_id": "auth_...",
  "root_basis": null
}
```

### `system_bootstrap` 必须有硬限制

目前 system Principal 和 `system_bootstrap` root authorization 都被允许，但没有限制 system bootstrap 可以授予哪些能力。理论上它可能成为绕开 owner authority 的无界根权限。

建议 first slice 固定：

```text
system_bootstrap MUST NOT authorize cleanup of an arbitrary PID or path.

It MAY authorize reconciliation only for a resource that:
- already has a durable planned/registered record
- belongs to the same Mission
- was originally created under an owner-rooted authorization
- has an owner-approved cleanup policy
```

`system_bootstrap` 若允许 `terminate_resource`，必须只针对已有 `resource_id + identity_digest`，不能接受任意 external identifier。

### 还需要 first-slice capability registry 表

至少钉死：

| Capability                |     Base risk | Target          | 允许的 Mission phase |
| ------------------------- | ------------: | --------------- | ----------------- |
| `create_managed_resource` |    low/medium | resource        | active            |
| `register_resource`       |           low | resource        | active            |
| `terminate_resource`      |        medium | resource        | active/closing    |
| `reconcile_resource`      | low，若产生副作用则升级 | resource/action | active/closing    |
| `close_mission`           |        medium | mission         | active/closing    |

---

## P0-4：Canonical Event enum 不足以重放本文件定义的状态

当前 event enum 只有：

```text
action_intent
policy_decision
resource_registered
cleanup_attempted
cleanup_succeeded
cleanup_failed
reconciliation_required
closeout_started
closeout_recorded
```

但本合同还要求重放：

* Mission `draft -> active -> closing -> closed`；
* Resource `planned -> registered -> active`；
* Authorization grant / revoke / replace；
* InitialOutcome 的 `skipped` 和 `indeterminate`；
* ReconciliationResolution；
* Resource stale、abandoned；
* verification state；
* projection conflict incident。

这些事件在 enum 中不存在。更直接的内部不一致是：规则要求未知关键事件导致 `unsupported_schema`，但 `unsupported_schema` 本身也不在 event enum 中。

建议增加正式 event catalog，至少包括：

```text
mission_created
mission_phase_changed

authorization_granted
authorization_revoked
authorization_replaced

action_requested
action_attempt_started
policy_decision_recorded
initial_outcome_recorded

resource_planned
resource_identity_observed
resource_registered
resource_activated
resource_stale_observed
resource_cleanup_pending
resource_cleanup_attempted
resource_cleaned
resource_cleanup_failed
resource_abandoned

reconciliation_required
reconciliation_observed
reconciliation_resolved

closeout_started
closeout_recorded

projection_conflict_detected
unsupported_schema_detected
```

Event 也必须是 discriminated union。当前示例中的：

```text
actor_id
action_attempt_id
policy_decision_id
caused_by
payload_ref
```

不可能对所有 event type 都必填。

### Payload durability 必须补充

Event 通过 `payload_ref` 引用外部文件。外部 payload 如果没有先 durable commit，可能出现：

```text
event 已 fsync
payload 尚未落盘
-> crash
-> canonical event 永久指向不存在的内容
```

建议写死：

```text
Referenced payload content MUST be durably written and digest-verified
before the event that references it is durably appended.
```

此外，InitialOutcome 不应只在“向调用方报告成功”前 durable commit，而应在报告**任何 terminal result** 前完成：

```text
succeeded
failed
skipped
indeterminate
```

---

## P0-5：ManagedResource 与 pre-registration 之间存在直接 schema 冲突

`ManagedResource` 当前看起来始终要求：

```json
"cleanup_policy": {},
"identity": {},
"identity_digest": "sha256:..."
```

但 pre-registration 明确要求在外部资源创建之前就持久化 `planned` Resource。此时 process PID、start time、temp realpath、inode 等 identity 尚不存在。

建议明确：

```text
lifecycle_state = planned:
  identity = null
  identity_digest = null
  verification_state = unverified

lifecycle_state in registered|active|stale|cleanup_*|cleaned:
  identity MUST be present
  identity_digest MUST be present
```

并把 ManagedResource 定义成 union：

```text
PlannedProcessResource
ObservedProcessResource
PlannedTempDirectoryResource
ObservedTempDirectoryResource
```

同时增加：

```text
ProcessResource.cleanup_policy = ProcessCleanupPolicy
TempDirectoryResource.cleanup_policy = TempDirectoryCleanupPolicy
```

当前没有 TempDirectoryCleanupPolicy schema。

### Outcome 到 Resource state 的映射必须写死

建议使用一张规范表：

| Outcome                          | Resource lifecycle  | Verification |
| -------------------------------- | ------------------- | ------------ |
| `cleaned`                        | `cleaned`           | `verified`   |
| `already_absent`                 | `cleaned`           | `verified`   |
| `skipped_identity_mismatch`      | `cleanup_failed`    | `unverified` |
| protected path / CLI protection  | `cleanup_failed`    | `unverified` |
| marker mismatch / target changed | `cleanup_failed`    | `unverified` |
| ordinary cleanup failure         | `cleanup_failed`    | `unverified` |
| `indeterminate`                  | `cleanup_attempted` | `unverified` |
| `reconciled_succeeded`           | `cleaned`           | `verified`   |
| `reconciled_failed`              | `cleanup_failed`    | `unverified` |

当前 InitialOutcome 允许 `indeterminate`，但 `result_code` enum 没有对应代码；同时它也没有 `register_resource` 和 `close_mission` 的结果代码。

应改为 action-specific outcome union，而不是所有 action 共用一个 cleanup-oriented `result_code` enum。

### Active cleanup attempt 也要定义

“同一个 Resource 最多一个 active cleanup attempt”已经规定，但 ActionAttempt 没有状态字段。

建议定义：

```text
active cleanup attempt =
  action_attempt_started exists
  AND no non-indeterminate terminal resolution exists
```

还要说明 `indeterminate` 是否继续占用 active claim。推荐：

```text
indeterminate no longer executes effects,
but blocks a new destructive attempt until reconciliation or explicit retry authorization.
```

---

## P0-6：Temp directory identity 存在 digest 循环，quarantine 恢复也未闭合

当前 TempDirectoryIdentity 包含：

```json
"marker_digest": "sha256:..."
```

Marker 又包含：

```json
"identity_digest": "sha256:..."
```

而 ManagedResource 又保存整个 identity 的 `identity_digest`。如果 `identity_digest` 按自然理解覆盖完整 TempDirectoryIdentity，就会形成：

```text
identity_digest
  depends on marker_digest
    depends on marker contents
      depends on identity_digest
```

这是循环定义。

建议拆成：

```json
{
  "identity_core": {
    "approved_temp_root_id": "tmp_root_default",
    "canonical_path": "...",
    "device_id": 1,
    "inode": 123,
    "owner_uid": 501,
    "creation_nonce": "nonce_..."
  },
  "identity_digest": "sha256(canonical(identity_core))",
  "marker_digest": "sha256(canonical(marker))"
}
```

Marker 引用 `identity_digest`，而 `marker_digest` 不参与 `identity_digest` 计算。

### 仅有 realpath 和 marker 还不够

因为 `/private/tmp` 是共享位置，建议 identity 至少增加：

```text
device_id
inode
owner_uid
creation_nonce
```

Runtime 在 rename 前后都要比较 device/inode，防止通过同路径 replacement 删除了另一个目录。

`approved_temp_root_realpath` 也不能信任 Resource record 内的值。必须通过 trusted registry：

```text
approved_temp_root_id
  -> runtime-owned configured canonical root
```

在 cleanup 时重新解析 root ID，并与记录值比较。

### Quarantine path 必须在 rename 前持久化

当前算法先 rename，再 append cleanup-attempt observation。

若在 rename 后、记录 observation 前崩溃：

```text
原路径消失
quarantine 路径未写入 canonical state
```

会产生新的 orphan directory。

建议：

```text
quarantine_path =
  deterministic function(resource_id, action_attempt_id)
```

并把它绑定进 action payload、effect fingerprint 和 durable intent，之后才允许 rename。

Rename 后还必须：

1. 在 quarantine path 上重新 `lstat`。
2. 验证 device/inode 与 rename 前相同。
3. 重新验证 marker digest。
4. 若 recursive delete 失败，将 `current_locator = quarantine_path` 写入资源状态。
5. 后续 retry 必须针对 quarantine path，而不是已消失的原路径。

---

## P0-7：Reconciliation 的“只能有一个 unresolved resolution”无法继续恢复

当前规则是：

```text
An indeterminate outcome MAY later receive one ReconciliationResolution.
```

而 ReconciliationResolution 又允许：

```text
unresolved
```

这意味着一旦第一次 reconciliation 写入 `unresolved`，该 ActionAttempt 按“只能有一个 resolution”就永远不能再被解析为 succeeded 或 failed。

建议拆为：

```text
ReconciliationObservation
  可有零个或多个
  状态可为 still_unresolved

ReconciliationResolution
  最多一个 final resolution
  只能是 reconciled_succeeded | reconciled_failed
```

或者允许多次 resolution 记录，但只有最后一个具有：

```text
is_final = true
```

前一种更清晰。

### ReconciliationResolution 还应引用

```text
reconciliation_action_id
reconciliation_actor_id
policy_decision_id
evidence_ids
observed_at
```

如果 reconciliation 要再次 signal、force kill 或删除 quarantine 内容，它就是新的外部副作用，必须有新的 ActionRequest、ActionAttempt 和 execution PolicyDecision。

### 必须补正式 recovery procedure

当前 Implementation Plan Preconditions 没有再要求“exact crash recovery procedure”，只要求测试策略。

应恢复这一 gate，并至少覆盖：

```text
planned resource without observed identity
intent without policy decision
allowed policy decision without outcome
process cleanup interrupted after SIGTERM
temp cleanup interrupted after quarantine rename
indeterminate outcome without final reconciliation
closeout_started without closeout_recorded
trailing partial canonical event
missing or digest-mismatched payload_ref
```

---

## P0-8：Process identity 中 `spawn_token` 的可观察语义未定义

Process cleanup 要求 PID、start time、spawn token、PGID、executable、command digest 全部匹配。

但 implementation precondition 只要求定义 macOS 上的：

* start time；
* PGID；
* ancestors；
* process-group membership。

没有说明 cleanup 时如何重新观察 `spawn_token`、argv 和 cwd。

必须二选一：

### 方案 A：spawn token 是 live identity

实现计划必须明确 token 如何注入进程，以及 cleanup 时如何可靠读取并比较。

### 方案 B：spawn token 只是 provenance nonce

则它只能证明“这个 PID 是由哪个 spawn action 登记”，不能被列为 cleanup-time live probe。Cleanup-time identity 应依赖：

```text
pid
raw OS process start tuple
pgid
executable identity
command digest
```

我更建议方案 B，并将字段改名为：

```text
spawn_nonce
```

### Start time 不建议只保存 ISO timestamp

PID reuse 防护需要保留 OS 原始精度，例如：

```text
start_time_seconds
start_time_microseconds
```

显示时可以额外派生 ISO 字符串，但不应只依赖格式化后的时间。

### 每一次 signal 前都要重新检查

当前仅明确要求 force kill 前重查 identity 和 CLI protection。

应改为：

```text
Identity, authorization, Mission phase, and CLI protection
MUST be rechecked immediately before every signal operation.
```

包括：

```text
SIGTERM
SIGKILL
process-group SIGTERM
process-group SIGKILL
```

还需定义一个 execution PolicyDecision 是授权整个 bounded cleanup plan，还是每个 signal step 都需要新 decision。推荐：

* SIGTERM：一个 execution decision；
* 等待超时后准备 SIGKILL：重新 policy evaluation；
* SIGKILL：新的 execution decision。

这样 authorization 在 grace period 中被撤销时，不会继续强杀。

---

## P0-9：Evidence 和 Closeout 尚未形成完整合同

### Evidence 只有 subject，没有 Evidence record

InitialOutcome、ReconciliationResolution 和 CloseoutRecord 都引用 `evidence_ids`，但第 12 节只定义了 cleanup subject，没有定义一个 `evidence_id` 实际指向什么对象。

建议加入 first-slice Evidence：

```json
{
  "schema_version": 1,
  "evidence_id": "ev_...",
  "mission_id": "mission_...",
  "source": {
    "entity_type": "event|action|outcome|payload",
    "entity_id": "evt_..."
  },
  "subject": {
    "subject_type": "managed_resource",
    "resource_id": "res_...",
    "identity_digest": "sha256:...",
    "action_attempt_id": "attempt_..."
  },
  "digest": "sha256:...",
  "produced_by_principal_id": "principal_...",
  "produced_by_actor_id": "actor_...",
  "created_at": "..."
}
```

`cleanup_attempt_id` 应统一为现有对象名称：

```text
action_attempt_id
```

Canonical event payload 是 first-slice 的审计依据，即使完整 artifact retention 被延期，这些 payload 也必须具有最低保留保证，不能被当作普通 working artifact 随意删除。

### CloseoutRecord 少了自己要求的字段

Closeout 规则要求 conditional closeout 必须包含 residual risk statement，但 CloseoutRecord schema 没有该字段。

同时它只有一个：

```text
cleanup_owner_principal_id
```

如果残留多个资源、分别由不同 owner 跟进，就无法表达。

建议改为：

```json
{
  "residual_resources": [
    {
      "resource_id": "res_...",
      "lifecycle_state": "cleanup_failed",
      "verification_state": "unverified",
      "residual_risk_statement": "...",
      "cleanup_owner_principal_id": "principal_...",
      "evidence_ids": ["ev_..."]
    }
  ]
}
```

### Clean closeout 的阻塞集合不完整

Resource lifecycle 包含：

```text
planned
registered
active
stale
cleanup_pending
cleanup_attempted
cleaned
cleanup_failed
abandoned
```

但 clean closeout 只明确阻塞：

```text
active
stale
cleanup_pending
cleanup_failed
unverified
```

遗漏了：

```text
planned
registered
cleanup_attempted
```



建议使用正向规则，而不是不断补阻塞列表：

```text
Clean closeout is allowed only when every owned resource is:

- cleaned + verified
or
- abandoned + verified as never externally created
```

并且不能存在：

```text
unfinished ActionAttempt
indeterminate ActionAttempt without final reconciliation
closeout-relevant unsupported event
```

### OwnerDecision 也要有 schema

Conditional closeout 引用了 `owner_decision_id`，但 first-slice 没有 OwnerDecision 对象。至少需要绑定：

```text
mission_id
issued_by_principal_id
verified_through_sequence
resource_snapshot_digest
residual resource set
decision
created_at
```

### 最终 closeout 线性化应再精确一步

不建议在整个资源验证期间持续持有 Mission event lock。推荐：

```text
1. 在 lock 下记录 closeout_started，并转入 closing。
2. 释放 lock，完成 cleanup / reconciliation。
3. 重新取得 lock。
4. 从 canonical events 重建到最新 sequence N。
5. 验证所有资源满足 closeout 条件。
6. 在同一 critical section 内追加 closeout_recorded 和 Mission closed transition。
7. durable commit 后释放 lock。
```

这样既不阻塞长时间 cleanup，也不会在最终检查和 closeout commit 之间产生竞态。

---

# 三、建议追加的 First-slice 验收测试

当前 20 条验收测试已经是很好的基础。

建议再加入：

21. **Schema cross-field validation**
    `planned` Resource 可以没有 identity；`active` Resource 缺 identity 必须拒绝。

22. **Action target validation**
    `close_mission` 使用 resource target、`terminate_resource` 使用 mission target 时必须被 schema 拒绝。

23. **Payload/fingerprint integrity**
    调用方提供的 effect fingerprint 与 runtime 重算值不一致时不得执行。

24. **System-bootstrap confinement**
    System Principal 不能清理未登记资源，也不能把任意 PID/path 作为 reconciliation target。

25. **Temp identity digest is non-circular**
    Marker、identity core 和 marker digest 可以确定性生成并独立验证。

26. **Temp inode replacement protection**
    验证后目标被替换为相同路径、相同 marker 文本但不同 inode 时，不得删除替换目标。

27. **Quarantine crash recovery**
    Rename 成功、delete 前崩溃时，重启可从 canonical intent 找到 quarantine path。

28. **Signal-step reauthorization**
    SIGTERM 后、grace period 内授权被撤销时，不得继续 SIGKILL。

29. **Reconciliation can progress**
    第一次 observation 为 unresolved 后，后续仍可形成 final reconciled result。

30. **Complete closeout blocking**
    `planned`、`registered`、`cleanup_attempted`、`unverified` 均阻止 clean closeout。

31. **Missing event payload recovery**
    Event 存在但 payload 缺失或 digest 不匹配时，系统进入 reconciliation，不生成成功 projection。

32. **Conditional closeout binding**
    OwnerDecision、resource snapshot digest 和 per-resource residual inventory 不一致时，conditional closeout 被拒绝。

---

# 四、建议替换 Implementation Plan Preconditions

当前列出的 macOS probe、event lock、durability、canonical JSON、temp root、fault injection 和 process abstraction 都应保留。

建议补齐为：

```text
Before implementation begins:

[ ] first-slice TypeScript unions or JSON Schemas
[ ] normative document precedence rule
[ ] ID grammar and mission-path derivation rule
[ ] first-slice capability/risk/scope registry
[ ] typed ActionRequest payloads and target unions
[ ] root/delegated/system-bootstrap authorization schemas
[ ] complete event catalog and event payload schemas
[ ] payload durable-write-before-event strategy
[ ] Mission event lock strategy and lock ordering
[ ] cleanup-attempt serialization strategy
[ ] canonical JSON and all digest input definitions
[ ] resource outcome-to-state transition table
[ ] exact crash recovery and reconciliation procedure
[ ] exact macOS raw process-start probe
[ ] spawn token / spawn nonce semantics
[ ] exact argv, cwd and executable observation method
[ ] policy recheck strategy for SIGTERM and SIGKILL
[ ] trusted approved-temp-root registry
[ ] temp identity core and non-circular digest rules
[ ] quarantine path derivation and residual locator rules
[ ] first-slice Evidence and OwnerDecision schemas
[ ] resource snapshot digest canonicalization
[ ] closeout final critical-section algorithm
[ ] fault-injection and no-real-broad-signal test strategy
```

---

# 最终判断

第 19 版已经可以冻结以下内容：

```text
架构方向
First-slice 边界
核心对象集合
Canonical event 原则
Process/temp-directory cleanup 目标
Closeout 不隐藏残留资源
验收测试总体方向
```

现在不应继续扩展角色、消息系统、write lease 或其他 Resource 类型。

下一轮只需关闭上述合同矛盾，重点是：

1. First-slice machine-checkable schemas。
2. Action target/payload/capability 闭环。
3. 完整 event catalog。
4. Pre-registration 与 identity nullability。
5. Temp digest 和 quarantine recovery。
6. Reconciliation finality。
7. Evidence 与 conditional closeout。
8. Process 每个 signal step 的身份和授权复核。

这些修正后，文档就可以正式改为：

```text
Status: accepted first-slice implementation contract
```

并开始 implementation plan 与编码。
