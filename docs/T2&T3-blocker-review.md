## 总体判断

这 6 项都应被视为 **before effects blocker**，但不是同一层级的 blocker。

我建议把下一阶段定义成：

```text
T5 = before-effects hardening / contract alignment
     不做真实 spawn、signal、delete

T6 = real resource creation
     允许受控 spawn / temp-directory creation
     仍不做真实 cleanup signal/delete

T7 = real cleanup execution
     才允许 SIGTERM / SIGKILL / temp-directory delete
```

如果你们已经把 T5 定义成“开始真实 resource creation”，那 T5 开始前必须先关闭 1、2、3、5、6；第 4 项可以推迟到第一个真实 cleanup task 之前，但不能晚于任何 real signal/delete。

这和 Phase A 的工程纪律一致：先 schema、durable event primitives、pure lifecycle，再进入真实 process/temp 操作；brief 也明确当前阶段目标是进入更高风险 cleanup behavior 之前确认方向，并强调 “schemas before effects / durable event primitives before lifecycle projections / pure lifecycle before real cleanup / process identity before process termination”。 

---

# 优先级总表

| 项                            | 决策                                |    real creation 前 | real cleanup 前 | 推荐阶段    |
| ---------------------------- | --------------------------------- | -----------------: | -------------: | ------- |
| 1. Canonical storage path    | 采用 `<missionDir>/foundation0/...` |                 必须 |             必须 | T5      |
| 2. ResourceCreationPlan      | 必须正式引入                            |                 必须 |             必须 | T5      |
| 3. Abandoned-before-creation | 接受窄化语义                            |                 必须 |             必须 | T5      |
| 4. Cleanup coordination      | 必须 durable acquisition            | 可不阻塞 creation-only |             必须 | T6/T7 前 |
| 5. Parent-directory fsync    | 必须补                               |                 必须 |             必须 | T5      |
| 6. Stale lock recovery       | 必须保守                              |                 必须 |             必须 | T5      |

更短地说：

```text
T5 前必须解决：
1 storage path
2 ResourceCreationPlan
3 abandoned-before-creation
5 parent-directory fsync
6 conservative stale-lock recovery

T6/T7 前必须解决：
4 durable cleanup-attempt acquisition

任何 real signal/delete 前：
1-6 全部必须关闭
```

---

# 1. Canonical storage path

**建议：正式采用**

```text
<missionDir>/foundation0/runtime-events.jsonl
<missionDir>/foundation0/payloads/<payload_digest>.json
<missionDir>/foundation0/locks/mission-events.lock
```

作为 Foundation-0 canonical path，并同步修改 docs / code / tests / payload_ref。

当前 brief 中实现已经采用 Foundation-0 子目录布局。 但 contract 19 仍写的是 mission root 下的：

```text
.pi/topology/missions/<mission_id>/runtime-events.jsonl
```

并声明该 stream authoritative。

这里必须消除 drift。我的建议是以实现方向为准，把 contract 修成：

```text
.pi/topology/missions/<mission_id>/foundation0/runtime-events.jsonl
```

同时把 Foundation-0 projections 也放进：

```text
.pi/topology/missions/<mission_id>/foundation0/
```

例如：

```text
foundation0/resource-ledger.jsonl
foundation0/cleanup-log.jsonl
foundation0/closeout.json
```

mission root 可以继续作为未来 kernel 或 compatibility mirror 的位置，但 **Foundation-0 不能同时有两个 canonical event stream**。

`payload_ref` 也应统一，例如：

```text
mission:<mission_id>/foundation0/payloads/<payload_digest>.json
```

这项是 **T5 blocker**。路径一旦进入真实 effects，后续 recovery、projection、closeout 和 evidence 都会依赖它，不应再迁移。

---

# 2. Pre-registration sidecar

**建议：effects 前正式引入 `ResourceCreationPlan`。**

T3 当前 sidecar：

```text
{ planned_resource, cleanup_policy }
```

作为 pure model compromise 是可接受的。brief 说明这是因为 planned resource schema 中 `cleanup_policy: null`，sidecar 用来保留外部资源创建前必须存在的 cleanup intent。

但在真实 spawn / temp-directory creation 前，它必须升级为 durable、replayable、digest-bound 的正式对象。contract 已经要求 runtime-created resource 必须先 durable register planned resource and cleanup policy，然后才可以 create external resource。

建议新增：

```text
ResourceCreationPlan
```

最小结构：

