# 2026-06-14 HS pre-smoke closeout report

## 一、P0 口径校核（核心结论）

1. 这轮所有 **test#1 / test#2 / test#8 / test#10 / test#18** 的 cached replay 均为离线 raw-facts 重放：
   - `fresh_e2e=false`
   - `external_calls: textin/ocr/llm/api = false`
2. **核心 4 case（test#1/#8/#10/#18）当前结论保持 `needs_review`，未变成 passed/auto-close。**
   - `test#1`: 20 行，declaration row 20（17 行有 hs），3 条 `missing_hs_code` + 1 non-merch mix。
   - `test#10`: 7 行，declaration row 7（7 行有 hs），warning：`classification_context_mismatch`。
   - `test#8`: 13 行，declaration row 13（12 行有 hs），warning：`Standard O2 Insert missing_hs` + `multiple currencies` + `non-merchandise mix`。
   - `test#18`: 1 行，declaration row 1（1 行有 hs），warning：`non-merchandise mix`（仅观察链路，不是 full amount merge）。
   - `test#2`：31 行，declaration row 31（22 行有 hs），`missing_hs_code` 与 `classification_context_mismatch` 仍在，单独标记为 **investigate-only（owner 决策）**。
3. **test#18 非完整融合口径已确认：**
   - 本轮输出为 `Wires for GC hoist 2025` 一行（7312100000，qty 5，price 6,167.15），
   - `Article 4902END` 与 `4999994` 在该轮表现为 observation/排除路径（其中 `4999994` 仍是 charge/dummy 类非商品信号），**未按`5917.15 + 6167.15 -> 12084.30` 一次性并单到单行。**
4. **test#8 FCG special-goods 口径已确认：**
   - `multiple currencies` 仍在 warning，且该两行 gas 继续走 special-goods/非 declaration 观察路径；当前不等同于完整 HS 关闭。

## 二、P1 非实现性结论（仅复核结论，不改代码）

### test#1（investigate）
- 结论：`needs_review`，`raw-facts` 行有 3 条 missing hs 及 1 条 non-merch mix，不能直接 fix_now。
- 影响面：`LINE BEARING COVER` 已在 prior implementation 路径标记，仍需 owner 确认 SHINKO 备件归类习惯（8413/8483/7326）后再推进。

### test#2（investigate-only / owner decision）
- 结论：`needs_review`，存在 10 条 warning（多处 `missing_hs_code` 与 `classification_context_mismatch`），不能直接 fix_now。
- 影响面：Frame/PLA card/Spool/Shaft/Plug/Nuts 仍待上游上下文证据确认。

### test#8（investigate）
- 结论：`needs_review`；
  - `declaration_rows=13`，`rows_with_hs=12`
  - qty=44，price=895.84
  - warning 含 `multiple currencies`（GBP/EUR 混币），`Standard O2 Insert` 行仍 missing_hs
- `fix_now`：否（当前仅补齐复核，不宜将该状态上提为自动关闭）。
- 口径：数量/金额/Currency 的差异仍需 owner 复核，不纳入当前 pass 判定。

### test#18（investigate）
- 结论：`needs_review`；
  - `declaration_rows=1`，`rows_with_hs=1`
  - qty=5，price=6167.15
  - warning：非商品行混入（`non_merchandise mix`）
- 必要影响项（impact target）：owner 仅确认后，才进入下一轮实现改动 `supplier-pos amount fusion`。
- `fix_now`：否。

## 三、P2 扩展 cached replay（test#1/#8/#10/#18 + 06-13 lift 挑选样本）

### 3.1 样本与路径
- 复测路径：`artifacts/direct-full-corpus/2026-06-14-hs-pre-smoke-cached-regression/`
- 覆盖用例：`test_1, test_2, test_5, test_8, test_10, test_11, test_14, test_15, test_16, test_18, test_20`
- 前置：
  - `cp knowledge/kb.db /tmp/.../hs.db`
  - `PYTHONPATH=. .venv/bin/python knowledge/seed/seed_super_table_alias.py /tmp/.../hs.db`
  - 使用 `--db-path /tmp/.../hs.db`、`--case-id test#*`
  - 重放时保留 `--summary/--context-ledger-facts` 输入；`test#5/test#16` 走 ledger context

### 3.2 before/after 对照摘要（对比口径：06-13 classification-lift）

