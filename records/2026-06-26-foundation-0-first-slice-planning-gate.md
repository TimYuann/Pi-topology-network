# Foundation-0 First-Slice Planning Gate

Date: 2026-06-26
Status: planning-gate report
Scope: Foundation-0 + process/temp-directory Resource Ledger / Cleanup Guard

## Decision

`ready_for_codex_review`

The contract docs 19 + 20 are now reducible to a machine-checkable first slice. No
runtime code under `packages/pi-topology/src` was modified, no tests were modified,
no commit was produced, and no real cleanup, signal, Ghostty launch, or dogfood
occurred during this gate. The artifact is specific enough that Codex can review
and authorize a separate implementation plan before any code is written.

## Scope And Precedence

Source contracts (in priority order, per doc 20 §2):

1. `docs/20-pi-topology-v0.6-foundation-0-first-slice-contract-closure.md` — supersedes conflicting first-slice semantics in doc 19.
2. `docs/19-pi-topology-v0.6-foundation-0-first-slice-contract.md` — normative where not contradicted by doc 20.
3. `docs/18-pi-topology-v0.6-collaboration-kernel-freeze-draft.md` — normative only for deferred kernel areas not redefined by docs 19/20.
4. Review docs (`docs/spec19-review-gpt5.5.md`, `docs/Freeze-spec-review-5.5.md`, `docs/Spec-review-5.5pro.md`, `docs/Multi-agent-structure-review.md`) — informative, not normative.

First-slice deliverables this plan covers:

- TypeScript discriminated unions (preferred) or JSON Schema for every first-slice object.
- Runtime algorithms: durable event append, macOS process identity probe, process
  cleanup, temp directory cleanup, reconciliation, closeout.
- An acceptance test plan covering tests 1-32, each tagged with a concrete future
  test style and an explicit "real side effects?" column.
- An implementation task decomposition that future Pi/Codex can execute without
  further spec invention.
- A blocker/open-question list that is explicit, not hidden in vague notes.

Precedence rule for future schema/runtime work (machine-checkable):

```text
when two contract docs disagree on first-slice semantics:
  if doc20 contradicts doc19 -> doc20 wins
  if doc20 silent -> doc19 wins
  if both silent and only doc18 covers -> doc18 wins (kernel area)
  else raise contract blocker
```

## Non-Goals

- No runtime code changes in this planning gate.
- No test changes in this planning gate.
- No real process cleanup or signal sending.
- No Ghostty launch.
- No dogfood.
- No commit.
- No full v0.6 kernel implementation.
- No terminal session, worktree, branch, port, container, test-server, or artifact cleanup.

Out-of-scope for the future implementation slice as well (per docs 19 §14, 20 §18):
terminal session cleanup, external session cleanup, port reservation cleanup,
worktree/branch cleanup, container cleanup, test server cleanup, full workspace
write lease enforcement, full message retry/backpressure/dead-letter
implementation, full artifact retention policy, full v0.6 JSON Schema generation
for every future kernel object.

## Contract Coverage Matrix

Maps doc 19 sections (D19) and doc 20 sections (D20) to proposed implementation
tasks. Tasks T1-T13 are forward-looking; this gate only describes them.

| Contract clause | Source | Summary | Proposed future task | Test refs |
|---|---|---|---|---|
| §2 applicability tags | D19 | `[SCHEMA]`, `[FIRST-SLICE]`, `[KERNEL]` | T1 schema modules | 21 |
| §3 threat model | D19 | process/temp cleanup safety | T3, T5 | 1, 4, 5, 8, 18 |
| §4 storage paths | D19 | `runtime-events.jsonl` + projections | T2, T7 | 11 |
| §5 Principal | D19 | `human_owner\|agent\|system` | T1 | — |
| §5 Mission | D19 | lifecycle phases, `closing` guards | T1, T11 | 12, 17 |
| §5 Actor | D19 | role/status, runtime-internal role | T1 | 24 |
| §5 Authorization | D19 + D20 §6 | RootAuthorization/DelegatedAuthorization | T1 | 3, 13, 24, 28 |
| §6 ActionRequest/Attempt | D19 + D20 §7 | discriminated by capability | T1, T4 | 6, 22 |
| §6 PolicyDecision | D19 | allowed-only-at-execution rule | T1, T4 | 20 |
| §6 InitialOutcome | D19 + D20 §10 | action-specific outcomes | T1, T5, T6 | 9, 14 |
| §6 ReconciliationResolution | D19 + D20 §11 | 0..N observations, 1 resolution | T1, T9 | 10, 29 |
| §7 canonical event envelope | D19 | sequence global, durable commit | T2, T7 | 11 |
| §8 ManagedResource | D19 + D20 §9 | planned/observed discriminated | T1, T3 | 16, 30 |
| §8 pre-registration | D19 | 5-step create flow | T3 | 16 |
| §9 process identity | D19 + D20 §12 | start_time_seconds/microseconds, spawn_nonce | T1, T4 | 4, 5, 18 |
| §9 process cleanup policy | D19 | SIGTERM grace → optional SIGKILL | T5 | 7 |
| §10 temp identity | D19 + D20 §13 | non-circular digest, identity_core | T1, T6 | 8, 25, 26 |
| §10 safe temp cleanup | D19 + D20 §13 | canonicalize→lstat→quarantine→delete | T6 | 8, 19, 27 |
| §11 closeout | D19 + D20 §15 | linearized critical section | T11 | 12, 30, 32 |
| §12 evidence subject | D19 | managed_resource evidence | T1, T10 | 9, 31 |
| §13/§16 tests 1-32 | D19+D20 | full acceptance test set | T13 | 1-32 |
| §15/§17 implementation preconditions | D19+D20 | 12+ concrete items | T0 (this gate) | — |

## Schema Inventory

### Location

Recommended new TypeScript modules under `packages/pi-topology/src/extension/topology/foundation0/`:

| File | Owns | Reason |
|---|---|---|
| `schema.ts` | All first-slice discriminated union types and DTOs | Single source for type-level shape, mirroring JSON Schema examples |
| `validation.ts` | Runtime validators (custom, no Zod dependency required) using ID grammar, digest grammar, ISO-8601 UTC checks | Validation must reject before any side effect; this module is the gatekeeper |
| `ids.ts` | ID/digest/timestamp grammars + deterministic JSON canonicalization used by digest inputs | Reused by every schema, every event, every marker, every evidence digest |

Rationale: the existing `packages/pi-topology/src/schemas/*.schema.ts` files are
single-class TypeBox-style Zod-free hand-written validators. The proposed
`foundation0/` folder follows that precedent but lives under
`extension/topology/` because (a) doc 20 §3 calls these first-slice unions out
of the broader kernel, (b) `extension/topology/` already hosts runtime-adjacent
code (`topology-supervisor` role policy lives at
`packages/pi-topology/src/roles/role-policy.ts`), and (c) it leaves
`packages/pi-topology/src/schemas/` free for the broader kernel schema work
deferred past first slice.

Cross-field validation that `validation.ts` MUST enforce (not just per-field):

