import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProcessCommandDigest,
  doesIdentityMatchExpected,
  isEligibleForFutureProcessGroupSignal,
  isProtectedPid,
  isProtectedProcessGroup,
  type ProcessInspectionResult,
  type ProcessInspector,
  type ProcessProtectionFacts,
} from "../../../src/runtime/foundation0/process-inspector.ts";
import type { ProcessIdentity } from "../../../src/runtime/foundation0/schema.ts";

function protectionFacts(): ProcessProtectionFacts {
  return {
    current_pid: 100,
    current_pgid: 1000,
    ancestor_pids: [50, 1],
    protected_pids: [100, 50, 1],
    protected_pgids: [1000],
  };
}

function processIdentity(overrides: Partial<ProcessIdentity> = {}): ProcessIdentity {
  const executable = overrides.executable ?? "/usr/local/bin/node";
  const argv = overrides.argv ?? ["node", "worker.js"];
  const cwd = overrides.cwd ?? "/tmp/foundation0";
  return {
    pid: 200,
    pgid: 2000,
    start_time_seconds: 1_735_678_900,
    start_time_microseconds: 123456,
    spawn_nonce: "spawn_nonce_001",
    executable,
    argv,
    cwd,
    command_digest: buildProcessCommandDigest({
      executable_realpath: executable,
      argv,
      cwd_realpath: cwd,
    }),
    dedicated_process_group: true,
    ...overrides,
  };
}

function fakeInspector(result: ProcessInspectionResult): ProcessInspector {
  return {
    async inspect() {
      return result;
    },
    async getCurrentProcessProtectionFacts() {
      return protectionFacts();
    },
  };
}

test("fake inspector returns present_exact for a full identity", async () => {
  const identity = processIdentity();
  const inspector = fakeInspector({
    status: "present_exact",
    identity,
    protection: protectionFacts(),
  });

  const result = await inspector.inspect(identity.pid);

  assert.equal(result.status, "present_exact");
  assert.equal(
    result.status === "present_exact" && doesIdentityMatchExpected(result.identity, identity),
    true,
  );
});

test("fake inspector returns absent for a missing PID", async () => {
  const result = await fakeInspector({ status: "absent", pid: 999 }).inspect(999);

  assert.deepEqual(result, { status: "absent", pid: 999 });
});

test("permission denied is not treated as an identity match", async () => {
  const result = await fakeInspector({
    status: "permission_denied",
    pid: 200,
    readable_fields: ["pid"],
    denied_fields: ["argv", "cwd"],
  }).inspect(200);

  assert.equal(result.status, "permission_denied");
  assert.equal(result.status === "present_exact", false);
});

test("unstable process exit during probe is not treated as an identity match", async () => {
  const result = await fakeInspector({
    status: "unstable_process_exited_during_probe",
    pid: 200,
    readable_fields: ["pid", "pgid"],
  }).inspect(200);

  assert.equal(result.status, "unstable_process_exited_during_probe");
  assert.equal(result.status === "present_exact", false);
});

test("unsupported platform is not treated as an identity match", async () => {
  const result = await fakeInspector({
    status: "unsupported_platform",
    platform: "linux",
  }).inspect(200);

  assert.equal(result.status, "unsupported_platform");
  assert.equal(result.status === "present_exact", false);
});

test("partial identity preserves missing fields instead of pretending exactness", async () => {
  const partial = { pid: 200, pgid: 2000 };
  const result = await fakeInspector({
    status: "partial_identity",
    pid: 200,
    partial,
    missing_fields: ["argv", "cwd", "executable", "start_time_microseconds"],
    reason: "read-only probe could not recover exact identity",
  }).inspect(200);

  assert.equal(result.status, "partial_identity");
  assert.deepEqual(result.status === "partial_identity" && result.partial, partial);
});

test("PID reuse with a different start tuple fails identity match", () => {
  const expected = processIdentity();
  const observed = processIdentity({ start_time_microseconds: 654321 });

  assert.equal(doesIdentityMatchExpected(observed, expected), false);
});

test("same PID and start tuple with PGID mismatch fails identity match", () => {
  const expected = processIdentity();
  const observed = processIdentity({ pgid: 3000 });

  assert.equal(doesIdentityMatchExpected(observed, expected), false);
});

test("executable mismatch fails identity match", () => {
  const expected = processIdentity();
  const observed = processIdentity({ executable: "/bin/zsh" });

  assert.equal(doesIdentityMatchExpected(observed, expected), false);
});

test("CWD mismatch fails identity match", () => {
  const expected = processIdentity();
  const observed = processIdentity({ cwd: "/tmp/elsewhere" });

  assert.equal(doesIdentityMatchExpected(observed, expected), false);
});

test("argv mismatch fails identity match", () => {
  const expected = processIdentity();
  const observed = processIdentity({ argv: ["node", "other.js"] });

  assert.equal(doesIdentityMatchExpected(observed, expected), false);
});

test("command digest mismatch fails identity match", () => {
  const expected = processIdentity();
  const observed = processIdentity({
    command_digest: buildProcessCommandDigest({
      executable_realpath: "/usr/local/bin/node",
      argv: ["node", "worker.js", "--changed"],
      cwd_realpath: "/tmp/foundation0",
    }),
  });

  assert.equal(doesIdentityMatchExpected(observed, expected), false);
});

test("current CLI PID is protected", () => {
  assert.equal(isProtectedPid(100, protectionFacts()), true);
});

test("ancestor PID is protected", () => {
  assert.equal(isProtectedPid(50, protectionFacts()), true);
});

test("CLI-containing process group is protected", () => {
  assert.equal(isProtectedProcessGroup(1000, protectionFacts()), true);
});

test("non-dedicated process group is not eligible for future group signal", () => {
  const identity = processIdentity({ dedicated_process_group: false });

  assert.equal(isEligibleForFutureProcessGroupSignal(identity, protectionFacts()), false);
});
