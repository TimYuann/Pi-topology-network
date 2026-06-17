/**
 * Slice 7: Final dogfood acceptance driver.
 *
 * Spec reference: `docs/14-pi-topology-mission-runtime-spec.md` §13
 * slice 7 ("Final dogfood Mission with direct generated-script
 * launches").
 *
 * The dogfood driver runs the full slice 1-6 surface end-to-end in a
 * clean tmp workspace:
 *
 *   1. Create a fresh workspace at `<run_root>/`.
 *   2. Initialize a Mission in-process (no actual external launch yet).
 *   3. Generate launch scripts via `writeMissionLaunchScriptsSync`.
 *   4. Directly execute the topology-supervisor script in background
 *      with a deterministic `pi` stub on PATH (so the script's
 *      `exec pi ...` does not open a real Pi session). The script
 *      writes a startup line to a log file before exec'ing.
 *   5. Simulate role session activity (heartbeat / closed / parked)
 *      by writing directly to `sessions.jsonl` via slice 3 helpers.
 *   6. Simulate packet traffic (delivered / closed / stale) by writing
 *      to `packet-ledger.jsonl` via slice 4 helpers.
 *   7. Read the dashboard via slice 5 `readDashboardSnapshot`.
 *   8. Run slice 6 migration on a sibling legacy workspace.
 *   9. Capture the 10-field evidence record (per memory rule).
 *  10. Return a `DogfoodRun` so the test harness can clean up.
 *
 * E2E window governance (per memory):
 *   - Workspace is at `/tmp/pi-topology-dogfood-<id>/`, NEVER in the
 *     user's main project directory.
 *   - Cleanup uses `pgrep -f <run_root>` (narrow scope), not `pkill -f`.
 *   - The user's M3 main Pi session is in the main project dir; the
 *     dogfood run is in `/tmp/pi-topology-...` and shares no path
 *     components with the main project.
 *
 * Design rules (slice 7 scope discipline):
 *   - The driver is OPTIONAL — `npm test` does NOT run the dogfood
 *     by default. It only runs in `npm run dogfood` (or when the
 *     `test/integration/dogfood.test.ts` is invoked explicitly).
 *   - The driver is a wrapper around the slice 1-6 modules. It does
 *     NOT bypass any existing gate (mission_id validation, registry
 *     active_mission_id existence check, etc.).
 *   - No new persistent files in the user's project. The driver
 *     writes to a tmp directory that is removed by `cleanupDogfood`.
 */

import { execSync, spawn, type ChildProcess } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInitialStatusBoard, createMissionDraft } from "./mission.ts";
import { missionLayoutPaths } from "./mission-layout.ts";
import {
  addMissionToRegistry,
  createEmptyRegistry,
  newMissionRegistryEntry,
  readMissionRegistry,
  setRegistryActiveMission,
  writeMissionRegistry,
} from "./mission-registry.ts";
import {
  buildActiveMissionPointer,
  writeActiveMissionPointer,
} from "./mission-pointer.ts";
import {
  writeMissionLaunchScriptsSync,
  type LaunchScriptEntry,
} from "./spawn.ts";
import {
  appendRoleSessionRecord,
  buildRoleSessionRecord,
} from "./role-session.ts";
import {
  appendPacketLedger,
  type PacketLedgerEntry,
} from "./packet-ledger.ts";
import {
  readDashboardSnapshot,
  formatDashboardText,
  formatDashboardTextDetailed,
  type DashboardSnapshot,
} from "./dashboard.ts";
import {
  detectLegacyLayout,
  isMigrationNeeded,
  migrateLegacyToPerMission,
  readLegacyMissionData,
  type MigrationResult,
} from "./migration.ts";

