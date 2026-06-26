import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  computeResourceCreationPlanFingerprint,
  createResourceCreationPlan,
  writeResourceCreationPlanEvent,
} from "../../../src/runtime/foundation0/resource-creation-plan.ts";
import {
  foundation0StoragePaths,
  verifyFoundation0EventPayloads,
  PayloadDigestMismatchError,
} from "../../../src/runtime/foundation0/event-append.ts";
import {
  validateResourceCreationPlan,
} from "../../../src/runtime/foundation0/validation.ts";
import type {
  PlannedResource,
  ProcessCleanupPolicy,
  TempDirectoryCleanupPolicy,
} from "../../../src/runtime/foundation0/schema.ts";

const VALID_TS = "2026-06-26T12:00:00.000Z";
const MISSION_ID = "mission_foundation0_t5";
const AUTHORIZATION_ID = "auth_owner_001";

async function tempMissionDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "foundation0-plan-"));
}

function plannedResource(overrides: Partial<PlannedResource> = {}): PlannedResource {
  return {
    schema_version: 1,
    resource_id: "res_process_001",
    mission_id: MISSION_ID,
    resource_type: "process",
    ownership_origin: "created",
    owned_by_actor_id: "actor_runner_001",
    cleanup_owner_actor_id: "actor_runner_001",
    registered_by_action_id: "action_create_resource_001",
    authorization_id: AUTHORIZATION_ID,
    lifecycle_state: "planned",
    verification_state: "unverified",
    identity: null,
    identity_digest: null,
    cleanup_policy: null,
    created_at: VALID_TS,
    updated_at: VALID_TS,
    ...overrides,
  };
}

function processCleanupPolicy(): ProcessCleanupPolicy {
  return {
    termination_scope: "pid",
    term_signal: "SIGTERM",
    grace_period_ms: 5000,
    allow_force_kill: false,
    force_signal: "SIGKILL",
  };
}

function tempDirectoryCleanupPolicy(): TempDirectoryCleanupPolicy {
  return {
    rename_strategy: "atomic_rename_under_root",
    delete_strategy: "recursive_no_follow",
  };
}

test("valid process creation plan passes validation and recomputes fingerprint", () => {
  const plan = createResourceCreationPlan({
    planId: "plan_process_001",
    missionId: MISSION_ID,
    resourceId: "res_process_001",
    resourceType: "process",
    plannedResource: plannedResource(),
    cleanupPolicy: processCleanupPolicy(),
    creationKind: "spawn_process",
    creationPayload: { executable: "/bin/echo", argv: ["echo", "hello"], cwd: "/tmp" },
    authorizationId: AUTHORIZATION_ID,
    requestedByActionId: "action_create_resource_001",
    effectFingerprintHint: `sha256:${"0".repeat(64)}`,
    createdAt: VALID_TS,
  });

  assert.equal(validateResourceCreationPlan(plan).plan_id, "plan_process_001");
  assert.equal(plan.planned_resource.cleanup_policy, null);
  assert.equal(
    plan.effect_fingerprint,
    computeResourceCreationPlanFingerprint(plan),
  );
  assert.notEqual(plan.effect_fingerprint, `sha256:${"0".repeat(64)}`);
});

test("valid temp-directory creation plan passes validation", () => {
  const plan = createResourceCreationPlan({
    planId: "plan_temp_directory_001",
    missionId: MISSION_ID,
    resourceId: "res_temp_directory_001",
    resourceType: "temp_directory",
    plannedResource: plannedResource({
      resource_id: "res_temp_directory_001",
      resource_type: "temp_directory",
    }),
    cleanupPolicy: tempDirectoryCleanupPolicy(),
    creationKind: "create_temp_directory",
    creationPayload: { approved_temp_root_id: "tmp_root_001", prefix: "pi-topology-" },
    authorizationId: AUTHORIZATION_ID,
    requestedByActionId: "action_create_resource_001",
    createdAt: VALID_TS,
  });

  assert.equal(validateResourceCreationPlan(plan).resource_type, "temp_directory");
});

