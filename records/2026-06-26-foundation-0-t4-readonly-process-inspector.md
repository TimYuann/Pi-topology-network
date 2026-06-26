# Foundation-0 T4 Read-Only Process Inspector Report

Date: 2026-06-26
Role: Coder
Decision: ready_for_codex_review
Base: `e2c0c38`

## Plan Input

- `docs/superpowers/plans/2026-06-26-foundation-0-t4-readonly-process-inspector.md`

T4 boundary applied:

```text
T4 = read-only process inspection and protection facts.
T4 != cleanup execution.
```

## Files Changed

- `packages/pi-topology/src/runtime/foundation0/process-inspector.ts`
- `packages/pi-topology/test/unit/foundation0/process-inspector.test.ts`
- `records/2026-06-26-foundation-0-t4-readonly-process-inspector.md`

No package dependencies were added.

## Implemented API

`process-inspector.ts` defines:

- `ProcessProtectionFacts`
- `ProcessInspectionResult`
- `ProcessInspector`
- `HostProcessInspector`
- `buildProcessCommandDigest`
- `isProtectedPid`
- `isProtectedProcessGroup`
- `doesIdentityMatchExpected`
- `isEligibleForFutureProcessGroupSignal`

Implemented `ProcessInspectionResult` statuses:

- `present_exact`
- `absent`
- `permission_denied`
- `unstable_process_exited_during_probe`
- `unsupported_platform`
- `partial_identity`

Safety rule preserved: only `present_exact` carries a full `ProcessIdentity`. Other statuses do not qualify as identity matches for later cleanup-time decisions.

## macOS Read-Only Probe Sources

`HostProcessInspector` returns `unsupported_platform` for non-macOS inspection.

macOS probes are read-only and use `execFile`, not a shell:

- `pid`: caller input, validated as a positive safe integer.
- `pgid`: `ps -ww -o pgid= -p <pid>`.
- start seconds: `ps -ww -o lstart= -p <pid>`, parsed to epoch seconds.
- start microseconds: not available from the chosen read-only `ps` source, so real macOS inspection returns `partial_identity` rather than pretending exact precision.
- `executable`: `ps -ww -o comm= -p <pid>`, followed by `realpath` when possible.
- `cwd`: `lsof -a -d cwd -Fn -p <pid>`, followed by `realpath` when possible.
- `argv`: `ps -ww -o command= -p <pid>` is intentionally treated as raw/ambiguous and not parsed into canonical argv for exact identity.
- ancestors: walks `ppid` with `ps -ww -o ppid= -p <pid>`.
- current process group: `ps -ww -o pgid= -p <currentPid>`.

## Limitations And Edge Behavior

- argv parsing: macOS `ps command` is not an unambiguous argv vector, so the host inspector records `argv` as missing and returns `partial_identity`.
- start precision: `ps lstart` does not provide microseconds, so `start_time_microseconds` is missing for real host probes.
- permission denied: returns `permission_denied` with readable and denied field names.
- process exit during probe: if a process disappears after initial readable fields, returns `unstable_process_exited_during_probe`.
- unsupported platform: returns `unsupported_platform`; it does not synthesize a fake success.
- zombie or otherwise incomplete process facts degrade to `partial_identity` or `unstable_process_exited_during_probe`.

## Protection Summary

`getCurrentProcessProtectionFacts` protects:

- current CLI PID,
- ancestor PIDs,
- current CLI-containing process group.

Pure helpers enforce:

- PID alone is not sufficient identity.
- PID reuse with a different start tuple is mismatch.
- Same PID/start with different PGID is mismatch.
- executable, cwd, argv, or command digest mismatch is mismatch.
- current CLI PID and ancestor PIDs are protected.
- current CLI process group is protected.
- non-dedicated process groups are not eligible for future group signal decisions.

## Verification

Run from `packages/pi-topology/`:

```text
node --experimental-strip-types --test test/unit/foundation0/process-inspector.test.ts
PASS: 16/16

node --experimental-strip-types --test test/unit/foundation0/*.test.ts
PASS: 42/42

npm run typecheck
PASS: strip-types import ok
```

Static forbidden-call scan:

```text
rg -n "process\\.kill|\\bkill\\b|\\bpkill\\b|\\bkillall\\b|unlink|rmdir|rm -|topology_spawn_role|Ghostty|spawn\\(" \
  packages/pi-topology/src/runtime/foundation0/process-inspector.ts \
  packages/pi-topology/test/unit/foundation0/process-inspector.test.ts
PASS: no matches
```

Optional live macOS current-process probe tests were not added. The required T4 tests are fake-inspector-first; live probe exactness is intentionally limited by ambiguous argv and missing microsecond start precision.

## Scope Statement

No signal sending, `process.kill`, `kill`, `pkill`, `killall`, process termination, cleanup attempt execution, cleanup outcome append, temp-directory cleanup, quarantine, recursive delete, unlink, rmdir, rm, temp artifact deletion, Ghostty launch, Pi topology spawn, dogfood, v0.5 runtime integration, package dependency change, commit, push, or publish was implemented or invoked.
