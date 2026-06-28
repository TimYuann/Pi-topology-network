## 审阅结论

这版已经基本完成了从“架构讨论稿”到“合同硬化稿”的转换。上轮最重要的方向性问题——规范语言、威胁模型、Principal 根权限、grant-based Authorization、ActionRequest / PolicyDecision、Controlled Target 与 Managed Resource 分离、fencing、canonical event stream、revision-bound evidence、Foundation-0——都已经被吸收。文档保留 `freeze draft; not yet an accepted implementation contract` 的状态是正确的。

我的判断是：

| 层面                                  | 结论                                             |
| ----------------------------------- | ---------------------------------------------- |
| 核心架构                                | 通过，不需要重新讨论                                     |
| First-slice 选择                      | 通过                                             |
| First-slice implementation contract | 尚未通过                                           |
| 完整 v0.6 kernel contract             | 尚未通过                                           |
| 当前状态                                | **有条件接受为 freeze draft，不应改成 accepted contract** |

剩余问题已经不是架构方向问题，而是几处会让实现者产生两种不同、且都看似符合 Spec 的实现语义。下面这些问题应在正式 freeze 前钉死。

---

# 一、First-slice 开始实现前必须关闭的问题

## P0-1：Conformance level 还缺少“要求适用范围”

文档定义了三个 conformance level，并指定第一实现目标是 `first-slice-conformant`；同时又明确把完整 write lease、消息可靠性、终端资源等能力延期。

但正文中的大多数 `MUST` 没有标明适用于：

* `schema-conformant`
* `first-slice-conformant`
* `v0.6-kernel-conformant`

例如 Write Lease 章节包含多个无条件 `MUST`，但完整 workspace write-lease enforcement 又被明确延期。按当前文字，first-slice 不实现这些规则就可能被解释为“不 conform”。

建议增加一段统一规则：

```text
Requirement applicability

Every normative requirement MUST declare one of:

- [SCHEMA]
- [FIRST-SLICE]
- [KERNEL]

A first-slice-conformant implementation MUST:
- be schema-conformant for Foundation-0 and first-slice objects
- satisfy all [FIRST-SLICE] requirements
- need not satisfy [KERNEL] requirements explicitly marked deferred

A v0.6-kernel-conformant implementation MUST satisfy all three classes.
```

不一定要给每句话加标签，也可以在每章开头写：

```text
Applies to: first-slice-conformant and above
```

这是当前最先要修的合同层问题。

---

## P0-2：First-slice 依赖的核心对象仍缺少正式 Schema

Foundation-0 明确要求 Mission identity、canonical event append 和 resource lifecycle projection，但 freeze draft 中没有给出完整的：

* `Mission`
* `Event`
* `ManagedResource`
* `CleanupAttempt / CleanupOutcome`
* `CloseoutRecord`

Schema。

当前有 Resource state machine、process identity 和 temp-directory identity，但没有把 owner、cleanup policy、identity、状态、授权和生命周期字段放进一个完整 Resource record。

同样，Event 章节定义了 source-of-truth 和 append 规则，但没有定义 event envelope，因此以下引用目前没有明确落点：

* result event 如何引用 `PolicyDecision`
* event 如何引用 `action_id`
* event 如何引用 cleanup attempt
* event 如何区分 actor 与 principal
* event 如何表达 reconciliation



建议正式 freeze 前至少补齐这些 discriminated schemas。

### Mission 最小字段

```json
{
  "schema_version": 1,
  "mission_id": "mission_...",
  "created_by_principal_id": "principal_...",
  "created_at": "...",
  "lifecycle_phase": "draft|active|closing|closed|abandoned",
  "attention_state": "clear|blocked|rollback_pending",
  "pending_gate_ids": [],
  "policy_hash": "sha256:..."
}
```

最终 enum 可以使用文档已采用的完整 lifecycle，但必须有正式 transition table。当前文档只是宣布采用 `lifecycle_phase + attention_state`，还没有定义其对象和转移规则。

### Event 最小字段

