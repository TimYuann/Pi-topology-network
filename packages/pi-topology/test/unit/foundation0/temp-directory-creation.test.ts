import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, rm, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import test from "node:test";

import { canonicalizeForDigest, computeSha256Digest, Foundation0ValidationError } from "../../../src/runtime/foundation0/ids.ts";
import {
  validateTempDirectoryCreationPayload,
  validateTempDirectoryIdentity,
} from "../../../src/runtime/foundation0/validation.ts";
import {
  ApprovedTempRootResolutionError,
  InvalidTargetPathError,
  ProtectedPathError,
  TempDirectoryCreationError,
  buildManagedTempDirectoryPath,
  createManagedTempDirectory,
  resolveApprovedTempRoot,
  type CreateManagedTempDirectoryHooks,
} from "../../../src/runtime/foundation0/temp-directory-creation.ts";
import {
  type ActionAttempt,
  type CreateManagedResourceAction,
  type Event,
  type PlannedResource,
  type PolicyDecision,
  type ResourceCreationPlan,
  type TempDirectoryCleanupPolicy,
  type TempDirectoryCreationPayload,
} from "../../../src/runtime/foundation0/schema.ts";
import {
  foundation0StoragePaths,
  readFoundation0Events,
} from "../../../src/runtime/foundation0/event-append.ts";
import {
  computeResourceCreationPlanFingerprint,
  createResourceCreationPlan,
} from "../../../src/runtime/foundation0/resource-creation-plan.ts";

// ============================================================ Task 1 — payload validator

test("validateTempDirectoryCreationPayload accepts a canonical payload", () => {
  const payload = validateTempDirectoryCreationPayload({
    schema_version: 1,
    approved_temp_root_id: "tmp_root_default",
    directory_basename: "pi-topology-a1b2c3",
    creation_nonce: "tmp_nonce_001",
  });

  assert.equal(payload.approved_temp_root_id, "tmp_root_default");
  assert.equal(payload.directory_basename, "pi-topology-a1b2c3");
  assert.equal(payload.creation_nonce, "tmp_nonce_001");
});

test("validateTempDirectoryCreationPayload rejects path-like basenames", () => {
  assert.throws(
    () =>
      validateTempDirectoryCreationPayload({
        schema_version: 1,
        approved_temp_root_id: "tmp_root_default",
        directory_basename: "../escape",
        creation_nonce: "tmp_nonce_001",
      }),
    Foundation0ValidationError,
  );
  assert.throws(
    () =>
      validateTempDirectoryCreationPayload({
        schema_version: 1,
        approved_temp_root_id: "tmp_root_default",
        directory_basename: ".",
        creation_nonce: "tmp_nonce_001",
      }),
    Foundation0ValidationError,
  );
  assert.throws(
    () =>
      validateTempDirectoryCreationPayload({
        schema_version: 1,
        approved_temp_root_id: "tmp_root_default",
        directory_basename: "",
        creation_nonce: "tmp_nonce_001",
      }),
    Foundation0ValidationError,
  );
});

// ============================================================ Task 2 — approved root resolution and path safety

async function tempRootDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "foundation0-t7-root-"));
}

const PROTECTED_NONE: string[] = [];

