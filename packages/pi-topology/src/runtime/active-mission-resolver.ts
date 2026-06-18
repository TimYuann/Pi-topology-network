/**
 * Active Mission runtime resolver (Slice A of v0.5.1 runtime alignment).
 *
 * Spec references:
 *   - `docs/14-pi-topology-mission-runtime-spec.md` §3.1 (per-mission layout)
 *   - `docs/14-pi-topology-mission-runtime-spec.md` §3.2 (root mirror)
 *   - `docs/14-pi-topology-mission-runtime-spec.md` §3.3 (active pointer)
 *
 * Contract:
 *   - `.pi/topology/missions/<mission_id>/` is the canonical source of truth
 *     for an active Mission in per-mission mode.
 *   - `.pi/topology/*` (root) is a compatibility mirror of the active Mission.
 *     It is NEVER a second source of truth.
 *   - `mission-registry.json` and `active-mission.json` are the per-mission
 *     registry index; legacy root `mission-card.json` is fallback only.
 *
 * Resolution order:
 *   1. env var `PI_TOPOLOGY_MISSION_CARD` (when pointing inside cwd and the
 *      file exists) → use that path directly. This is the role-child-session
 *      case where the env var is set by the launch script.
 *   2. `mission-registry.json` + `active-mission.json` both exist → use
 *      `missions/<active_mission_id>/` as canonical. This is the
 *      migrated/canonical path.
 *   3. root `mission-card.json` exists, no registry → legacy mode; use root
 *      paths as both canonical and mirror.
 *   4. otherwise → mode "none".
 *
 * The returned `rootMirror` paths are always the root `.pi/topology/...`
 * paths; in legacy mode they coincide with `canonical` paths; in per-mission
 * mode they are the mirror copies maintained by `syncRootMirrorFromLayout`.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  missionDirectoryRelative,
  missionLayoutPaths,
  type MissionLayoutPaths,
} from "./mission-layout.ts";
import {
  readMissionRegistry,
  type MissionRegistry,
} from "./mission-registry.ts";
import { readActiveMissionPointer } from "./mission-pointer.ts";
import { isPathInsideAllowed } from "../utils/safe-paths.ts";

export type ActiveMissionMode = "per-mission" | "legacy" | "none";

export interface RootMirrorPaths {
  missionCardPath: string;
  statusBoardPath: string;
  eventLogPath: string;
  incidentLogPath: string;
  sessionsPath: string;
  /** Root mirror launch dir (mirror of per-mission launch/<role>.sh). */
  launchDir: string;
  /** Root mirror artifacts dir (mirror of per-mission artifacts/<role>/). */
  artifactsDir: string;
  /** Root mirror packet ledger path. */
  packetLedgerPath: string;
}

export interface ActiveMissionResolution {
  mode: ActiveMissionMode;
  /** The active mission_id, or null when mode === "none". */
  missionId: string | null;
  /** The project name (from mission card). */
  project: string | null;
  /** Resolved workspace dir (absolute). */
  workdir: string;
  /** Per-mission canonical paths (or null when mode === "none"). */
  missionCardPath: string | null;
  statusBoardPath: string | null;
  eventLogPath: string | null;
  incidentLogPath: string | null;
  sessionsPath: string | null;
  packetLedgerPath: string | null;
  launchDir: string | null;
  artifactsDir: string | null;
  /** Always present: root mirror paths. In legacy mode they ARE the canonical. */
  rootMirror: RootMirrorPaths;
  /** Resolution notes (e.g. "stale pointer", "env override", "registry active"). */
  warnings: string[];
}

/**
 * Root mirror paths relative to workspaceDir. Computed once per call.
 */
function rootMirrorPaths(workspaceDir: string): RootMirrorPaths {
  return {
    missionCardPath: path.join(workspaceDir, ".pi", "topology", "mission-card.json"),
    statusBoardPath: path.join(workspaceDir, ".pi", "topology", "status-board.json"),
    eventLogPath: path.join(workspaceDir, ".pi", "topology", "runtime-events.jsonl"),
    incidentLogPath: path.join(workspaceDir, ".pi", "topology", "incident-log.jsonl"),
    sessionsPath: path.join(workspaceDir, ".pi", "topology", "sessions.jsonl"),
    launchDir: path.join(workspaceDir, ".pi", "topology", "launch"),
    artifactsDir: path.join(workspaceDir, ".pi", "topology", "artifacts"),
    packetLedgerPath: path.join(workspaceDir, ".pi", "topology", "packet-ledger.jsonl"),
  };
}