test("ResourceCreationPlan rejects cleanup policy and creation kind mismatches", () => {
  assert.throws(
    () =>
      createResourceCreationPlan({
        planId: "plan_bad_policy",
        missionId: MISSION_ID,
        resourceId: "res_process_001",
        resourceType: "process",
        plannedResource: plannedResource(),
        cleanupPolicy: tempDirectoryCleanupPolicy(),
        creationKind: "spawn_process",
        creationPayload: {},
        authorizationId: AUTHORIZATION_ID,
        requestedByActionId: "action_create_resource_001",
        createdAt: VALID_TS,
      }),
    { name: "Foundation0ValidationError" },
  );
  assert.throws(
    () =>
      createResourceCreationPlan({
        planId: "plan_bad_kind",
        missionId: MISSION_ID,
        resourceId: "res_process_001",
        resourceType: "process",
        plannedResource: plannedResource(),
        cleanupPolicy: processCleanupPolicy(),
        creationKind: "create_temp_directory",
        creationPayload: {},
        authorizationId: AUTHORIZATION_ID,
        requestedByActionId: "action_create_resource_001",
        createdAt: VALID_TS,
      }),
    { name: "Foundation0ValidationError" },
  );
});

test("ResourceCreationPlan rejects planned resource identity and parent field mismatches", () => {
  assert.throws(
    () =>
      createResourceCreationPlan({
        planId: "plan_bad_parent",
        missionId: MISSION_ID,
        resourceId: "res_process_001",
        resourceType: "process",
        plannedResource: plannedResource({ mission_id: "mission_other_001" }),
        cleanupPolicy: processCleanupPolicy(),
        creationKind: "spawn_process",
        creationPayload: {},
        authorizationId: AUTHORIZATION_ID,
        requestedByActionId: "action_create_resource_001",
        createdAt: VALID_TS,
      }),
    { name: "Foundation0ValidationError" },
  );
  assert.throws(
    () =>
      validateResourceCreationPlan({
        ...createResourceCreationPlan({
          planId: "plan_bad_identity",
          missionId: MISSION_ID,
          resourceId: "res_process_001",
          resourceType: "process",
          plannedResource: plannedResource(),
          cleanupPolicy: processCleanupPolicy(),
          creationKind: "spawn_process",
          creationPayload: {},
          authorizationId: AUTHORIZATION_ID,
          requestedByActionId: "action_create_resource_001",
          createdAt: VALID_TS,
        }),
        planned_resource: {
          ...plannedResource(),
          identity: { pid: 1 },
        },
      }),
    { name: "Foundation0ValidationError" },
  );
});

test("writeResourceCreationPlanEvent durably references the plan payload and digest mismatches are detectable", async () => {
  const missionDir = await tempMissionDir();
  try {
    const plan = createResourceCreationPlan({
      planId: "plan_event_001",
      missionId: MISSION_ID,
      resourceId: "res_process_001",
      resourceType: "process",
      plannedResource: plannedResource(),
      cleanupPolicy: processCleanupPolicy(),
      creationKind: "spawn_process",
      creationPayload: { executable: "/bin/echo" },
      authorizationId: AUTHORIZATION_ID,
      requestedByActionId: "action_create_resource_001",
      createdAt: VALID_TS,
    });

    const event = await writeResourceCreationPlanEvent({
      missionDir,
      plan,
      idempotencyKey: "plan_event_001",
    });
    const paths = foundation0StoragePaths(missionDir);
    assert.equal(event.event_type, "resource_planned");
    assert.equal(event.payload_ref, `foundation0/payloads/${event.payload_digest}.json`);

    const payloadPath = join(paths.payloadsDir, `${event.payload_digest}.json`);
    const persisted = JSON.parse(await readFile(payloadPath, "utf8"));
    assert.equal(persisted.plan_id, "plan_event_001");

    await writeFile(payloadPath, JSON.stringify({ ...persisted, plan_id: "plan_tampered" }), "utf8");
    await assert.rejects(
      () => verifyFoundation0EventPayloads(missionDir),
      PayloadDigestMismatchError,
    );
  } finally {
    await rm(missionDir, { recursive: true, force: true });
  }
});
