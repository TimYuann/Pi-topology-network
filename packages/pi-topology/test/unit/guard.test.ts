import assert from "node:assert/strict";
import test from "node:test";
import { evaluateToolCall } from "../../src/runtime/guard.ts";

const mission = {
  allowed_paths: ["/work/project/packages/pi-topology", "/work/project/docs"],
  forbidden_actions: ["git push", "git reset --hard", "rm -rf"],
};

test("repair can write only inside mission allowed paths", () => {
  assert.equal(evaluateToolCall({ role: "repair", mission, tool: "write_file", path: "/work/project/docs/readme.md" }).decision, "allow");

  const blocked = evaluateToolCall({ role: "repair", mission, tool: "write_file", path: "/work/project/src/app.ts" });
  assert.equal(blocked.decision, "block");
  assert.equal(blocked.incident?.incident_type, "scope_violation");
});

test("runner and oracle are read-only by default", () => {
  const runner = evaluateToolCall({ role: "runner", mission, tool: "write_file", path: "/work/project/docs/result.md" });
  assert.equal(runner.decision, "block");
  assert.equal(runner.incident?.incident_type, "role_boundary_violation");

  const oracle = evaluateToolCall({ role: "oracle", mission, tool: "read_file", path: "/work/project/docs/result.md" });
  assert.equal(oracle.decision, "allow");
});

test("hq can write only controlled coordination paths", () => {
  const projectMission = {
    allowed_paths: ["/work/project"],
    forbidden_actions: ["git push", "git reset --hard", "rm -rf"],
  };

  const docs = evaluateToolCall({ role: "hq", mission: projectMission, tool: "write_file", path: "/work/project/docs/handoff.md" });
  const ownArtifact = evaluateToolCall({ role: "hq", mission: projectMission, tool: "write_file", path: "/work/project/.pi/topology/artifacts/hq/intake.md" });
  const code = evaluateToolCall({ role: "hq", mission: projectMission, tool: "write_file", path: "/work/project/src/app.ts" });
  const otherArtifact = evaluateToolCall({ role: "hq", mission: projectMission, tool: "write_file", path: "/work/project/.pi/topology/artifacts/runner/report.md" });

  assert.equal(docs.decision, "allow");
  assert.equal(ownArtifact.decision, "allow");
  assert.equal(code.decision, "block");
  assert.equal(otherArtifact.decision, "block");
});

test("forbidden shell actions enter owner gate", () => {
  const result = evaluateToolCall({ role: "repair", mission, tool: "shell", command: "git push origin main" });
  assert.equal(result.decision, "owner_gate");
  assert.equal(result.incident?.incident_type, "owner_gate");
});

test("non-repair roles cannot use shell commands that write files", () => {
  const hq = evaluateToolCall({
    role: "hq",
    mission,
    tool: "shell",
    command: "cat > /work/project/docs/incident-log.jsonl <<'EOF'\n{}\nEOF",
  });
  assert.equal(hq.decision, "block");
  assert.equal(hq.incident?.incident_type, "role_boundary_violation");

  const runnerReadOnly = evaluateToolCall({
    role: "runner",
    mission,
    tool: "shell",
    command: "git status --short",
  });
  assert.equal(runnerReadOnly.decision, "allow");
});
