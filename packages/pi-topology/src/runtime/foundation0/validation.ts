/**
 * Foundation-0 first-slice validators.
 *
 * Every validator:
 *   1. Enforces `additionalProperties: false` against the type's allowed keys.
 *   2. Validates each field's primitive type.
 *   3. Validates ID / digest / timestamp grammars via `ids.ts`.
 *   4. Runs cross-field rules required by docs 19 / 20.
 *
 * Failure throws `Foundation0ValidationError`. Success returns the typed value
 * with no transformation (other than the literal narrowing TypeScript does at
 * the type level).
 *
 * The validators are intentionally pure (no fs, no env). Runtime modules that
 * need access to a Mission registry (e.g. to verify authorization parent links
 * or Mission phase transitions) MUST layer that logic on top of these schema
 * validators in a separate, side-effect-aware module.
 */

import {
  ACTOR_ROLES,
  ACTOR_STATUSES,
  ACTION_PAYLOAD_KINDS,
  ABANDONED_RESOURCE_REASONS,
  CAPABILITIES,
  CLEANUP_METHODS,
  CLOSEOUT_DISPOSITIONS,
  CLOSE_MISSION_OUTCOME_RESULT_CODES,
  CREATE_MANAGED_RESOURCE_OUTCOME_RESULT_CODES,
  DELETE_STRATEGIES,
  EVIDENCE_SOURCE_ENTITY_TYPES,
  EVIDENCE_SUBJECT_TYPES,
  EVALUATION_POINTS,
  EVENT_CAUSED_BY_ENTITY_TYPES,
  EVENT_ENTITY_TYPES,
  EVENT_TYPES,
  INITIAL_OUTCOME_STATUSES,
  MISSION_RELATIONS,
  MISSION_ATTENTION_STATES,
  MISSION_LIFECYCLE_PHASES,
  OWNER_DECISION_KINDS,
  OWNERSHIP_RELATIONS,
  OWNERSHIP_ORIGINS,
  POLICY_DECISION_RESULTS,
  PRINCIPAL_KINDS,
  RECONCILE_RESOURCE_OUTCOME_RESULT_CODES,
  RECONCILIATION_OBSERVATION_STATES,
  RECONCILIATION_RESOLUTIONS,
  REGISTER_RESOURCE_OUTCOME_RESULT_CODES,
  RENAME_STRATEGIES,
  RESOURCE_CREATION_KINDS,
  RESOURCE_LIFECYCLE_STATES,
  RESOURCE_TYPES,
  RISK_CEILINGS,
  RISK_CLASSES,
  ROOT_BASIS,
  TERM_SIGNALS,
  TERMINATE_RESOURCE_OUTCOME_RESULT_CODES,
  TERMINATION_SCOPES,
  TARGET_ENTITY_TYPES,
  VERIFICATION_STATES,
  type ActionRequest,
  type Actor,
  type ActionAttempt,
  type AbandonedResource,
  type Authorization,
  type AuthorizationGrant,
  type AuthorizationGrantScope,
  type CloseoutRecord,
  type CloseMissionAction,
  type CreateManagedResourceAction,
  type DelegatedAuthorization,
  type Evidence,
  type Event,
  type InitialOutcome,
  type ManagedResource,
  type Mission,
  type MissionTarget,
  type ObservedProcessResource,
  type ObservedTempDirectoryResource,
  type OwnerDecision,
  type PlannedResource,
  type PolicyDecision,
  type Principal,
  type ProcessCleanupPolicy,
  type TerminateResourceAction,
  type CleanupAttemptAcquisitionPayload,
 } from "./schema.ts";
import {
  Foundation0ValidationError,
  canonicalizeForDigest,
  computeSha256Digest,
  rejectAdditionalProperties,
  validateBoolean,
  validateDigest,
  validateEnum,
  validateId,
  validateNumber,
  validateObject,
  validateSchemaVersion,
  validateString,
  validateStringArray,
  validateTimestamp,
} from "./ids.ts";

// ============================================================ principal / mission / actor

const PRINCIPAL_KEYS = [
  "schema_version",
  "principal_id",
  "kind",
  "display_name",
  "trust_domain",
] as const;

export function validatePrincipal(input: unknown): Principal {
  const obj = validateObject(input, "Principal");
  rejectAdditionalProperties(obj, PRINCIPAL_KEYS, "Principal");
  return {
    schema_version: validateSchemaVersion(obj.schema_version, "Principal.schema_version"),
    principal_id: validateId(obj.principal_id, "Principal.principal_id"),
    kind: validateEnum(obj.kind, "Principal.kind", PRINCIPAL_KINDS),
    display_name:
      obj.display_name === undefined
        ? undefined
        : validateString(obj.display_name, "Principal.display_name", { allowEmpty: true }),
    trust_domain: validateString(obj.trust_domain, "Principal.trust_domain"),
  };
}

const MISSION_KEYS = [
  "schema_version",
  "mission_id",
  "created_by_principal_id",
  "created_at",
  "lifecycle_phase",
  "attention_state",
  "pending_gate_ids",
  "policy_hash",
] as const;

export function validateMission(input: unknown): Mission {
  const obj = validateObject(input, "Mission");
  rejectAdditionalProperties(obj, MISSION_KEYS, "Mission");
  const pending_gate_ids =
    obj.pending_gate_ids === undefined
      ? undefined
      : validateStringArray(obj.pending_gate_ids, "Mission.pending_gate_ids").map((id) =>
          validateId(id, "Mission.pending_gate_ids[]"),
        );
  return {
    schema_version: validateSchemaVersion(obj.schema_version, "Mission.schema_version"),
    mission_id: validateId(obj.mission_id, "Mission.mission_id"),
    created_by_principal_id: validateId(
      obj.created_by_principal_id,
      "Mission.created_by_principal_id",
    ),
    created_at: validateTimestamp(obj.created_at, "Mission.created_at"),
    lifecycle_phase: validateEnum(
      obj.lifecycle_phase,
      "Mission.lifecycle_phase",
      MISSION_LIFECYCLE_PHASES,
    ),
    attention_state: validateEnum(
      obj.attention_state,
      "Mission.attention_state",
      MISSION_ATTENTION_STATES,
    ),
    pending_gate_ids,
    policy_hash: validateDigest(obj.policy_hash, "Mission.policy_hash"),
  };
}

const ACTOR_KEYS = [
  "schema_version",
  "actor_id",
  "principal_id",
  "mission_id",
  "role",
  "session_id",
  "policy_hash",
  "status",
] as const;

export function validateActor(input: unknown): Actor {
  const obj = validateObject(input, "Actor");
  rejectAdditionalProperties(obj, ACTOR_KEYS, "Actor");
  return {
    schema_version: validateSchemaVersion(obj.schema_version, "Actor.schema_version"),
    actor_id: validateId(obj.actor_id, "Actor.actor_id"),
    principal_id: validateId(obj.principal_id, "Actor.principal_id"),
    mission_id: validateId(obj.mission_id, "Actor.mission_id"),
    role: validateEnum(obj.role, "Actor.role", ACTOR_ROLES),
    session_id:
      obj.session_id === undefined
        ? undefined
        : validateId(obj.session_id, "Actor.session_id"),
    policy_hash: validateDigest(obj.policy_hash, "Actor.policy_hash"),
    status: validateEnum(obj.status, "Actor.status", ACTOR_STATUSES),
  };
}

// ============================================================ authorization

const AUTHORIZATION_GRANT_KEYS = ["capability", "scope", "risk_class"] as const;
const AUTHORIZATION_GRANT_SCOPE_KEYS = [
  "resource_types",
  "mission_relation",
  "approved_temp_root_ids",
  "ownership_relation",
  "cleanup_methods",
] as const;

function validateAuthorizationGrant(input: unknown): AuthorizationGrant {
  const obj = validateObject(input, "AuthorizationGrant");
  rejectAdditionalProperties(obj, AUTHORIZATION_GRANT_KEYS, "AuthorizationGrant");
  const capability = validateEnum(obj.capability, "AuthorizationGrant.capability", CAPABILITIES);
  const risk_class = validateEnum(obj.risk_class, "AuthorizationGrant.risk_class", RISK_CLASSES);
  const scope = validateAuthorizationGrantScope(obj.scope, capability);
  return {
    capability,
    scope,
    risk_class,
  };
}

function validateAuthorizationGrantScope(
  input: unknown,
  capability: AuthorizationGrant["capability"],
): AuthorizationGrantScope {
  const obj = validateObject(input, "AuthorizationGrant.scope");
  rejectAdditionalProperties(obj, AUTHORIZATION_GRANT_SCOPE_KEYS, "AuthorizationGrant.scope");
  const scope: AuthorizationGrantScope = {};
  if (obj.resource_types !== undefined) {
    scope.resource_types = validateStringArray(
      obj.resource_types,
      "AuthorizationGrant.scope.resource_types",
    ).map((rt, i) =>
      validateEnum(rt, `AuthorizationGrant.scope.resource_types[${i}]`, RESOURCE_TYPES),
    );
  }
  if (obj.mission_relation !== undefined) {
    scope.mission_relation = validateEnum(
      obj.mission_relation,
      "AuthorizationGrant.scope.mission_relation",
      MISSION_RELATIONS,
    );
  }
  if (obj.approved_temp_root_ids !== undefined) {
    scope.approved_temp_root_ids = validateStringArray(
      obj.approved_temp_root_ids,
      "AuthorizationGrant.scope.approved_temp_root_ids",
    ).map((id, i) =>
      validateId(id, `AuthorizationGrant.scope.approved_temp_root_ids[${i}]`),
    );
  }
  if (obj.ownership_relation !== undefined) {
    scope.ownership_relation = validateEnum(
      obj.ownership_relation,
      "AuthorizationGrant.scope.ownership_relation",
      OWNERSHIP_RELATIONS,
    );
  }
  if (obj.cleanup_methods !== undefined) {
    scope.cleanup_methods = validateStringArray(
      obj.cleanup_methods,
      "AuthorizationGrant.scope.cleanup_methods",
    ).map((method, i) =>
      validateEnum(method, `AuthorizationGrant.scope.cleanup_methods[${i}]`, CLEANUP_METHODS),
    );
  }
  validateCapabilityScopeCompatibility(scope, capability);
  return scope;
}

