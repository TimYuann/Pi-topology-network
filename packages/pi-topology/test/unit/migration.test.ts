import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  detectLegacyLayout,
  formatMigrationResult,
  isMigrationNeeded,
  migrateLegacyToPerMission,
  readLegacyMissionData,
  ROOT_INCIDENT_LOG_PATH,
  ROOT_MISSION_CARD_PATH,
  ROOT_RUNTIME_EVENTS_PATH,
  ROOT_SESSIONS_PATH,
  ROOT_STATUS_BOARD_PATH,
} from "../../src/runtime/migration.ts";
import { readMissionRegistry } from "../../src/runtime/mission-registry.ts";
import { readActiveMissionPointer } from "../../src/runtime/mission-pointer.ts";
import { missionLayoutPaths } from "../../src/runtime/mission-layout.ts";
import { createMissionDraft } from "../../src/runtime/mission.ts";

const NOW = new Date("2026-06-17T00:00:00.000Z");

function makeWorkspace(): string {
  return mkdtempSync(join(tmpdir(), "pi-topology-slice6-migration-"));
}

interface LegacyFixture {
  mission_id: string;
  project: string;
  objective: string;
  has_status_board: boolean;
  has_sessions: boolean;
  has_runtime_events: boolean;
  has_incident_log: boolean;
}

function makeLegacyWorkspace(workspaceDir: string, opts: LegacyFixture): void {
  const card = createMissionDraft({
    project: opts.project,
    workdir: workspaceDir,
    objective: opts.objective,
    allowed_paths: [workspaceDir],
  });
  const missionId = opts.mission_id ?? card.mission_id;
  mkdirSync(join(workspaceDir, ".pi", "topology"), { recursive: true });
  writeFileSync(
    join(workspaceDir, ROOT_MISSION_CARD_PATH),
    JSON.stringify({ ...card, mission_id: missionId }, null, 2),
    "utf8",
  );
  if (opts.has_status_board) {
    writeFileSync(
      join(workspaceDir, ROOT_STATUS_BOARD_PATH),
      JSON.stringify(
        {
          mission_id: missionId,
          runtime_phase: "running",
          last_updated_at: NOW.toISOString(),
          pending_packets: [],
          next_gate: null,
        },
        null,
        2,
      ),
      "utf8",
    );
  }
  if (opts.has_sessions) {
    writeFileSync(
      join(workspaceDir, ROOT_SESSIONS_PATH),
      `${JSON.stringify({ record_id: "rec_legacy_1", mission_id: missionId, role: "hq", event_type: "heartbeat", timestamp: NOW.toISOString() })}\n`,
      "utf8",
    );
  }
  if (opts.has_runtime_events) {
    writeFileSync(
      join(workspaceDir, ROOT_RUNTIME_EVENTS_PATH),
      `${JSON.stringify({ event_type: "runtime_boot", mission_id: missionId, timestamp: NOW.toISOString() })}\n`,
      "utf8",
    );
  }
  if (opts.has_incident_log) {
    writeFileSync(
      join(workspaceDir, ROOT_INCIDENT_LOG_PATH),
      `${JSON.stringify({ incident_id: "i_legacy_1", mission_id: missionId, timestamp: NOW.toISOString() })}\n`,
      "utf8",
    );
  }
}

// ============================================================
// Detection
// ============================================================

