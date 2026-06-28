# Sonnet
读完这份导读，我想从几个我认为真正有意思的地方谈谈看法。

---

## 核心判断：这个项目在解决一个真实的结构性问题

大多数 multi-agent 讨论停在"怎么让 agent 更聪明"或"怎么让 agent 之间能对话"。Pi拓扑网络跳过了这两个问题，直接问了第三个：**协作秩序本身怎么设计**。

这个切入点我认为是对的。真实系统里，agent 的单点能力往往不是瓶颈，瓶颈在于：谁有权做什么、谁的输出可以被信任、谁来收尾、出错了谁负责。这些问题不解决，堆再多 agent 只会放大混乱。

---

## 我认为最有价值的三个设计判断

**第一，信息流和权力流分离。**

"信息可以 mesh，授权必须收口"——这句话我觉得是整个文档最核心的一句。它在结构上对应的是一个常见的工程直觉：读权限可以广播，写权限必须收窄。把这个原则引入 agent 协作层，是相当清醒的。否则的话，横向角色互传消息很容易演变成隐式授权，然后 scope 就开始漂移，没有人说得清楚"这个决定是谁做的"。

**第二，ACK 和业务报告分离。**

这个设计解决了一个异步协作里非常实际的问题：上游不知道下游"收到了"还是"做完了"，于是只好等，等变成阻塞，阻塞把异步协作退化成串行。把 lifecycle ACK 从 business report 里切出来，让"我已经接手"和"我已经完成"成为两个独立信号，这是协议设计里很基础但很容易被忽略的事。

**第三，artifact-first。**

长报告不进主通道，主通道只传摘要和引用。这不只是性能问题，更是上下文污染的问题。一个 agent 如果把 500 行测试输出塞回主会话，后续所有角色的上下文窗口都被这个噪声占掉了。artifact-first 是把"产出物"和"协作信道"显式分开，这个分离在我看来是长期可维护性的基础。

---

## 我有疑问的地方

**软约束和硬约束的边界还没有稳定。**

文档里提到了这个问题，但我觉得它比文档描述的更难。软约束（prompt、角色说明、计划文档）能塑造意图，但 agent 在上下文漂移或任务歧义时会偏离。硬约束（tool guard、路径权限、schema 校验）能卡住边界，但硬约束写死了就缺乏灵活性，写活了就又退化成软约束。

真正的问题是：**这两层之间谁来仲裁？** 当软约束说"可以"、硬约束说"不行"，这个冲突怎么处理？当软约束说"不行"但硬约束没有拦截，谁来发现并记录这次越权？我认为这个仲裁层目前在设计里还是空白的，或者说它被默认交给了 supervisor，但 supervisor 自己能不能被软约束绕过，这个问题没有闭合。

**oracle 的独立性如何保证？**

文档里 oracle 定位为"独立审查者，不被执行链污染"。这个角色在概念上非常重要，但独立性的保证机制是什么？如果 oracle 和 hq 共享上下文，或者 oracle 的输入来自 hq 整理过的报告，那独立性实际上已经被破坏了。独立审查在人类组织里是通过物理隔离和信息防火墙来保证的，在 agent 系统里对应的机制需要更明确。

---

## 一个值得讨论的底层张力

这个项目的目标状态是："owner 只需要描述目标，不需要手动追每个 agent。"

这个目标和"权力必须纵向收口"之间存在一个张力：**收口越严，owner 越需要手动介入；收口越松，系统越容易失控。**

Pi拓扑网络现在的设计倾向是：让 supervisor 代替 owner 做大部分收口工作。这个设计是合理的，但它意味着 supervisor 本身的可信度变得极其关键。supervisor 如果出错，整个系统没有自愈能力。

所以我会问：**系统对 supervisor 自身的约束是什么？** 谁来审查 supervisor？目前看来这个角色是被排除在审查链之外的，这可能是下一个需要讨论的结构性问题。

---

## 总结

Pi拓扑网络在我看来不是在做一个"更强的 agent"，而是在做一个"让 agent 能被约束地工作的环境"。这个方向我认为比大多数 multi-agent 项目更务实。它最有价值的地方是把协作里的隐性问题（谁有权、谁收尾、谁审查）显式化，并试图把它们变成可以运行时检查的规则。

