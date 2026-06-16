import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, relative, sep } from "node:path";
import { randomUUID } from "node:crypto";
import type { TopologyRole } from "./mission.ts";
import { isPathInsideAllowed } from "../utils/safe-paths.ts";

type ExternalReadOnlyRole = "scott" | "librarian";
type GuardRole = TopologyRole | ExternalReadOnlyRole;

export interface GuardMission {
  allowed_paths: string[];
  forbidden_actions: string[];
}

export interface GuardInput {
  role: GuardRole;
  mission: GuardMission;
  tool: "read_file" | "write_file" | "edit_file" | "shell" | string;
  path?: string;
  command?: string;
  artifact_role?: string;
  incident_log_path?: string;
}

export interface GuardIncident {
  incident_type: "scope_violation" | "role_boundary_violation" | "owner_gate";
  severity: "warn" | "error";
  actor: GuardRole;
  summary: string;
  evidence: Record<string, unknown>;
}

export interface GuardDecision {
  decision: "allow" | "block" | "owner_gate";
  reason?: string;
  incident?: GuardIncident;
}

export function evaluateToolCall(input: GuardInput): GuardDecision {
  const persistIncident = (incidentRecord: GuardIncident): void => {
    if (!input.incident_log_path) return;
    const entry = {
      incident_id: `inc_${randomUUID()}`,
      timestamp: new Date().toISOString(),
      ...incidentRecord,
    };
    mkdirSync(dirname(input.incident_log_path), { recursive: true });
    appendFileSync(input.incident_log_path, `${JSON.stringify(entry)}\n`, "utf8");
  };

  if (input.tool === "shell" && input.command && matchesForbiddenAction(input.command, input.mission.forbidden_actions)) {
    const incidentRecord = incident("owner_gate", input.role, `Owner gate required for command: ${input.command}`, {
      command: input.command,
    });
    persistIncident(incidentRecord);
    return {
      decision: "owner_gate",
      reason: "forbidden shell action requires owner confirmation",
      incident: incidentRecord,
    };
  }

  if (input.tool === "shell" && input.command && input.role !== "repair" && looksLikeShellWrite(input.command)) {
    const incidentRecord = incident("role_boundary_violation", input.role, `${input.role} attempted a shell write`, {
      tool: input.tool,
      command: input.command,
    });
    persistIncident(incidentRecord);
    return {
      decision: "block",
      reason: `${input.role} cannot write through shell commands`,
      incident: incidentRecord,
    };
  }

  const writes = input.tool === "write_file" || input.tool === "edit_file";
  if (input.tool === "topology_artifact_write") {
    if (input.artifact_role === input.role) return { decision: "allow" };
    const incidentRecord = incident("role_boundary_violation", input.role, `${input.role} attempted to write another role's artifact`, {
      tool: input.tool,
      artifact_role: input.artifact_role,
    });
    persistIncident(incidentRecord);
    return {
      decision: "block",
      reason: `${input.role} cannot write artifacts for ${input.artifact_role ?? "another role"}`,
      incident: incidentRecord,
    };
  }

  if (!writes) return { decision: "allow" };

  if (input.path && isControlledCoordinationWrite(input.role, input.path, input.mission.allowed_paths)) {
    return { decision: "allow" };
  }

  if (input.role === "runner" || input.role === "oracle" || input.role === "scott" || input.role === "librarian") {
    const incidentRecord = incident("role_boundary_violation", input.role, `${input.role} attempted a write tool`, {
      tool: input.tool,
      path: input.path,
    });
    persistIncident(incidentRecord);
    return {
      decision: "block",
      reason: `${input.role} is read-only by default`,
      incident: incidentRecord,
    };
  }

  if (input.role !== "repair") {
    const incidentRecord = incident("role_boundary_violation", input.role, `${input.role} attempted a write tool`, {
      tool: input.tool,
      path: input.path,
    });
    persistIncident(incidentRecord);
    return {
      decision: "block",
      reason: `${input.role} is not the default writer role`,
      incident: incidentRecord,
    };
  }

  if (!input.path || !isPathInsideAllowed(input.path, input.mission.allowed_paths)) {
    const incidentRecord = incident("scope_violation", input.role, "repair attempted write outside allowed_paths", {
      path: input.path,
      allowed_paths: input.mission.allowed_paths,
    });
    persistIncident(incidentRecord);
    return {
      decision: "block",
      reason: "write path is outside mission allowed_paths",
      incident: incidentRecord,
    };
  }

  return { decision: "allow" };
}

function isControlledCoordinationWrite(role: GuardRole, filePath: string, allowedPaths: string[]): boolean {
  if (role !== "topology-supervisor" && role !== "hq") return false;
  if (!isPathInsideAllowed(filePath, allowedPaths)) return false;
  return allowedPaths.some((allowedPath) => {
    const normalized = relative(allowedPath, filePath).split(sep).join("/");
    if (normalized.startsWith("..") || normalized === "") return false;
    return normalized.startsWith("docs/") || normalized.startsWith(`.pi/topology/artifacts/${role}/`);
  });
}

function matchesForbiddenAction(command: string, forbidden: string[]): boolean {
  const normalized = command.replace(/\s+/g, " ").trim();
  return forbidden.some((pattern) => normalized.includes(pattern));
}

function looksLikeShellWrite(command: string): boolean {
  const normalized = command
    .replace(/\s+/g, " ")
    .replace(/(^|[\s;&|])\d?>>?\s*\/dev\/null\b/g, "$1")
    .trim();
  return [
    /(^|[;&|]\s*)cat\s+>/.test(normalized),
    /(^|[;&|]\s*)tee(\s+-a)?\s+/.test(normalized),
    /(^|[;&|]\s*)touch\s+/.test(normalized),
    /(^|[;&|]\s*)mkdir\s+/.test(normalized),
    /(^|[;&|]\s*)mv\s+/.test(normalized),
    /(^|[;&|]\s*)cp\s+/.test(normalized),
    /(^|[;&|]\s*)rm\s+/.test(normalized),
    /(^|[;&|]\s*)sed\s+-i\b/.test(normalized),
    /(^|[;&|]\s*)perl\s+-pi\b/.test(normalized),
    /(^|[^<])>>?($|[^&])/.test(normalized),
  ].some(Boolean);
}

function incident(type: GuardIncident["incident_type"], actor: GuardRole, summary: string, evidence: Record<string, unknown>): GuardIncident {
  return {
    incident_type: type,
    severity: type === "owner_gate" ? "warn" : "error",
    actor,
    summary,
    evidence,
  };
}
