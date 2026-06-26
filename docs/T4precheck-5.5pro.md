## 审阅结论

基于这份 brief，我认为 **T1–T3 的方向没有发生架构漂移**，而且工程推进顺序是健康的：先 schema，再 durable event primitive，再纯生命周期模型，最后才进入真实 host process identity 和 cleanup 行为。这正符合 brief 自己声明的阶段目标：在进入更高风险的 macOS process probing / cleanup 前，先确认 Resource Ledger / Cleanup Guard 的基础方向仍然正确。

我的结论是：

| 项目                                       | 判断                                     |
| ---------------------------------------- | -------------------------------------- |
| T1 Schema Contract                       | 方向通过                                   |
| T2 Mission Event Lock / Append           | 方向通过，但 storage path 与 durability 有待收口  |
| T3 Resource Lifecycle / Pre-registration | 方向通过，但 sidecar 和 abandoned 语义需在下一阶段前固化 |
| 是否可进入 T4                                 | **可以，但 T4 必须严格 read-only**             |
| 是否可进入真实 signal / cleanup                 | **不可以，还需要下一道 gate**                    |

简化判断：

```text
T1–T3: approve as Foundation-0 Phase A directionally correct
T4: approve only as read-only ProcessIdentity / ProcessInspector abstraction
T5/T6 cleanup execution: not approved yet
```

---

# 一、总体方向：通过

当前实现策略是正确的。brief 明确说 Foundation-0 被放在独立 runtime module 中，暂不接入现有 v0.5 topology command runtime；目标是先建立 contract-level primitives，再接真实 process/temp-directory 操作。这个隔离策略是合理的，因为它避免在 ledger / guard 语义未稳定前改变 live behavior。

我认可这个推进顺序：

```text
schemas before effects
durable event primitives before lifecycle projections
pure lifecycle state transitions before real cleanup
process identity before process termination
review gates before higher-risk steps
```

brief 中列出的这一顺序非常重要，不应被压缩或跳过。

这也符合 first-slice contract 的窄化目标：Foundation-0 + process/temp-directory Resource Ledger and Cleanup Guard，而不是一次性实现完整 v0.6 kernel。

---

# 二、T1 审阅：Schema Contract 方向正确

T1 已完成 ID、digest、timestamp、canonical JSON helpers，21 个 first-slice schema object families，per-object validators，action-specific `InitialOutcome`，closed authorization scope，以及 planned-vs-observed ManagedResource validation。brief 报告 T1 的 schema tests、unit suite 和 typecheck 均通过。

这是我上一轮最关心的点之一：first-slice 不能只停留在文档示例，必须进入可验证 schema / validator。T1 看起来已经朝这个方向推进。

但这里仍有一个要求：**这些 validators 应当被视为 implementation contract 的执行面，而不只是测试辅助代码**。也就是说，后续 ActionRequest、Event、Resource、Outcome、Closeout 等对象进入 runtime 时，必须走同一套 validator，不应出现“测试里验证，实际路径绕过”的情况。

我建议后续加一个简单 invariant：

```text
Any object persisted into Foundation-0 canonical storage MUST pass
the corresponding Foundation-0 validator before durable append.
```

---

# 三、T2 审阅：Event append 方向正确，但有两个需要收口的问题

T2 实现了本地 `O_EXCL` lockfile、Mission-scoped event lock、payload digest、payload durable-write-before-event append、content-addressed payload storage、deterministic event id 幂等 append、sequence invariant validation、partial trailing row detection 和 payload verification helper。这个方向与 canonical event-first 的设计一致。

## 1. 本地 `O_EXCL` lock：first slice 可接受

在当前 stated non-distributed scope 下，使用本地 `O_EXCL` lockfile 是可以接受的。brief 也明确说 distributed / multi-host locking 不在本阶段范围内。

但要补两条工程约束：

```text
lock record SHOULD include:
- holder pid
- holder process start tuple or nonce
- created_at
- purpose
- mission_id
```

以及：

```text
stale lock recovery MUST be conservative.
If holder liveness cannot be safely determined, do not break the lock silently.
```

T4 只读，所以这不是 T4 blocker。
但在进入真实 cleanup execution 前，这是 blocker。

## 2. Storage layout 存在 contract drift 风险

brief 里的 T2 storage layout 是：

```text
<missionDir>/foundation0/runtime-events.jsonl
<missionDir>/foundation0/payloads/<payload_digest>.json
<missionDir>/foundation0/locks/mission-events.lock
```



而 first-slice contract 中的 canonical event stream 是：

```text
.pi/topology/missions/<mission_id>/runtime-events.jsonl
```

projection 文件也在 mission root 下。

