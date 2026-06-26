import assert from "node:assert/strict";
import test from "node:test";

import { Foundation0ValidationError } from "../../../src/runtime/foundation0/ids.ts";
import {
  type ManagedResource,
  type ObservedProcessResource,
  type PlannedResource,
  type ProcessCleanupPolicy,
  type ProcessIdentity,
} from "../../../src/runtime/foundation0/schema.ts";
import {
  validateManagedResource,
  validateObservedProcessResource,
} from "../../../src/runtime/foundation0/validation.ts";
import {
  CleanupAttemptCoordinator,
  CleanupInProgressError,
  ResourceLifecycleTransitionError,
  transitionManagedResource,
} from "../../../src/runtime/foundation0/resource-lifecycle.ts";

const VALID_DIGEST = `sha256:${"a".repeat(64)}`;
const VALID_TS = "2026-06-26T12:00:00.000Z";
const NEXT_TS = "2026-06-26T12:01:00.000Z";

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

function plannedResource(overrides: Partial<PlannedResource> = {}): PlannedResource {
  return {
    schema_version: 1,
    resource_id: "res_process_001",
    mission_id: "mission_foundation0_t3",
    resource_type: "process",
    ownership_origin: "created",
    owned_by_actor_id: "actor_runner_001",
    cleanup_owner_actor_id: "actor_runner_001",
    registered_by_action_id: "action_create_resource_001",
    authorization_id: "auth_owner_001",
    cleanup_policy: null,
    identity: null,
    identity_digest: null,
    lifecycle_state: "planned",
    verification_state: "unverified",
    created_at: VALID_TS,
    updated_at: VALID_TS,
    ...overrides,
  };
}

function observedResource(
  lifecycle_state: ObservedProcessResource["lifecycle_state"] = "registered",
  overrides: Partial<ObservedProcessResource> = {},
): ObservedProcessResource {
  return {
    ...plannedResource(),
    resource_type: "process",
    lifecycle_state,
    verification_state: "unverified",
    identity: processIdentity(),
    identity_digest: VALID_DIGEST,
    cleanup_policy: processCleanupPolicy(),
    ...overrides,
  };
}

test("allowed lifecycle transitions succeed and validate returned resources", () => {
  const cases: Array<[ManagedResource, ManagedResource["lifecycle_state"]]> = [
    [
      plannedResource(),
      "registered",
    ],
    [
      plannedResource(),
      "abandoned",
    ],
    [observedResource("registered"), "active"],
    [observedResource("registered"), "abandoned"],
    [observedResource("active"), "stale"],
    [observedResource("active"), "cleanup_pending"],
    [observedResource("stale"), "cleanup_pending"],
    [observedResource("stale"), "cleaned"],
    [observedResource("cleanup_pending"), "cleanup_attempted"],
    [observedResource("cleanup_attempted"), "cleaned"],
    [observedResource("cleanup_attempted"), "cleanup_failed"],
    [observedResource("cleanup_failed"), "cleanup_pending"],
  ];

  for (const [resource, to] of cases) {
    const transitioned = transitionManagedResource(resource, {
      to,
      updatedAt: NEXT_TS,
      identity: to === "registered" && resource.lifecycle_state === "planned" ? processIdentity() : undefined,
      identityDigest:
        to === "registered" && resource.lifecycle_state === "planned" ? VALID_DIGEST : undefined,
      cleanupPolicy:
        to === "registered" && resource.lifecycle_state === "planned"
          ? processCleanupPolicy()
          : undefined,
    });
    assert.equal(transitioned.lifecycle_state, to);
    assert.equal(transitioned.updated_at, NEXT_TS);
    assert.equal(validateManagedResource(transitioned).lifecycle_state, to);
  }
});

test("planned to abandoned succeeds without identity and validates as ManagedResource", () => {
  const abandoned = transitionManagedResource(plannedResource(), {
    to: "abandoned",
    updatedAt: NEXT_TS,
  });

  assert.equal(abandoned.lifecycle_state, "abandoned");
  assert.equal(abandoned.identity, null);
  assert.equal(abandoned.identity_digest, null);
  assert.equal(abandoned.cleanup_policy, null);
  assert.equal(abandoned.verification_state, "unverified");
  assert.equal(validateManagedResource(abandoned).lifecycle_state, "abandoned");
});