function validateCapabilityScopeCompatibility(
  scope: AuthorizationGrantScope,
  capability: AuthorizationGrant["capability"],
): void {
  if (
    capability !== "terminate_resource" &&
    capability !== "reconcile_resource" &&
    (scope.ownership_relation !== undefined || scope.cleanup_methods !== undefined)
  ) {
    throw new Foundation0ValidationError(
      `AuthorizationGrant.scope cleanup fields are not valid for ${capability}`,
    );
  }
  if (capability === "close_mission" && scope.resource_types !== undefined) {
    throw new Foundation0ValidationError(
      "AuthorizationGrant.scope.resource_types is not valid for close_mission",
    );
  }
}

const AUTHORIZATION_COMMON_KEYS = [
  "authorization_id",
  "mission_id",
  "granted_by_principal_id",
  "granted_by_actor_id",
  "granted_under_authorization_id",
  "root_basis",
  "granted_to_actor_id",
  "delegation_depth_remaining",
  "risk_ceiling",
  "policy_hash_at_grant",
  "expires_at",
  "supersedes_authorization_id",
  "grants",
] as const;

interface ParsedAuthorizationCommon {
  authorization_id: string;
  mission_id: string;
  granted_by_principal_id: string;
  granted_to_actor_id: string;
  delegation_depth_remaining: number;
  risk_ceiling: Authorization["risk_ceiling"];
  policy_hash_at_grant: string;
  expires_at: string;
  supersedes_authorization_id?: string | null;
  grants: AuthorizationGrant[];
}

function parseAuthorizationCommonFields(
  obj: Record<string, unknown>,
  name: string,
): ParsedAuthorizationCommon {
  return {
    authorization_id: validateId(obj.authorization_id, `${name}.authorization_id`),
    mission_id: validateId(obj.mission_id, `${name}.mission_id`),
    granted_by_principal_id: validateId(
      obj.granted_by_principal_id,
      `${name}.granted_by_principal_id`,
    ),
    granted_to_actor_id: validateId(
      obj.granted_to_actor_id,
      `${name}.granted_to_actor_id`,
    ),
    delegation_depth_remaining: validateNumber(
      obj.delegation_depth_remaining,
      `${name}.delegation_depth_remaining`,
      { min: 0 },
    ),
    risk_ceiling: validateEnum(obj.risk_ceiling, `${name}.risk_ceiling`, RISK_CEILINGS),
    policy_hash_at_grant: validateDigest(
      obj.policy_hash_at_grant,
      `${name}.policy_hash_at_grant`,
    ),
    expires_at: validateTimestamp(obj.expires_at, `${name}.expires_at`),
    supersedes_authorization_id:
      obj.supersedes_authorization_id === undefined
        ? undefined
        : obj.supersedes_authorization_id === null
          ? null
          : validateId(
              obj.supersedes_authorization_id,
              `${name}.supersedes_authorization_id`,
            ),
    grants: Array.isArray(obj.grants)
      ? (obj.grants as unknown[]).map((g) => validateAuthorizationGrant(g))
      : (() => {
          throw new Foundation0ValidationError(`${name}.grants must be an array`);
        })(),
  };
}

const ROOT_AUTH_KEYS = [
  ...AUTHORIZATION_COMMON_KEYS,
  "authorization_kind",
] as const;

export function validateRootAuthorization(input: unknown): RootAuthorization {
  const obj = validateObject(input, "RootAuthorization");
  rejectAdditionalProperties(obj, ROOT_AUTH_KEYS, "RootAuthorization");
  if (obj.authorization_kind !== "root") {
    throw new Foundation0ValidationError(
      `RootAuthorization.authorization_kind must be "root", got ${JSON.stringify(obj.authorization_kind)}`,
    );
  }
  const common = parseAuthorizationCommonFields(obj, "RootAuthorization");
  const root_basis = validateEnum(obj.root_basis, "RootAuthorization.root_basis", ROOT_BASIS);
  if (obj.granted_by_actor_id !== undefined && obj.granted_by_actor_id !== null) {
    throw new Foundation0ValidationError("RootAuthorization.granted_by_actor_id must be null");
  }
  if (
    obj.granted_under_authorization_id !== undefined &&
    obj.granted_under_authorization_id !== null
  ) {
    throw new Foundation0ValidationError(
      "RootAuthorization.granted_under_authorization_id must be null",
    );
  }
  const result: RootAuthorization = {
    authorization_kind: "root",
    ...common,
    granted_by_actor_id: null,
    granted_under_authorization_id: null,
    root_basis,
  };
  if (
    result.supersedes_authorization_id !== undefined &&
    result.supersedes_authorization_id !== null &&
    result.supersedes_authorization_id === result.authorization_id
  ) {
    throw new Foundation0ValidationError(
      "RootAuthorization.supersedes_authorization_id must differ from authorization_id",
    );
  }
  return result;
}

const DELEGATED_AUTH_KEYS = [
  ...AUTHORIZATION_COMMON_KEYS,
  "authorization_kind",
] as const;

export function validateDelegatedAuthorization(input: unknown): DelegatedAuthorization {
  const obj = validateObject(input, "DelegatedAuthorization");
  rejectAdditionalProperties(obj, DELEGATED_AUTH_KEYS, "DelegatedAuthorization");
  if (obj.authorization_kind !== "delegated") {
    throw new Foundation0ValidationError(
      `DelegatedAuthorization.authorization_kind must be "delegated", got ${JSON.stringify(obj.authorization_kind)}`,
    );
  }
  if (obj.root_basis !== null) {
    throw new Foundation0ValidationError("DelegatedAuthorization.root_basis must be null");
  }
  const common = parseAuthorizationCommonFields(obj, "DelegatedAuthorization");
  const granted_by_actor_id = validateId(
    obj.granted_by_actor_id,
    "DelegatedAuthorization.granted_by_actor_id",
  );
  const granted_under_authorization_id = validateId(
    obj.granted_under_authorization_id,
    "DelegatedAuthorization.granted_under_authorization_id",
  );
  if (granted_under_authorization_id === common.authorization_id) {
    throw new Foundation0ValidationError(
      "DelegatedAuthorization.granted_under_authorization_id must differ from authorization_id",
    );
  }
  return {
    authorization_kind: "delegated",
    ...common,
    granted_by_actor_id,
    granted_under_authorization_id,
    root_basis: null,
  };
}

export function validateAuthorization(input: unknown): Authorization {
  const obj = validateObject(input, "Authorization");
  const kind = obj.authorization_kind;
  if (kind === "root") return validateRootAuthorization(obj);
  if (kind === "delegated") return validateDelegatedAuthorization(obj);
  throw new Foundation0ValidationError(
    `Authorization.authorization_kind must be "root" or "delegated", got ${JSON.stringify(kind)}`,
  );
}

// ============================================================ action request / attempt

const ACTION_REQUEST_COMMON_KEYS = [
  "schema_version",
  "action_id",
  "mission_id",
  "actor_id",
  "authorization_id",
  "idempotency_key",
  "payload_ref",
  "payload_digest",
  "effect_fingerprint",
  "retry_of_action_id",
  "requested_at",
  "capability",
  "target",
  "payload_kind",
] as const;

const RESOURCE_TARGET_KEYS = ["entity_type", "resource_id"] as const;
const MISSION_TARGET_KEYS = ["entity_type", "mission_id"] as const;

function validateResourceTarget(input: unknown): ResourceTarget {
  const obj = validateObject(input, "ActionRequest.target");
  rejectAdditionalProperties(obj, RESOURCE_TARGET_KEYS, "ActionRequest.target");
  const entity_type = validateEnum(
    obj.entity_type,
    "ActionRequest.target.entity_type",
    TARGET_ENTITY_TYPES,
  );
  if (entity_type !== "resource") {
    throw new Foundation0ValidationError(
      `ActionRequest.target.entity_type must be "resource" for this action, got "${entity_type}"`,
    );
  }
  const resource_id = validateId(obj.resource_id, "ActionRequest.target.resource_id");
  return { entity_type, resource_id };
}