目前最值得深入讨论的，我认为是 oracle 独立性的保证机制，以及软硬约束冲突时的仲裁逻辑。这两个问题如果没有闭合，整个秩序模型的可靠性是有上限的。

# Gemini
读完这份导读，我想从几个我认为真正有意思的地方谈谈看法。

---

## 核心判断：这个项目在解决一个真实的结构性问题

大多数 multi-agent 讨论停在"怎么让 agent 更聪明"或"怎么让 agent 之间能对话"。Pi拓扑网络跳过了这两个问题，直接问了第三个：**协作秩序本身怎么设计**。

这个切入点我认为是对的。真实系统里，agent 的单点能力往往不是瓶颈，瓶颈在于：谁有权做什么、谁的输出可以被信任、谁来收尾、出错了谁负责。这些问题不解决，堆再多 agent 只会放大混乱。

---

## 我认为最有价值的三个设计判断

**第一，信息流和权力流分离。**

"信息可以 mesh，授权必须收口"——这句话我觉得是整个文档最核心的一句。它在结构上对应的是一个常见的工程直觉：读权限可以广播，写权限必须收窄。把这个原则引入 agent 协作层，是相当清醒的。否则的话，横向角色互传消息很容易演变成隐式授权，然后 scope 就开始漂移，没有人说得清楚"这个决定是谁做的"。

**第二，ACK 和业务报告分离。**

这个设计解决了一个异步协作里非常实际的问题：上游不知道下游"收到了"还是"做完了"，于是只好等，等变成阻塞，阻塞把异步协作退化成串行。把 lifecycle ACK 从 business report 里切出来，让"我已经接手"和"我已经完成"成为两个独立信号，这是协议设计里很基础但很容易被忽略的事。

**第三，artifact-first。**

长报告不进主通道，主通道只传摘要和引用。这不只是性能问题，更是上下文污染的问题。一个 agent 如果把 500 行测试输出塞回主会话，后续所有角色的上下文窗口都被这个噪声占掉了。artifact-first 是把"产出物"和"协作信道"显式分开，这个分离在我看来是长期可维护性的基础。

---

## 我有疑问的地方

**软约束和硬约束的边界还没有稳定。**

文档里提到了这个问题，但我觉得它比文档描述的更难。软约束（prompt、角色说明、计划文档）能塑造意图，但 agent 在上下文漂移或任务歧义时会偏离。硬约束（tool guard、路径权限、schema 校验）能卡住边界，但硬约束写死了就缺乏灵活性，写活了就又退化成软约束。

真正的问题是：**这两层之间谁来仲裁？** 当软约束说"可以"、硬约束说"不行"，这个冲突怎么处理？当软约束说"不行"但硬约束没有拦截，谁来发现并记录这次越权？我认为这个仲裁层目前在设计里还是空白的，或者说它被默认交给了 supervisor，但 supervisor 自己能不能被软约束绕过，这个问题没有闭合。

**oracle 的独立性如何保证？**

文档里 oracle 定位为"独立审查者，不被执行链污染"。这个角色在概念上非常重要，但独立性的保证机制是什么？如果 oracle 和 hq 共享上下文，或者 oracle 的输入来自 hq 整理过的报告，那独立性实际上已经被破坏了。独立审查在人类组织里是通过物理隔离和信息防火墙来保证的，在 agent 系统里对应的机制需要更明确。

---

## 一个值得讨论的底层张力

这个项目的目标状态是："owner 只需要描述目标，不需要手动追每个 agent。"

这个目标和"权力必须纵向收口"之间存在一个张力：**收口越严，owner 越需要手动介入；收口越松，系统越容易失控。**

Pi拓扑网络现在的设计倾向是：让 supervisor 代替 owner 做大部分收口工作。这个设计是合理的，但它意味着 supervisor 本身的可信度变得极其关键。supervisor 如果出错，整个系统没有自愈能力。

所以我会问：**系统对 supervisor 自身的约束是什么？** 谁来审查 supervisor？目前看来这个角色是被排除在审查链之外的，这可能是下一个需要讨论的结构性问题。

---

## 总结

Pi拓扑网络在我看来不是在做一个"更强的 agent"，而是在做一个"让 agent 能被约束地工作的环境"。这个方向我认为比大多数 multi-agent 项目更务实。它最有价值的地方是把协作里的隐性问题（谁有权、谁收尾、谁审查）显式化，并试图把它们变成可以运行时检查的规则。