| case | before(rows/with_hs) | after(rows/with_hs) | before→after status | warnings | qty | price | fresh | all calls clear |
|---|---|---|---|---:|---:|---:|---|---|
| test#1 | 20/17 | 20/17 | ok→needs_review | 4 | 38 | 11964.48 | false | true |
| test#2 | 31/22 | 31/22 | ok→needs_review | 10 | 74 | 12679.98 | false | true |
| test#5 | 2/2 | 2/2 | ok→needs_review | 1 | 2 | 32572.35 | false | true |
| test#8 | 15/11 | 13/12 | ok→needs_review | 3 | 44 | 895.84 | false | true |
| test#10 | 7/7 | 7/7 | ok→needs_review | 1 | 7 | 31692.78 | false | true |
| test#11 | 3/2 | 3/2 | ok→needs_review | 1 | 6 | 757.60 | false | true |
| test#14 | 7/7 | 7/7 | ok→passed | 0 | 7 | 15340000 | false | true |
| test#15 | 11/8 | 11/8 | ok→needs_review | 3 | 40 | 1349.74 | false | true |
| test#16 | 1/1 | 1/1 | ok→needs_review | 2 | 2 | 349.72 | false | true |
| test#18 | 2/1 | 1/1 | ok→needs_review | 1 | 5 | 6167.15 | false | true |
| test#20 | 2/2 | 2/2 | ok→needs_review | 1 | 3 | 300 | false | true |

- 全部案例均为 `fresh_e2e=false`，且 `external_calls false`。
- positive hit（行中有 hs 增量）为 `test#8`：`+1`。
- 无意回归项（基于 `rows_with_hs` 比较）：**未发现 hs 回归。**

### 3.3 变更文件输出
- `artifacts/direct-full-corpus/2026-06-14-hs-pre-smoke-cached-regression/cached-regression-comparison.json`
- `artifacts/direct-full-corpus/2026-06-14-hs-pre-smoke-cached-regression/cached-regression-comparison.md`
- `artifacts/direct-full-corpus/2026-06-14-hs-pre-smoke-cached-regression/test_*/*`

## 四、P3 主报告（交付项）

### 4.1 变更文件
- `docs/cowork/reports/2026-06-14-hs-human-review-followup-plan.md`（口径同步）
- `docs/cowork/reports/2026-06-14-hs-followup-implementation-report.md`（closeout/样本覆盖口径补充）
- `docs/PROGRESS.md`（进度补充）
- `docs/cowork/reports/2026-06-14-hs-pre-smoke-closeout-report.md`（本报告）
- `artifacts/direct-full-corpus/2026-06-14-hs-pre-smoke-cached-regression/`（本次新增 evidence）

### 4.2 命令与验证

#### 关键命令
1. `env PYTHONPATH=. .venv/bin/python knowledge/scripts/check_harness_consistency.py`
2. `python - << ... json.load(...) ...`（三份 seed json valid）
3. `PYTHONPATH=. .venv/bin/python -m pytest -q knowledge/tests/test_hs_followup_seed_aliases.py knowledge/tests/test_direct_item_ledger_adapter.py knowledge/tests/test_kb_hygiene_runtime.py`
4. `PYTHONPATH=. .venv/bin/python -m pytest -q knowledge/tests/test_direct_raw_facts_declaration_harness.py`
5. `env PYTHONPATH=. .venv/bin/python knowledge/seed/seed_super_table_alias.py "$DB"`
6. `env PYTHONPATH=. .venv/bin/python knowledge/scripts/run_direct_raw_facts_declaration_harness.py ... --case-id test#* ...`

#### 验证结果
- `harness consistency`：PASS（29 entrypoints / 7 doc links）
- 3 个 seed json：PASS
- 焦点测试：**78 passed**（含 `test_hs_followup_seed_aliases` 等）
- replay harness 测试：**3 passed**
- cached replay：**11** cases completed（全部 fresh_e2e=false，外部调用 false）

### 4.3 风险与阻塞（owner 决策清单）
- Fresh Direct Smoke verdict: **Conditional GO only after owner accepts cached needs_review baseline and current open-items; do not start smoke yet**。
- 非 fresh 前置工作已完成，今天 pre-smoke completion 可判定为约 **80%-90%**。
- `ready_for_fresh_smoke = false`（尚有 4 个核心 case `needs_review`）。
- `owner_decision_needed`：
  - test#8：`Standard O2 Insert` 与多币种口径闭合（是否接受 current qty/price split）
  - test#18：是否允许下轮在 core 实现 supplier-pos amount fusion（full amount）
  - test#1：`SHINKO` 与希腊件 family 差异的人工归类确认
  - test#2：`investigate-only owner decision`，`missing_hs_code` 与 `classification_context_mismatch` 的上游分类证据确认

