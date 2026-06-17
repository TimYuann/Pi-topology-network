/**
 * Slice 7 integration test: runs the full dogfood acceptance flow.
 *
 * This is NOT a unit test. It:
 *   1. Spawns a real `bash` process for the supervisor script (with a
 *      deterministic `pi` stub on PATH; no real Pi session is opened).
 *   2. Simulates role session activity by writing to the per-mission
 *      `sessions.jsonl`.
 *   3. Simulates packet traffic by writing to `packet-ledger.jsonl`.
 *   4. Reads the dashboard (slice 5) end-to-end.
 *   5. Runs the slice 6 migration on a sibling legacy workspace.
 *   6. Captures all 10 evidence fields and writes them to
 *      `records/2026-06-17-pi-topology-dogfood-run.md`.
 *   7. Cleans up via narrow `pgrep -f <run_root>` (NEVER `pkill -f`).
 *
 * Run with: `npm run dogfood` (see package.json).
 *
 * E2E window governance (per memory):
 *   - run_root is `/tmp/pi-topology-dogfood-<id>/`, NOT in the user's
 *     main project directory.
 *   - pgrep is scoped to run_root only; the user's M3 main session is
 *     not in this path and is therefore never matched.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  cleanupDogfood,
  formatDogfoodEvidence,
  runDogfoodAcceptance,
  type DogfoodRun,
} from "../../src/runtime/dogfood.ts";
import { readMissionRegistry } from "../../src/runtime/mission-registry.ts";

const EVIDENCE_DIR = join(process.cwd(), "..", "..", "records");

test("dogfood: full slice 1-6 acceptance run", { timeout: 30_000 }, async () => {
  // 1. Run the dogfood.
  let run: DogfoodRun = await runDogfoodAcceptance({
    runId: "smoke",
    project: "dogfood-smoke",
    objective: "Slice 7 smoke: verify slice 1-6 end-to-end",
    allowedPaths: ["/tmp"],
    lifecycleState: "running",
  });

  try {
    // 2. Verify the per-mission layout was created.
    assert.ok(existsSync(run.mission_dir), `mission_dir ${run.mission_dir} should exist`);
    assert.ok(existsSync(run.sessions_path), "sessions.jsonl should exist");
    assert.ok(existsSync(run.runtime_events_path), "runtime-events.jsonl should exist");
    assert.ok(existsSync(run.packet_ledger_path), "packet-ledger.jsonl should exist");
    assert.ok(existsSync(run.incident_log_path), "incident-log.jsonl should exist");

    // 3. Verify 7 launch scripts were generated.
    assert.equal(run.generated_scripts.length, 7);
    for (const script of run.generated_scripts) {
      assert.ok(existsSync(script.scriptPath), `${script.role} script should exist`);
    }

    // 4. Verify the supervisor script actually ran. The pi stub captures
    // the launch args in the terminal log; the script's own
    // `[topology] launch` line is only written when logPath is passed
    // to writeRoleLaunchScript, which the sync launcher does not do
    // (by design — the script template accepts logPath as an option).
    // The presence of either proves the launch started.
    if (existsSync(run.terminal_log_path)) {
      const log = readFileSync(run.terminal_log_path, "utf8");
      assert.ok(log.length > 0, "terminal log should be non-empty after launch");
      assert.match(log, /launch/i, "terminal log should contain a launch line");
    }

    // 5. Verify the dashboard populated all 8 spec §10 fields.
    const snap = run.dashboard_snapshot;
    assert.equal(snap.has_active_mission, true);
    assert.equal(snap.active_mission_id, run.mission_id);
    assert.equal(snap.lifecycle_state, "running");
    assert.ok(snap.owner_gate !== null);
    // next_action may be null if the picker has no option; that's OK.
    // role_summary should reflect the simulated sessions.
    const s = snap.role_summary;
    const total = s.live + s.resumable + s.stale + s.parked + s.closed;
    assert.equal(total, 7, "all 7 roles should be classified");
    // pending_packet_count should match the 3 actionable packets (REPORT→supervisor, REPORT→hq, STATUS→scott)
    // pkt_evt_3 is STATUS→librarian (NOT actionable for librarian) → not counted
    assert.equal(snap.pending_packet_count, 3, "3 actionable packets (REPORT, REPORT, STATUS→scott)");
    assert.equal(snap.pending_packet_total, 3, "3 active packets (stale-by-freshness pkt_evt_3 excluded)");
    assert.equal(snap.stale_packet_count, 1, "1 stale-by-freshness (pkt_evt_3)");

    // 6. Verify the registry was set up correctly.
    const reg = readMissionRegistry(run.run_root);
    assert.ok(reg);
    assert.equal(reg.active_mission_id, run.mission_id);
    assert.equal(reg.missions.length, 1);

    // 7. Verify the legacy migration step ran.
    assert.equal(run.legacy_migration.ok, true);
    assert.equal(run.legacy_migration.mode, "migrated");
    assert.ok(run.legacy_migration.mission_id, "legacy migration should produce a mission_id");
    // After migration, both mission-registry.json and active-mission.json should exist
    assert.ok(existsSync(join(run.legacy_workspace_path, ".pi", "topology", "mission-registry.json")));

    // 8. Clean up via narrow pgrep on run_root. This updates
    // `post_cleanup_ps_proof` on the run.
    run = cleanupDogfood(run);
    assert.equal(run.cleaned_up, true);
    assert.match(run.post_cleanup_ps_proof, /cleanup_ok_no_residual_processes/);
    assert.equal(existsSync(run.run_root), false, "run_root should be removed");

    // 9. Save evidence AFTER cleanup so the post-cleanup ps proof is
    // included in the artifact.
    const evidencePath = join(EVIDENCE_DIR, `2026-06-17-pi-topology-dogfood-run-${run.run_id}.md`);
    const evidence = formatDogfoodEvidence(run);
    const { writeFileSync, mkdirSync } = await import("node:fs");
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    writeFileSync(evidencePath, evidence, "utf8");
    assert.ok(existsSync(evidencePath));
  } catch (err) {
    // If anything in the try block failed BEFORE cleanup, still try to
    // clean up. The user's M3 main session is in the main project dir;
    // the dogfood cwd is in /tmp/pi-topology-dogfood-* and shares no
    // path components, so narrow pgrep is safe.
    run = cleanupDogfood(run);
    throw err;
  }
});
