import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";

import type { ProcessIdentity } from "./schema.ts";
import { computeSha256Digest } from "./ids.ts";

const execFileAsync = promisify(execFile);

export interface ProcessProtectionFacts {
  current_pid: number;
  current_pgid: number;
  ancestor_pids: number[];
  protected_pids: number[];
  protected_pgids: number[];
}

export type ProcessInspectionResult =
  | {
      status: "present_exact";
      identity: ProcessIdentity;
      protection: ProcessProtectionFacts;
    }
  | { status: "absent"; pid: number }
  | {
      status: "permission_denied";
      pid: number;
      readable_fields: string[];
      denied_fields: string[];
    }
  | {
      status: "unstable_process_exited_during_probe";
      pid: number;
      readable_fields: string[];
    }
  | { status: "unsupported_platform"; platform: NodeJS.Platform }
  | {
      status: "partial_identity";
      pid: number;
      partial: Partial<ProcessIdentity>;
      missing_fields: string[];
      reason: string;
    };

export interface ProcessInspector {
  inspect(pid: number): Promise<ProcessInspectionResult>;
  getCurrentProcessProtectionFacts(): Promise<ProcessProtectionFacts>;
}

export interface ProcessCommandDigestInput {
  executable_realpath: string;
  argv: string[];
  cwd_realpath: string;
}

type ProbeValue =
  | { status: "value"; value: string }
  | { status: "absent" }
  | { status: "permission_denied" }
  | { status: "unavailable" };

function assertPositivePid(pid: number): void {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new RangeError(`pid must be a positive integer: ${pid}`);
  }
}