### 4.4 当前工作区与提交流程边界说明
- `git status -sb` 当前关键项：
  - `M docs/PROGRESS.md`
  - `M docs/cowork/reports/2026-06-14-hs-followup-implementation-report.md`
  - `M docs/cowork/reports/2026-06-14-hs-human-review-followup-plan.md`
  - `M frontend/css/ekun.css`
  - `M frontend/ekun-analysis.html`
  - `M frontend/js/ekun.js`
  - `?? handoff/`
  - `?? review/`
- 其中 `frontend` 前缀的 chat composer 改动与 HS pre-smoke 无关，**必须与本报告建议提交范围隔离**。
- 本轮 closeout 为文档收口与结论更新，**未执行 git add/commit/push**；本报告未要求“本轮全部历史未提交”。
- `b1349bc3` 为上一阶段 HS seed batch 的既有提交，不等同于本轮动作。

### 4.5 主命令列表（structured acceptance report）
```json
{
  "commands": [
    "env PYTHONPATH=. .venv/bin/python knowledge/scripts/check_harness_consistency.py",
    "python - << 'PY' ... json.load(seed json) ... PY",
    "PYTHONPATH=. .venv/bin/python -m pytest -q knowledge/tests/test_hs_followup_seed_aliases.py knowledge/tests/test_direct_item_ledger_adapter.py knowledge/tests/test_kb_hygiene_runtime.py",
    "PYTHONPATH=. .venv/bin/python -m pytest -q knowledge/tests/test_direct_raw_facts_declaration_harness.py",
    "env PYTHONPATH=. .venv/bin/python knowledge/seed/seed_super_table_alias.py "$DB"",
    "env PYTHONPATH=. .venv/bin/python knowledge/scripts/run_direct_raw_facts_declaration_harness.py --case-id ...",
    "python - << 'PY' ... compare cached-regression-comparison.json ... PY"
  ],
  "verification": {
    "harness_consistency": {"status": "passed", "entrypoints": 29, "doc_links": 7},
    "seed_json_validity": {"status": "passed", "files": [
      "knowledge/seed/super_table_alias_seed.json",
      "knowledge/seed/super_table_alias_disabled_seed.json",
      "knowledge/seed/non_merchandise_filter_seed.json"
    ]},
    "focused_pytest": {"status": "passed", "count": 78},
    "regression_pytest": {"status": "passed", "count": 3},
    "cached_replay": {
      "status": "completed",
      "artifact_root": "artifacts/direct-full-corpus/2026-06-14-hs-pre-smoke-cached-regression",
      "case_count": 11,
      "fresh_e2e": false,
      "external_calls_clear": true
    }
  },
  "changed_files": [
    "docs/cowork/reports/2026-06-14-hs-human-review-followup-plan.md",
    "docs/cowork/reports/2026-06-14-hs-followup-implementation-report.md",
    "docs/PROGRESS.md",
    "docs/cowork/reports/2026-06-14-hs-pre-smoke-closeout-report.md",
    "artifacts/direct-full-corpus/2026-06-14-hs-pre-smoke-cached-regression/cached-regression-comparison.json",
    "artifacts/direct-full-corpus/2026-06-14-hs-pre-smoke-cached-regression/cached-regression-comparison.md",
    "artifacts/direct-full-corpus/2026-06-14-hs-pre-smoke-cached-regression/test_*/"
  ],
  "ready_for_fresh_smoke": false,
  "fresh_smoke_verdict": "Conditional GO only after owner accepts cached needs_review baseline and current open-items; do not start smoke yet",
  "pre_smoke_completion": "80%-90% (fresh前置工作已完成)",
  "owner_decision_needed": [
    "test#8 O2 Insert 与多币种 price/currency 口径确认",
    "test#18 supplier-pos amount fusion 与 exclusion policy 审批",
    "test#1 SHINKO 与希腊件 family 差异的人工归类确认",
    "test#2 investigate-only owner decision（missing_hs / classification_context_mismatch）"
  ]
}
```