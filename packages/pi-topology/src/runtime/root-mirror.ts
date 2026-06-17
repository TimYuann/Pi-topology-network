import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { MissionLayoutPaths } from "./mission-layout.ts";

/**
 * Root compatibility mirror.
 *
 * Spec reference: `docs/14-pi-topology-mission-runtime-spec.md` §3.2
 *
 * When `mission-registry.json` exists, root `.pi/topology/*` files are
 * compatibility mirrors of the ACTIVE Mission. They must NOT be the source of
 * truth for archived or inactive Missions.
 *
 * Slice 1 contract: copy selected files from the active Mission folder to the
 * root `.pi/topology/` location. This keeps the existing single-mission UI
 * (`topology_status` reading root paths) working without a destructive
 * migration.
 *
 * What gets mirrored in slice 1:
 *   - mission-card.json
 *   - status-board.json
 *   - runtime-events.jsonl
 *   - incident-log.jsonl
 *   - sessions.jsonl
 *
 * What does NOT get mirrored in slice 1 (deferred to later slices):
 *   - launch/ scripts   (slice 6 migration)
 *   - artifacts/         (slice 5 dashboard / slice 6)
 *   - packet-ledger      (slice 4 inbox cleanup — packet routing unchanged per
 *                         slice 1 rules: "Do not change raw packet transport
 *                         routing")
 *   - evidence-index     (slice 5 dashboard)
 *   - slices/            (per slice handoff, grows slice-by-slice)
 *
 * When the active pointer is cleared (no active Mission), root mirror files are
 * left in place but treated as legacy (matching the spec §3.2 migration note:
 * "During migration, root files may be canonical only when no
 * mission-registry.json exists."). Slice 6 migration is responsible for
 * canonicalizing the legacy form.
 */

export const ROOT_MIRROR_FILES = [
  "mission-card.json",
  "status-board.json",
  "runtime-events.jsonl",
  "incident-log.jsonl",
  "sessions.jsonl",
] as const;

export type RootMirrorFile = (typeof ROOT_MIRROR_FILES)[number];

const PER_MISSION_TO_ROOT: Record<RootMirrorFile, keyof MissionLayoutPaths> = {
  "mission-card.json": "missionCardPath",
  "status-board.json": "statusBoardPath",
  "runtime-events.jsonl": "runtimeEventsPath",
  "incident-log.jsonl": "incidentLogPath",
  "sessions.jsonl": "sessionsPath",
};

export function rootMirrorFilePaths(workspaceDir: string): Record<RootMirrorFile, string> {
  return {
    "mission-card.json": path.join(workspaceDir, ".pi", "topology", "mission-card.json"),
    "status-board.json": path.join(workspaceDir, ".pi", "topology", "status-board.json"),
    "runtime-events.jsonl": path.join(workspaceDir, ".pi", "topology", "runtime-events.jsonl"),
    "incident-log.jsonl": path.join(workspaceDir, ".pi", "topology", "incident-log.jsonl"),
    "sessions.jsonl": path.join(workspaceDir, ".pi", "topology", "sessions.jsonl"),
  };
}

export interface SyncRootMirrorResult {
  copied: RootMirrorFile[];
  missing: RootMirrorFile[];
  rootDir: string;
}

export function syncRootMirrorFromLayout(
  workspaceDir: string,
  layout: MissionLayoutPaths,
  files: readonly RootMirrorFile[] = ROOT_MIRROR_FILES,
): SyncRootMirrorResult {
  const rootDir = path.join(workspaceDir, ".pi", "topology");
  mkdirSync(rootDir, { recursive: true });
  const copied: RootMirrorFile[] = [];
  const missing: RootMirrorFile[] = [];
  for (const file of files) {
    const perMissionKey = PER_MISSION_TO_ROOT[file];
    const source = layout[perMissionKey] as unknown as string;
    const target = rootMirrorFilePaths(workspaceDir)[file];
    if (!existsSync(source)) {
      missing.push(file);
      continue;
    }
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(source, target);
    copied.push(file);
  }
  return { copied, missing, rootDir };
}

/**
 * Copy a single root mirror file. Used when a single file changed (e.g.,
 * appending to runtime-events.jsonl). Implemented as a copy of the per-mission
 * file to the root mirror path.
 */
export function copyRootMirrorFile(
  workspaceDir: string,
  layout: MissionLayoutPaths,
  file: RootMirrorFile,
): { ok: boolean; reason?: "missing_source" } {
  const perMissionKey = PER_MISSION_TO_ROOT[file];
  const source = layout[perMissionKey] as unknown as string;
  if (!existsSync(source)) return { ok: false, reason: "missing_source" };
  const target = rootMirrorFilePaths(workspaceDir)[file];
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(source, target);
  return { ok: true };
}

/**
 * Verify that the root mirror files match the active Mission's per-mission
 * files. Used by tests to assert mirror consistency.
 */
export function rootMirrorMatchesLayout(
  workspaceDir: string,
  layout: MissionLayoutPaths,
): { ok: boolean; mismatches: RootMirrorFile[] } {
  const mismatches: RootMirrorFile[] = [];
  for (const file of ROOT_MIRROR_FILES) {
    const perMissionKey = PER_MISSION_TO_ROOT[file];
    const source = layout[perMissionKey] as unknown as string;
    const target = rootMirrorFilePaths(workspaceDir)[file];
    if (!existsSync(source) || !existsSync(target)) {
      mismatches.push(file);
      continue;
    }
    const a = readFileSync(source, "utf8");
    const b = readFileSync(target, "utf8");
    if (a !== b) mismatches.push(file);
  }
  return { ok: mismatches.length === 0, mismatches };
}

/**
 * Append a line to a per-mission JSONL ledger and re-mirror it to root.
 *
 * This is the only root-mirror write path that preserves append-only semantics
 * for JSONL ledgers. It reads the current per-mission content, appends the
 * line, writes back, then re-mirrors. It does NOT merge with existing root
 * content — the per-mission file is the source of truth.
 */
export function appendToJsonlLedger(
  workspaceDir: string,
  layout: MissionLayoutPaths,
  ledger: "runtime-events.jsonl" | "incident-log.jsonl" | "sessions.jsonl",
  line: string,
): void {
  const perMissionKey = PER_MISSION_TO_ROOT[ledger];
  const source = layout[perMissionKey] as unknown as string;
  const target = rootMirrorFilePaths(workspaceDir)[ledger];
  const normalized = line.endsWith("\n") ? line : `${line}\n`;
  const previous = existsSync(source) ? readFileSync(source, "utf8") : "";
  writeFileSync(source, `${previous}${normalized}`, "utf8");
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${previous}${normalized}`, "utf8");
}