这不是大问题，但必须尽快钉死。否则后续 projection、recovery、compatibility mirror 和 closeout 都会出现路径分歧。

可选修法有两个：

```text
方案 A：实现改回 contract path
.pi/topology/missions/<mission_id>/runtime-events.jsonl

方案 B：contract 明确 Foundation-0 canonical subdir
.pi/topology/missions/<mission_id>/foundation0/runtime-events.jsonl
```

我倾向 **方案 B**，因为当前工程已经将 Foundation-0 作为隔离模块，单独放在 `foundation0/` 下有利于 review 和迁移。但无论选哪个，都必须让文档、代码、测试和 payload_ref 统一。

这就是 brief 第 6 个问题里最大的 path-drift 风险。

---

# 四、T3 审阅：Lifecycle / Pre-registration 方向正确，但 sidecar 需要升级成 durable plan

T3 实现了 ManagedResource lifecycle transition helper、runtime-created resource pre-registration sidecar model、`AbandonedResource` branch、in-memory cleanup-attempt coordination，以及 validation-preserving transitions。

## 1. `AbandonedResource` branch 是正确解释

我认可这个解释：

```text
planned -> abandoned
```

可以表示：

```text
planned record 已经持久化
但 external resource 尚未创建
随后放弃创建
```

brief 明确说 `abandoned` 不是 observed-resource state，而是可以 identity-null 的 terminal branch。这个解释是正确的。

但现在还有一个词汇问题：brief 说 abandoned-before-creation 目前使用 `verification_state: "unverified"`，因为 enum 缺少更精确的 `never_created`。

这个后续必须修。否则 clean closeout 会被无害的 abandoned-before-creation resource 阻塞。first-slice contract 当前规定 clean closeout 会被 residual active/stale/cleanup_pending/cleanup_failed/unverified resource 阻塞。

建议加一个正交字段，而不是把 `verification_state` 扩得过多：

```text
external_creation_state =
  planned_only
  | creation_attempted
  | observed_created
  | creation_failed
  | never_created
  | unknown
```

然后 clean closeout 允许：

```text
abandoned + external_creation_state = never_created
```

或者更简单，在 first slice 中允许：

```text
AbandonedResource {
  lifecycle_state: "abandoned",
  identity: null,
  identity_digest: null,
  abandoned_reason: "never_created",
  verification_state: "verified"
}
```

我更建议后一种，足够窄，便于实现。

## 2. Pre-registration sidecar：T3 可接受，真实创建前必须持久化

brief 说明 T1 schema 中 planned resource 的 `cleanup_policy` 为 null，因此 T3 使用 sidecar：

```text
{ resource: PlannedResource, cleanup_policy: ProcessCleanupPolicy | TempDirectoryCleanupPolicy }
```



这个 pure-model compromise 可以接受。它保持了 planned-resource nullability，同时保存外部资源创建前必须存在的 cleanup intent。

但注意：first-slice contract 要求 pre-registration 的第 2 步是：

```text
Durably register planned resource and cleanup policy.
```

然后才可以 create external resource。

因此，在进入真实 process spawn 或 temp-directory creation 前，sidecar 不能只是内存模型，也不能只是 helper 返回值。它必须成为 durable action payload 或 canonical event payload 的一部分。

建议把它正式命名为：

```text
ResourceCreationPlan
```

结构上类似：

```json
{
  "schema_version": 1,
  "resource_id": "res_...",
  "resource_type": "process|temp_directory",
  "planned_resource": {},
  "cleanup_policy": {},
  "creation_plan": {},
  "effect_fingerprint": "sha256:..."
}
```

并规定：

```text
ResourceCreationPlan MUST be durably written and digest-bound
before external resource creation begins.
```

这可以保留当前 `PlannedResource.cleanup_policy = null`，但不会丢失 cleanup policy 的 replay 能力。

## 3. In-memory cleanup coordination：T3 可接受，cleanup execution 前不可接受

T3 当前只实现了纯规则：

```text
same resource_id + identity_digest + different idempotency key => cleanup_in_progress
```

并且 durable cross-process coordination 被保留到后续与 T2 event/lock layer 集成。

这对 T3 是可以的。

但在真实 cleanup execution 前，必须换成 mission-event-lock 或 resource-level lock 下的 durable attempt acquisition。first-slice contract 要求 cleanup-attempt acquisition 必须 serialized，并且同一 `resource_id + identity_digest` 最多一个 active cleanup attempt。

所以：

```text
T3 pure lifecycle: in-memory acceptable
T4 read-only process inspection: in-memory acceptable
T5/T6 cleanup execution: in-memory not acceptable
```

---

# 五、Known Residual Risks 的处理建议

brief 列出的 residual risks 是真实的，而且没有被掩盖；这一点是好信号。

