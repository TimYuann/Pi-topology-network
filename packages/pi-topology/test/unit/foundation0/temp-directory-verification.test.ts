import assert from "node:assert/strict";
import { type Stats, lstat, mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalizeForDigest, computeSha256Digest } from "../../../src/runtime/foundation0/ids.ts";
import {
  appendFoundation0Event,
  foundation0StoragePaths,
  readFoundation0Events,
  readFoundation0EventPayload,
} from "../../../src/runtime/foundation0/event-append.ts";
import {
  MARKER_FILENAME,
  createManagedTempDirectory,
} from "../../../src/runtime/foundation0/temp-directory-creation.ts";
import {
  readTempDirectoryResourceProjection,
  recordTempDirectoryReconciliationRequired,
  verifyManagedTempDirectory,
} from "../../../src/runtime/foundation0/temp-directory-verification.ts";
import {
  createResourceCreationPlan,
} from "../../../src/runtime/foundation0/resource-creation-plan.ts";
import {
  type ActionAttempt,
  type CreateManagedResourceAction,
  type ObservedTempDirectoryResource,
  type PlannedResource,
  type PolicyDecision,
  type ReconcileResourceAction,
  type ResourceCreationPlan,
  type TempDirectoryCleanupPolicy,
  type TempDirectoryIdentity,
  type TempDirectoryMarker,
} from "../../../src/runtime/foundation0/schema.ts";

const MISSION_ID = "mission_foundation0_t8";
const RESOURCE_ID = "res_temp_directory_t8_001";
const ACTOR_ID = "actor_runner_t8";
const AUTHORIZATION_ID = "auth_owner_t8";
const CREATE_ACTION_ID = "action_create_t8";
const CREATE_ATTEMPT_ID = "attempt_create_t8";
const RECONCILE_ACTION_ID = "action_reconcile_t8";
const RECONCILE_ATTEMPT_ID = "attempt_reconcile_t8";
const POLICY_DECISION_ID = "policy_decision_t8";
const VALID_TS = "2026-06-28T12:00:00.000Z";
const ROOT_ID = "tmp_root_default";
const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;
const DIGEST_C = `sha256:${"c".repeat(64)}`;

async function tempDir(label: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `foundation0-t8-${label}-`));
}

function cleanupPolicy(): TempDirectoryCleanupPolicy {
  return {
    rename_strategy: "atomic_rename_under_root",
    delete_strategy: "recursive_no_follow",
  };
}

