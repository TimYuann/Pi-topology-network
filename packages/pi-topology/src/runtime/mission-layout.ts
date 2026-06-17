import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { MissionCard, StatusBoard } from "./mission.ts";
import { missionRegistryDir } from "./mission-registry.ts";

/**
 * Mission id path segment validator.
 *
 * Defense in depth against path traversal. The mission id is interpolated into
 * filesystem paths under `.pi/topology/missions/<mission_id>/`; an unsafe id
 * could escape that root and write outside the project state directory.
 *
 * Rejects:
 *   - empty / "." / ".."
 *   - any character outside [A-Za-z0-9._-]
 *   - any segment starting with "." (hidden directory)
 *
 * Caller should also rely on the resolved-path containment check inside
 * `missionLayoutPaths` for full safety; this is the format gate.
 */

const SAFE_MISSION_ID_REGEX = /^[A-Za-z0-9._-]+$/;
const FORBIDDEN_MISSION_IDS = new Set(["", ".", ".."]);

export class InvalidMissionIdError extends Error {
  public readonly missionId: unknown;
  constructor(missionId: unknown, message: string) {
    super(`invalid mission id ${JSON.stringify(missionId)}: ${message}`);
    this.name = "InvalidMissionIdError";
    this.missionId = missionId;
  }
}

export function validateMissionIdPathSegment(missionId: unknown): asserts missionId is string {
  if (typeof missionId !== "string") {
    throw new InvalidMissionIdError(missionId, "must be a string");
  }
  if (FORBIDDEN_MISSION_IDS.has(missionId)) {
    throw new InvalidMissionIdError(missionId, "must not be empty, '.', or '..'");
  }
  if (!SAFE_MISSION_ID_REGEX.test(missionId)) {
    throw new InvalidMissionIdError(
      missionId,
      "must match [A-Za-z0-9._-]+ (no slashes, no NUL, no other special chars)",
    );
  }
  if (missionId.startsWith(".")) {
    throw new InvalidMissionIdError(missionId, "must not start with '.'");
  }
}

/**
 * Per-Mission directory layout.
 *
 * Spec reference: `docs/14-pi-topology-mission-runtime-spec.md` §3.1
 *
 * Canonical per-Mission files live under `.pi/topology/missions/<mission_id>/`.
 * Each Mission owns its own mission card, status board, runtime event ledger,
 * incident log, session ledger, packet ledger, evidence index, closeout,
 * launch scripts, artifacts, and slice notes.
 *
 * Slice 1 contract: path computation + createMissionLayout writes the layout
 * (file + directory skeleton) for a given mission_card.json + initial status
 * board. Slice 1 does NOT seed runtime-events.jsonl / incident-log.jsonl /
 * sessions.jsonl content — those files are created empty (append-only ledgers,
 * content grows in later slices).
 */

export const TOPOLOGY_ROLES_FOR_ARTIFACTS = [
  "topology-supervisor",
  "hq",
  "repair",
  "runner",
  "oracle",
  "librarian",
  "scott",
] as const;

export interface MissionLayoutPaths {
  workspaceDir: string;
  missionId: string;
  missionDirAbsolute: string;
  missionDirRelative: string;
  missionCardPath: string;
  statusBoardPath: string;
  runtimeEventsPath: string;
  incidentLogPath: string;
  sessionsPath: string;
  packetLedgerPath: string;
  evidenceIndexPath: string;
  closeoutPath: string;
  launchDir: string;
  artifactsDir: string;
  slicesDir: string;
  artifactRoleDirs: Record<(typeof TOPOLOGY_ROLES_FOR_ARTIFACTS)[number], string>;
}

export function missionDirectoryRelative(missionId: string): string {
  return path.join(".pi", "topology", "missions", missionId);
}

