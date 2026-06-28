import { createHash } from "node:crypto";
import { type Stats, lstat, readFile, realpath } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import {
  canonicalizeForDigest,
  computeSha256Digest,
  Foundation0ValidationError,
  validateDigest,
  validateId,
  validateTimestamp,
} from "./ids.ts";
import {
  appendFoundation0Event,
  foundation0StoragePaths,
  MissingPayloadError,
  PartialEventLogError,
  PayloadDigestMismatchError,
  readFoundation0EventPayload,
  readFoundation0Events,
} from "./event-append.ts";
import { MARKER_FILENAME } from "./temp-directory-creation.ts";
import {
  type ActionAttempt,
  type ApprovedTempRoot,
  type Event,
  type ObservedTempDirectoryResource,
  type PolicyDecision,
  type ReconcileResourceAction,
  type ResourceCreationPlan,
  type ResourceLifecycleState,
  type TempDirectoryIdentity,
  type TempDirectoryMarker,
} from "./schema.ts";
import {
  validateActionAttempt,
  validateObservedTempDirectoryResource,
  validatePolicyDecision,
  validateReconcileResourceAction,
  validateResourceCreationPlan,
  validateTempDirectoryIdentity,
  validateTempDirectoryMarker,
} from "./validation.ts";

export type TempDirectoryVerificationStatus =
  | "verified_active"
  | "planned_no_effect"
  | "missing_target"
  | "target_not_directory"
  | "target_symlink"
  | "marker_missing"
  | "marker_symlink"
  | "marker_parse_error"
  | "marker_mismatch"
  | "identity_mismatch"
  | "protected_path"
  | "unsupported_resource_state"
  | "missing_payload"
  | "payload_digest_mismatch"
  | "partial_event_log"
  | "unsupported_schema";

type NonVerifiedTempDirectoryStatus = Exclude<
  TempDirectoryVerificationStatus,
  "verified_active"
>;

export interface TempDirectoryResourceProjection {
  status:
    | "projected"
    | NonVerifiedTempDirectoryStatus;
  mission_id?: string;
  resource_id: string;
  latest_lifecycle_state?: ResourceLifecycleState;
  latest_resource?: ObservedTempDirectoryResource;
  plan?: ResourceCreationPlan;
  identity?: TempDirectoryIdentity;
  marker?: TempDirectoryMarker;
  identity_event_id?: string;
  activated_event_id?: string;
  created_outcome_event_id?: string;
  blocking_event_ids: string[];
}

export interface TempDirectoryVerificationInput {
  missionDir: string;
  repositoryRoot: string;
  currentWorkingDirectory: string;
  approvedTempRoots: ApprovedTempRoot[];
  resourceId: string;
}

export type TempDirectoryVerificationResult =
  | {
      status: "verified_active";
      projection: TempDirectoryResourceProjection;
      resource: ObservedTempDirectoryResource;
      identity: TempDirectoryIdentity;
      marker: TempDirectoryMarker;
      current_path: string;
    }
  | {
      status: NonVerifiedTempDirectoryStatus;
      projection: TempDirectoryResourceProjection;
      resource_id: string;
      reason: string;
      current_path?: string;
      blocking_event_ids: string[];
    };

export interface TempDirectoryReconciliationRequiredPayload {
  schema_version: 1;
  mission_id: string;
  resource_id: string;
  verification_status: NonVerifiedTempDirectoryStatus;
  identity_digest?: string;
  current_path?: string;
  blocking_event_ids: string[];
  observed_at: string;
}

export interface RecordTempDirectoryReconciliationInput {
  missionDir: string;
  verification: TempDirectoryVerificationResult;
  actionRequest: ReconcileResourceAction;
  actionAttempt: ActionAttempt;
  allowedDecision: PolicyDecision;
  reconciliationActorId: string;
  nowIso?: () => string;
}

export type TempDirectoryReconciliationRecordResult =
  | {
      result: "recorded";
      verification_status: NonVerifiedTempDirectoryStatus;
      events: Event[];
    }
  | {
      result: "idempotent_replay";
      verification_status: NonVerifiedTempDirectoryStatus;
      events: Event[];
    }
  | {
      result: "verified_active_noop";
      verification_status: "verified_active";
      events: [];
    }
  | {
      result: "partial_event_log_classified";
      verification_status: "partial_event_log";
      events: [];
    };

function errorStatus(error: unknown): NonVerifiedTempDirectoryStatus | undefined {
  if (error instanceof PartialEventLogError) return "partial_event_log";
  if (error instanceof MissingPayloadError) return "missing_payload";
  if (error instanceof PayloadDigestMismatchError) return "payload_digest_mismatch";
  if (error instanceof Foundation0ValidationError) return "unsupported_schema";
  return undefined;
}

