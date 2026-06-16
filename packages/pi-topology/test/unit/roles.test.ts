import assert from "node:assert/strict";
import test from "node:test";
import { bundledPromptPath } from "../../src/roles/prompts.ts";
import { TOPOLOGY_ROLES, ROLE_POLICIES } from "../../src/roles/role-policy.ts";

test("role policy includes librarian and scott as on-demand read-only roles", () => {
  assert.equal(TOPOLOGY_ROLES.includes("librarian"), true);
  assert.equal(TOPOLOGY_ROLES.includes("scott"), true);
  assert.equal(ROLE_POLICIES.librarian.spawn_policy, "on_demand");
  assert.equal(ROLE_POLICIES.librarian.write_policy, "read_only");
  assert.equal(ROLE_POLICIES.scott.spawn_policy, "on_demand");
  assert.equal(ROLE_POLICIES.scott.write_policy, "read_only");
});

test("bundled prompt resolves canonical paths for new roles", () => {
  assert.equal(
    bundledPromptPath("/pkg/pi-topology", "librarian"),
    "/pkg/pi-topology/agents/librarian.md",
  );
  assert.equal(
    bundledPromptPath("/pkg/pi-topology", "scott"),
    "/pkg/pi-topology/agents/scott.md",
  );
});