```json
{
  "schema_version": 1,
  "event_id": "evt_...",
  "mission_id": "mission_...",
  "sequence": 42,
  "event_type": "cleanup_succeeded",
  "principal_id": "principal_...",
  "actor_id": "actor_...",
  "action_id": "action_...",
  "action_attempt_id": "attempt_...",
  "policy_decision_id": "policy_decision_...",
  "entity_type": "resource",
  "entity_id": "res_...",
  "caused_by": {
    "entity_type": "event",
    "entity_id": "evt_..."
  },
  "payload_ref": "...",
  "payload_digest": "sha256:...",
  "created_at": "..."
}
```

### ManagedResource 最小字段

```json
{
  "resource_id": "res_...",
  "mission_id": "mission_...",
  "resource_type": "process|temp_directory",
  "ownership_origin": "created|adopted",
  "owned_by_actor_id": "actor_...",
  "cleanup_owner_actor_id": "actor_...",
  "cleanup_policy": {},
  "identity": {},
  "identity_digest": "sha256:...",
  "lifecycle_state": "planned|registered|active|cleanup_pending|cleanup_attempted|cleaned|cleanup_failed|abandoned",
  "verification_state": "verified|unverified"
}
```

当前第 18 节已经把最终 schema 文件列为 freeze gate，但建议把具体缺失对象直接写进 gate，而不是只写泛化的“final schema files”。

---

## P0-3：First-slice 的 scoped authorization 仍然没有可计算定义

Authorization 已经从共享 scope 改为逐 capability grant，这是正确的。

但目前正式定义的 scope 只有：

* path scope
* command scope

而 first slice 实际依赖：

* `register_resource`
* `terminate_resource`



这两个 capability 需要自己的 scope schema。例如：

```json
{
  "capability": "terminate_resource",
  "scope": {
    "resource_types": ["process", "temp_directory"],
    "mission_relation": "same_mission",
    "ownership_relation": "owned_or_cleanup_owned",
    "cleanup_methods": [
      "signal_pid",
      "signal_dedicated_process_group",
      "remove_owned_temp_directory"
    ],
    "approved_temp_root_ids": ["tmp_root_default"]
  }
}
```

至少需要钉死：

1. `register_resource` 可以注册哪些 resource type。
2. `terminate_resource` 可以操作哪些 cleanup method。
3. 是否允许清理由其他 actor 创建、但本 actor 是 cleanup owner 的资源。
4. 是否允许按 `resource_id` 白名单授权。
5. temp directory scope 是路径、approved root ID，还是两者。
6. process group termination 是否属于独立风险等级。
7. `terminate_resource` 的 capability base risk 是多少。
8. first slice 中谁有权授予这两个 capability。

Capability registry 当前写的是 `SHOULD include`，对正式合同过弱。至少 first-slice 所需 capability 应改为 `MUST define`。

---

## P0-4：Action、PolicyDecision、Outcome 和 Reconciliation 还没有闭合

当前模型要求：

1. action intent
2. allowed policy decision
3. external effect
4. exactly one observed outcome

并允许 outcome 为 `indeterminate`。如果重启时只有 intent 没有 outcome，则进入 reconciliation。

这里还有三个冲突。

### 冲突一：PolicyDecision 会出现多次

文档要求在 message acceptance 和 execution boundary 重新检查授权。

因此一个 ActionRequest 可能对应：

* acceptance-time decision
* execution-time decision
* reconciliation-time decision

但 `PolicyDecision` 没有 `evaluation_point` 或 attempt 信息。

建议增加：

```json
{
  "evaluation_point": "acceptance|execution|reconciliation",
  "action_attempt_id": "attempt_...",
  "evaluation_sequence": 2
}
```

只有 `evaluation_point = execution` 且结果为 `allowed` 的 decision，才能授权外部副作用。

### 冲突二：`indeterminate` 之后如何形成最终结论

“Exactly one observed outcome”意味着一旦记录了 `indeterminate`，后续就不能再记录 `succeeded` 或 `failed`，但 reconciliation 又必须最终解决它。

建议改成：

```text
Every ActionAttempt MUST have exactly one initial observed outcome.

An indeterminate ActionAttempt MAY later receive exactly one
ReconciliationResolution:

- reconciled_succeeded
- reconciled_failed
- unresolved
```

