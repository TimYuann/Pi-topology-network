import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { evaluateToolCall } from "../../src/runtime/guard.ts";

const mission = {
  allowed_paths: ["/work/project/packages/pi-topology", "/work/project/docs"],
  forbidden_actions: ["git push", "git reset --hard", "rm -rf"],
};

test("guard blocks write and shell violations and records incident logs", () => {
  const incidentLogDir = mkdtempSync(join(tmpdir(), "pi-topology-guard-incident-"));
  const incidentLogPath = join(incidentLogDir, "incident-log.jsonl");
  try {
    const repairAllowed = evaluateToolCall({
      role: "repair",
      mission,
      tool: "write_file",
      path: "/work/project/packages/pi-topology/README.md",
      incident_log_path: incidentLogPath,
    });
    assert.equal(repairAllowed.decision, "allow");

    const runnerBlocked = evaluateToolCall({
      role: "runner",
      mission,
      tool: "write_file",
      path: "/work/project/docs/result.md",
      incident_log_path: incidentLogPath,
    });
    assert.equal(runnerBlocked.decision, "block");

    const oracleBlocked = evaluateToolCall({
      role: "oracle",
      mission,
      tool: "write_file",
      path: "/work/project/docs/result.md",
      incident_log_path: incidentLogPath,
    });
    assert.equal(oracleBlocked.decision, "block");

    const scottBlocked = evaluateToolCall({
      role: "scott",
      mission,
      tool: "write_file",
      path: "/work/project/docs/result.md",
      incident_log_path: incidentLogPath,
    });
    assert.equal(scottBlocked.decision, "block");

    const librarianBlocked = evaluateToolCall({
      role: "librarian",
      mission,
      tool: "write_file",
      path: "/work/project/docs/result.md",
      incident_log_path: incidentLogPath,
    });
    assert.equal(librarianBlocked.decision, "block");

    const repairBlocked = evaluateToolCall({
      role: "repair",
      mission,
      tool: "write_file",
      path: "/work/project/src/app.ts",
      incident_log_path: incidentLogPath,
    });
    assert.equal(repairBlocked.decision, "block");
    assert.equal(repairBlocked.incident?.incident_type, "scope_violation");

    const ownerGate = evaluateToolCall({
      role: "repair",
      mission,
      tool: "shell",
      command: "git push origin main",
      incident_log_path: incidentLogPath,
    });
    assert.equal(ownerGate.decision, "owner_gate");

    const lines = readFileSync(incidentLogPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { actor: string; incident_type: string; severity: string });
    assert.equal(lines.length, 6);
    assert.equal(lines[0].incident_type, "role_boundary_violation");
    assert.equal(lines[1].incident_type, "role_boundary_violation");
    assert.equal(lines[2].incident_type, "role_boundary_violation");
    assert.equal(lines[3].incident_type, "role_boundary_violation");
    assert.equal(lines[4].incident_type, "scope_violation");
    assert.equal(lines[5].incident_type, "owner_gate");
  } finally {
    rmSync(incidentLogDir, { recursive: true, force: true });
  }
});
