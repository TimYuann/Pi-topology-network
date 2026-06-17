import path from "node:path";
import { existsSync } from "node:fs";
import type { MissionCard, RolePolicy, TopologyRole } from "./mission.ts";

/**
 * Launch metadata — the contract for any role-launch attempt.
 *
 * Spec reference: `docs/14-pi-topology-mission-runtime-spec.md` §6.1
 *
 * Every role launch (whether by direct script, Ghostty GUI, or future native
 * spawn) MUST be backed by a `LaunchMetadata` record whose fields match the
 * Mission's role policy. The runtime validates the metadata BEFORE writing or
 * launching a role script; a mismatch must:
 *   1. block the launch
 *   2. append an incident
 *   3. append a `launch_blocked` runtime event
 *   4. leave existing evidence untouched
 *
 * Slice 2 contract:
 *   - type LaunchMetadata (12 fields per spec §6.1)
 *   - buildLaunchMetadata: derive defaults from MissionCard + role + script path
 *   - validateLaunchMetadata: enforce role policy + path safety
 *
 * Read-only roles (runner / oracle / librarian / scott) must use
 * `allowed_paths: []` AND `write_policy: 'read_only'` (per the spec review
 * Gap 3.7 follow-up). The builder enforces this default; callers may
 * explicitly override but validation rejects downgrades.
 */

export interface LaunchMetadata {
  mission_id: string;
  role: TopologyRole;
  session_id: string | null;
  script_path: string;
  provider: string;
  model: string;
  thinking: string;
  tools: string[];
  write_policy: RolePolicy["write_policy"];
  allowed_paths: string[];
  forbidden_actions: string[];
  permission_source: string;
}

export interface BuildLaunchMetadataInput {
  mission: MissionCard;
  role: TopologyRole;
  scriptPath: string;
  /** Defaults to "minimax-cn" if not provided. */
  provider?: string;
  /** Defaults to "MiniMax-M3" if not provided. */
  model?: string;
  /** Defaults to "low" if not provided. */
  thinking?: string;
  /** Defaults to ["read", "bash", "edit", "write", "topology_*"] if not provided. */
  tools?: string[];
  session_id?: string | null;
  /** Defaults to the absolute path of the Mission's mission-card.json. */
  permission_source?: string;
}

const DEFAULT_PROVIDER = "minimax-cn";
const DEFAULT_MODEL = "MiniMax-M3";
const DEFAULT_THINKING = "low";
const DEFAULT_TOOLS = ["read", "bash", "edit", "write", "topology_*"];

export function buildLaunchMetadata(input: BuildLaunchMetadataInput): LaunchMetadata {
  const rolePolicy = input.mission.roles[input.role];
  if (!rolePolicy) {
    throw new Error(
      `buildLaunchMetadata: role ${JSON.stringify(input.role)} not present in mission ${input.mission.mission_id}`,
    );
  }
  const isReadOnly = rolePolicy.write_policy === "read_only";
  return {
    mission_id: input.mission.mission_id,
    role: input.role,
    session_id: input.session_id ?? null,
    script_path: input.scriptPath,
    provider: input.provider ?? DEFAULT_PROVIDER,
    model: input.model ?? DEFAULT_MODEL,
    thinking: input.thinking ?? DEFAULT_THINKING,
    tools: input.tools ?? [...DEFAULT_TOOLS],
    // Per spec review follow-up: read-only roles MUST carry an empty allowed_paths
    // list (no write paths) and the mission's role policy write_policy.
    allowed_paths: isReadOnly ? [] : [...input.mission.allowed_paths],
    forbidden_actions: [...input.mission.forbidden_actions],
    write_policy: rolePolicy.write_policy,
    permission_source:
      input.permission_source ?? path.join(input.mission.workdir, "mission-card.json"),
  };
}

export type LaunchValidationFailure =
  | "mission_mismatch"
  | "role_not_in_mission"
  | "write_policy_mismatch"
  | "allowed_paths_not_subset"
  | "forbidden_actions_missing"
  | "permission_source_missing"
  | "script_path_outside_workspace"
  | "read_only_role_with_write_paths";

export interface LaunchValidationResult {
  ok: boolean;
  failure?: LaunchValidationFailure;
  reason?: string;
  incident?: {
    type: "role_policy_violation" | "permission_envelope_broken";
    detail: string;
  };
}

