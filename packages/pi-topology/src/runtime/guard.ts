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
  /**
   * Active Mission id (v0.5.1 Slice C). When set, per-mission
   * `.pi/topology/missions/<mission_id>/artifacts/<role>/` is added to
   * the controlled-coordination allowlist for `topology-supervisor` and
   * `hq`. The legacy root `.pi/topology/artifacts/<role>/` is also kept
   * for backward compatibility.
   */
  mission_id?: string;
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
  /**
   * v0.5.1 Slice C: actionable guidance returned to the LLM explaining
   * why the tool call was blocked and what to do instead. Mirrored in
   * the tool_call handler's block reason.
   */
  tool_guidance?: string[];
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
      tool_guidance: [
        "Ask the owner explicitly before retrying the shell command (forbidden_actions requires owner gate).",
        "Use a read-only tool (read, grep, find, ls) for inspection, or break the work into smaller non-forbidden commands.",
      ],
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
      reason: `${input.role} cannot write through shell commands — use the topology_write_artifact tool to write ${input.role} artifacts to .pi/topology/${input.mission.mission_id ? `missions/${input.mission.mission_id}/artifacts/${input.role}/` : `artifacts/${input.role}/`}`,
      tool_guidance: [
        `Use topology_write_artifact (role=${input.role}, kind=...) to write a long report or artifact; it routes to .pi/topology/${input.mission.mission_id ? `missions/${input.mission.mission_id}/artifacts/${input.role}/` : `artifacts/${input.role}/`}.`,
        `Do NOT use shell redirection (cat >, tee, sed -i, etc.) for ${input.role} writes — that path is reserved for repair and is blocked for all other roles.`,
        `Read-only inspection is fine via read/grep/find/ls.`,
      ],
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
      reason: `${input.role} cannot write artifacts for ${input.artifact_role ?? "another role"} — each role can only write its own artifacts`,
      tool_guidance: [
        `topology_write_artifact only allows a role to write its own artifacts/<role>/ dir.`,
        `If you need to share evidence, hand off via topology_send (REPORT packet) or have the other role write the artifact themselves.`,
      ],
      incident: incidentRecord,
    };
  }

  if (!writes) return { decision: "allow" };

  if (input.path && isControlledCoordinationWrite(input.role, input.path, input.mission.allowed_paths, input.mission.mission_id)) {
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
      tool_guidance: [
        `${input.role} is a read-only role. Use read/grep/find/ls for inspection.`,
        `To share a long report as ${input.role}, ask HQ to call topology_write_artifact on your behalf via a topology_send REPORT packet.`,
      ],
      incident: incidentRecord,
    };
  }

  if (input.role !== "repair") {
    const incidentRecord = incident("role_boundary_violation", input.role, `${input.role} attempted a write tool`, {
      tool: input.tool,
      path: input.path,
    });
    persistIncident(incidentRecord);
    const perMissionDir = input.mission.mission_id
      ? `.pi/topology/missions/${input.mission.mission_id}/artifacts/${input.role}/`
      : `.pi/topology/artifacts/${input.role}/`;
    return {
      decision: "block",
      reason: `${input.role} is not the default writer role — use topology_write_artifact to write to ${perMissionDir}`,
      tool_guidance: [
        `For long reports/decisions, use topology_write_artifact(role=${input.role}, ...) — it routes to ${perMissionDir} and is the only sanctioned ${input.role} write.`,
        `For short status packets, use topology_send (REPORT/STATUS/VERDICT) — packet bodies are NOT file writes.`,
        `Project file writes require the repair role; ${input.role} should not edit project files directly.`,
      ],
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
      tool_guidance: [
        `Only write within mission.allowed_paths.`,
        `If the path must change, surface this as a scope-expansion owner gate (spec §4.6) — do NOT bypass by writing outside allowed_paths.`,
      ],
      incident: incidentRecord,
    };
  }

  return { decision: "allow" };
}

function isControlledCoordinationWrite(
  role: GuardRole,
  filePath: string,
  allowedPaths: string[],
  missionId?: string,
): boolean {
  if (role !== "topology-supervisor" && role !== "hq") return false;
  if (!isPathInsideAllowed(filePath, allowedPaths)) return false;
  // Per-mission artifacts path (v0.5.1 Slice C): when mission_id is known,
  // also allow `.pi/topology/missions/<mission_id>/artifacts/<role>/`.
  const perMissionPrefix = missionId
    ? `.pi/topology/missions/${missionId}/artifacts/${role}/`
    : null;
  // Legacy root mirror: `.pi/topology/artifacts/<role>/` (kept for compat).
  const legacyPrefix = `.pi/topology/artifacts/${role}/`;
  return allowedPaths.some((allowedPath) => {
    const normalized = relative(allowedPath, filePath).split(sep).join("/");
    if (normalized.startsWith("..") || normalized === "") return false;
    if (normalized.startsWith("docs/")) return true;
    if (normalized.startsWith(legacyPrefix)) return true;
    if (perMissionPrefix && normalized.startsWith(perMissionPrefix)) return true;
    return false;
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