或者直接增加独立的 `ActionAttempt`：

```text
ActionRequest
  -> ActionAttempt 1
      -> PolicyDecision
      -> InitialOutcome
      -> optional ReconciliationResolution
```

### 冲突三：Action 自身没有幂等作用域

Message 定义了 dedupe scope，但 cleanup 可以通过内部 runtime action 发起，不一定来自 Message。First-slice 验收却要求 cleanup 按 idempotency key 幂等。

建议写死：

```text
Action dedupe scope =
  mission_id
  + actor_id
  + capability
  + idempotency_key
```

并规定：

```text
same key + same effect fingerprint
  -> return existing action state or outcome

same key + different effect fingerprint
  -> idempotency_conflict

explicit retry after failed or indeterminate
  -> new idempotency key + retry_of_action_id
```

`effect fingerprint` 应至少覆盖 capability、target、payload digest 和 cleanup method。

---

## P0-5：Canonical Event 需要“持久化完成”而不仅是“append”

当前顺序要求在外部副作用之前 append intent 和 allowed decision，这个方向正确。

但 `append` 不等于 crash-safe durable commit。存在以下窗口：

```text
write intent to page cache
write allowed decision to page cache
execute kill/remove
machine or process crashes
page cache content not durable
```

恢复后，系统可能看到“资源消失了，但没有 intent 和 decision”，这会破坏审计和 reconciliation。

建议改成：

```text
The action intent and execution-boundary allowed PolicyDecision
MUST be durably committed before the external side effect begins.

The final outcome MUST be durably committed before the runtime
reports successful completion to the caller.
```

实现可以使用 `fsync`、`fdatasync` 或具有等价 durability guarantee 的策略；Spec 应规定语义，不必强制唯一系统调用。

还需要明确 canonical path，例如：

```text
.pi/topology/missions/<mission_id>/runtime-events.jsonl
```

以及区分两类 projection：

```text
JSON snapshot projection
  -> temporary file + atomic rename

derived JSONL index
  -> append under projection lock
     or rebuild into temporary file + atomic rename
```

当前“所有 projection 都 temporary file + atomic rename”和 domain JSONL projection 同时存在，容易让实现者产生不同处理方式。

另外，未知 event type 不宜默认静默忽略。对于可能影响当前 projection 的未知事件，应进入：

```text
unsupported_schema / reconciliation_required
```

而不是生成看似完整但实际遗漏状态的 projection。

---

## P0-6：Resource lifecycle 仍然存在状态建模问题

当前状态机包含：

```text
registered -> abandoned
active -> adopted
```

但 `adopted` 没有后续 cleanup 路径。

`adopted` 本质上不是 lifecycle state，而是资源来源或所有权取得方式。建议拆为：

```text
ownership_origin:
  created | adopted

lifecycle_state:
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

并补齐至少以下转移：

```text
planned -> registered | abandoned
registered -> active | abandoned
active -> stale | cleanup_pending
stale -> cleanup_pending | cleaned
cleanup_pending -> cleanup_attempted
cleanup_attempted -> cleaned | cleanup_failed
cleanup_failed -> cleanup_pending    # explicit retry
```

### 必须定义 pre-registration

对于 runtime 创建的资源，应采用：

```text
1. Allocate resource_id.
2. Durably register planned resource and cleanup policy.
3. Create external resource.
4. Record observed identity.
5. Transition to registered / active.
```

否则存在：

```text
spawn process
-> crash before registration
-> permanent unowned process
```

这正是 Resource Ledger 想解决的问题。

### 必须增加 cleanup serialization

相同 idempotency key 可以防止相同请求重复执行，但两个不同 key 仍可能同时 cleanup 同一资源。

建议增加 invariant：

```text
At most one cleanup attempt may be active for the same
resource_id + identity_digest.