function isPathInsideWorkspace(absolutePath: string, workspaceDir: string): boolean {
  const resolved = path.resolve(absolutePath);
  const workspace = path.resolve(workspaceDir);
  return resolved === workspace || resolved.startsWith(workspace + path.sep);
}

export function validateLaunchMetadata(
  metadata: LaunchMetadata,
  mission: MissionCard,
  workspaceDir?: string,
): LaunchValidationResult {
  // mission_id must match the Mission card.
  if (metadata.mission_id !== mission.mission_id) {
    return {
      ok: false,
      failure: "mission_mismatch",
      reason: `metadata.mission_id ${JSON.stringify(metadata.mission_id)} does not match mission ${JSON.stringify(mission.mission_id)}`,
      incident: {
        type: "permission_envelope_broken",
        detail: "Launch metadata mission_id diverges from Mission card",
      },
    };
  }

  // role must be in the mission.
  const rolePolicy = mission.roles[metadata.role];
  if (!rolePolicy) {
    return {
      ok: false,
      failure: "role_not_in_mission",
      reason: `role ${JSON.stringify(metadata.role)} is not in mission.roles`,
      incident: {
        type: "role_policy_violation",
        detail: `Unknown role ${metadata.role} for mission ${mission.mission_id}`,
      },
    };
  }

  // write_policy must match the mission's role policy exactly.
  if (metadata.write_policy !== rolePolicy.write_policy) {
    return {
      ok: false,
      failure: "write_policy_mismatch",
      reason: `metadata.write_policy ${JSON.stringify(metadata.write_policy)} does not match mission.roles.${metadata.role}.write_policy ${JSON.stringify(rolePolicy.write_policy)}`,
      incident: {
        type: "role_policy_violation",
        detail: `Role ${metadata.role} attempted launch with mismatched write_policy`,
      },
    };
  }

  // Read-only roles MUST have empty allowed_paths; non-read-only roles MUST
  // have allowed_paths that is a subset of mission.allowed_paths.
  if (rolePolicy.write_policy === "read_only") {
    if (metadata.allowed_paths.length !== 0) {
      return {
        ok: false,
        failure: "read_only_role_with_write_paths",
        reason: `read_only role ${JSON.stringify(metadata.role)} must have empty allowed_paths; got ${metadata.allowed_paths.length} entries`,
        incident: {
          type: "role_policy_violation",
          detail: `Read-only role ${metadata.role} was given write-capable allowed_paths`,
        },
      };
    }
  } else {
    for (const p of metadata.allowed_paths) {
      if (!mission.allowed_paths.includes(p)) {
        return {
          ok: false,
          failure: "allowed_paths_not_subset",
          reason: `metadata.allowed_paths entry ${JSON.stringify(p)} is not in mission.allowed_paths`,
          incident: {
            type: "permission_envelope_broken",
            detail: `allowed_paths escape mission.allowed_paths boundary`,
          },
        };
      }
    }
  }

  // forbidden_actions must include all mission.forbidden_actions.
  for (const action of mission.forbidden_actions) {
    if (!metadata.forbidden_actions.includes(action)) {
      return {
        ok: false,
        failure: "forbidden_actions_missing",
        reason: `metadata.forbidden_actions missing required mission action ${JSON.stringify(action)}`,
        incident: {
          type: "permission_envelope_broken",
          detail: `forbidden_actions envelope broken for ${mission.mission_id}`,
        },
      };
    }
  }

  // permission_source must point to an existing file when supplied.
  if (metadata.permission_source && !existsSync(metadata.permission_source)) {
    return {
      ok: false,
      failure: "permission_source_missing",
      reason: `metadata.permission_source ${JSON.stringify(metadata.permission_source)} does not exist`,
      incident: {
        type: "permission_envelope_broken",
        detail: "Launch metadata points to a missing mission card",
      },
    };
  }

  // script_path should live inside the workspace (defensive; not strict for
  // /tmp workdirs used by the visible peer mesh).
  if (workspaceDir && !isPathInsideWorkspace(metadata.script_path, workspaceDir) && !metadata.script_path.startsWith("/tmp/")) {
    return {
      ok: false,
      failure: "script_path_outside_workspace",
      reason: `metadata.script_path ${JSON.stringify(metadata.script_path)} is outside workspaceDir ${JSON.stringify(workspaceDir)} and not a /tmp workdir`,
      incident: {
        type: "permission_envelope_broken",
        detail: "Launch script path escapes workspace and /tmp workdir",
      },
    };
  }

  return { ok: true };
}
