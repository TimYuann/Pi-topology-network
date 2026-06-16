# 2026-06-14 HS fresh smoke final closeout

## 1. Executive summary

本轮 HS Code 分类优化 fresh smoke + repair loop 已收口。

范围：三批 9 个原始 case，外加一次 test#36 corrected-input evidence。

结论：
- 8 个原始 case 达到 `ACCEPTABLE_NEEDS_REVIEW`。
- test#36 原 primary PDF 保持 `HARD_FAIL_OWNER_BLOCKING_INPUT`：输入是 AWB-only，不是 pipeline regression。
- test#36 corrected-input 使用 supporting-03 签单 fresh 跑通，作为 corrected input evidence；不覆盖原 primary hard fail。
- 本轮不建议进入第四批；建议进入 commit planning / 总 review。

所有 `needs_review` 均不得标为 full passed。

## 2. Case verdict table

| Batch | Case | Fresh job | Input | Rows | Amount | Verdict | Notes |
|---|---|---:|---|---:|---:|---|---|
| 1 | test#10 | `74a86b1fb5f3` | `test-10-invoice-EVER-FOCUS签单.pdf` | 8 | 72237.36 | `ACCEPTABLE_NEEDS_REVIEW` | qty 12.002; validation `needs_review`; MOUNT ADAPTER -> `8517799000`; 8529 P0 closed |
| 1 | test#14 | `7ecaf331da30` | `test-14-invoice-EVER-LUCENT-full.pdf` | 7 | 15340000.00 | `ACCEPTABLE_NEEDS_REVIEW` | AIS 360,000 parent row recovered; JPY total closed |
| 1 | test#25-1 | `7c07b55fe060` | `test-25-1-invoice-SEAWIND-99435530972.pdf` | 8 | 519.10 | `ACCEPTABLE_NEEDS_REVIEW` | Summary/packing not mixed; 2 missing-HS rows remain |
| 2 | test#18 | `3c6c679dded8` | `test-18-invoice-TUJU ARROW签单2.pdf` | 1 | 7092.22 | `ACCEPTABLE_NEEDS_REVIEW` | Article 4902END demoted to observation; wire rope retained |
| 2 | test#1 | `ad4dd5a2115f` | `test#1-fullOlder.pdf` | 20 | 11880.48 | `ACCEPTABLE_NEEDS_REVIEW` | LINE BEARING COVER stays `8482990000`; SHINKO split auditable |
| 2 | test#29 | `a3b04c315ed3` | `test-29-invoice-EVER-FRANK签单.pdf` | 8 | 24017.46 | `ACCEPTABLE_NEEDS_REVIEW` | MOUNT ADAPTER -> `8517799000`; no 8529 |
| 3 | test#25-2 | `91ccb728efd0` | `test-25-2-invoice-SEAWIND-99435574070.pdf` | 2 | 881.13 | `ACCEPTABLE_NEEDS_REVIEW` | Summary/shipment excluded; amount delta is auditable, not closed |
| 3 | test#35 | `8e9d12b48c05` | `test-35-invoice-MERLIN-ARROW-99435700431.pdf` | 1 | 350.00 | `ACCEPTABLE_NEEDS_REVIEW` | LOW candidate not adopted; final HS empty |
| 3 | test#36 original | `79a7745ff4fb` | `test-36-invoice-SWIFT-GALAXY-32404841056.pdf` | 0 | 0.00 | `HARD_FAIL_OWNER_BLOCKING_INPUT` | Primary file is AWB-only |
| corrected evidence | test#36 corrected-input | `fa0cc203361e` | `test-36-supporting-03-SWIFT GALAXY-签单.pdf` | 35 | 4701900.00 | `CORRECTED_INPUT_NEEDS_REVIEW` | CI/PL extracted; qty matches sidecar; row merge/currency remain review |

Artifact roots: each fresh job uses `artifacts/pipeline/<job_id>/`; job summaries use `artifacts/pipeline/job_<job_id>.json`.

## 3. Repairs made

### `knowledge/core/direct_textin_item_extraction.py`

Root cause: test#14 TextIn/JRC table contained AIS parent priced row, but LLM skipped it. Amount JPY 360,000 was missing.

Change:
- Added deterministic priced parent row salvage.
- Scoped to observed JRC/Japan/JPY layout only.
- Does not write HS.
- Does not touch classification core.
- Does not relax LOW adoption gate.
- Filters summary-like rows: PACKING, FREIGHT, INSURANCE, DISCOUNT, HANDLING, TOTAL, DETAILS AS PER ATTACHED SHEET.