function validateMissionTarget(
  input: unknown,
  actionMissionId: string,
): MissionTarget {
  const obj = validateObject(input, "ActionRequest.target");
  rejectAdditionalProperties(obj, MISSION_TARGET_KEYS, "ActionRequest.target");
  const entity_type = validateEnum(
    obj.entity_type,
    "ActionRequest.target.entity_type",
    TARGET_ENTITY_TYPES,
  );
  if (entity_type !== "mission") {
    throw new Foundation0ValidationError(
      `ActionRequest.target.entity_type must be "mission" for close_mission, got "${entity_type}"`,
    );
  }
  const mission_id = validateId(obj.mission_id, "ActionRequest.target.mission_id");
  if (mission_id !== actionMissionId) {
    throw new Foundation0ValidationError(
      `ActionRequest.target.mission_id "${mission_id}" must equal action.mission_id "${actionMissionId}"`,
    );
  }
  return { entity_type, mission_id };
}

interface ActionRequestCommonFields {
  schema_version: 1;
  action_id: string;
  mission_id: string;
  actor_id: string;
  authorization_id: string;
  idempotency_key: string;
  payload_ref: string;
  payload_digest: string;
  effect_fingerprint: string;
  retry_of_action_id?: string | null;
  requested_at: string;
}

function parseActionRequestCommon(
  obj: Record<string, unknown>,
): ActionRequestCommonFields {
  return {
    schema_version: validateSchemaVersion(
      obj.schema_version,
      "ActionRequest.schema_version",
    ),
    action_id: validateId(obj.action_id, "ActionRequest.action_id"),
    mission_id: validateId(obj.mission_id, "ActionRequest.mission_id"),
    actor_id: validateId(obj.actor_id, "ActionRequest.actor_id"),
    authorization_id: validateId(
      obj.authorization_id,
      "ActionRequest.authorization_id",
    ),
    idempotency_key: validateId(
      obj.idempotency_key,
      "ActionRequest.idempotency_key",
    ),
    payload_ref: validateString(obj.payload_ref, "ActionRequest.payload_ref"),
    payload_digest: validateDigest(
      obj.payload_digest,
      "ActionRequest.payload_digest",
    ),
    effect_fingerprint: validateDigest(
      obj.effect_fingerprint,
      "ActionRequest.effect_fingerprint",
    ),
    retry_of_action_id:
      obj.retry_of_action_id === undefined
        ? null
        : obj.retry_of_action_id === null
          ? null
          : validateId(
              obj.retry_of_action_id,
              "ActionRequest.retry_of_action_id",
            ),
    requested_at: validateTimestamp(
      obj.requested_at,
      "ActionRequest.requested_at",
    ),
  };
}

export function validateRegisterResourceAction(input: unknown): RegisterResourceAction {
  const obj = validateObject(input, "RegisterResourceAction");
  rejectAdditionalProperties(obj, ACTION_REQUEST_COMMON_KEYS, "RegisterResourceAction");
  const common = parseActionRequestCommon(obj);
  const capability = validateEnum(obj.capability, "RegisterResourceAction.capability", CAPABILITIES);
  if (capability !== "register_resource") {
    throw new Foundation0ValidationError(
      `RegisterResourceAction.capability must be "register_resource", got "${capability}"`,
    );
  }
  const payload_kind = validateEnum(
    obj.payload_kind,
    "RegisterResourceAction.payload_kind",
    ACTION_PAYLOAD_KINDS,
  );
  if (payload_kind !== "register_resource") {
    throw new Foundation0ValidationError(
      `RegisterResourceAction.payload_kind must be "register_resource", got "${payload_kind}"`,
    );
  }
  return {
    ...common,
    capability,
    payload_kind,
    target: validateResourceTarget(obj.target),
  };
}

export function validateCreateManagedResourceAction(input: unknown): CreateManagedResourceAction {
  const obj = validateObject(input, "CreateManagedResourceAction");
  rejectAdditionalProperties(obj, ACTION_REQUEST_COMMON_KEYS, "CreateManagedResourceAction");
  const common = parseActionRequestCommon(obj);
  const capability = validateEnum(obj.capability, "CreateManagedResourceAction.capability", CAPABILITIES);
  if (capability !== "create_managed_resource") {
    throw new Foundation0ValidationError(
      `CreateManagedResourceAction.capability must be "create_managed_resource", got "${capability}"`,
    );
  }
  const payload_kind = validateEnum(
    obj.payload_kind,
    "CreateManagedResourceAction.payload_kind",
    ACTION_PAYLOAD_KINDS,
  );
  if (payload_kind !== "create_managed_resource") {
    throw new Foundation0ValidationError(
      `CreateManagedResourceAction.payload_kind must be "create_managed_resource", got "${payload_kind}"`,
    );
  }
  return {
    ...common,
    capability,
    payload_kind,
    target: validateResourceTarget(obj.target),
  };
}

export function validateTerminateResourceAction(input: unknown): TerminateResourceAction {
  const obj = validateObject(input, "TerminateResourceAction");
  rejectAdditionalProperties(obj, ACTION_REQUEST_COMMON_KEYS, "TerminateResourceAction");
  const common = parseActionRequestCommon(obj);
  const capability = validateEnum(obj.capability, "TerminateResourceAction.capability", CAPABILITIES);
  if (capability !== "terminate_resource") {
    throw new Foundation0ValidationError(
      `TerminateResourceAction.capability must be "terminate_resource", got "${capability}"`,
    );
  }
  const payload_kind = validateEnum(
    obj.payload_kind,
    "TerminateResourceAction.payload_kind",
    ACTION_PAYLOAD_KINDS,
  );
  if (payload_kind !== "terminate_resource") {
    throw new Foundation0ValidationError(
      `TerminateResourceAction.payload_kind must be "terminate_resource", got "${payload_kind}"`,
    );
  }
  return {
    ...common,
    capability,
    payload_kind,
    target: validateResourceTarget(obj.target),
  };
}

export function validateReconcileResourceAction(input: unknown): ReconcileResourceAction {
  const obj = validateObject(input, "ReconcileResourceAction");
  rejectAdditionalProperties(obj, ACTION_REQUEST_COMMON_KEYS, "ReconcileResourceAction");
  const common = parseActionRequestCommon(obj);
  const capability = validateEnum(obj.capability, "ReconcileResourceAction.capability", CAPABILITIES);
  if (capability !== "reconcile_resource") {
    throw new Foundation0ValidationError(
      `ReconcileResourceAction.capability must be "reconcile_resource", got "${capability}"`,
    );
  }
  const payload_kind = validateEnum(
    obj.payload_kind,
    "ReconcileResourceAction.payload_kind",
    ACTION_PAYLOAD_KINDS,
  );
  if (payload_kind !== "reconcile_resource") {
    throw new Foundation0ValidationError(
      `ReconcileResourceAction.payload_kind must be "reconcile_resource", got "${payload_kind}"`,
    );
  }
  return {
    ...common,
    capability,
    payload_kind,
    target: validateResourceTarget(obj.target),
  };
}

export function validateCloseMissionAction(input: unknown): CloseMissionAction {
  const obj = validateObject(input, "CloseMissionAction");
  rejectAdditionalProperties(obj, ACTION_REQUEST_COMMON_KEYS, "CloseMissionAction");
  const common = parseActionRequestCommon(obj);
  const capability = validateEnum(obj.capability, "CloseMissionAction.capability", CAPABILITIES);
  if (capability !== "close_mission") {
    throw new Foundation0ValidationError(
      `CloseMissionAction.capability must be "close_mission", got "${capability}"`,
    );
  }
  const payload_kind = validateEnum(
    obj.payload_kind,
    "CloseMissionAction.payload_kind",
    ACTION_PAYLOAD_KINDS,
  );
  if (payload_kind !== "close_mission") {
    throw new Foundation0ValidationError(
      `CloseMissionAction.payload_kind must be "close_mission", got "${payload_kind}"`,
    );
  }
  return {
    ...common,
    capability,
    payload_kind,
    target: validateMissionTarget(obj.target, common.mission_id),
  };
}

export function validateActionRequest(input: unknown): ActionRequest {
  const obj = validateObject(input, "ActionRequest");
  const kind = obj.payload_kind;
  if (kind === "register_resource") return validateRegisterResourceAction(obj);
  if (kind === "create_managed_resource") return validateCreateManagedResourceAction(obj);
  if (kind === "terminate_resource") return validateTerminateResourceAction(obj);
  if (kind === "reconcile_resource") return validateReconcileResourceAction(obj);
  if (kind === "close_mission") return validateCloseMissionAction(obj);
  throw new Foundation0ValidationError(
    `ActionRequest.payload_kind must be one of ${ACTION_PAYLOAD_KINDS.join(", ")}, got ${JSON.stringify(kind)}`,
  );
}

// ============================================================ action attempt / outcome

const ACTION_ATTEMPT_KEYS = [
  "schema_version",
  "action_attempt_id",
  "action_id",
  "mission_id",
  "attempt_number",
  "started_at",
] as const;

export function validateActionAttempt(input: unknown): ActionAttempt {
  const obj = validateObject(input, "ActionAttempt");
  rejectAdditionalProperties(obj, ACTION_ATTEMPT_KEYS, "ActionAttempt");
  return {
    schema_version: validateSchemaVersion(obj.schema_version, "ActionAttempt.schema_version"),
    action_attempt_id: validateId(obj.action_attempt_id, "ActionAttempt.action_attempt_id"),
    action_id: validateId(obj.action_id, "ActionAttempt.action_id"),
    mission_id: validateId(obj.mission_id, "ActionAttempt.mission_id"),
    attempt_number: validateNumber(obj.attempt_number, "ActionAttempt.attempt_number", {
      min: 1,
      integer: true,
    }),
    started_at: validateTimestamp(obj.started_at, "ActionAttempt.started_at"),
  };
}

