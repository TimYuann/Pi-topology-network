import { computeSha256Digest } from "./ids.ts";
import type {
  PlannedResource,
  ProcessCleanupPolicy,
  ResourceCreationKind,
  ResourceCreationPlan,
  ResourceType,
  TempDirectoryCleanupPolicy,
} from "./schema.ts";
import { validateResourceCreationPlan } from "./validation.ts";
import { appendFoundation0Event } from "./event-append.ts";
import type { Event } from "./schema.ts";

export type ResourceCreationPlanCleanupPolicy =
  | ProcessCleanupPolicy
  | TempDirectoryCleanupPolicy;

export interface CreateResourceCreationPlanInput {
  planId: string;
  missionId: string;
  resourceId: string;
  resourceType: ResourceType;
  plannedResource: PlannedResource;
  cleanupPolicy: ResourceCreationPlanCleanupPolicy;
  creationKind: ResourceCreationKind;
  creationPayload: Record<string, unknown>;
  authorizationId: string;
  requestedByActionId: string;
  effectFingerprintHint?: string;
  createdAt: string;
}

export interface WriteResourceCreationPlanEventInput {
  missionDir: string;
  plan: ResourceCreationPlan;
  idempotencyKey?: string;
}

type FingerprintSource = Omit<ResourceCreationPlan, "schema_version" | "effect_fingerprint">;

function fingerprintSource(plan: ResourceCreationPlan): FingerprintSource {
  return {
    plan_id: plan.plan_id,
    mission_id: plan.mission_id,
    resource_id: plan.resource_id,
    resource_type: plan.resource_type,
    planned_resource: plan.planned_resource,
    cleanup_policy: plan.cleanup_policy,
    creation_kind: plan.creation_kind,
    creation_payload: plan.creation_payload,
    authorization_id: plan.authorization_id,
    requested_by_action_id: plan.requested_by_action_id,
    created_at: plan.created_at,
  };
}

export function computeResourceCreationPlanFingerprint(
  plan: ResourceCreationPlan,
): string {
  return computeSha256Digest(fingerprintSource(plan));
}

export function createResourceCreationPlan(
  input: CreateResourceCreationPlanInput,
): ResourceCreationPlan {
  const candidate = {
    schema_version: 1,
    plan_id: input.planId,
    mission_id: input.missionId,
    resource_id: input.resourceId,
    resource_type: input.resourceType,
    planned_resource: input.plannedResource,
    cleanup_policy: input.cleanupPolicy,
    creation_kind: input.creationKind,
    creation_payload: input.creationPayload,
    authorization_id: input.authorizationId,
    requested_by_action_id: input.requestedByActionId,
    effect_fingerprint: `sha256:${"0".repeat(64)}`,
    created_at: input.createdAt,
  } satisfies ResourceCreationPlan;
  const effect_fingerprint = computeResourceCreationPlanFingerprint(candidate);
  return validateResourceCreationPlan({
    ...candidate,
    effect_fingerprint,
  });
}

export async function writeResourceCreationPlanEvent(
  input: WriteResourceCreationPlanEventInput,
): Promise<Event> {
  const plan = validateResourceCreationPlan(input.plan);
  if (plan.effect_fingerprint !== computeResourceCreationPlanFingerprint(plan)) {
    throw new Error("ResourceCreationPlan.effect_fingerprint does not match canonical plan inputs");
  }
  return appendFoundation0Event({
    missionDir: input.missionDir,
    missionId: plan.mission_id,
    eventType: "resource_planned",
    entityType: "resource",
    entityId: plan.resource_id,
    payload: plan,
    idempotencyKey: input.idempotencyKey ?? plan.plan_id,
    lockId: `resource_creation_plan_${plan.plan_id}`,
  });
}