export interface DogfoodRun {
  /** Unique run id (also used as the dogfood cwd basename). */
  run_id: string;
  /** Run root absolute path. */
  run_root: string;
  /** Mission id created by the dogfood. */
  mission_id: string;
  /** Mission title (from objective). */
  mission_title: string;
  /** Per-mission directory (absolute). */
  mission_dir: string;
  /** Generated launch scripts. */
  generated_scripts: LaunchScriptEntry[];
  /** Supervisor script launch mode. */
  launch_mode: "direct-script-with-pi-stub";
  /** Terminal log path (where the script wrote its startup line). */
  terminal_log_path: string;
  /** Session file path or partial UUID (N/A for stub, or sessions.jsonl record_id). */
  pi_session_file_path: string;
  /** All PIDs involved in the run (bash + spawned children). */
  pids: number[];
  /** Path to the per-mission sessions.jsonl. */
  sessions_path: string;
  /** Path to the per-mission runtime-events.jsonl. */
  runtime_events_path: string;
  /** Path to the per-mission packet-ledger.jsonl. */
  packet_ledger_path: string;
  /** Path to the per-mission incident-log.jsonl. */
  incident_log_path: string;
  /** Dashboard text (compact, post-simulation). */
  dashboard_text: string;
  /** Dashboard text (verbose, post-simulation). */
  dashboard_verbose_text: string;
  /** Dashboard snapshot struct. */
  dashboard_snapshot: DashboardSnapshot;
  /** Migration result from the legacy sibling workspace. */
  legacy_migration: MigrationResult;
  /** Legacy sibling workspace path. */
  legacy_workspace_path: string;
  /** Cleanup command (single-line). */
  cleanup_command: string;
  /** Whether cleanup was run. */
  cleaned_up: boolean;
  /** Post-cleanup ps proof (pgrep output). */
  post_cleanup_ps_proof: string;
  /** Run started at (ISO). */
  started_at: string;
  /** Run finished at (ISO). */
  finished_at: string;
  /** Warnings accumulated during the run. */
  warnings: string[];
}

export interface DogfoodOptions {
  /** Override the run root (default: /tmp/pi-topology-dogfood-<run_id>). */
  runRoot?: string;
  /** Run id suffix (default: timestamp + random). */
  runId?: string;
  /** Project name for the Mission card. */
  project?: string;
  /** Mission objective. */
  objective?: string;
  /** Allowed paths for the Mission card. */
  allowedPaths?: string[];
  /** Lifecycle state for the initial registry entry. */
  lifecycleState?: "draft" | "awaiting_owner_confirmation" | "running";
  /** Whether to run the actual supervisor launch (default true). */
  launchSupervisor?: boolean;
  /** Whether to run the legacy migration step (default true). */
  migrateLegacy?: boolean;
}

function makeRunId(): string {
  const ts = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
  const rand = Math.random().toString(36).slice(2, 6);
  return `${ts}-${rand}`;
}

/** Create a deterministic `pi` stub on a tmp dir and return its path. */
function createPiStubDir(): string {
  const dir = mkdirSync(path.join(tmpdir(), `pi-stub-${makeRunId()}`), { recursive: true }) ?
    path.join(tmpdir(), `pi-stub-${makeRunId()}`) :
    path.join(tmpdir(), "pi-stub-fallback");
  mkdirSync(dir, { recursive: true });
  const stub = path.join(dir, "pi");
  writeFileSync(
    stub,
    [
      "#!/usr/bin/env bash",
      "# pi stub for dogfood E2E. Emits a launch line + exits 0.",
      "set -euo pipefail",
      'echo "[pi-stub] launched at $(date -u +%Y-%m-%dT%H:%M:%SZ) args: $*" >> "${PI_TOPOLOGY_ROLE_LOG:-/tmp/pi-stub.log}"',
      "exit 0",
    ].join("\n"),
    "utf8",
  );
  chmodSync(stub, 0o755);
  return dir;
}