test("migration: detectLegacyLayout returns false when workspace has no .pi", () => {
  const ws = makeWorkspace();
  try {
    assert.equal(detectLegacyLayout(ws), false);
    assert.equal(isMigrationNeeded(ws), false);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("migration: detectLegacyLayout returns true when root mission-card.json exists without registry", () => {
  const ws = makeWorkspace();
  try {
    makeLegacyWorkspace(ws, {
      mission_id: "legacy-2026-06-17-001",
      project: "legacy",
      objective: "Legacy mission",
      has_status_board: true,
      has_sessions: false,
      has_runtime_events: false,
      has_incident_log: false,
    });
    assert.equal(detectLegacyLayout(ws), true);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("migration: detectLegacyLayout returns false when registry exists", () => {
  const ws = makeWorkspace();
  try {
    makeLegacyWorkspace(ws, {
      mission_id: "legacy-2026-06-17-001",
      project: "legacy",
      objective: "Legacy mission",
      has_status_board: false,
      has_sessions: false,
      has_runtime_events: false,
      has_incident_log: false,
    });
    // Write a registry to mark as already-migrated
    writeFileSync(
      join(ws, ".pi", "topology", "mission-registry.json"),
      JSON.stringify({ version: 1, active_mission_id: null, updated_at: NOW.toISOString(), missions: [] }),
      "utf8",
    );
    assert.equal(detectLegacyLayout(ws), false);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

// ============================================================
// readLegacyMissionData
// ============================================================

test("migration: readLegacyMissionData returns null for missing card", () => {
  const ws = makeWorkspace();
  try {
    assert.equal(readLegacyMissionData(ws), null);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("migration: readLegacyMissionData returns null for invalid card (no mission_id)", () => {
  const ws = makeWorkspace();
  try {
    mkdirSync(join(ws, ".pi", "topology"), { recursive: true });
    writeFileSync(join(ws, ROOT_MISSION_CARD_PATH), JSON.stringify({ project: "x" }), "utf8");
    assert.equal(readLegacyMissionData(ws), null);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("migration: readLegacyMissionData surfaces all 5 file paths with exists + bytes", () => {
  const ws = makeWorkspace();
  try {
    makeLegacyWorkspace(ws, {
      mission_id: "legacy-2026-06-17-001",
      project: "legacy",
      objective: "Read legacy data",
      has_status_board: true,
      has_sessions: true,
      has_runtime_events: true,
      has_incident_log: true,
    });
    const data = readLegacyMissionData(ws);
    assert.ok(data);
    assert.equal(data.mission_id, "legacy-2026-06-17-001");
    assert.equal(data.files.mission_card.exists, true);
    assert.equal(data.files.mission_card.bytes > 0, true);
    assert.equal(data.files.status_board.exists, true);
    assert.equal(data.files.sessions.exists, true);
    assert.equal(data.files.sessions.lines, 1);
    assert.equal(data.files.runtime_events.exists, true);
    assert.equal(data.files.runtime_events.lines, 1);
    assert.equal(data.files.incident_log.exists, true);
    assert.equal(data.files.incident_log.lines, 1);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

// ============================================================
// Migration: happy paths
// ============================================================

test("migration: migrateLegacyToPerMission copies mission-card + status-board to per-Mission dir", () => {
  const ws = makeWorkspace();
  try {
    makeLegacyWorkspace(ws, {
      mission_id: "happy-2026-06-17-001",
      project: "happy",
      objective: "Happy migration",
      has_status_board: true,
      has_sessions: false,
      has_runtime_events: false,
      has_incident_log: false,
    });
    const result = migrateLegacyToPerMission(ws, { now: NOW });
    assert.equal(result.ok, true);
    assert.equal(result.mode, "migrated");
    assert.equal(result.mission_id, "happy-2026-06-17-001");

    const layout = missionLayoutPaths(ws, "happy-2026-06-17-001");
    assert.equal(existsSync(layout.missionCardPath), true);
    assert.equal(existsSync(layout.statusBoardPath), true);
    const migratedCard = JSON.parse(readFileSync(layout.missionCardPath, "utf8"));
    assert.equal(migratedCard.mission_id, "happy-2026-06-17-001");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("migration: migrateLegacyToPerMission copies sessions/runtime_events/incident_log to per-Mission dir", () => {
  const ws = makeWorkspace();
  try {
    makeLegacyWorkspace(ws, {
      mission_id: "files-2026-06-17-001",
      project: "files",
      objective: "Files migration",
      has_status_board: true,
      has_sessions: true,
      has_runtime_events: true,
      has_incident_log: true,
    });
    const result = migrateLegacyToPerMission(ws, { now: NOW });
    assert.equal(result.ok, true);
    assert.equal(result.files_migrated.includes("sessions.jsonl"), true);
    assert.equal(result.files_migrated.includes("runtime-events.jsonl"), true);
    assert.equal(result.files_migrated.includes("incident-log.jsonl"), true);

    const layout = missionLayoutPaths(ws, "files-2026-06-17-001");
    assert.equal(existsSync(layout.sessionsPath), true);
    assert.equal(existsSync(layout.runtimeEventsPath), true);
    assert.equal(existsSync(layout.incidentLogPath), true);
    const sessions = readFileSync(layout.sessionsPath, "utf8");
    assert.match(sessions, /rec_legacy_1/);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("migration: writes mission-registry.json with the migrated mission", () => {
  const ws = makeWorkspace();
  try {
    makeLegacyWorkspace(ws, {
      mission_id: "registry-2026-06-17-001",
      project: "registry",
      objective: "Registry migration",
      has_status_board: true,
      has_sessions: false,
      has_runtime_events: false,
      has_incident_log: false,
    });
    migrateLegacyToPerMission(ws, { now: NOW });
    const registry = readMissionRegistry(ws);
    assert.ok(registry);
    assert.equal(registry.active_mission_id, "registry-2026-06-17-001");
    assert.equal(registry.missions.length, 1);
    assert.equal(registry.missions[0]?.mission_id, "registry-2026-06-17-001");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("migration: writes active-mission.json with reason=migration", () => {
  const ws = makeWorkspace();
  try {
    makeLegacyWorkspace(ws, {
      mission_id: "pointer-2026-06-17-001",
      project: "pointer",
      objective: "Pointer migration",
      has_status_board: true,
      has_sessions: false,
      has_runtime_events: false,
      has_incident_log: false,
    });
    migrateLegacyToPerMission(ws, { now: NOW });
    const pointer = readActiveMissionPointer(ws);
    assert.ok(pointer);
    assert.equal(pointer.mission_id, "pointer-2026-06-17-001");
    assert.equal(pointer.reason, "migration");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("migration: appends mission_lifecycle_transition event to runtime-events.jsonl", () => {
  const ws = makeWorkspace();
  try {
    makeLegacyWorkspace(ws, {
      mission_id: "event-2026-06-17-001",
      project: "event",
      objective: "Event migration",
      has_status_board: true,
      has_sessions: false,
      has_runtime_events: true,
      has_incident_log: false,
    });
    migrateLegacyToPerMission(ws, { now: NOW });
    const layout = missionLayoutPaths(ws, "event-2026-06-17-001");
    const events = readFileSync(layout.runtimeEventsPath, "utf8");
    // Original runtime-events.jsonl had 1 row, migration added 1 more
    const lines = events.split("\n").filter((l) => l.trim().length > 0);
    assert.ok(lines.length >= 2);
    const migrationEvent = JSON.parse(lines[lines.length - 1]!);
    assert.equal(migrationEvent.event_type, "mission_lifecycle_transition");
    assert.match(migrationEvent.reason, /migrated from legacy/);
    assert.equal(migrationEvent.from_state, "intake");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

// ============================================================
// Migration: edge cases
// ============================================================

test("migration: missing sessions.jsonl creates inferred_empty file (per spec §12.1)", () => {
  const ws = makeWorkspace();
  try {
    makeLegacyWorkspace(ws, {
      mission_id: "inferred-2026-06-17-001",
      project: "inferred",
      objective: "Inferred empty",
      has_status_board: true,
      has_sessions: false, // missing
      has_runtime_events: false, // missing
      has_incident_log: false, // missing
    });
    const result = migrateLegacyToPerMission(ws, { now: NOW });
    assert.equal(result.ok, true);
    assert.equal(result.files_created_empty.includes("sessions.jsonl"), true);
    assert.equal(result.files_created_empty.includes("runtime-events.jsonl"), true);
    assert.equal(result.files_created_empty.includes("incident-log.jsonl"), true);

    const layout = missionLayoutPaths(ws, "inferred-2026-06-17-001");
    const sessions = readFileSync(layout.sessionsPath, "utf8");
    assert.match(sessions, /migration_inferred_empty/);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("migration: keeps legacy root files intact (non-destructive)", () => {
  const ws = makeWorkspace();
  try {
    makeLegacyWorkspace(ws, {
      mission_id: "nondestructive-2026-06-17-001",
      project: "nondestructive",
      objective: "Non-destructive",
      has_status_board: true,
      has_sessions: true,
      has_runtime_events: true,
      has_incident_log: true,
    });
    const originalCard = readFileSync(join(ws, ROOT_MISSION_CARD_PATH), "utf8");
    const originalSessions = readFileSync(join(ws, ROOT_SESSIONS_PATH), "utf8");
    migrateLegacyToPerMission(ws, { now: NOW });
    assert.equal(readFileSync(join(ws, ROOT_MISSION_CARD_PATH), "utf8"), originalCard);
    assert.equal(readFileSync(join(ws, ROOT_SESSIONS_PATH), "utf8"), originalSessions);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("migration: is idempotent — second call returns mode=registry_present (no duplicate Mission)", () => {
  const ws = makeWorkspace();
  try {
    makeLegacyWorkspace(ws, {
      mission_id: "idempotent-2026-06-17-001",
      project: "idempotent",
      objective: "Idempotent",
      has_status_board: true,
      has_sessions: false,
      has_runtime_events: false,
      has_incident_log: false,
    });
    const first = migrateLegacyToPerMission(ws, { now: NOW });
    assert.equal(first.ok, true);
    assert.equal(first.mode, "migrated");
    const second = migrateLegacyToPerMission(ws, { now: NOW });
    assert.equal(second.ok, true);
    assert.equal(second.mode, "registry_present");
    // Registry still has 1 mission (no duplicate)
    const registry = readMissionRegistry(ws);
    assert.equal(registry?.missions.length, 1);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("migration: no-legacy mode when workspace has no mission-card.json", () => {
  const ws = makeWorkspace();
  try {
    const result = migrateLegacyToPerMission(ws, { now: NOW });
    assert.equal(result.ok, true);
    assert.equal(result.mode, "no_legacy");
    assert.equal(result.mission_id, null);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("migration: registry_present mode when registry already exists", () => {
  const ws = makeWorkspace();
  try {
    mkdirSync(join(ws, ".pi", "topology"), { recursive: true });
    writeFileSync(
      join(ws, ".pi", "topology", "mission-registry.json"),
      JSON.stringify({ version: 1, active_mission_id: null, updated_at: NOW.toISOString(), missions: [] }),
      "utf8",
    );
    const result = migrateLegacyToPerMission(ws, { now: NOW });
    assert.equal(result.ok, true);
    assert.equal(result.mode, "registry_present");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("migration: dry-run does not write any files", () => {
  const ws = makeWorkspace();
  try {
    makeLegacyWorkspace(ws, {
      mission_id: "dryrun-2026-06-17-001",
      project: "dryrun",
      objective: "Dry run",
      has_status_board: true,
      has_sessions: true,
      has_runtime_events: true,
      has_incident_log: true,
    });
    const result = migrateLegacyToPerMission(ws, { now: NOW, dryRun: true });
    assert.equal(result.ok, true);
    assert.equal(result.mode, "migrated");
    assert.match(result.reason ?? "", /dry-run/);
    // No per-mission dir created
    assert.equal(existsSync(join(ws, ".pi", "topology", "missions")), false);
    // No registry created
    assert.equal(existsSync(join(ws, ".pi", "topology", "mission-registry.json")), false);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("migration: invalid mission-card.json returns validation_failed", () => {
  const ws = makeWorkspace();
  try {
    mkdirSync(join(ws, ".pi", "topology"), { recursive: true });
    // Card missing required fields (e.g. project) so validateMissionCard fails
    writeFileSync(
      join(ws, ROOT_MISSION_CARD_PATH),
      JSON.stringify({ mission_id: "invalid-2026-06-17-001" }),
      "utf8",
    );
    const result = migrateLegacyToPerMission(ws, { now: NOW });
    assert.equal(result.ok, false);
    assert.equal(result.mode, "validation_failed");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

// ============================================================
// Format
// ============================================================

test("migration: formatMigrationResult includes ok, mode, mission_id, files_migrated, files_created_empty", () => {
  const ws = makeWorkspace();
  try {
    makeLegacyWorkspace(ws, {
      mission_id: "format-2026-06-17-001",
      project: "format",
      objective: "Format test",
      has_status_board: true,
      has_sessions: true,
      has_runtime_events: true,
      has_incident_log: false, // missing → inferred_empty
    });
    const result = migrateLegacyToPerMission(ws, { now: NOW });
    const text = formatMigrationResult(result);
    assert.match(text, /topology migrate: migrated/);
    assert.match(text, /ok: true/);
    assert.match(text, /mission_id: format-2026-06-17-001/);
    assert.match(text, /files migrated:/);
    assert.match(text, /sessions\.jsonl/);
    assert.match(text, /files created \(inferred empty\):/);
    assert.match(text, /incident-log\.jsonl/);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

// ============================================================
// Slice 6.1: status-board inferred-empty + invalid mission_id
// ============================================================

test("migration: missing legacy status-board.json marks per-Mission status-board as inferred_empty (slice 6.1)", () => {
  const ws = makeWorkspace();
  try {
    makeLegacyWorkspace(ws, {
      mission_id: "missing-board-2026-06-17-001",
      project: "missing-board",
      objective: "Missing status board",
      has_status_board: false, // <-- missing
      has_sessions: true,
      has_runtime_events: true,
      has_incident_log: true,
    });
    const result = migrateLegacyToPerMission(ws, { now: NOW });
    assert.equal(result.ok, true);
    assert.equal(result.files_created_empty.includes("status-board.json"), true);

    const layout = missionLayoutPaths(ws, "missing-board-2026-06-17-001");
    const statusBoardRaw = readFileSync(layout.statusBoardPath, "utf8");
    const parsed = JSON.parse(statusBoardRaw) as { _meta?: { inferred_empty?: boolean } };
    assert.equal(parsed._meta?.inferred_empty, true);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("migration: present legacy status-board.json does NOT mark per-Mission copy as inferred_empty (slice 6.1)", () => {
  const ws = makeWorkspace();
  try {
    makeLegacyWorkspace(ws, {
      mission_id: "present-board-2026-06-17-001",
      project: "present-board",
      objective: "Present status board",
      has_status_board: true, // <-- present
      has_sessions: true,
      has_runtime_events: true,
      has_incident_log: true,
    });
    const result = migrateLegacyToPerMission(ws, { now: NOW });
    assert.equal(result.ok, true);
    assert.equal(result.files_created_empty.includes("status-board.json"), false);

    const layout = missionLayoutPaths(ws, "present-board-2026-06-17-001");
    const statusBoardRaw = readFileSync(layout.statusBoardPath, "utf8");
    const parsed = JSON.parse(statusBoardRaw) as { _meta?: { inferred_empty?: boolean } };
    assert.equal(parsed._meta?.inferred_empty, undefined);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("migration: unsafe legacy mission_id returns validation_failed (no throw, no writes, slice 6.1)", () => {
  const ws = makeWorkspace();
  try {
    makeLegacyWorkspace(ws, {
      mission_id: "../evil",
      project: "evil",
      objective: "Path-traversal attempt",
      has_status_board: true,
      has_sessions: true,
      has_runtime_events: true,
      has_incident_log: true,
    });
    let result: ReturnType<typeof migrateLegacyToPerMission> | null = null;
    let threw = false;
    try {
      result = migrateLegacyToPerMission(ws, { now: NOW });
    } catch {
      threw = true;
    }
    assert.equal(threw, false, "migrateLegacyToPerMission must not throw on unsafe mission_id");
    assert.ok(result);
    assert.equal(result.ok, false);
    assert.equal(result.mode, "validation_failed");
    assert.match(result.reason ?? "", /mission_id invalid/i);
    // No writes at all
    assert.equal(existsSync(join(ws, ".pi", "topology", "missions")), false);
    assert.equal(existsSync(join(ws, ".pi", "topology", "mission-registry.json")), false);
    assert.equal(existsSync(join(ws, ".pi", "topology", "active-mission.json")), false);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("migration: legacy mission_id with embedded slash returns validation_failed (no throw, slice 6.1)", () => {
  const ws = makeWorkspace();
  try {
    makeLegacyWorkspace(ws, {
      mission_id: "subdir/escape",
      project: "subdir",
      objective: "Subdir escape attempt",
      has_status_board: true,
      has_sessions: false,
      has_runtime_events: false,
      has_incident_log: false,
    });
    let result: ReturnType<typeof migrateLegacyToPerMission> | null = null;
    let threw = false;
    try {
      result = migrateLegacyToPerMission(ws, { now: NOW });
    } catch {
      threw = true;
    }
    assert.equal(threw, false);
    assert.ok(result);
    assert.equal(result.ok, false);
    assert.equal(result.mode, "validation_failed");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