Cleanup-attempt acquisition MUST be serialized.
```

后续请求应返回：

```text
cleanup_in_progress
```

而不是再次发 signal 或再次删除目录。

### `unverified` 需要正式落点

Closeout 会阻塞 `unverified` resource，但 Resource state machine 中没有这个状态。

建议把它建模为正交字段：

```text
verification_state = verified | unverified
```

不要继续扩展 lifecycle enum。

---

## P0-7：Process cleanup policy 还不够可测试

Process identity 已经明显增强，PID reuse、CLI、祖先进程和 CLI-containing process group 都被正确纳入保护。

但 first-slice 验收中的：

```text
SIGTERM -> grace period -> optional SIGKILL
```

仍然不是确定合同，因为“optional”没有说明由谁决定。

建议定义：

```json
{
  "termination_scope": "pid|dedicated_process_group",
  "term_signal": "SIGTERM",
  "grace_period_ms": 5000,
  "allow_force_kill": false,
  "force_signal": "SIGKILL"
}
```

规则应包括：

1. 只有 runtime 创建并登记为 dedicated process group 的 PGID，才允许 group signal。
2. 普通进程默认只 signal 已登记 PID。
3. `SIGKILL` 是否允许由 cleanup policy 决定，而不是实现者自由决定。
4. 强制终止前必须重新验证 identity 和 CLI protection。
5. PID 不存在时返回 `already_absent`，而不是 `identity_mismatch`。
6. Identity 不匹配返回 `skipped_identity_mismatch`，不得 signal。
7. 第一次 cleanup 失败后重试必须使用新的 idempotency key。
8. `command_digest` 的规范化输入必须定义，例如 executable、argv、cwd 的 canonical serialization。

第 18 节已经列出 process start-time probe method，但还应增加：

* 支持的 OS 列表。
* spawn token 的生成和读取方法。
* dedicated PGID 的判定方法。
* command digest canonicalization。



---

## P0-8：Temp directory cleanup 仍有验证与删除之间的竞态

现有规则已经覆盖 approved root、realpath、marker、root path 和 symlink escape。

但以下窗口仍然存在：

```text
verify path and marker
-> directory is replaced or changed
-> recursive delete
```

即便威胁模型不覆盖恶意 Actor，这种竞态仍可能由程序错误或并发 cleanup 触发。

建议规范一个安全算法，最简单的是：

```text
1. Canonicalize approved root once.
2. lstat target and marker; both MUST NOT be symlinks.
3. Verify marker mission_id/resource_id/identity_digest.
4. Recheck protected paths.
5. Atomically rename target to a quarantine name under the same approved root.
6. Append cleanup-attempt observation.
7. Recursively remove quarantined path without following symlinks.
```

还应拒绝删除：

* 当前 CLI 的 cwd。
* cwd 的任何祖先目录。
* runtime state root。
* mission storage root。
* repository root。
* approved temp root 本身。

Marker schema 也需要写死，例如：

```json
{
  "schema_version": 1,
  "mission_id": "mission_...",
  "resource_id": "res_...",
  "identity_digest": "sha256:...",
  "created_by_action_id": "action_..."
}
```

---

## P0-9：Closeout 缺少并发线性化点

目前 Closeout 规定 residual resource 会阻塞 clean closeout，这是正确的。

但存在竞态：

```text
closeout checks: no active resources
another actor registers/spawns a resource
closeout writes clean
```

因此，closeout 不能只是读一次 Resource projection。

建议增加：

```text
1. Under the Mission event lock, append closeout_started.
2. Transition Mission to closing.
3. After closing, deny new resource creation and ordinary side effects.
4. Allow only cleanup, reconciliation, evidence publication, and closeout actions.
5. Verify resources through Mission sequence N.
6. Record closeout with verified_through_sequence = N
   and resource_snapshot_digest.