const POLICY_DECISION_KEYS = [
  "schema_version",
  "policy_decision_id",
  "action_id",
  "action_attempt_id",
  "mission_id",
  "evaluation_point",
  "evaluation_sequence",
  "result",
  "reason_codes",
  "authorization_chain",
  "evaluated_policy_hash",
  "decided_at",
] as const;

export function validatePolicyDecision(input: unknown): PolicyDecision {
  const obj = validateObject(input, "PolicyDecision");
  rejectAdditionalProperties(obj, POLICY_DECISION_KEYS, "PolicyDecision");
  return {
    schema_version: validateSchemaVersion(obj.schema_version, "PolicyDecision.schema_version"),
    policy_decision_id: validateId(obj.policy_decision_id, "PolicyDecision.policy_decision_id"),
    action_id: validateId(obj.action_id, "PolicyDecision.action_id"),
    action_attempt_id: validateId(obj.action_attempt_id, "PolicyDecision.action_attempt_id"),
    mission_id: validateId(obj.mission_id, "PolicyDecision.mission_id"),
    evaluation_point: validateEnum(
      obj.evaluation_point,
      "PolicyDecision.evaluation_point",
      EVALUATION_POINTS,
    ),
    evaluation_sequence: validateNumber(
      obj.evaluation_sequence,
      "PolicyDecision.evaluation_sequence",
      { min: 1, integer: true },
    ),
    result: validateEnum(obj.result, "PolicyDecision.result", POLICY_DECISION_RESULTS),
    reason_codes:
      obj.reason_codes === undefined
        ? undefined
        : validateStringArray(obj.reason_codes, "PolicyDecision.reason_codes"),
    authorization_chain:
      obj.authorization_chain === undefined
        ? undefined
        : validateStringArray(obj.authorization_chain, "PolicyDecision.authorization_chain").map(
            (id, i) => validateId(id, `PolicyDecision.authorization_chain[${i}]`),
          ),
    evaluated_policy_hash: validateDigest(
      obj.evaluated_policy_hash,
      "PolicyDecision.evaluated_policy_hash",
    ),
    decided_at: validateTimestamp(obj.decided_at, "PolicyDecision.decided_at"),
  };
}

const INITIAL_OUTCOME_KEYS = [
  "schema_version",
  "outcome_id",
  "action_attempt_id",
  "action_id",
  "mission_id",
  "action_payload_kind",
  "status",
  "result_code",
  "evidence_ids",
  "created_at",
] as const;

export function validateInitialOutcome(input: unknown): InitialOutcome {
  const obj = validateObject(input, "InitialOutcome");
  rejectAdditionalProperties(obj, INITIAL_OUTCOME_KEYS, "InitialOutcome");
  const action_payload_kind = validateEnum(
    obj.action_payload_kind,
    "InitialOutcome.action_payload_kind",
    ACTION_PAYLOAD_KINDS,
  );
  return {
    schema_version: validateSchemaVersion(obj.schema_version, "InitialOutcome.schema_version"),
    outcome_id: validateId(obj.outcome_id, "InitialOutcome.outcome_id"),
    action_attempt_id: validateId(obj.action_attempt_id, "InitialOutcome.action_attempt_id"),
    action_id: validateId(obj.action_id, "InitialOutcome.action_id"),
    mission_id: validateId(obj.mission_id, "InitialOutcome.mission_id"),
    action_payload_kind,
    status: validateEnum(obj.status, "InitialOutcome.status", INITIAL_OUTCOME_STATUSES),
    result_code: validateInitialOutcomeResultCode(obj.result_code, action_payload_kind),
    evidence_ids:
      obj.evidence_ids === undefined
        ? undefined
        : validateStringArray(obj.evidence_ids, "InitialOutcome.evidence_ids").map((id, i) =>
            validateId(id, `InitialOutcome.evidence_ids[${i}]`),
          ),
    created_at: validateTimestamp(obj.created_at, "InitialOutcome.created_at"),
  };
}

function validateInitialOutcomeResultCode(
  value: unknown,
  actionPayloadKind: InitialOutcome["action_payload_kind"],
): InitialOutcome["result_code"] {
  if (actionPayloadKind === "register_resource") {
    return validateEnum(
      value,
      "InitialOutcome.result_code",
      REGISTER_RESOURCE_OUTCOME_RESULT_CODES,
    );
  }
  if (actionPayloadKind === "create_managed_resource") {
    return validateEnum(
      value,
      "InitialOutcome.result_code",
      CREATE_MANAGED_RESOURCE_OUTCOME_RESULT_CODES,
    );
  }
  if (actionPayloadKind === "terminate_resource") {
    return validateEnum(
      value,
      "InitialOutcome.result_code",
      TERMINATE_RESOURCE_OUTCOME_RESULT_CODES,
    );
  }
  if (actionPayloadKind === "reconcile_resource") {
    return validateEnum(
      value,
      "InitialOutcome.result_code",
      RECONCILE_RESOURCE_OUTCOME_RESULT_CODES,
    );
  }
  return validateEnum(
    value,
    "InitialOutcome.result_code",
    CLOSE_MISSION_OUTCOME_RESULT_CODES,
  );
}

// ============================================================ reconciliation

const RECONCILIATION_OBSERVATION_KEYS = [
  "schema_version",
  "observation_id",
  "action_attempt_id",
  "action_id",
  "mission_id",
  "state",
  "reconciliation_action_id",
  "reconciliation_actor_id",
  "policy_decision_id",
  "evidence_ids",
  "observed_at",
] as const;

export function validateReconciliationObservation(
  input: unknown,
): ReconciliationObservation {
  const obj = validateObject(input, "ReconciliationObservation");
  rejectAdditionalProperties(
    obj,
    RECONCILIATION_OBSERVATION_KEYS,
    "ReconciliationObservation",
  );
  return {
    schema_version: validateSchemaVersion(
      obj.schema_version,
      "ReconciliationObservation.schema_version",
    ),
    observation_id: validateId(
      obj.observation_id,
      "ReconciliationObservation.observation_id",
    ),
    action_attempt_id: validateId(
      obj.action_attempt_id,
      "ReconciliationObservation.action_attempt_id",
    ),
    action_id: validateId(obj.action_id, "ReconciliationObservation.action_id"),
    mission_id: validateId(obj.mission_id, "ReconciliationObservation.mission_id"),
    state: validateEnum(
      obj.state,
      "ReconciliationObservation.state",
      RECONCILIATION_OBSERVATION_STATES,
    ),
    reconciliation_action_id: validateId(
      obj.reconciliation_action_id,
      "ReconciliationObservation.reconciliation_action_id",
    ),
    reconciliation_actor_id: validateId(
      obj.reconciliation_actor_id,
      "ReconciliationObservation.reconciliation_actor_id",
    ),
    policy_decision_id: validateId(
      obj.policy_decision_id,
      "ReconciliationObservation.policy_decision_id",
    ),
    evidence_ids:
      obj.evidence_ids === undefined
        ? undefined
        : validateStringArray(obj.evidence_ids, "ReconciliationObservation.evidence_ids").map(
            (id, i) =>
              validateId(id, `ReconciliationObservation.evidence_ids[${i}]`),
          ),
    observed_at: validateTimestamp(
      obj.observed_at,
      "ReconciliationObservation.observed_at",
    ),
  };
}

const RECONCILIATION_RESOLUTION_KEYS = [
  "schema_version",
  "resolution_id",
  "action_attempt_id",
  "action_id",
  "mission_id",
  "resolution",
  "reconciliation_action_id",
  "reconciliation_actor_id",
  "policy_decision_id",
  "evidence_ids",
  "observed_at",
] as const;

export function validateReconciliationResolution(
  input: unknown,
): ReconciliationResolution {
  const obj = validateObject(input, "ReconciliationResolution");
  rejectAdditionalProperties(
    obj,
    RECONCILIATION_RESOLUTION_KEYS,
    "ReconciliationResolution",
  );
  return {
    schema_version: validateSchemaVersion(
      obj.schema_version,
      "ReconciliationResolution.schema_version",
    ),
    resolution_id: validateId(
      obj.resolution_id,
      "ReconciliationResolution.resolution_id",
    ),
    action_attempt_id: validateId(
      obj.action_attempt_id,
      "ReconciliationResolution.action_attempt_id",
    ),
    action_id: validateId(obj.action_id, "ReconciliationResolution.action_id"),
    mission_id: validateId(obj.mission_id, "ReconciliationResolution.mission_id"),
    resolution: validateEnum(
      obj.resolution,
      "ReconciliationResolution.resolution",
      RECONCILIATION_RESOLUTIONS,
    ),
    reconciliation_action_id: validateId(
      obj.reconciliation_action_id,
      "ReconciliationResolution.reconciliation_action_id",
    ),
    reconciliation_actor_id: validateId(
      obj.reconciliation_actor_id,
      "ReconciliationResolution.reconciliation_actor_id",
    ),
    policy_decision_id: validateId(
      obj.policy_decision_id,
      "ReconciliationResolution.policy_decision_id",
    ),
    evidence_ids:
      obj.evidence_ids === undefined
        ? undefined
        : validateStringArray(obj.evidence_ids, "ReconciliationResolution.evidence_ids").map(
            (id, i) =>
              validateId(id, `ReconciliationResolution.evidence_ids[${i}]`),
          ),
    observed_at: validateTimestamp(
      obj.observed_at,
      "ReconciliationResolution.observed_at",
    ),
  };
}

