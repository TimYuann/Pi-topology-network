# 启动 Runbook

## 0. 启动前检查

- 明确项目根目录，例如 `/Users/yuantian/Documents/Coding/ekunCustomsWms`。
- 明确 registry，例如 `/tmp/omp-topology-ekunCustomsWms`。
- 所有角色使用同一个 registry 和 project name。
- 启动 prompt 必须包含 `docs/01-shared-communication-policy.md` 的 direct ACK 纪律。

## 1. OMP 五角色启动

已验证 OMP extension 路径：

```text
/Users/yuantian/.omp/agent/experiments/coms-omp
```

本项目保存的源镜像：

```text
sources/cave/pi-vs-claude-code移植/ports/coms-omp
```

示例：

```bash
cd /Users/yuantian/Documents/Coding/<project>
export OMP_COMS_DIR=/tmp/omp-topology-<project>

omp -e /Users/yuantian/.omp/agent/experiments/coms-omp \
  --cname governor \
  --purpose "Owner-facing governor for OMP拓扑网络" \
  --project <project>-topology
```

其他角色把 `--cname` 和 `--purpose` 替换为 `hq`、`oracle`、`repair`、`runner`。

推荐模型路由来自实践记录，可按项目调整：

| 角色 | 模型建议 |
|---|---|
| governor | 高可靠推理模型 |
| oracle | 高可靠推理模型 |
| hq | 长上下文 coding 模型 |
| repair | 长上下文 coding 模型 |
| runner | 长上下文或快速验证模型 |

## 2. OMP 四角色启动

没有 governor 时，owner 直接对 `hq` 下发任务。角色：

```text
hq / oracle / repair / runner
```

适合 smoke、单项目修复、短期实验。

## 3. Pi 兼容启动

Pi 路线当前是本实践的主力 mesh surface。实际启动脚本位于：

```text
/Users/yuantian/Documents/Coding/pi-vs-cc/scripts/launch-pi-topology-ghostty.sh
```

脚本会注入两层 prompt：

```text
--append-system-prompt /Users/yuantian/Documents/Coding/pi-vs-cc/.pi/agents/omp-topology-network/shared-protocol.md
--append-system-prompt /Users/yuantian/Documents/Coding/pi-vs-cc/.pi/agents/omp-topology-network/<role>.md
```

因此几轮纠偏后的强约束必须先落在 Pi harness 的 `.pi/agents/omp-topology-network/`，再同步到本项目 `docs/`。

推荐 5 session 启动：

```bash
cd /Users/yuantian/Documents/Coding/pi-vs-cc
./scripts/launch-pi-topology-ghostty.sh --launch --stagger 2 \
  --workdir /Users/yuantian/Documents/Coding/ekunCustomsWms \
  customs-long
```

推荐 2 session smoke：

```bash
cd /Users/yuantian/Documents/Coding/pi-vs-cc
./scripts/launch-pi-topology-ghostty.sh --launch \
  --workdir /Users/yuantian/Documents/Coding/ekunCustomsWms \
  customs-long hq runner
```

Pi 适合做两类实践：

- 研究型：验证 prompt、角色边界、状态机，不依赖 OMP coding 增强。
- 轻量型：资源受限、需要更透明的 extension 行为时。

## 4. 第一条测试消息

启动后先做最小 ACK smoke：

1. `hq` 调 `coms_list`，确认其他角色 live。
2. `hq` 给 `runner` 发送：`请直接回复 ACK runner: received ack smoke. status=accepted. next=I will wait.`
3. `runner` 收到 inbound 后直接 final 回复，不调用 `coms_send`。
4. `hq` await 原 `msg_id`，确认收到 direct ACK。

## 5. 启动后行为 smoke

启动后不只测 transport，还要测角色行为约束：

Phase D Pi-first smoke：

1. `topology-supervisor` 调 `coms_list`，确认已派生的 `hq / oracle / repair / runner` 可见；未派生角色应在 status board 标为 `not_spawned`，不是失败。
2. `topology-supervisor` 给 HQ 下发最小 mission，HQ 必须 direct ACK，并在同一轮派发或返回 dispatch receipt。
3. HQ 派 Oracle / Runner / Repair 时必须 `coms_send target=oracle|runner|repair`，禁止启动 `subagent oracle` / `subagent runner` / `subagent repair` 代替 persistent peer。
4. Oracle / Runner 完成后必须 `coms_send target=hq` 回传 REPORT，禁止在本 session inline 输出报告正文。
5. 如果 HQ 给 Repair 的 packet 带 `verification_contract`，Repair 可直接 `coms_send target=runner` 发送 `VERIFY_REQUEST repair -> runner`；Runner 仍回 `REPORT runner -> hq`。
6. HQ 收到 Oracle review + Runner report 后必须进入 `merge_or_decide`，然后 `coms_send target=topology-supervisor` 回传 merged report。
7. 本 session 只允许留一行发送摘要，例如 `REPORT sent to topology-supervisor, msg_id=<id>`。

