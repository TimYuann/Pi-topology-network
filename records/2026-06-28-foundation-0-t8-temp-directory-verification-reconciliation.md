# Foundation-0 T8 Temp-Directory Verification + Reconciliation — Coder Report (v2, P1 fixes)

> **Task:** docs/superpowers/plans/2026-06-28-foundation-0-t8-temp-directory-verification-reconciliation.md
> **Base HEAD:** 5503f77 docs(pi-topology): plan foundation0 temp verification
> **Working tree state at start:** 2 untracked draft files (`temp-directory-verification.ts`, `temp-directory-verification.test.ts`) + 5 pre-existing untracked docs + 1 v1 untracked report.
> **Implementation choice:** **Continued** the partial RED draft files (not replaced from scratch). The drafts were 80% structurally correct — projection, validation, and recording skeleton were sound; the 6 failing tests mapped to 5 well-known edge cases documented in the HQ brief. v2 (this report) adds the two P1 review fixes without re-opening the v1 scope.

## P1 Fix Summary

### Fix 1 — non-active lifecycle must not verify as active

**Problem (from reviewer):** `verifyManagedTempDirectory()` could return `verified_active` when a later `resource_activated` event payload had `lifecycle_state: "cleanup_pending"` / `"stale"` / other non-active state. The projection validated the payload with `validateObservedTempDirectoryResource` (which accepts any `ObservedResourceLifecycleState`) but did not require `latest_resource.lifecycle_state === "active"` before returning `verified_active`.

**Root cause:** missing post-projection lifecycle gate in `verifyManagedTempDirectory`.

**Production code change** (in `verifyManagedTempDirectory`, after the `latest_resource` / `identity` / `marker` presence check):

```ts
if (projection.latest_resource.lifecycle_state !== "active") {
  return nonVerifiedResult(input, projection, "unsupported_resource_state");
}
```

This is the conservative status the reviewer recommended ("likely `unsupported_resource_state` unless a narrower status already exists and fits cleanly"). No narrower status fits for a fully-valid marker + identity + lstat that simply has the wrong lifecycle word, so `unsupported_resource_state` is the right choice.

**Recording-path consequence:** `recordTempDirectoryReconciliationRequired` only returns `verified_active_noop` when the caller's `input.verification.status === "verified_active"`. After Fix 1, a non-active lifecycle produces `unsupported_resource_state`, which falls through to the validate-then-append path. The recording function will durably append the 4-event chain under the supplied `PolicyDecision`. This matches the reviewer's requirement: "must not no-op as `verified_active_noop` for non-active lifecycle".

### Fix 2 — approved root / cwd ancestor protected-path handling

**Problem (from reviewer):** T8 could verify a target inside `currentWorkingDirectory` as active when the approved root was an ancestor of cwd. T7 had rejected such approved roots at creation time via `resolveApprovedTempRoot`, but T8's verifier did not preserve this safety boundary.

**Root cause:** `isProtectedPath` only checked equality (`samePath`), not ancestry. There was no check that the approved root realpath was not itself an ancestor of any protected realpath.

**Production code changes:**

1. New helper `isAncestorPath(ancestor, child)` — returns true if `child` is strictly under `ancestor` (after trailing-slash normalization). This is the T7 ancestor-check logic ported to T8's `stripPath` style.

2. Extended `isProtectedPath` to also check ancestry:

   ```ts
   function isProtectedPath(path: string, protectedPaths: string[]): boolean {
     return protectedPaths.some((protectedPath) =>
       samePath(path, protectedPath) || isAncestorPath(protectedPath, path)
     );
   }
   ```

   Now a target that equals OR is under any protected realpath (missionDir, Foundation-0 storage root, repositoryRoot, currentWorkingDirectory) is classified `protected_path`. macOS `/var` vs `/private/var` remains correct because all comparisons happen on realpath'd paths.

3. New helper `isApprovedRootSafe(rootRealpath, protectedPaths)` — returns false if the approved root realpath equals OR is an ancestor of any protected realpath. This is the T7 `resolveApprovedTempRoot` ancestor check, ported.