- `Mission.lifecycle_phase = active` ⇒ `register_resource` accepted; `closing`
  ⇒ only cleanup/reconciliation/closeout actions.
- `ManagedResource.lifecycle_state = planned` ⇒ `identity == null` and
  `identity_digest == null`; any other lifecycle state ⇒ both MUST be present
  (doc 20 §9).
- `ManagedResource.cleanup_policy` MUST be `ProcessCleanupPolicy` when
  `resource_type = "process"`, `TempDirectoryCleanupPolicy` when
  `resource_type = "temp_directory"`.
- `Authorization.delegation_depth_remaining` strictly less than parent's.
- `Authorization.expires_at` strictly greater than `created_at`.
- `DelegatedAuthorization.granted_under_authorization_id` MUST resolve to an
  existing `Authorization` of the same `mission_id`.
- `CloseMissionAction.target.mission_id == action.mission_id`.
- `TerminateResourceAction.target.resource_id` resource MUST be in the same
  `mission_id`.
- `ManagedResource.resource_type` discriminated union: `process | temp_directory`.
- Reconciliation: at most one `ReconciliationResolution` per `action_attempt_id`.

### First-slice objects table

The list below covers every object named in doc 20 §3.

| Object | Discriminant | Required fields | Nullable fields | Validation notes |
|---|---|---|---|---|
| Principal | `kind` (`human_owner\|agent\|system`) | `schema_version`, `principal_id`, `kind`, `trust_domain` | `display_name` | Owner approval requires `kind=human_owner`. System bootstrap permits `kind=system` only for runtime-internal reconciliation. |
| Mission | `lifecycle_phase` | `schema_version`, `mission_id`, `created_by_principal_id`, `created_at`, `lifecycle_phase`, `attention_state`, `policy_hash` | `pending_gate_ids` | Mission transition table per D19 §5.2. Mission storage path derived from validated `mission_id`, not from title/objective. |
| Actor | `role` (`topology-supervisor\|hq\|runner\|repair\|oracle\|governor\|runtime`) | `schema_version`, `actor_id`, `principal_id`, `mission_id`, `role`, `policy_hash`, `status` | `session_id` | Cleanup actions must reference an Actor. Runtime-internal reconciliation uses `role=runtime`. |
| RootAuthorization | `authorization_kind=root` | `authorization_kind`, `authorization_id`, `mission_id`, `granted_by_principal_id`, `granted_to_actor_id`, `delegation_depth_remaining`, `risk_ceiling`, `policy_hash_at_grant`, `expires_at`, `grants` | `granted_by_actor_id`, `granted_under_authorization_id`, `root_basis` may be `null` only when `authorization_kind=delegated` | `root_basis ∈ {owner_approval, system_bootstrap}`; `system_bootstrap` cannot grant cleanup of arbitrary PID/path (D20 §5). |
| DelegatedAuthorization | `authorization_kind=delegated` | `authorization_kind`, `authorization_id`, `mission_id`, `granted_by_principal_id`, `granted_by_actor_id`, `granted_under_authorization_id`, `granted_to_actor_id`, `delegation_depth_remaining`, `risk_ceiling`, `policy_hash_at_grant`, `expires_at`, `grants` | — | `granted_under_authorization_id` MUST exist; `delegation_depth_remaining` < parent. |
| ActionRequest | `payload_kind` (5 variants) | `schema_version`, `action_id`, `mission_id`, `actor_id`, `authorization_id`, `idempotency_key`, `payload_ref`, `payload_digest`, `effect_fingerprint`, `requested_at`, `capability`, `target`, `payload_kind` | `retry_of_action_id` | Runtime MUST recompute `payload_digest` and `effect_fingerprint`; caller-provided values are hints. |
| ActionAttempt | (none, identity by `action_attempt_id`) | `schema_version`, `action_attempt_id`, `action_id`, `mission_id`, `attempt_number`, `started_at` | — | Exactly one `InitialOutcome` per `ActionAttempt`. Each external side effect lives inside an `ActionAttempt`. |
| PolicyDecision | `result` + `evaluation_point` | `schema_version`, `policy_decision_id`, `action_id`, `action_attempt_id`, `mission_id`, `evaluation_point`, `evaluation_sequence`, `result`, `evaluated_policy_hash`, `decided_at` | `reason_codes`, `authorization_chain` | Only `evaluation_point=execution` with `result=allowed` may authorize an external side effect. Allowed/denied/gated all durably recorded. |
| InitialOutcome | `status` (`succeeded\|failed\|skipped\|indeterminate`) | `schema_version`, `outcome_id`, `action_attempt_id`, `action_id`, `mission_id`, `status`, `result_code`, `created_at` | `evidence_ids` | Action-specific, not single shared enum. Mapping per D20 §10. |
| ReconciliationObservation | `state` (`still_unresolved\|observed_cleaned\|observed_failed\|requires_manual`) | `schema_version`, `observation_id`, `action_attempt_id`, `action_id`, `mission_id`, `state`, `reconciliation_action_id`, `reconciliation_actor_id`, `policy_decision_id`, `observed_at` | `evidence_ids` | Zero or more observations per attempt. |
| ReconciliationResolution | `resolution` (`reconciled_succeeded\|reconciled_failed`) | `schema_version`, `resolution_id`, `action_attempt_id`, `action_id`, `mission_id`, `resolution`, `reconciliation_action_id`, `reconciliation_actor_id`, `policy_decision_id`, `observed_at` | `evidence_ids` | At most one resolution per attempt. |
| Event | `event_type` (catalog list, D20 §8) | `schema_version`, `event_id`, `mission_id`, `sequence`, `event_type`, `entity_type`, `entity_id`, `payload_ref`, `payload_digest`, `created_at` | `principal_id`, `actor_id`, `action_id`, `action_attempt_id`, `policy_decision_id`, `caused_by` | Sequence is mission-global; allocated under mission event lock. Event catalog is the discriminated union source-of-truth. |
| ManagedResource | `resource_type` + `lifecycle_state` | `schema_version`, `resource_id`, `mission_id`, `resource_type`, `ownership_origin`, `owned_by_actor_id`, `cleanup_owner_actor_id`, `registered_by_action_id`, `authorization_id`, `lifecycle_state`, `verification_state`, `created_at`, `updated_at` | `identity`, `identity_digest`, `cleanup_policy` (nullable only when `lifecycle_state=planned`) | Lifecycle transition table per D19 §8.1. `verification_state` orthogonal to lifecycle. |
| ProcessIdentity | (object, no enum) | `pid`, `pgid`, `start_time_seconds`, `start_time_microseconds`, `executable`, `argv`, `cwd`, `command_digest` | `spawn_nonce` (provenance, optional) | `command_digest = sha256(canonical(executable_realpath + argv + cwd_realpath))`. PID alone never sufficient. |
| ProcessCleanupPolicy | `termination_scope` (`pid\|dedicated_process_group`) | `termination_scope`, `term_signal` (`SIGTERM`), `grace_period_ms`, `force_signal` (`SIGKILL`) | — | `allow_force_kill = false` by default; force kill only under explicit policy. |
| TempDirectoryIdentity | (object, non-circular digest) | `identity_core.approved_temp_root_id`, `identity_core.canonical_path`, `identity_core.device_id`, `identity_core.inode`, `identity_core.owner_uid`, `identity_core.creation_nonce`, `identity_digest = sha256(canonical(identity_core))`, `marker_digest = sha256(canonical(marker))` | — | `identity_digest` MUST NOT include `marker_digest`. Quarantine path = `deterministic(resource_id + action_attempt_id)` under approved root. |
| TempDirectoryMarker | (object, referenced by `TempDirectoryIdentity`) | `schema_version`, `mission_id`, `resource_id`, `identity_digest`, `created_by_action_id` | — | Verified at cleanup time: marker mission_id/resource_id/identity_digest MUST match ledger. |
| TempDirectoryCleanupPolicy | (object) | `rename_strategy` (`atomic_rename_under_root`), `delete_strategy` (`recursive_no_follow`) | `quarantine_path_template` (default = derived) | Quarantine path must be deterministic; retry after failure targets `quarantine_path`, not original path. |
| Evidence | `subject.subject_type` (`managed_resource`) | `schema_version`, `evidence_id`, `mission_id`, `source`, `subject`, `digest`, `produced_by_principal_id`, `produced_by_actor_id`, `created_at` | — | Subject is always `managed_resource` in first slice. Digest input is deterministic JSON. |
| OwnerDecision | `decision` (`approve_conditional_closeout\|reject_conditional_closeout\|abandon`) | `schema_version`, `owner_decision_id`, `mission_id`, `issued_by_principal_id`, `decision`, `verified_through_sequence`, `resource_snapshot_digest`, `created_at` | `residual_resource_ids` | Binds to same `verified_through_sequence` + `resource_snapshot_digest` as the `CloseoutRecord`. |
| CloseoutRecord | `disposition` (`clean\|conditional\|abandoned`) | `schema_version`, `closeout_id`, `mission_id`, `disposition`, `verified_through_sequence`, `resource_snapshot_digest`, `residual_resources`, `created_at` | `owner_decision_id`, `cleanup_owner_principal_id`, `evidence_ids`, `residual_resource_ids` (legacy) | `residual_resources` is per-resource array (D20 §15.2). Clean closeout blocks on any non-`(cleaned+verified)` or non-`(abandoned+verified-never-created)` resource. |