目前最值得深入讨论的，我认为是 oracle 独立性的保证机制，以及软硬约束冲突时的仲裁逻辑。这两个问题如果没有闭合，整个秩序模型的可靠性是有上限的。

# GPT 5.5pro

## 总体判断

我认为，Pi 拓扑网络的核心不是“让多个 Agent 同时工作”，而是**把多 Agent 协作从一种临时的对话行为，提升为一种可治理、可审计、可恢复的运行制度**。

换句话说，它不是一个普通的多 Agent 聊天框架，而更接近一个 **Agent 协作控制平面**，或者文档所说的“多 Agent 项目操作系统”：管理角色、权限、状态、证据、路由和生命周期，而不是单纯优化 prompt。

我会把它的核心公式概括为：

> **可信多 Agent 协作 = 可控授权 × 单一变更权 × 独立证据 × 可重放状态 × 可回收资源**

这里是乘法关系：任何一项失效，整个协作结果都不再可靠。

---

## 一、最核心的逻辑是“信息流”和“权力流”分离

文档中的这句话是整个项目最重要的设计判断：

> 信息可以横向流动，权力必须纵向收口。

Agent 之间可以自由交换发现、证据、风险、测试结果和建议，但这些信息不能天然转化为授权。一个 Agent 告诉另一个 Agent“你应该修这个问题”，不等于它有权扩大后者的修改范围。

因此系统中实际存在两张不同的网络：

* **信息网络**是 mesh：允许高效横向交换。
* **权力网络**是 hierarchy：授权、scope、预算、终止条件和最终 verdict 必须有明确来源。

这是一个正确而且非常关键的抽象。很多多 Agent 系统的问题，不是通信能力不足，而是把“消息到达”误当成了“权限授予”。

但这一原则不能只写在 prompt 中，必须落实成运行时对象，例如：

* authorization_id
* granted_by
* capability
* scope
* resource_limit
* expires_at
* revocation_state

否则所谓“中心化权力”最终仍然只是角色自觉，而不是系统约束。文档已经意识到软约束和硬约束的区别，下一步应当把这一点正式化。

---

## 二、第二条核心逻辑是“执行权”和“证明权”分离

`single-writer implementation + independent review` 是这个项目比一般 Agent 编排方案更成熟的地方。

它本质上是在防止两个问题：

1. 多个 Agent 同时修改同一事实源，产生冲突和责任不清。
2. 修改者自己证明自己的修改正确，导致证据链失去独立性。

因此：

* repair 或实现者负责改变系统状态。
* runner 负责产生验证证据。
* oracle 负责评价证据是否足够。
* hq 或 supervisor 负责阶段决策和合并。

角色名称未来可以变化，但这几个职责必须保持逻辑隔离。文档中明确要求审查者、修复者和测试者职责分离，正是为了避免独立性被执行链污染。

这里需要进一步明确的是：**single writer 的粒度是什么**。

它可能是：

* 整个 repository 单写者；
* 一个 mission 单写者；
* 一个 branch/worktree 单写者；
* 一个文件或资源单写者；
* 一个阶段内单写者。

我更建议采用“**资源写租约**”模型，而不是永久固定某个角色为唯一写者：

```text
mission A
  └── write lease
      ├── holder: repair-03
      ├── resource: worktree-A
      ├── scope: src/auth/**
      ├── revision_base: abc123
      ├── expires_at: ...
      └── revoked: false
```

这样既保留单写原则，也允许不同 mission 在隔离资源上并发。

---

## 三、Mission 应当成为系统的一致性边界

当前设计已经以 Mission 保存目标、状态、事件、证据和 closeout。

从架构角度看，Mission 不应只是一张任务卡，而应当是整个系统的**审计根和一致性边界**。所有重要对象都应能追溯到一个 mission：

```text
mission
├── authorization
├── role instances
├── messages
├── state transitions
├── tool calls
├── artifacts
├── processes
├── workspaces
├── tests
├── verdicts
└── cleanup records
```

一个动作如果没有 `mission_id`，原则上就不应该产生持久副作用。

一个较完整的运行事件至少应包含：

