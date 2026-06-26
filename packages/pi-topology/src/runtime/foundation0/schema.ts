/**
 * Foundation-0 first-slice schema (TypeScript discriminated unions).
 *
 * Per `docs/20-pi-topology-v0.6-foundation-0-first-slice-contract-closure.md` §3.
 *
 * Every first-slice object MUST be one of the 21 types declared below.
 * Validation lives in `./validation.ts`; this module only defines shapes and
 * enum-like const tuples that double as the authoritative list (e.g. the event
 * catalog is the source for runtime event-type checks).
 *
 * The runtime modules in `../` (mission-events.ts, packet-ledger.ts, etc.) MUST
 * import the enum constants from here rather than redeclaring them, so that
 * drift between schema and runtime is impossible.
 */

// ============================================================ enum constants

export const CAPABILITIES = [
  "create_managed_resource",
  "register_resource",
  "terminate_resource",
  "reconcile_resource",
  "close_mission",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const RESOURCE_TYPES = ["process", "temp_directory"] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

export const MISSION_RELATIONS = ["same_mission"] as const;
export type MissionRelation = (typeof MISSION_RELATIONS)[number];

export const OWNERSHIP_RELATIONS = ["owned_or_cleanup_owned"] as const;
export type OwnershipRelation = (typeof OWNERSHIP_RELATIONS)[number];

export const CLEANUP_METHODS = [
  "signal_pid",
  "signal_dedicated_process_group",
  "remove_owned_temp_directory",
] as const;
export type CleanupMethod = (typeof CLEANUP_METHODS)[number];

export const MISSION_LIFECYCLE_PHASES = [
  "draft",
  "active",
  "closing",
  "closed",
  "abandoned",
] as const;
export type MissionLifecyclePhase = (typeof MISSION_LIFECYCLE_PHASES)[number];

export const MISSION_ATTENTION_STATES = [
  "clear",
  "blocked",
  "rollback_pending",
] as const;
export type MissionAttentionState =
  (typeof MISSION_ATTENTION_STATES)[number];

export const PRINCIPAL_KINDS = ["human_owner", "agent", "system"] as const;
export type PrincipalKind = (typeof PRINCIPAL_KINDS)[number];

export const ACTOR_ROLES = [
  "topology-supervisor",
  "hq",
  "runner",
  "repair",
  "oracle",
  "governor",
  "runtime",
] as const;
export type ActorRole = (typeof ACTOR_ROLES)[number];

export const ACTOR_STATUSES = [
  "planned",
  "live",
  "stale",
  "closed",
  "failed",
] as const;
export type ActorStatus = (typeof ACTOR_STATUSES)[number];

export const ROOT_BASIS = ["owner_approval", "system_bootstrap"] as const;
export type RootBasis = (typeof ROOT_BASIS)[number];

export const RISK_CEILINGS = ["low", "medium", "high"] as const;
export type RiskCeiling = (typeof RISK_CEILINGS)[number];

export const RISK_CLASSES = ["low", "medium", "high"] as const;
export type RiskClass = (typeof RISK_CLASSES)[number];

export const ACTION_PAYLOAD_KINDS = [
  "register_resource",
  "create_managed_resource",
  "terminate_resource",
  "reconcile_resource",
  "close_mission",
] as const;
export type ActionPayloadKind = (typeof ACTION_PAYLOAD_KINDS)[number];

export const TARGET_ENTITY_TYPES = ["resource", "mission"] as const;
export type TargetEntityType = (typeof TARGET_ENTITY_TYPES)[number];

export const EVALUATION_POINTS = [
  "acceptance",
  "execution",
  "reconciliation",
] as const;
export type EvaluationPoint = (typeof EVALUATION_POINTS)[number];

export const POLICY_DECISION_RESULTS = [
  "allowed",
  "denied",
  "requires_owner_gate",
  "requires_authorization",
  "requires_resource_registration",
  "stale_policy_hash",
  "inactive_mission",
  "cleanup_in_progress",
] as const;
export type PolicyDecisionResult = (typeof POLICY_DECISION_RESULTS)[number];

export const INITIAL_OUTCOME_STATUSES = [
  "succeeded",
  "failed",
  "skipped",
  "indeterminate",
] as const;
export type InitialOutcomeStatus = (typeof INITIAL_OUTCOME_STATUSES)[number];

/**
 * Result codes are action-specific. Keep per-action const tuples as the
 * authoritative closed lists; the aggregate type is only for shared helpers.
 */
export const REGISTER_RESOURCE_OUTCOME_RESULT_CODES = [
  "registered",
  "idempotency_conflict",
  "denied",
] as const;
export type RegisterResourceOutcomeResultCode =
  (typeof REGISTER_RESOURCE_OUTCOME_RESULT_CODES)[number];

export const CREATE_MANAGED_RESOURCE_OUTCOME_RESULT_CODES = [
  "created",
  "idempotency_conflict",
  "denied",
] as const;
export type CreateManagedResourceOutcomeResultCode =
  (typeof CREATE_MANAGED_RESOURCE_OUTCOME_RESULT_CODES)[number];

export const TERMINATE_RESOURCE_OUTCOME_RESULT_CODES = [
  "cleaned",
  "already_absent",
  "skipped_identity_mismatch",
  "cleanup_failed",
  "idempotency_conflict",
  "denied",
] as const;
export type TerminateResourceOutcomeResultCode =
  (typeof TERMINATE_RESOURCE_OUTCOME_RESULT_CODES)[number];

export const RECONCILE_RESOURCE_OUTCOME_RESULT_CODES = [
  "reconciled_succeeded",
  "reconciled_failed",
  "idempotency_conflict",
  "denied",
] as const;
export type ReconcileResourceOutcomeResultCode =
  (typeof RECONCILE_RESOURCE_OUTCOME_RESULT_CODES)[number];

export const CLOSE_MISSION_OUTCOME_RESULT_CODES = [
  "closeout_started",
  "closeout_recorded",
  "idempotency_conflict",
  "denied",
] as const;
export type CloseMissionOutcomeResultCode =
  (typeof CLOSE_MISSION_OUTCOME_RESULT_CODES)[number];

export const INITIAL_OUTCOME_RESULT_CODES = [
  ...REGISTER_RESOURCE_OUTCOME_RESULT_CODES,
  ...CREATE_MANAGED_RESOURCE_OUTCOME_RESULT_CODES,
  ...TERMINATE_RESOURCE_OUTCOME_RESULT_CODES,
  ...RECONCILE_RESOURCE_OUTCOME_RESULT_CODES,
  ...CLOSE_MISSION_OUTCOME_RESULT_CODES,
] as const;
export type InitialOutcomeResultCode =
  (typeof INITIAL_OUTCOME_RESULT_CODES)[number];

export const RECONCILIATION_OBSERVATION_STATES = [
  "still_unresolved",
  "observed_cleaned",
  "observed_failed",
  "requires_manual",
] as const;
export type ReconciliationObservationState =
  (typeof RECONCILIATION_OBSERVATION_STATES)[number];

export const RECONCILIATION_RESOLUTIONS = [
  "reconciled_succeeded",
  "reconciled_failed",
] as const;
export type ReconciliationResolutionKind =
  (typeof RECONCILIATION_RESOLUTIONS)[number];

/**
 * Canonical first-slice event catalog (doc 20 §8).
 * Adding a new event type here is a contract change and requires a doc
 * review, schema bump, and projection migration plan.
 */
export const EVENT_TYPES = [
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
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_ENTITY_TYPES = [
  "mission",
  "resource",
  "cleanup",
  "closeout",
  "authorization",
  "action",
] as const;
export type EventEntityType = (typeof EVENT_ENTITY_TYPES)[number];

export const EVENT_CAUSED_BY_ENTITY_TYPES = [
  "event",
  "message",
  "action",
] as const;
export type EventCausedByEntityType =
  (typeof EVENT_CAUSED_BY_ENTITY_TYPES)[number];

export const RESOURCE_LIFECYCLE_STATES = [
  "planned",
  "registered",
  "active",
  "stale",
  "cleanup_pending",
  "cleanup_attempted",
  "cleaned",
  "cleanup_failed",
  "abandoned",
] as const;
export type ResourceLifecycleState =
  (typeof RESOURCE_LIFECYCLE_STATES)[number];

export const VERIFICATION_STATES = ["verified", "unverified"] as const;
export type VerificationState = (typeof VERIFICATION_STATES)[number];

export const OWNERSHIP_ORIGINS = ["created", "adopted"] as const;
export type OwnershipOrigin = (typeof OWNERSHIP_ORIGINS)[number];

export const TERM_SIGNALS = ["SIGTERM", "SIGKILL"] as const;
export type TermSignal = (typeof TERM_SIGNALS)[number];

export const TERMINATION_SCOPES = ["pid", "dedicated_process_group"] as const;
export type TerminationScope = (typeof TERMINATION_SCOPES)[number];

export const RENAME_STRATEGIES = ["atomic_rename_under_root"] as const;
export type RenameStrategy = (typeof RENAME_STRATEGIES)[number];

export const DELETE_STRATEGIES = ["recursive_no_follow"] as const;
export type DeleteStrategy = (typeof DELETE_STRATEGIES)[number];

export const EVIDENCE_SUBJECT_TYPES = ["managed_resource"] as const;
export type EvidenceSubjectType = (typeof EVIDENCE_SUBJECT_TYPES)[number];

export const EVIDENCE_SOURCE_ENTITY_TYPES = [
  "event",
  "action",
  "outcome",
  "payload",
] as const;
export type EvidenceSourceEntityType =
  (typeof EVIDENCE_SOURCE_ENTITY_TYPES)[number];

export const OWNER_DECISION_KINDS = [
  "approve_conditional_closeout",
  "reject_conditional_closeout",
  "abandon",
] as const;
export type OwnerDecisionKind = (typeof OWNER_DECISION_KINDS)[number];

export const CLOSEOUT_DISPOSITIONS = ["clean", "conditional", "abandoned"] as const;
export type CloseoutDisposition = (typeof CLOSEOUT_DISPOSITIONS)[number];

// ============================================================ object types

export interface Principal {
  schema_version: 1;
  principal_id: string;
  kind: PrincipalKind;
  display_name?: string;
  trust_domain: string;
}

export interface Mission {
  schema_version: 1;
  mission_id: string;
  created_by_principal_id: string;
  created_at: string;
  lifecycle_phase: MissionLifecyclePhase;
  attention_state: MissionAttentionState;
  pending_gate_ids?: string[];
  policy_hash: string;
}

export interface Actor {
  schema_version: 1;
  actor_id: string;
  principal_id: string;
  mission_id: string;
  role: ActorRole;
  session_id?: string;
  policy_hash: string;
  status: ActorStatus;
}

export interface AuthorizationGrant {
  capability: Capability;
  scope: AuthorizationGrantScope;
  risk_class: RiskClass;
}

export interface AuthorizationGrantScope {
  resource_types?: ResourceType[];
  mission_relation?: MissionRelation;
  approved_temp_root_ids?: string[];
  ownership_relation?: OwnershipRelation;
  cleanup_methods?: CleanupMethod[];
}

interface AuthorizationCommon {
  authorization_id: string;
  mission_id: string;
  granted_by_principal_id: string;
  granted_to_actor_id: string;
  delegation_depth_remaining: number;
  risk_ceiling: RiskCeiling;
  policy_hash_at_grant: string;
  expires_at: string;
  grants: AuthorizationGrant[];
  supersedes_authorization_id?: string | null;
}

export interface RootAuthorization extends AuthorizationCommon {
  authorization_kind: "root";
  granted_by_actor_id?: string | null;
  granted_under_authorization_id?: string | null;
  root_basis: RootBasis;
}

export interface DelegatedAuthorization extends AuthorizationCommon {
  authorization_kind: "delegated";
  granted_by_actor_id: string;
  granted_under_authorization_id: string;
  root_basis: null;
}

export type Authorization = RootAuthorization | DelegatedAuthorization;

interface ActionRequestCommon {
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

export interface ResourceTarget {
  entity_type: "resource";
  resource_id: string;
}

export interface MissionTarget {
  entity_type: "mission";
  mission_id: string;
}

export interface RegisterResourceAction extends ActionRequestCommon {
  capability: "register_resource";
  payload_kind: "register_resource";
  target: ResourceTarget;
}

export interface CreateManagedResourceAction extends ActionRequestCommon {
  capability: "create_managed_resource";
  payload_kind: "create_managed_resource";
  target: ResourceTarget;
}

export interface TerminateResourceAction extends ActionRequestCommon {
  capability: "terminate_resource";
  payload_kind: "terminate_resource";
  target: ResourceTarget;
}

export interface ReconcileResourceAction extends ActionRequestCommon {
  capability: "reconcile_resource";
  payload_kind: "reconcile_resource";
  target: ResourceTarget;
}

export interface CloseMissionAction extends ActionRequestCommon {
  capability: "close_mission";
  payload_kind: "close_mission";
  target: MissionTarget;
}

export type ActionRequest =
  | RegisterResourceAction
  | CreateManagedResourceAction
  | TerminateResourceAction
  | ReconcileResourceAction
  | CloseMissionAction;

export interface ActionAttempt {
  schema_version: 1;
  action_attempt_id: string;
  action_id: string;
  mission_id: string;
  attempt_number: number;
  started_at: string;
}

export interface PolicyDecision {
  schema_version: 1;
  policy_decision_id: string;
  action_id: string;
  action_attempt_id: string;
  mission_id: string;
  evaluation_point: EvaluationPoint;
  evaluation_sequence: number;
  result: PolicyDecisionResult;
  reason_codes?: string[];
  authorization_chain?: string[];
  evaluated_policy_hash: string;
  decided_at: string;
}

interface InitialOutcomeCommon {
  schema_version: 1;
  outcome_id: string;
  action_attempt_id: string;
  action_id: string;
  mission_id: string;
  action_payload_kind: ActionPayloadKind;
  status: InitialOutcomeStatus;
  evidence_ids?: string[];
  created_at: string;
}

export interface RegisterResourceInitialOutcome extends InitialOutcomeCommon {
  action_payload_kind: "register_resource";
  result_code: RegisterResourceOutcomeResultCode;
}

export interface CreateManagedResourceInitialOutcome extends InitialOutcomeCommon {
  action_payload_kind: "create_managed_resource";
  result_code: CreateManagedResourceOutcomeResultCode;
}

export interface TerminateResourceInitialOutcome extends InitialOutcomeCommon {
  action_payload_kind: "terminate_resource";
  result_code: TerminateResourceOutcomeResultCode;
}

export interface ReconcileResourceInitialOutcome extends InitialOutcomeCommon {
  action_payload_kind: "reconcile_resource";
  result_code: ReconcileResourceOutcomeResultCode;
}

export interface CloseMissionInitialOutcome extends InitialOutcomeCommon {
  action_payload_kind: "close_mission";
  result_code: CloseMissionOutcomeResultCode;
}

export type InitialOutcome =
  | RegisterResourceInitialOutcome
  | CreateManagedResourceInitialOutcome
  | TerminateResourceInitialOutcome
  | ReconcileResourceInitialOutcome
  | CloseMissionInitialOutcome;

export interface ReconciliationObservation {
  schema_version: 1;
  observation_id: string;
  action_attempt_id: string;
  action_id: string;
  mission_id: string;
  state: ReconciliationObservationState;
  reconciliation_action_id: string;
  reconciliation_actor_id: string;
  policy_decision_id: string;
  evidence_ids?: string[];
  observed_at: string;
}

export interface ReconciliationResolution {
  schema_version: 1;
  resolution_id: string;
  action_attempt_id: string;
  action_id: string;
  mission_id: string;
  resolution: ReconciliationResolutionKind;
  reconciliation_action_id: string;
  reconciliation_actor_id: string;
  policy_decision_id: string;
  evidence_ids?: string[];
  observed_at: string;
}

export interface Event {
  schema_version: 1;
  event_id: string;
  mission_id: string;
  sequence: number;
  event_type: EventType;
  principal_id?: string;
  actor_id?: string;
  action_id?: string;
  action_attempt_id?: string;
  policy_decision_id?: string;
  entity_type: EventEntityType;
  entity_id: string;
  caused_by?: {
    entity_type: EventCausedByEntityType;
    entity_id: string;
  };
  payload_ref: string;
  payload_digest: string;
  created_at: string;
}

interface ManagedResourceCommon {
  schema_version: 1;
  resource_id: string;
  mission_id: string;
  resource_type: ResourceType;
  ownership_origin: OwnershipOrigin;
  owned_by_actor_id: string;
  cleanup_owner_actor_id: string;
  registered_by_action_id: string;
  authorization_id: string;
  lifecycle_state: ResourceLifecycleState;
  verification_state: VerificationState;
  created_at: string;
  updated_at: string;
}

export interface PlannedResource extends ManagedResourceCommon {
  lifecycle_state: "planned";
  identity: null;
  identity_digest: null;
  cleanup_policy: null;
  verification_state: "unverified";
}

export interface ObservedProcessResource extends ManagedResourceCommon {
  resource_type: "process";
  identity: ProcessIdentity;
  identity_digest: string;
  cleanup_policy: ProcessCleanupPolicy;
  lifecycle_state: Exclude<ResourceLifecycleState, "planned">;
}

export interface ObservedTempDirectoryResource extends ManagedResourceCommon {
  resource_type: "temp_directory";
  identity: TempDirectoryIdentity;
  identity_digest: string;
  cleanup_policy: TempDirectoryCleanupPolicy;
  lifecycle_state: Exclude<ResourceLifecycleState, "planned">;
}

export type ManagedResource =
  | PlannedResource
  | ObservedProcessResource
  | ObservedTempDirectoryResource;

export interface ProcessIdentity {
  pid: number;
  pgid: number;
  start_time_seconds: number;
  start_time_microseconds: number;
  spawn_nonce?: string;
  executable: string;
  argv: string[];
  cwd: string;
  command_digest: string;
  dedicated_process_group: boolean;
}

export interface ProcessCleanupPolicy {
  termination_scope: TerminationScope;
  term_signal: TermSignal;
  grace_period_ms: number;
  allow_force_kill: boolean;
  force_signal: TermSignal;
}

export interface TempDirectoryIdentityCore {
  approved_temp_root_id: string;
  canonical_path: string;
  device_id: number;
  inode: number;
  owner_uid: number;
  creation_nonce: string;
}

export interface TempDirectoryIdentity {
  identity_core: TempDirectoryIdentityCore;
  identity_digest: string;
  marker_digest: string;
}

export interface TempDirectoryMarker {
  schema_version: 1;
  mission_id: string;
  resource_id: string;
  identity_digest: string;
  created_by_action_id: string;
}

export interface TempDirectoryCleanupPolicy {
  rename_strategy: RenameStrategy;
  delete_strategy: DeleteStrategy;
  quarantine_path_template?: string;
}

export interface Evidence {
  schema_version: 1;
  evidence_id: string;
  mission_id: string;
  source: {
    entity_type: EvidenceSourceEntityType;
    entity_id: string;
  };
  subject: {
    subject_type: EvidenceSubjectType;
    resource_id: string;
    identity_digest: string;
    action_attempt_id: string;
  };
  digest: string;
  produced_by_principal_id: string;
  produced_by_actor_id: string;
  created_at: string;
}

export interface OwnerDecision {
  schema_version: 1;
  owner_decision_id: string;
  mission_id: string;
  issued_by_principal_id: string;
  decision: OwnerDecisionKind;
  verified_through_sequence: number;
  resource_snapshot_digest: string;
  residual_resource_ids?: string[];
  created_at: string;
}

export interface ResidualResourceEntry {
  resource_id: string;
  lifecycle_state: ResourceLifecycleState;
  verification_state: VerificationState;
  residual_risk_statement: string;
  cleanup_owner_principal_id: string;
  evidence_ids: string[];
}

export interface CloseoutRecord {
  schema_version: 1;
  closeout_id: string;
  mission_id: string;
  disposition: CloseoutDisposition;
  verified_through_sequence: number;
  resource_snapshot_digest: string;
  residual_resources: ResidualResourceEntry[];
  owner_decision_id?: string;
  cleanup_owner_principal_id?: string;
  evidence_ids?: string[];
  created_at: string;
}
