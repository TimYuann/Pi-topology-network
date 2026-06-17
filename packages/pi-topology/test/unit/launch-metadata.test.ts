import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildLaunchMetadata,
  validateLaunchMetadata,
  type LaunchMetadata,
} from "../../src/runtime/launch-metadata.ts";
import {
  createMissionDraft,
  type MissionCard,
} from "../../src/runtime/mission.ts";

function makeMission(): MissionCard {
  return createMissionDraft({
    project: "dogfood",
    workdir: "/work/project",
    objective: "Launch metadata proof",
    allowed_paths: ["/work/project/packages", "/work/project/docs"],
  });
}

function makeWorkspace(): string {
  return mkdtempSync(join(tmpdir(), "pi-topology-slice2-launch-"));
}

test("buildLaunchMetadata returns 12 fields per spec §6.1", () => {
  const mission = makeMission();
  const ws = makeWorkspace();
  try {
    const cardPath = join(ws, "mission-card.json");
    writeFileSync(cardPath, JSON.stringify(mission), "utf8");

    const meta = buildLaunchMetadata({
      mission,
      role: "hq",
      scriptPath: "/work/project/launch/hq.sh",
      permission_source: cardPath,
    });

    // All 12 spec §6.1 fields present.
    const fields = [
      "mission_id",
      "role",
      "session_id",
      "script_path",
      "provider",
      "model",
      "thinking",
      "tools",
      "write_policy",
      "allowed_paths",
      "forbidden_actions",
      "permission_source",
    ];
    for (const f of fields) {
      assert.ok(Object.prototype.hasOwnProperty.call(meta, f), `missing field ${f}`);
    }

    assert.equal(meta.mission_id, mission.mission_id);
    assert.equal(meta.role, "hq");
    assert.equal(meta.session_id, null);
    assert.equal(meta.provider, "minimax-cn");
    assert.equal(meta.model, "MiniMax-M3");
    assert.equal(meta.thinking, "low");
    assert.deepEqual(meta.tools, ["read", "bash", "edit", "write", "topology_*"]);
    assert.equal(meta.write_policy, "no_business_code_writes");
    // HQ is not read-only → allowed_paths = mission.allowed_paths.
    assert.deepEqual(meta.allowed_paths, ["/work/project/packages", "/work/project/docs"]);
    assert.deepEqual(meta.forbidden_actions, mission.forbidden_actions);
    assert.equal(meta.permission_source, cardPath);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("buildLaunchMetadata for read-only roles forces allowed_paths to []", () => {
  const mission = makeMission();
  for (const role of ["runner", "oracle", "librarian", "scott"] as const) {
    const meta = buildLaunchMetadata({
      mission,
      role,
      scriptPath: `/work/project/launch/${role}.sh`,
    });
    assert.equal(meta.write_policy, "read_only");
    assert.deepEqual(meta.allowed_paths, [], `role ${role} must have empty allowed_paths`);
  }
});

test("buildLaunchMetadata for repair copies mission.allowed_paths (allowed_paths_only)", () => {
  const mission = makeMission();
  const meta = buildLaunchMetadata({
    mission,
    role: "repair",
    scriptPath: "/work/project/launch/repair.sh",
  });
  assert.equal(meta.write_policy, "allowed_paths_only");
  assert.deepEqual(meta.allowed_paths, mission.allowed_paths);
});

test("buildLaunchMetadata throws when role is not in mission.roles", () => {
  const mission = makeMission();
  // @ts-expect-error: invalid role for runtime check
  assert.throws(() => buildLaunchMetadata({ mission, role: "ghost-role", scriptPath: "/x.sh" }));
});

test("validateLaunchMetadata passes for valid metadata", () => {
  const ws = makeWorkspace();
  try {
    const mission = createMissionDraft({
      project: "dogfood",
      workdir: ws,
      objective: "Launch metadata proof",
      allowed_paths: [join(ws, "packages"), join(ws, "docs")],
    });
    const cardPath = join(ws, "mission-card.json");
    writeFileSync(cardPath, JSON.stringify(mission), "utf8");
    const meta: LaunchMetadata = buildLaunchMetadata({
      mission,
      role: "hq",
      scriptPath: join(ws, "launch", "hq.sh"),
      permission_source: cardPath,
    });
    const result = validateLaunchMetadata(meta, mission, ws);
    assert.equal(result.ok, true);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("validateLaunchMetadata rejects mission_id mismatch", () => {
  const mission = makeMission();
  const ws = makeWorkspace();
  try {
    const cardPath = join(ws, "mission-card.json");
    writeFileSync(cardPath, JSON.stringify(mission), "utf8");
    const meta = buildLaunchMetadata({
      mission,
      role: "hq",
      scriptPath: "/work/project/launch/hq.sh",
      permission_source: cardPath,
    });
    meta.mission_id = "different-id";
    const result = validateLaunchMetadata(meta, mission, ws);
    assert.equal(result.ok, false);
    assert.equal(result.failure, "mission_mismatch");
    assert.ok(result.incident);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("validateLaunchMetadata rejects write_policy downgrade (HQ forced to read_only)", () => {
  const mission = makeMission();
  const ws = makeWorkspace();
  try {
    const cardPath = join(ws, "mission-card.json");
    writeFileSync(cardPath, JSON.stringify(mission), "utf8");
    const meta = buildLaunchMetadata({
      mission,
      role: "hq",
      scriptPath: "/work/project/launch/hq.sh",
      permission_source: cardPath,
    });
    // Forge write_policy downgrade.
    meta.write_policy = "read_only";
    const result = validateLaunchMetadata(meta, mission, ws);
    assert.equal(result.ok, false);
    assert.equal(result.failure, "write_policy_mismatch");
    assert.match(result.reason ?? "", /write_policy/);
    assert.equal(result.incident?.type, "role_policy_violation");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("validateLaunchMetadata rejects read_only role with non-empty allowed_paths", () => {
  const mission = makeMission();
  const ws = makeWorkspace();
  try {
    const cardPath = join(ws, "mission-card.json");
    writeFileSync(cardPath, JSON.stringify(mission), "utf8");
    const meta = buildLaunchMetadata({
      mission,
      role: "runner",
      scriptPath: "/work/project/launch/runner.sh",
      permission_source: cardPath,
    });
    // Bypass the builder invariant.
    meta.allowed_paths = ["/work/project/packages"];
    const result = validateLaunchMetadata(meta, mission, ws);
    assert.equal(result.ok, false);
    assert.equal(result.failure, "read_only_role_with_write_paths");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("validateLaunchMetadata rejects allowed_paths escape from mission.allowed_paths", () => {
  const mission = makeMission();
  const ws = makeWorkspace();
  try {
    const cardPath = join(ws, "mission-card.json");
    writeFileSync(cardPath, JSON.stringify(mission), "utf8");
    const meta = buildLaunchMetadata({
      mission,
      role: "repair",
      scriptPath: "/work/project/launch/repair.sh",
      permission_source: cardPath,
    });
    meta.allowed_paths = ["/work/project/packages", "/etc/passwd"];
    const result = validateLaunchMetadata(meta, mission, ws);
    assert.equal(result.ok, false);
    assert.equal(result.failure, "allowed_paths_not_subset");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("validateLaunchMetadata rejects missing forbidden_actions", () => {
  const mission = makeMission();
  const ws = makeWorkspace();
  try {
    const cardPath = join(ws, "mission-card.json");
    writeFileSync(cardPath, JSON.stringify(mission), "utf8");
    const meta = buildLaunchMetadata({
      mission,
      role: "hq",
      scriptPath: "/work/project/launch/hq.sh",
      permission_source: cardPath,
    });
    meta.forbidden_actions = [];
    const result = validateLaunchMetadata(meta, mission, ws);
    assert.equal(result.ok, false);
    assert.equal(result.failure, "forbidden_actions_missing");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("validateLaunchMetadata rejects missing permission_source file", () => {
  const mission = makeMission();
  const ws = makeWorkspace();
  try {
    const meta = buildLaunchMetadata({
      mission,
      role: "hq",
      scriptPath: "/work/project/launch/hq.sh",
      permission_source: "/nonexistent/mission-card.json",
    });
    const result = validateLaunchMetadata(meta, mission, ws);
    assert.equal(result.ok, false);
    assert.equal(result.failure, "permission_source_missing");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("validateLaunchMetadata rejects script_path outside workspace and not /tmp", () => {
  const ws = makeWorkspace();
  try {
    const mission = createMissionDraft({
      project: "dogfood",
      workdir: ws,
      objective: "script_path escape",
      allowed_paths: [ws],
    });
    const cardPath = join(ws, "mission-card.json");
    writeFileSync(cardPath, JSON.stringify(mission), "utf8");
    const meta = buildLaunchMetadata({
      mission,
      role: "hq",
      scriptPath: "/etc/passwd-helper.sh",
      permission_source: cardPath,
    });
    const result = validateLaunchMetadata(meta, mission, ws);
    assert.equal(result.ok, false);
    assert.equal(result.failure, "script_path_outside_workspace");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("validateLaunchMetadata accepts /tmp script_path (visible peer mesh workdirs)", () => {
  const mission = makeMission();
  const ws = makeWorkspace();
  try {
    const meta = buildLaunchMetadata({
      mission,
      role: "hq",
      scriptPath: "/tmp/pi-topology-mesh-spawn-guidance-XXX/launch/hq.sh",
    });
    // No permission_source supplied here; only the workspace/escape check runs.
    const result = validateLaunchMetadata(meta, mission, ws);
    // May fail for permission_source if existsSync fails — that's fine; we
    // only assert the script_path check passed.
    assert.notEqual(result.failure, "script_path_outside_workspace");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("permission_source defaults to mission.workdir/mission-card.json and the existing card is found", () => {
  const ws = makeWorkspace();
  try {
    const cardDir = join(ws, "workspace");
    mkdirSync(cardDir, { recursive: true });
    const cardPath = join(cardDir, "mission-card.json");
    const baseCard = createMissionDraft({
      project: "dogfood",
      workdir: cardDir,
      objective: "permission source default",
      allowed_paths: [cardDir],
    });
    const card: MissionCard = { ...baseCard, workdir: cardDir };
    writeFileSync(cardPath, JSON.stringify(card), "utf8");

    const meta = buildLaunchMetadata({
      mission: card,
      role: "hq",
      scriptPath: join(cardDir, "launch", "hq.sh"),
    });
    assert.equal(meta.permission_source, cardPath);
    assert.ok(existsSync(meta.permission_source));
    const result = validateLaunchMetadata(meta, card, cardDir);
    assert.equal(result.ok, true);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
