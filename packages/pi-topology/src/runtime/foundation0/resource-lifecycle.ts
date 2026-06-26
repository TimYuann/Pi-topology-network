import { createHash } from "node:crypto";

import {
  DELETE_STRATEGIES,
  type ManagedResource,
  type PlannedResource,
  type ProcessCleanupPolicy,
  RENAME_STRATEGIES,
  type ResourceLifecycleState,
  type ResourceType,
  TERM_SIGNALS,
  type TempDirectoryCleanupPolicy,
  TERMINATION_SCOPES,
  type VerificationState,
} from "./schema.ts";
import { validateManagedResource, validatePlannedResource } from "./validation.ts";

export type ManagedResourceCleanupPolicy =
  | ProcessCleanupPolicy
  | TempDirectoryCleanupPolicy;

export interface TransitionManagedResourceOptions {
  to: ResourceLifecycleState;
  updatedAt: string;
  verificationState?: VerificationState;
  identity?: unknown;
  identityDigest?: string;
  cleanupPolicy?: ManagedResourceCleanupPolicy;
}

export interface PlannedResourceRegistration {
  resource: PlannedResource;
  cleanup_policy: ManagedResourceCleanupPolicy;
}

export interface CreatePlannedResourceRegistrationInput {
  resourceId: string;
  missionId: string;
  resourceType: ResourceType;
  ownershipOrigin: ManagedResource["ownership_origin"];
  ownedByActorId: string;
  cleanupOwnerActorId: string;
  registeredByActionId: string;
  authorizationId: string;
  cleanupPolicy: ManagedResourceCleanupPolicy;
  createdAt: string;
}

export interface AttachObservedIdentityOptions {
  identity: unknown;
  identityDigest: string;
  lifecycleState: "registered" | "active";
  observedAt: string;
  verificationState?: VerificationState;
}

export class ResourceLifecycleTransitionError extends Error {
  readonly from: ResourceLifecycleState;
  readonly to: ResourceLifecycleState;

  constructor(from: ResourceLifecycleState, to: ResourceLifecycleState, message?: string) {
    super(message ?? `Invalid ManagedResource lifecycle transition: ${from} -> ${to}`);
    this.name = "ResourceLifecycleTransitionError";
    this.from = from;
    this.to = to;
  }
}

export class CleanupInProgressError extends Error {
  readonly result = "cleanup_in_progress" as const;
  readonly resource_id: string;
  readonly identity_digest: string;
  readonly active_idempotency_key: string;

  constructor(input: {
    resourceId: string;
    identityDigest: string;
    activeIdempotencyKey: string;
  }) {
    super(
      `Cleanup already in progress for ${input.resourceId} / ${input.identityDigest}`,
    );
    this.name = "CleanupInProgressError";
    this.resource_id = input.resourceId;
    this.identity_digest = input.identityDigest;
    this.active_idempotency_key = input.activeIdempotencyKey;
  }
}

export class ResourceCleanupPolicyError extends Error {
  readonly resource_type: ResourceType;

  constructor(resourceType: ResourceType, message: string) {
    super(message);
    this.name = "ResourceCleanupPolicyError";
    this.resource_type = resourceType;
  }
}

const ALLOWED_TRANSITIONS: Record<ResourceLifecycleState, readonly ResourceLifecycleState[]> = {
  planned: ["registered", "abandoned"],
  registered: ["active", "abandoned"],
  active: ["stale", "cleanup_pending"],
  stale: ["cleanup_pending", "cleaned"],
  cleanup_pending: ["cleanup_attempted"],
  cleanup_attempted: ["cleaned", "cleanup_failed"],
  cleanup_failed: ["cleanup_pending"],
  cleaned: [],
  abandoned: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): boolean {
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  return requiredKeys.every((key) => key in value)
    && Object.keys(value).every((key) => allowed.has(key));
}

