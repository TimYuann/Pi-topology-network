import assert from "node:assert/strict";
import test from "node:test";

import {
  type ProcessCleanupPolicy,
  type ProcessIdentity,
  type TempDirectoryCleanupPolicy,
} from "../../../src/runtime/foundation0/schema.ts";
import {
  validateManagedResource,
  validatePlannedResource,
} from "../../../src/runtime/foundation0/validation.ts";
import {
  abandonPlannedResource,
  attachObservedIdentity,
  createPlannedResourceRegistration,
} from "../../../src/runtime/foundation0/resource-lifecycle.ts";

const VALID_DIGEST = `sha256:${"a".repeat(64)}`;
const VALID_TS = "2026-06-26T12:00:00.000Z";

function processIdentity(): ProcessIdentity {
  return {
    pid: 12345,
    pgid: 12345,
    start_time_seconds: 1734567890,
    start_time_microseconds: 123456,
    spawn_nonce: "spawn_nonce_001",
    executable: "/opt/homebrew/bin/node",
    argv: ["node", "script.js"],
    cwd: "/tmp/pi-topology-first-slice",
    command_digest: VALID_DIGEST,
    dedicated_process_group: true,
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

function plannedRegistration() {
  return createPlannedResourceRegistration({
    resourceId: "res_process_001",
    missionId: "mission_foundation0_t3",
    resourceType: "process",
    ownershipOrigin: "created",
    ownedByActorId: "actor_runner_001",
    cleanupOwnerActorId: "actor_runner_001",
    registeredByActionId: "action_create_resource_001",
    authorizationId: "auth_owner_001",
    cleanupPolicy: processCleanupPolicy(),
    createdAt: VALID_TS,
  });
}

function tempDirectoryPlannedRegistration() {
  return createPlannedResourceRegistration({
    resourceId: "res_temp_directory_001",
    missionId: "mission_foundation0_t3",
    resourceType: "temp_directory",
    ownershipOrigin: "created",
    ownedByActorId: "actor_runner_001",
    cleanupOwnerActorId: "actor_runner_001",
    registeredByActionId: "action_create_resource_001",
    authorizationId: "auth_owner_001",
    cleanupPolicy: tempDirectoryCleanupPolicy(),
    createdAt: VALID_TS,
  });
}

test("pre-registration creates a valid planned resource with sidecar cleanup policy", () => {
  const registration = plannedRegistration();

  assert.equal(registration.resource.lifecycle_state, "planned");
  assert.equal(registration.resource.identity, null);
  assert.equal(registration.resource.identity_digest, null);
  assert.equal(registration.resource.cleanup_policy, null);
  assert.deepEqual(registration.cleanup_policy, processCleanupPolicy());
  assert.equal(validatePlannedResource(registration.resource).resource_id, "res_process_001");
});

test("pre-registration creates a valid temp-directory sidecar cleanup policy", () => {
  const registration = tempDirectoryPlannedRegistration();

  assert.equal(registration.resource.resource_type, "temp_directory");
  assert.equal(registration.resource.cleanup_policy, null);
  assert.deepEqual(registration.cleanup_policy, tempDirectoryCleanupPolicy());
  assert.equal(validatePlannedResource(registration.resource).resource_id, "res_temp_directory_001");
});

test("process pre-registration rejects a temp-directory cleanup policy sidecar", () => {
  assert.throws(
    () =>
      createPlannedResourceRegistration({
        resourceId: "res_process_bad_policy",
        missionId: "mission_foundation0_t3",
        resourceType: "process",
        ownershipOrigin: "created",
        ownedByActorId: "actor_runner_001",
        cleanupOwnerActorId: "actor_runner_001",
        registeredByActionId: "action_create_resource_001",
        authorizationId: "auth_owner_001",
        cleanupPolicy: tempDirectoryCleanupPolicy(),
        createdAt: VALID_TS,
      }),
    { name: "ResourceCleanupPolicyError" },
  );
});

test("temp-directory pre-registration rejects a process cleanup policy sidecar", () => {
  assert.throws(
    () =>
      createPlannedResourceRegistration({
        resourceId: "res_temp_directory_bad_policy",
        missionId: "mission_foundation0_t3",
        resourceType: "temp_directory",
        ownershipOrigin: "created",
        ownedByActorId: "actor_runner_001",
        cleanupOwnerActorId: "actor_runner_001",
        registeredByActionId: "action_create_resource_001",
        authorizationId: "auth_owner_001",
        cleanupPolicy: processCleanupPolicy(),
        createdAt: VALID_TS,
      }),
    { name: "ResourceCleanupPolicyError" },
  );
});

test("crash after planned registration is representable as a valid planned resource", () => {
  const { resource } = plannedRegistration();

  assert.equal(validateManagedResource(resource).lifecycle_state, "planned");
});

test("attaching observed identity produces a valid registered resource", () => {
  const registration = plannedRegistration();
  const registered = attachObservedIdentity(registration, {
    identity: processIdentity(),
    identityDigest: VALID_DIGEST,
    lifecycleState: "registered",
    observedAt: "2026-06-26T12:01:00.000Z",
  });

  assert.equal(registered.lifecycle_state, "registered");
  assert.equal(registered.identity_digest, VALID_DIGEST);
  assert.deepEqual(registered.cleanup_policy, processCleanupPolicy());
  assert.equal(validateManagedResource(registered).lifecycle_state, "registered");
});

test("attaching observed identity can explicitly account for active state", () => {
  const registration = plannedRegistration();
  const active = attachObservedIdentity(registration, {
    identity: processIdentity(),
    identityDigest: VALID_DIGEST,
    lifecycleState: "active",
    observedAt: "2026-06-26T12:01:00.000Z",
    verificationState: "verified",
  });

  assert.equal(active.lifecycle_state, "active");
  assert.equal(active.verification_state, "verified");
  assert.equal(validateManagedResource(active).lifecycle_state, "active");
});

test("planned resource can be abandoned when external creation never happened", () => {
  const registration = plannedRegistration();
  const abandoned = abandonPlannedResource(registration.resource, {
    updatedAt: "2026-06-26T12:01:00.000Z",
  });

  assert.equal(abandoned.lifecycle_state, "abandoned");
  assert.equal(abandoned.identity, null);
  assert.equal(abandoned.identity_digest, null);
  assert.equal(abandoned.cleanup_policy, null);
  assert.equal(abandoned.verification_state, "verified");
  assert.equal(abandoned.abandoned_reason, "never_created");
  assert.equal(validateManagedResource(abandoned).lifecycle_state, "abandoned");
});