### ID/digest/timestamp validation (doc 20 §4)

```text
ID pattern: ^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$
Digest pattern: sha256:<lowercase-hex>
Timestamp: ISO-8601 UTC with millisecond precision
Mission storage path: derived from validated mission_id only
```

IDs covered: `mission_id`, `principal_id`, `actor_id`, `authorization_id`,
`action_id`, `action_attempt_id`, `policy_decision_id`, `event_id`,
`resource_id`, `evidence_id`, `owner_decision_id`, `closeout_id`. `spawn_nonce`
is also covered (it appears in path-shaped evidence and quarantine trace).

### Discriminated unions explicitly required

```text
Authorization = RootAuthorization | DelegatedAuthorization
ActionRequest = RegisterResourceAction | CreateManagedResourceAction | TerminateResourceAction | ReconcileResourceAction | CloseMissionAction
Event        = discriminated union keyed by event_type (D20 §8)
ManagedResource = PlannedResource | ObservedProcessResource | ObservedTempDirectoryResource
                  (lifecycle_state=planned ⇒ identity null; otherwise identity present)
InitialOutcome  = RegisterOutcome | CreateOutcome | TerminateOutcome | ReconcileOutcome | CloseOutcome
                  (action-specific outcome variants; mapping table D20 §10)
```

## Object Model Plan

For each of the four contract groups (action requests, policies, outcomes,
managed resources), the schema modules plan to:

- Define the discriminated union as a TypeScript `type X = VariantA | VariantB | ...`
  with the discriminant field as a string literal type.
- Provide a `validateX(input: unknown): X` function that (a) enforces
  `additionalProperties: false`, (b) checks ID/digest/timestamp grammars,
  (c) enforces cross-field rules from doc 20 §3/§9/§10, and
  (d) returns the parsed object (no exceptions on validation success).
- Re-export the union type for use by `mission-actions.ts`, `mission-events.ts`,
  `watchdog.ts`, and the future cleanup guard.

Concrete file-by-file ownership (proposed, not yet created):

| File | Defines |
|---|---|
| `schema.ts` | All 21 object types as TypeScript discriminated unions, the event catalog as a `const` array literal, and the capability registry from D20 §5. |
| `validation.ts` | Per-object validators and a top-level `validateFirstSliceEvent(input)` shared by both the canonical append path and the recovery/rebuild path. |
| `ids.ts` | `ID_PATTERN`, `DIGEST_PATTERN`, `ISO8601_PATTERN`, `canonicalizeForDigest()`, `computeSha256Digest()`, `validateId()`, `validateDigest()`, `validateTimestamp()`. |

The schema modules do NOT touch disk. The runtime modules below own all
filesystem work. This separation lets schema tests stay pure (no fs).

## Runtime Implementation Plan

Read-only inventory of existing surfaces that the future implementation will
either reuse or co-exist with. **No source file was edited during this gate.**

| Area | Existing file(s) | Relevance | Risk |
|---|---|---|---|
| Mission paths | `src/runtime/active-mission-resolver.ts`, `src/runtime/mission-registry.ts`, `src/runtime/mission-path.ts` | Already resolves `<workspace>/.pi/topology/missions/<mission_id>/` style paths and root mirror fallback. First-slice `runtime-events.jsonl` + projections can be added using the same resolver. | Low — existing resolver is read-mostly; new fields can be added without changing resolver contract. |
| Event append | `src/state/event-log.ts`, `src/runtime/mission-events.ts`, `src/runtime/mission-actions.ts` | Existing `appendFile`/`appendFileSync` writers for `runtime-events.jsonl`. First-slice needs a durably-committed, lock-protected variant. | Medium — current writes are not lock-serialized; concurrent `topology_*` calls in v0.5 risk interleaved rows. First slice must add serialization without breaking existing call sites. |
| Launch/spawn | `src/runtime/spawn.ts`, `src/extension/tools.ts`, `src/extension/commands.ts`, `src/runtime/role-session.ts` | Spawn helper builds `open -n -a Ghostty` commands; `topology_spawn_role` is the existing launch path. Future pre-registration of process resources can hook before `spawn(...)`. | Medium — current `spawn("open", ...)` does not pre-register a `ManagedResource`; first slice must wire pre-registration around it. **No change to spawn itself in this gate.** |
| Process killing | `src/runtime/dogfood.ts` (lines 620/647 `process.kill SIGTERM/SIGKILL`) | The only `process.kill` usage is in dogfood self-termination. First-slice cleanup must NOT go through `dogfood.ts`. Future implementation will introduce a `process-inspector.ts` abstraction with a kill injection seam so tests can fake the kill without touching dogfood. | High — anything that calls `process.kill` against PIDs not registered under the new schema risks destroying the CLI's own session. Mitigation: CLI/ancestor protection is a hardcoded probe in `process-inspector.ts`. |
| Temp dirs | `src/state/paths.ts`, `src/extension/register.ts`, `src/extension/ui.ts`, `src/runtime/dogfood.ts` | Existing `pi-topology-<project>` temp root is shared with coms/registry; first slice introduces `approved_temp_root_id = "tmp_root_default"` mapped to `os.tmpdir()` realpath. Existing `safe-paths.ts` provides realpath canonicalization primitives. | Medium — `safe-paths.ts` may not yet enforce the marker file check or protected-path set from D19 §10.1. Future work adds marker enforcement, not in this gate. |
| Mission event lock | (none yet) | No existing lock primitive for `runtime-events.jsonl`. | High — this is new ground. See "Durable Event Append And Lock Strategy". |
| Resource ledger | (none yet) | No existing `resource-ledger.jsonl` or `cleanup-log.jsonl`. | High — new files per D19 §4. |
| Closeout | `src/runtime/mission-lifecycle.ts`, `src/runtime/guard.ts` | `guard.ts` already has `OwnerGateState`. Closeout integration is new but can reuse lifecycle phase transitions. | Medium — gate state and lifecycle are already namespaced in `mission-lifecycle.ts`. |
| Evidence | (none yet) | Deferred artifact retention, but evidence subject is required now. | Medium — evidence records can live as JSONL inside `runtime-events.jsonl` envelope for first slice; full artifact retention deferred. |
| Tests | `test/unit/*.test.ts` (24 files), `test/integration/*.test.ts` (2 files), `scripts/*.sh` (2 files), `scripts/guard-smoke.mjs` | 24 unit tests + 2 integration tests. Future first-slice tests will live under `test/unit/foundation0/` and `test/integration/foundation0/`. | Low — test directory already namespaced; new tests slot in without disturbing existing ones. |

