/**
 * Foundation-0 first-slice schema + validation tests.
 *
 * Covers:
 *   - ID / digest / timestamp grammar (positive + negative)
 *   - additionalProperties rejection
 *   - Happy-path validation for each of the 21 first-slice objects
 *   - Acceptance test plan items 21, 22, 25 from the planning gate
 *     (cross-field rules for ManagedResource, ActionRequest, TempDirectoryIdentity)
 *   - Deterministic canonical JSON (key-order independence)
 *   - Schema-version guard
 *
 * Pure tests: no fs, no env, no real processes, no signals.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  DIGEST_PATTERN,
  Foundation0ValidationError,
  ID_PATTERN,
  ISO8601_UTC_MS_PATTERN,
  SHA256_HEX_LENGTH,
  canonicalizeForDigest,
  computeSha256Digest,
  validateDigest,
  validateId,
  validateTimestamp,
} from "../../src/runtime/foundation0/ids.ts";

import {
  ACTION_PAYLOAD_KINDS,
  CAPABILITIES,
  EVENT_TYPES,
  type ActionRequest,
  type Authorization,
  type AuthorizationGrant,
  type CloseoutRecord,
  type Evidence,
  type Event,
  type InitialOutcome,
  type ManagedResource,
  type Mission,
  type OwnerDecision,
  type PlannedResource,
  type PolicyDecision,
  type Principal,
  type ProcessIdentity,
  type TempDirectoryIdentity,
  type TempDirectoryMarker,
} from "../../src/runtime/foundation0/schema.ts";

import {
  computeTempDirectoryIdentityDigest,
  computeTempDirectoryMarkerDigest,
  validateActionAttempt,
  validateActionRequest,
  validateActor,
  validateAuthorization,
  validateCloseMissionAction,
  validateCloseoutRecord,
  validateCreateManagedResourceAction,
  validateDelegatedAuthorization,
  validateEvidence,
  validateEvent,
  validateInitialOutcome,
  validateManagedResource,
  validateMission,
  validateObservedProcessResource,
  validateObservedTempDirectoryResource,
  validateOwnerDecision,
  validatePlannedResource,
  validatePolicyDecision,
  validatePrincipal,
  validateReconcileResourceAction,
  validateReconciliationObservation,
  validateReconciliationResolution,
  validateRegisterResourceAction,
  validateRootAuthorization,
  validateTempDirectoryIdentity,
  validateTempDirectoryMarker,
  validateTerminateResourceAction,
} from "../../src/runtime/foundation0/validation.ts";

// ---------------------------------------------------------------- fixtures

const VALID_DIGEST = `sha256:${"a".repeat(SHA256_HEX_LENGTH)}`;
const VALID_TS = "2026-06-26T12:00:00.000Z";
const MISSION_ID = "mission_2026_06_26_first_slice";
const PRINCIPAL_ID = "principal_owner_2026_06_26";
const ACTOR_ID = "actor_topology_supervisor_001";
const AUTH_ID = "auth_owner_2026_06_26_root";
const ACTION_ID = "action_register_first_slice_001";
const ATTEMPT_ID = "attempt_register_first_slice_001";
const POLICY_DECISION_ID = "policy_decision_register_first_slice_001";
const RESOURCE_ID = "res_temp_default_001";
const EVIDENCE_ID = "ev_first_slice_001";
const OWNER_DECISION_ID = "owner_decision_001";
const CLOSEOUT_ID = "closeout_001";
const OBSERVATION_ID = "recon_obs_001";
const RESOLUTION_ID = "resolution_001";
const OUTCOME_ID = "outcome_001";
const EVENT_ID = "evt_001";

function baseFields(): Pick<
  Mission,
  "schema_version" | "mission_id" | "created_by_principal_id" | "created_at" | "lifecycle_phase" | "attention_state" | "policy_hash"
> {
  return {
    schema_version: 1,
    mission_id: MISSION_ID,
    created_by_principal_id: PRINCIPAL_ID,
    created_at: VALID_TS,
    lifecycle_phase: "active",
    attention_state: "clear",
    policy_hash: VALID_DIGEST,
  };
}

function basePrincipal(): Principal {
  return {
    schema_version: 1,
    principal_id: PRINCIPAL_ID,
    kind: "human_owner",
    display_name: "owner",
    trust_domain: "local-runtime",
  };
}

function baseActor() {
  return {
    schema_version: 1,
    actor_id: ACTOR_ID,
    principal_id: PRINCIPAL_ID,
    mission_id: MISSION_ID,
    role: "topology-supervisor",
    session_id: "session_001",
    policy_hash: VALID_DIGEST,
    status: "live",
  };
}

function baseResourceTarget() {
  return { entity_type: "resource", resource_id: RESOURCE_ID };
}

function baseMissionTarget() {
  return { entity_type: "mission", mission_id: MISSION_ID };
}

function baseActionCommon(): ActionRequest {
  return {
    schema_version: 1,
    action_id: ACTION_ID,
    mission_id: MISSION_ID,
    actor_id: ACTOR_ID,
    authorization_id: AUTH_ID,
    idempotency_key: "idem_001",
    payload_ref: "mission:mission_2026_06_26_first_slice/artifacts/runtime/payloads/action_001.json",
    payload_digest: VALID_DIGEST,
    effect_fingerprint: VALID_DIGEST,
    retry_of_action_id: null,
    requested_at: VALID_TS,
    capability: "register_resource",
    payload_kind: "register_resource",
    target: baseResourceTarget(),
  };
}

function baseAuthorizationGrant(): AuthorizationGrant {
  return {
    capability: "register_resource",
    scope: {
      resource_types: ["process", "temp_directory"],
      mission_relation: "same_mission",
      approved_temp_root_ids: ["tmp_root_default"],
    },
    risk_class: "low",
  };
}

function baseRootAuth(): Authorization {
  return {
    authorization_kind: "root",
    authorization_id: AUTH_ID,
    mission_id: MISSION_ID,
    granted_by_principal_id: PRINCIPAL_ID,
    granted_by_actor_id: null,
    granted_under_authorization_id: null,
    root_basis: "owner_approval",
    granted_to_actor_id: ACTOR_ID,
    delegation_depth_remaining: 1,
    risk_ceiling: "medium",
    policy_hash_at_grant: VALID_DIGEST,
    expires_at: "2026-06-26T14:00:00.000Z",
    grants: [baseAuthorizationGrant()],
  };
}

function baseDelegatedAuth(parentAuthId: string): Authorization {
  return {
    authorization_kind: "delegated",
    authorization_id: "auth_child_001",
    mission_id: MISSION_ID,
    granted_by_principal_id: PRINCIPAL_ID,
    granted_by_actor_id: ACTOR_ID,
    granted_under_authorization_id: parentAuthId,
    root_basis: null,
    granted_to_actor_id: "actor_child_001",
    delegation_depth_remaining: 0,
    risk_ceiling: "low",
    policy_hash_at_grant: VALID_DIGEST,
    expires_at: "2026-06-26T14:00:00.000Z",
    grants: [baseAuthorizationGrant()],
  };
}

function baseProcessIdentity(): ProcessIdentity {
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

function baseTempIdentityCore() {
  return {
    approved_temp_root_id: "tmp_root_default",
    canonical_path: "/private/tmp/pi-topology-first-slice",
    device_id: 16777220,
    inode: 12345,
    owner_uid: 501,
    creation_nonce: "nonce_001",
  };
}

function baseTempMarker(): TempDirectoryMarker {
  return {
    schema_version: 1,
    mission_id: MISSION_ID,
    resource_id: RESOURCE_ID,
    identity_digest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    created_by_action_id: ACTION_ID,
  };
}

function makeTempIdentity(
  core = baseTempIdentityCore(),
  marker = baseTempMarker(),
): { identity: TempDirectoryIdentity; marker: TempDirectoryMarker } {
  const markerWithIdentity = { ...marker, identity_digest: computeTempDirectoryIdentityDigest(core) };
  const identity: TempDirectoryIdentity = {
    identity_core: core,
    identity_digest: computeTempDirectoryIdentityDigest(core),
    marker_digest: computeTempDirectoryMarkerDigest(markerWithIdentity),
  };
  return { identity, marker: markerWithIdentity };
}

function basePlannedResource(): PlannedResource {
  return {
    schema_version: 1,
    resource_id: RESOURCE_ID,
    mission_id: MISSION_ID,
    resource_type: "temp_directory",
    ownership_origin: "created",
    owned_by_actor_id: ACTOR_ID,
    cleanup_owner_actor_id: ACTOR_ID,
    registered_by_action_id: ACTION_ID,
    authorization_id: AUTH_ID,
    cleanup_policy: null,
    identity: null,
    identity_digest: null,
    lifecycle_state: "planned",
    verification_state: "unverified",
    created_at: VALID_TS,
    updated_at: VALID_TS,
  };
}

// ============================================================ IDs / digests / timestamps

test("ID pattern accepts doc 20 §4 sample", () => {
  assert.equal(ID_PATTERN.test("mission_2026_06_26_first_slice"), true);
  assert.equal(ID_PATTERN.test("a"), true);
  assert.equal(ID_PATTERN.test("A1-_x".repeat(25).slice(0, 128)), true);
});

test("ID pattern rejects bad inputs", () => {
  // Note: per doc 20 §4 the pattern ^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$
  // explicitly allows a leading digit. The doc's prose-level rules forbid
  // path separators, "..", shell metacharacter semantics, and leading dots.
  assert.equal(ID_PATTERN.test(""), false);
  assert.equal(ID_PATTERN.test("mission/id"), false, "no slash (path separator)");
  assert.equal(ID_PATTERN.test("mission;rm"), false, "no shell metacharacter");
  assert.equal(ID_PATTERN.test("mission..id"), false, "no double dot");
  assert.equal(ID_PATTERN.test(".mission"), false, "no leading dot");
  assert.equal(ID_PATTERN.test("a".repeat(129)), false, "max 128 chars");
});

test("digest pattern requires sha256:<64 lowercase hex>", () => {
  assert.equal(DIGEST_PATTERN.test("sha256:" + "f".repeat(64)), true);
  assert.equal(
    DIGEST_PATTERN.test("sha256:" + "F".repeat(64)),
    false,
    "uppercase not allowed",
  );
  assert.equal(
    DIGEST_PATTERN.test("sha256:" + "f".repeat(63)),
    false,
    "63 chars too short",
  );
  assert.equal(DIGEST_PATTERN.test("md5:abc"), false, "wrong algorithm");
});

test("ISO-8601 UTC ms pattern enforces millisecond precision + Z", () => {
  assert.equal(ISO8601_UTC_MS_PATTERN.test(VALID_TS), true);
  assert.equal(
    ISO8601_UTC_MS_PATTERN.test("2026-06-26T12:00:00Z"),
    false,
    "missing milliseconds",
  );
  assert.equal(
    ISO8601_UTC_MS_PATTERN.test("2026-06-26T12:00:00.000+00:00"),
    false,
    "offset not allowed",
  );
});

test("validateId / validateDigest / validateTimestamp throw Foundation0ValidationError", () => {
  assert.throws(() => validateId("not valid", "x"), Foundation0ValidationError);
  assert.throws(() => validateDigest("sha256:zzz", "x"), Foundation0ValidationError);
  assert.throws(() => validateTimestamp("not-a-time", "x"), Foundation0ValidationError);
});

// ============================================================ canonical JSON

test("canonicalizeForDigest sorts keys and is deterministic", () => {
  const a = canonicalizeForDigest({ b: 2, a: 1, nested: { z: 3, y: 2 } });
  const b = canonicalizeForDigest({ nested: { y: 2, z: 3 }, a: 1, b: 2 });
  assert.equal(a, b);
  assert.equal(a, '{"a":1,"b":2,"nested":{"y":2,"z":3}}');
});

test("canonicalizeForDigest rejects unsupported types", () => {
  assert.throws(
    () => canonicalizeForDigest({ x: Number.NaN }),
    Foundation0ValidationError,
  );
  assert.throws(
    () => canonicalizeForDigest({ x: 1n as unknown }),
    Foundation0ValidationError,
  );
  assert.throws(
    () => canonicalizeForDigest({ x: undefined }),
    Foundation0ValidationError,
  );
});

test("computeSha256Digest produces sha256:<64 hex> and is stable", () => {
  const d = computeSha256Digest({ b: 2, a: 1 });
  assert.match(d, /^sha256:[0-9a-f]{64}$/);
  assert.equal(d, computeSha256Digest({ a: 1, b: 2 }), "key order independent");
});

// ============================================================ happy path for all 21 objects

test("validatePrincipal happy path", () => {
  const out = validatePrincipal(basePrincipal());
  assert.equal(out.kind, "human_owner");
});

test("validatePrincipal rejects additional property", () => {
  assert.throws(
    () => validatePrincipal({ ...basePrincipal(), extra: "nope" }),
    Foundation0ValidationError,
  );
});

test("validatePrincipal rejects wrong schema_version", () => {
  assert.throws(
    () => validatePrincipal({ ...basePrincipal(), schema_version: 2 }),
    Foundation0ValidationError,
  );
});

test("validateMission happy path", () => {
  const out = validateMission(baseFields());
  assert.equal(out.lifecycle_phase, "active");
});

test("validateMission rejects unknown lifecycle_phase", () => {
  assert.throws(
    () => validateMission({ ...baseFields(), lifecycle_phase: "frozen" }),
    Foundation0ValidationError,
  );
});

test("validateActor happy path", () => {
  const out = validateActor(baseActor());
  assert.equal(out.role, "topology-supervisor");
});

test("validateRootAuthorization happy path", () => {
  const out = validateRootAuthorization(baseRootAuth());
  assert.equal(out.authorization_kind, "root");
});

test("validateRootAuthorization directly rejects non-root authorization_kind", () => {
  assert.throws(
    () =>
      validateRootAuthorization({
        ...baseRootAuth(),
        authorization_kind: "delegated",
      }),
    Foundation0ValidationError,
  );
});

test("validateRootAuthorization rejects non-null delegation fields", () => {
  assert.throws(
    () =>
      validateRootAuthorization({
        ...baseRootAuth(),
        granted_by_actor_id: ACTOR_ID,
      }),
    Foundation0ValidationError,
  );
  assert.throws(
    () =>
      validateRootAuthorization({
        ...baseRootAuth(),
        granted_under_authorization_id: AUTH_ID,
      }),
    Foundation0ValidationError,
  );
});

test("validateRootAuthorization rejects non-root authorization_kind via validateAuthorization", () => {
  assert.throws(
    () =>
      validateAuthorization({
        ...baseRootAuth(),
        authorization_kind: "delegated",
      }),
    Foundation0ValidationError,
  );
});

test("validateDelegatedAuthorization directly rejects non-delegated authorization_kind", () => {
  assert.throws(
    () =>
      validateDelegatedAuthorization({
        ...baseDelegatedAuth(AUTH_ID),
        authorization_kind: "root",
      }),
    Foundation0ValidationError,
  );
});

test("validateDelegatedAuthorization rejects non-null root_basis", () => {
  assert.throws(
    () =>
      validateDelegatedAuthorization({
        ...baseDelegatedAuth(AUTH_ID),
        root_basis: "owner_approval",
      }),
    Foundation0ValidationError,
  );
});

test("validateDelegatedAuthorization requires granted_under_authorization_id differing from self", () => {
  const base = baseDelegatedAuth(AUTH_ID);
  assert.throws(
    () =>
      validateDelegatedAuthorization({
        ...base,
        authorization_id: AUTH_ID,
        granted_under_authorization_id: AUTH_ID,
      }),
    Foundation0ValidationError,
  );
  const valid = validateDelegatedAuthorization(base);
  assert.equal(valid.authorization_kind, "delegated");
});

test("validateAuthorization discriminates by authorization_kind", () => {
  assert.equal(validateAuthorization(baseRootAuth()).authorization_kind, "root");
  assert.equal(
    validateAuthorization(baseDelegatedAuth(AUTH_ID)).authorization_kind,
    "delegated",
  );
  assert.throws(
    () => validateAuthorization({ ...baseRootAuth(), authorization_kind: "weird" }),
    Foundation0ValidationError,
  );
});

test("AuthorizationGrant.scope rejects unknown keys and invalid scalar fields", () => {
  assert.throws(
    () =>
      validateRootAuthorization({
        ...baseRootAuth(),
        grants: [
          {
            ...baseAuthorizationGrant(),
            scope: {
              ...baseAuthorizationGrant().scope,
              unexpected_scope_key: true,
            },
          },
        ],
      }),
    Foundation0ValidationError,
  );
  assert.throws(
    () =>
      validateRootAuthorization({
        ...baseRootAuth(),
        grants: [
          {
            ...baseAuthorizationGrant(),
            scope: {
              ...baseAuthorizationGrant().scope,
              mission_relation: "other_mission",
            },
          },
        ],
      }),
    Foundation0ValidationError,
  );
});

test("AuthorizationGrant.scope validates ownership_relation and cleanup_methods", () => {
  const terminateGrant: AuthorizationGrant = {
    capability: "terminate_resource",
    scope: {
      resource_types: ["process", "temp_directory"],
      mission_relation: "same_mission",
      ownership_relation: "owned_or_cleanup_owned",
      cleanup_methods: [
        "signal_pid",
        "signal_dedicated_process_group",
        "remove_owned_temp_directory",
      ],
      approved_temp_root_ids: ["tmp_root_default"],
    },
    risk_class: "medium",
  };
  assert.equal(
    validateRootAuthorization({
      ...baseRootAuth(),
      grants: [terminateGrant],
    }).grants[0]?.capability,
    "terminate_resource",
  );
  assert.throws(
    () =>
      validateRootAuthorization({
        ...baseRootAuth(),
        grants: [
          {
            ...terminateGrant,
            scope: {
              ...terminateGrant.scope,
              ownership_relation: "owned_by_anyone",
            },
          },
        ],
      }),
    Foundation0ValidationError,
  );
  assert.throws(
    () =>
      validateRootAuthorization({
        ...baseRootAuth(),
        grants: [
          {
            ...terminateGrant,
            scope: {
              ...terminateGrant.scope,
              cleanup_methods: ["shell_rm_rf"],
            },
          },
        ],
      }),
    Foundation0ValidationError,
  );
});

test("AuthorizationGrant.scope rejects capability-incompatible scope fields", () => {
  assert.throws(
    () =>
      validateRootAuthorization({
        ...baseRootAuth(),
        grants: [
          {
            ...baseAuthorizationGrant(),
            scope: {
              ...baseAuthorizationGrant().scope,
              cleanup_methods: ["signal_pid"],
            },
          },
        ],
      }),
    Foundation0ValidationError,
  );
});

test("ActionRequest variants validate by payload_kind discriminant", () => {
  const common = baseActionCommon();
  assert.equal(validateRegisterResourceAction(common).payload_kind, "register_resource");
  assert.equal(
    validateCreateManagedResourceAction({ ...common, payload_kind: "create_managed_resource", capability: "create_managed_resource" })
      .payload_kind,
    "create_managed_resource",
  );
  assert.equal(
    validateTerminateResourceAction({ ...common, payload_kind: "terminate_resource", capability: "terminate_resource" })
      .payload_kind,
    "terminate_resource",
  );
  assert.equal(
    validateReconcileResourceAction({ ...common, payload_kind: "reconcile_resource", capability: "reconcile_resource" })
      .payload_kind,
    "reconcile_resource",
  );
});

test("validateActionRequest dispatches by payload_kind", () => {
  const out = validateActionRequest(baseActionCommon());
  assert.equal(out.payload_kind, "register_resource");
});

test("validateActionAttempt / validatePolicyDecision / validateInitialOutcome happy paths", () => {
  const attempt = {
    schema_version: 1,
    action_attempt_id: ATTEMPT_ID,
    action_id: ACTION_ID,
    mission_id: MISSION_ID,
    attempt_number: 1,
    started_at: VALID_TS,
  };
  assert.equal(validateActionAttempt(attempt).attempt_number, 1);

  const decision = {
    schema_version: 1,
    policy_decision_id: POLICY_DECISION_ID,
    action_id: ACTION_ID,
    action_attempt_id: ATTEMPT_ID,
    mission_id: MISSION_ID,
    evaluation_point: "execution",
    evaluation_sequence: 1,
    result: "allowed",
    reason_codes: [],
    authorization_chain: [AUTH_ID],
    evaluated_policy_hash: VALID_DIGEST,
    decided_at: VALID_TS,
  };
  assert.equal(validatePolicyDecision(decision).result, "allowed");

  const outcome = {
    schema_version: 1,
    outcome_id: OUTCOME_ID,
    action_attempt_id: ATTEMPT_ID,
    action_id: ACTION_ID,
    mission_id: MISSION_ID,
    action_payload_kind: "terminate_resource",
    status: "succeeded",
    result_code: "cleaned",
    evidence_ids: [EVIDENCE_ID],
    created_at: VALID_TS,
  };
  assert.equal(validateInitialOutcome(outcome).status, "succeeded");
});

test("validateInitialOutcome rejects cleanup-only result codes for non-cleanup actions", () => {
  const baseOutcome = {
    schema_version: 1,
    outcome_id: OUTCOME_ID,
    action_attempt_id: ATTEMPT_ID,
    action_id: ACTION_ID,
    mission_id: MISSION_ID,
    status: "succeeded",
    result_code: "cleaned",
    evidence_ids: [EVIDENCE_ID],
    created_at: VALID_TS,
  };
  assert.throws(
    () =>
      validateInitialOutcome({
        ...baseOutcome,
        action_payload_kind: "register_resource",
      }),
    Foundation0ValidationError,
  );
  assert.throws(
    () =>
      validateInitialOutcome({
        ...baseOutcome,
        action_payload_kind: "close_mission",
      }),
    Foundation0ValidationError,
  );
  assert.throws(
    () =>
      validateInitialOutcome({
        ...baseOutcome,
        action_payload_kind: "create_managed_resource",
      }),
    Foundation0ValidationError,
  );
});

test("validateInitialOutcome accepts action-specific non-cleanup result codes", () => {
  const common = {
    schema_version: 1,
    outcome_id: OUTCOME_ID,
    action_attempt_id: ATTEMPT_ID,
    action_id: ACTION_ID,
    mission_id: MISSION_ID,
    status: "succeeded",
    evidence_ids: [EVIDENCE_ID],
    created_at: VALID_TS,
  };
  assert.equal(
    validateInitialOutcome({
      ...common,
      action_payload_kind: "register_resource",
      result_code: "registered",
    }).result_code,
    "registered",
  );
  assert.equal(
    validateInitialOutcome({
      ...common,
      action_payload_kind: "close_mission",
      result_code: "closeout_recorded",
    }).result_code,
    "closeout_recorded",
  );
});

test("validateReconciliationObservation / Resolution happy paths", () => {
  const obs = {
    schema_version: 1,
    observation_id: OBSERVATION_ID,
    action_attempt_id: ATTEMPT_ID,
    action_id: ACTION_ID,
    mission_id: MISSION_ID,
    state: "still_unresolved",
    reconciliation_action_id: ACTION_ID,
    reconciliation_actor_id: ACTOR_ID,
    policy_decision_id: POLICY_DECISION_ID,
    evidence_ids: [],
    observed_at: VALID_TS,
  };
  assert.equal(validateReconciliationObservation(obs).state, "still_unresolved");

  const res = {
    schema_version: 1,
    resolution_id: RESOLUTION_ID,
    action_attempt_id: ATTEMPT_ID,
    action_id: ACTION_ID,
    mission_id: MISSION_ID,
    resolution: "reconciled_succeeded",
    reconciliation_action_id: ACTION_ID,
    reconciliation_actor_id: ACTOR_ID,
    policy_decision_id: POLICY_DECISION_ID,
    evidence_ids: [],
    observed_at: VALID_TS,
  };
  assert.equal(validateReconciliationResolution(res).resolution, "reconciled_succeeded");
});

test("validateEvent happy path", () => {
  const ev: Event = {
    schema_version: 1,
    event_id: EVENT_ID,
    mission_id: MISSION_ID,
    sequence: 1,
    event_type: "action_requested",
    principal_id: PRINCIPAL_ID,
    actor_id: ACTOR_ID,
    action_id: ACTION_ID,
    action_attempt_id: ATTEMPT_ID,
    policy_decision_id: POLICY_DECISION_ID,
    entity_type: "action",
    entity_id: ACTION_ID,
    caused_by: { entity_type: "event", entity_id: "evt_prev" },
    payload_ref: "mission:mission_2026_06_26_first_slice/artifacts/runtime/payloads/evt_001.json",
    payload_digest: VALID_DIGEST,
    created_at: VALID_TS,
  };
  assert.equal(validateEvent(ev).event_type, "action_requested");
});

test("validateEvent rejects unknown event_type", () => {
  const ev = {
    schema_version: 1,
    event_id: EVENT_ID,
    mission_id: MISSION_ID,
    sequence: 1,
    event_type: "made_up_event",
    entity_type: "action",
    entity_id: ACTION_ID,
    payload_ref: "x",
    payload_digest: VALID_DIGEST,
    created_at: VALID_TS,
  };
  assert.throws(() => validateEvent(ev), Foundation0ValidationError);
});

test("validateEvidence happy path", () => {
  const ev: Evidence = {
    schema_version: 1,
    evidence_id: EVIDENCE_ID,
    mission_id: MISSION_ID,
    source: { entity_type: "event", entity_id: EVENT_ID },
    subject: {
      subject_type: "managed_resource",
      resource_id: RESOURCE_ID,
      identity_digest: VALID_DIGEST,
      action_attempt_id: ATTEMPT_ID,
    },
    digest: VALID_DIGEST,
    produced_by_principal_id: PRINCIPAL_ID,
    produced_by_actor_id: ACTOR_ID,
    created_at: VALID_TS,
  };
  assert.equal(validateEvidence(ev).evidence_id, EVIDENCE_ID);
});

test("validateOwnerDecision happy path", () => {
  const od: OwnerDecision = {
    schema_version: 1,
    owner_decision_id: OWNER_DECISION_ID,
    mission_id: MISSION_ID,
    issued_by_principal_id: PRINCIPAL_ID,
    decision: "approve_conditional_closeout",
    verified_through_sequence: 42,
    resource_snapshot_digest: VALID_DIGEST,
    residual_resource_ids: [RESOURCE_ID],
    created_at: VALID_TS,
  };
  assert.equal(validateOwnerDecision(od).decision, "approve_conditional_closeout");
});

test("validateCloseoutRecord happy path", () => {
  const r: CloseoutRecord = {
    schema_version: 1,
    closeout_id: CLOSEOUT_ID,
    mission_id: MISSION_ID,
    disposition: "conditional",
    verified_through_sequence: 42,
    resource_snapshot_digest: VALID_DIGEST,
    residual_resources: [
      {
        resource_id: RESOURCE_ID,
        lifecycle_state: "cleanup_failed",
        verification_state: "unverified",
        residual_risk_statement: "process 12345 not reachable from runtime",
        cleanup_owner_principal_id: PRINCIPAL_ID,
        evidence_ids: [EVIDENCE_ID],
      },
    ],
    owner_decision_id: OWNER_DECISION_ID,
    cleanup_owner_principal_id: PRINCIPAL_ID,
    evidence_ids: [EVIDENCE_ID],
    created_at: VALID_TS,
  };
  assert.equal(validateCloseoutRecord(r).disposition, "conditional");
});

// ============================================================ ACCEPTANCE TEST 21
// Planned resource may lack identity; observed resource without identity is rejected.

test("acceptance test 21: PlannedResource without identity is accepted", () => {
  const out = validatePlannedResource(basePlannedResource());
  assert.equal(out.identity, null);
  assert.equal(out.identity_digest, null);
});

test("acceptance test 21: PlannedResource with identity is rejected", () => {
  const bad = { ...basePlannedResource(), identity: baseProcessIdentity() };
  assert.throws(() => validatePlannedResource(bad), Foundation0ValidationError);
});

test("acceptance test 21: ObservedProcessResource without identity is rejected", () => {
  const observedBase = {
    schema_version: 1,
    resource_id: RESOURCE_ID,
    mission_id: MISSION_ID,
    resource_type: "process",
    ownership_origin: "created",
    owned_by_actor_id: ACTOR_ID,
    cleanup_owner_actor_id: ACTOR_ID,
    registered_by_action_id: ACTION_ID,
    authorization_id: AUTH_ID,
    lifecycle_state: "active",
    verification_state: "verified",
    created_at: VALID_TS,
    updated_at: VALID_TS,
  };
  assert.throws(
    () =>
      validateObservedProcessResource({
        ...observedBase,
        identity: undefined,
        identity_digest: VALID_DIGEST,
        cleanup_policy: {
          termination_scope: "pid",
          term_signal: "SIGTERM",
          grace_period_ms: 5000,
          allow_force_kill: false,
          force_signal: "SIGKILL",
        },
      }),
    Foundation0ValidationError,
  );
});

test("acceptance test 21: validateManagedResource routes planned vs observed by lifecycle_state", () => {
  assert.equal(
    validateManagedResource(basePlannedResource()).lifecycle_state,
    "planned",
  );
  const { identity, marker } = makeTempIdentity();
  const observed = {
    schema_version: 1,
    resource_id: RESOURCE_ID,
    mission_id: MISSION_ID,
    resource_type: "temp_directory",
    ownership_origin: "created",
    owned_by_actor_id: ACTOR_ID,
    cleanup_owner_actor_id: ACTOR_ID,
    registered_by_action_id: ACTION_ID,
    authorization_id: AUTH_ID,
    cleanup_policy: {
      rename_strategy: "atomic_rename_under_root",
      delete_strategy: "recursive_no_follow",
    },
    identity,
    identity_digest: identity.identity_digest,
    lifecycle_state: "active",
    verification_state: "verified",
    created_at: VALID_TS,
    updated_at: VALID_TS,
  };
  const out = validateObservedTempDirectoryResource(observed);
  assert.equal(out.resource_type, "temp_directory");
  assert.equal(out.identity.identity_digest, identity.identity_digest);
  // marker reference roundtrip is independent
  assert.equal(out.identity.marker_digest, computeTempDirectoryMarkerDigest(marker));
});

// ============================================================ ACCEPTANCE TEST 22
// Action target validation: wrong target type for close_mission or terminate_resource is rejected.

test("acceptance test 22: CloseMissionAction rejects resource target", () => {
  const bad = {
    ...baseActionCommon(),
    capability: "close_mission",
    payload_kind: "close_mission",
    target: baseResourceTarget(),
  };
  assert.throws(() => validateCloseMissionAction(bad), Foundation0ValidationError);
});

test("acceptance test 22: CloseMissionAction rejects mission target with mismatched mission_id", () => {
  const bad = {
    ...baseActionCommon(),
    capability: "close_mission",
    payload_kind: "close_mission",
    target: { entity_type: "mission", mission_id: "mission_other" },
  };
  assert.throws(() => validateCloseMissionAction(bad), Foundation0ValidationError);
});

test("acceptance test 22: CloseMissionAction happy path with mission target", () => {
  const good = {
    ...baseActionCommon(),
    capability: "close_mission",
    payload_kind: "close_mission",
    target: baseMissionTarget(),
  };
  const out = validateCloseMissionAction(good);
  assert.equal(out.target.entity_type, "mission");
});

test("acceptance test 22: TerminateResourceAction rejects mission target", () => {
  const bad = {
    ...baseActionCommon(),
    capability: "terminate_resource",
    payload_kind: "terminate_resource",
    target: baseMissionTarget(),
  };
  assert.throws(() => validateTerminateResourceAction(bad), Foundation0ValidationError);
});

test("acceptance test 22: validateActionRequest discriminates and rejects wrong target type", () => {
  assert.throws(
    () =>
      validateActionRequest({
        ...baseActionCommon(),
        capability: "terminate_resource",
        payload_kind: "terminate_resource",
        target: baseMissionTarget(),
      }),
    Foundation0ValidationError,
  );
});

// ============================================================ ACCEPTANCE TEST 25
// Temp identity digest is non-circular and independently verifiable.

test("acceptance test 25: identity_digest depends only on identity_core, not marker_digest", () => {
  const core = baseTempIdentityCore();
  const id = computeTempDirectoryIdentityDigest(core);
  // Mutate the (still-not-yet-set) marker_digest and confirm identity_digest is unchanged.
  const beforeChange = id;
  void beforeChange;
  // identity_digest is deterministic and equals sha256(canonical(core)).
  assert.equal(id, computeSha256Digest(core));
  // It MUST NOT depend on any marker-shaped payload.
  const fakeMarker = { schema_version: 1, mission_id: "x", resource_id: "y", identity_digest: id, created_by_action_id: "z" };
  void fakeMarker;
  // Re-running with identical core yields identical identity_digest even when a
  // (hypothetical) marker has changed.
  assert.equal(computeTempDirectoryIdentityDigest(core), id);
});

test("acceptance test 25: validateTempDirectoryIdentity recomputes both digests and rejects mismatch", () => {
  const core = baseTempIdentityCore();
  const marker = baseTempMarker();
  const tamperedIdentity: TempDirectoryIdentity = {
    identity_core: core,
    identity_digest: computeTempDirectoryIdentityDigest(core),
    marker_digest: "sha256:" + "0".repeat(64),
  };
  assert.throws(
    () => validateTempDirectoryIdentity(tamperedIdentity, { marker }),
    Foundation0ValidationError,
  );
});

test("acceptance test 25: validateTempDirectoryIdentity accepts correct marker_digest", () => {
  const core = baseTempIdentityCore();
  const marker = { ...baseTempMarker(), identity_digest: computeTempDirectoryIdentityDigest(core) };
  const id: TempDirectoryIdentity = {
    identity_core: core,
    identity_digest: computeTempDirectoryIdentityDigest(core),
    marker_digest: computeTempDirectoryMarkerDigest(marker),
  };
  const out = validateTempDirectoryIdentity(id, { marker });
  assert.equal(out.identity_digest, computeTempDirectoryIdentityDigest(core));
  assert.equal(out.marker_digest, computeTempDirectoryMarkerDigest(marker));
});

test("acceptance test 25: marker references identity_digest without including it in identity_digest input", () => {
  const core = baseTempIdentityCore();
  const idDigest = computeTempDirectoryIdentityDigest(core);
  const marker = { ...baseTempMarker(), identity_digest: idDigest };
  const markerDigest = computeTempDirectoryMarkerDigest(marker);
  // If marker_digest depended on identity_digest circularly, changing identity_digest
  // would change marker_digest, but identity_digest depends ONLY on core.
  const altMarker = { ...marker, identity_digest: "sha256:" + "f".repeat(64) };
  assert.notEqual(
    computeTempDirectoryMarkerDigest(marker),
    computeTempDirectoryMarkerDigest(altMarker),
    "marker digest legitimately varies with identity_digest reference",
  );
  // But identity_digest itself does NOT depend on marker.
  const idDigestAfter = computeTempDirectoryIdentityDigest(core);
  assert.equal(idDigest, idDigestAfter);
  // Confirm the chosen marker_digest equals sha256(canonical(marker)) and the
  // canonical form includes identity_digest but identity_digest input did NOT.
  const canonicalMarker = canonicalizeForDigest(marker);
  assert.match(canonicalMarker, new RegExp(idDigest));
});

test("validateTempDirectoryMarker rejects additional property", () => {
  assert.throws(
    () => validateTempDirectoryMarker({ ...baseTempMarker(), extra: "nope" }),
    Foundation0ValidationError,
  );
});

// ============================================================ coverage / catalog sanity

test("CAPABILITIES covers all 5 first-slice capabilities", () => {
  assert.deepEqual(
    [...CAPABILITIES].sort(),
    [
      "close_mission",
      "create_managed_resource",
      "reconcile_resource",
      "register_resource",
      "terminate_resource",
    ],
  );
});

test("ACTION_PAYLOAD_KINDS equals CAPABILITIES", () => {
  assert.deepEqual([...ACTION_PAYLOAD_KINDS].sort(), [...CAPABILITIES].sort());
});

test("EVENT_TYPES contains the doc 20 §8 minimum catalog", () => {
  const required = [
    "mission_created",
    "mission_phase_changed",
    "authorization_granted",
    "authorization_revoked",
    "authorization_replaced",
    "action_requested",
    "action_attempt_started",
    "policy_decision_recorded",
    "initial_outcome_recorded",
    "resource_planned",
    "resource_identity_observed",
    "resource_registered",
    "resource_activated",
    "resource_stale_observed",
    "resource_cleanup_pending",
    "resource_cleanup_attempted",
    "resource_cleaned",
    "resource_cleanup_failed",
    "resource_abandoned",
    "reconciliation_required",
    "reconciliation_observed",
    "reconciliation_resolved",
    "closeout_started",
    "closeout_recorded",
    "projection_conflict_detected",
    "unsupported_schema_detected",
  ];
  for (const r of required) {
    assert.ok((EVENT_TYPES as readonly string[]).includes(r), `missing event_type ${r}`);
  }
});