function includesValue<T extends string>(
  values: readonly T[],
  value: unknown,
): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function validateProcessCleanupPolicy(
  value: unknown,
): ProcessCleanupPolicy | undefined {
  if (!isRecord(value)) return undefined;
  if (
    !hasOnlyKeys(value, [
      "termination_scope",
      "term_signal",
      "grace_period_ms",
      "allow_force_kill",
      "force_signal",
    ])
  ) {
    return undefined;
  }
  if (
    !includesValue(TERMINATION_SCOPES, value.termination_scope) ||
    !includesValue(TERM_SIGNALS, value.term_signal) ||
    !Number.isSafeInteger(value.grace_period_ms) ||
    value.grace_period_ms < 0 ||
    typeof value.allow_force_kill !== "boolean" ||
    !includesValue(TERM_SIGNALS, value.force_signal)
  ) {
    return undefined;
  }
  return {
    termination_scope: value.termination_scope,
    term_signal: value.term_signal,
    grace_period_ms: value.grace_period_ms,
    allow_force_kill: value.allow_force_kill,
    force_signal: value.force_signal,
  };
}

function validateTempDirectoryCleanupPolicy(
  value: unknown,
): TempDirectoryCleanupPolicy | undefined {
  if (!isRecord(value)) return undefined;
  if (
    !hasOnlyKeys(value, ["rename_strategy", "delete_strategy"], [
      "quarantine_path_template",
    ])
  ) {
    return undefined;
  }
  if (
    !includesValue(RENAME_STRATEGIES, value.rename_strategy) ||
    !includesValue(DELETE_STRATEGIES, value.delete_strategy)
  ) {
    return undefined;
  }
  if (
    value.quarantine_path_template !== undefined &&
    typeof value.quarantine_path_template !== "string"
  ) {
    return undefined;
  }
  return {
    rename_strategy: value.rename_strategy,
    delete_strategy: value.delete_strategy,
    ...(value.quarantine_path_template === undefined
      ? {}
      : { quarantine_path_template: value.quarantine_path_template }),
  };
}

function validateCleanupPolicyForResourceType(
  resourceType: ResourceType,
  value: unknown,
): ManagedResourceCleanupPolicy {
  const policy = resourceType === "process"
    ? validateProcessCleanupPolicy(value)
    : validateTempDirectoryCleanupPolicy(value);
  if (policy === undefined) {
    throw new ResourceCleanupPolicyError(
      resourceType,
      `Cleanup policy does not match resource type ${resourceType}`,
    );
  }
  return policy;
}

function assertAllowedTransition(from: ResourceLifecycleState, to: ResourceLifecycleState): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new ResourceLifecycleTransitionError(from, to);
  }
}

function requireObservedFields(
  resource: ManagedResource,
  options: TransitionManagedResourceOptions,
): { identity: unknown; identityDigest: string; cleanupPolicy: ManagedResourceCleanupPolicy } {
  if (
    options.identity === undefined ||
    options.identityDigest === undefined ||
    options.cleanupPolicy === undefined
  ) {
    throw new ResourceLifecycleTransitionError(
      resource.lifecycle_state,
      options.to,
      `Transition ${resource.lifecycle_state} -> ${options.to} requires observed identity, identityDigest, and cleanupPolicy`,
    );
  }
  return {
    identity: options.identity,
    identityDigest: options.identityDigest,
    cleanupPolicy: options.cleanupPolicy,
  };
}

export function transitionManagedResource(
  resource: ManagedResource,
  options: TransitionManagedResourceOptions,
): ManagedResource {
  assertAllowedTransition(resource.lifecycle_state, options.to);
  const verification_state = options.verificationState ?? resource.verification_state;
  if (options.to === "abandoned") {
    return validateManagedResource({
      ...resource,
      lifecycle_state: "abandoned",
      identity: null,
      identity_digest: null,
      cleanup_policy: null,
      verification_state,
      updated_at: options.updatedAt,
    });
  }
  if (resource.lifecycle_state === "planned") {
    const observed = requireObservedFields(resource, options);
    return validateManagedResource({
      ...resource,
      lifecycle_state: options.to,
      identity: observed.identity,
      identity_digest: observed.identityDigest,
      cleanup_policy: observed.cleanupPolicy,
      verification_state,
      updated_at: options.updatedAt,
    });
  }
  return validateManagedResource({
    ...resource,
    lifecycle_state: options.to,
    verification_state,
    updated_at: options.updatedAt,
  });
}