## macOS Process Identity Probe Plan

macOS is the only supported OS for first-slice process identity probing (D19 §9).
All probes MUST be read-only, non-destructive, and must NOT be executed during
this planning gate. Probes return a `ProcessSnapshot` whose canonical digest is
the `identity_digest` input.

| Probe | macOS mechanism | Returns | Used for | First-slice blocker? |
|---|---|---|---|---|
| pid existence | `kill(pid, 0)` from Node (no signal sent) | alive / ESRCH | "Already absent?" gate (test 4) | none — well-known idiom |
| pgid | `process.kill(-pid, 0)` returns success when `pgid == pid` and process is its own group leader | own_group: boolean | Identity (test 5), group-signal gate (test 18) | none |
| raw process start time (seconds) | `lsof -p <pid> -F st` (macOS) — fallback: `ps -o etime= -p <pid>` only as a non-canonical hint | seconds + microseconds | Identity, PID reuse protection (test 4) | **platform probe blocker** — needs Codex confirmation that `lsof -F st` is acceptable (it is read-only, does not write); alternative: `proc_pidinfo(PROC_PIDT_START_TIME)` via N-API binding (out of scope for first slice). |
| ancestor process list | `ps -o pid=,ppid=,comm= -p <pid>` then walk `ppid` chain until `pid == 1` | ancestor pids | CLI protection (test 5) | none |
| process group membership | `ps -o pgid= -p <pid>` | pgid | Identity, group-signal gate | none |
| executable realpath | `lsof -p <pid> -F txt \| awk '/^txt/ {print substr($0,4)}'` and `fs.realpathSync` | realpath | `command_digest` | none |
| argv | `ps -o args= -p <pid>` (one-shot; no live re-read) | argv string array | `command_digest` | **platform probe blocker** — argv quoting across `ps -o args=` is non-canonical. Mitigation plan: prefer `proc_pidinfo` (out of first slice) or accept `ps -o args=` and document quoting caveat. Future Codex review must pick one. |
| cwd | `lsof -p <pid> -F cwd` then `fs.realpathSync` | realpath | `command_digest` | none |
| command_digest | `sha256(canonical(executable_realpath + argv + cwd_realpath))` | digest | Identity | none |

CLI protection gate (test 5):

```text
let cli_pid = process.pid
let ancestors = walk_parents(cli_pid)
let cli_pgid = process.pgid ?? cli_pid  // Node does not expose pgid; derive via ps

cleanup-time signal MUST be rejected if:
  target.pid == cli_pid
  OR target.pid in ancestors
  OR target.pgid == cli_pgid
```

`process.pgid` is not available on Node; first-slice will resolve CLI pgid via
the same `ps` probe at runtime startup, cached for the lifetime of the process.
**platform probe blocker** for "process group contains CLI" — confirm with Codex
that a one-time `ps -o pgid= -p <cli_pid>` at startup is acceptable.

The `spawn_nonce` field is renamed from `spawn_token` (D20 §12). It is
provenance, NOT a live cleanup-time probe — first-slice does not implement a
live nonce check. Documented as such; not a blocker.

## Durable Event Append And Lock Strategy

Event append is the spine of the first slice. Three problems must be solved at
the same time:

1. **Lock acquisition order.** Mission event lock MUST be acquired before any
   external side effect begins, and released only after the durable commit of
   the final `initial_outcome_recorded` event.
2. **Sequence allocation under lock.** Sequence number is mission-global
   (D19 §7). The lock holder reads max(sequence) + 1, appends, then commits.
3. **Payload durability before event.** `payload_ref` content MUST be written
   and digest-verified before the referencing event is appended (D20 §8).

Concrete strategy:

```text
acquire mission-event-lock (per mission_id)
  alloc = read_last_sequence_canonical(mission_id) + 1
  build event payload (canonical JSON)
  write payload to mission storage (atomic via tmp+rename)
  verify payload_digest == sha256(canonical(payload))
  append event line to runtime-events.jsonl
  fsync runtime-events.jsonl fd
  release mission-event-lock
```

Lock primitive choice: `proper-lockfile` is not currently a dependency in
`packages/pi-topology/package.json`. Two viable paths:

- **Path A (preferred):** add `proper-lockfile` to `peerDependencies`/`devDependencies`
  only. Pure JS flock-style lock via lockfiles; works on macOS; no kernel deps.
- **Path B:** implement a `O_EXCL` lockfile helper in `src/state/lockfile.ts`
  (~30 LoC) using `node:fs` `wx` open flag. Lower surface, no new dependency,
  but must be reentrant-safe (await chain).

**Codebase-discovery blocker:** confirm whether `proper-lockfile` is acceptable
as a transitive dev-only dep (used by tests + runtime), or whether to ship a
hand-rolled `O_EXCL` lockfile. Decision belongs to Codex in the next gate.

Sequence recovery / partial-tail handling:

```text
on startup:
  read runtime-events.jsonl line-by-line
  for each line: validate JSON, validate event_type catalog, check sequence == prev+1
  if last line is partial (JSON.parse fails on trailing bytes):
    truncate to last fully-parsed line
    append a recovery event: reconciliation_required with reason "partial_tail_recovered"
  rebuild projections from authoritative events
```

Projection rebuild or append (D19 §7):

- `resource-ledger.jsonl`: append under a projection lock keyed by `mission_id`.
- `cleanup-log.jsonl`: append under same projection lock.
- `closeout.json`: snapshot via tmp+rename, never in-place.