function makeLegacySiblingWorkspace(runRoot: string, missionId: string): string {
  const legacy = path.join(runRoot, "_legacy_sibling");
  mkdirSync(legacy, { recursive: true });
  mkdirSync(path.join(legacy, ".pi", "topology"), { recursive: true });
  // Write a minimal legacy mission-card.json
  const card = createMissionDraft({
    project: "dogfood-legacy",
    workdir: legacy,
    objective: "Legacy sibling mission for dogfood migration step",
    allowed_paths: [legacy],
  });
  writeFileSync(
    path.join(legacy, ".pi", "topology", "mission-card.json"),
    JSON.stringify({ ...card, mission_id: missionId }, null, 2),
    "utf8",
  );
  writeFileSync(
    path.join(legacy, ".pi", "topology", "status-board.json"),
    JSON.stringify(createInitialStatusBoard(card), null, 2),
    "utf8",
  );
  // Empty files for sessions / runtime-events / incident-log (so migration
  // exercises the inferred-empty path)
  writeFileSync(path.join(legacy, ".pi", "topology", "sessions.jsonl"), "", "utf8");
  writeFileSync(path.join(legacy, ".pi", "topology", "runtime-events.jsonl"), "", "utf8");
  writeFileSync(path.join(legacy, ".pi", "topology", "incident-log.jsonl"), "", "utf8");
  return legacy;
}

/**
 * Run the full dogfood flow. Returns a `DogfoodRun` with all 10
 * evidence fields. The caller is responsible for invoking
 * `cleanupDogfood(run)` after capturing the evidence.
 */