function readMissionCardProject(workspaceDir: string, missionCardPath: string): string | null {
  if (!existsSync(missionCardPath)) return null;
  try {
    const raw = readFileSync(missionCardPath, "utf8");
    const obj = JSON.parse(raw) as { project?: unknown };
    if (typeof obj.project === "string" && obj.project.trim()) {
      return obj.project.trim();
    }
  } catch {
    // fallthrough
  }
  // Fallback: basename of workspaceDir.
  return path.basename(workspaceDir) || null;
}

function registryActiveMission(registry: MissionRegistry): string | null {
  if (registry.active_mission_id) return registry.active_mission_id;
  // No active set; use the most recently updated non-archived mission.
  let best: { id: string; updated_at: string } | null = null;
  for (const entry of registry.missions) {
    if (entry.archived) continue;
    if (!best || entry.last_updated_at > best.updated_at) {
      best = { id: entry.mission_id, updated_at: entry.last_updated_at };
    }
  }
  return best?.id ?? null;
}

/**
 * Resolve the active Mission paths for a given workspace dir.
 *
 * Returns the resolution object. Never throws (stale pointers, missing
 * files, invalid mission_ids all degrade to mode "none" with a warning).
 */
export function resolveActiveMissionPaths(workspaceDir: string): ActiveMissionResolution {
  const warnings: string[] = [];
  const mirror = rootMirrorPaths(workspaceDir);
  const cwd = path.resolve(workspaceDir);

  // 1. env var override (role child sessions).
  const envCard = process.env.PI_TOPOLOGY_MISSION_CARD;
  if (envCard) {
    const resolvedEnv = path.isAbsolute(envCard) ? envCard : path.resolve(cwd, envCard);
    if (isPathInsideAllowed(resolvedEnv, [cwd]) && existsSync(resolvedEnv)) {
      // Read mission_id from the env-pointed card.
      let envMissionId: string | null = null;
      let envProject: string | null = null;
      try {
        const obj = JSON.parse(readFileSync(resolvedEnv, "utf8")) as { mission_id?: unknown; project?: unknown };
        if (typeof obj.mission_id === "string") envMissionId = obj.mission_id;
        if (typeof obj.project === "string") envProject = obj.project;
      } catch {
        // ignore
      }
      if (envMissionId) {
        // Try per-mission layout; if env path already points to a per-mission
        // card, use the layout. Otherwise the env path IS the canonical card
        // and the caller is responsible for knowing its mission_dir.
        const missionDirAbs = path.join(cwd, ".pi", "topology", "missions", envMissionId);
        if (existsSync(missionDirAbs)) {
          const layout = missionLayoutPaths(cwd, envMissionId);
          return {
            mode: "per-mission",
            missionId: envMissionId,
            project: envProject ?? readMissionCardProject(cwd, resolvedEnv),
            workdir: cwd,
            missionCardPath: layout.missionCardPath,
            statusBoardPath: layout.statusBoardPath,
            eventLogPath: layout.runtimeEventsPath,
            incidentLogPath: layout.incidentLogPath,
            sessionsPath: layout.sessionsPath,
            packetLedgerPath: layout.packetLedgerPath,
            launchDir: layout.launchDir,
            artifactsDir: layout.artifactsDir,
            rootMirror: mirror,
            warnings: ["env override (PI_TOPOLOGY_MISSION_CARD)"],
          };
        }
        // Env path is a per-mission canonical card but the mission dir is
        // missing (unusual). Degrade to "per-mission" mode using the env
        // path as missionCardPath and the layout paths for everything else.
        return {
          mode: "per-mission",
          missionId: envMissionId,
          project: envProject ?? readMissionCardProject(cwd, resolvedEnv),
          workdir: cwd,
          missionCardPath: resolvedEnv,
          statusBoardPath: null,
          eventLogPath: null,
          incidentLogPath: null,
          sessionsPath: null,
          packetLedgerPath: null,
          launchDir: null,
          artifactsDir: null,
          rootMirror: mirror,
          warnings: ["env override; per-mission layout dir missing"],
        };
      }
      // env points to a file we can't parse; fall through.
      warnings.push("PI_TOPOLOGY_MISSION_CARD set but file unreadable or missing mission_id");
    }
  }

  // 2. registry + active pointer → per-mission.
  const registry = readMissionRegistry(cwd);
  if (registry) {
    const pointer = readActiveMissionPointer(cwd);
    let activeId = registryActiveMission(registry);
    if (pointer?.mission_id && pointer.mission_id !== activeId) {
      warnings.push(
        `active pointer (${pointer.mission_id}) and registry.active_mission_id (${activeId ?? "(null)"}) disagree; preferring pointer`,
      );
      activeId = pointer.mission_id;
    }
    if (activeId) {
      const layout = missionLayoutPaths(cwd, activeId);
      if (!existsSync(layout.missionDirAbsolute)) {
        warnings.push(
          `active mission_id ${JSON.stringify(activeId)} registered but mission_dir missing at ${layout.missionDirAbsolute}; falling back to none`,
        );
        return {
          mode: "none",
          missionId: null,
          project: null,
          workdir: cwd,
          missionCardPath: null,
          statusBoardPath: null,
          eventLogPath: null,
          incidentLogPath: null,
          sessionsPath: null,
          packetLedgerPath: null,
          launchDir: null,
          artifactsDir: null,
          rootMirror: mirror,
          warnings,
        };
      }
      // Read the mission card at the per-mission path to get the project.
      const project = readMissionCardProject(cwd, layout.missionCardPath);
      return {
        mode: "per-mission",
        missionId: activeId,
        project,
        workdir: cwd,
        missionCardPath: layout.missionCardPath,
        statusBoardPath: layout.statusBoardPath,
        eventLogPath: layout.runtimeEventsPath,
        incidentLogPath: layout.incidentLogPath,
        sessionsPath: layout.sessionsPath,
        packetLedgerPath: layout.packetLedgerPath,
        launchDir: layout.launchDir,
        artifactsDir: layout.artifactsDir,
        rootMirror: mirror,
        warnings,
      };
    }
    // Registry exists but no active mission id.
    warnings.push("mission-registry.json present but no active_mission_id and no candidate entries");
  }

  // 3. legacy root mission-card.json (no registry).
  if (existsSync(mirror.missionCardPath)) {
    let legacyMissionId: string | null = null;
    try {
      const obj = JSON.parse(readFileSync(mirror.missionCardPath, "utf8")) as { mission_id?: unknown };
      if (typeof obj.mission_id === "string") legacyMissionId = obj.mission_id;
    } catch {
      // ignore
    }
    if (legacyMissionId) {
      const project = readMissionCardProject(cwd, mirror.missionCardPath);
      // In legacy mode, the root paths ARE the canonical paths.
      return {
        mode: "legacy",
        missionId: legacyMissionId,
        project,
        workdir: cwd,
        missionCardPath: mirror.missionCardPath,
        statusBoardPath: mirror.statusBoardPath,
        eventLogPath: mirror.eventLogPath,
        incidentLogPath: mirror.incidentLogPath,
        sessionsPath: mirror.sessionsPath,
        packetLedgerPath: mirror.packetLedgerPath,
        launchDir: mirror.launchDir,
        artifactsDir: mirror.artifactsDir,
        // In legacy mode, root mirror paths == canonical paths.
        rootMirror: mirror,
        warnings,
      };
    }
  }

  // 4. nothing.
  return {
    mode: "none",
    missionId: null,
    project: null,
    workdir: cwd,
    missionCardPath: null,
    statusBoardPath: null,
    eventLogPath: null,
    incidentLogPath: null,
    sessionsPath: null,
    packetLedgerPath: null,
    launchDir: null,
    artifactsDir: null,
    rootMirror: mirror,
    warnings,
  };
}

/**
 * Convenience: legacy root paths (used for migration detection).
 */
export function legacyRootPaths(workspaceDir: string): RootMirrorPaths {
  return rootMirrorPaths(workspaceDir);
}

/**
 * Convert an `ActiveMissionResolution` into a `MissionLayoutPaths` for code
 * paths that need the typed layout (e.g. dashboard, root-mirror sync).
 * Returns null when the resolution is in "none" mode.
 */
export function resolutionToLayout(res: ActiveMissionResolution): MissionLayoutPaths | null {
  if (res.mode !== "per-mission" || !res.missionId) return null;
  return missionLayoutPaths(res.workdir, res.missionId);
}

/**
 * Compute the per-mission relative path for a role's artifacts dir, e.g.
 * `.pi/topology/missions/<id>/artifacts/<role>/`. Used for guard allowlists
 * and UI artifact path rendering.
 */
export function perMissionArtifactDirFor(res: ActiveMissionResolution, role: string): string | null {
  if (res.mode !== "per-mission" || !res.missionId) return null;
  return path.join(missionDirectoryRelative(res.missionId), "artifacts", role);
}