我的处理建议如下。

## 1. Local-only lock durability

可以接受，但要明确：

```text
Foundation-0 first slice is single-host local-runtime only.
```

不支持 NFS、多主机、多 runtime 并发写同一 mission store。brief 已明确 local-only lock 不声称 distributed semantics。

## 2. Parent-directory fsync deferred

T4 可以接受。
真实 cleanup execution 前不能继续 defer。

brief 说 T2 fsyncs payload and event files，但 parent-directory fsync 和 richer crash recovery 被推迟。

这意味着当前还不能声称完整满足：

```text
external effect MUST NOT happen before durable intent and allowed decision
```

因为文件 fsync 不一定等价于目录项 durable。T4 只读，不产生 destructive side effect，所以可以继续。真实 signal/delete 前必须补。

## 3. Sidecar replay

必须在 T4 之后、任何 resource creation 之前解决。brief 已经承认 sidecar 需要 later event/projection 决定如何 durable store and replay。

我建议不要等到 cleanup execution 才解决；在“创建 temp dir / spawn process”之前就要解决。

## 4. Fake identity

T1–T3 使用 fake but schema-valid identities 是合理的。brief 也明确 T4/T6 才引入真实 macOS process identity 和 temp-directory identity probes。

但 T4 必须处理“probe 不完整”的情况，不能把所有读取失败都误判为 mismatch。

建议 inspector result 使用 union：

```text
ProcessInspectionResult =
  | present_exact
  | absent
  | permission_denied
  | unstable_process_exited_during_probe
  | unsupported_platform
  | partial_identity
```

cleanup 阶段的默认策略应是：

```text
cannot verify exact identity => do not signal
```

---

# 六、对 brief 中 6 个问题的回答

## 1. 当前 staged approach 是否仍然 aligned？

是，aligned。

当前顺序：

```text
schema
-> event append
-> lifecycle
-> process identity
-> cleanup execution
```

是正确顺序。brief 中也明确将 T4 定义为进入更高风险 host process facts 前的下一 gate。

但要守住一条线：

```text
T4 = read-only inspection
cleanup execution = separate later task
```

不要在 T4 顺手加入 signal、kill、cleanup、pkill 或 process group termination。

## 2. `AbandonedResource` branch 是否是 `planned -> abandoned` 且无 external creation 的正确解释？

是。

但必须把它限制为：

```text
external resource was never created
```

而不是泛化成“任何 observed resource 被放弃”。对于已经创建/观察过 identity 的 resource，不应进入 identity-null abandoned branch，而应走：

```text
active/stale -> cleanup_pending -> cleanup_attempted -> cleaned/cleanup_failed
```

或者 conditional closeout。

## 3. Pre-registration sidecar 是否可接受？

T3 阶段可接受。

但在真实 resource creation 前，sidecar 必须变成 durable、replayable、digest-bound 的 creation plan。否则 crash recovery 无法从 canonical event stream 重建：

```text
planned resource
+ cleanup policy
+ intended creation method
+ later cleanup constraints
```

建议新增正式对象：

```text
ResourceCreationPlan
```

而不是把 cleanup policy 塞回 `PlannedResource` 本体。

## 4. Local `O_EXCL` locking 是否足够？

对于 first-slice local runtime，足够。

前提是明确：

```text
not distributed
not multi-host
not NFS-safe
not adversarial lock tamper proof
```

但 cleanup execution 前要补：

```text
parent-directory fsync
stale lock recovery rule
lock holder identity
lock acquisition timeout / failure semantics
```

## 5. T4 是否应严格保持 read-only process inspection？

是，必须严格 read-only。

T4 应只做：

```text
inspect process identity
normalize observed fields
compare against registered/fake identities in tests
protect CLI/self/ancestor/process-group facts
provide injected fake inspector
```

T4 不应做：

```text
SIGTERM
SIGKILL
process group signal
real cleanup
temp directory deletion
broad pkill
```

brief 对 T4 的建议已经是正确的：需要明确 macOS process start-time probe、argv canonicalization、cwd/executable realpath、fake inspector、no real signal、CLI/self protection 等事项。

## 6. 在从 pure primitives 进入 host process identity 前，还有哪些 path-drift 风险？

有，主要是 5 个：

```text
1. canonical storage path drift
2. sidecar durability / replay drift
3. in-memory cleanup coordination drift
4. abandoned verification vocabulary drift
5. spawn_token / process identity probe semantics drift
```

其中最需要立刻处理的是 storage path：brief 的 `<missionDir>/foundation0/runtime-events.jsonl` 与 contract 的 mission-root `runtime-events.jsonl` 必须统一。 

---

# 七、T4 前置要求

