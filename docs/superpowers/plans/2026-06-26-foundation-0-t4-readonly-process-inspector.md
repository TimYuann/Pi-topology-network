# Foundation-0 T4 Read-Only Process Inspector

Date: 2026-06-26
Owner: HQ/Codex
Executor: Coder
Reviewer: Reviewer
Status: ready for HQ review

## Context

T1/T1.1 established the Foundation-0 schema contract. T2 added mission-scoped canonical event append. T3 added pure ManagedResource lifecycle and pre-registration primitives. The external 5.5pro review approves moving to T4 only if T4 remains a strictly read-only observation boundary.

T4 introduces a ProcessIdentity / ProcessInspector abstraction for host process facts. It must not become cleanup execution.

## Contract References

- `docs/19-pi-topology-v0.6-foundation-0-first-slice-contract.md` §9 Process Identity
- `docs/19-pi-topology-v0.6-foundation-0-first-slice-contract.md` §13 acceptance tests 4, 5, 18
- `docs/20-pi-topology-v0.6-foundation-0-first-slice-contract-closure.md` §12 Process Identity And Signal Steps
- `docs/T4precheck-5.5pro.md`
- `docs/2026-06-26-foundation-0-phase-a-review-brief.md`

Doc 20 supersedes conflicting first-slice semantics in doc 19.

## Scope

Allowed implementation files:

- `packages/pi-topology/src/runtime/foundation0/process-inspector.ts`

Allowed test/report files:

- `packages/pi-topology/test/unit/foundation0/process-inspector.test.ts`
- `records/2026-06-26-foundation-0-t4-readonly-process-inspector.md`

Minimal import/export adjustments inside `packages/pi-topology/src/runtime/foundation0/` are allowed if needed. Do not modify existing v0.5 runtime integration paths.

## Hard Non-Goals

T4 must not implement or invoke any external effect.

Forbidden in T4:

- No signal sending.
- No `process.kill`.
- No `kill`, `pkill`, `killall`, `xargs kill`, or negative-PID process-group signal.
- No process termination, cleanup attempt execution, or cleanup outcome append.
- No temp-directory cleanup, quarantine, recursive delete, unlink, rmdir, rm, or temp artifact deletion.
- No Ghostty launch.
- No Pi topology mission spawn.
- No `topology_spawn_role`, dogfood, v0.5 runtime integration, or existing command/runtime behavior changes.
- No package dependency changes.
- No commit, push, publish, broad cleanup, or reviewer/coder routing from this doc.

T4 may run read-only process probes only where tests require live host facts. Unit behavior must be fake-inspector-first.

## Required Behavior

### 1. ProcessIdentity Shape

Use the current Foundation-0 schema shape:

```ts
export interface ProcessIdentity {
  pid: number;
  pgid: number;
  start_time_seconds: number;
  start_time_microseconds: number;
  spawn_nonce?: string;
  executable: string;
  argv: string[];
  cwd: string;
  command_digest: string;
  dedicated_process_group: boolean;
}
```

`spawn_nonce` is provenance. It is not a cleanup-time live probe unless a later task defines a reliable live observation mechanism. T4 must not reintroduce `spawn_token`.

`command_digest` must be computed from canonicalized identity command facts:

```text
sha256(canonical({
  executable_realpath,
  argv,
  cwd_realpath
}))
```

### 2. ProcessInspectionResult Union

Define an explicit result union. Do not collapse incomplete probes into unsafe success.

Required statuses:

```ts
type ProcessInspectionResult =
  | { status: "present_exact"; identity: ProcessIdentity; protection: ProcessProtectionFacts }
  | { status: "absent"; pid: number }
  | { status: "permission_denied"; pid: number; readable_fields: string[]; denied_fields: string[] }
  | { status: "unstable_process_exited_during_probe"; pid: number; readable_fields: string[] }
  | { status: "unsupported_platform"; platform: NodeJS.Platform }
  | { status: "partial_identity"; pid: number; partial: Partial<ProcessIdentity>; missing_fields: string[]; reason: string };
```

Safety rule for later tasks:

```text
Only present_exact may be considered eligible for future cleanup-time identity match.
All other statuses mean cannot verify exact identity, so later cleanup must not signal.
```

### 3. Inspector Interface

Expose a small interface that callers and tests can fake:

```ts
export interface ProcessInspector {
  inspect(pid: number): Promise<ProcessInspectionResult>;
  getCurrentProcessProtectionFacts(): Promise<ProcessProtectionFacts>;
}
```