The existing `packet-ledger.ts` already does `tmp+rename` for snapshot writes
and uses sync `appendFileSync` for appends (see `src/state/event-log.ts`). First
slice will introduce a new `appendCanonicalEvent(...)` helper in
`src/runtime/mission-events.ts` (or a new `src/runtime/foundation0/event-append.ts`
if separation is desired) that wraps lock + payload-durability + sequence-allocation.

## Temp Directory Cleanup Plan

Marker file format (D19 §10.1, D20 §13):

```text
mission_id: mission_<id>
resource_id: res_<id>
identity_digest: sha256:<hex>
created_by_action_id: action_<id>
schema_version: 1
```

Approved temp root registry (D20 §13) — a trusted runtime-side map:

```text
{
  "tmp_root_default": {
    "realpath": "/private/tmp",       // fs.realpathSync(os.tmpdir())
    "device_id": <number>,
    "inode": <number>
  }
}
```

Approved root resolution MUST go through this registry, not only from the
Resource record. First slice will define the registry as a frozen constant in
`src/runtime/foundation0/temp-roots.ts` (proposed location). Adding a new
approved root is a code change, not a runtime config — this is intentional and
prevents an attacker who can write a Resource from widening the cleanup set.

Cleanup algorithm (D19 §10.2 + D20 §13):

```text
1. Resolve approved_temp_root_id via trusted registry (NOT from record alone).
2. Compute quarantine_path = deterministic(resource_id + action_attempt_id)
   inside the canonical approved root realpath.
3. lstat target and marker; both MUST NOT be symlinks.
4. Verify marker.mission_id == action.mission_id,
        marker.resource_id == resource.resource_id,
        marker.identity_digest == resource.identity_digest.
5. Re-check protected-path set:
     - empty string
     - "/"
     - approved temp root realpath itself
     - runtime state root
     - mission storage root
     - repository root
     - current CLI cwd
     - cwd ancestors
6. Atomically rename target -> quarantine_path (same filesystem).
7. lstat quarantine_path; verify device_id+inode match pre-rename.
8. Re-verify marker_digest from on-disk marker (after rename: marker has moved
   with target if inside target, OR marker_path now stale if outside target).
   First slice will define the marker as INSIDE the target so it moves with
   the rename.
9. Recursive delete without following symlinks (rm -rf equivalent implemented
   in JS using lstat at each level).
10. On delete failure: set resource.current_locator = quarantine_path and
    mark cleanup_failed; reconciliation targets quarantine_path, not original.
```

Identity digest non-circularity (D20 §13, test 25):

```text
identity_digest   = sha256(canonical(identity_core))
marker_digest     = sha256(canonical(marker))
identity_core does NOT include marker_digest
marker references identity_digest (allowed: identifier reference, not digest input)
```

Inode replacement protection (test 26):

```text
before delete:
  lstat quarantine_path
  if (device_id, inode) != (pre_rename_device_id, pre_rename_inode):
    refuse, mark current_locator = quarantine_path, cleanup_failed
```

Quarantine crash recovery (test 27):

```text
on startup:
  scan quarantine dir for entries whose name matches derived pattern
  for each match:
    load action_attempt_id from entry name (deterministic)
    check mission-events.jsonl for matching action_id + status
    if no outcome recorded:
      append reconciliation_required event with reason "quarantine_orphan"
      leave file in quarantine; do NOT auto-delete
      wait for explicit reconciliation or owner decision
```

Marker filename:

```text
.pi-topology-resource.json
```

Located at `<target>/.pi-topology-resource.json`. The marker is created
inside the target so it moves with the quarantine rename. This is a
deliberate design choice to avoid leaving orphan markers if target is
deleted out-of-band.

## Reconciliation And Crash Recovery Plan

Recovery procedure (D20 §11 enumeration, mapped to first-slice tests):

| Scenario | Recovery action | Test |
|---|---|---|
| Planned resource, no observed identity | Resolve via `lsof`/`ps` probe: did the external process/temp ever exist? If yes, log `reconciliation_observed`; if no, transition to `abandoned + verified-never-created`. | 16 |
| Intent without policy decision | Re-evaluate intent under current policy; if allowed, record `policy_decision_recorded` then continue. | 20 |
| Allowed policy decision without outcome | Re-attempt action with new `idempotency_key` + `retry_of_action_id` (NEVER silently re-execute). | 20, 23 |
| Process cleanup interrupted after SIGTERM | Re-probe identity; if process gone, treat as `cleaned + verified`; else, require new owner authorization before SIGKILL. | 7, 28 |
| Temp cleanup interrupted after quarantine rename | Locate `quarantine_path`; re-verify identity; resume delete from step 9 of cleanup algorithm. | 27 |
| Indeterminate outcome without final reconciliation | Spawn `ReconciliationObservation` events; on next owner-gated trigger, finalize with `ReconciliationResolution`. | 10, 29 |
| `closeout_started` without `closeout_recorded` | On restart, mission is in `closing` phase; rebuild sequence, verify resources, complete closeout per D20 §15.3. | — (implicit; covered by tests 12, 30) |
| Trailing partial canonical event | Truncate to last fully-parsed line; emit `reconciliation_required` with `reason=partial_tail_recovered`. | 11 |
| Missing or digest-mismatched `payload_ref` | Treat event as not-yet-durable; emit `unsupported_schema_detected` (or `reconciliation_required`); do NOT project. | 31 |

Reconciliation loop:

```text
during normal operation:
  reconciliation is triggered by:
    a) explicit ReconcileResourceAction (owner/authorized actor)
    b) runtime startup scan
    c) orphan detection in approved temp roots
  each reconciliation pass:
    append ReconciliationObservation events (0..N)
    if state transitions to terminal:
      append ReconciliationResolution (exactly one)
    if observation includes external side effect:
      create new ActionAttempt + execution PolicyDecision (D20 §7.5)
```

Active cleanup attempt definition (D20 §10):

```text
action_attempt_started exists for attempt_id
AND no final non-indeterminate InitialOutcome exists
AND no ReconciliationResolution exists
```

This is the canonical "is this attempt busy?" check used by test 14
(concurrent cleanup with different idempotency keys returns `cleanup_in_progress`).

Closeout linearization (D20 §15.3):

```text
under mission-event-lock:
  append closeout_started event
  transition mission.lifecycle_phase = closing
release lock
  perform cleanup/reconciliation as needed
reacquire mission-event-lock
  rebuild canonical events to latest sequence N
  verify all owned resources satisfy:
    cleaned + verified, OR
    abandoned + verified-never-created
  in same critical section:
    append closeout_recorded event
    transition mission.lifecycle_phase = closed
    durably commit (fsync)
release lock
```

## Acceptance Test Plan

Tests 1-32 cover the union of doc 19 §13 (tests 1-20) and doc 20 §16 (tests
21-32). All test styles below are forward-looking; this gate only specifies them.