```

Closeout record 应至少包含：

```json
{
  "closeout_id": "closeout_...",
  "mission_id": "mission_...",
  "disposition": "clean|conditional|abandoned",
  "verified_through_sequence": 123,
  "resource_snapshot_digest": "sha256:...",
  "residual_resource_ids": [],
  "owner_decision_id": null,
  "cleanup_owner_principal_id": null,
  "evidence_ids": [],
  "created_at": "..."
}
```

Conditional closeout 的 owner decision 也必须绑定相同的 `verified_through_sequence` 和 `resource_snapshot_digest`，否则 owner 同意的 residual inventory 可能在决定后发生变化。

---

# 二、完整 v0.6 Freeze 还需要关闭的问题

下面几项不一定阻塞最窄的 process/temp-directory coding，但会阻塞把整份文档正式标记为 `v0.6 implementation contract`。

## P0-10：Root Authorization 与 Owner Decision 仍有类型冲突

文档已经建立了 Principal 根权限和父子授权链。

但 Authorization 示例中的：

```json
"granted_by_actor_id": "actor_...",
"granted_under_authorization_id": "auth_parent_..."
```

看起来都是非空字段。Root authorization 却天然没有 parent authorization，human owner 也可能没有 actor。

建议明确 root grant：

```json
{
  "granted_by_principal_id": "principal_owner_...",
  "granted_by_actor_id": null,
  "granted_under_authorization_id": null,
  "root_basis": "owner_approval|system_bootstrap"
}
```

同时解决以下语义：

### Delegation depth

`delegation_depth: 1` 是当前深度还是剩余可委托深度不清楚。

建议改名为：

```text
delegation_depth_remaining
```

并规定 child 必须严格小于 parent。

### Parent 失效传播

必须写死：

```text
If any authorization in the chain is revoked, expired, replaced,
or invalid under current policy, all descendant authorizations
are invalid for new executions.
```

### Renewal

Authorization record 不可变，因此 renewal 不应修改原 `expires_at`。应创建新 authorization：

```json
{
  "supersedes_authorization_id": "auth_old_..."
}
```

### Expiration

`expires_at` 到达后立即失效；`authorization_expired` event 只是审计观察，不能成为失效生效的前提。

### Policy hash drift

当前存在 `stale_policy_hash`，但没有规定它是 deny、gate 还是自动重算。

建议：

```text
stale_policy_hash is non-allowed.
The action MUST be re-evaluated under current policy and may require
authorization replacement or owner gate.
```

---

## P0-11：Evidence 与 Decision 必须改为 subject discriminated union

当前 Evidence subject 强制包含：

```json
{
  "target_id": "...",
  "revision": "git:...",
  "diff_digest": "..."
}
```

这适用于代码审查，但不适用于 first-slice cleanup evidence。

类似地，Decision schema 同时覆盖：

* review verdict
* owner gate
* closeout

却强制包含 git revision 和 diff digest。

这会导致：

* cleanup evidence 被迫伪造 git revision。
* owner gate 被迫伪造代码 subject。
* closeout decision 无法绑定 resource snapshot。
* human owner decision 无法表达，因为只有 `issued_by_actor_id`。

建议改成：

```text
EvidenceSubject =
  WorkspaceSubject
  | ManagedResourceSubject
  | ActionSubject
  | MissionSubject
```

例如：

```json
{
  "subject_type": "managed_resource",
  "resource_id": "res_...",
  "identity_digest": "sha256:...",
  "cleanup_attempt_id": "cleanup_..."
}
```

Decision 应拆为：

```text
ReviewVerdict
GateDecision
CloseoutDecision
```

或者使用一个 discriminated union：

```json
{
  "decision_type": "owner_gate",
  "issued_by_principal_id": "principal_owner_...",
  "issued_by_actor_id": null,
  "subject": {
    "subject_type": "action",
    "action_id": "action_..."
  }
}
```

还应把两个概念的 ID 名称分开：

```text
policy_decision_id
business_decision_id / verdict_id
```

避免 `PolicyDecision.decision_id` 与 review/closeout `decision_id` 混淆。

### Digest 规则也需要规范化

需要定义：

* Artifact digest 的 canonical bytes。
* Event/message evidence digest 的 canonical serialization。
* `evidence_set_digest` 的排序规则。
* Runtime 在接受 evidence 和发布 verdict 时必须重新验证 digest。

仅保存 digest，而不在消费点验证，不能形成有效的 immutability check。

---

## P0-12：Message model 仍有一个明确的状态轴冲突

Message 已经正确拆成：

```text
REQUEST | LIFECYCLE | REPORT
```

但 schema 中 `lifecycle_state` 对所有 kind 看起来都是必填，同时它的 enum 不包括 `REPORT`。而 lifecycle 图又把 `REPORT` 放在状态转移路径中。

这混合了两个轴：

* REPORT 是 message kind。
* FAILED / CANCELLED 是 lifecycle state。

建议定稿为 discriminated union：

```text
REQUEST
  lifecycle_state MUST be absent