我建议允许进入 T4，但 T4 task doc 必须先写清楚以下内容。

## T4 目标边界

```text
T4 implements read-only ProcessIdentity and ProcessInspector abstraction.

T4 MUST NOT send signals.
T4 MUST NOT terminate processes.
T4 MUST NOT cleanup temp directories.
T4 MUST NOT rely on process name or fuzzy command matching.
```

## T4 必须定义的 process identity 字段

contract 中 ProcessIdentity 包含 PID、PGID、OS start time、spawn token、executable、argv、cwd、command digest、dedicated process group。

T4 task doc 至少要明确：

```text
pid source
pgid source
raw process start-time source and precision
ancestor detection source
process-group membership source
executable realpath source
cwd realpath source
argv source and truncation behavior
permission denied behavior
process exits during probe behavior
zombie process behavior
unsupported platform behavior
```

## `spawn_token` 必须改清楚

我建议不要把 `spawn_token` 当成 cleanup-time live probe，除非实现可以可靠地从 live process 中重新读取它。

更合理的是改名为：

```text
spawn_nonce
```

语义为：

```text
runtime spawn provenance nonce
```

cleanup-time live identity 主要依赖：

```text
pid
pgid
raw OS start tuple
executable realpath
cwd realpath
argv / command digest when available
dedicated_process_group marker
```

如果 argv/cwd/executable 不可读取或不稳定，则结果应是：

```text
partial_identity / cannot_verify
```

后续 cleanup 默认不能 signal。

## T4 测试策略

T4 测试必须优先使用 injected fake inspector。brief 已经提出 fake inspector for tests，这是正确要求。

建议测试覆盖：

```text
pid absent
pid reused with different start time
same pid/start but pgid mismatch
executable mismatch
cwd mismatch
argv mismatch or unavailable
permission denied
process exits mid-probe
current CLI pid protected
ancestor pid protected
process group containing CLI protected
unsupported OS returns unsupported, not unsafe success
```

---

# 八、T4 不应被授权做的事

在 T4 阶段不要实现这些：

```text
ProcessKiller
SIGTERM
SIGKILL
process group signal
cleanup attempt durable acquisition
cleanup outcome append
real temp-directory quarantine/delete
closeout cleanup integration
```

这些属于后续 cleanup execution gate。

原因是 first-slice 的 cleanup contract 要求：cleanup action 必须有 ActionRequest、execution-boundary allowed PolicyDecision、durable event ordering、serialized cleanup attempt、identity verification 和 replayable outcome。 

当前 T1–T3 只是为这些能力打地基，还没有完成真实 cleanup execution 所需的全部 durable coordination。

---

# 九、建议给 HQ/Codex 的下一步指令

我建议下一步不是“直接开始 T4 coding”，而是先让 HQ/Codex 写一个 T4 task doc，内容至少包括：

```text
T4: Read-only ProcessIdentity / ProcessInspector Abstraction

Scope:
- read-only process inspection only
- no signal / kill / cleanup
- no temp deletion
- fake inspector first

Decisions required:
- storage path normalization decision
- spawn_token vs spawn_nonce semantics
- exact macOS process probe strategy
- raw start-time representation
- pgid / process group membership probe
- ancestor detection method
- cwd/executable realpath handling
- argv canonicalization and truncation behavior
- permission-denied and process-exit-during-probe behavior
- ProcessInspectionResult union
- CLI/self/ancestor protection data model

Acceptance:
- all T1–T3 tests remain green
- fake inspector tests cover identity match/mismatch
- no test sends real signal
- no implementation path invokes kill, pkill, killall, or process.kill
```

同时开一个小的 T2/T3 follow-up issue：

```text
Foundation-0 path and pre-registration durability follow-up

- choose canonical event path
- align brief / contract / implementation storage layout
- define ResourceCreationPlan sidecar payload
- define abandoned-before-creation verification semantics
- define when in-memory cleanup coordination must be replaced by durable coordination
```

---

# 最终判断

T1–T3 是一个健康的 Phase A。它们坚持了正确的工程纪律：

```text
document-led
schema-first
event-first
pure lifecycle before effects
review-gated
```

brief 所描述的三线程 Codex 工作流也符合项目自己的协作原则：HQ 负责任务和路由，Coder 实现，Reviewer 审查，HQ 再验证、提交和规划下一步。

我的建议是：

```text
Approve T1–T3 as directionally aligned.
Authorize T4 only as read-only ProcessInspector work.
Do not authorize any real signal / cleanup execution yet.
Resolve storage path and sidecar durability before real resource creation.
Resolve durable cleanup-attempt coordination before real cleanup.
```

T4 是可以推进的，但它应该是一道观察边界，不是副作用边界。