function plannedResource(resourceId = RESOURCE_ID): PlannedResource {
  return {
    schema_version: 1,
    resource_id: resourceId,
    mission_id: MISSION_ID,
    resource_type: "temp_directory",
    ownership_origin: "created",
    owned_by_actor_id: ACTOR_ID,
    cleanup_owner_actor_id: ACTOR_ID,
    registered_by_action_id: CREATE_ACTION_ID,
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

function creationPayload(directoryBasename: string) {
  return {
    schema_version: 1,
    approved_temp_root_id: ROOT_ID,
    directory_basename: directoryBasename,
    creation_nonce: "tmp_nonce_t8",
  };
}

function planFor(resourceId: string, directoryBasename: string): ResourceCreationPlan {
  return createResourceCreationPlan({
    planId: `plan_${resourceId}`,
    missionId: MISSION_ID,
    resourceId,
    resourceType: "temp_directory",
    plannedResource: plannedResource(resourceId),
    cleanupPolicy: cleanupPolicy(),
    creationKind: "create_temp_directory",
    creationPayload: creationPayload(directoryBasename),
    authorizationId: AUTHORIZATION_ID,
    requestedByActionId: CREATE_ACTION_ID,
    createdAt: VALID_TS,
  });
}

function createAction(resourceId = RESOURCE_ID): CreateManagedResourceAction {
  return {
    schema_version: 1,
    action_id: CREATE_ACTION_ID,
    mission_id: MISSION_ID,
    actor_id: ACTOR_ID,
    authorization_id: AUTHORIZATION_ID,
    idempotency_key: "idem_create_t8",
    payload_ref: "foundation0/payloads/create_t8.json",
    payload_digest: DIGEST_A,
    effect_fingerprint: DIGEST_B,
    retry_of_action_id: null,
    requested_at: VALID_TS,
    capability: "create_managed_resource",
    payload_kind: "create_managed_resource",
    target: { entity_type: "resource", resource_id: resourceId },
  };
}

function actionAttempt(
  actionId = CREATE_ACTION_ID,
  attemptId = CREATE_ATTEMPT_ID,
): ActionAttempt {
  return {
    schema_version: 1,
    action_attempt_id: attemptId,
    action_id: actionId,
    mission_id: MISSION_ID,
    attempt_number: 1,
    started_at: VALID_TS,
  };
}

function allowedDecision(
  actionId = CREATE_ACTION_ID,
  attemptId = CREATE_ATTEMPT_ID,
  decisionId = POLICY_DECISION_ID,
): PolicyDecision {
  return {
    schema_version: 1,
    policy_decision_id: decisionId,
    action_id: actionId,
    action_attempt_id: attemptId,
    mission_id: MISSION_ID,
    evaluation_point: "execution",
    evaluation_sequence: 1,
    result: "allowed",
    reason_codes: ["foundation0_t8_allowed"],
    authorization_chain: [AUTHORIZATION_ID],
    evaluated_policy_hash: DIGEST_C,
    decided_at: VALID_TS,
  };
}

function reconcileAction(resourceId = RESOURCE_ID): ReconcileResourceAction {
  return {
    schema_version: 1,
    action_id: RECONCILE_ACTION_ID,
    mission_id: MISSION_ID,
    actor_id: ACTOR_ID,
    authorization_id: AUTHORIZATION_ID,
    idempotency_key: "idem_reconcile_t8",
    payload_ref: "foundation0/payloads/reconcile_t8.json",
    payload_digest: DIGEST_A,
    effect_fingerprint: DIGEST_B,
    retry_of_action_id: null,
    requested_at: VALID_TS,
    capability: "reconcile_resource",
    payload_kind: "reconcile_resource",
    target: { entity_type: "resource", resource_id: resourceId },
  };
}

function deriveDirectoryBasename(resourceId: string): string {
  const digest = computeSha256Digest({
    mission_id: MISSION_ID,
    resource_id: resourceId,
    nonce: "tmp_nonce_t8",
  });
  return `pi-topology-${digest.slice("sha256:".length, "sha256:".length + 16)}`;
}

async function createT7Resource(resourceId = RESOURCE_ID): Promise<{
  missionDir: string;
  approvedRootDir: string;
  repositoryRoot: string;
  currentWorkingDirectory: string;
  targetPath: string;
}> {
  const missionDir = await tempDir("mission");
  const approvedRootDir = await tempDir("root");
  const repositoryRoot = await tempDir("repo");
  const currentWorkingDirectory = await tempDir("cwd");
  const directoryBasename = deriveDirectoryBasename(resourceId);
  const result = await createManagedTempDirectory({
    missionDir,
    repositoryRoot,
    currentWorkingDirectory,
    approvedTempRoots: [{ root_id: ROOT_ID, path: approvedRootDir }],
    actionRequest: createAction(resourceId),
    actionAttempt: actionAttempt(),
    allowedDecision: allowedDecision(),
    plan: planFor(resourceId, directoryBasename),
    cleanupPolicy: cleanupPolicy(),
    creationPayload: creationPayload(directoryBasename),
    nowIso: () => VALID_TS,
  });
  assert.equal(result.result, "created");
  return {
    missionDir,
    approvedRootDir,
    repositoryRoot,
    currentWorkingDirectory,
    targetPath: join(approvedRootDir, directoryBasename),
  };
}

function buildIdentity(
  resourceId: string,
  targetPath: string,
  stats: Stats,
): { identity: TempDirectoryIdentity; marker: TempDirectoryMarker } {
  const identityCore = {
    approved_temp_root_id: ROOT_ID,
    canonical_path: targetPath,
    device_id: stats.dev,
    inode: stats.ino,
    owner_uid: stats.uid,
    creation_nonce: "tmp_nonce_t8",
  };
  const identityDigest = computeSha256Digest(identityCore);
  const marker: TempDirectoryMarker = {
    schema_version: 1,
    mission_id: MISSION_ID,
    resource_id: resourceId,
    identity_digest: identityDigest,
    created_by_action_id: CREATE_ACTION_ID,
  };
  const identity: TempDirectoryIdentity = {
    identity_core: identityCore,
    identity_digest: identityDigest,
    marker_digest: computeSha256Digest(marker),
  };
  return { identity, marker };
}

async function writeMarker(targetPath: string, marker: TempDirectoryMarker): Promise<void> {
  await writeFile(
    join(targetPath, MARKER_FILENAME),
    `${canonicalizeForDigest(marker)}\n`,
    "utf8",
  );
}

async function seedPlannedOnly(input: {
  missionDir: string;
  resourceId: string;
  directoryBasename: string;
}): Promise<void> {
  await appendFoundation0Event({
    missionDir: input.missionDir,
    missionId: MISSION_ID,
    eventType: "resource_planned",
    entityType: "resource",
    entityId: input.resourceId,
    payload: planFor(input.resourceId, input.directoryBasename),
    actionId: CREATE_ACTION_ID,
    idempotencyKey: `seed_planned_${input.resourceId}`,
    lockId: "t8_seed_event_append",
  });
}

async function seedActiveResource(input: {
  missionDir: string;
  resourceId: string;
  targetPath: string;
  identity: TempDirectoryIdentity;
  marker: TempDirectoryMarker;
}): Promise<void> {
  await seedPlannedOnly({
    missionDir: input.missionDir,
    resourceId: input.resourceId,
    directoryBasename: input.targetPath.split("/").at(-1) ?? "target",
  });
  const resourceBase = {
    schema_version: 1,
    resource_id: input.resourceId,
    mission_id: MISSION_ID,
    resource_type: "temp_directory",
    ownership_origin: "created",
    owned_by_actor_id: ACTOR_ID,
    cleanup_owner_actor_id: ACTOR_ID,
    registered_by_action_id: CREATE_ACTION_ID,
    authorization_id: AUTHORIZATION_ID,
    verification_state: "verified",
    identity: input.identity,
    identity_digest: input.identity.identity_digest,
    cleanup_policy: cleanupPolicy(),
    created_at: VALID_TS,
    updated_at: VALID_TS,
  };
  await appendFoundation0Event({
    missionDir: input.missionDir,
    missionId: MISSION_ID,
    eventType: "resource_identity_observed",
    entityType: "resource",
    entityId: input.resourceId,
    payload: {
      schema_version: 1,
      resource_id: input.resourceId,
      identity: input.identity,
      marker: input.marker,
      observed_at: VALID_TS,
    },
    actionId: CREATE_ACTION_ID,
    actionAttemptId: CREATE_ATTEMPT_ID,
    idempotencyKey: `seed_identity_${input.resourceId}`,
    lockId: "t8_seed_event_append",
  });
  await appendFoundation0Event({
    missionDir: input.missionDir,
    missionId: MISSION_ID,
    eventType: "resource_registered",
    entityType: "resource",
    entityId: input.resourceId,
    payload: {
      ...resourceBase,
      lifecycle_state: "registered",
    } satisfies ObservedTempDirectoryResource,
    actionId: CREATE_ACTION_ID,
    actionAttemptId: CREATE_ATTEMPT_ID,
    idempotencyKey: `seed_registered_${input.resourceId}`,
    lockId: "t8_seed_event_append",
  });
  await appendFoundation0Event({
    missionDir: input.missionDir,
    missionId: MISSION_ID,
    eventType: "resource_activated",
    entityType: "resource",
    entityId: input.resourceId,
    payload: {
      ...resourceBase,
      lifecycle_state: "active",
    } satisfies ObservedTempDirectoryResource,
    actionId: CREATE_ACTION_ID,
    actionAttemptId: CREATE_ATTEMPT_ID,
    idempotencyKey: `seed_active_${input.resourceId}`,
    lockId: "t8_seed_event_append",
  });
}

async function seedManualActiveTarget(resourceId: string): Promise<{
  missionDir: string;
  approvedRootDir: string;
  repositoryRoot: string;
  currentWorkingDirectory: string;
  targetPath: string;
  marker: TempDirectoryMarker;
}> {
  const missionDir = await tempDir("mission");
  const approvedRootDir = await tempDir("root");
  const repositoryRoot = await tempDir("repo");
  const currentWorkingDirectory = await tempDir("cwd");
  const targetPath = join(approvedRootDir, deriveDirectoryBasename(resourceId));
  await mkdir(targetPath);
  const canonicalTargetPath = await realpath(targetPath);
  const built = buildIdentity(resourceId, canonicalTargetPath, await lstat(targetPath));
  await writeMarker(targetPath, built.marker);
  await seedActiveResource({
    missionDir,
    resourceId,
    targetPath,
    identity: built.identity,
    marker: built.marker,
  });
  return {
    missionDir,
    approvedRootDir,
    repositoryRoot,
    currentWorkingDirectory,
    targetPath,
    marker: built.marker,
  };
}

async function verifyDefault(input: {
  missionDir: string;
  approvedRootDir: string;
  repositoryRoot: string;
  currentWorkingDirectory: string;
  resourceId?: string;
}) {
  return verifyManagedTempDirectory({
    missionDir: input.missionDir,
    repositoryRoot: input.repositoryRoot,
    currentWorkingDirectory: input.currentWorkingDirectory,
    approvedTempRoots: [{ root_id: ROOT_ID, path: input.approvedRootDir }],
    resourceId: input.resourceId ?? RESOURCE_ID,
  });
}

test("projection reconstructs a T7-created active temp resource", async () => {
  const fixture = await createT7Resource();
  const projection = await readTempDirectoryResourceProjection(
    fixture.missionDir,
    RESOURCE_ID,
  );

  assert.equal(projection.status, "projected");
  assert.equal(projection.latest_lifecycle_state, "active");
  assert.equal(projection.identity?.identity_core.canonical_path, await realpath(fixture.targetPath));
  assert.ok(projection.identity_event_id);
  assert.ok(projection.activated_event_id);
});

test("projection returns planned_no_effect for only resource_planned", async () => {
  const missionDir = await tempDir("mission");
  await seedPlannedOnly({
    missionDir,
    resourceId: RESOURCE_ID,
    directoryBasename: deriveDirectoryBasename(RESOURCE_ID),
  });

  const projection = await readTempDirectoryResourceProjection(missionDir, RESOURCE_ID);

  assert.equal(projection.status, "planned_no_effect");
  assert.equal(projection.latest_lifecycle_state, "planned");
});

test("projection returns unsupported_resource_state for an unknown resource", async () => {
  const missionDir = await tempDir("mission");

  const projection = await readTempDirectoryResourceProjection(missionDir, RESOURCE_ID);

  assert.equal(projection.status, "unsupported_resource_state");
});

test("projection maps partial event log without filesystem inference", async () => {
  const fixture = await createT7Resource();
  const paths = foundation0StoragePaths(fixture.missionDir);
  await writeFile(paths.eventLogPath, "{\"schema_version\":1", { flag: "a" });

  const projection = await readTempDirectoryResourceProjection(
    fixture.missionDir,
    RESOURCE_ID,
  );

  assert.equal(projection.status, "partial_event_log");
});

test("projection maps missing and digest-mismatched payloads", async () => {
  const missing = await createT7Resource("res_missing_payload_t8");
  const missingPaths = foundation0StoragePaths(missing.missionDir);
  const missingRaw = await readFile(missingPaths.eventLogPath, "utf8");
  const missingEvents = missingRaw.trimEnd().split("\n").map((line) => {
    const event = JSON.parse(line);
    if (event.event_type !== "resource_activated") return event;
    return {
      ...event,
      payload_digest: `sha256:${"d".repeat(64)}`,
      payload_ref: `foundation0/payloads/sha256:${"d".repeat(64)}.json`,
    };
  });
  await writeFile(
    missingPaths.eventLogPath,
    `${missingEvents.map((event) => JSON.stringify(event)).join("\n")}\n`,
    "utf8",
  );
  const missingProjection = await readTempDirectoryResourceProjection(
    missing.missionDir,
    "res_missing_payload_t8",
  );
  assert.equal(missingProjection.status, "missing_payload");

  const mismatched = await createT7Resource("res_digest_mismatch_t8");
  const mismatchPaths = foundation0StoragePaths(mismatched.missionDir);
  const mismatchDigest = `sha256:${"e".repeat(64)}`;
  await writeFile(
    join(mismatchPaths.payloadsDir, `${mismatchDigest}.json`),
    "{\"tampered\":true}\n",
    "utf8",
  );
  const mismatchRaw = await readFile(mismatchPaths.eventLogPath, "utf8");
  const mismatchEvents = mismatchRaw.trimEnd().split("\n").map((line) => {
    const event = JSON.parse(line);
    if (event.event_type !== "resource_activated") return event;
    return {
      ...event,
      payload_digest: mismatchDigest,
      payload_ref: `foundation0/payloads/${mismatchDigest}.json`,
    };
  });
  await writeFile(
    mismatchPaths.eventLogPath,
    `${mismatchEvents.map((event) => JSON.stringify(event)).join("\n")}\n`,
    "utf8",
  );
  const mismatchProjection = await readTempDirectoryResourceProjection(
    mismatched.missionDir,
    "res_digest_mismatch_t8",
  );
  assert.equal(mismatchProjection.status, "payload_digest_mismatch");
});

test("verification returns verified_active for a valid T7-created directory", async () => {
  const fixture = await createT7Resource();

  const verification = await verifyDefault(fixture);

  assert.equal(verification.status, "verified_active");
  if (verification.status !== "verified_active") return;
  assert.equal(verification.current_path, await realpath(fixture.targetPath));
  assert.equal(verification.marker.resource_id, RESOURCE_ID);
});

test("verification classifies missing target without creating a replacement", async () => {
  const missionDir = await tempDir("mission");
  const approvedRootDir = await tempDir("root");
  const repositoryRoot = await tempDir("repo");
  const currentWorkingDirectory = await tempDir("cwd");
  const targetPath = join(approvedRootDir, deriveDirectoryBasename("res_missing_target_t8"));
  const canonicalMissingPath = join(
    await realpath(approvedRootDir),
    deriveDirectoryBasename("res_missing_target_t8"),
  );
  const identityCore = {
    approved_temp_root_id: ROOT_ID,
    canonical_path: canonicalMissingPath,
    device_id: 1,
    inode: 2,
    owner_uid: 3,
    creation_nonce: "tmp_nonce_t8",
  };
  const identityDigest = computeSha256Digest(identityCore);
  const marker = {
    schema_version: 1,
    mission_id: MISSION_ID,
    resource_id: "res_missing_target_t8",
    identity_digest: identityDigest,
    created_by_action_id: CREATE_ACTION_ID,
  } satisfies TempDirectoryMarker;
  await seedActiveResource({
    missionDir,
    resourceId: "res_missing_target_t8",
    targetPath,
    identity: {
      identity_core: identityCore,
      identity_digest: identityDigest,
      marker_digest: computeSha256Digest(marker),
    },
    marker,
  });

  const verification = await verifyDefault({
    missionDir,
    approvedRootDir,
    repositoryRoot,
    currentWorkingDirectory,
    resourceId: "res_missing_target_t8",
  });

  assert.equal(verification.status, "missing_target");
});

test("verification classifies target and marker unsafe filesystem states", async () => {
  // target_symlink: the canonical_path in the ledger IS a symlink pointing
  // inside the approved root. The verify's lstat check observes the symlink
  // itself (the containment check uses the realpath, which resolves to the
  // symlink's target inside the root).
  const symlinkMission = await tempDir("mission");
  const symlinkRoot = await tempDir("root");
  const symlinkRepo = await tempDir("repo");
  const symlinkCwd = await tempDir("cwd");
  const symlinkTarget = join(symlinkRoot, "pi-topology-symlink-target");
  const symlinkPath = join(symlinkRoot, "pi-topology-symlink");
  await mkdir(symlinkTarget);
  await symlink(symlinkTarget, symlinkPath);
  const symlinkStats = await lstat(symlinkTarget);
  const symlinkBuilt = buildIdentity("res_symlink_t8", symlinkPath, symlinkStats);
  await seedActiveResource({
    missionDir: symlinkMission,
    resourceId: "res_symlink_t8",
    targetPath: symlinkPath,
    identity: symlinkBuilt.identity,
    marker: symlinkBuilt.marker,
  });
  const symlinkResult = await verifyManagedTempDirectory({
    missionDir: symlinkMission,
    repositoryRoot: symlinkRepo,
    currentWorkingDirectory: symlinkCwd,
    approvedTempRoots: [{ root_id: ROOT_ID, path: symlinkRoot }],
    resourceId: "res_symlink_t8",
  });
  assert.equal(symlinkResult.status, "target_symlink");

  // target_not_directory: the canonical_path is a regular file.
  const regularMission = await tempDir("mission");
  const regularRoot = await tempDir("root");
  const regularRepo = await tempDir("repo");
  const regularCwd = await tempDir("cwd");
  const regularPath = join(regularRoot, "pi-topology-file");
  await writeFile(regularPath, "not a directory", "utf8");
  const regularBuilt = buildIdentity("res_regular_t8", regularPath, await lstat(regularPath));
  await seedActiveResource({
    missionDir: regularMission,
    resourceId: "res_regular_t8",
    targetPath: regularPath,
    identity: regularBuilt.identity,
    marker: regularBuilt.marker,
  });
  const regularResult = await verifyManagedTempDirectory({
    missionDir: regularMission,
    repositoryRoot: regularRepo,
    currentWorkingDirectory: regularCwd,
    approvedTempRoots: [{ root_id: ROOT_ID, path: regularRoot }],
    resourceId: "res_regular_t8",
  });
  assert.equal(regularResult.status, "target_not_directory");

  // marker_missing: the target directory exists, but the marker does not.
  const markerMissingMission = await tempDir("mission");
  const markerMissingRoot = await tempDir("root");
  const markerMissingRepo = await tempDir("repo");
  const markerMissingCwd = await tempDir("cwd");
  const markerMissingTarget = join(markerMissingRoot, "pi-topology-marker-missing");
  await mkdir(markerMissingTarget);
  const markerMissingBuilt = buildIdentity(
    "res_marker_missing_t8",
    markerMissingTarget,
    await lstat(markerMissingTarget),
  );
  await seedActiveResource({
    missionDir: markerMissingMission,
    resourceId: "res_marker_missing_t8",
    targetPath: markerMissingTarget,
    identity: markerMissingBuilt.identity,
    marker: markerMissingBuilt.marker,
  });
  const markerMissingResult = await verifyManagedTempDirectory({
    missionDir: markerMissingMission,
    repositoryRoot: markerMissingRepo,
    currentWorkingDirectory: markerMissingCwd,
    approvedTempRoots: [{ root_id: ROOT_ID, path: markerMissingRoot }],
    resourceId: "res_marker_missing_t8",
  });
  assert.equal(markerMissingResult.status, "marker_missing");

  // marker_symlink: the target directory exists, but the marker is a symlink.
  const markerLinkMission = await tempDir("mission");
  const markerLinkRoot = await tempDir("root");
  const markerLinkRepo = await tempDir("repo");
  const markerLinkCwd = await tempDir("cwd");
  const markerLinkTarget = join(markerLinkRoot, "pi-topology-marker-link");
  await mkdir(markerLinkTarget);
  const markerLinkBuilt = buildIdentity(
    "res_marker_symlink_t8",
    markerLinkTarget,
    await lstat(markerLinkTarget),
  );
  await seedActiveResource({
    missionDir: markerLinkMission,
    resourceId: "res_marker_symlink_t8",
    targetPath: markerLinkTarget,
    identity: markerLinkBuilt.identity,
    marker: markerLinkBuilt.marker,
  });
  await symlink(
    join(markerLinkRoot, "elsewhere"),
    join(markerLinkTarget, MARKER_FILENAME),
  );
  const markerLinkResult = await verifyManagedTempDirectory({
    missionDir: markerLinkMission,
    repositoryRoot: markerLinkRepo,
    currentWorkingDirectory: markerLinkCwd,
    approvedTempRoots: [{ root_id: ROOT_ID, path: markerLinkRoot }],
    resourceId: "res_marker_symlink_t8",
  });
  assert.equal(markerLinkResult.status, "marker_symlink");
});

test("verification classifies marker parse, marker mismatch, identity mismatch, and protected path", async () => {
  const markerParse = await seedManualActiveTarget("res_marker_parse_t8");
  await writeFile(
    join(markerParse.targetPath, MARKER_FILENAME),
    "{not json",
    "utf8",
  );
  assert.equal((await verifyDefault({ ...markerParse, resourceId: "res_marker_parse_t8" })).status, "marker_parse_error");

  const markerMismatch = await seedManualActiveTarget("res_marker_mismatch_t8");
  await writeMarker(markerMismatch.targetPath, {
    ...markerMismatch.marker,
    resource_id: "res_other_t8",
  });
  assert.equal((await verifyDefault({ ...markerMismatch, resourceId: "res_marker_mismatch_t8" })).status, "marker_mismatch");

  // identity_mismatch: the canonical_path in the ledger is a real directory,
  // but its recorded device/inode/owner/creation_nonce do not match the
  // lstat readback.
  const identityMismatchMission = await tempDir("mission");
  const identityMismatchRoot = await tempDir("root");
  const identityMismatchRepo = await tempDir("repo");
  const identityMismatchCwd = await tempDir("cwd");
  const replacementTarget = join(identityMismatchRoot, "pi-topology-replacement");
  await mkdir(replacementTarget);
  const mismatchedStats = await lstat(replacementTarget);
  const oldIdentityCore = {
    approved_temp_root_id: ROOT_ID,
    canonical_path: replacementTarget,
    device_id: 999,
    inode: 999,
    owner_uid: 999,
    creation_nonce: "tmp_nonce_t8",
  };
  const oldDigest = computeSha256Digest(oldIdentityCore);
  const mismatchedMarker: TempDirectoryMarker = {
    schema_version: 1,
    mission_id: MISSION_ID,
    resource_id: "res_identity_mismatch_t8",
    identity_digest: oldDigest,
    created_by_action_id: CREATE_ACTION_ID,
  };
  await writeMarker(replacementTarget, mismatchedMarker);
  await seedActiveResource({
    missionDir: identityMismatchMission,
    resourceId: "res_identity_mismatch_t8",
    targetPath: replacementTarget,
    identity: {
      identity_core: oldIdentityCore,
      identity_digest: oldDigest,
      marker_digest: computeSha256Digest(mismatchedMarker),
    },
    marker: mismatchedMarker,
  });
  const identityMismatchResult = await verifyManagedTempDirectory({
    missionDir: identityMismatchMission,
    repositoryRoot: identityMismatchRepo,
    currentWorkingDirectory: identityMismatchCwd,
    approvedTempRoots: [{ root_id: ROOT_ID, path: identityMismatchRoot }],
    resourceId: "res_identity_mismatch_t8",
  });
  assert.equal(identityMismatchResult.status, "identity_mismatch");

  // protected_path: the canonical_path in the ledger IS a protected path
  // (the current working directory).
  const protectedMission = await tempDir("mission");
  const protectedRoot = await tempDir("root");
  const protectedRepo = await tempDir("repo");
  const protectedCwd = await tempDir("cwd");
  const protectedCanonicalCwd = await realpath(protectedCwd);
  const protectedStats = await lstat(protectedCwd);
  const protectedBuilt = buildIdentity(
    "res_protected_path_t8",
    protectedCanonicalCwd,
    protectedStats,
  );
  await seedActiveResource({
    missionDir: protectedMission,
    resourceId: "res_protected_path_t8",
    targetPath: protectedCwd,
    identity: protectedBuilt.identity,
    marker: protectedBuilt.marker,
  });
  const protectedResult = await verifyManagedTempDirectory({
    missionDir: protectedMission,
    repositoryRoot: protectedRepo,
    currentWorkingDirectory: protectedCwd,
    approvedTempRoots: [{ root_id: ROOT_ID, path: protectedRoot }],
    resourceId: "res_protected_path_t8",
  });
  assert.equal(protectedResult.status, "protected_path");
});

test("recording reconciliation_required appends ordered digest-bound events and is idempotent", async () => {
  const fixture = await createT7Resource();
  // Force a non-partial, non-active verification status (append-safe).
  await writeFile(join(fixture.targetPath, MARKER_FILENAME), "{not json", "utf8");
  const verification = await verifyDefault(fixture);
  assert.equal(verification.status, "marker_parse_error");

  const result = await recordTempDirectoryReconciliationRequired({
    missionDir: fixture.missionDir,
    verification,
    actionRequest: reconcileAction(),
    actionAttempt: actionAttempt(RECONCILE_ACTION_ID, RECONCILE_ATTEMPT_ID),
    allowedDecision: allowedDecision(
      RECONCILE_ACTION_ID,
      RECONCILE_ATTEMPT_ID,
      "policy_decision_reconcile_t8",
    ),
    reconciliationActorId: ACTOR_ID,
    nowIso: () => VALID_TS,
  });
  assert.equal(result.result, "recorded");
  assert.deepEqual(
    result.events.map((event) => event.event_type),
    [
      "action_requested",
      "action_attempt_started",
      "policy_decision_recorded",
      "reconciliation_required",
    ],
  );
  const reconciliationPayload = await readFoundation0EventPayload(
    fixture.missionDir,
    result.events.at(-1)!,
  );
  if (
    !reconciliationPayload
    || typeof reconciliationPayload !== "object"
    || !("verification_status" in reconciliationPayload)
  ) {
    assert.fail("reconciliation payload must include verification_status");
  }
  assert.equal(reconciliationPayload.verification_status, "marker_parse_error");

  const replay = await recordTempDirectoryReconciliationRequired({
    missionDir: fixture.missionDir,
    verification,
    actionRequest: reconcileAction(),
    actionAttempt: actionAttempt(RECONCILE_ACTION_ID, RECONCILE_ATTEMPT_ID),
    allowedDecision: allowedDecision(
      RECONCILE_ACTION_ID,
      RECONCILE_ATTEMPT_ID,
      "policy_decision_reconcile_t8",
    ),
    reconciliationActorId: ACTOR_ID,
    nowIso: () => VALID_TS,
  });
  assert.equal(replay.result, "idempotent_replay");
  const events = await readFoundation0Events(fixture.missionDir);
  assert.equal(
    events.filter((event) => event.event_type === "reconciliation_required").length,
    1,
  );
});

test("recording refuses to append after a partial_event_log classification", async () => {
  const fixture = await createT7Resource();
  const paths = foundation0StoragePaths(fixture.missionDir);
  await writeFile(paths.eventLogPath, "{\"schema_version\":1", { flag: "a" });
  const verification = await verifyDefault(fixture);
  assert.equal(verification.status, "partial_event_log");

  const result = await recordTempDirectoryReconciliationRequired({
    missionDir: fixture.missionDir,
    verification,
    actionRequest: reconcileAction(),
    actionAttempt: actionAttempt(RECONCILE_ACTION_ID, RECONCILE_ATTEMPT_ID),
    allowedDecision: allowedDecision(
      RECONCILE_ACTION_ID,
      RECONCILE_ATTEMPT_ID,
      "policy_decision_reconcile_t8",
    ),
    reconciliationActorId: ACTOR_ID,
    nowIso: () => VALID_TS,
  });
  assert.equal(result.result, "partial_event_log_classified");
  assert.equal(result.events.length, 0);
  // The event log must still be partial (no new rows appended).
  const raw = await readFile(paths.eventLogPath, "utf8");
  assert.ok(!raw.endsWith("\n"), "event log must still be partial");
});

test("recording skips verified_active and rejects invalid reconcile action shape", async () => {
  const fixture = await createT7Resource();
  const verified = await verifyDefault(fixture);
  assert.equal(verified.status, "verified_active");
  const skipped = await recordTempDirectoryReconciliationRequired({
    missionDir: fixture.missionDir,
    verification: verified,
    actionRequest: reconcileAction(),
    actionAttempt: actionAttempt(RECONCILE_ACTION_ID, RECONCILE_ATTEMPT_ID),
    allowedDecision: allowedDecision(
      RECONCILE_ACTION_ID,
      RECONCILE_ATTEMPT_ID,
      "policy_decision_reconcile_t8",
    ),
    reconciliationActorId: ACTOR_ID,
    nowIso: () => VALID_TS,
  });
  assert.equal(skipped.result, "verified_active_noop");

  await assert.rejects(() =>
    recordTempDirectoryReconciliationRequired({
      missionDir: fixture.missionDir,
      verification: {
        status: "missing_target",
        projection: verified.projection,
        resource_id: RESOURCE_ID,
        reason: "x",
        blocking_event_ids: [],
      },
      actionRequest: {
        ...reconcileAction(),
        capability: "terminate_resource",
      } as ReconcileResourceAction,
      actionAttempt: actionAttempt(RECONCILE_ACTION_ID, RECONCILE_ATTEMPT_ID),
      allowedDecision: allowedDecision(
        RECONCILE_ACTION_ID,
        RECONCILE_ATTEMPT_ID,
        "policy_decision_reconcile_t8",
      ),
      reconciliationActorId: ACTOR_ID,
      nowIso: () => VALID_TS,
    }),
  );
});

test("regression P1-1: non-active lifecycle_state in later resource_activated does not verify as active", async () => {
  for (const staleLifecycle of ["cleanup_pending", "stale", "cleanup_attempted", "cleanup_failed"] as const) {
    const fixture = await createT7Resource(`res_lifecycle_${staleLifecycle}_t8`);
    const staleTargetPath = join(
      await realpath(fixture.approvedRootDir),
      deriveDirectoryBasename(`res_lifecycle_${staleLifecycle}_t8`),
    );
    const staleStats = await lstat(fixture.targetPath);
    const staleBuilt = buildIdentity(`res_lifecycle_${staleLifecycle}_t8`, staleTargetPath, staleStats);
    const staleResource = {
      schema_version: 1,
      resource_id: `res_lifecycle_${staleLifecycle}_t8`,
      mission_id: MISSION_ID,
      resource_type: "temp_directory",
      ownership_origin: "created",
      owned_by_actor_id: ACTOR_ID,
      cleanup_owner_actor_id: ACTOR_ID,
      registered_by_action_id: CREATE_ACTION_ID,
      authorization_id: AUTHORIZATION_ID,
      verification_state: "verified",
      identity: staleBuilt.identity,
      identity_digest: staleBuilt.identity.identity_digest,
      cleanup_policy: cleanupPolicy(),
      lifecycle_state: staleLifecycle,
      created_at: VALID_TS,
      updated_at: VALID_TS,
    } satisfies ObservedTempDirectoryResource;
    await appendFoundation0Event({
      missionDir: fixture.missionDir,
      missionId: MISSION_ID,
      eventType: "resource_activated",
      entityType: "resource",
      entityId: `res_lifecycle_${staleLifecycle}_t8`,
      payload: staleResource,
      actionId: CREATE_ACTION_ID,
      actionAttemptId: CREATE_ATTEMPT_ID,
      idempotencyKey: `regression_p1_1_${staleLifecycle}`,
      lockId: "t8_regression_p1_1_lock",
    });
    const verification = await verifyDefault({
      ...fixture,
      resourceId: `res_lifecycle_${staleLifecycle}_t8`,
    });
    assert.notEqual(
      verification.status,
      "verified_active",
      `lifecycle_state=${staleLifecycle} must not verify as active`,
    );
    assert.equal(verification.status, "unsupported_resource_state");
    // Target, marker, and identity must remain untouched on disk.
    const statsAfter = await lstat(fixture.targetPath);
    assert.ok(statsAfter.isDirectory());
    const markerRaw = await readFile(join(fixture.targetPath, MARKER_FILENAME), "utf8");
    assert.ok(markerRaw.length > 0);
  }
});

test("regression P1-2: approved-root-ancestor-of-cwd target is classified protected_path", async () => {
  const missionDir = await tempDir("mission");
  const approvedRootDir = await tempDir("root");
  const repositoryRoot = await tempDir("repo");
  // cwd is a descendant of the approved root, mirroring the T7 ancestor-protection
  // scenario the reviewer flagged.
  const cwdAncestorDir = join(approvedRootDir, "repo", "subdir");
  await mkdir(cwdAncestorDir, { recursive: true });
  const childTarget = join(cwdAncestorDir, "pi-topology-child");
  await mkdir(childTarget);
  const childStats = await lstat(childTarget);
  const childCanonical = await realpath(childTarget);
  const childBuilt = buildIdentity("res_p1_2_ancestor_t8", childCanonical, childStats);
  await seedActiveResource({
    missionDir,
    resourceId: "res_p1_2_ancestor_t8",
    targetPath: childCanonical,
    identity: childBuilt.identity,
    marker: childBuilt.marker,
  });
  await writeMarker(childTarget, childBuilt.marker);

  const verification = await verifyManagedTempDirectory({
    missionDir,
    repositoryRoot,
    currentWorkingDirectory: cwdAncestorDir,
    approvedTempRoots: [{ root_id: ROOT_ID, path: approvedRootDir }],
    resourceId: "res_p1_2_ancestor_t8",
  });
  assert.equal(verification.status, "protected_path");
  // Disk must be unchanged: no delete, no rename, no overwrite, no adoption.
  const statsAfter = await lstat(childTarget);
  assert.ok(statsAfter.isDirectory());
  const markerRaw = await readFile(join(childTarget, MARKER_FILENAME), "utf8");
  assert.ok(markerRaw.length > 0);
});
