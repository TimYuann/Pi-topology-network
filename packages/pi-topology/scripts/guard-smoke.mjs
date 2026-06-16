#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import registerPiTopology from "../index.ts";

const runRoot = process.env.PI_TOPOLOGY_GUARD_SMOKE_ROOT ?? "/tmp/pi-topology-guard-smoke";
const allowedRoot = path.join(runRoot, "allowed");
const blockedRoot = path.join(runRoot, "blocked");
const incidentLog = path.join(runRoot, ".pi", "topology", "incident-log.jsonl");
const eventLog = path.join(runRoot, ".pi", "topology", "runtime-events.jsonl");

rmSync(runRoot, { recursive: true, force: true });
mkdirSync(allowedRoot, { recursive: true });
mkdirSync(blockedRoot, { recursive: true });

process.env.PI_TOPOLOGY_ALLOWED_PATHS = allowedRoot;
process.env.PI_TOPOLOGY_FORBIDDEN_ACTIONS = "git push:git reset --hard:rm -rf";
process.env.PI_TOPOLOGY_INCIDENT_LOG = incidentLog;
process.env.PI_TOPOLOGY_EVENT_LOG = eventLog;
process.env.PI_TOPOLOGY_MISSION_ID = "guard-smoke-2026-06-16-001";

let currentRole = "runner";
const handlers = {};
const pi = {
  registerTool() {},
  registerCommand() {},
  registerFlag() {},
  getFlag(name) {
    return name === "cname" ? currentRole : undefined;
  },
  on(name, handler) {
    handlers[name] = handler;
  },
};

registerPiTopology(pi);
assert.equal(typeof handlers.tool_call, "function", "tool_call handler must be registered");

async function call(role, event) {
  currentRole = role;
  return await handlers.tool_call(event);
}

const blockedWritePath = path.join(allowedRoot, "notes.md");
const outsideWritePath = path.join(blockedRoot, "outside.md");

for (const role of ["runner", "oracle", "librarian", "scott"]) {
  const result = await call(role, { name: "write_file", arguments: { path: blockedWritePath } });
  assert.equal(result?.blocked, true, `${role} write must be blocked`);
  assert.equal(result?.decision, "block", `${role} write must hard block`);
  assert.equal(result?.incident?.incident_type, "role_boundary_violation");
}

const repairAllowed = await call("repair", { name: "write_file", arguments: { path: path.join(allowedRoot, "repair.md") } });
assert.equal(repairAllowed, undefined, "repair write inside allowed_paths must be allowed");

const repairOutside = await call("repair", { name: "write_file", arguments: { path: outsideWritePath } });
assert.equal(repairOutside?.blocked, true, "repair write outside allowed_paths must be blocked");
assert.equal(repairOutside?.incident?.incident_type, "scope_violation");

for (const command of ["git push origin main", "git reset --hard HEAD", "rm -rf dist"]) {
  const result = await call("repair", { name: "shell", arguments: { command } });
  assert.equal(result?.blocked, true, `${command} must enter owner gate`);
  assert.equal(result?.decision, "owner_gate", `${command} decision must be owner_gate`);
}

const incidents = readJsonl(incidentLog);
const events = readJsonl(eventLog);

assert.equal(incidents.length, 8, "expected 8 persisted guard incidents");
assert.equal(events.length, 8, "expected 8 persisted guard_block runtime events");
assert.deepEqual(
  incidents.map((entry) => entry.incident_type),
  [
    "role_boundary_violation",
    "role_boundary_violation",
    "role_boundary_violation",
    "role_boundary_violation",
    "scope_violation",
    "owner_gate",
    "owner_gate",
    "owner_gate",
  ],
);
assert.equal(events.every((entry) => entry.event_type === "guard_block"), true);

console.log(JSON.stringify({
  ok: true,
  run_root: runRoot,
  incident_log: incidentLog,
  event_log: eventLog,
  incident_count: incidents.length,
  event_count: events.length,
}, null, 2));

function readJsonl(file) {
  return readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