export function missionLayoutPaths(workspaceDir: string, missionId: string): MissionLayoutPaths {
  validateMissionIdPathSegment(missionId);
  const missionDirAbsolute = path.join(missionRegistryDir(workspaceDir), missionId);
  // Defense in depth: confirm the resolved path is still inside the
  // `.pi/topology/missions/` root, even after path.join normalization.
  const resolvedMissionsRoot = path.resolve(missionRegistryDir(workspaceDir));
  const resolvedMissionDir = path.resolve(missionDirAbsolute);
  if (
    resolvedMissionDir !== resolvedMissionsRoot &&
    !resolvedMissionDir.startsWith(resolvedMissionsRoot + path.sep)
  ) {
    throw new InvalidMissionIdError(
      missionId,
      `resolved path ${resolvedMissionDir} escapes missions root ${resolvedMissionsRoot}`,
    );
  }
  const missionDirRelative = missionDirectoryRelative(missionId);
  const artifactRoleDirs = {} as MissionLayoutPaths["artifactRoleDirs"];
  for (const role of TOPOLOGY_ROLES_FOR_ARTIFACTS) {
    artifactRoleDirs[role] = path.join(missionDirAbsolute, "artifacts", role);
  }
  return {
    workspaceDir,
    missionId,
    missionDirAbsolute,
    missionDirRelative,
    missionCardPath: path.join(missionDirAbsolute, "mission-card.json"),
    statusBoardPath: path.join(missionDirAbsolute, "status-board.json"),
    runtimeEventsPath: path.join(missionDirAbsolute, "runtime-events.jsonl"),
    incidentLogPath: path.join(missionDirAbsolute, "incident-log.jsonl"),
    sessionsPath: path.join(missionDirAbsolute, "sessions.jsonl"),
    packetLedgerPath: path.join(missionDirAbsolute, "packet-ledger.jsonl"),
    evidenceIndexPath: path.join(missionDirAbsolute, "evidence-index.jsonl"),
    closeoutPath: path.join(missionDirAbsolute, "closeout.md"),
    launchDir: path.join(missionDirAbsolute, "launch"),
    artifactsDir: path.join(missionDirAbsolute, "artifacts"),
    slicesDir: path.join(missionDirAbsolute, "slices"),
    artifactRoleDirs,
  };
}

export interface CreateMissionLayoutInput {
  workspaceDir: string;
  missionCard: MissionCard;
  initialStatusBoard: StatusBoard;
  /** If true, write empty placeholder content for JSONL ledgers. Default true. */
  seedEmptyLedgers?: boolean;
}

export interface CreateMissionLayoutResult {
  layout: MissionLayoutPaths;
  created: boolean;
}

/**
 * Create the per-Mission directory layout and seed initial files.
 *
 * Idempotent: if missionDirAbsolute already exists, this is a no-op and returns
 * `created: false`. Use a separate flow to migrate or repair an existing layout.
 */
export function createMissionLayout(input: CreateMissionLayoutInput): CreateMissionLayoutResult {
  const { workspaceDir, missionCard, initialStatusBoard } = input;
  const seedEmptyLedgers = input.seedEmptyLedgers ?? true;
  // missionLayoutPaths will throw InvalidMissionIdError if mission_id is unsafe.
  const layout = missionLayoutPaths(workspaceDir, missionCard.mission_id);
  if (existsSync(layout.missionDirAbsolute)) {
    return { layout, created: false };
  }
  mkdirSync(layout.missionDirAbsolute, { recursive: true });
  mkdirSync(layout.launchDir, { recursive: true });
  mkdirSync(layout.artifactsDir, { recursive: true });
  for (const roleDir of Object.values(layout.artifactRoleDirs)) {
    mkdirSync(roleDir, { recursive: true });
  }
  mkdirSync(layout.slicesDir, { recursive: true });

  writeFileSync(layout.missionCardPath, `${JSON.stringify(missionCard, null, 2)}\n`, "utf8");
  writeFileSync(layout.statusBoardPath, `${JSON.stringify(initialStatusBoard, null, 2)}\n`, "utf8");
  writeFileSync(layout.closeoutPath, closeoutPlaceholder(missionCard), "utf8");

  if (seedEmptyLedgers) {
    for (const jsonl of [
      layout.runtimeEventsPath,
      layout.incidentLogPath,
      layout.sessionsPath,
      layout.packetLedgerPath,
      layout.evidenceIndexPath,
    ]) {
      writeFileSync(jsonl, "", "utf8");
    }
  }
  return { layout, created: true };
}

function closeoutPlaceholder(card: MissionCard): string {
  return [
    `# Closeout — ${card.mission_id}`,
    "",
    "Placeholder. Populated when the Mission reaches `delivered` lifecycle state.",
    "",
    "- Mission id: " + card.mission_id,
    "- Objective: " + card.objective,
    "- Project: " + card.project,
    "",
  ].join("\n");
}

export function layoutExists(layout: MissionLayoutPaths): boolean {
  return existsSync(layout.missionDirAbsolute);
}

export function expectedLayoutEntries(layout: MissionLayoutPaths): string[] {
  return [
    layout.missionCardPath,
    layout.statusBoardPath,
    layout.runtimeEventsPath,
    layout.incidentLogPath,
    layout.sessionsPath,
    layout.packetLedgerPath,
    layout.evidenceIndexPath,
    layout.closeoutPath,
    layout.launchDir,
    layout.artifactsDir,
    layout.slicesDir,
    ...Object.values(layout.artifactRoleDirs),
  ];
}