// ============================================================ event

const EVENT_KEYS = [
  "schema_version",
  "event_id",
  "mission_id",
  "sequence",
  "event_type",
  "principal_id",
  "actor_id",
  "action_id",
  "action_attempt_id",
  "policy_decision_id",
  "entity_type",
  "entity_id",
  "caused_by",
  "payload_ref",
  "payload_digest",
  "created_at",
] as const;

const EVENT_CAUSED_BY_KEYS = ["entity_type", "entity_id"] as const;

export function validateEvent(input: unknown): Event {
  const obj = validateObject(input, "Event");
  rejectAdditionalProperties(obj, EVENT_KEYS, "Event");
  let caused_by: Event["caused_by"];
  if (obj.caused_by === undefined) {
    caused_by = undefined;
  } else {
    const c = validateObject(obj.caused_by, "Event.caused_by");
    rejectAdditionalProperties(c, EVENT_CAUSED_BY_KEYS, "Event.caused_by");
    caused_by = {
      entity_type: validateEnum(
        c.entity_type,
        "Event.caused_by.entity_type",
        EVENT_CAUSED_BY_ENTITY_TYPES,
      ),
      entity_id: validateId(c.entity_id, "Event.caused_by.entity_id"),
    };
  }
  return {
    schema_version: validateSchemaVersion(obj.schema_version, "Event.schema_version"),
    event_id: validateId(obj.event_id, "Event.event_id"),
    mission_id: validateId(obj.mission_id, "Event.mission_id"),
    sequence: validateNumber(obj.sequence, "Event.sequence", { min: 0, integer: true }),
    event_type: validateEnum(obj.event_type, "Event.event_type", EVENT_TYPES),
    principal_id:
      obj.principal_id === undefined
        ? undefined
        : validateId(obj.principal_id, "Event.principal_id"),
    actor_id:
      obj.actor_id === undefined
        ? undefined
        : validateId(obj.actor_id, "Event.actor_id"),
    action_id:
      obj.action_id === undefined
        ? undefined
        : validateId(obj.action_id, "Event.action_id"),
    action_attempt_id:
      obj.action_attempt_id === undefined
        ? undefined
        : validateId(obj.action_attempt_id, "Event.action_attempt_id"),
    policy_decision_id:
      obj.policy_decision_id === undefined
        ? undefined
        : validateId(obj.policy_decision_id, "Event.policy_decision_id"),
    entity_type: validateEnum(obj.entity_type, "Event.entity_type", EVENT_ENTITY_TYPES),
    entity_id: validateId(obj.entity_id, "Event.entity_id"),
    caused_by,
    payload_ref: validateString(obj.payload_ref, "Event.payload_ref"),
    payload_digest: validateDigest(obj.payload_digest, "Event.payload_digest"),
    created_at: validateTimestamp(obj.created_at, "Event.created_at"),
  };
}

// ============================================================ managed resource

const MANAGED_RESOURCE_KEYS = [
  "schema_version",
  "resource_id",
  "mission_id",
  "resource_type",
  "ownership_origin",
  "owned_by_actor_id",
  "cleanup_owner_actor_id",
  "registered_by_action_id",
  "authorization_id",
  "cleanup_policy",
  "identity",
  "identity_digest",
  "lifecycle_state",
  "verification_state",
  "abandoned_reason",
  "created_at",
  "updated_at",
] as const;

const PROCESS_IDENTITY_KEYS = [
  "pid",
  "pgid",
  "start_time_seconds",
  "start_time_microseconds",
  "spawn_nonce",
  "executable",
  "argv",
  "cwd",
  "command_digest",
  "dedicated_process_group",
] as const;

function validateProcessIdentity(input: unknown): ProcessIdentity {
  const obj = validateObject(input, "ProcessIdentity");
  rejectAdditionalProperties(obj, PROCESS_IDENTITY_KEYS, "ProcessIdentity");
  return {
    pid: validateNumber(obj.pid, "ProcessIdentity.pid", { min: 1, integer: true }),
    pgid: validateNumber(obj.pgid, "ProcessIdentity.pgid", { min: 1, integer: true }),
    start_time_seconds: validateNumber(
      obj.start_time_seconds,
      "ProcessIdentity.start_time_seconds",
      { min: 0, integer: true },
    ),
    start_time_microseconds: validateNumber(
      obj.start_time_microseconds,
      "ProcessIdentity.start_time_microseconds",
      { min: 0, integer: true },
    ),
    spawn_nonce:
      obj.spawn_nonce === undefined
        ? undefined
        : validateString(obj.spawn_nonce, "ProcessIdentity.spawn_nonce", { allowEmpty: false }),
    executable: validateString(obj.executable, "ProcessIdentity.executable"),
    argv: validateStringArray(obj.argv, "ProcessIdentity.argv"),
    cwd: validateString(obj.cwd, "ProcessIdentity.cwd"),
    command_digest: validateDigest(
      obj.command_digest,
      "ProcessIdentity.command_digest",
    ),
    dedicated_process_group: validateBoolean(
      obj.dedicated_process_group,
      "ProcessIdentity.dedicated_process_group",
    ),
  };
}

const PROCESS_CLEANUP_POLICY_KEYS = [
  "termination_scope",
  "term_signal",
  "grace_period_ms",
  "allow_force_kill",
  "force_signal",
] as const;

function validateProcessCleanupPolicy(input: unknown): ProcessCleanupPolicy {
  const obj = validateObject(input, "ProcessCleanupPolicy");
  rejectAdditionalProperties(
    obj,
    PROCESS_CLEANUP_POLICY_KEYS,
    "ProcessCleanupPolicy",
  );
  return {
    termination_scope: validateEnum(
      obj.termination_scope,
      "ProcessCleanupPolicy.termination_scope",
      TERMINATION_SCOPES,
    ),
    term_signal: validateEnum(
      obj.term_signal,
      "ProcessCleanupPolicy.term_signal",
      TERM_SIGNALS,
    ),
    grace_period_ms: validateNumber(
      obj.grace_period_ms,
      "ProcessCleanupPolicy.grace_period_ms",
      { min: 0, integer: true },
    ),
    allow_force_kill: validateBoolean(
      obj.allow_force_kill,
      "ProcessCleanupPolicy.allow_force_kill",
    ),
    force_signal: validateEnum(
      obj.force_signal,
      "ProcessCleanupPolicy.force_signal",
      TERM_SIGNALS,
    ),
  };
}

const TEMP_DIRECTORY_IDENTITY_KEYS = [
  "identity_core",
  "identity_digest",
  "marker_digest",
] as const;

const TEMP_DIRECTORY_IDENTITY_CORE_KEYS = [
  "approved_temp_root_id",
  "canonical_path",
  "device_id",
  "inode",
  "owner_uid",
  "creation_nonce",
] as const;

const TEMP_DIRECTORY_MARKER_KEYS = [
  "schema_version",
  "mission_id",
  "resource_id",
  "identity_digest",
  "created_by_action_id",
] as const;

const TEMP_DIRECTORY_CLEANUP_POLICY_KEYS = [
  "rename_strategy",
  "delete_strategy",
  "quarantine_path_template",
] as const;

function validateTempDirectoryIdentityCore(
  input: unknown,
): TempDirectoryIdentity["identity_core"] {
  const obj = validateObject(input, "TempDirectoryIdentity.identity_core");
  rejectAdditionalProperties(
    obj,
    TEMP_DIRECTORY_IDENTITY_CORE_KEYS,
    "TempDirectoryIdentity.identity_core",
  );
  return {
    approved_temp_root_id: validateString(
      obj.approved_temp_root_id,
      "TempDirectoryIdentity.identity_core.approved_temp_root_id",
    ),
    canonical_path: validateString(
      obj.canonical_path,
      "TempDirectoryIdentity.identity_core.canonical_path",
    ),
    device_id: validateNumber(
      obj.device_id,
      "TempDirectoryIdentity.identity_core.device_id",
      { integer: true },
    ),
    inode: validateNumber(
      obj.inode,
      "TempDirectoryIdentity.identity_core.inode",
      { min: 0, integer: true },
    ),
    owner_uid: validateNumber(
      obj.owner_uid,
      "TempDirectoryIdentity.identity_core.owner_uid",
      { integer: true },
    ),
    creation_nonce: validateString(
      obj.creation_nonce,
      "TempDirectoryIdentity.identity_core.creation_nonce",
    ),
  };
}

export function validateTempDirectoryIdentity(
  input: unknown,
  opts: { verifyDigests?: boolean; marker?: unknown } = {},
): TempDirectoryIdentity {
  const obj = validateObject(input, "TempDirectoryIdentity");
  rejectAdditionalProperties(obj, TEMP_DIRECTORY_IDENTITY_KEYS, "TempDirectoryIdentity");
  const identity_core = validateTempDirectoryIdentityCore(obj.identity_core);
  const identity_digest = validateDigest(
    obj.identity_digest,
    "TempDirectoryIdentity.identity_digest",
  );
  const marker_digest = validateDigest(
    obj.marker_digest,
    "TempDirectoryIdentity.marker_digest",
  );
  if (opts.verifyDigests !== false) {
    const expectedIdentity = computeSha256Digest(identity_core);
    if (expectedIdentity !== identity_digest) {
      throw new Foundation0ValidationError(
        `TempDirectoryIdentity.identity_digest does not match sha256(canonical(identity_core)); expected ${expectedIdentity}, got ${identity_digest}`,
      );
    }
    if (opts.marker !== undefined) {
      const marker = validateTempDirectoryMarker(opts.marker);
      const expectedMarker = computeSha256Digest(marker);
      if (expectedMarker !== marker_digest) {
        throw new Foundation0ValidationError(
          `TempDirectoryIdentity.marker_digest does not match sha256(canonical(marker)); expected ${expectedMarker}, got ${marker_digest}`,
        );
      }
    }
  }
  return { identity_core, identity_digest, marker_digest };
}