| # | Contract behavior | Proposed test file | Test style | Real side effects? | Notes |
|---|---|---|---|---|---|
| 1 | Unregistered resources cannot be cleaned | `test/unit/foundation0/cleanup-guard.test.ts` | unit | none | Try `terminate_resource` on a `resource_id` not in `resource-ledger.jsonl` → expect `denied`. |
| 2 | Cross-Mission cleanup is rejected | `test/unit/foundation0/cleanup-guard.test.ts` | unit | none | `actor.mission_id == A`, `target.mission_id == B` → expect `denied`. |
| 3 | Missing capability/authorization is rejected and recorded | `test/unit/foundation0/policy-decision.test.ts` | unit | none | Verify `policy_decision_recorded` event was durably appended with `result=denied`. |
| 4 | Process identity mismatch skips without signal | `test/unit/foundation0/process-identity.test.ts` | integration-with-fakes | none (fake inspector returns mismatched pgid) | Inject `ProcessInspector` that returns wrong `start_time_seconds`. Assert `skipped_identity_mismatch` and no `kill()` call. |
| 5 | Current CLI, ancestors, CLI-containing PG protected | `test/unit/foundation0/cli-protection.test.ts` | integration-with-fakes | none (fake inspector returns CLI pid chain) | Inject inspector whose `walk_parents(cli_pid)` returns a chain containing the target. Assert denial. |
| 6 | Cleanup is idempotent by idempotency key | `test/unit/foundation0/idempotency.test.ts` | unit | none | Two `terminate_resource` with same key + same fingerprint → single outcome. |
| 7 | Process cleanup follows SIGTERM → grace → optional SIGKILL | `test/unit/foundation0/process-cleanup.test.ts` | fault-injection | none (fake killer records signal calls) | Inject `ProcessKiller` recording `SIGTERM`/`SIGKILL`. Assert order, grace period, conditional SIGKILL only when policy allows. |
| 8 | Temp containment rejects escape/marker mismatch/symlink/root/empty | `test/unit/foundation0/temp-cleanup.test.ts` | integration-with-fakes (sandboxed temp dir) | none (uses `fs.mkdtempSync` under `os.tmpdir()`, fully isolated) | For each rejection case, run cleanup and assert no delete occurred. |
| 9 | Success and failure both produce replayable evidence | `test/unit/foundation0/evidence.test.ts` | unit | none | After each terminal outcome, replay events from `runtime-events.jsonl` and assert evidence digest matches. |
| 10 | Cleanup intent without outcome enters reconciliation after restart | `test/unit/foundation0/recovery.test.ts` | integration-with-fakes | none (in-memory state simulated) | Simulate crash by stopping test mid-flight, then restart and assert `reconciliation_required` + `reconciliation_observed`. |
| 11 | Concurrent JSONL writes do not interleave, duplicate sequence, or lose | `test/integration/foundation0/concurrent-append.test.ts` | integration-with-fakes | none (concurrent in-process appends) | Spawn N=10 concurrent appenders. Assert sequence is monotonic and no lines overlap. |
| 12 | Clean closeout blocked by residual active/stale/cleanup-pending/cleanup-failed | `test/unit/foundation0/closeout.test.ts` | unit | none | Seed resource in each blocking state, attempt clean closeout, expect `denied`. |
| 13 | Authorization revoked between acceptance and execution denies cleanup without signal | `test/unit/foundation0/policy-decision.test.ts` | fault-injection | none (fake clock + fake killer) | Inject clock advance past `expires_at` between intent and execution. Assert `denied` and no `kill()` call. |
| 14 | Concurrent cleanup with different idempotency keys allows one; other returns `cleanup_in_progress` | `test/unit/foundation0/idempotency.test.ts` | integration-with-fakes | none | Two parallel `terminate_resource` with different keys. Assert exactly one outcome + one `cleanup_in_progress`. |
| 15 | Crash after external effect but before outcome reconciled without repeating dangerous side effects | `test/unit/foundation0/recovery.test.ts` | fault-injection | none (fake killer records history) | Pre-record `kill()` call, simulate crash before outcome. On restart, recovery uses idempotency to skip re-kill. |
| 16 | Crash after resource creation but before activation uses pre-registered planned record | `test/unit/foundation0/pre-registration.test.ts` | fault-injection | none | Create planned resource, simulate crash. On restart, planned resource reconcilable. |
| 17 | Mission in `closing` rejects new `register_resource` | `test/unit/foundation0/mission-lifecycle.test.ts` | unit | none | Attempt `register_resource` in `closing` → `denied`. |
| 18 | Non-dedicated, non-runtime-owned process groups cannot receive group signal | `test/unit/foundation0/process-cleanup.test.ts` | integration-with-fakes | none | Resource with `dedicated_process_group = false`. Attempt group signal. Assert denial. |
| 19 | Temp quarantine race safely fails when target/marker/symlink state changes | `test/unit/foundation0/temp-cleanup.test.ts` | fault-injection | none (sandboxed temp dir) | Inject inspector that returns mutated marker mid-cleanup. Assert `cleanup_failed` and `current_locator` recorded. |
| 20 | Fault injection: no external effect before intent + execution-boundary allowed decision durably committed | `test/unit/foundation0/durability.test.ts` | fault-injection | none (fault inject before durable commit) | Inject fault between intent and durable commit. Assert no external effect occurred. |
| 21 | Schema cross-field: planned Resource may lack identity; active without identity rejected | `test/unit/foundation0/schema.test.ts` | unit | none | Validator input matrix. |
| 22 | Action target validation: wrong target type for `close_mission` / `terminate_resource` rejected | `test/unit/foundation0/schema.test.ts` | unit | none | Schema validation rejects wrong target type. |
| 23 | Payload/fingerprint integrity: runtime recomputation mismatch prevents execution | `test/unit/foundation0/policy-decision.test.ts` | fault-injection | none | Caller supplies wrong `payload_digest`. Assert denial and `policy_decision_recorded`. |
| 24 | System-bootstrap confinement: cannot clean unregistered resources or arbitrary PID/path | `test/unit/foundation0/cleanup-guard.test.ts` | unit | none | System principal + `terminate_resource` on unregistered target → denied. |
| 25 | Temp identity digest is non-circular and independently verifiable | `test/unit/foundation0/schema.test.ts` | unit | none | Compute `identity_digest` from `identity_core` only; verify `marker_digest` independent. |
| 26 | Temp inode replacement protection | `test/unit/foundation0/temp-cleanup.test.ts` | fault-injection | none (sandboxed temp dir) | Replace directory with different inode mid-cleanup. Assert refusal. |
| 27 | Quarantine crash recovery: rename succeeded but delete not recorded recoverable | `test/unit/foundation0/recovery.test.ts` | integration-with-fakes | none (sandboxed temp dir) | Simulate crash after rename, before delete. On restart, recovery locates quarantine and resumes. |
| 28 | Signal-step reauthorization: auth revoked after SIGTERM prevents SIGKILL | `test/unit/foundation0/process-cleanup.test.ts` | fault-injection | none (fake clock + fake killer) | Inject clock advance past `expires_at` after SIGTERM. Assert no SIGKILL. |
| 29 | Reconciliation can progress after unresolved observations to final result | `test/unit/foundation0/recovery.test.ts` | unit | none | Sequence: `reconciliation_observed (still_unresolved)` × N → `reconciliation_resolved`. Assert ordering. |
| 30 | Closeout blocking covers planned, registered, cleanup_attempted, unverified | `test/unit/foundation0/closeout.test.ts` | unit | none | Seed each blocking state, attempt closeout, assert denial. |
| 31 | Missing event payload recovery | `test/unit/foundation0/recovery.test.ts` | fault-injection | none | Delete payload file referenced by event. On rebuild, assert `unsupported_schema_detected` and projection not advanced. |
| 32 | Conditional closeout binding: OwnerDecision/snapshot digest/residual mismatch rejected | `test/unit/foundation0/closeout.test.ts` | unit | none | OwnerDecision with mismatched `verified_through_sequence` rejected. |

