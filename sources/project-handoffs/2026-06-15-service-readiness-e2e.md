# 2026-06-15 Service Readiness E2E

## Verdict

`GO_WITH_WATCH`

Local API, Pi Chat, production frontend snapshot, public tunnel, Direct result read path, cached upload smoke, frontend table/review/PDF/CSV UI, and Pi chat streaming are usable for Monday service.

Watch items:
- Several HS fresh smoke cases remain `ACCEPTABLE_NEEDS_REVIEW`; none are full passed.
- Runtime `knowledge/kb.db` and cache were touched during smoke/replay; do not mix with code/test/docs commit.
- `/ekun-analysis.html` is not a served route; use `/analysis` or `/`.
- test#36 original primary remains AWB-only input issue; corrected-input run is evidence only.

## Commands / checks run

### Closeout report cleanup

Evidence:

```bash
# Artifact read
artifacts/pipeline/job_74a86b1fb5f3.json:9-25
```

Observed:
- validation=`needs_review`
- rows=`8`
- qty=`12.002`
- amount=`72237.36`

```bash
git status --short && git diff --stat
```

Observed after readiness docs update:
- staged 0
- unstaged 8
- untracked 8
- `git diff --stat: 8 tracked files +542 -6`

Updated:
- `docs/cowork/reports/2026-06-14-hs-fresh-smoke-final-closeout.md`

### Service preflight

```bash
scripts/status.sh
```

Result:
- prod-api `:8765 OK pid=60075`
- dev-api `:8766 OK pid=25381`
- prod-pi `:4100 OK pid=76102`
- dev-pi `:4101 OK pid=25386`
- cloudflared running `pid=12009`
- `.prod-runtime/frontend` present, 85M

Health checks were executed through the URL read/browser tools rather than shell `curl`, to obey the harness no-curl rule.

Local API:

```text
http://127.0.0.1:8765/health
```

Result: `status=ok`, Pi `status=ok`, SDK `0.79.1`.

Pi Chat:

```text
http://127.0.0.1:4100/health
```

Result: `status=ok`, SDK `0.79.1`, session dir present.

Public:

```text
https://api.enpro.online/health
```

Result: `status=ok`, Pi `status=ok`, SDK `0.79.1`.

Process snapshot:

```bash
ps -p 60075,76102,12028 -o pid,lstart,command
```

Observed:
- API 8765: started Sun Jun 14 22:48:13 2026
- Pi 4100: started Wed Jun 10 21:16:29 2026
- cloudflared: started Mon Jun 8 15:38:22 2026

No restart was needed.

### Backend / harness gates

```bash
PYTHONPATH=. .venv/bin/python -m pytest -q knowledge/tests/test_direct_item_ledger_adapter.py knowledge/tests/test_direct_llm_pipeline_optin.py
```

Result: `80 passed, 9 warnings in 1.48s`.

```bash
PYTHONPATH=. .venv/bin/python -m py_compile knowledge/core/direct_item_ledger_adapter.py knowledge/core/direct_textin_item_extraction.py
```

Result: passed.

```bash
PYTHONPATH=. .venv/bin/python knowledge/scripts/check_harness_consistency.py
```

Result: `PASSED: 29 entrypoints checked, 7 doc links checked`.

Harness-registry extras:

```bash
node --check frontend/js/ekun.js
node --check .prod-runtime/frontend/js/ekun.js
PYTHONPATH=. .venv/bin/python -m pytest -q knowledge/tests/test_runtime_env_isolation.py
```

Result: `5 passed`; JS syntax checks passed.

## API E2E

### Read path

Checked result endpoints for:

| job | HTTP | route | cache_hit | validation | rows | qty | amount | artifact root |
|---|---:|---|---:|---|---:|---:|---:|---|
| `74a86b1fb5f3` | 200 | `direct_llm_items` | false | `needs_review` | 8 | 12.002 | 72237.36 | `artifacts/pipeline/74a86b1fb5f3` |
| `7ecaf331da30` | 200 | `direct_llm_items` | false | `passed` | 7 | 7.0 | 15340000.0 | `artifacts/pipeline/7ecaf331da30` |
| `fa0cc203361e` | 200 | `direct_llm_items` | false | `needs_review` | 35 | 97.0 | 4701900.0 | `artifacts/pipeline/fa0cc203361e` |

### Upload path

Input:

```text
data/testsets/test#35-MERLIN-ARROW-99435700431/test-35-invoice-MERLIN-ARROW-99435700431.pdf
```

API response:
- upload HTTP 200
- job `9c1674942158`
- status=`cached`
- result endpoint HTTP 200
- validation=`needs_review`
- rows=1
- amount=350.0
- cache_hit=true
- route=`direct_llm_items`

This is a cached upload smoke, not fresh E2E.

## Frontend E2E

### Local frontend

Entry:

```text
http://127.0.0.1:8765/analysis
```

Result:
- title `怡坤智析`
- no console fatal error
- analysis tab visible
- route selector visible, default `direct_llm_items`
- file upload control visible
- job sidebar visible
- PDF preview element present
- result table rendered after cached upload
- review state visible via result table / API status
- row edit control exists and was smoke-focused without saving