OMP / legacy 五角色 smoke 可继续使用 `governor -> hq -> governor` 归口，但不得用于 Phase D Pi-first 验收口径。

## 6. 2026-06-15 纠偏经验

这几轮实践确认：coms 只解决传输，不自动保证治理。稳定运行需要把行为写成状态机。

经验沉淀：

- ACK 不是完成。`status=accepted` 后，同一轮必须做第一项实际动作。
- top-level final 只用于完成当前 inbound 的最小 ACK / dispatch receipt，不用于输出报告正文。
- 后续 checkpoint / merged report / status board / owner-decision request 必须 `coms_send target=<requester>`。
- `governor / hq / oracle / repair / runner` 是 persistent peers，不是 subagent 名称。
- HQ 收到 Oracle review + Runner report 后的下一步是 `merge_or_decide`，不是 inline 写长报告，也不是自驱扩大 scope。
- Repair 是唯一默认 coder，但只能执行 HQ 明确授权的 scoped fix；默认不 commit / push。
- Runner 只验证，不改代码，不做 scope 决策。
- Oracle 只 review，不修代码，不替 Runner 跑验证。
- Governor 只做 owner-facing 决策翻译和管控，不进入执行层。
- `coms_await` timeout 不是失败；如果目标 live，应标为 ACK pending / async follow-up expected。

## 7. Phase D 首次 8 小时测试 Runbook

Phase D 当前按 Pi-first dynamic spawn 推进。owner 先打开一个 `topology-supervisor` Pi session，和它完成项目状态 intake 与 mission card 对齐；owner 批准后，由 supervisor 派生或恢复 `hq / repair / runner / oracle`。目标是验证协议、packet channel、status board、incident log、damage-control gate、watchdog 和 repair/runner 预授权网状流能否长时间稳定运行。

### 启动前

1. 确认 `scripts/launch-pi-topology-ghostty.sh` preflight 通过。
2. 准备 mission card，至少包含：mission_id、目标、allowed_paths、forbidden_actions、stop conditions、checkpoint interval、spawn policy。
3. 禁止 git add / commit / push，除非 owner 单独授权。
4. 明确 status board / incident log / devlog 的落盘路径。
5. 明确 owner-decision gate：遇到 scope 扩张、破坏性命令、commit/push、需求歧义必须暂停。

### 推荐入口

```bash
cd /Users/yuantian/Documents/Coding/ekunCustomsWms
PI_COMS_DIR=/tmp/pi-topology-customs-long \
pi \
  -e /Users/yuantian/Documents/Coding/pi-vs-cc/extensions/coms.ts \
  -e /Users/yuantian/Documents/Coding/pi-vs-cc/extensions/damage-control-continue.ts \
  -e /Users/yuantian/Documents/Coding/pi-vs-cc/extensions/theme-cycler.ts \
  --cname topology-supervisor \
  --project customs-long \
  --purpose "Owner-facing topology supervisor"
```

如果需要先打印下游角色启动命令：

```bash
cd /Users/yuantian/Documents/Coding/omp-topology-network
scripts/topology-supervisor.sh --print --mission templates/mission-card.phase-d.json hq runner oracle
```

### 睡前检查

- topology-supervisor 已收到 HQ 当前 checkpoint，或 status board 明确记录 pending reason。
- HQ status board 有 active slice / waiting peer / next gate。
- repair 没有 scope 外 diff。
- runner 是正式验证来源。
- oracle 只 review，不改代码。
- no pending owner-decision 被擅自绕过。

### 醒来验收

- 8 小时内每 30-60 分钟有 checkpoint 或明确 pending reason。
- incident log 记录 late / complete_empty / channel_violation / nudge。
- 所有代码变更均在 allowed_paths。
- 没有 git add / commit / push。
- 有 runner verification evidence。
- 有 HQ merged report 和 governor owner-facing summary。