Real-side-effects policy: **no acceptance test in the first slice may send
real broad signals to real processes outside the test sandbox.** All process
inspector / killer abstractions are required to be injectable. Real-signal
tests, if ever added later, require an explicit owner-approved smoke plan.

### Implementation checkpoints

Tests are grouped so Codex can authorize progress per checkpoint without
waiting for the whole slice to be done.

| Checkpoint | Scope | Tests |
|---|---|---|
| A | Schema + validation | 21, 22, 25 |
| B | Canonical event append + idempotency | 6, 11, 14 |
| C | Resource lifecycle + pre-registration | 16, 17 |
| D | Process cleanup safety (with fakes) | 4, 5, 7, 13, 15, 18, 20, 28 |
| E | Temp cleanup safety (sandboxed temp) | 8, 19, 26, 27 |
| F | Reconciliation + closeout | 9, 10, 12, 23, 24, 29, 30, 31, 32 |

## Implementation Task Decomposition

Each future task is described, not coded. Review gates are explicit. Pi may
execute T1-T6 in any order that respects dependencies; Codex authorizes each
review gate.

### Future Task T0: This Planning Gate

Files:
- Create: `records/2026-06-26-foundation-0-first-slice-planning-gate.md` (this file)

Goal: produce a reviewable planning artifact with all 11 sections + verification.

Review gate: Codex approves this report; only then does T1 begin.

Verification:
- `git status --short` shows only this report + the plan file as new (the plan was already present).
- `rg "T[O]DO|T[B]D|F[I]XME" records/2026-06-26-foundation-0-first-slice-planning-gate.md` returns no hits.
- No runtime or test file under `packages/pi-topology/` was modified.

### Future Task T1: First-Slice Schema Modules

Files:
- Create:
  - `packages/pi-topology/src/extension/topology/foundation0/schema.ts`
  - `packages/pi-topology/src/extension/topology/foundation0/validation.ts`
  - `packages/pi-topology/src/extension/topology/foundation0/ids.ts`
- Test:
  - `packages/pi-topology/test/unit/foundation0/schema.test.ts`

Goal: machine-checkable schemas for all 21 first-slice objects, with validators
that catch every cross-field rule listed in the "First-slice objects table".

Review gate: Codex reads the schemas against docs 19/20; approves before T2.

Verification: `node --experimental-strip-types --test test/unit/foundation0/schema.test.ts` passes; tests 21, 22, 25 from the Acceptance Test Plan pass.

### Future Task T2: Mission Event Lock + Canonical Event Append

Files:
- Create:
  - `packages/pi-topology/src/runtime/foundation0/lockfile.ts` (or accept `proper-lockfile` — Codex to decide in this review)
  - `packages/pi-topology/src/runtime/foundation0/event-append.ts`
- Test:
  - `packages/pi-topology/test/unit/foundation0/lockfile.test.ts`
  - `packages/pi-topology/test/integration/foundation0/concurrent-append.test.ts`

Goal: serialized append with payload-durability-before-event and
sequence-allocation-under-lock.

Review gate: Codex confirms lockfile strategy (hand-rolled vs dep).

Verification: tests 6, 11, 14 pass.

### Future Task T3: ManagedResource Lifecycle + Pre-Registration

Files:
- Create:
  - `packages/pi-topology/src/runtime/foundation0/resource-lifecycle.ts`
- Test:
  - `packages/pi-topology/test/unit/foundation0/pre-registration.test.ts`

Goal: 5-step pre-registration flow, lifecycle state machine, planned-vs-observed union.

Review gate: Codex confirms state-machine mapping matches D19 §8.1 + D20 §9.

Verification: tests 16, 17 pass.

### Future Task T4: ProcessIdentity + Process Inspector Abstraction

Files:
- Create:
  - `packages/pi-topology/src/runtime/foundation0/process-inspector.ts` (real macOS probe impl + injection seam)
  - `packages/pi-topology/src/runtime/foundation0/process-cleanup.ts`
- Test:
  - `packages/pi-topology/test/unit/foundation0/process-identity.test.ts`
  - `packages/pi-topology/test/unit/foundation0/process-cleanup.test.ts`
  - `packages/pi-topology/test/unit/foundation0/cli-protection.test.ts`

Goal: deterministic process identity from macOS probes; CLI/ancestor/PG
protection enforced; SIGTERM-grace-SIGKILL pipeline.

Review gate: Codex confirms probe table (raw `lsof -F st` vs `proc_pidinfo` vs
`ps -o args=` quoting) and CLI pgid detection.

Verification: tests 4, 5, 7, 13, 15, 18, 20, 28 pass.

### Future Task T5: InitialOutcome + Reconciliation (Resource-side)

Files:
- Create:
  - `packages/pi-topology/src/runtime/foundation0/cleanup-outcomes.ts`
  - `packages/pi-topology/src/runtime/foundation0/reconciliation.ts`
- Test:
  - `packages/pi-topology/test/unit/foundation0/recovery.test.ts`

Goal: action-specific outcome union, observation-vs-resolution split,
crash-window recovery for both process and temp.

Review gate: Codex confirms outcome mapping table aligns with D20 §10.

Verification: tests 9, 10, 15, 27, 29 pass.

### Future Task T6: TempDirectory Cleanup

Files:
- Create:
  - `packages/pi-topology/src/runtime/foundation0/temp-roots.ts`
  - `packages/pi-topology/src/runtime/foundation0/temp-cleanup.ts`
  - `packages/pi-topology/src/runtime/foundation0/temp-marker.ts`
- Test:
  - `packages/pi-topology/test/unit/foundation0/temp-cleanup.test.ts`

Goal: trusted approved-temp-root registry, marker file format, atomic
quarantine rename under approved root, non-circular digest, inode-protection.

Review gate: Codex confirms approved-temp-root policy is a code-frozen
constant, not a runtime config.

Verification: tests 8, 19, 25, 26, 27 pass.

### Future Task T7: Resource Ledger Projection

Files:
- Create:
  - `packages/pi-topology/src/runtime/foundation0/resource-ledger.ts`
- Test:
  - `packages/pi-topology/test/unit/foundation0/resource-ledger.test.ts`

Goal: rebuildable `resource-ledger.jsonl` projection from canonical events.

Review gate: Codex confirms rebuild-vs-append policy for this projection.

Verification: ledger round-trips after deliberate truncation + replay.