export async function runDogfoodAcceptance(options: DogfoodOptions = {}): Promise<DogfoodRun> {
  const started_at = new Date().toISOString();
  const run_id = options.runId ?? makeRunId();
  const run_root = options.runRoot ?? path.join(tmpdir(), `pi-topology-dogfood-${run_id}`);
  const warnings: string[] = [];
  const pids: number[] = [];

  mkdirSync(run_root, { recursive: true });

  // Step 1: initialize Mission (in-process).
  const project = options.project ?? "dogfood";
  const objective = options.objective ?? "Final dogfood acceptance for slice 7";
  const allowedPaths = options.allowedPaths ?? [run_root];
  const card = createMissionDraft({
    project,
    workdir: run_root,
    objective,
    allowed_paths: allowedPaths,
  });
  const mission_id = card.mission_id;
  const board = createInitialStatusBoard(card);

  // Step 2: write per-mission layout (mission-card.json, status-board.json, etc.).
  const layout = missionLayoutPaths(run_root, mission_id);
  // We need mission-card.json + status-board.json to exist for the launch
  // scripts (they reference these paths). Write them directly without
  // going through createMissionLayout (which would also create the
  // mission-registry.json; we want to do that step manually).
  mkdirSync(layout.missionDirAbsolute, { recursive: true });
  writeFileSync(layout.missionCardPath, JSON.stringify(card, null, 2), "utf8");
  writeFileSync(layout.statusBoardPath, JSON.stringify(board, null, 2), "utf8");
  // Initialize empty per-mission JSONL ledgers so subsequent appends work.
  writeFileSync(layout.runtimeEventsPath, "", "utf8");
  writeFileSync(layout.sessionsPath, "", "utf8");
  writeFileSync(layout.incidentLogPath, "", "utf8");
  writeFileSync(layout.packetLedgerPath, "", "utf8");

  // Step 3: write mission-registry.json with this Mission.
  const lifecycle_state = options.lifecycleState ?? "running";
  const entry = newMissionRegistryEntry({
    mission_id,
    title: objective,
    objective,
    lifecycle_state,
    progress_status: "draft",
    owner_gate: "required",
    blocked: false,
    archived: false,
    mission_dir: layout.missionDirRelative,
  });
  let reg = createEmptyRegistry();
  const addResult = addMissionToRegistry(reg, entry);
  reg = addResult.registry;
  if (!addResult.added) {
    warnings.push(`addMissionToRegistry returned added=false for ${mission_id}; registry may not include the entry`);
  }
  reg = setRegistryActiveMission(reg, mission_id);
  writeMissionRegistry(run_root, reg);

  // Step 4: write active-mission.json.
  writeActiveMissionPointer(
    run_root,
    buildActiveMissionPointer({
      mission_id,
      mission_dir: layout.missionDirRelative,
      reason: "created",
      event_id: `evt_dogfood_${mission_id}_${Date.now()}`,
    }),
  );

  // Step 5: generate launch scripts (so they exist on disk for evidence).
  const packageRoot = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "..",
    "..",
  );
  const launchScripts = writeMissionLaunchScriptsSync(card, {
    packageRoot,
    missionPath: layout.missionCardPath,
    registryRoot: path.join(tmpdir(), `pi-coms-dogfood-${run_id}`),
    terminalApp: "Ghostty",
    provider: "minimax-cn",
    model: "MiniMax-M3",
    thinking: "low",
  });

  // Step 6: directly execute the supervisor script with a pi stub on PATH.
  const terminalLogPath = path.join(run_root, "logs", "topology-supervisor.log");
  mkdirSync(path.dirname(terminalLogPath), { recursive: true });
  let supervisorProc: ChildProcess | null = null;
  if (options.launchSupervisor !== false) {
    const piStubDir = createPiStubDir();
    const supervisorScript = launchScripts.find((e) => e.role === "topology-supervisor");
    if (supervisorScript) {
      // Inject the log path via env so the script writes the startup line.
      // The generated script doesn't accept a logPath arg by default, but
      // it sets PI_TOPOLOGY_ROLE_LOG when its caller passes it. We use
      // `env` to inject it without rewriting the script.
      supervisorProc = spawn("bash", [supervisorScript.scriptPath], {
        cwd: run_root,
        env: {
          ...process.env,
          PATH: `${piStubDir}${path.delimiter}${process.env.PATH ?? ""}`,
          PI_TOPOLOGY_ROLE_LOG: terminalLogPath,
          PI_TOPOLOGY_WORKDIR: run_root,
        },
        stdio: ["ignore", "pipe", "pipe"],
        detached: false,
      });
      pids.push(supervisorProc.pid ?? -1);
    }
  }

  // Step 7: simulate role session activity. We use slice 3 helpers.
  const now = new Date();
  appendRoleSessionRecord(
    run_root,
    layout,
    buildRoleSessionRecord({
      mission_id,
      role: "hq",
      event_type: "script_written",
      session_id: null,
      script_path: launchScripts.find((e) => e.role === "hq")?.scriptPath ?? null,
      now,
    }),
  );
  appendRoleSessionRecord(
    run_root,
    layout,
    buildRoleSessionRecord({
      mission_id,
      role: "hq",
      event_type: "heartbeat",
      session_id: "sess-hq-dogfood-1",
      now: new Date(now.getTime() - 1000),
    }),
  );
  appendRoleSessionRecord(
    run_root,
    layout,
    buildRoleSessionRecord({
      mission_id,
      role: "runner",
      event_type: "heartbeat",
      session_id: "sess-runner-dogfood-1",
      now: new Date(now.getTime() - 500),
    }),
  );
  appendRoleSessionRecord(
    run_root,
    layout,
    buildRoleSessionRecord({
      mission_id,
      role: "topology-supervisor",
      event_type: "closed",
      session_id: "sess-supervisor-dogfood-1",
      now: new Date(now.getTime() - 30_000),
    }),
  );

  // Step 8: simulate packet traffic.
  appendPacketLedger(run_root, layout, packetEntry({
    mission_id,
    packet_id: "pkt_evt_1",
    from: "topology-supervisor",
    to: "topology-supervisor",
    type: "REPORT",
    state: "delivered",
    first_seen_at: new Date(now.getTime() - 5000).toISOString(),
    last_seen_at: new Date(now.getTime() - 1000).toISOString(),
  }));
  appendPacketLedger(run_root, layout, packetEntry({
    mission_id,
    packet_id: "pkt_evt_2",
    from: "runner",
    to: "hq",
    type: "REPORT",
    state: "acknowledged",
    first_seen_at: new Date(now.getTime() - 4000).toISOString(),
    last_seen_at: new Date(now.getTime() - 2000).toISOString(),
  }));
  appendPacketLedger(run_root, layout, packetEntry({
    mission_id,
    packet_id: "pkt_evt_3",
    from: "hq",
    to: "librarian",
    type: "STATUS",
    state: "delivered",
    first_seen_at: new Date(now.getTime() - 60 * 60 * 1000).toISOString(),
    last_seen_at: new Date(now.getTime() - 60 * 60 * 1000).toISOString(), // 1h ago → stale (threshold 30min)
  }));
  appendPacketLedger(run_root, layout, packetEntry({
    mission_id,
    packet_id: "pkt_evt_4",
    from: "hq",
    to: "scott",
    type: "STATUS",
    state: "delivered",
    first_seen_at: new Date(now.getTime() - 3000).toISOString(),
    last_seen_at: new Date(now.getTime() - 2000).toISOString(),
  }));

  // Step 9: append a runtime event for traceability.
  appendRuntimeEvent(run_root, layout, {
    event_type: "dogfood_started",
    mission_id,
    run_id,
    timestamp: started_at,
  });

  // Step 10: read dashboard.
  const snapshot = readDashboardSnapshot(run_root, { now });
  const dashboardText = formatDashboardText(snapshot);
  const dashboardVerboseText = formatDashboardTextDetailed(snapshot);

  // Step 11: legacy migration on a sibling workspace.
  let legacyMigration: MigrationResult = {
    ok: true,
    mode: "no_legacy",
    mission_id: null,
    reason: "legacy step disabled",
    files_migrated: [],
    files_created_empty: [],
    warnings: [],
    generated_at: new Date().toISOString(),
  };
  let legacyWorkspace = "";
  if (options.migrateLegacy !== false) {
    legacyWorkspace = makeLegacySiblingWorkspace(run_root, `${mission_id}-legacy`);
    // Run detect first to record baseline
    if (!detectLegacyLayout(legacyWorkspace)) {
      warnings.push(`legacy sibling workspace ${legacyWorkspace} was not detected as legacy`);
    }
    legacyMigration = migrateLegacyToPerMission(legacyWorkspace, { now });
  }

  // Step 12: wait briefly for the supervisor script to write its log line.
  if (supervisorProc) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 1500);
      supervisorProc!.on("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  const finished_at = new Date().toISOString();

  // Append a final runtime event with the run timestamp.
  appendRuntimeEvent(run_root, layout, {
    event_type: "dogfood_finished",
    mission_id,
    run_id,
    timestamp: finished_at,
  });

  // Step 13: build cleanup command (will be executed by cleanupDogfood).
  const cleanupCommand =
    `pgrep -f ${shellQuote(run_root)} | xargs -r kill -TERM 2>/dev/null; ` +
    `sleep 1; pgrep -f ${shellQuote(run_root)} | xargs -r kill -KILL 2>/dev/null; ` +
    `rm -rf ${shellQuote(run_root)}; ` +
    `pgrep -f ${shellQuote(run_root)} || echo "cleanup_ok_no_residual_processes"`;

  return {
    run_id,
    run_root,
    mission_id,
    mission_title: objective,
    mission_dir: layout.missionDirAbsolute,
    generated_scripts: launchScripts,
    launch_mode: "direct-script-with-pi-stub",
    terminal_log_path: terminalLogPath,
    pi_session_file_path: "n/a (pi stub used; sessions.jsonl record_id=sess-hq-dogfood-1)",
    pids: pids.filter((p) => p > 0),
    sessions_path: layout.sessionsPath,
    runtime_events_path: layout.runtimeEventsPath,
    packet_ledger_path: layout.packetLedgerPath,
    incident_log_path: layout.incidentLogPath,
    dashboard_text: dashboardText,
    dashboard_verbose_text: dashboardVerboseText,
    dashboard_snapshot: snapshot,
    legacy_migration: legacyMigration,
    legacy_workspace_path: legacyWorkspace,
    cleanup_command: cleanupCommand,
    cleaned_up: false,
    post_cleanup_ps_proof: "(not yet run)",
    started_at,
    finished_at,
    warnings,
  };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function packetEntry(opts: {
  mission_id: string;
  packet_id: string;
  from: import("../types/roles.ts").TopologyRole extends never ? never : import("./mission.ts").TopologyRole;
  to: import("./mission.ts").TopologyRole;
  type: PacketLedgerEntry["type"];
  state: PacketLedgerEntry["state"];
  first_seen_at: string;
  last_seen_at: string;
}): PacketLedgerEntry {
  return {
    packet_id: opts.packet_id,
    mission_id: opts.mission_id,
    type: opts.type,
    from: opts.from,
    to: opts.to,
    request_msg_id: null,
    correlation_id: null,
    state: opts.state,
    raw_transport_path: null,
    first_seen_at: opts.first_seen_at,
    last_seen_at: opts.last_seen_at,
    classification_reason: null,
    artifact_path: null,
  };
}

function appendRuntimeEvent(
  workspaceDir: string,
  layout: ReturnType<typeof missionLayoutPaths>,
  event: Record<string, unknown>,
): void {
  const line = `${JSON.stringify(event)}\n`;
  const previous = existsSync(layout.runtimeEventsPath)
    ? readFileSync(layout.runtimeEventsPath, "utf8")
    : "";
  writeFileSync(layout.runtimeEventsPath, `${previous}${line}`, "utf8");
  // Also write to the root mirror path (per spec §3.2).
  const rootPath = path.join(workspaceDir, ".pi", "topology", "runtime-events.jsonl");
  mkdirSync(path.dirname(rootPath), { recursive: true });
  writeFileSync(rootPath, `${previous}${line}`, "utf8");
}

/**
 * Clean up the dogfood run: kill all matching PIDs (narrow scope via
 * pgrep on run_root), then remove the run root. Updates the run
 * with post-cleanup ps proof.
 */
export function cleanupDogfood(run: DogfoodRun): DogfoodRun {
  if (run.cleaned_up) return run;

  // Narrow pgrep: only processes whose command line includes run_root.
  // We do NOT use `pkill -f` (broad); we enumerate PIDs and kill one
  // by one, then verify the narrow pgrep returns nothing.
  let residual = "";
  try {
    residual = execSync(`pgrep -f ${shellQuote(run.run_root)} || true`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    residual = "";
  }
  const residualPids = residual
    .split("\n")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);

  for (const pid of residualPids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // already gone
    }
  }
  // Wait briefly for SIGTERM to take effect.
  if (residualPids.length > 0) {
    const start = Date.now();
    while (Date.now() - start < 2000) {
      try {
        const still = execSync(`pgrep -f ${shellQuote(run.run_root)} || true`, {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }).trim();
        if (!still) break;
      } catch {
        break;
      }
    }
    // SIGKILL stragglers.
    try {
      const still = execSync(`pgrep -f ${shellQuote(run.run_root)} || true`, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      for (const pid of still.split("\n").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0)) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // gone
        }
      }
    } catch {
      // ignore
    }
  }

  // Remove the run root.
  try {
    rmSync(run.run_root, { recursive: true, force: true });
  } catch {
    // best effort
  }

  // Final narrow pgrep proof.
  let final = "";
  try {
    final = execSync(`pgrep -f ${shellQuote(run.run_root)} || true`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    final = "";
  }
  const postCleanupProof = final.length > 0
    ? `RESIDUAL: ${final.split("\n").join(",")}`
    : "cleanup_ok_no_residual_processes";

  return {
    ...run,
    cleaned_up: true,
    post_cleanup_ps_proof: postCleanupProof,
  };
}