test("invalid lifecycle transitions fail with recognizable errors", () => {
  assert.throws(
    () =>
      transitionManagedResource(plannedResource(), {
        to: "active",
        updatedAt: NEXT_TS,
      }),
    ResourceLifecycleTransitionError,
  );
  assert.throws(
    () =>
      transitionManagedResource(observedResource("registered"), {
        to: "cleanup_attempted",
        updatedAt: NEXT_TS,
      }),
    ResourceLifecycleTransitionError,
  );
  assert.throws(
    () =>
      transitionManagedResource(observedResource("cleaned"), {
        to: "cleanup_pending",
        updatedAt: NEXT_TS,
      }),
    ResourceLifecycleTransitionError,
  );
  assert.throws(
    () =>
      transitionManagedResource(
        transitionManagedResource(plannedResource(), {
          to: "abandoned",
          updatedAt: NEXT_TS,
        }),
        {
          to: "registered",
          updatedAt: "2026-06-26T12:02:00.000Z",
          identity: processIdentity(),
          identityDigest: VALID_DIGEST,
          cleanupPolicy: processCleanupPolicy(),
        },
      ),
    ResourceLifecycleTransitionError,
  );
});

test("ownership_origin is preserved and verification_state stays orthogonal", () => {
  const registered = observedResource("registered", {
    ownership_origin: "adopted",
    verification_state: "verified",
  });
  const active = transitionManagedResource(registered, {
    to: "active",
    updatedAt: NEXT_TS,
  });
  assert.equal(active.ownership_origin, "adopted");
  assert.equal(active.verification_state, "verified");

  const stale = transitionManagedResource(active, {
    to: "stale",
    updatedAt: "2026-06-26T12:02:00.000Z",
    verificationState: "unverified",
  });
  assert.equal(stale.ownership_origin, "adopted");
  assert.equal(stale.verification_state, "unverified");
});

test("observed resource without identity is still rejected", () => {
  assert.throws(
    () =>
      validateObservedProcessResource({
        ...observedResource("registered"),
        identity: null,
      }),
    Foundation0ValidationError,
  );
});

test("cleanup attempt coordination returns cleanup_in_progress for competing idempotency keys", () => {
  const coordinator = new CleanupAttemptCoordinator();
  const first = coordinator.acquire({
    resourceId: "res_process_001",
    identityDigest: VALID_DIGEST,
    idempotencyKey: "cleanup_attempt_1",
  });
  const retry = coordinator.acquire({
    resourceId: "res_process_001",
    identityDigest: VALID_DIGEST,
    idempotencyKey: "cleanup_attempt_1",
  });
  assert.equal(retry.status, "acquired");
  assert.equal(retry.attempt_id, first.attempt_id);

  assert.throws(
    () =>
      coordinator.acquire({
        resourceId: "res_process_001",
        identityDigest: VALID_DIGEST,
        idempotencyKey: "cleanup_attempt_2",
      }),
    CleanupInProgressError,
  );
});

test("cleanup attempt coordination is scoped by resource_id and identity_digest", () => {
  const coordinator = new CleanupAttemptCoordinator();
  coordinator.acquire({
    resourceId: "res_process_001",
    identityDigest: VALID_DIGEST,
    idempotencyKey: "cleanup_attempt_1",
  });
  assert.equal(
    coordinator.acquire({
      resourceId: "res_process_002",
      identityDigest: VALID_DIGEST,
      idempotencyKey: "cleanup_attempt_2",
    }).status,
    "acquired",
  );
  assert.equal(
    coordinator.acquire({
      resourceId: "res_process_001",
      identityDigest: `sha256:${"b".repeat(64)}`,
      idempotencyKey: "cleanup_attempt_3",
    }).status,
    "acquired",
  );
});