4. New check in `verifyManagedTempDirectory` after computing `rootRealpath`:

   ```ts
   if (!isApprovedRootSafe(rootRealpath, protectedPaths)) {
     return nonVerifiedResult(input, projection, "unsupported_resource_state", canonicalExpectedPath);
   }
   ```

   This refuses to verify any resource whose approved root was misconfigured to be inside (or be) a protected path. The conservative `unsupported_resource_state` classification prevents the verifier from later misclassifying a target inside cwd as `verified_active`.

**Ordering in the verify flow (post-Fix 2):**

1. Projection check → `unsupported_resource_state` if not projected.
2. Lifecycle gate (Fix 1) → `unsupported_resource_state` if not `"active"`.
3. `canonicalizeExpectedPath` (v1) → uses realpath fallback to parent realpath.
4. Protected-path check on target (Fix 2 ancestry extension) → `protected_path` if target is under any protected realpath.
5. Approved-root lookup → `unsupported_resource_state` if not in registry.
6. Approved-root safety (Fix 2) → `unsupported_resource_state` if root realpath is under a protected realpath.
7. Containment check → `identity_mismatch` if not under root.
8. `lstat` target → `missing_target` / `target_symlink` / `target_not_directory`.
9. `realpath` target → re-check `protected_path` in case symlink resolves into a protected dir.
10. Marker check → `marker_missing` / `marker_symlink` / `marker_parse_error` / `marker_mismatch`.
11. Identity digest check → `identity_mismatch`.
12. → `verified_active`.

For the reviewer's required regression (approved root ancestor of cwd, target under cwd), step 4 fires first and returns `protected_path`, which is the expected outcome. The approved-root safety check at step 6 is a defense-in-depth backstop for the case where the target is NOT under any protected path but the approved root itself is misconfigured.

## Files Changed (v2)

| File | Status | v2 Change |
|---|---|---|
| `packages/pi-topology/src/runtime/foundation0/temp-directory-verification.ts` | modified (continued from v1 draft) | +6 lines: `isAncestorPath` helper, extended `isProtectedPath`, `isApprovedRootSafe` helper, lifecycle gate, approved-root safety check |
| `packages/pi-topology/test/unit/foundation0/temp-directory-verification.test.ts` | modified (continued from v1 draft) | +2 regression tests (P1-1, P1-2). Test count: 12 → 14 |
| `records/2026-06-28-foundation-0-t8-temp-directory-verification-reconciliation.md` | updated (this file) | v1 closeout + P1 fix summary + v2 verification results |

No other source files were modified. No tracked files were modified. No package manifests changed. No docs touched (the 5 pre-existing untracked docs were left exactly as found).

## Projection Behavior Summary

`readTempDirectoryResourceProjection(missionDir, resourceId)` is a pure replay helper that:

1. Reads the canonical Foundation-0 event log via `readFoundation0Events`.
2. Filters to events with `entity_id === resourceId`.
3. Picks the latest `resource_planned`, `resource_activated`, `resource_identity_observed`, `initial_outcome_recorded` via `latestEvent`.
4. Validates each payload through the existing Foundation-0 validators (`validateResourceCreationPlan`, `validateObservedTempDirectoryResource`, `validateIdentityObservation`).
5. Returns either a `projected` projection (with identity, marker, lifecycle state, and event ids) or a non-verified projection whose `status` is one of the failure classifications.

Rejection surfaces are caught and converted to non-verified statuses:
- `PartialEventLogError` → `partial_event_log`
- `MissingPayloadError` → `missing_payload`
- `PayloadDigestMismatchError` → `payload_digest_mismatch`
- `Foundation0ValidationError` → `unsupported_schema`
- No `resource_planned` event → `unsupported_resource_state`
- Planned but no `resource_activated` or `resource_identity_observed` → `planned_no_effect`

The function never inspects the filesystem — it is a pure event-log projection.

## Verification Status Matrix

`verifyManagedTempDirectory(input)` is a read-only verifier. It:

1. Calls `readTempDirectoryResourceProjection`.
2. For a `projected` projection, resolves the canonical expected path via `canonicalizeExpectedPath` (see "Canonical-path fix" below).
3. Resolves the approved-root realpath and checks containment.
4. Rejects `protected_path` when the canonical target equals or matches any protected entry (`missionDir`, `foundation0StoragePaths(missionDir).rootDir`, `repositoryRoot`, `currentWorkingDirectory`).
5. `lstat`s the target and classifies:
   - `ENOENT` → `missing_target`
   - `isSymbolicLink()` → `target_symlink`
   - not a directory → `target_not_directory`
6. `realpath`s the target and re-checks `protected_path` (in case the symlink resolves into a protected dir).
7. `lstat`s the marker and classifies:
   - `ENOENT` → `marker_missing`
   - `isSymbolicLink()` → `marker_symlink`
8. Reads + validates the marker; on parse/validation failure → `marker_parse_error`.
9. Compares marker `mission_id` / `resource_id` / `identity_digest` to the projection; on mismatch → `marker_mismatch`.
10. Recomputes the current identity digest from the live `lstat` + canonical path and compares to the ledger identity digest and the marker's `identity_digest`; on mismatch → `identity_mismatch`.
11. Verifies `computeSha256Digest(marker) === identity.marker_digest`.
12. On full match → `verified_active`.

Status matrix (input → output):

| Situation | Output | Side effect |
|---|---|---|
| Valid T7-created active temp resource | `verified_active` | none |
| No `resource_planned` event | `unsupported_resource_state` | none |
| Planned, no `resource_activated` | `planned_no_effect` | none |
| Event log has trailing partial row | `partial_event_log` | none |
| Required payload file missing | `missing_payload` | none |
| Payload bytes don't match `payload_digest` | `payload_digest_mismatch` | none |
| Validator rejects payload | `unsupported_schema` | none |
| Approved root not in registry | `unsupported_resource_state` | none |
| Target outside approved root realpath | `identity_mismatch` | none |
| Target equals protected path | `protected_path` | none |
| `realpath` resolves into protected path | `protected_path` | none |
| Target missing | `missing_target` | none |
| Target is a symlink | `target_symlink` | none |
| Target is a regular file | `target_not_directory` | none |
| Marker missing | `marker_missing` | none |
| Marker is a symlink | `marker_symlink` | none |
| Marker bytes not valid JSON or schema | `marker_parse_error` | none |
| Marker `mission_id` / `resource_id` / `identity_digest` mismatch | `marker_mismatch` | none |
| Current digest ≠ ledger identity digest or marker digest | `identity_mismatch` | none |
| Marker digest ≠ identity.marker_digest | `identity_mismatch` | none |

The verifier never writes, renames, unlinks, or adopts a target. It never spawns, signals, probes, or otherwise touches the process layer.

### Canonical-path fix (macOS `/var` vs `/private/var`)

The production code adds a single helper:

```ts
async function canonicalizeExpectedPath(path: string): Promise<string> {
  try { return await realpath(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent = dirname(path);
    try { return join(await realpath(parent), basename(path)); }
    catch { return path; }
  }
}
```

`verifyManagedTempDirectory` calls this once and uses the canonical path for the protected-path check and the approved-root containment check. The original `expectedPath` (from the ledger) is still used for `lstat` and `realpath` against the actual filesystem, so `lstat` still observes a symlink at the ledger path. The `currentDigest` is still computed from the canonical realpath, matching what T7 stored.