LIFECYCLE
  lifecycle_state =
    RECEIVED
    | ACCEPTED
    | STARTED
    | PROGRESS
    | RESULT_AVAILABLE
    | FAILED
    | CANCELLED
    | CLOSED

REPORT
  lifecycle_state MUST be absent
  report_status = succeeded | partial | failed
```

推荐状态流：

```text
REQUEST
  -> RECEIVED
  -> ACCEPTED
  -> STARTED
  -> PROGRESS*
  -> RESULT_AVAILABLE | FAILED | CANCELLED
  -> CLOSED
```

`RESULT_AVAILABLE` 必须引用 REPORT message 或 report artifact。

还需要规定状态发布权：

* receiver 发布 `RECEIVED / ACCEPTED / STARTED / PROGRESS`
* worker 发布 REPORT
* worker 或 runtime 发布 `RESULT_AVAILABLE / FAILED`
* requester 发布 `CLOSED`
* requester 或授权上游发起 cancellation

`operation` 当前示例只有四种值；需要明确它是可扩展 registry，而不是封闭 enum。

---

## P0-13：Write Lease 的 exact key 不能保证 overlapping scope

核心 invariant 要求 overlapping write scope 只能有一个 writer。

但当前 lease acquisition 按 `controlled_resource_key` 序列化，示例 key 又包含具体 path glob：

```text
repo:/abs/repo:path:packages/pi-topology/src/**
```



以下两个 key 不相等，却明显重叠：

```text
repo:/repo:path:src/**
repo:/repo:path:src/auth/token.ts
```

因此 exact-key serialization 不足以实现 invariant。

建议拆为：

```text
coordination_domain_key:
  canonical repository or worktree identity

scope:
  normalized path set
```

获取 lease 时：

```text
1. Lock coordination_domain_key.
2. Load all active leases in the domain.
3. Compute normalized scope overlap.
4. Reject any conflicting lease.
5. Allocate fencing token.
6. Durably append acquisition.
```

还要修正：

### ActionRequest 必须携带 fencing token

当前 ActionRequest 只有 `write_lease_id`，但 lease 规则要求每次 guarded write present fencing token。

建议增加：

```json
{
  "write_lease_id": "lease_...",
  "write_fencing_token": 17
}
```

### `fencing_token` 与 `lease_generation`

两个字段目前示例值相同，但未定义差异。应删除一个，或者明确：

```text
lease_generation:
  revision count of this lease record

fencing_token:
  monotonic stale-writer exclusion token
```

### 不存在路径的 canonicalization

对于将被创建的新文件，`realpath` 不可直接使用。应规定：

```text
Resolve the nearest existing ancestor with realpath,
then append and normalize the non-existing suffix.
```

否则新建文件路径的 symlink escape 仍有语义缺口。

---

## P0-14：Controlled Target 与 Managed Resource 的类型边界出现内部矛盾

文档规定：

```text
Controlled Targets are not cleanup resources.
```

并把 `worktree`、`branch` 列为 Controlled Target。

但 first-slice deferred Resource types 又包含：

```text
worktree
branch
```



这里需要明确是：

### 方案 A：永远不作为 Managed Resource

删除 deferred Resource types 中的 `worktree` 和 `branch`。

### 方案 B：同一物理对象允许双重记录

推荐此方案：

```text
A physical entity MAY have:

- one ControlledTarget record for write coordination
- one ManagedResource record for lifecycle cleanup

The records MUST use different IDs and MAY reference each other.
```

例如：

```json
{
  "resource_id": "res_worktree_...",
  "related_target_id": "target_worktree_..."
}
```

这样“工作树可被写租约保护”和“工作树最终需要删除”可以同时成立，而不会混淆两套状态机。

同时建议统一 reserved resource type 名称：

```text
terminal_session
external_session
port_reservation
```

目前文档中存在 `terminal_window`、`terminal_session`、`port`、`port_reservation` 等不同名称。

---

# 三、建议补充的 First-slice 验收测试

现有 12 条测试方向正确。

建议增加以下 8 条，否则前面的 invariant 仍可能只在静态路径成立。

### 13. Revoked authorization at execution boundary

```text
action accepted
-> authorization revoked
-> cleanup execution denied
-> no external signal/delete
```

### 14. Concurrent cleanup with different idempotency keys

同一个 Resource 同时收到两个不同 key，只允许一个进入执行，另一个返回 `cleanup_in_progress`。

### 15. Crash after external effect but before outcome

进程已终止或目录已删除，但 outcome 未记录。重启后 reconciliation 必须产生可解释的最终状态，不能重复危险副作用。

### 16. Crash after resource creation but before activation

依靠 pre-registered planned record 找到资源并进入 reconciliation，不能形成无主资源。

### 17. Closeout versus concurrent registration

Mission 进入 `closing` 后，新 `register_resource` 必须被 policy 拒绝。

### 18. Process group ownership

非 dedicated、非 runtime-owned process group 不允许 group signal。

### 19. Temp-directory quarantine race

验证后 target 被替换、变成 symlink 或 marker 改变时，cleanup 必须安全失败，不得删除替换后的目标。

### 20. Durable intent guarantee

测试通过故障注入验证：外部 effect 不得发生在 intent 和 allowed decision durable commit 之前。

---

# 四、建议直接替换第 18 节的 Freeze Gates

当前第 18 节列出的七项 gate 都正确，但还不完整。

建议改成：

```text
Before accepted implementation contract:

[ ] requirement applicability matrix for conformance levels
[ ] Mission schema and lifecycle/attention transition table
[ ] Principal/Actor/root-authorization nullability and bootstrap rules
[ ] authorization descendant invalidation and renewal semantics
[ ] capability registry with first-slice resource-specific scopes and risks
[ ] ActionRequest idempotency and ActionAttempt/reconciliation model
[ ] PolicyDecision evaluation-point semantics
[ ] canonical Event schema and per-Mission storage path
[ ] JSONL lock, durable-commit, partial-tail, and recovery strategy
[ ] ManagedResource, CleanupAttempt, CleanupOutcome, and Closeout schemas
[ ] resource lifecycle, verification state, and cleanup serialization rules
[ ] exact process identity, spawn-token, PGID, and supported-OS methods
[ ] exact process termination policy, including force-kill rules
[ ] exact temp-directory marker and safe deletion algorithm
[ ] closeout linearization and verified-through-sequence semantics
[ ] EvidenceSubject and Decision discriminated unions
[ ] digest canonicalization and verification semantics
[ ] Message discriminated union and lifecycle transition ownership
[ ] write-lease coordination domain, overlap algorithm, and fencing presentation
[ ] ControlledTarget / ManagedResource dual-representation rule
[ ] exact path/glob/case-sensitivity/non-existing-path semantics
[ ] final schema files or TypeScript discriminated unions
```

---

# 最终判断

这版已经可以视为：

```text
architecture accepted
first-slice scope accepted
contract semantics pending
implementation blocked on remaining P0 freeze gates
```

不需要再改变以下主线：

```text
Mission boundary
capability-first authority
ActionRequest + PolicyDecision
canonical append-only events
single-writer leases
independent evidence
managed-resource cleanup
```

下一版应该只做**合同闭合和 schema 一致化**，而不是继续扩展架构。尤其应优先完成：

1. Mission / Event / Resource / Cleanup / Closeout schema。
2. ActionAttempt、幂等和 reconciliation。
3. Resource lifecycle 与 cleanup serialization。
4. Process/temp-directory 的精确安全算法。
5. Closeout linearization。
6. Conformance applicability。

这些完成后，First-slice 才具备真正可执行、可验收、不会依赖实现者自行解释的 implementation contract。