export function formatDogfoodEvidence(run: DogfoodRun): string {
  const lines: string[] = [];
  lines.push(`# Dogfood Run — ${run.run_id}`);
  lines.push("");
  lines.push(`started_at: ${run.started_at}`);
  lines.push(`finished_at: ${run.finished_at}`);
  lines.push(`run_root: ${run.run_root}`);
  lines.push(`mission_id: ${run.mission_id}`);
  lines.push(`mission_title: ${run.mission_title}`);
  lines.push("");
  lines.push("## 10-Field Evidence (per slice 7 memory rule)");
  lines.push("");
  lines.push(`1. launch_mode: ${run.launch_mode}`);
  lines.push(`2. run_root: ${run.run_root}`);
  lines.push(`3. generated_scripts:`);
  for (const s of run.generated_scripts) {
    lines.push(`   - ${s.role}: ${s.scriptPath}`);
  }
  lines.push(`4. pi_session_file_path: ${run.pi_session_file_path}`);
  lines.push(`5. pids: ${run.pids.length > 0 ? run.pids.join(", ") : "(none captured — supervisor script uses pi stub)"}`);
  lines.push(`6. sessions_path: ${run.sessions_path}`);
  lines.push(`7. runtime_events_path: ${run.runtime_events_path}`);
  lines.push(`8. terminal_log_path: ${run.terminal_log_path}`);
  lines.push(`9. cleanup_command: \`${run.cleanup_command}\``);
  lines.push(`10. post_cleanup_ps_proof: ${run.post_cleanup_ps_proof}`);
  lines.push("");
  lines.push("## Dashboard (compact)");
  lines.push("```");
  lines.push(run.dashboard_text);
  lines.push("```");
  lines.push("");
  lines.push("## Dashboard Snapshot Fields (spec §10)");
  lines.push("```");
  lines.push(`active_mission_id: ${run.dashboard_snapshot.active_mission_id}`);
  lines.push(`lifecycle_state: ${run.dashboard_snapshot.lifecycle_state}`);
  lines.push(`owner_gate: ${run.dashboard_snapshot.owner_gate}`);
  lines.push(`next_action: ${run.dashboard_snapshot.next_action ?? "(none)"}`);
  const s = run.dashboard_snapshot.role_summary;
  lines.push(`role_summary: live=${s.live} resumable=${s.resumable} stale=${s.stale} parked=${s.parked} closed=${s.closed}`);
  lines.push(`pending_packet_count: ${run.dashboard_snapshot.pending_packet_count}`);
  lines.push(`pending_packet_total: ${run.dashboard_snapshot.pending_packet_total}`);
  lines.push(`stale_packet_count: ${run.dashboard_snapshot.stale_packet_count}`);
  lines.push(`incident_count: ${run.dashboard_snapshot.incident_count}`);
  lines.push(`closeout_path: ${run.dashboard_snapshot.closeout_path ?? "(none)"}`);
  lines.push("```");
  lines.push("");
  lines.push("## Legacy Migration Step");
  lines.push("```");
  lines.push(`legacy_workspace: ${run.legacy_workspace_path || "(skipped)"}`);
  lines.push(`mode: ${run.legacy_migration.mode}`);
  lines.push(`ok: ${run.legacy_migration.ok}`);
  lines.push(`mission_id: ${run.legacy_migration.mission_id ?? "(none)"}`);
  lines.push(`files_migrated: ${JSON.stringify(run.legacy_migration.files_migrated)}`);
  lines.push(`files_created_empty: ${JSON.stringify(run.legacy_migration.files_created_empty)}`);
  lines.push(`reason: ${run.legacy_migration.reason ?? "(none)"}`);
  lines.push("```");
  lines.push("");
  if (run.warnings.length > 0) {
    lines.push("## Warnings");
    for (const w of run.warnings) lines.push(`- ${w}`);
    lines.push("");
  }
  return lines.join("\n");
}