export function createPlannedResourceRegistration(
  input: CreatePlannedResourceRegistrationInput,
): PlannedResourceRegistration {
  const cleanup_policy = validateCleanupPolicyForResourceType(
    input.resourceType,
    input.cleanupPolicy,
  );
  const resource = validatePlannedResource({
    schema_version: 1,
    resource_id: input.resourceId,
    mission_id: input.missionId,
    resource_type: input.resourceType,
    ownership_origin: input.ownershipOrigin,
    owned_by_actor_id: input.ownedByActorId,
    cleanup_owner_actor_id: input.cleanupOwnerActorId,
    registered_by_action_id: input.registeredByActionId,
    authorization_id: input.authorizationId,
    cleanup_policy: null,
    identity: null,
    identity_digest: null,
    lifecycle_state: "planned",
    verification_state: "unverified",
    created_at: input.createdAt,
    updated_at: input.createdAt,
  });
  return {
    resource,
    cleanup_policy,
  };
}

export function attachObservedIdentity(
  registration: PlannedResourceRegistration,
  options: AttachObservedIdentityOptions,
): ManagedResource {
  const registered = transitionManagedResource(registration.resource, {
    to: "registered",
    updatedAt: options.observedAt,
    identity: options.identity,
    identityDigest: options.identityDigest,
    cleanupPolicy: registration.cleanup_policy,
    verificationState: options.verificationState,
  });
  if (options.lifecycleState === "registered") return registered;
  return transitionManagedResource(registered, {
    to: "active",
    updatedAt: options.observedAt,
    verificationState: options.verificationState,
  });
}

export function abandonPlannedResource(
  resource: PlannedResource,
  options: { updatedAt: string },
): ManagedResource {
  return transitionManagedResource(resource, {
    to: "abandoned",
    updatedAt: options.updatedAt,
  });
}

export interface CleanupAttemptInput {
  resourceId: string;
  identityDigest: string;
  idempotencyKey: string;
}

export interface CleanupAttemptRecord {
  status: "acquired";
  attempt_id: string;
  resource_id: string;
  identity_digest: string;
  idempotency_key: string;
}

function cleanupAttemptKey(input: Pick<CleanupAttemptInput, "resourceId" | "identityDigest">): string {
  return `${input.resourceId}\n${input.identityDigest}`;
}

function cleanupAttemptId(input: CleanupAttemptInput): string {
  const hash = createHash("sha256")
    .update(`${input.resourceId}\n${input.identityDigest}\n${input.idempotencyKey}`)
    .digest("hex")
    .slice(0, 32);
  return `cleanup_${hash}`;
}

export class CleanupAttemptCoordinator {
  private readonly active = new Map<string, CleanupAttemptRecord>();

  acquire(input: CleanupAttemptInput): CleanupAttemptRecord {
    const key = cleanupAttemptKey(input);
    const existing = this.active.get(key);
    if (existing !== undefined) {
      if (existing.idempotency_key === input.idempotencyKey) return existing;
      throw new CleanupInProgressError({
        resourceId: input.resourceId,
        identityDigest: input.identityDigest,
        activeIdempotencyKey: existing.idempotency_key,
      });
    }
    const record: CleanupAttemptRecord = {
      status: "acquired",
      attempt_id: cleanupAttemptId(input),
      resource_id: input.resourceId,
      identity_digest: input.identityDigest,
      idempotency_key: input.idempotencyKey,
    };
    this.active.set(key, record);
    return record;
  }

  release(input: Pick<CleanupAttemptInput, "resourceId" | "identityDigest" | "idempotencyKey">): void {
    const key = cleanupAttemptKey(input);
    const existing = this.active.get(key);
    if (existing?.idempotency_key === input.idempotencyKey) {
      this.active.delete(key);
    }
  }
}