function nonVerifiedProjection(
  resourceId: string,
  status: NonVerifiedTempDirectoryStatus,
  blockingEventIds: string[] = [],
): TempDirectoryResourceProjection {
  return {
    status,
    resource_id: resourceId,
    blocking_event_ids: blockingEventIds,
  };
}

function latestEvent(events: Event[], eventType: string): Event | undefined {
  return events.filter((event) => event.event_type === eventType).at(-1);
}

async function readPayload<T>(
  missionDir: string,
  event: Event,
  validate: (payload: unknown) => T,
): Promise<T> {
  return validate(await readFoundation0EventPayload(missionDir, event));
}

function validateIdentityObservation(payload: unknown): {
  identity: TempDirectoryIdentity;
  marker: TempDirectoryMarker;
} {
  if (
    typeof payload !== "object"
    || payload === null
    || !("identity" in payload)
    || !("marker" in payload)
  ) {
    throw new Foundation0ValidationError(
      "TempDirectoryIdentityObservation must include identity and marker",
    );
  }
  const record = payload as {
    identity: unknown;
    marker: unknown;
  };
  const marker = validateTempDirectoryMarker(record.marker);
  const identity = validateTempDirectoryIdentity(record.identity, { marker });
  return { identity, marker };
}

export async function readTempDirectoryResourceProjection(
  missionDir: string,
  resourceId: string,
): Promise<TempDirectoryResourceProjection> {
  validateId(resourceId, "readTempDirectoryResourceProjection.resourceId");
  let events: Event[];
  try {
    events = await readFoundation0Events(missionDir);
  } catch (error) {
    const status = errorStatus(error);
    if (status !== undefined) return nonVerifiedProjection(resourceId, status);
    throw error;
  }

  const resourceEvents = events.filter((event) => event.entity_id === resourceId);
  const planned = latestEvent(resourceEvents, "resource_planned");
  if (planned === undefined) {
    return nonVerifiedProjection(resourceId, "unsupported_resource_state");
  }

  let plan: ResourceCreationPlan;
  try {
    plan = await readPayload(
      missionDir,
      planned,
      validateResourceCreationPlan,
    );
  } catch (error) {
    const status = errorStatus(error);
    if (status !== undefined) return nonVerifiedProjection(resourceId, status, [planned.event_id]);
    throw error;
  }

  const activated = latestEvent(resourceEvents, "resource_activated");
  const identityObserved = latestEvent(resourceEvents, "resource_identity_observed");
  if (activated === undefined || identityObserved === undefined) {
    return {
      status: "planned_no_effect",
      mission_id: plan.mission_id,
      resource_id: resourceId,
      latest_lifecycle_state: "planned",
      plan,
      blocking_event_ids: [planned.event_id],
    };
  }

  let resource: ObservedTempDirectoryResource;
  let observation: {
    identity: TempDirectoryIdentity;
    marker: TempDirectoryMarker;
  };
  try {
    resource = await readPayload(
      missionDir,
      activated,
      validateObservedTempDirectoryResource,
    );
    observation = await readPayload(
      missionDir,
      identityObserved,
      validateIdentityObservation,
    );
  } catch (error) {
    const status = errorStatus(error);
    if (status !== undefined) {
      return nonVerifiedProjection(resourceId, status, [
        activated.event_id,
        identityObserved.event_id,
      ]);
    }
    throw error;
  }

  return {
    status: "projected",
    mission_id: resource.mission_id,
    resource_id: resourceId,
    latest_lifecycle_state: resource.lifecycle_state,
    latest_resource: resource,
    plan,
    identity: observation.identity,
    marker: observation.marker,
    identity_event_id: identityObserved.event_id,
    activated_event_id: activated.event_id,
    created_outcome_event_id: latestEvent(
      resourceEvents,
      "initial_outcome_recorded",
    )?.event_id,
    blocking_event_ids: [],
  };
}

function resultFromProjection(
  projection: TempDirectoryResourceProjection,
): TempDirectoryVerificationResult {
  const status = projection.status === "projected"
    ? "unsupported_resource_state"
    : projection.status;
  return {
    status,
    projection,
    resource_id: projection.resource_id,
    reason: status,
    blocking_event_ids: projection.blocking_event_ids,
  };
}

function samePath(left: string, right: string): boolean {
  return stripPath(left) === stripPath(right);
}

function stripPath(path: string): string {
  if (path === "/") return path;
  return path.replace(/\/+$/, "");
}