test("resolveApprovedTempRoot returns the realpath of an existing directory root", async () => {
  const rootDir = await tempRootDir();
  try {
    const resolved = await resolveApprovedTempRoot({
      registry: [{ root_id: "tmp_root_default", path: rootDir }],
      root_id: "tmp_root_default",
      protected_realpaths: PROTECTED_NONE,
    });

    assert.equal(resolved.root_id, "tmp_root_default");
    assert.equal(resolved.configured_path, rootDir);
    assert.equal(resolved.realpath.length > 0, true);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("resolveApprovedTempRoot rejects an unknown root_id", async () => {
  const rootDir = await tempRootDir();
  try {
    await assert.rejects(
      () =>
        resolveApprovedTempRoot({
          registry: [{ root_id: "tmp_root_default", path: rootDir }],
          root_id: "tmp_root_unknown",
          protected_realpaths: PROTECTED_NONE,
        }),
      ApprovedTempRootResolutionError,
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("resolveApprovedTempRoot rejects duplicate root_id entries", async () => {
  const rootDir = await tempRootDir();
  try {
    await assert.rejects(
      () =>
        resolveApprovedTempRoot({
          registry: [
            { root_id: "tmp_root_default", path: rootDir },
            { root_id: "tmp_root_default", path: rootDir },
          ],
          root_id: "tmp_root_default",
          protected_realpaths: PROTECTED_NONE,
        }),
      ApprovedTempRootResolutionError,
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("resolveApprovedTempRoot rejects a configured root that is a symlink", async () => {
  const rootDir = await tempRootDir();
  try {
    const realTarget = join(rootDir, "real");
    await mkdir(realTarget, { recursive: true });
    const linkPath = join(rootDir, "link");
    await symlink(realTarget, linkPath);
    await assert.rejects(
      () =>
        resolveApprovedTempRoot({
          registry: [{ root_id: "tmp_root_default", path: linkPath }],
          root_id: "tmp_root_default",
          protected_realpaths: PROTECTED_NONE,
        }),
      ApprovedTempRootResolutionError,
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("resolveApprovedTempRoot rejects a configured root that is a regular file", async () => {
  const rootDir = await tempRootDir();
  try {
    const filePath = join(rootDir, "not-a-dir");
    await writeFile(filePath, "x");
    await assert.rejects(
      () =>
        resolveApprovedTempRoot({
          registry: [{ root_id: "tmp_root_default", path: filePath }],
          root_id: "tmp_root_default",
          protected_realpaths: PROTECTED_NONE,
        }),
      ApprovedTempRootResolutionError,
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("resolveApprovedTempRoot rejects a realpath equal to a protected path", async () => {
  const rootDir = await tempRootDir();
  try {
    await assert.rejects(
      () =>
        resolveApprovedTempRoot({
          registry: [{ root_id: "tmp_root_default", path: rootDir }],
          root_id: "tmp_root_default",
          protected_realpaths: [rootDir],
        }),
      ApprovedTempRootResolutionError,
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("resolveApprovedTempRoot rejects a current working directory ancestor", async () => {
  const rootDir = await tempRootDir();
  try {
    const repoDir = join(rootDir, "repo");
    const cwd = join(repoDir, "subdir");
    await mkdir(cwd, { recursive: true });

    await assert.rejects(
      () =>
        resolveApprovedTempRoot({
          registry: [{ root_id: "tmp_root_default", path: rootDir }],
          root_id: "tmp_root_default",
          protected_realpaths: [cwd],
        }),
      ApprovedTempRootResolutionError,
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("buildManagedTempDirectoryPath joins a single-segment basename under the root", async () => {
  const rootDir = await tempRootDir();
  try {
    const target = await buildManagedTempDirectoryPath({
      root_realpath: rootDir,
      directory_basename: "pi-topology-aaaa",
      protected_realpaths: PROTECTED_NONE,
    });
    assert.ok(target.endsWith(`${sep}pi-topology-aaaa`), `target should end with basename, got ${target}`);
    assert.ok(target.includes("pi-topology-aaaa"), `target should contain basename`);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("buildManagedTempDirectoryPath rejects basenames with path separators", async () => {
  const rootDir = await tempRootDir();
  try {
    await assert.rejects(
      () =>
        buildManagedTempDirectoryPath({
          root_realpath: rootDir,
          directory_basename: "subdir/leaf",
          protected_realpaths: PROTECTED_NONE,
        }),
      InvalidTargetPathError,
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("buildManagedTempDirectoryPath rejects empty or dot basenames", async () => {
  const rootDir = await tempRootDir();
  try {
    await assert.rejects(
      () =>
        buildManagedTempDirectoryPath({
          root_realpath: rootDir,
          directory_basename: "",
          protected_realpaths: PROTECTED_NONE,
        }),
      InvalidTargetPathError,
    );
    await assert.rejects(
      () =>
        buildManagedTempDirectoryPath({
          root_realpath: rootDir,
          directory_basename: ".",
          protected_realpaths: PROTECTED_NONE,
        }),
      InvalidTargetPathError,
    );
    await assert.rejects(
      () =>
        buildManagedTempDirectoryPath({
          root_realpath: rootDir,
          directory_basename: "..",
          protected_realpaths: PROTECTED_NONE,
        }),
      InvalidTargetPathError,
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("buildManagedTempDirectoryPath rejects a target equal to a protected realpath", async () => {
  const rootDir = await tempRootDir();
  try {
    const protectedPath = join(rootDir, "pi-topology-protected");
    await mkdir(protectedPath, { recursive: true });
    await assert.rejects(
      () =>
        buildManagedTempDirectoryPath({
          root_realpath: rootDir,
          directory_basename: "pi-topology-protected",
          protected_realpaths: [protectedPath],
        }),
      ProtectedPathError,
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("buildManagedTempDirectoryPath rejects a basename that escapes the root via .. traversal", async () => {
  const rootDir = await tempRootDir();
  try {
    await assert.rejects(
      () =>
        buildManagedTempDirectoryPath({
          root_realpath: rootDir,
          directory_basename: "..",
          protected_realpaths: PROTECTED_NONE,
        }),
      InvalidTargetPathError,
    );
    await assert.rejects(
      () =>
        buildManagedTempDirectoryPath({
          root_realpath: rootDir,
          directory_basename: "../escape",
          protected_realpaths: PROTECTED_NONE,
        }),
      InvalidTargetPathError,
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

// ============================================================ Task 3 — pre-effect durable append

async function tempMissionDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "foundation0-t7-mission-"));
}

const MISSION_ID = "mission_foundation0_t7";
const RESOURCE_ID = "res_temp_directory_t7_001";
const ACTION_ID = "action_create_resource_t7_001";
const ACTION_ATTEMPT_ID = "attempt_t7_001";
const POLICY_DECISION_ID = "policy_decision_t7_001";
const AUTHORIZATION_ID = "auth_owner_t7_001";
const ACTOR_ID = "actor_runner_t7_001";
const IDEMPOTENCY_KEY = "idem_t7_create_001";
const POLICY_HASH = `sha256:${"a".repeat(64)}`;
const ACTION_PAYLOAD_DIGEST = `sha256:${"b".repeat(64)}`;
const ACTION_EFFECT_FINGERPRINT = `sha256:${"c".repeat(64)}`;
const PLAN_ID = "plan_temp_directory_t7_001";
const CREATION_NONCE = "tmp_nonce_t7_001";
const VALID_TS = "2026-06-28T12:00:00.000Z";

function tempDirectoryCleanupPolicy(): TempDirectoryCleanupPolicy {
  return {
    rename_strategy: "atomic_rename_under_root",
    delete_strategy: "recursive_no_follow",
  };
}

function plannedResource(): PlannedResource {
  return {
    schema_version: 1,
    resource_id: RESOURCE_ID,
    mission_id: MISSION_ID,
    resource_type: "temp_directory",
    ownership_origin: "created",
    owned_by_actor_id: ACTOR_ID,
    cleanup_owner_actor_id: ACTOR_ID,
    registered_by_action_id: ACTION_ID,
    authorization_id: AUTHORIZATION_ID,
    lifecycle_state: "planned",
    verification_state: "unverified",
    identity: null,
    identity_digest: null,
    cleanup_policy: null,
    created_at: VALID_TS,
    updated_at: VALID_TS,
  };
}

function createManagedResourceAction(
  overrides: Partial<CreateManagedResourceAction> = {},
): CreateManagedResourceAction {
  return {
    schema_version: 1,
    action_id: ACTION_ID,
    mission_id: MISSION_ID,
    actor_id: ACTOR_ID,
    authorization_id: AUTHORIZATION_ID,
    idempotency_key: IDEMPOTENCY_KEY,
    payload_ref: `foundation0/payloads/${ACTION_ID}.json`,
    payload_digest: ACTION_PAYLOAD_DIGEST,
    effect_fingerprint: ACTION_EFFECT_FINGERPRINT,
    retry_of_action_id: null,
    requested_at: VALID_TS,
    capability: "create_managed_resource",
    payload_kind: "create_managed_resource",
    target: { entity_type: "resource", resource_id: RESOURCE_ID },
    ...overrides,
  };
}

function actionAttempt(overrides: Partial<ActionAttempt> = {}): ActionAttempt {
  return {
    schema_version: 1,
    action_attempt_id: ACTION_ATTEMPT_ID,
    action_id: ACTION_ID,
    mission_id: MISSION_ID,
    attempt_number: 1,
    started_at: VALID_TS,
    ...overrides,
  };
}

function allowedExecutionDecision(
  overrides: Partial<PolicyDecision> = {},
): PolicyDecision {
  return {
    schema_version: 1,
    policy_decision_id: POLICY_DECISION_ID,
    action_id: ACTION_ID,
    action_attempt_id: ACTION_ATTEMPT_ID,
    mission_id: MISSION_ID,
    evaluation_point: "execution",
    evaluation_sequence: 1,
    result: "allowed",
    reason_codes: ["create_managed_resource_authorized"],
    authorization_chain: [AUTHORIZATION_ID],
    evaluated_policy_hash: POLICY_HASH,
    decided_at: VALID_TS,
    ...overrides,
  };
}

function makeCreationPayload(
  directoryBasename: string,
): TempDirectoryCreationPayload {
  return validateTempDirectoryCreationPayload({
    schema_version: 1,
    approved_temp_root_id: "tmp_root_default",
    directory_basename: directoryBasename,
    creation_nonce: CREATION_NONCE,
  });
}

function makePlan(directoryBasename: string): ResourceCreationPlan {
  return createResourceCreationPlan({
    planId: PLAN_ID,
    missionId: MISSION_ID,
    resourceId: RESOURCE_ID,
    resourceType: "temp_directory",
    plannedResource: plannedResource(),
    cleanupPolicy: tempDirectoryCleanupPolicy(),
    creationKind: "create_temp_directory",
    creationPayload: makeCreationPayload(directoryBasename) as unknown as Record<string, unknown>,
    authorizationId: AUTHORIZATION_ID,
    requestedByActionId: ACTION_ID,
    createdAt: VALID_TS,
  });
}

interface BuildArgs {
  missionDir?: string;
  approvedRootDir?: string;
  repositoryRoot?: string;
  currentWorkingDirectory?: string;
  actionRequest?: CreateManagedResourceAction;
  actionAttempt?: ActionAttempt;
  allowedDecision?: PolicyDecision;
  directoryBasename?: string;
  hooks?: CreateManagedTempDirectoryHooks;
  nowIso?: () => string;
}
function deriveDirectoryBasename(creationNonce: string, plan: ResourceCreationPlan): string {
  const digest = computeSha256Digest(
    canonicalizeForDigest({
      creation_nonce: creationNonce,
      mission_id: plan.mission_id,
      resource_id: plan.resource_id,
      plan_id: plan.plan_id,
    }),
  );
  // Strip "sha256:" prefix and keep only the first 16 lowercase hex chars
  // to satisfy Foundation-0 ID pattern ^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$.
  const hex = digest.startsWith("sha256:") ? digest.slice("sha256:".length) : digest;
  return `pi-topology-${hex.slice(0, 16)}`;
}

async function defaultBuildArgs(overrides: BuildArgs = {}): Promise<{
  missionDir: string;
  approvedRootDir: string;
  repositoryRoot: string;
  currentWorkingDirectory: string;
  actionRequest: CreateManagedResourceAction;
  actionAttempt: ActionAttempt;
  allowedDecision: PolicyDecision;
  plan: ResourceCreationPlan;
  cleanupPolicy: TempDirectoryCleanupPolicy;
  creationPayload: TempDirectoryCreationPayload;
  hooks: CreateManagedTempDirectoryHooks;
  nowIso: () => string;
}> {
  const missionDir = overrides.missionDir ?? (await tempMissionDir());
  const approvedRootDir = overrides.approvedRootDir ?? (await tempRootDir());
  const repositoryRoot = overrides.repositoryRoot ?? missionDir;
  const currentWorkingDirectory = overrides.currentWorkingDirectory ?? missionDir;

  const directoryBasename = overrides.directoryBasename ?? deriveDirectoryBasename(
    CREATION_NONCE,
    makePlan("unused"),
  );
  const plan = makePlan(directoryBasename);
  const creationPayload = makeCreationPayload(directoryBasename);

  return {
    missionDir,
    approvedRootDir,
    repositoryRoot,
    currentWorkingDirectory,
    actionRequest: overrides.actionRequest ?? createManagedResourceAction(),
    actionAttempt: overrides.actionAttempt ?? actionAttempt(),
    allowedDecision: overrides.allowedDecision ?? allowedExecutionDecision(),
    plan,
    cleanupPolicy: tempDirectoryCleanupPolicy(),
    creationPayload,
    hooks: overrides.hooks ?? {},
    nowIso: overrides.nowIso ?? (() => VALID_TS),
  };
}

test("createManagedTempDirectory appends the four pre-effect events before mkdir fires", async () => {
  const missionDir = await tempMissionDir();
  const approvedRootDir = await tempRootDir();
  try {
    const eventsObserved: string[] = [];
    let mkdirObservedAfter = -1;
    const hooks: CreateManagedTempDirectoryHooks = {
      beforeMkdir: async () => {
        const events = await readFoundation0Events(missionDir);
        mkdirObservedAfter = events.length;
      },
      afterEventAppend: async (event: Event) => {
        eventsObserved.push(event.event_type);
      },
    };

    const args = await defaultBuildArgs({
      missionDir,
      approvedRootDir,
      hooks,
    });

    try {
      await createManagedTempDirectory({
        missionDir,
        repositoryRoot: args.repositoryRoot,
        currentWorkingDirectory: args.currentWorkingDirectory,
        approvedTempRoots: [
          { root_id: "tmp_root_default", path: approvedRootDir },
        ],
        actionRequest: args.actionRequest,
        actionAttempt: args.actionAttempt,
        allowedDecision: args.allowedDecision,
        plan: args.plan,
        cleanupPolicy: args.cleanupPolicy,
        creationPayload: args.creationPayload,
        hooks: args.hooks,
        nowIso: args.nowIso,
      });
    } catch (error) {
      // Tasks 4 and 5 are not yet wired; Task 3 only proves pre-effect
      // ordering and lets the placeholder throw.
      if (!(error instanceof TempDirectoryCreationError) || error.code !== "t7_incomplete") {
        throw error;
      }
    }

    assert.deepEqual(eventsObserved.slice(0, 4), [
      "action_requested",
      "action_attempt_started",
      "policy_decision_recorded",
      "resource_planned",
    ]);
    assert.equal(mkdirObservedAfter, 4, "all four events must precede mkdir");
  } finally {
    await rm(missionDir, { recursive: true, force: true });
    await rm(approvedRootDir, { recursive: true, force: true });
  }
});

test("createManagedTempDirectory rejects non-create_managed_resource capability", async () => {
  const missionDir = await tempMissionDir();
  try {
    const args = await defaultBuildArgs({ missionDir });
    const badAction = {
      ...args.actionRequest,
      capability: "register_resource",
      payload_kind: "register_resource",
    } as unknown as CreateManagedResourceAction;
    await assert.rejects(
      () =>
        createManagedTempDirectory({
          missionDir,
          repositoryRoot: args.repositoryRoot,
          currentWorkingDirectory: args.currentWorkingDirectory,
          approvedTempRoots: [
            { root_id: "tmp_root_default", path: args.approvedRootDir },
          ],
          actionRequest: badAction,
          actionAttempt: args.actionAttempt,
          allowedDecision: args.allowedDecision,
          plan: args.plan,
          cleanupPolicy: args.cleanupPolicy,
          creationPayload: args.creationPayload,
          hooks: args.hooks,
          nowIso: args.nowIso,
        }),
      Foundation0ValidationError,
    );
    assert.deepEqual(await readFoundation0Events(missionDir), []);
  } finally {
    await rm(missionDir, { recursive: true, force: true });
  }
});

test("createManagedTempDirectory rejects a non-execution allowed decision", async () => {
  const missionDir = await tempMissionDir();
  try {
    const args = await defaultBuildArgs({ missionDir });
    const badDecision = {
      ...args.allowedDecision,
      evaluation_point: "acceptance",
    } as unknown as PolicyDecision;
    await assert.rejects(
      () =>
        createManagedTempDirectory({
          missionDir,
          repositoryRoot: args.repositoryRoot,
          currentWorkingDirectory: args.currentWorkingDirectory,
          approvedTempRoots: [
            { root_id: "tmp_root_default", path: args.approvedRootDir },
          ],
          actionRequest: args.actionRequest,
          actionAttempt: args.actionAttempt,
          allowedDecision: badDecision,
          plan: args.plan,
          cleanupPolicy: args.cleanupPolicy,
          creationPayload: args.creationPayload,
          hooks: args.hooks,
          nowIso: args.nowIso,
        }),
      Foundation0ValidationError,
    );
    assert.deepEqual(await readFoundation0Events(missionDir), []);
  } finally {
    await rm(missionDir, { recursive: true, force: true });
  }
});

test("createManagedTempDirectory rejects a denied execution decision for the create path", async () => {
  const missionDir = await tempMissionDir();
  try {
    const args = await defaultBuildArgs({ missionDir });
    const badDecision = {
      ...args.allowedDecision,
      result: "denied",
    } as unknown as PolicyDecision;
    await assert.rejects(
      () =>
        createManagedTempDirectory({
          missionDir,
          repositoryRoot: args.repositoryRoot,
          currentWorkingDirectory: args.currentWorkingDirectory,
          approvedTempRoots: [
            { root_id: "tmp_root_default", path: args.approvedRootDir },
          ],
          actionRequest: args.actionRequest,
          actionAttempt: args.actionAttempt,
          allowedDecision: badDecision,
          plan: args.plan,
          cleanupPolicy: args.cleanupPolicy,
          creationPayload: args.creationPayload,
          hooks: args.hooks,
          nowIso: args.nowIso,
        }),
      Foundation0ValidationError,
    );
    assert.deepEqual(await readFoundation0Events(missionDir), []);
  } finally {
    await rm(missionDir, { recursive: true, force: true });
  }
});

test("createManagedTempDirectory rejects a target resource_id that does not match plan resource_id", async () => {
  const missionDir = await tempMissionDir();
  try {
    const args = await defaultBuildArgs({ missionDir });
    const badPlan = {
      ...args.plan,
      resource_id: "res_other_001",
    } as ResourceCreationPlan;
    // plan effect_fingerprint must still validate; recompute via helper.
    const recomputed = computeResourceCreationPlanFingerprint(badPlan);
    badPlan.effect_fingerprint = recomputed;
    await assert.rejects(
      () =>
        createManagedTempDirectory({
          missionDir,
          repositoryRoot: args.repositoryRoot,
          currentWorkingDirectory: args.currentWorkingDirectory,
          approvedTempRoots: [
            { root_id: "tmp_root_default", path: args.approvedRootDir },
          ],
          actionRequest: args.actionRequest,
          actionAttempt: args.actionAttempt,
          allowedDecision: args.allowedDecision,
          plan: badPlan,
          cleanupPolicy: args.cleanupPolicy,
          creationPayload: args.creationPayload,
          hooks: args.hooks,
          nowIso: args.nowIso,
        }),
      Foundation0ValidationError,
    );
    assert.deepEqual(await readFoundation0Events(missionDir), []);
  } finally {
    await rm(missionDir, { recursive: true, force: true });
  }
});

test("createManagedTempDirectory rejects plan creation_kind that is not create_temp_directory", async () => {
  const missionDir = await tempMissionDir();
  try {
    const args = await defaultBuildArgs({ missionDir });
    // Build a plan with a wrong creation_kind but valid resource_type.
    const basePlan = createResourceCreationPlan({
      planId: PLAN_ID,
      missionId: MISSION_ID,
      resourceId: RESOURCE_ID,
      resourceType: "temp_directory",
      plannedResource: plannedResource(),
      cleanupPolicy: tempDirectoryCleanupPolicy(),
      creationKind: "create_temp_directory",
      creationPayload: { dummy: "value" },
      authorizationId: AUTHORIZATION_ID,
      requestedByActionId: ACTION_ID,
      createdAt: VALID_TS,
    });
    const badPlan = {
      ...basePlan,
      creation_kind: "spawn_process",
    } as ResourceCreationPlan;
    badPlan.effect_fingerprint = computeResourceCreationPlanFingerprint(badPlan);
    await assert.rejects(
      () =>
        createManagedTempDirectory({
          missionDir,
          repositoryRoot: args.repositoryRoot,
          currentWorkingDirectory: args.currentWorkingDirectory,
          approvedTempRoots: [
            { root_id: "tmp_root_default", path: args.approvedRootDir },
          ],
          actionRequest: args.actionRequest,
          actionAttempt: args.actionAttempt,
          allowedDecision: args.allowedDecision,
          plan: badPlan,
          cleanupPolicy: args.cleanupPolicy,
          creationPayload: args.creationPayload,
          hooks: args.hooks,
          nowIso: args.nowIso,
        }),
      Foundation0ValidationError,
    );
    assert.deepEqual(await readFoundation0Events(missionDir), []);
  } finally {
    await rm(missionDir, { recursive: true, force: true });
  }
});

test("createManagedTempDirectory rejects a plan whose effect_fingerprint does not verify", async () => {
  const missionDir = await tempMissionDir();
  try {
    const args = await defaultBuildArgs({ missionDir });
    const badPlan = {
      ...args.plan,
      effect_fingerprint: `sha256:${"f".repeat(64)}`,
    } as ResourceCreationPlan;
    await assert.rejects(
      () =>
        createManagedTempDirectory({
          missionDir,
          repositoryRoot: args.repositoryRoot,
          currentWorkingDirectory: args.currentWorkingDirectory,
          approvedTempRoots: [
            { root_id: "tmp_root_default", path: args.approvedRootDir },
          ],
          actionRequest: args.actionRequest,
          actionAttempt: args.actionAttempt,
          allowedDecision: args.allowedDecision,
          plan: badPlan,
          cleanupPolicy: args.cleanupPolicy,
          creationPayload: args.creationPayload,
          hooks: args.hooks,
          nowIso: args.nowIso,
        }),
      Foundation0ValidationError,
    );
    assert.deepEqual(await readFoundation0Events(missionDir), []);
  } finally {
    await rm(missionDir, { recursive: true, force: true });
  }
});

// ============================================================ Task 4 — create directory, marker, identity

test("createManagedTempDirectory creates the directory, marker, and identity on the happy path", async () => {
  const missionDir = await tempMissionDir();
  const approvedRootDir = await tempRootDir();
  try {
    const args = await defaultBuildArgs({ missionDir, approvedRootDir });
    const result = await createManagedTempDirectory({
      missionDir,
      repositoryRoot: args.repositoryRoot,
      currentWorkingDirectory: args.currentWorkingDirectory,
      approvedTempRoots: [
        { root_id: "tmp_root_default", path: approvedRootDir },
      ],
      actionRequest: args.actionRequest,
      actionAttempt: args.actionAttempt,
      allowedDecision: args.allowedDecision,
      plan: args.plan,
      cleanupPolicy: args.cleanupPolicy,
      creationPayload: args.creationPayload,
      hooks: args.hooks,
      nowIso: args.nowIso,
    });

    assert.equal(result.result, "created");
    if (result.result !== "created") return;

    const target = join(approvedRootDir, args.creationPayload.directory_basename);
    const targetStats = await stat(target);
    assert.equal(targetStats.isDirectory(), true);
    assert.equal(targetStats.isSymbolicLink(), false);

    const markerPath = join(target, ".pi-topology-resource.json");
    const markerRaw = await readFile(markerPath, "utf8");
    const markerJson = JSON.parse(markerRaw);
    assert.equal(markerJson.mission_id, MISSION_ID);
    assert.equal(markerJson.resource_id, RESOURCE_ID);
    assert.equal(markerJson.created_by_action_id, ACTION_ID);
    assert.equal(markerJson.identity_digest, result.identity.identity_digest);

    const expectedIdentityDigest = computeSha256Digest(result.identity.identity_core);
    assert.equal(result.identity.identity_digest, expectedIdentityDigest);
    const expectedMarkerDigest = computeSha256Digest(result.marker);
    assert.equal(result.identity.marker_digest, expectedMarkerDigest);
    assert.equal(result.identity.identity_core.creation_nonce, CREATION_NONCE);

    const validated = validateTempDirectoryIdentity(result.identity, { marker: result.marker });
    assert.equal(validated.identity_digest, result.identity.identity_digest);

    // No managed temp directory outside the approved root.
    assert.equal(result.resource.lifecycle_state, "active");
    assert.equal(result.resource.resource_id, RESOURCE_ID);
    assert.equal(result.resource.identity_digest, result.identity.identity_digest);
    assert.equal(result.resource.mission_id, MISSION_ID);

    const eventTypes = result.events.map((event) => event.event_type);
    assert.deepEqual(eventTypes, [
      "action_requested",
      "action_attempt_started",
      "policy_decision_recorded",
      "resource_planned",
      "resource_identity_observed",
      "resource_registered",
      "resource_activated",
      "initial_outcome_recorded",
    ]);
    const outcome = result.events[7];
    assert.equal(outcome?.event_type, "initial_outcome_recorded");
    const { readFoundation0EventPayload } = await import("../../../src/runtime/foundation0/event-append.ts");
    const outcomePayload = (await readFoundation0EventPayload(missionDir, outcome!)) as Record<string, unknown>;
    assert.equal(outcomePayload.action_payload_kind, "create_managed_resource");
    assert.equal(outcomePayload.status, "succeeded");
    assert.equal(outcomePayload.result_code, "created");
  } finally {
    await rm(missionDir, { recursive: true, force: true });
    await rm(approvedRootDir, { recursive: true, force: true });
  }
});

test("createManagedTempDirectory returns idempotent_replay for the same idempotency key without a second mkdir", async () => {
  const missionDir = await tempMissionDir();
  const approvedRootDir = await tempRootDir();
  try {
    const args = await defaultBuildArgs({ missionDir, approvedRootDir });
    const request = {
      missionDir,
      repositoryRoot: args.repositoryRoot,
      currentWorkingDirectory: args.currentWorkingDirectory,
      approvedTempRoots: [
        { root_id: "tmp_root_default", path: approvedRootDir },
      ],
      actionRequest: args.actionRequest,
      actionAttempt: args.actionAttempt,
      allowedDecision: args.allowedDecision,
      plan: args.plan,
      cleanupPolicy: args.cleanupPolicy,
      creationPayload: args.creationPayload,
      hooks: args.hooks,
      nowIso: args.nowIso,
    };
    const first = await createManagedTempDirectory(request);
    assert.equal(first.result, "created");
    if (first.result !== "created") return;

    const mkdirCount = (() => {
      let count = 0;
      const original = mkdir;
      return { get: () => count, reset: () => { count = 0; } };
    })();
    // Count lstat calls before second call to detect new mkdir.
    const target = join(approvedRootDir, args.creationPayload.directory_basename);
    const targetLstats = await lstat(target);
    const inodeBefore = targetLstats.ino;

    const second = await createManagedTempDirectory(request);
    assert.equal(second.result, "idempotent_replay");
    if (second.result !== "idempotent_replay") return;
    assert.equal(second.resource.resource_id, first.resource.resource_id);
    assert.equal(second.identity.identity_digest, first.identity.identity_digest);
    // No new mkdir: target inode is the same as before.
    const targetLstatsAfter = await lstat(target);
    assert.equal(targetLstatsAfter.ino, inodeBefore);
  } finally {
    await rm(missionDir, { recursive: true, force: true });
    await rm(approvedRootDir, { recursive: true, force: true });
  }
});

// ============================================================ Task 6 — crash-boundary reconciliation

async function readEventPayload<T>(missionDir: string, event: Event): Promise<T> {
  return (await (await import("../../../src/runtime/foundation0/event-append.ts")).readFoundation0EventPayload(missionDir, event)) as T;
}

test("crash after mkdir before marker returns reconciliation_required / directory_exists_without_marker", async () => {
  const missionDir = await tempMissionDir();
  const approvedRootDir = await tempRootDir();
  try {
    // Build a real directory under the approved root with NO marker.
    const args = await defaultBuildArgs({ missionDir, approvedRootDir });
    const target = join(approvedRootDir, args.creationPayload.directory_basename);
    await mkdir(target);
    // Pre-append the 4 pre-effect events serially to avoid lock contention
    // on the mission-events lock file during the simulated crash state.
    const { appendFoundation0Event } = await import("../../../src/runtime/foundation0/event-append.ts");
    await appendFoundation0Event({
      missionDir,
      missionId: MISSION_ID,
      eventType: "action_requested",
      entityType: "action",
      entityId: ACTION_ID,
      payload: args.actionRequest,
      actionId: ACTION_ID,
      idempotencyKey: `t7_crash_after_mkdir-action_requested`,
    });
    await appendFoundation0Event({
      missionDir,
      missionId: MISSION_ID,
      eventType: "action_attempt_started",
      entityType: "action",
      entityId: ACTION_ATTEMPT_ID,
      payload: args.actionAttempt,
      actionId: ACTION_ID,
      actionAttemptId: ACTION_ATTEMPT_ID,
      idempotencyKey: `t7_crash_after_mkdir-attempt_started`,
    });
    await appendFoundation0Event({
      missionDir,
      missionId: MISSION_ID,
      eventType: "policy_decision_recorded",
      entityType: "action",
      entityId: POLICY_DECISION_ID,
      payload: args.allowedDecision,
      actionId: ACTION_ID,
      actionAttemptId: ACTION_ATTEMPT_ID,
      policyDecisionId: POLICY_DECISION_ID,
      idempotencyKey: `t7_crash_after_mkdir-execution_policy`,
    });
    await appendFoundation0Event({
      missionDir,
      missionId: MISSION_ID,
      eventType: "resource_planned",
      entityType: "resource",
      entityId: RESOURCE_ID,
      payload: args.plan,
      actionId: ACTION_ID,
      idempotencyKey: `t7_crash_after_mkdir-resource_planned`,
    });

    const result = await createManagedTempDirectory({
      missionDir,
      repositoryRoot: args.repositoryRoot,
      currentWorkingDirectory: args.currentWorkingDirectory,
      approvedTempRoots: [
        { root_id: "tmp_root_default", path: approvedRootDir },
      ],
      actionRequest: args.actionRequest,
      actionAttempt: args.actionAttempt,
      allowedDecision: args.allowedDecision,
      plan: args.plan,
      cleanupPolicy: args.cleanupPolicy,
      creationPayload: args.creationPayload,
      hooks: args.hooks,
      nowIso: args.nowIso,
    });

    assert.equal(result.result, "reconciliation_required");
    if (result.result !== "reconciliation_required") return;
    assert.equal(result.reason, "directory_exists_without_marker");
    assert.equal(result.resource_id, RESOURCE_ID);
    // The unmanaged directory must NOT be removed or replaced.
    const targetStats = await stat(target);
    assert.equal(targetStats.isDirectory(), true);
  } finally {
    await rm(missionDir, { recursive: true, force: true });
    await rm(approvedRootDir, { recursive: true, force: true });
  }
});

test("crash after marker before resource_identity_observed validates marker and completes lifecycle", async () => {
  const missionDir = await tempMissionDir();
  const approvedRootDir = await tempRootDir();
  try {
    const args = await defaultBuildArgs({ missionDir, approvedRootDir });
    const crash = new Error("crash-after-marker");
    await assert.rejects(
      () =>
        createManagedTempDirectory({
          missionDir,
          repositoryRoot: args.repositoryRoot,
          currentWorkingDirectory: args.currentWorkingDirectory,
          approvedTempRoots: [
            { root_id: "tmp_root_default", path: approvedRootDir },
          ],
          actionRequest: args.actionRequest,
          actionAttempt: args.actionAttempt,
          allowedDecision: args.allowedDecision,
          plan: args.plan,
          cleanupPolicy: args.cleanupPolicy,
          creationPayload: args.creationPayload,
          hooks: {
            afterMarkerWrite: async () => {
              throw crash;
            },
          },
          nowIso: args.nowIso,
        }),
      crash,
    );

    const firstEvents = await readFoundation0Events(missionDir);
    assert.deepEqual(firstEvents.map((event) => event.event_type), [
      "action_requested",
      "action_attempt_started",
      "policy_decision_recorded",
      "resource_planned",
    ]);
    const target = join(approvedRootDir, args.creationPayload.directory_basename);
    const targetBefore = await lstat(target);
    const markerRaw = await readFile(join(target, ".pi-topology-resource.json"), "utf8");
    assert.equal(JSON.parse(markerRaw).resource_id, RESOURCE_ID);

    const second = await createManagedTempDirectory({
      missionDir,
      repositoryRoot: args.repositoryRoot,
      currentWorkingDirectory: args.currentWorkingDirectory,
      approvedTempRoots: [
        { root_id: "tmp_root_default", path: approvedRootDir },
      ],
      actionRequest: args.actionRequest,
      actionAttempt: args.actionAttempt,
      allowedDecision: args.allowedDecision,
      plan: args.plan,
      cleanupPolicy: args.cleanupPolicy,
      creationPayload: args.creationPayload,
      hooks: args.hooks,
      nowIso: args.nowIso,
    });
    assert.equal(second.result, "created");
    if (second.result !== "created") return;
    const targetAfter = await lstat(target);
    assert.equal(targetAfter.ino, targetBefore.ino, "retry must not replace the marked directory");
    assert.deepEqual(second.events.slice(4).map((event) => event.event_type), [
      "resource_identity_observed",
      "resource_registered",
      "resource_activated",
      "initial_outcome_recorded",
    ]);
    const allEvents = await readFoundation0Events(missionDir);
    assert.equal(
      allEvents.filter((event) => event.event_type === "resource_identity_observed").length,
      1,
    );
  } finally {
    await rm(missionDir, { recursive: true, force: true });
    await rm(approvedRootDir, { recursive: true, force: true });
  }
});

test("crash after resource_identity_observed completes remaining lifecycle on retry", async () => {
  const missionDir = await tempMissionDir();
  const approvedRootDir = await tempRootDir();
  try {
    const args = await defaultBuildArgs({ missionDir, approvedRootDir });
    const crash = new Error("crash-after-identity-observed");
    await assert.rejects(
      () =>
        createManagedTempDirectory({
          missionDir,
          repositoryRoot: args.repositoryRoot,
          currentWorkingDirectory: args.currentWorkingDirectory,
          approvedTempRoots: [
            { root_id: "tmp_root_default", path: approvedRootDir },
          ],
          actionRequest: args.actionRequest,
          actionAttempt: args.actionAttempt,
          allowedDecision: args.allowedDecision,
          plan: args.plan,
          cleanupPolicy: args.cleanupPolicy,
          creationPayload: args.creationPayload,
          hooks: {
            afterEventAppend: async (event: Event) => {
              if (event.event_type === "resource_identity_observed") {
                throw crash;
              }
            },
          },
          nowIso: args.nowIso,
        }),
      crash,
    );

    const firstEvents = await readFoundation0Events(missionDir);
    assert.equal(
      firstEvents.filter((event) => event.event_type === "resource_identity_observed").length,
      1,
    );
    assert.equal(
      firstEvents.filter((event) => event.event_type === "resource_registered").length,
      0,
    );
    const target = join(approvedRootDir, args.creationPayload.directory_basename);
    const targetBefore = await lstat(target);

    const second = await createManagedTempDirectory({
      missionDir,
      repositoryRoot: args.repositoryRoot,
      currentWorkingDirectory: args.currentWorkingDirectory,
      approvedTempRoots: [
        { root_id: "tmp_root_default", path: approvedRootDir },
      ],
      actionRequest: args.actionRequest,
      actionAttempt: args.actionAttempt,
      allowedDecision: args.allowedDecision,
      plan: args.plan,
      cleanupPolicy: args.cleanupPolicy,
      creationPayload: args.creationPayload,
      hooks: args.hooks,
      nowIso: args.nowIso,
    });
    assert.equal(second.result, "created");
    if (second.result !== "created") return;
    const targetAfter = await lstat(target);
    assert.equal(targetAfter.ino, targetBefore.ino, "retry must not replace the observed directory");
    const allEvents = await readFoundation0Events(missionDir);
    assert.equal(
      allEvents.filter((event) => event.event_type === "resource_identity_observed").length,
      1,
    );
    assert.equal(
      allEvents.filter((event) => event.event_type === "resource_registered").length,
      1,
    );
    assert.equal(
      allEvents.filter((event) => event.event_type === "resource_activated").length,
      1,
    );
    assert.equal(
      allEvents.filter((event) => event.event_type === "initial_outcome_recorded").length,
      1,
    );
  } finally {
    await rm(missionDir, { recursive: true, force: true });
    await rm(approvedRootDir, { recursive: true, force: true });
  }
});

test("marker bytes mismatch returns reconciliation_required / marker_mismatch", async () => {
  const missionDir = await tempMissionDir();
  const approvedRootDir = await tempRootDir();
  try {
    const args = await defaultBuildArgs({ missionDir, approvedRootDir });
    // First create, then tamper the marker bytes.
    const first = await createManagedTempDirectory({
      missionDir,
      repositoryRoot: args.repositoryRoot,
      currentWorkingDirectory: args.currentWorkingDirectory,
      approvedTempRoots: [
        { root_id: "tmp_root_default", path: approvedRootDir },
      ],
      actionRequest: args.actionRequest,
      actionAttempt: args.actionAttempt,
      allowedDecision: args.allowedDecision,
      plan: args.plan,
      cleanupPolicy: args.cleanupPolicy,
      creationPayload: args.creationPayload,
      hooks: args.hooks,
      nowIso: args.nowIso,
    });
    assert.equal(first.result, "created");
    if (first.result !== "created") return;

    const target = join(approvedRootDir, args.creationPayload.directory_basename);
    const markerPath = join(target, ".pi-topology-resource.json");
    await writeFile(markerPath, '{"tampered":true}\n', "utf8");

    const second = await createManagedTempDirectory({
      missionDir,
      repositoryRoot: args.repositoryRoot,
      currentWorkingDirectory: args.currentWorkingDirectory,
      approvedTempRoots: [
        { root_id: "tmp_root_default", path: approvedRootDir },
      ],
      actionRequest: args.actionRequest,
      actionAttempt: args.actionAttempt,
      allowedDecision: args.allowedDecision,
      plan: args.plan,
      cleanupPolicy: args.cleanupPolicy,
      creationPayload: args.creationPayload,
      hooks: args.hooks,
      nowIso: args.nowIso,
    });
    assert.equal(second.result, "reconciliation_required");
    if (second.result !== "reconciliation_required") return;
    assert.equal(second.reason, "marker_mismatch");
    // Marker file must remain (no delete).
    const markerRaw = await readFile(markerPath, "utf8");
    assert.equal(markerRaw, '{"tampered":true}\n');
  } finally {
    await rm(missionDir, { recursive: true, force: true });
    await rm(approvedRootDir, { recursive: true, force: true });
  }
});

test("partial event log returns reconciliation_required without creating another directory", async () => {
  const missionDir = await tempMissionDir();
  const approvedRootDir = await tempRootDir();
  try {
    const args = await defaultBuildArgs({ missionDir, approvedRootDir });
    const first = await createManagedTempDirectory({
      missionDir,
      repositoryRoot: args.repositoryRoot,
      currentWorkingDirectory: args.currentWorkingDirectory,
      approvedTempRoots: [
        { root_id: "tmp_root_default", path: approvedRootDir },
      ],
      actionRequest: args.actionRequest,
      actionAttempt: args.actionAttempt,
      allowedDecision: args.allowedDecision,
      plan: args.plan,
      cleanupPolicy: args.cleanupPolicy,
      creationPayload: args.creationPayload,
      hooks: args.hooks,
      nowIso: args.nowIso,
    });
    assert.equal(first.result, "created");
    const target = join(approvedRootDir, args.creationPayload.directory_basename);
    const targetBefore = await lstat(target);
    const paths = foundation0StoragePaths(missionDir);
    await writeFile(paths.eventLogPath, "{\"schema_version\":1", { flag: "a" });

    const second = await createManagedTempDirectory({
      missionDir,
      repositoryRoot: args.repositoryRoot,
      currentWorkingDirectory: args.currentWorkingDirectory,
      approvedTempRoots: [
        { root_id: "tmp_root_default", path: approvedRootDir },
      ],
      actionRequest: args.actionRequest,
      actionAttempt: args.actionAttempt,
      allowedDecision: args.allowedDecision,
      plan: args.plan,
      cleanupPolicy: args.cleanupPolicy,
      creationPayload: args.creationPayload,
      hooks: args.hooks,
      nowIso: args.nowIso,
    });

    assert.equal(second.result, "reconciliation_required");
    if (second.result !== "reconciliation_required") return;
    assert.equal(second.reason, "partial_event_log");
    const targetAfter = await lstat(target);
    assert.equal(targetAfter.ino, targetBefore.ino, "partial log retry must not replace directory");
  } finally {
    await rm(missionDir, { recursive: true, force: true });
    await rm(approvedRootDir, { recursive: true, force: true });
  }
});

test("missing activated payload returns reconciliation_required without creating another directory", async () => {
  const missionDir = await tempMissionDir();
  const approvedRootDir = await tempRootDir();
  try {
    const args = await defaultBuildArgs({ missionDir, approvedRootDir });
    const first = await createManagedTempDirectory({
      missionDir,
      repositoryRoot: args.repositoryRoot,
      currentWorkingDirectory: args.currentWorkingDirectory,
      approvedTempRoots: [
        { root_id: "tmp_root_default", path: approvedRootDir },
      ],
      actionRequest: args.actionRequest,
      actionAttempt: args.actionAttempt,
      allowedDecision: args.allowedDecision,
      plan: args.plan,
      cleanupPolicy: args.cleanupPolicy,
      creationPayload: args.creationPayload,
      hooks: args.hooks,
      nowIso: args.nowIso,
    });
    assert.equal(first.result, "created");
    if (first.result !== "created") return;
    const target = join(approvedRootDir, args.creationPayload.directory_basename);
    const targetBefore = await lstat(target);
    const activated = first.events.find((event) => event.event_type === "resource_activated");
    assert.ok(activated);
    await unlink(join(foundation0StoragePaths(missionDir).payloadsDir, `${activated.payload_digest}.json`));

    const second = await createManagedTempDirectory({
      missionDir,
      repositoryRoot: args.repositoryRoot,
      currentWorkingDirectory: args.currentWorkingDirectory,
      approvedTempRoots: [
        { root_id: "tmp_root_default", path: approvedRootDir },
      ],
      actionRequest: args.actionRequest,
      actionAttempt: args.actionAttempt,
      allowedDecision: args.allowedDecision,
      plan: args.plan,
      cleanupPolicy: args.cleanupPolicy,
      creationPayload: args.creationPayload,
      hooks: args.hooks,
      nowIso: args.nowIso,
    });

    assert.equal(second.result, "reconciliation_required");
    if (second.result !== "reconciliation_required") return;
    assert.equal(second.reason, "missing_payload");
    const targetAfter = await lstat(target);
    assert.equal(targetAfter.ino, targetBefore.ino, "missing payload retry must not replace directory");
  } finally {
    await rm(missionDir, { recursive: true, force: true });
    await rm(approvedRootDir, { recursive: true, force: true });
  }
});

test("digest-mismatched activated payload returns reconciliation_required without creating another directory", async () => {
  const missionDir = await tempMissionDir();
  const approvedRootDir = await tempRootDir();
  try {
    const args = await defaultBuildArgs({ missionDir, approvedRootDir });
    const first = await createManagedTempDirectory({
      missionDir,
      repositoryRoot: args.repositoryRoot,
      currentWorkingDirectory: args.currentWorkingDirectory,
      approvedTempRoots: [
        { root_id: "tmp_root_default", path: approvedRootDir },
      ],
      actionRequest: args.actionRequest,
      actionAttempt: args.actionAttempt,
      allowedDecision: args.allowedDecision,
      plan: args.plan,
      cleanupPolicy: args.cleanupPolicy,
      creationPayload: args.creationPayload,
      hooks: args.hooks,
      nowIso: args.nowIso,
    });
    assert.equal(first.result, "created");
    if (first.result !== "created") return;
    const target = join(approvedRootDir, args.creationPayload.directory_basename);
    const targetBefore = await lstat(target);
    const activated = first.events.find((event) => event.event_type === "resource_activated");
    assert.ok(activated);
    await writeFile(
      join(foundation0StoragePaths(missionDir).payloadsDir, `${activated.payload_digest}.json`),
      "{\"tampered\":true}\n",
      "utf8",
    );

    const second = await createManagedTempDirectory({
      missionDir,
      repositoryRoot: args.repositoryRoot,
      currentWorkingDirectory: args.currentWorkingDirectory,
      approvedTempRoots: [
        { root_id: "tmp_root_default", path: approvedRootDir },
      ],
      actionRequest: args.actionRequest,
      actionAttempt: args.actionAttempt,
      allowedDecision: args.allowedDecision,
      plan: args.plan,
      cleanupPolicy: args.cleanupPolicy,
      creationPayload: args.creationPayload,
      hooks: args.hooks,
      nowIso: args.nowIso,
    });

    assert.equal(second.result, "reconciliation_required");
    if (second.result !== "reconciliation_required") return;
    assert.equal(second.reason, "payload_digest_mismatch");
    const targetAfter = await lstat(target);
    assert.equal(targetAfter.ino, targetBefore.ino, "digest mismatch retry must not replace directory");
  } finally {
    await rm(missionDir, { recursive: true, force: true });
    await rm(approvedRootDir, { recursive: true, force: true });
  }
});