```json
{
  "schema_version": 1,
  "plan_id": "plan_...",
  "mission_id": "mission_...",
  "resource_id": "res_...",
  "resource_type": "process|temp_directory",
  "planned_resource": {},
  "cleanup_policy": {},
  "creation_kind": "spawn_process|create_temp_directory",
  "creation_payload": {},
  "authorization_id": "auth_...",
  "requested_by_action_id": "action_...",
  "effect_fingerprint": "sha256:...",
  "created_at": "2026-06-26T12:00:00.000Z"
}
```

规则应写死：

```text
ResourceCreationPlan MUST be durably written, digest-verified,
and referenced by a durably committed event before external creation begins.
```

`effect_fingerprint` 必须由 runtime 根据 canonical payload 重算，不能信任调用方传入值。

这项是 **T5 blocker**。没有它，crash after planned registration but before activation 无法可靠恢复。

---

# 3. Abandoned-before-creation

**建议：接受该窄化语义。**

可以正式定义：

```json
{
  "lifecycle_state": "abandoned",
  "identity": null,
  "identity_digest": null,
  "abandoned_reason": "never_created",
  "verification_state": "verified"
}
```

适用范围必须很窄：

```text
planned resource 已 durable registered；
external creation 尚未开始；
runtime 决定放弃 creation；
因此没有 PID、path、inode 或 cleanup identity。
```

brief 已经明确 T3 的 `abandoned` 不是 observed-resource state，而是当 external resource never created 时，`planned -> abandoned` 的 identity-null terminal branch。

当前风险是 brief 里说 abandoned-before-creation 暂时使用 `verification_state: "unverified"`，因为 enum 缺少更精确的 `never_created`。 这会和 clean closeout 规则冲突，因为 contract 阻塞 unverified resource 的 clean closeout。

所以建议直接改为：

```text
abandoned_reason = never_created
verification_state = verified
```

但要加硬规则：

```text
If external creation was attempted or identity may have existed,
the resource MUST NOT use abandoned_reason = never_created.
It must enter reconciliation or an unverified cleanup state.
```

这项是 **T5 blocker**。它关系到 closeout 是否会被无害的 planned-only record 永久阻塞。

---

# 4. Cleanup coordination

**建议：任何 real signal/delete 前必须升级为 durable acquisition。**

T3 当前 in-memory coordination 可以保留在 pure lifecycle 模型里；brief 也明确 durable cross-process coordination 被留到后续与 T2 event/lock layer 集成。

但 contract 已经要求：

```text
At most one cleanup attempt may be active for the same resource_id + identity_digest.
Cleanup-attempt acquisition MUST be serialized.
```



因此在真实 cleanup 前，必须改为 canonical/durable acquisition。

我建议首个实现不要引入复杂 resource-level lock，先用 **Mission event lock + durable claim event**：

```text
1. Acquire Mission event lock.
2. Rebuild or read active cleanup attempt index.
3. Check key = mission_id + resource_id + identity_digest.
4. If same idempotency key and same fingerprint:
     return existing action state.
5. If another active/unresolved attempt exists:
     append/return cleanup_in_progress.
6. Otherwise append action_attempt_started / cleanup_claim_acquired.
7. fsync event stream and required directories.
8. Release Mission event lock.
9. Execute cleanup outside the Mission lock.
10. Reacquire Mission event lock.
11. Append InitialOutcome / ReconciliationObservation / Resolution.
```

Active destructive claim 应定义为：

```text
action_attempt_started exists
AND no terminal successful/failed/skipped outcome exists
```

对于 `indeterminate`：

```text
indeterminate no longer means cleanup is actively executing,
but it MUST block a new destructive attempt until reconciliation
or explicit retry authorization.
```

这项 **不必阻塞 creation-only 的 T6**，但必须阻塞任何 T7 real cleanup。
如果 T5/T6 中已经会执行 automatic cleanup rollback，那第 4 项也必须提前到 T5/T6 前关闭。

---

# 5. Parent-directory fsync

**建议：作为 real external effect 前 blocker。**

T2 已经实现 payload/event file fsync，但 parent-directory fsync 仍 deferred。brief 明确列为 residual risk。

contract 要求 action intent 和 execution-boundary allowed PolicyDecision 在外部副作用开始前 durable commit，并且 final outcome 在 runtime 报告成功前 durable commit。

只 fsync 文件、不 fsync parent directory，在涉及新文件创建、content-addressed payload、atomic rename、lockfile 创建/删除时不够稳。最关键的风险是：

```text
payload file / event file directory entry 尚未持久化
-> external effect 已发生
-> crash
-> recovery 看不到 intent / decision / payload
```

建议 T5 补齐 durable commit 策略：