function isProtectedPath(path: string, protectedPaths: string[]): boolean {
  return protectedPaths.some((protectedPath) =>
    samePath(path, protectedPath) || isAncestorPath(protectedPath, path)
  );
}

function isAncestorPath(ancestor: string, child: string): boolean {
  const normalizedAncestor = stripPath(ancestor);
  const normalizedChild = stripPath(child);
  return normalizedChild.startsWith(`${normalizedAncestor}/`);
}

function isApprovedRootSafe(
  rootRealpath: string,
  protectedPaths: string[],
): boolean {
  return !protectedPaths.some((protectedPath) =>
    samePath(rootRealpath, protectedPath) || isAncestorPath(rootRealpath, protectedPath)
  );
}

async function normalizedExistingPaths(paths: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const path of paths) {
    try {
      out.push(await realpath(path));
    } catch {
      out.push(path);
    }
  }
  return out;
}

async function canonicalizeExpectedPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent = dirname(path);
    try {
      return join(await realpath(parent), basename(path));
    } catch {
      return path;
    }
  }
}

function findApprovedRoot(input: TempDirectoryVerificationInput, rootId: string): ApprovedTempRoot | undefined {
  return input.approvedTempRoots.find((root) => root.root_id === rootId);
}

function nonVerifiedResult(
  input: TempDirectoryVerificationInput,
  projection: TempDirectoryResourceProjection,
  status: NonVerifiedTempDirectoryStatus,
  currentPath?: string,
): TempDirectoryVerificationResult {
  return {
    status,
    projection,
    resource_id: input.resourceId,
    reason: status,
    current_path: currentPath,
    blocking_event_ids: projection.blocking_event_ids,
  };
}

export async function verifyManagedTempDirectory(
  input: TempDirectoryVerificationInput,
): Promise<TempDirectoryVerificationResult> {
  const projection = await readTempDirectoryResourceProjection(
    input.missionDir,
    input.resourceId,
  );
  if (projection.status !== "projected") {
    return resultFromProjection(projection);
  }
  if (
    projection.latest_resource === undefined
    || projection.identity === undefined
    || projection.marker === undefined
  ) {
    return nonVerifiedResult(input, projection, "unsupported_resource_state");
  }
  if (projection.latest_resource.lifecycle_state !== "active") {
    return nonVerifiedResult(input, projection, "unsupported_resource_state");
  }

  const identity = projection.identity;
  const expectedPath = identity.identity_core.canonical_path;
  const canonicalExpectedPath = await canonicalizeExpectedPath(expectedPath);
  const protectedPaths = await normalizedExistingPaths([
    input.missionDir,
    foundation0StoragePaths(input.missionDir).rootDir,
    input.repositoryRoot,
    input.currentWorkingDirectory,
  ]);
  if (isProtectedPath(canonicalExpectedPath, protectedPaths)) {
    return nonVerifiedResult(input, projection, "protected_path", canonicalExpectedPath);
  }

  const approvedRoot = findApprovedRoot(
    input,
    identity.identity_core.approved_temp_root_id,
  );
  if (approvedRoot === undefined) {
    return nonVerifiedResult(input, projection, "unsupported_resource_state", canonicalExpectedPath);
  }
  let rootRealpath: string;
  try {
    rootRealpath = await realpath(approvedRoot.path);
  } catch {
    return nonVerifiedResult(input, projection, "unsupported_resource_state", canonicalExpectedPath);
  }
  if (!isApprovedRootSafe(rootRealpath, protectedPaths)) {
    return nonVerifiedResult(input, projection, "unsupported_resource_state", canonicalExpectedPath);
  }
  if (
    !stripPath(canonicalExpectedPath).startsWith(`${stripPath(rootRealpath)}/`)
    && !samePath(canonicalExpectedPath, rootRealpath)
  ) {
    return nonVerifiedResult(input, projection, "identity_mismatch", canonicalExpectedPath);
  }

  let targetStats: Stats;
  try {
    targetStats = await lstat(expectedPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return nonVerifiedResult(input, projection, "missing_target", expectedPath);
    }
    throw error;
  }
  if (targetStats.isSymbolicLink()) {
    return nonVerifiedResult(input, projection, "target_symlink", expectedPath);
  }
  if (!targetStats.isDirectory()) {
    return nonVerifiedResult(input, projection, "target_not_directory", expectedPath);
  }

  const actualPath = await realpath(expectedPath);
  if (isProtectedPath(actualPath, protectedPaths)) {
    return nonVerifiedResult(input, projection, "protected_path", actualPath);
  }

  const markerPath = join(actualPath, MARKER_FILENAME);
  let markerStats: Stats;
  try {
    markerStats = await lstat(markerPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return nonVerifiedResult(input, projection, "marker_missing", actualPath);
    }
    throw error;
  }
  if (markerStats.isSymbolicLink()) {
    return nonVerifiedResult(input, projection, "marker_symlink", actualPath);
  }

  let marker: TempDirectoryMarker;
  try {
    marker = validateTempDirectoryMarker(
      JSON.parse(await readFile(markerPath, "utf8")),
    );
  } catch {
    return nonVerifiedResult(input, projection, "marker_parse_error", actualPath);
  }

  if (
    marker.mission_id !== projection.latest_resource.mission_id
    || marker.resource_id !== input.resourceId
    || marker.identity_digest !== identity.identity_digest
  ) {
    return nonVerifiedResult(input, projection, "marker_mismatch", actualPath);
  }

  const currentCore = {
    approved_temp_root_id: identity.identity_core.approved_temp_root_id,
    canonical_path: actualPath,
    device_id: targetStats.dev,
    inode: targetStats.ino,
    owner_uid: targetStats.uid,
    creation_nonce: identity.identity_core.creation_nonce,
  };
  const currentDigest = computeSha256Digest(currentCore);
  if (
    currentDigest !== identity.identity_digest
    || currentDigest !== marker.identity_digest
    || computeSha256Digest(marker) !== identity.marker_digest
  ) {
    return nonVerifiedResult(input, projection, "identity_mismatch", actualPath);
  }

  return {
    status: "verified_active",
    projection,
    resource: projection.latest_resource,
    identity,
    marker,
    current_path: actualPath,
  };
}