export function validateTempDirectoryMarker(input: unknown): TempDirectoryMarker {
  const obj = validateObject(input, "TempDirectoryMarker");
  rejectAdditionalProperties(obj, TEMP_DIRECTORY_MARKER_KEYS, "TempDirectoryMarker");
  return {
    schema_version: validateSchemaVersion(
      obj.schema_version,
      "TempDirectoryMarker.schema_version",
    ),
    mission_id: validateId(obj.mission_id, "TempDirectoryMarker.mission_id"),
    resource_id: validateId(obj.resource_id, "TempDirectoryMarker.resource_id"),
    identity_digest: validateDigest(
      obj.identity_digest,
      "TempDirectoryMarker.identity_digest",
    ),
    created_by_action_id: validateId(
      obj.created_by_action_id,
      "TempDirectoryMarker.created_by_action_id",
    ),
  };
}

function validateTempDirectoryCleanupPolicy(
  input: unknown,
): TempDirectoryCleanupPolicy {
  const obj = validateObject(input, "TempDirectoryCleanupPolicy");
  rejectAdditionalProperties(
    obj,
    TEMP_DIRECTORY_CLEANUP_POLICY_KEYS,
    "TempDirectoryCleanupPolicy",
  );
  return {
    rename_strategy: validateEnum(
      obj.rename_strategy,
      "TempDirectoryCleanupPolicy.rename_strategy",
      RENAME_STRATEGIES,
    ),
    delete_strategy: validateEnum(
      obj.delete_strategy,
      "TempDirectoryCleanupPolicy.delete_strategy",
      DELETE_STRATEGIES,
    ),
    quarantine_path_template:
      obj.quarantine_path_template === undefined
        ? undefined
        : validateString(
            obj.quarantine_path_template,
            "TempDirectoryCleanupPolicy.quarantine_path_template",
            { allowEmpty: false },
          ),
  };
}

function parseManagedResourceCommonFields(
  obj: Record<string, unknown>,
  name: string,
) {
  return {
    schema_version: validateSchemaVersion(obj.schema_version, `${name}.schema_version`),
    resource_id: validateId(obj.resource_id, `${name}.resource_id`),
    mission_id: validateId(obj.mission_id, `${name}.mission_id`),
    ownership_origin: validateEnum(
      obj.ownership_origin,
      `${name}.ownership_origin`,
      OWNERSHIP_ORIGINS,
    ),
    owned_by_actor_id: validateId(
      obj.owned_by_actor_id,
      `${name}.owned_by_actor_id`,
    ),
    cleanup_owner_actor_id: validateId(
      obj.cleanup_owner_actor_id,
      `${name}.cleanup_owner_actor_id`,
    ),
    registered_by_action_id: validateId(
      obj.registered_by_action_id,
      `${name}.registered_by_action_id`,
    ),
    authorization_id: validateId(
      obj.authorization_id,
      `${name}.authorization_id`,
    ),
    created_at: validateTimestamp(obj.created_at, `${name}.created_at`),
    updated_at: validateTimestamp(obj.updated_at, `${name}.updated_at`),
  };
}

export function validatePlannedResource(input: unknown): PlannedResource {
  const obj = validateObject(input, "PlannedResource");
  rejectAdditionalProperties(obj, MANAGED_RESOURCE_KEYS, "PlannedResource");
  const common = parseManagedResourceCommonFields(obj, "PlannedResource");
  const resource_type = validateEnum(
    obj.resource_type,
    "PlannedResource.resource_type",
    RESOURCE_TYPES,
  );
  const lifecycle_state = validateEnum(
    obj.lifecycle_state,
    "PlannedResource.lifecycle_state",
    RESOURCE_LIFECYCLE_STATES,
  );
  if (lifecycle_state !== "planned") {
    throw new Foundation0ValidationError(
      `PlannedResource.lifecycle_state must be "planned", got "${lifecycle_state}"`,
    );
  }
  if (obj.identity !== null) {
    throw new Foundation0ValidationError(
      "PlannedResource.identity must be null when lifecycle_state=planned",
    );
  }
  if (obj.identity_digest !== null) {
    throw new Foundation0ValidationError(
      "PlannedResource.identity_digest must be null when lifecycle_state=planned",
    );
  }
  if (obj.cleanup_policy !== null) {
    throw new Foundation0ValidationError(
      "PlannedResource.cleanup_policy must be null when lifecycle_state=planned",
    );
  }
  if (obj.verification_state !== "unverified") {
    throw new Foundation0ValidationError(
      `PlannedResource.verification_state must be "unverified", got "${obj.verification_state}"`,
    );
  }
  return {
    ...common,
    resource_type,
    lifecycle_state,
    verification_state: "unverified",
    identity: null,
    identity_digest: null,
    cleanup_policy: null,
  };
}

export function validateAbandonedResource(input: unknown): AbandonedResource {
  const obj = validateObject(input, "AbandonedResource");
  rejectAdditionalProperties(obj, MANAGED_RESOURCE_KEYS, "AbandonedResource");
  const common = parseManagedResourceCommonFields(obj, "AbandonedResource");
  const resource_type = validateEnum(
    obj.resource_type,
    "AbandonedResource.resource_type",
    RESOURCE_TYPES,
  );
  const lifecycle_state = validateEnum(
    obj.lifecycle_state,
    "AbandonedResource.lifecycle_state",
    RESOURCE_LIFECYCLE_STATES,
  );
  if (lifecycle_state !== "abandoned") {
    throw new Foundation0ValidationError(
      `AbandonedResource.lifecycle_state must be "abandoned", got "${lifecycle_state}"`,
    );
  }
  if (obj.identity !== null) {
    throw new Foundation0ValidationError(
      "AbandonedResource.identity must be null when lifecycle_state=abandoned",
    );
  }
  if (obj.identity_digest !== null) {
    throw new Foundation0ValidationError(
      "AbandonedResource.identity_digest must be null when lifecycle_state=abandoned",
    );
  }
  if (obj.cleanup_policy !== null) {
    throw new Foundation0ValidationError(
      "AbandonedResource.cleanup_policy must be null when lifecycle_state=abandoned",
    );
  }
  const abandoned_reason = validateEnum(
    obj.abandoned_reason,
    "AbandonedResource.abandoned_reason",
    ABANDONED_RESOURCE_REASONS,
  );
  const verification_state = validateEnum(
    obj.verification_state,
    "AbandonedResource.verification_state",
    VERIFICATION_STATES,
  );
  if (verification_state !== "verified") {
    throw new Foundation0ValidationError(
      `AbandonedResource.verification_state must be "verified" for abandoned_reason="${abandoned_reason}"`,
    );
  }
  return {
    ...common,
    resource_type,
    lifecycle_state: "abandoned",
    verification_state,
    abandoned_reason,
    identity: null,
    identity_digest: null,
    cleanup_policy: null,
  };
}

export function validateObservedProcessResource(
  input: unknown,
): ObservedProcessResource {
  const obj = validateObject(input, "ObservedProcessResource");
  rejectAdditionalProperties(obj, MANAGED_RESOURCE_KEYS, "ObservedProcessResource");
  const common = parseManagedResourceCommonFields(obj, "ObservedProcessResource");
  const resource_type = obj.resource_type;
  if (resource_type !== "process") {
    throw new Foundation0ValidationError(
      `ObservedProcessResource.resource_type must be "process", got "${resource_type}"`,
    );
  }
  const lifecycle_state = validateEnum(
    obj.lifecycle_state,
    "ObservedProcessResource.lifecycle_state",
    RESOURCE_LIFECYCLE_STATES,
  );
  if (lifecycle_state === "planned") {
    throw new Foundation0ValidationError(
      `ObservedProcessResource.lifecycle_state must not be "planned", got "${lifecycle_state}"`,
    );
  }
  if (lifecycle_state === "abandoned") {
    throw new Foundation0ValidationError(
      `ObservedProcessResource.lifecycle_state must not be "abandoned", got "${lifecycle_state}"`,
    );
  }
  if (obj.identity === undefined || obj.identity === null) {
    throw new Foundation0ValidationError(
      `ObservedProcessResource.identity must be present when lifecycle_state is "${lifecycle_state}" (test 21)`,
    );
  }
  if (obj.identity_digest === undefined || obj.identity_digest === null) {
    throw new Foundation0ValidationError(
      `ObservedProcessResource.identity_digest must be present when lifecycle_state is "${lifecycle_state}" (test 21)`,
    );
  }
  if (obj.cleanup_policy === undefined || obj.cleanup_policy === null) {
    throw new Foundation0ValidationError(
      `ObservedProcessResource.cleanup_policy must be present`,
    );
  }
  const verification_state = validateEnum(
    obj.verification_state,
    "ObservedProcessResource.verification_state",
    VERIFICATION_STATES,
  );
  return {
    ...common,
    resource_type: "process",
    lifecycle_state,
    verification_state,
    identity: validateProcessIdentity(obj.identity),
    identity_digest: validateDigest(obj.identity_digest, "ObservedProcessResource.identity_digest"),
    cleanup_policy: validateProcessCleanupPolicy(obj.cleanup_policy),
  };
}