Screenshots:
- `artifacts/pipeline/service-readiness-local-analysis-home.png`
- `artifacts/pipeline/service-readiness-local-analysis-result.png`
- `artifacts/pipeline/service-readiness-local-analysis-export-edit.png`

CSV export:
- Export button clicked.
- Browser download event did not expose a file path in headless mode.
- Blob instrumentation confirmed generated CSV content:

```text
HS code,原品名,申报品名,申报要素,申报要素(填充),单价,净重(kg),件数,总价,毛重(kg),原产国,溯源页码
"","ROPE STOPPER","止绳器",..."350.0"...
```

Codex follow-up audit:
- CSV header order matches the current frontend contract: 12 fixed columns, including original product name, declaration name, filled elements, row-level net/gross weight, origin, and 1-based source pages.
- Source and `.prod-runtime` export code now use API row aliases for `declaration_elements_filled`, `net_weight_kg`, `gross_weight_kg`, and `origin_country`, preventing those columns from exporting blank when rows come directly from current pipeline results.
- Added static regression coverage in `knowledge/tests/test_frontend_long_job_recovery_static.py`.

### Chat / Pi composer

Frontend authenticated chat:
- route: local UI `/analysis`
- token-authenticated user `readiness-hq`
- message: `周一服务 smoke：请只回复 ok`
- final UI response: `ok`
- no console fatal errors

Screenshots:
- `artifacts/pipeline/service-readiness-local-chat-authenticated.png`
- `artifacts/pipeline/service-readiness-local-chat-final.png`

Direct Pi SSE:
- endpoint: `http://127.0.0.1:4100/chat`
- HTTP 200
- content-type `text/event-stream`
- session event emitted
- stream state `started` / `done`
- response chunk: `ok，周一 readiness smoke 已确认，准备就绪。`

### Public frontend

Entry:

```text
https://api.enpro.online/analysis
```

Result:
- title `怡坤智析`
- health from public origin OK
- login overlay visible
- analysis UI visible after route load
- route selector `direct_llm_items`
- chat input and file input present
- light tab switch interaction passed
- no console fatal errors

Screenshots:
- `artifacts/pipeline/service-readiness-public-analysis-home.png`
- `artifacts/pipeline/service-readiness-public-analysis-interaction.png`

No public upload was run to avoid extra parse budget; public tunnel/API health and frontend interaction passed.

## Changed files

Tracked dirty files at report time:

```text
M docs/PROGRESS.md
M docs/cowork/reports/2026-06-14-hs-followup-implementation-report.md
M docs/cowork/reports/2026-06-14-hs-human-review-followup-plan.md
M knowledge/core/direct_item_ledger_adapter.py
M knowledge/core/direct_textin_item_extraction.py
M knowledge/kb.db
M knowledge/tests/test_direct_item_ledger_adapter.py
M knowledge/tests/test_direct_llm_pipeline_optin.py
```

Untracked relevant files:

```text
?? docs/cowork/reports/2026-06-14-hs-fresh-smoke-final-closeout.md
?? docs/cowork/reports/2026-06-14-hs-pre-smoke-closeout-report.md
?? knowledge/kb.before-hs-test10-seed-align-20260614-184350.db
?? handoff/
?? review/
```

## Dirty git boundary

### Candidate code/test commit

```text
knowledge/core/direct_item_ledger_adapter.py
knowledge/core/direct_textin_item_extraction.py
knowledge/tests/test_direct_item_ledger_adapter.py
knowledge/tests/test_direct_llm_pipeline_optin.py
```

### Candidate docs commit

```text
docs/cowork/reports/2026-06-14-hs-fresh-smoke-final-closeout.md
docs/cowork/reports/2026-06-15-service-readiness-e2e.md
docs/PROGRESS.md
```

Existing modified 06-14 reports may be included only after separate owner review:

```text
docs/cowork/reports/2026-06-14-hs-followup-implementation-report.md
docs/cowork/reports/2026-06-14-hs-human-review-followup-plan.md
```

### Not-to-commit by default

```text
knowledge/kb.db
knowledge/kb.before-hs-test10-seed-align-20260614-184350.db
runtime cache/artifacts
handoff/
review/
docs/superpowers/plans/*
```

## Blockers / watch items

No GO-blocking service outage found.

Watch items:
- Do not advertise `ACCEPTABLE_NEEDS_REVIEW` cases as full pass.
- test#25-2 amount remains auditable but not closed: line sum / discount / FX context differ.
- test#36 corrected-input has 35 invoice-line rows vs 14 sidecar merged rows; needs row merge/currency review.
- Public upload was not run; public health/frontend interaction passed.
- Pi 4100 and cloudflared are older long-running processes, but health and direct SSE are OK.
- Runtime DB/cache/backup must remain outside code/test commit.

## Commit recommendation

Enter commit planning with split commits:

1. Code/test repair commit:
   - direct item adapter fixes
   - direct TextIn deterministic salvage
   - focused tests

2. Docs commit:
   - final closeout report
   - service readiness report
   - PROGRESS update

3. Runtime DB/cache/backup:
   - no default commit; owner decision required.