function requireSame(field: string, expected: string, actual: string): void {
  if (expected !== actual) {
    throw new Foundation0ValidationError(
      `${field} must match "${expected}", got "${actual}"`,
    );
  }
}

function validateReconciliationInput(
  input: RecordTempDirectoryReconciliationInput,
): {
  actionRequest: ReconcileResourceAction;
  actionAttempt: ActionAttempt;
  allowedDecision: PolicyDecision;
  status: NonVerifiedTempDirectoryStatus;
  resourceId: string;
  observedAt: string;
} {
  if (input.verification.status === "verified_active") {
    throw new Foundation0ValidationError(
      "verified_active does not require reconciliation_required",
    );
  }
  const actionRequest = validateReconcileResourceAction(input.actionRequest);
  const actionAttempt = validateActionAttempt(input.actionAttempt);
  const allowedDecision = validatePolicyDecision(input.allowedDecision);
  validateId(input.reconciliationActorId, "reconciliationActorId");
  requireSame("actionAttempt.mission_id", actionRequest.mission_id, actionAttempt.mission_id);
  requireSame("actionAttempt.action_id", actionRequest.action_id, actionAttempt.action_id);
  requireSame("allowedDecision.mission_id", actionRequest.mission_id, allowedDecision.mission_id);
  requireSame("allowedDecision.action_id", actionRequest.action_id, allowedDecision.action_id);
  requireSame(
    "allowedDecision.action_attempt_id",
    actionAttempt.action_attempt_id,
    allowedDecision.action_attempt_id,
  );
  requireSame(
    "actionRequest.target.resource_id",
    input.verification.resource_id,
    actionRequest.target.resource_id,
  );
  if (allowedDecision.evaluation_point !== "execution") {
    throw new Foundation0ValidationError(
      `allowedDecision.evaluation_point must be "execution", got "${allowedDecision.evaluation_point}"`,
    );
  }
  if (allowedDecision.result !== "allowed") {
    throw new Foundation0ValidationError(
      `allowedDecision.result must be "allowed", got "${allowedDecision.result}"`,
    );
  }
  const observedAt = validateTimestamp(
    (input.nowIso ?? (() => new Date().toISOString()))(),
    "recordTempDirectoryReconciliationRequired.observed_at",
  );
  return {
    actionRequest,
    actionAttempt,
    allowedDecision,
    status: input.verification.status,
    resourceId: input.verification.resource_id,
    observedAt,
  };
}

function eventAppendLockId(missionId: string): string {
  const hex = createHash("sha256")
    .update(canonicalizeForDigest({ scope: "t8_reconciliation", mission_id: missionId }))
    .digest("hex")
    .slice(0, 32);
  return validateId(`t8_reconcile_${hex}`, "eventAppendLockId");
}

function eventKey(baseKey: string, suffix: string): string {
  return `${baseKey}:${suffix}`;
}