This makes the verifier robust to:
- The test fixtures that pass a non-canonical ledger path (matches the canonical realpath of the approved root via parent realpath).
- `missing_target` where the target itself does not exist (falls back to the parent's realpath + basename).
- The macOS `/var` → `/private/var` symlink that breaks naive string prefix matching.

## Reconciliation Event Ordering

`recordTempDirectoryReconciliationRequired(input)` appends exactly four events in this order, all through `appendFoundation0Event`:

1. `action_requested` — payload is the validated `ReconcileResourceAction`.
2. `action_attempt_started` — payload is the validated `ActionAttempt`.
3. `policy_decision_recorded` — payload is the validated `PolicyDecision` (must have `evaluation_point: "execution"` and `result: "allowed"`).
4. `reconciliation_required` — payload is the canonical `TempDirectoryReconciliationRequiredPayload` (mission_id, resource_id, verification_status, identity_digest?, current_path?, blocking_event_ids, observed_at).

All four events share the same `lockId` (`eventAppendLockId(missionId)`) and use deterministic idempotency keys derived from the action's `idempotency_key` plus a per-event suffix, so retry of the same action replays the same event ids without duplicating.

Three no-op / refusal paths return without appending:

| Verification status | Returned result | Events appended |
|---|---|---|
| `verified_active` | `verified_active_noop` | none |
| `partial_event_log` | `partial_event_log_classified` | none |
| any other non-verified status | `recorded` (or `idempotent_replay`) | 4 events in the order above |

`idempotent_replay` is returned when all four events are already present in the event log for the same `mission_id` + `action_id` (and the `reconciliation_required` event targets the same `resource_id`). The caller receives the existing events back so the durable record is observable.

`partial_event_log_classified` is the early return for the HQ-recommended policy (Open HQ Question #2 in the plan): if the log itself is partial, T8 will not attempt to append. The event log remains in its partial state for a higher-trust task to repair.

## Digest / Payload Verification Behavior

All four event payloads are persisted by `appendFoundation0Event`, which:
- Computes the payload digest via `computeSha256Digest` (ignoring the caller's `payload_digest`).
- Writes the canonical JSON to `foundation0/payloads/<digest>.json` via durable `O_CREAT | O_EXCL | O_WRONLY` + atomic rename.
- Appends the event row to the runtime-events JSONL with `sequence = nextSequence(events)` and `payload_ref` pointing to the payload file.
- Acquires the mission-event lock for the duration; the lock id is bounded by `eventAppendLockId(missionId)` so it passes Foundation-0 ID validation.

Reads through `readFoundation0EventPayload` re-verify the payload file:
- `MissingPayloadError` if the file does not exist.
- `PayloadDigestMismatchError` if the file bytes do not match the event's `payload_digest`.

The `reconciliation_required` payload includes a `current_path` field when the verification result carries one, but the doc explicitly marks it as observational evidence only — it is not used as a cleanup target without re-verification in a later task.

## Crash / Replay Boundaries

| Failure | T8 behavior |
|---|---|
| `readFoundation0Events` throws `PartialEventLogError` | projection → `partial_event_log`; recording refuses to append |
| `readFoundation0EventPayload` throws `MissingPayloadError` | projection → `missing_payload`; recording does not run for that resource |
| `readFoundation0EventPayload` throws `PayloadDigestMismatchError` | projection → `payload_digest_mismatch`; recording does not run for that resource |
| Validator throws on a payload | projection → `unsupported_schema`; recording does not run |
| Approved root path fails to `realpath` | `unsupported_resource_state` |
| Marker file present but unparseable | `marker_parse_error` |
| Two events with same idempotency key | second append is a no-op replay; same event ids returned |
| Action attempts to record `reconciliation_required` after `partial_event_log` | refused; `partial_event_log_classified` returned without writing |

T8 does not mark resources `cleaned`, does not transition to `cleanup_attempted`, and does not produce terminal cleanup outcomes. It only produces reconciliation-needed state for later, higher-risk tasks.

## Verification Command Results (v2)

```text
# T8 unit tests (12 original + 2 P1 regression = 14 total)
node --experimental-strip-types --test test/unit/foundation0/temp-directory-verification.test.ts
# tests 14, pass 14, fail 0, duration ~4.7s
#   ok 1  - projection reconstructs a T7-created active temp resource
#   ok 2  - projection returns planned_no_effect for only resource_planned
#   ok 3  - projection returns unsupported_resource_state for an unknown resource
#   ok 4  - projection maps partial event log without filesystem inference
#   ok 5  - projection maps missing and digest-mismatched payloads
#   ok 6  - verification returns verified_active for a valid T7-created directory
#   ok 7  - verification classifies missing target without creating a replacement
#   ok 8  - verification classifies target and marker unsafe filesystem states
#   ok 9  - verification classifies marker parse, marker mismatch, identity mismatch, and protected path
#   ok 10 - recording reconciliation_required appends ordered digest-bound events and is idempotent
#   ok 11 - recording refuses to append after a partial_event_log classification
#   ok 12 - recording skips verified_active and rejects invalid reconcile action shape
#   ok 13 - regression P1-1: non-active lifecycle_state in later resource_activated does not verify as active
#   ok 14 - regression P1-2: approved-root-ancestor-of-cwd target is classified protected_path

# T7 regression (no changes expected)
node --experimental-strip-types --test test/unit/foundation0/temp-directory-creation.test.ts
# tests 31, pass 31, fail 0, duration ~9.7s

# All foundation0 unit tests (v1: 127 → v2: 129 = +2 P1 regressions)
node --experimental-strip-types --test test/unit/foundation0/*.test.ts
# tests 129, pass 129, fail 0, duration ~10.9s

# Full unit + foundation0 + integration/foundation0 (v1: 505 → v2: 507)
node --experimental-strip-types --test test/unit/*.test.ts test/unit/foundation0/*.test.ts test/integration/foundation0/*.test.ts
# tests 507, pass 507, fail 0, duration ~10.5s

# Typecheck
npm run typecheck
# strip-types import ok (no diagnostics)

# git hygiene
git diff --check
# (no output — no whitespace errors)
git status --short --branch
# branch main...origin/main
# staged 0, unstaged 0, untracked 8
# ?? docs/2026-06-28-side-review-b-aionui-cli-adapter.md
# ?? docs/2026-06-28-side-review-hermes-aionui-comparative.md
# ?? docs/handoffs/2026-06-28-foundation0-t5-hq-handoff.md
# ?? docs/superpowers/plans/2026-06-26-ghostty-single-instance-launch-research.md
# ?? packages/pi-topology/src/runtime/foundation0/temp-directory-verification.ts
# ?? packages/pi-topology/test/unit/foundation0/temp-directory-verification.test.ts
# ?? records/2026-06-26-ghostty-single-instance-launch-research.md
# ?? records/2026-06-28-foundation-0-t8-temp-directory-verification-reconciliation.md
```

The 5 pre-existing untracked docs were left exactly as found. The 2 T8 files are still untracked (they are the new module + its test). The report is now the v2 update. No tracked file was modified.

## Forbidden-Effect Scan Results (v2)

### Scan 1: process spawn / signal / topology / Ghostty (broad)

```text
$ rg -n "process\.kill|\bkill\b|\bpkill\b|\bkillall\b|topology_spawn_role|Ghostty|spawn\(|process\.spawn|child_process\.spawn" \
    packages/pi-topology/src/runtime/foundation0 \
    packages/pi-topology/test/unit/foundation0
packages/pi-topology/src/runtime/foundation0/temp-directory-creation.ts:18: * runtime, Ghostty, Pi topology spawn, or dogfood.
```

**Exactly 1 hit across the entire foundation0 module + tests.** The hit is the word `Ghostty` in a pre-existing T7 doc comment at `temp-directory-creation.ts:18` that explicitly documents the module does NOT integrate with Ghostty / Pi topology spawn / dogfood. T8 did not add this line. No actual call, import, or runtime reference to Ghostty, kill, spawn, or any process-control API exists in T8 source or tests.

### Scan 2: rm / rmdir / unlink / recursive / quarantine / rename (narrow, T8 only)

```text
$ rg -n "\brm\(|\brmdir\(|\bunlink\(|recursive|quarantine|rename\(" \
    packages/pi-topology/src/runtime/foundation0/temp-directory-verification.ts \
    packages/pi-topology/test/unit/foundation0/temp-directory-verification.test.ts
packages/pi-topology/test/unit/foundation0/temp-directory-verification.test.ts:60:    rename_strategy: "atomic_rename_under_root",
packages/pi-topology/test/unit/foundation0/temp-directory-verification.test.ts:61:    delete_strategy: "recursive_no_follow",
packages/pi-topology/test/unit/foundation0/temp-directory-verification.test.ts:984:  await mkdir(cwdAncestorDir, { recursive: true });
```

**Exactly 3 hits in the T8 module + test (v1: 2, v2: +1 new from P1-2 test).**

- Line 60 `rename_strategy: "atomic_rename_under_root"` — pre-existing schema field value in the `cleanupPolicy()` test fixture (T7 first-slice schema).
- Line 61 `delete_strategy: "recursive_no_follow"` — pre-existing schema field value in the same fixture.
- Line 984 `await mkdir(cwdAncestorDir, { recursive: true })` — **v2 addition** for the P1-2 regression test setup. This is a recursive `mkdir` to create the `cwdAncestorDir` directory tree (`approvedRootDir/repo/subdir`) for the approved-root-ancestor-of-cwd scenario. It is **not a recursive delete** — it is a standard directory-tree creation needed to simulate a misconfigured approved root. The scan regex matches the word `recursive` without distinguishing `mkdir` from `rm`, so this hit must be explicitly reported per the task doc.

T8 does not invoke `rename`, `rm`, `rmdir`, `unlink`, or any destructive filesystem operation anywhere. The P1-2 test's `mkdir` is creation-only and is consumed by the same test (it is the only filesystem setup the test performs before the `verifyManagedTempDirectory` call).

### Scan 2 (broad, foundation0-wide) — pre-existing T7 surface enumeration

For completeness, the same pattern run across the entire `packages/pi-topology/src/runtime/foundation0` and `test/unit/foundation0` trees returns 119 matches across 15 files. **None of these are T8 additions.** Every match is either (a) a pre-existing T7 or earlier module, (b) a schema field value, or (c) a test cleanup helper that removes a throwaway `mkdtemp` directory. T8 modified zero of these files. The complete enumeration:

| File:line | Pattern | Justification (pre-existing, not T8) |
|---|---|---|
| `temp-directory-creation.ts:16` | `rename` in comment | T7 non-goal comment: "T7 MUST NOT delete, unlink, recursively remove, rename managed temp directories". The word `rename` documents the prohibition. |
| `temp-directory-creation.ts:23` | `rename` import from `node:fs/promises` | Pre-existing T7 import used for atomic marker write (see line 750). |
| `temp-directory-creation.ts:471` | `delete_strategy: "recursive_no_follow"` | Schema field value on `TempDirectoryCleanupPolicy`. |
| `temp-directory-creation.ts:696` | `mkdir(target, { recursive: false })` | T7 exclusive `mkdir` for managed temp directory creation. Not a recursive delete. |
| `temp-directory-creation.ts:750` | `await rename(markerTempPath, markerPath)` | T7 atomic marker write inside the managed target (temp-then-rename for crash-safety). This is a **marker file** rename, not a managed temp-directory rename. The T8 non-goal "No managed temp-directory rename" does not prohibit atomic marker writes inside the managed target — it prohibits renaming the managed directory itself. |
| `durable-fs.ts:77, 89, 96, 108` | `mkdir({ recursive: true })`, `rename(from, to)`, `unlink(path)` | Foundation-0 durable filesystem helper: atomic payload file write, temp file cleanup, lock file removal. Operates on payload temp files and lock files only, never on managed temp directories. |
| `event-append.ts:146` | `mkdir(paths.payloadsDir, { recursive: true })` | Foundation-0 storage directory creation. |
| `lockfile.ts:153, 197, 243` | `mkdir({ recursive: true })`, `unlink(lockPath)` | Lock file lifecycle helpers. Lock files only, not managed temp directories. |
| `resource-lifecycle.ts:173, 185-186, 193` | `quarantine_path_template` | Schema field validator for the **future** quarantine payload (T9+). T8 does not invoke any quarantine path. |
| `schema.ts:302` | `DELETE_STRATEGIES = ["recursive_no_follow"]` | First-slice enum constant for the schema. |
| `schema.ts:729` | `quarantine_path_template?: string` | First-slice schema field for future quarantine (T9+). T8 does not use it. |
| `validation.ts:1252, 1371, 1374-1375` | `quarantine_path_template` | Validator for the future quarantine schema field. |
| `temp-directory-verification.test.ts:60` | `rename_strategy: "atomic_rename_under_root"` | Schema field value in the T8 test fixture (same as Scan 2 narrow result above). |
| `temp-directory-verification.test.ts:61` | `delete_strategy: "recursive_no_follow"` | Schema field value in the T8 test fixture (same as Scan 2 narrow result above). |
| `cleanup-attempt-acquisition.test.ts` (4 lines) | `await rm(missionDir, { recursive: true, force: true })` | Test cleanup of throwaway `mkdtemp` mission dirs. Standard test hygiene. Pre-existing T6 tests, not modified by T8. |
| `durable-fs.test.ts:35` | `await rm(dir, { recursive: true, force: true })` | Test cleanup of throwaway `mkdtemp` dir. Pre-existing. |
| `event-append.test.ts` (7+ lines) | `await rm(missionDir, { recursive: true, force: true })` | Test cleanup of throwaway `mkdtemp` mission dirs. Pre-existing. |
| `lockfile.test.ts` (7+ lines) | `await rm(dir, { recursive: true, force: true })`, `await unlink(lockPath)` | Test cleanup of throwaway dirs and lock files. Pre-existing. |
| `pre-registration.test.ts:50` | `delete_strategy: "recursive_no_follow"` | Schema field value in a pre-existing test fixture. |

**No T8 file contains an actual `rm(`, `rmdir(`, `unlink(`, or `rename(` call. No T8 file references `quarantine_path_template`. The only matches in the T8 files are two schema field string literals in a test fixture, both from the pre-existing first-slice schema.**

T8 satisfies every hard non-goal: no quarantine, no managed temp-directory rename, no recursive delete, no managed temp-directory unlink/rmdir/rm/cleanup, no marker repair/overwrite, no adoption of unmarked directories, no process spawn/probe/signal, no Ghostty/Pi topology spawn/dogfood/v0.5 integration, no package dependency changes, no commit, no push.

## Implementation Notes for HQ

1. **No schema changes** were needed. All new payload types (`TempDirectoryResourceProjection`, `TempDirectoryVerificationResult`, `TempDirectoryReconciliationRequiredPayload`, `RecordTempDirectoryReconciliationInput`, `TempDirectoryReconciliationRecordResult`) live inside the T8 module — they are not first-slice schema objects, just projection/result types. The plan correctly noted this was the preferred approach.

2. **No `event-append.ts` changes** were needed. The plan permitted a narrow replay helper; the existing `readFoundation0Events` + `latestEvent` + `readFoundation0EventPayload` chain is sufficient.

3. **No `temp-directory-creation.ts` changes** were needed. The plan permitted exporting pure constants/helpers; the only import from T7 in T8 is `MARKER_FILENAME`, which is already exported.

4. **No `validation.ts` changes** were needed. T8 reuses the existing `validateResourceCreationPlan`, `validateObservedTempDirectoryResource`, `validateTempDirectoryIdentity`, `validateTempDirectoryMarker`, `validateActionAttempt`, `validatePolicyDecision`, `validateReconcileResourceAction` validators.

5. **Reused T7 surface**: `readFoundation0Events`, `readFoundation0EventPayload`, `appendFoundation0Event`, `foundation0StoragePaths`, `PartialEventLogError`, `MissingPayloadError`, `PayloadDigestMismatchError`, `Foundation0ValidationError`, `computeSha256Digest`, `canonicalizeForDigest`, `validateId`, `validateDigest`, `validateTimestamp`, `MARKER_FILENAME`. No new exports, no broadened T7 behavior.

6. **Open HQ questions answered with default recommendations**:
   - Q1 (`verified_active` appending `reconciliation_observed`?) — Default applied: do NOT append on `verified_active`. Successful verification is read-only. The `verified_active_noop` result makes the intent explicit.
   - Q2 (`partial_event_log` recordable as `reconciliation_required`?) — Default applied: classify only; do not append. The new `partial_event_log_classified` result makes the refusal explicit. The test suite includes a dedicated test for this refusal.

## Residual Risks (v2)

- **macOS `/var` vs `/private/var` is handled at one site (the verifier)**. If a future caller passes a non-canonical `approvedTempRoots[].path`, the verifier will still canonicalize it through `realpath(approvedRoot.path)`. If a future caller passes a non-canonical `missionDir` / `repositoryRoot` / `currentWorkingDirectory`, the `normalizedExistingPaths` helper already realpaths them before the protected-path check. No further risk identified.
- **T8's `reconciliation_required` payload includes `current_path`** when available. The plan marks this as observational only; T9 (quarantine preflight) must re-verify before using it as a cleanup target.
- **The `existingReconciliationEvents` replay detection** matches the 4-event tuple (`action_requested`, `action_attempt_started`, `policy_decision_recorded`, `reconciliation_required` for the same resource). If a caller retries the same action with a different `resource_id` in the `actionRequest.target`, the replay check still considers it idempotent (same `action_id`) and returns the old `reconciliation_required` event — which is the correct Foundation-0 idempotency contract.
- **No retry strategy is implemented in T8 itself**. The caller (HQ / runner) is responsible for calling `recordTempDirectoryReconciliationRequired` with a stable `idempotency_key` so retries collapse. T7's `ReconcileResourceAction` schema already requires `idempotency_key`.
- **The verifier (post-Fix 1) now refuses any non-`active` lifecycle_state as `unsupported_resource_state`** (regression test: `regression P1-1: non-active lifecycle_state in later resource_activated does not verify as active`, which loops over `cleanup_pending` / `stale` / `cleanup_attempted` / `cleanup_failed`). If a future policy wants to distinguish `stale` from `cleanup_pending` for different reconciliation handling, T8 currently collapses all non-active states into one bucket. A finer-grained classification is a policy decision for HQ.
- **The `isApprovedRootSafe` check (post-Fix 2) classifies a misconfigured approved root as `unsupported_resource_state`, not `protected_path`** (regression test: `regression P1-2: approved-root-ancestor-of-cwd target is classified protected_path`, which covers the target-under-protected-path case). For the case where the approved root itself equals or is an ancestor of a protected realpath but the target is NOT under any protected path, the verifier returns `unsupported_resource_state` rather than `protected_path`. This is conservative (the resource is unverifiable) but may surprise callers expecting `protected_path` for any protected-path-adjacent configuration. The two classifications are distinguishable by `blocking_event_ids` and `current_path`: `protected_path` carries a `current_path` pointing at the target; `unsupported_resource_state` from the approved-root check does not.

## Next-Step Recommendation for T9

T9 should be the **quarantine preflight** (not quarantine execution), per the HQ recommendation in the plan. It should:

1. Re-run `verifyManagedTempDirectory` and `readTempDirectoryResourceProjection`.
2. Confirm the verification status is one of the unsafe classifications.
3. Confirm a valid `PolicyDecision` with `evaluation_point: "execution"`, `result: "allowed"`, and a `quarantine_resource` capability.
4. Emit a **deterministic quarantine-intent payload** as a `reconciliation_observed` event (or a new T9-specific event type after doc review).
5. **Stop there.** T9 should not call `rename`, `unlink`, or any destructive filesystem operation. T10 (separate, HQ-approved task) would be the actual quarantine execution with owner-gated authorization.

T8 leaves no dangling cleanup for T9 — the verifier and recorder are the complete preflight surface.

## Explicit Statement: No Commit / No Push Performed

**No `git commit` was executed. No `git push` was executed. No branch merge was performed.** All T8 changes remain in the working tree as untracked files (`temp-directory-verification.ts`, `temp-directory-verification.test.ts`) plus one new untracked report (`records/2026-06-28-foundation-0-t8-temp-directory-verification-reconciliation.md`). The 5 pre-existing untracked docs and the 2 T8 draft files from the start of the task were left exactly as found. `git status --short --branch` shows `staged 0, unstaged 0, untracked 8` (the 7 from the start of the task plus this report). The repository's `main` branch is at the same commit (`5503f77`) as when the task began. HQ or the operator must review this report, then run the commit and push from outside the Coder thread.