```text
payload write:
  write temp file
  fsync file
  rename into payloads/<digest>.json
  fsync payloads directory

event append:
  open/create runtime-events.jsonl
  append complete line
  fsync/fdatasync event file
  if file was newly created, fsync foundation0 directory

projection write:
  write temp projection
  fsync temp file
  rename
  fsync projection directory

lockfile:
  O_EXCL create
  write lock metadata
  fsync lock file
  fsync locks directory where required
```

这项是 **T5 blocker**，且同时阻塞 real creation 和 real cleanup。

---

# 6. Stale lock recovery

**建议：同意，effectful path 必须保守。**

当前 local `O_EXCL` locking 在 single-host first slice 内可接受，brief 也明确 distributed / multi-host locking 不在范围内。 但只要进入 effectful path，就必须定义 stale lock recovery 规则。local-only 不等于可以静默破锁。

lock record 至少包含：

```json
{
  "schema_version": 1,
  "lock_id": "lock_...",
  "mission_id": "mission_...",
  "purpose": "mission_event_append|cleanup_attempt_acquisition",
  "holder_pid": 12345,
  "holder_process_start_tuple": {},
  "holder_executable": "...",
  "holder_nonce": "nonce_...",
  "hostname": "...",
  "created_at": "2026-06-26T12:00:00.000Z"
}
```

规则建议：

```text
If holder cannot be verified:
  fail safe; do not silently break lock.

If hostname differs:
  fail safe; distributed/multi-host lock recovery is out of scope.

If PID absent and holder start tuple confirms process is gone:
  lock may be broken conservatively.

If PID exists but start tuple differs:
  original holder is gone; may break only after recording stale-lock incident.

If process probing is unavailable, permission denied, or ambiguous:
  do not break.

If lock metadata is missing, malformed, or digest-invalid:
  do not break in effectful paths.
```

最保守的 first implementation 甚至可以不做 stale breaking：

```text
stale lock suspected -> return lock_unverified / lock_busy
```

这会牺牲可用性，但不会牺牲 cleanup safety。

这项是 **T5 blocker**，因为 Mission event lock 会保护 intent/decision append，而 intent/decision 是所有 external effect 的前置条件。

---

# 建议的 T5 / T6 / T7 切分

## T5：Before-effects hardening，不做真实 external effect

T5 应关闭：

```text
[ ] Adopt foundation0 canonical storage path.
[ ] Update docs/code/tests/payload_ref to one path model.
[ ] Add ResourceCreationPlan schema and validator.
[ ] Bind ResourceCreationPlan into ActionRequest payload / event payload.
[ ] Define abandoned_reason = never_created with verification_state = verified.
[ ] Add parent-directory fsync strategy.
[ ] Add lock metadata and conservative stale-lock recovery.
[ ] Add tests for all above.
```

T5 不应做：

```text
spawn real process
create real managed temp directory
send signal
delete temp directory
```

## T6：Real resource creation only

T6 可以做：

```text
spawn runtime-owned process
create runtime-owned temp directory
write marker
observe process/temp identity
transition planned -> registered -> active
recover planned-but-not-activated records
```

T6 前必须已有：

```text
1 storage path
2 ResourceCreationPlan
3 abandoned-before-creation
5 parent-directory fsync
6 stale lock recovery
```

T6 仍不应做：

```text
SIGTERM
SIGKILL
recursive delete
automatic cleanup
```

除非第 4 项 durable cleanup coordination 也已经完成。

## T7：Real cleanup execution

T7 前必须关闭全部 6 项，并额外确认：

```text
[ ] durable cleanup-attempt acquisition
[ ] execution-boundary authorization recheck
[ ] identity recheck immediately before every signal/delete step
[ ] cleanup outcome durable append
[ ] crash-after-effect-before-outcome reconciliation
[ ] no broad process-name matching
[ ] fake killer tests before real signal smoke
```

contract 的 acceptance tests 已经要求 revoked authorization after acceptance 不执行 signal/delete、concurrent cleanup only allows one active attempt、crash after external effect reconciles without repeating dangerous side effects，以及 fault injection 证明 external effect 不早于 durable intent/allowed decision。

---

# 最终建议

可以这样下达给 Codex/HQ：

```text
Do not authorize real resource creation or cleanup yet.

Open T5 as a before-effects hardening task:
- canonicalize Foundation-0 storage path under foundation0/
- introduce durable ResourceCreationPlan
- finalize abandoned-before-creation verified semantics
- implement parent-directory fsync durability
- add conservative stale-lock metadata/recovery

Allow T6 resource creation only after T5 passes.

Do not allow any real signal/delete until durable cleanup-attempt
acquisition is implemented and tested.
```

如果需要一句话定性：

```text
1,2,3,5,6 are blockers before real creation.
4 is a blocker before real cleanup.
All six are blockers before any real signal/delete.
```