```text
event_id
mission_id
actor_id
actor_role
event_type
correlation_id
causation_id
authorization_id
resource_id
sequence
timestamp
payload_ref
```

其中：

* `correlation_id` 表示它属于哪一次请求链。
* `causation_id` 表示是哪一个事件直接触发了它。
* `authorization_id` 证明它为什么有权执行。
* `sequence` 用于检测乱序、重复和恢复问题。
* `payload_ref` 指向 artifact，避免长内容进入主消息通道。

如果继续使用文件和 JSONL，我建议明确采用“**追加事件日志 + 派生状态视图**”的模型：日志只追加，当前 mission 状态由事件重放得到，而不是让多个角色共同修改一个可变 JSON 对象。这样更容易处理崩溃恢复、审计和状态分歧。

---

## 四、ACK 与 REPORT 分离是必要的，但还需要完整的消息语义

文档提出将 lifecycle ACK 与业务报告分开，这是解决通道阻塞的正确方向。ACK 快速确认请求已经进入生命周期，长结果通过 packet 和 artifact 异步返回。

这里最重要的一点是：

> **ACK 不能代表任务成功，只能代表某个生命周期事实已经成立。**

建议至少区分：

```text
RECEIVED     消息已接收
ACCEPTED     已验证授权和范围，决定执行
STARTED      已开始执行
PROGRESS     中间状态
REPORT       业务结果
FAILED       执行失败
CANCELLED    已取消
CLOSED       上游完成验收并关闭
```

同时，不要追求抽象上的 exactly-once delivery。更现实的模型是：

> **至少一次投递 + 幂等消费 + 去重记录**

每一个可重试请求都应有稳定的 `request_id` 或 `idempotency_key`。接收方如果看到重复消息，应返回之前的 ACK 或 REPORT，而不是再次执行副作用。

除此之外还需要：

* deadline 与超时语义；
* cancellation 传播；
* stale message 判断；
* retry policy；
* backpressure；
* dead-letter 状态；
* reply_target；
* schema version；
* artifact availability 状态。

否则 ACK/REPORT 分离只解决了“长输出阻塞”，还没有完全解决可靠分布式通信的问题。

---

## 五、角色应该是能力组合，而不应成为架构本体

`supervisor`、`hq`、`oracle`、`repair`、`runner` 是清晰且实用的初始角色模型。长驻角色维持秩序，短生命周期 Agent 提供局部吞吐，这一分层是合理的。

但从长期演进看，应避免把角色名称硬编码成系统能力。

更稳定的抽象应该是 capability：

```text
create_mission
grant_scope
spawn_actor
read_workspace
mutate_workspace
run_validation
publish_evidence
issue_review
issue_verdict
merge_change
terminate_process
close_mission
```

角色只是 capability 的预设组合：

```text
repair = read_workspace + mutate_workspace
runner = read_workspace + run_validation + publish_evidence
oracle = read_artifact + issue_review
hq = decompose_work + grant_limited_scope + merge_change
```

这样做有三个好处：

1. 新增角色时不需要修改核心协议。
2. 同一角色可以在不同 mission 中得到不同权限。
3. 硬约束可以直接检查 capability，而不是依赖角色名称和 prompt。

因此，长期看应该是：

> **capability-first，role-as-profile**

而不是 role-first。

---

## 六、“中心权威”必须避免变成“中心瓶颈”

中心化授权是合理的，但中心化所有决策会产生新的问题：

* supervisor 成为消息瓶颈；
* owner 被迫处理大量低风险决策；
* Agent 虽然并行运行，实际却排队等待授权；
* 中心节点故障导致 mission 无法推进。

解决办法不是取消中心权威，而是采用**受限委托**：

```text
owner
  └── grants mission authority to supervisor
        └── delegates bounded scope to hq
              └── issues temporary write lease to repair
```

每层委托都必须：

* 不超过上级权限；
* 明确 scope；
* 明确有效期；
* 明确预算；
* 可撤销；
* 可审计；
* 不包含最终 owner verdict，除非明确授权。

Owner gate 也应采用风险分级，而不是所有动作都人工确认。例如：

* 可逆、局部、低成本动作：自动执行。
* 扩大 scope、删除资源、外部发布、生产变更：必须 gate。
* mission closeout：依据风险等级决定 owner 是否必须参与。

这样才能做到“权力收口”而不牺牲吞吐。