export function validateObservedTempDirectoryResource(
  input: unknown,
): ObservedTempDirectoryResource {
  const obj = validateObject(input, "ObservedTempDirectoryResource");
  rejectAdditionalProperties(
    obj,
    MANAGED_RESOURCE_KEYS,
    "ObservedTempDirectoryResource",
  );
  const common = parseManagedResourceCommonFields(
    obj,
    "ObservedTempDirectoryResource",
  );
  const resource_type = obj.resource_type;
  if (resource_type !== "temp_directory") {
    throw new Foundation0ValidationError(
      `ObservedTempDirectoryResource.resource_type must be "temp_directory", got "${resource_type}"`,
    );
  }
  const lifecycle_state = validateEnum(
    obj.lifecycle_state,
    "ObservedTempDirectoryResource.lifecycle_state",
    RESOURCE_LIFECYCLE_STATES,
  );
  if (lifecycle_state === "planned") {
    throw new Foundation0ValidationError(
      `ObservedTempDirectoryResource.lifecycle_state must not be "planned", got "${lifecycle_state}"`,
    );
  }
  if (lifecycle_state === "abandoned") {
    throw new Foundation0ValidationError(
      `ObservedTempDirectoryResource.lifecycle_state must not be "abandoned", got "${lifecycle_state}"`,
    );
  }
  if (obj.identity === undefined || obj.identity === null) {
    throw new Foundation0ValidationError(
      `ObservedTempDirectoryResource.identity must be present when lifecycle_state is "${lifecycle_state}" (test 21)`,
    );
  }
  if (obj.identity_digest === undefined || obj.identity_digest === null) {
    throw new Foundation0ValidationError(
      `ObservedTempDirectoryResource.identity_digest must be present when lifecycle_state is "${lifecycle_state}" (test 21)`,
    );
  }
  if (obj.cleanup_policy === undefined || obj.cleanup_policy === null) {
    throw new Foundation0ValidationError(
      `ObservedTempDirectoryResource.cleanup_policy must be present`,
    );
  }
  const verification_state = validateEnum(
    obj.verification_state,
    "ObservedTempDirectoryResource.verification_state",
    VERIFICATION_STATES,
  );
  return {
    ...common,
    resource_type: "temp_directory",
    lifecycle_state,
    verification_state,
    identity: validateTempDirectoryIdentity(obj.identity),
    identity_digest: validateDigest(
      obj.identity_digest,
      "ObservedTempDirectoryResource.identity_digest",
    ),
    cleanup_policy: validateTempDirectoryCleanupPolicy(obj.cleanup_policy),
  };
}

export function validateManagedResource(input: unknown): ManagedResource {
  const obj = validateObject(input, "ManagedResource");
  const resource_type = obj.resource_type;
  const lifecycle_state = obj.lifecycle_state;
  if (lifecycle_state === "planned") {
    return validatePlannedResource(obj);
  }
  if (lifecycle_state === "abandoned") {
    return validateAbandonedResource(obj);
  }
  if (resource_type === "process") {
    return validateObservedProcessResource(obj);
  }
  if (resource_type === "temp_directory") {
    return validateObservedTempDirectoryResource(obj);
  }
  throw new Foundation0ValidationError(
    `ManagedResource.resource_type must be one of ${RESOURCE_TYPES.join(", ")}, got ${JSON.stringify(resource_type)}`,
  );
}

// ============================================================ resource creation plan

const RESOURCE_CREATION_PLAN_KEYS = [
  "schema_version",
  "plan_id",
  "mission_id",
  "resource_id",
  "resource_type",
  "planned_resource",
  "cleanup_policy",
  "creation_kind",
  "creation_payload",
  "authorization_id",
  "requested_by_action_id",
  "effect_fingerprint",
  "created_at",
] as const;

export function validateResourceCreationPlan(input: unknown): ResourceCreationPlan {
  const obj = validateObject(input, "ResourceCreationPlan");
  rejectAdditionalProperties(obj, RESOURCE_CREATION_PLAN_KEYS, "ResourceCreationPlan");
  const resource_type = validateEnum(
    obj.resource_type,
    "ResourceCreationPlan.resource_type",
    RESOURCE_TYPES,
  );
  const creation_kind = validateEnum(
    obj.creation_kind,
    "ResourceCreationPlan.creation_kind",
    RESOURCE_CREATION_KINDS,
  );
  if (
    (resource_type === "process" && creation_kind !== "spawn_process") ||
    (resource_type === "temp_directory" && creation_kind !== "create_temp_directory")
  ) {
    throw new Foundation0ValidationError(
      `ResourceCreationPlan.creation_kind ${creation_kind} does not match resource_type ${resource_type}`,
    );
  }

  const mission_id = validateId(obj.mission_id, "ResourceCreationPlan.mission_id");
  const resource_id = validateId(obj.resource_id, "ResourceCreationPlan.resource_id");
  const authorization_id = validateId(
    obj.authorization_id,
    "ResourceCreationPlan.authorization_id",
  );
  const planned_resource = validatePlannedResource(obj.planned_resource);
  if (planned_resource.mission_id !== mission_id) {
    throw new Foundation0ValidationError(
      "ResourceCreationPlan.planned_resource.mission_id must match mission_id",
    );
  }
  if (planned_resource.resource_id !== resource_id) {
    throw new Foundation0ValidationError(
      "ResourceCreationPlan.planned_resource.resource_id must match resource_id",
    );
  }
  if (planned_resource.authorization_id !== authorization_id) {
    throw new Foundation0ValidationError(
      "ResourceCreationPlan.planned_resource.authorization_id must match authorization_id",
    );
  }
  if (planned_resource.resource_type !== resource_type) {
    throw new Foundation0ValidationError(
      "ResourceCreationPlan.planned_resource.resource_type must match resource_type",
    );
  }

  const cleanup_policy = resource_type === "process"
    ? validateProcessCleanupPolicy(obj.cleanup_policy)
    : validateTempDirectoryCleanupPolicy(obj.cleanup_policy);
  const creation_payload = validateObject(
    obj.creation_payload,
    "ResourceCreationPlan.creation_payload",
  );

  return {
    schema_version: validateSchemaVersion(
      obj.schema_version,
      "ResourceCreationPlan.schema_version",
    ),
    plan_id: validateId(obj.plan_id, "ResourceCreationPlan.plan_id"),
    mission_id,
    resource_id,
    resource_type,
    planned_resource,
    cleanup_policy,
    creation_kind,
    creation_payload,
    authorization_id,
    requested_by_action_id: validateId(
      obj.requested_by_action_id,
      "ResourceCreationPlan.requested_by_action_id",
    ),
    effect_fingerprint: validateDigest(
      obj.effect_fingerprint,
      "ResourceCreationPlan.effect_fingerprint",
    ),
    created_at: validateTimestamp(obj.created_at, "ResourceCreationPlan.created_at"),
  };
}

// ============================================================ evidence / owner decision / closeout

const EVIDENCE_KEYS = [
  "schema_version",
  "evidence_id",
  "mission_id",
  "source",
  "subject",
  "digest",
  "produced_by_principal_id",
  "produced_by_actor_id",
  "created_at",
] as const;

const EVIDENCE_SOURCE_KEYS = ["entity_type", "entity_id"] as const;
const EVIDENCE_SUBJECT_KEYS = [
  "subject_type",
  "resource_id",
  "identity_digest",
  "action_attempt_id",
] as const;

export function validateEvidence(input: unknown): Evidence {
  const obj = validateObject(input, "Evidence");
  rejectAdditionalProperties(obj, EVIDENCE_KEYS, "Evidence");
  const source = validateObject(obj.source, "Evidence.source");
  rejectAdditionalProperties(source, EVIDENCE_SOURCE_KEYS, "Evidence.source");
  const subject = validateObject(obj.subject, "Evidence.subject");
  rejectAdditionalProperties(subject, EVIDENCE_SUBJECT_KEYS, "Evidence.subject");
  return {
    schema_version: validateSchemaVersion(obj.schema_version, "Evidence.schema_version"),
    evidence_id: validateId(obj.evidence_id, "Evidence.evidence_id"),
    mission_id: validateId(obj.mission_id, "Evidence.mission_id"),
    source: {
      entity_type: validateEnum(
        source.entity_type,
        "Evidence.source.entity_type",
        EVIDENCE_SOURCE_ENTITY_TYPES,
      ),
      entity_id: validateId(source.entity_id, "Evidence.source.entity_id"),
    },
    subject: {
      subject_type: validateEnum(
        subject.subject_type,
        "Evidence.subject.subject_type",
        EVIDENCE_SUBJECT_TYPES,
      ),
      resource_id: validateId(subject.resource_id, "Evidence.subject.resource_id"),
      identity_digest: validateDigest(
        subject.identity_digest,
        "Evidence.subject.identity_digest",
      ),
      action_attempt_id: validateId(
        subject.action_attempt_id,
        "Evidence.subject.action_attempt_id",
      ),
    },
    digest: validateDigest(obj.digest, "Evidence.digest"),
    produced_by_principal_id: validateId(
      obj.produced_by_principal_id,
      "Evidence.produced_by_principal_id",
    ),
    produced_by_actor_id: validateId(
      obj.produced_by_actor_id,
      "Evidence.produced_by_actor_id",
    ),
    created_at: validateTimestamp(obj.created_at, "Evidence.created_at"),
  };
}