### `knowledge/core/direct_item_ledger_adapter.py`

Root cause: test#18 identifier-only Article row had quantity/amount but no goods description; adapter accepted it as declaration candidate.

Change:
- Demote identifier-only Article/ArticleNo/Material/StockNo/Pos rows to observation.
- Demote freight-charge context rows to non-merch observation.
- Preserve real goods rows such as Wires for GC hoist 2025.
- No HS hardcoding.
- No LOW gate change.
- No frontend composer touch.

### Tests

- `knowledge/tests/test_direct_llm_pipeline_optin.py`
  - AIS parent positive.
  - AIS child negative.
  - existing LLM priced row no duplicate.
  - numeric normalization.
  - summary/freight/packing negative.

- `knowledge/tests/test_direct_item_ledger_adapter.py`
  - Article 4902END identifier-only variants.
  - Article position / missing-description variants.
  - freight-charge context negative.
  - Wires for GC hoist positive.

## 4. Runtime / DB / cache actions

Performed under owner authorization:
- Runtime `knowledge/kb.db` seed alignment using existing table-driven seed replay.
- SQLite backup before replay: `knowledge/kb.before-hs-test10-seed-align-20260614-184350.db`.
- Exact cache invalidations only for current case PDF hash + pipeline version when fresh rerun was needed.
- Multiple local FastAPI 8765 restarts to load current code and avoid stale runtime / broken pipe behavior.

Not recommended for code/test commit:
- `knowledge/kb.db`
- DB backup file
- runtime cache/artifacts

## 5. Verification commands and results

Final required commands:

```bash
PYTHONPATH=. .venv/bin/python -m pytest -q knowledge/tests/test_direct_item_ledger_adapter.py knowledge/tests/test_direct_llm_pipeline_optin.py
```

Result: `80 passed, 9 warnings in 1.57s`.

```bash
PYTHONPATH=. .venv/bin/python -m py_compile \
  knowledge/core/direct_item_ledger_adapter.py \
  knowledge/core/direct_textin_item_extraction.py
```

Result: passed.

```bash
PYTHONPATH=. .venv/bin/python knowledge/scripts/check_harness_consistency.py
```

Result: `PASSED: 29 entrypoints checked, 7 doc links checked`.

```bash
git status -sb
git diff --stat
git diff --name-only
```

Result: staged 0, unstaged 8, untracked 7; `git diff --stat: 8 tracked files +541 -6`.

## 6. Remaining owner decisions

1. Whether to update dataset manifest so test#36 corrected CI/PL (`supporting-03`) becomes the official primary input.
2. Whether to table-drive the current scoped `freight_charge_context` adapter rule into non-merch seed support for `evidence_text`.
3. Whether to split commits:
   - code/test repair commit;
   - docs/report commit;
   - runtime DB/seed/cache decision separately.
4. Whether to accept `ACCEPTABLE_NEEDS_REVIEW` cases as sufficient for this round.

## 7. Git boundary

Current dirty buckets:

### Candidate code/test commit

- `knowledge/core/direct_item_ledger_adapter.py`
- `knowledge/core/direct_textin_item_extraction.py`
- `knowledge/tests/test_direct_item_ledger_adapter.py`
- `knowledge/tests/test_direct_llm_pipeline_optin.py`

### Candidate docs commit

- `docs/cowork/reports/2026-06-14-hs-fresh-smoke-final-closeout.md`
- `docs/PROGRESS.md`
- Existing 06-14 HS reports if owner wants them in same docs commit.

### Not-to-commit by default

- `knowledge/kb.db`
- `knowledge/kb.before-hs-test10-seed-align-20260614-184350.db`
- runtime cache artifacts
- `handoff/`
- `review/`
- unrelated `docs/superpowers/plans/*`

## 8. Suggested commit scope

Recommended first commit:

```text
knowledge/core/direct_item_ledger_adapter.py
knowledge/core/direct_textin_item_extraction.py
knowledge/tests/test_direct_item_ledger_adapter.py
knowledge/tests/test_direct_llm_pipeline_optin.py
```

Recommended second docs commit:

```text
docs/cowork/reports/2026-06-14-hs-fresh-smoke-final-closeout.md
docs/PROGRESS.md
```

Do not mix runtime DB/cache/backup into either without owner decision.

## 9. Broad corpus / fourth batch recommendation

Do **not** enter fourth batch now.

Recommended next step:
- code/test commit planning and review;
- decide test#36 manifest correction;
- then run a separate broad corpus / fourth batch plan with fresh budget and explicit case list.