`ProcessProtectionFacts` must include enough data for later cleanup gates:

```ts
export interface ProcessProtectionFacts {
  current_pid: number;
  current_pgid: number;
  ancestor_pids: number[];
  protected_pids: number[];
  protected_pgids: number[];
}
```

`protected_pids` must include the current CLI process and ancestors. `protected_pgids` must include the CLI-containing process group.

### 4. macOS Read-Only Probe Fields

T4 supports macOS only for real host probes. Non-macOS must return `unsupported_platform`, not a fake success.

Document and implement read-only probes for:

- `pid`: caller input; validate positive integer.
- `pgid`: `ps -o pgid= -p <pid>`.
- raw process start tuple: use a read-only macOS source and preserve seconds + microseconds when available. If the chosen source cannot provide exact precision, return `partial_identity` and record the missing precision.
- `executable`: read-only process text path source, then `realpath`.
- `cwd`: read-only cwd source, then `realpath`.
- `argv`: read-only argv source. If argv cannot be parsed without ambiguity, return `partial_identity` with the raw string in the report/evidence helper rather than pretending canonical argv is exact.
- current CLI ancestors: walk `ppid` chain with `ps` output.
- process group membership: compare target `pgid` with current CLI `pgid`.

Do not use fuzzy process-name matching as identity.

### 5. Protection Predicates

Provide pure helpers for later cleanup gates:

```ts
isProtectedPid(pid, protectionFacts)
isProtectedProcessGroup(pgid, protectionFacts)
doesIdentityMatchExpected(observed, expected)
```

Required protections:

- Current CLI PID is protected.
- Ancestor PIDs are protected.
- CLI-containing process group is protected.
- Non-dedicated or non-runtime-owned process groups are not eligible for future group signaling.
- PID alone is never sufficient identity.
- PID reuse with different start time is mismatch.
- Same PID/start but different PGID is mismatch.
- Executable, cwd, argv, or command digest mismatch is mismatch.

These helpers must be pure and must not send signals.

## Required Tests

Use injected fake inspectors first. Tests must not send real signals.

Focused test coverage:

- Fake inspector returns `present_exact` for a full identity.
- Fake inspector returns `absent` for a missing PID.
- Fake inspector returns `permission_denied` without treating it as identity match.
- Fake inspector returns `unstable_process_exited_during_probe` without treating it as identity match.
- Fake inspector returns `unsupported_platform` without treating it as identity match.
- Fake inspector returns `partial_identity` when argv/cwd/executable/start time is unavailable.
- PID reuse with different start tuple fails identity match.
- Same PID/start with PGID mismatch fails identity match.
- Executable mismatch fails identity match.
- CWD mismatch fails identity match.
- argv mismatch fails identity match.
- command digest mismatch fails identity match.
- Current CLI PID is protected.
- Ancestor PID is protected.
- CLI-containing process group is protected.
- Non-dedicated process group is not marked eligible for future group signal.
- No test calls `process.kill`, `kill`, `pkill`, `killall`, dogfood cleanup, Ghostty, or topology spawn.

Optional real macOS probe tests may inspect the current process only. They must skip safely on unsupported platform or missing read-only probe tools.

## Verification Commands

Run from `packages/pi-topology/`:

```bash
node --experimental-strip-types --test test/unit/foundation0/process-inspector.test.ts
node --experimental-strip-types --test test/unit/foundation0/*.test.ts
npm run typecheck
```

Record exact commands and results in the T4 report. If optional live macOS probe tests are skipped, record the skip reason.

## Report

Create:

```text
records/2026-06-26-foundation-0-t4-readonly-process-inspector.md
```

The report must include:

- Files changed.
- ProcessInspectionResult statuses implemented.
- macOS probe sources chosen for each field.
- argv parsing/canonicalization limitations.
- behavior for permission denied, process exit during probe, zombie/unstable process, and unsupported platform.
- CLI/self/ancestor/process-group protection summary.
- Verification results.
- Explicit statement that no signal, kill, cleanup, temp deletion, Ghostty launch, Pi topology spawn, dogfood, or v0.5 runtime integration was implemented or invoked.

## HQ Review Gate

T4 is ready for delegation only after HQ accepts this boundary:

```text
T4 = read-only process inspection and protection facts.
T4 != cleanup execution.
```

Any real signal, temp deletion, process cleanup, durable cleanup-attempt acquisition, or v0.5 runtime integration requires a separate later task doc and review gate.