### Future Task T8: Cleanup Guard (Capabilities + Authorization Recheck)

Files:
- Create:
  - `packages/pi-topology/src/runtime/foundation0/cleanup-guard.ts`
- Test:
  - `packages/pi-topology/test/unit/foundation0/cleanup-guard.test.ts`
  - `packages/pi-topology/test/unit/foundation0/policy-decision.test.ts`

Goal: capability/authorization checks at acceptance and execution boundaries,
including system-bootstrap confinement.

Review gate: Codex confirms system-bootstrap rules per D20 §5.

Verification: tests 1, 2, 3, 23, 24 pass.

### Future Task T9: Evidence Subject + Schema

Files:
- Create:
  - `packages/pi-topology/src/runtime/foundation0/evidence.ts`
- Test:
  - `packages/pi-topology/test/unit/foundation0/evidence.test.ts`

Goal: `Evidence` record with `subject=managed_resource` for first slice.

Review gate: Codex confirms canonical JSON for evidence digest input.

Verification: tests 9, 31 pass.

### Future Task T10: Closeout

Files:
- Create:
  - `packages/pi-topology/src/runtime/foundation0/closeout.ts`
  - `packages/pi-topology/src/runtime/foundation0/owner-decision.ts`
- Test:
  - `packages/pi-topology/test/unit/foundation0/closeout.test.ts`

Goal: linearized closeout per D20 §15.3; conditional closeout binding.

Review gate: Codex confirms critical-section algorithm matches D20 §15.3.

Verification: tests 12, 30, 32 pass.

### Future Task T11: Integration Wiring

Files:
- Modify: `packages/pi-topology/src/extension/tools.ts`, `packages/pi-topology/src/extension/commands.ts` (only call-site wiring; no spawn semantics change)
- Test: existing `test/integration/dogfood.test.ts` continues to pass; new integration test for first-slice end-to-end.

Goal: integrate cleanup guard into existing `topology_spawn_role` /
`topology_cleanup` / `topology_close_mission` tools without changing launch
semantics.

Review gate: Codex confirms no behavior change for existing callers.

Verification: existing v0.5.1.5 integration test still passes; new first-slice
end-to-end test passes.

### Future Task T12: Documentation Pass

Files:
- Modify: `docs/08-maturity-roadmap.md`, `docs/14-pi-topology-mission-runtime-spec.md` add cross-reference to this report
- Create: `docs/21-pi-topology-v0.6-foundation-0-first-slice-implementation-record.md`

Goal: implementation record linking each future task to its review gate and verification.

Review gate: Codex approves wording.

Verification: cross-reference links resolve.

### Future Task T13: Acceptance Test Sweep

Files:
- Run: `npm run test && npm run test:integration`

Goal: tests 1-32 all pass.

Review gate: Codex confirms pass set is exactly tests 1-32 with no skipped/no-op.

Verification: full test output captured to artifact.

## Blockers And Open Questions

Categorized per the gate's required taxonomy.

### Contract blocker

- None remaining. Doc 20 closes every P0 contract gap that this planning gate depends on.

### Codebase discovery blocker

1. **Lockfile primitive choice.** Add `proper-lockfile` as a dev/transitive dep
   OR ship a hand-rolled `O_EXCL` lockfile helper in
   `packages/pi-topology/src/state/lockfile.ts`. Affects T2. Codex decides in
   the next review gate.
2. **Existing `runtime-events.jsonl` lock story.** The current event-log writer
   in `src/state/event-log.ts` uses `appendFile`/`appendFileSync` without a
   lock. First-slice must not break existing callers (v0.5.x callers rely on
   appendFile). Resolution: introduce the lock helper as a separate code path
   and migrate call sites gradually; do NOT retrofit the existing `event-log.ts`
   in this slice. Codex confirms this migration policy in next gate.

### Platform probe blocker

1. **Raw process start time.** Confirm `lsof -p <pid> -F st` is the canonical
   macOS read-only probe; or accept that first-slice uses `proc_pidinfo` via
   N-API (out of scope) and adopt `ps -o etime=` as a non-canonical hint.
2. **argv canonicalization.** `ps -o args=` is non-canonical (quoting). First-slice
   can accept the caveat and document it; or refuse to ship argv-based
   `command_digest` until a N-API binding lands. Codex to choose.
3. **CLI pgid detection.** Node exposes no `process.pgid`. Plan: cache one
   `ps -o pgid= -p <cli_pid>` at startup. Confirm acceptable.

### Test safety blocker

1. **Real-signal tests are forbidden in first-slice CI.** Plan enforces
   injected inspector/killer abstractions. If a future "real smoke" test is
   ever wanted, it requires an explicit owner-approved plan, off-CI, with a
   dedicated PID namespace or test-only process that is itself created via the
   new pre-registration flow.

### None

All other categories have a defined path in this report.

## Verification

Read-only/safe checks executed during this planning gate:

```text
$ git status --short
?? docs/16-pi-topology-collaboration-intro.md
?? docs/17-pi-topology-v0.6-collaboration-kernel-spec.md
?? docs/18-pi-topology-v0.6-collaboration-kernel-freeze-draft.md
?? docs/19-pi-topology-v0.6-foundation-0-first-slice-contract.md
?? docs/20-pi-topology-v0.6-foundation-0-first-slice-contract-closure.md
?? docs/Freeze-spec-review-5.5.md
?? docs/Multi-agent-structure-review.md
?? docs/Spec-review-5.5pro.md
?? docs/spec19-review-gpt5.5.md
?? docs/superpowers/plans/2026-06-26-foundation-0-first-slice-planning-gate.md
?? docs/superpowers/plans/2026-06-26-ghostty-single-instance-launch-research.md
?? records/2026-06-26-ghostty-single-instance-launch-research.md
?? records/2026-06-26-foundation-0-first-slice-planning-gate.md   (this report)
```

The first twelve entries were already untracked before this gate (per plan's
"treat all current untracked docs/review files as owner/Codex context; do not
clean, restore, or stage them" rule). The thirteenth entry is the only file
this gate produces.

```text
$ rg "T[O]DO|T[B]D|F[I]XME" records/2026-06-26-foundation-0-first-slice-planning-gate.md
(no matches)
```

No runtime or test file under `packages/pi-topology/src/` or
`packages/pi-topology/test/` was modified by this gate. No `pkill`, `kill`,
filesystem deletion, Ghostty launch, or dogfood occurred. No commit was
produced.

## Inline Report Summary

Decision: ready_for_codex_review.
Artifact: `records/2026-06-26-foundation-0-first-slice-planning-gate.md`.
Coverage: doc 19 §3-§16, doc 20 §3-§17, tests 1-32, four runtime algorithms,
five recovery scenarios, one closeout linearization.
Blockers: 0 contract blockers; 2 codebase discovery blockers (lockfile choice,
existing writer migration policy); 3 platform probe blockers (start-time probe,
argv canonicalization, CLI pgid); 1 test safety blocker (no real broad signals
in CI). Codex authorization needed on each before the corresponding future
task begins.
Next step: Codex reviews this report and authorizes Future Task T1 (first-slice
schema modules) or sends back a delta before any code is written.