async function existingReconciliationEvents(input: {
  missionDir: string;
  missionId: string;
  actionId: string;
  resourceId: string;
}): Promise<Event[] | null> {
  let events: Event[];
  try {
    events = await readFoundation0Events(input.missionDir);
  } catch {
    return null;
  }
  const out = events.filter((event) =>
    event.mission_id === input.missionId
    && event.action_id === input.actionId
    && (
      event.event_type === "action_requested"
      || event.event_type === "action_attempt_started"
      || event.event_type === "policy_decision_recorded"
      || (
        event.event_type === "reconciliation_required"
        && event.entity_id === input.resourceId
      )
    )
  );
  return out.length === 4 ? out : null;
}

export async function recordTempDirectoryReconciliationRequired(
  input: RecordTempDirectoryReconciliationInput,
): Promise<TempDirectoryReconciliationRecordResult> {
  if (input.verification.status === "verified_active") {
    return {
      result: "verified_active_noop",
      verification_status: "verified_active",
      events: [],
    };
  }
  if (input.verification.status === "partial_event_log") {
    return {
      result: "partial_event_log_classified",
      verification_status: "partial_event_log",
      events: [],
    };
  }
  const validated = validateReconciliationInput(input);
  const existing = await existingReconciliationEvents({
    missionDir: input.missionDir,
    missionId: validated.actionRequest.mission_id,
    actionId: validated.actionRequest.action_id,
    resourceId: validated.resourceId,
  });
  if (existing !== null) {
    return {
      result: "idempotent_replay",
      verification_status: validated.status,
      events: existing,
    };
  }

  const lockId = eventAppendLockId(validated.actionRequest.mission_id);
  const baseKey = validated.actionRequest.idempotency_key;
  const actionRequested = await appendFoundation0Event({
    missionDir: input.missionDir,
    missionId: validated.actionRequest.mission_id,
    eventType: "action_requested",
    entityType: "action",
    entityId: validated.actionRequest.action_id,
    payload: validated.actionRequest,
    actionId: validated.actionRequest.action_id,
    idempotencyKey: eventKey(baseKey, "action_requested"),
    lockId,
  });
  const attemptStarted = await appendFoundation0Event({
    missionDir: input.missionDir,
    missionId: validated.actionAttempt.mission_id,
    eventType: "action_attempt_started",
    entityType: "action",
    entityId: validated.actionAttempt.action_attempt_id,
    payload: validated.actionAttempt,
    actionId: validated.actionAttempt.action_id,
    actionAttemptId: validated.actionAttempt.action_attempt_id,
    idempotencyKey: eventKey(baseKey, "attempt_started"),
    lockId,
  });
  const policyDecisionRecorded = await appendFoundation0Event({
    missionDir: input.missionDir,
    missionId: validated.allowedDecision.mission_id,
    eventType: "policy_decision_recorded",
    entityType: "action",
    entityId: validated.allowedDecision.policy_decision_id,
    payload: validated.allowedDecision,
    actionId: validated.allowedDecision.action_id,
    actionAttemptId: validated.allowedDecision.action_attempt_id,
    policyDecisionId: validated.allowedDecision.policy_decision_id,
    idempotencyKey: eventKey(baseKey, "policy_decision"),
    lockId,
  });

  const payload: TempDirectoryReconciliationRequiredPayload = {
    schema_version: 1,
    mission_id: validated.actionRequest.mission_id,
    resource_id: validated.resourceId,
    verification_status: validated.status,
    blocking_event_ids: input.verification.blocking_event_ids,
    observed_at: validated.observedAt,
    ...(input.verification.current_path === undefined
      ? {}
      : { current_path: input.verification.current_path }),
    ...(input.verification.projection.identity === undefined
      ? {}
      : {
          identity_digest: validateDigest(
            input.verification.projection.identity.identity_digest,
            "TempDirectoryReconciliationRequiredPayload.identity_digest",
          ),
        }),
  };
  const reconciliationRequired = await appendFoundation0Event({
    missionDir: input.missionDir,
    missionId: validated.actionRequest.mission_id,
    eventType: "reconciliation_required",
    entityType: "resource",
    entityId: validated.resourceId,
    payload,
    actionId: validated.actionRequest.action_id,
    actionAttemptId: validated.actionAttempt.action_attempt_id,
    idempotencyKey: eventKey(baseKey, "reconciliation_required"),
    lockId,
  });

  return {
    result: "recorded",
    verification_status: validated.status,
    events: [
      actionRequested,
      attemptStarted,
      policyDecisionRecorded,
      reconciliationRequired,
    ],
  };
}