const OWNER_DECISION_KEYS = [
  "schema_version",
  "owner_decision_id",
  "mission_id",
  "issued_by_principal_id",
  "decision",
  "verified_through_sequence",
  "resource_snapshot_digest",
  "residual_resource_ids",
  "created_at",
] as const;

export function validateOwnerDecision(input: unknown): OwnerDecision {
  const obj = validateObject(input, "OwnerDecision");
  rejectAdditionalProperties(obj, OWNER_DECISION_KEYS, "OwnerDecision");
  return {
    schema_version: validateSchemaVersion(obj.schema_version, "OwnerDecision.schema_version"),
    owner_decision_id: validateId(obj.owner_decision_id, "OwnerDecision.owner_decision_id"),
    mission_id: validateId(obj.mission_id, "OwnerDecision.mission_id"),
    issued_by_principal_id: validateId(
      obj.issued_by_principal_id,
      "OwnerDecision.issued_by_principal_id",
    ),
    decision: validateEnum(
      obj.decision,
      "OwnerDecision.decision",
      OWNER_DECISION_KINDS,
    ),
    verified_through_sequence: validateNumber(
      obj.verified_through_sequence,
      "OwnerDecision.verified_through_sequence",
      { min: 0, integer: true },
    ),
    resource_snapshot_digest: validateDigest(
      obj.resource_snapshot_digest,
      "OwnerDecision.resource_snapshot_digest",
    ),
    residual_resource_ids:
      obj.residual_resource_ids === undefined
        ? undefined
        : validateStringArray(
            obj.residual_resource_ids,
            "OwnerDecision.residual_resource_ids",
          ).map((id, i) => validateId(id, `OwnerDecision.residual_resource_ids[${i}]`)),
    created_at: validateTimestamp(obj.created_at, "OwnerDecision.created_at"),
  };
}

const RESIDUAL_RESOURCE_ENTRY_KEYS = [
  "resource_id",
  "lifecycle_state",
  "verification_state",
  "residual_risk_statement",
  "cleanup_owner_principal_id",
  "evidence_ids",
] as const;

function validateResidualResourceEntry(input: unknown): ResidualResourceEntry {
  const obj = validateObject(input, "ResidualResourceEntry");
  rejectAdditionalProperties(
    obj,
    RESIDUAL_RESOURCE_ENTRY_KEYS,
    "ResidualResourceEntry",
  );
  return {
    resource_id: validateId(obj.resource_id, "ResidualResourceEntry.resource_id"),
    lifecycle_state: validateEnum(
      obj.lifecycle_state,
      "ResidualResourceEntry.lifecycle_state",
      RESOURCE_LIFECYCLE_STATES,
    ),
    verification_state: validateEnum(
      obj.verification_state,
      "ResidualResourceEntry.verification_state",
      VERIFICATION_STATES,
    ),
    residual_risk_statement: validateString(
      obj.residual_risk_statement,
      "ResidualResourceEntry.residual_risk_statement",
    ),
    cleanup_owner_principal_id: validateId(
      obj.cleanup_owner_principal_id,
      "ResidualResourceEntry.cleanup_owner_principal_id",
    ),
    evidence_ids: validateStringArray(
      obj.evidence_ids,
      "ResidualResourceEntry.evidence_ids",
    ).map((id, i) =>
      validateId(id, `ResidualResourceEntry.evidence_ids[${i}]`),
    ),
  };
}

const CLOSEOUT_RECORD_KEYS = [
  "schema_version",
  "closeout_id",
  "mission_id",
  "disposition",
  "verified_through_sequence",
  "resource_snapshot_digest",
  "residual_resources",
  "owner_decision_id",
  "cleanup_owner_principal_id",
  "evidence_ids",
  "created_at",
] as const;

export function validateCloseoutRecord(input: unknown): CloseoutRecord {
  const obj = validateObject(input, "CloseoutRecord");
  rejectAdditionalProperties(obj, CLOSEOUT_RECORD_KEYS, "CloseoutRecord");
  const residual_resources = Array.isArray(obj.residual_resources)
    ? (obj.residual_resources as unknown[]).map((r, i) =>
        validateResidualResourceEntry(r),
      )
    : (() => {
        throw new Foundation0ValidationError(
          "CloseoutRecord.residual_resources must be an array",
        );
      })();
  return {
    schema_version: validateSchemaVersion(obj.schema_version, "CloseoutRecord.schema_version"),
    closeout_id: validateId(obj.closeout_id, "CloseoutRecord.closeout_id"),
    mission_id: validateId(obj.mission_id, "CloseoutRecord.mission_id"),
    disposition: validateEnum(
      obj.disposition,
      "CloseoutRecord.disposition",
      CLOSEOUT_DISPOSITIONS,
    ),
    verified_through_sequence: validateNumber(
      obj.verified_through_sequence,
      "CloseoutRecord.verified_through_sequence",
      { min: 0, integer: true },
    ),
    resource_snapshot_digest: validateDigest(
      obj.resource_snapshot_digest,
      "CloseoutRecord.resource_snapshot_digest",
    ),
    residual_resources,
    owner_decision_id:
      obj.owner_decision_id === undefined
        ? undefined
        : obj.owner_decision_id === null
          ? undefined
          : validateId(obj.owner_decision_id, "CloseoutRecord.owner_decision_id"),
    cleanup_owner_principal_id:
      obj.cleanup_owner_principal_id === undefined
        ? undefined
        : obj.cleanup_owner_principal_id === null
          ? undefined
          : validateId(
              obj.cleanup_owner_principal_id,
              "CloseoutRecord.cleanup_owner_principal_id",
            ),
    evidence_ids:
      obj.evidence_ids === undefined
        ? undefined
        : validateStringArray(obj.evidence_ids, "CloseoutRecord.evidence_ids").map(
            (id, i) => validateId(id, `CloseoutRecord.evidence_ids[${i}]`),
          ),
    created_at: validateTimestamp(obj.created_at, "CloseoutRecord.created_at"),
  };
}

// ============================================================ helpers

/**
 * Compute the canonical identity_digest for a TempDirectoryIdentity from its
 * identity_core only. The marker_digest is computed separately from the marker
 * object. The two digests are intentionally non-circular (test 25).
 */
export function computeTempDirectoryIdentityDigest(
  core: TempDirectoryIdentity["identity_core"],
): string {
  return computeSha256Digest(core);
}

// ============================================================ cleanup attempt acquisition (T6)

const CLEANUP_ATTEMPT_ACQUISITION_PAYLOAD_KEYS = [
  "schema_version",
  "mission_id",
  "resource_id",
  "identity_digest",
  "idempotency_key",
  "action_id",
  "action_attempt_id",
  "policy_decision_id",
  "acquired_at",
] as const;

/**
 * T6: validate a `CleanupAttemptAcquisitionPayload` for shape and grammar.
 * Cross-field equality against the originating ActionRequest / ActionAttempt /
 * PolicyDecision is enforced by the acquisition module, not here.
 */
export function validateCleanupAttemptAcquisitionPayload(
  input: unknown,
): CleanupAttemptAcquisitionPayload {
  const obj = validateObject(input, "CleanupAttemptAcquisitionPayload");
  rejectAdditionalProperties(
    obj,
    CLEANUP_ATTEMPT_ACQUISITION_PAYLOAD_KEYS,
    "CleanupAttemptAcquisitionPayload",
  );
  return {
    schema_version: validateSchemaVersion(
      obj.schema_version,
      "CleanupAttemptAcquisitionPayload.schema_version",
    ),
    mission_id: validateId(
      obj.mission_id,
      "CleanupAttemptAcquisitionPayload.mission_id",
    ),
    resource_id: validateId(
      obj.resource_id,
      "CleanupAttemptAcquisitionPayload.resource_id",
    ),
    identity_digest: validateDigest(
      obj.identity_digest,
      "CleanupAttemptAcquisitionPayload.identity_digest",
    ),
    idempotency_key: validateId(
      obj.idempotency_key,
      "CleanupAttemptAcquisitionPayload.idempotency_key",
    ),
    action_id: validateId(
      obj.action_id,
      "CleanupAttemptAcquisitionPayload.action_id",
    ),
    action_attempt_id: validateId(
      obj.action_attempt_id,
      "CleanupAttemptAcquisitionPayload.action_attempt_id",
    ),
    policy_decision_id: validateId(
      obj.policy_decision_id,
      "CleanupAttemptAcquisitionPayload.policy_decision_id",
    ),
    acquired_at: validateTimestamp(
      obj.acquired_at,
      "CleanupAttemptAcquisitionPayload.acquired_at",
    ),
  };
}

/**
 * Compute the canonical marker_digest for a TempDirectoryMarker.
 */
export function computeTempDirectoryMarkerDigest(
  marker: TempDirectoryMarker,
): string {
  return computeSha256Digest(marker);
}

/**
 * Re-export canonicalizeForDigest for runtime modules that need to construct
 * an ActionRequest payload digest independently of the ActionRequest envelope.
 */
export { canonicalizeForDigest };