function parsePositiveInteger(value: string): number | undefined {
  const trimmed = value.trim();
  if (!/^[0-9]+$/.test(trimmed)) return undefined;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseMacStartSeconds(value: string): number | undefined {
  const millis = Date.parse(value.trim());
  if (!Number.isFinite(millis)) return undefined;
  return Math.floor(millis / 1000);
}

function resultFromCommandError(error: unknown): ProbeValue {
  const err = error as { code?: unknown; stderr?: unknown; message?: unknown };
  const stderr = typeof err.stderr === "string" ? err.stderr : "";
  const message = typeof err.message === "string" ? err.message : "";
  if (stderr.includes("Operation not permitted") || message.includes("Operation not permitted")) {
    return { status: "permission_denied" };
  }
  if (err.code === 1) return { status: "absent" };
  return { status: "unavailable" };
}

async function readPsField(pid: number, field: string): Promise<ProbeValue> {
  try {
    const { stdout } = await execFileAsync("ps", ["-ww", "-o", `${field}=`, "-p", String(pid)]);
    const value = stdout.trim();
    return value.length === 0 ? { status: "absent" } : { status: "value", value };
  } catch (error) {
    return resultFromCommandError(error);
  }
}

async function readCwdPath(pid: number): Promise<ProbeValue> {
  try {
    const { stdout } = await execFileAsync("lsof", ["-a", "-d", "cwd", "-Fn", "-p", String(pid)]);
    const pathLine = stdout
      .split("\n")
      .find((line) => line.startsWith("n") && line.length > 1);
    return pathLine === undefined
      ? { status: "unavailable" }
      : { status: "value", value: pathLine.slice(1) };
  } catch (error) {
    return resultFromCommandError(error);
  }
}

async function realpathOrUndefined(path: string): Promise<string | undefined> {
  try {
    return await realpath(path);
  } catch {
    return undefined;
  }
}

function uniquePositive(values: readonly number[]): number[] {
  return [...new Set(values.filter((value) => Number.isSafeInteger(value) && value > 0))];
}

export function buildProcessCommandDigest(input: ProcessCommandDigestInput): string {
  return computeSha256Digest({
    executable_realpath: input.executable_realpath,
    argv: input.argv,
    cwd_realpath: input.cwd_realpath,
  });
}

export function isProtectedPid(
  pid: number,
  protectionFacts: ProcessProtectionFacts,
): boolean {
  return protectionFacts.protected_pids.includes(pid);
}

export function isProtectedProcessGroup(
  pgid: number,
  protectionFacts: ProcessProtectionFacts,
): boolean {
  return protectionFacts.protected_pgids.includes(pgid);
}

function stringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function doesIdentityMatchExpected(
  observed: ProcessIdentity,
  expected: ProcessIdentity,
): boolean {
  return observed.pid === expected.pid
    && observed.pgid === expected.pgid
    && observed.start_time_seconds === expected.start_time_seconds
    && observed.start_time_microseconds === expected.start_time_microseconds
    && observed.executable === expected.executable
    && stringArraysEqual(observed.argv, expected.argv)
    && observed.cwd === expected.cwd
    && observed.command_digest === expected.command_digest
    && observed.dedicated_process_group === expected.dedicated_process_group;
}

export function isEligibleForFutureProcessGroupSignal(
  identity: Pick<ProcessIdentity, "pgid" | "dedicated_process_group">,
  protectionFacts: ProcessProtectionFacts,
): boolean {
  return identity.dedicated_process_group
    && !isProtectedProcessGroup(identity.pgid, protectionFacts);
}

export class HostProcessInspector implements ProcessInspector {
  private readonly platform: NodeJS.Platform;

  constructor(options: { platform?: NodeJS.Platform } = {}) {
    this.platform = options.platform ?? process.platform;
  }

  async inspect(pid: number): Promise<ProcessInspectionResult> {
    assertPositivePid(pid);
    if (this.platform !== "darwin") {
      return { status: "unsupported_platform", platform: this.platform };
    }

    const protection = await this.getCurrentProcessProtectionFacts();
    const partial: Partial<ProcessIdentity> = { pid };
    const readableFields = ["pid"];
    const missingFields: string[] = [];
    const deniedFields: string[] = [];

    const pgid = await readPsField(pid, "pgid");
    if (pgid.status === "absent") return { status: "absent", pid };
    if (pgid.status === "permission_denied") deniedFields.push("pgid");
    if (pgid.status === "unavailable") missingFields.push("pgid");
    if (pgid.status === "value") {
      const parsed = parsePositiveInteger(pgid.value);
      if (parsed === undefined) missingFields.push("pgid");
      else {
        partial.pgid = parsed;
        readableFields.push("pgid");
      }
    }

    const start = await readPsField(pid, "lstart");
    if (start.status === "absent") {
      return { status: "unstable_process_exited_during_probe", pid, readable_fields: readableFields };
    }
    if (start.status === "permission_denied") deniedFields.push("start_time_seconds");
    if (start.status === "unavailable") missingFields.push("start_time_seconds");
    if (start.status === "value") {
      const parsed = parseMacStartSeconds(start.value);
      if (parsed === undefined) missingFields.push("start_time_seconds");
      else {
        partial.start_time_seconds = parsed;
        readableFields.push("start_time_seconds");
      }
      missingFields.push("start_time_microseconds");
    }

    const command = await readPsField(pid, "command");
    if (command.status === "absent") {
      return { status: "unstable_process_exited_during_probe", pid, readable_fields: readableFields };
    }
    if (command.status === "permission_denied") deniedFields.push("argv");
    if (command.status !== "permission_denied") missingFields.push("argv");

    const executable = await readPsField(pid, "comm");
    if (executable.status === "absent") {
      return { status: "unstable_process_exited_during_probe", pid, readable_fields: readableFields };
    }
    if (executable.status === "permission_denied") deniedFields.push("executable");
    if (executable.status === "value") {
      const resolved = await realpathOrUndefined(executable.value);
      if (resolved === undefined) missingFields.push("executable");
      else {
        partial.executable = resolved;
        readableFields.push("executable");
      }
    } else if (executable.status !== "permission_denied") {
      missingFields.push("executable");
    }

    const cwd = await readCwdPath(pid);
    if (cwd.status === "absent") {
      return { status: "unstable_process_exited_during_probe", pid, readable_fields: readableFields };
    }
    if (cwd.status === "permission_denied") deniedFields.push("cwd");
    if (cwd.status === "value") {
      const resolved = await realpathOrUndefined(cwd.value);
      if (resolved === undefined) missingFields.push("cwd");
      else {
        partial.cwd = resolved;
        readableFields.push("cwd");
      }
    } else if (cwd.status !== "permission_denied") {
      missingFields.push("cwd");
    }

    if (deniedFields.length > 0) {
      return {
        status: "permission_denied",
        pid,
        readable_fields: readableFields,
        denied_fields: uniqueStrings(deniedFields),
      };
    }

    if (
      partial.pgid !== undefined &&
      partial.start_time_seconds !== undefined &&
      partial.start_time_microseconds !== undefined &&
      partial.executable !== undefined &&
      partial.argv !== undefined &&
      partial.cwd !== undefined
    ) {
      const identity: ProcessIdentity = {
        pid,
        pgid: partial.pgid,
        start_time_seconds: partial.start_time_seconds,
        start_time_microseconds: partial.start_time_microseconds,
        executable: partial.executable,
        argv: partial.argv,
        cwd: partial.cwd,
        command_digest: buildProcessCommandDigest({
          executable_realpath: partial.executable,
          argv: partial.argv,
          cwd_realpath: partial.cwd,
        }),
        dedicated_process_group: partial.pgid !== protection.current_pgid,
      };
      return { status: "present_exact", identity, protection };
    }

    return {
      status: "partial_identity",
      pid,
      partial,
      missing_fields: uniqueStrings(missingFields),
      reason: "macOS read-only probes could not recover exact argv and microsecond start precision",
    };
  }

  async getCurrentProcessProtectionFacts(): Promise<ProcessProtectionFacts> {
    const currentPid = process.pid;
    if (this.platform !== "darwin") {
      return {
        current_pid: currentPid,
        current_pgid: currentPid,
        ancestor_pids: [],
        protected_pids: [currentPid],
        protected_pgids: [currentPid],
      };
    }

    const currentPgid = await readCurrentPgid(currentPid);
    const ancestorPids = await readAncestorPids(currentPid);
    return {
      current_pid: currentPid,
      current_pgid: currentPgid,
      ancestor_pids: ancestorPids,
      protected_pids: uniquePositive([currentPid, ...ancestorPids]),
      protected_pgids: uniquePositive([currentPgid]),
    };
  }
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

async function readCurrentPgid(currentPid: number): Promise<number> {
  const pgid = await readPsField(currentPid, "pgid");
  if (pgid.status !== "value") return currentPid;
  return parsePositiveInteger(pgid.value) ?? currentPid;
}

async function readParentPid(pid: number): Promise<number | undefined> {
  const ppid = await readPsField(pid, "ppid");
  return ppid.status === "value" ? parsePositiveInteger(ppid.value) : undefined;
}

async function readAncestorPids(currentPid: number): Promise<number[]> {
  const ancestors: number[] = [];
  let next = await readParentPid(currentPid);
  const seen = new Set<number>([currentPid]);
  while (next !== undefined && !seen.has(next)) {
    ancestors.push(next);
    seen.add(next);
    if (next === 1) break;
    next = await readParentPid(next);
  }
  return ancestors;
}
