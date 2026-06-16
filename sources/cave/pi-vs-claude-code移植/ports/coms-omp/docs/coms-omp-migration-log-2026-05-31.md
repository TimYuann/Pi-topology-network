# OMP coms Migration Log — 2026-05-31

## Scope

Goal: port the local Unix-socket `coms` extension from the Pi CLI ecosystem to OMP in a dedicated repository without damaging the existing Pi extension.

Runtime boundary:
- Pi CLI/package/config remain separate: Pi uses historical Pi package scopes and `~/.pi/coms`.
- OMP CLI/package/config remain separate: OMP uses `@oh-my-pi/*` packages and `~/.omp/coms`.

Non-destructive rule:
- Do not delete files.
- Do not overwrite the existing Pi `extensions/coms.ts`.
- Add an OMP-specific `extensions/coms-omp.ts`.
- Add an OMP-specific `extensions/themeMap-omp.ts` if theme helpers need OMP imports.

## Baseline Before Codex Edits

Root repository:
- Branch: `master`
- Pre-existing dirty files observed before this migration work:
  - `knowledge/core/textin_adapter.py`
  - `knowledge/kb.db`
  - `knowledge/tests/test_textin_adapter.py`
  - `docs/cowork/coms-to-omp-porting-handoff-2026-05-31.md` (untracked)

Nested `pi-vs-cc` repository:
- Branch: `main`
- Pre-existing dirty files observed before this migration work:
  - `extensions/coms.ts`
  - `extensions/themeMap.ts`
- Pre-existing diff summary:
  - `extensions/coms.ts`: import scope changes and `typebox` import change
  - `extensions/themeMap.ts`: import scope change

## Planned Codex-Owned Files

- `extensions/coms-omp.ts`
- `extensions/themeMap-omp.ts`
- `tests/coms-omp.test.ts`
- `docs/coms-omp-migration-log-2026-05-31.md`

## Rollback Notes

To roll back this dedicated migration repository, use normal Git history inside `/Users/yuantian/Documents/Coding/omp-coms-port`. To remove only the current migration files before the first commit, delete the Codex-owned files listed above. Do not touch pre-existing dirty files in `ekunAi` or `pi-vs-cc` unless explicitly requested.

No `git reset`, checkout, or destructive cleanup is part of this migration.

## Implementation Plan

1. Add failing tests for OMP boundaries:
   - `coms-omp.ts` exists.
   - It imports OMP packages, not Pi package scopes.
   - It defaults to `~/.omp/coms`, not `~/.pi/coms`.
   - It obtains TypeBox builders from `pi.typebox`, not a bare `typebox` package.
   - It registers the same core flags and tools.
2. Create `extensions/coms-omp.ts` from the existing local coms implementation, then patch only OMP-specific boundaries.
3. Create `extensions/themeMap-omp.ts` with OMP package imports and async-safe OMP theme application.
4. Run Bun tests.
5. Run OMP load smoke with temporary HOME/agent/coms dirs.
6. Record verification and remaining risks here.



## Verification Log

- RED: `bun test tests/coms-omp.test.ts` failed before implementation because `extensions/coms-omp.ts` was missing, then failed on Pi-scope imports and old `themeMap.ts` reference.
- GREEN: `bun test tests/coms-omp.test.ts` passed with 2 tests, 17 expectations.
- Build: `bun build extensions/coms-omp.ts --target bun --outdir /private/tmp/omp-coms-port-build` succeeded and bundled 297 modules.
- OMP load smoke: `env HOME=/private/tmp/omp-coms-port-home PI_CODING_AGENT_DIR=/private/tmp/omp-coms-port-agent OMP_COMS_DIR=/private/tmp/omp-coms-port-coms omp --list-models "" -e extensions/coms-omp.ts` succeeded and listed OMP models.
- Lifecycle smoke: `omp -p --no-session --no-tools --model ollama/qwen3:4b ...` started with temporary `OMP_COMS_DIR`, created the OMP coms directory skeleton, then hung waiting for local model output; process was terminated manually. No registry agent JSON remained under the temp coms directory.
- Live two-process transport smoke: two real `omp -p --no-session --model ollama/qwen3:4b -e extensions/coms-omp.ts ...` processes were started with shared `OMP_COMS_DIR=/private/tmp/omp-coms-e2e-live`. Both registered under `projects/default/agents` with distinct Unix socket endpoints. A Node client sent a `ping` envelope from one registered identity to the other and received `pong` with the target agent card. The same client sent a `prompt` envelope and received immediate `ack`. After sending Ctrl-C/Ctrl-D to both PTYs, the temporary registry JSON files and socket files were removed; only empty directories remained.
- Full model-driven tool smoke was attempted but not completed: local Ollama calls failed before a useful tool-call turn could complete (`OpenAI responses stream timed out while waiting for the first event` for `ollama/qwen3:4b`; `500 model runner has unexpectedly stopped` for `ollama/nemotron-3-nano:4b`).
- Ghostty online-model E2E: user ran two real Ghostty OMP sessions with online models. `coms_list` discovered 1 peer, `coms_send` delivered `请只回复 OMP_COMS_E2E_OK`, the peer received `[coms-inbound]`, and `coms_await` returned the expected response `OMP_COMS_E2E_OK`.

## Current Limitations

- Two live OMP processes have verified registry discovery, Unix socket reachability, `ping`/`pong`, prompt `ack`, and model-driven `coms_send` / `coms_await` response completion with online models.
- In OMP 15.5.15, tested invocations with extension-owned flags such as `--name` and `--project` did not behave like Pi; the flag values appeared as prompt messages in the TUI. Default auto-generated names work, but CLI flag compatibility needs a focused follow-up before relying on named agents.
- The current implementation is intentionally local Unix-socket only; `coms-net` is not ported in this pass.