---

## 七、进程所有权应扩展成通用资源所有权

Ghostty 多窗口、Dock 图标和残留进程，本质上不是终端问题，而是资源生命周期没有完全进入协议。文档对此判断是准确的：系统应知道实例属于哪个 mission、由谁启动、应由谁关闭以及何时可以安全终止。

但我建议不要只实现 process ledger，而是直接抽象成 **resource ledger**：

```text
resource_id
resource_type
mission_id
created_by
owned_by
backend
external_identifier
cleanup_policy
cleanup_owner
lease_expires_at
status
```

资源类型可以包括：

* process
* terminal window
* worktree
* branch
* temp directory
* lock
* port
* test server
* container
* artifact
* external session

这样 cleanup 就不再是“测试结束后杀进程”，而是：

> mission 关闭时，对全部已登记资源执行分类型、可验证、可重试的回收流程。

同时必须明确：

* 只能清理本 mission 创建或明确接管的资源；
* 不允许仅凭进程名或命令行模糊匹配进行终止；
* cleanup 本身也要生成证据；
* 清理失败不能伪装成 mission 已完全关闭。

Ghostty 应只是一个 launcher backend，而不是协议架构的一部分。未来可以替换为 tmux、PTY、容器或远程执行器，而不改变上层 mission 与角色协议。

---

## 八、artifact-first 是正确方向，但要防止形成“证据垃圾场”

长报告和测试输出优先写入 artifact，主通道只传摘要和引用，是降低上下文污染和通信延迟的正确办法。目标状态中也明确要求所有长报告、测试输出、消息、事件和证据具有 mission 归属。

但 artifact-first 需要配套以下语义：

* artifact 类型；
* 创建者；
* 来源事件；
* 内容摘要或哈希；
* 不可变版本；
* supersedes 关系；
* retention policy；
* 是否属于 evidence；
* 是否已被 reviewer 消费；
* 是否可以安全删除。

特别要区分：

```text
working artifact   中间工作产物，可被替代
evidence artifact  用于结论的证据，应保持不可变
decision artifact  记录 verdict 和依据
```

否则长期运行后会产生大量文件，但无法判断哪个版本支撑了最终结论。

---

## 九、我认为项目最需要守住的七条系统不变量

不变量比角色 prompt、终端布局和消息文案更重要。建议首先明确以下七条：

1. **所有产生副作用的动作都有可验证授权。**
2. **同一受控资源在同一时间只有一个有效写者。**
3. **执行者不能独立签发自己工作的最终通过结论。**
4. **ACK 只表示生命周期状态，不表示业务完成。**
5. **所有事件、消息、证据和资源都必须归属于 mission。**
6. **Peer 消息不能隐式扩大权限或 scope。**
7. **系统创建的资源必须具备明确 owner 和回收策略。**

只要这七条在 runtime 中被强制执行，具体角色、UI、模型和终端后端都可以迭代变化。

反过来，如果这七条主要依靠 prompt 约定，那么系统仍然是“角色扮演式协作”，而不是可靠运行时。

---

## 十、我建议的实施优先级

第一阶段不应急于增加更多角色或改造所有启动方式，而应先固定协议不变量：

```text
Mission state machine
→ capability / authorization
→ append-only event model
→ idempotent messaging
→ write lease
→ evidence provenance
→ resource ledger
```

第二阶段再补可靠性机制：

```text
timeout
retry
dedupe
cancellation
backpressure
crash recovery
stale detection
```

第三阶段才是体验和后端：

```text
Ghostty backend abstraction
mission dashboard
artifact browser
process cleanup UI
alternative launchers
```

这样可以避免把大量工程投入在可见但非核心的问题上。

---

## 结论

我认可这个项目的核心方向。它最有价值的地方，不是提出了 supervisor、oracle、repair 等角色，而是识别出：

> 多 Agent 的主要难题不是能力不足，而是授权、状态、证据和生命周期缺乏制度化边界。

下一步最重要的转变，是从：

> “为不同角色制定更清楚的协作规范”

进一步走向：

> “把协作规范表达为 runtime 可检查、可拒绝、可恢复的系统不变量”。

一旦完成这一转变，Pi 拓扑网络就不只是某套 Agent 工作流，而会成为一个真正可复用的多 Agent 协作内核。
