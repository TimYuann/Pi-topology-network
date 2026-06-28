/**
 * Foundation-0 T6: Durable Cleanup-Attempt Acquisition.
 *
 * Provides a durable, replayable primitive that records intent to clean up a
 * (mission_id, resource_id, identity_digest) pair without performing any real
 * cleanup effect. Same idempotency key is idempotent. Different idempotency
 * key while an attempt is active returns `cleanup_in_progress` and records
 * the conflict policy decision without writing a second pending event.
 *
 * The active state is reconstructable from canonical Foundation-0 events
 * (`action_requested`, `action_attempt_started`, `policy_decision_recorded`,
 * `resource_cleanup_pending`); missing or digest-mismatched payloads for a
 * pending event are reported as `reconciliation_required` rather than
 * silently treated as a safe retry.
 */

import { createHash } from "node:crypto";
import { join } from "node:path";

import { type AcquiredLock, acquireLock } from "./lockfile.ts";
import {
  MissingPayloadError,
  PartialEventLogError,
  PayloadDigestMismatchError,
  type Event,
  type EventEntityType,
  appendFoundation0Event,
  foundation0StoragePaths,
  readFoundation0EventPayload,
  readFoundation0Events,
} from "./event-append.ts";
import {
  type ActionAttempt,
  type CleanupAttemptAcquisitionPayload,
  type PolicyDecision,
  type TerminateResourceAction,
} from "./schema.ts";
import {
  validateActionAttempt,
  validateCleanupAttemptAcquisitionPayload,
  validatePolicyDecision,
  validateTerminateResourceAction,
} from "./validation.ts";
import {
  canonicalizeForDigest,
  Foundation0ValidationError,
  validateDigest,
  validateId,
} from "./ids.ts";

/**
 * The active-attempt key — exactly what the first-slice contract (doc 20 §10)
 * defines as the unit of cleanup serialization.
 */
export interface CleanupAttemptKey {
  mission_id: string;
  resource_id: string;
  identity_digest: string;
}

export interface ActiveCleanupAttempt {
  mission_id: string;
  resource_id: string;
  identity_digest: string;
  idempotency_key: string;
  action_id: string;
  action_attempt_id: string;
  policy_decision_id: string;
  started_at: string;
  state: "active" | "reconciliation_required";
  blocking_event_ids: string[];
}

export type CleanupAttemptAcquisitionResult =
  | {
      result: "acquired";
      attempt: ActiveCleanupAttempt;
      events: Event[];
    }
  | {
      result: "idempotent_replay";
      attempt: ActiveCleanupAttempt;
      events: Event[];
    }
  | {
      result: "cleanup_in_progress";
      active_attempt: ActiveCleanupAttempt;
      policy_decision: PolicyDecision;
      events: Event[];
    }
  | {
      result: "reconciliation_required";
      attempt: ActiveCleanupAttempt;
      reason:
        | "missing_payload"
        | "payload_digest_mismatch"
        | "partial_event_log"
        | "crash_before_cleanup_pending"
        | "unsupported_schema";
      events: Event[];
    };

export interface AcquireCleanupAttemptInput {
  missionDir: string;
  actionRequest: TerminateResourceAction;
  actionAttempt: ActionAttempt;
  allowedDecision: PolicyDecision;
  cleanupInProgressDecision: PolicyDecision;
  resourceId: string;
  identityDigest: string;
  idempotencyKey?: string;
  lockTimeoutMs?: number;
  lockRetryDelayMs?: number;
  lockStaleMs?: number;
  nowIso?: () => string;
}

const CLEANUP_ATTEMPT_LOCK_FILENAME = "cleanup-attempt.lock";

function acquisitionLockPath(missionDir: string): string {
  return join(foundation0StoragePaths(missionDir).locksDir, CLEANUP_ATTEMPT_LOCK_FILENAME);
}

function cleanupAttemptLockId(
  scope: "acquisition" | "event_append",
  values: Record<string, string>,
): string {
  const hex = createHash("sha256")
    .update(canonicalizeForDigest({ scope, ...values }))
    .digest("hex")
    .slice(0, 32);
  return validateId(`cleanup_acq_${hex}`, "cleanupAttemptLockId");
}

function cleanupAttemptAcquisitionLockId(missionId: string, resourceId: string): string {
  return cleanupAttemptLockId("acquisition", {
    mission_id: missionId,
    resource_id: resourceId,
  });
}

function cleanupAttemptEventAppendLockId(missionId: string): string {
  return cleanupAttemptLockId("event_append", { mission_id: missionId });
}

function deriveIdempotencyKey(input: {
  missionId: string;
  resourceId: string;
  identityDigest: string;
  idempotencyKey: string;
}): string {
  return `cleanup_attempt:${input.missionId}:${input.resourceId}:${input.identityDigest}:${input.idempotencyKey}`;
}

function eventIdempotencyKeySuffix(
  scope: "action_requested" | "attempt_started" | "policy_decision" | "cleanup_pending",
  baseKey: string,
): string {
  return `${baseKey}:${scope}`;
}

function assertIdempotencyKey(value: string, fieldName: string): string {
  try {
    requireString(value, fieldName);
    return validateId(value, fieldName);
  } catch {
    throw new Foundation0ValidationError(`${fieldName} must be a Foundation-0 id`);
  }
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Foundation0ValidationError(`${fieldName} must be a non-empty string`);
  }
  return value;
}

function ensureSameMission(
  fieldName: string,
  expected: string,
  actual: string,
): void {
  if (expected !== actual) {
    throw new Foundation0ValidationError(
      `${fieldName} must match mission_id "${expected}", got "${actual}"`,
    );
  }
}

function ensureSameId(
  fieldName: string,
  expected: string,
  actual: string,
): void {
  if (expected !== actual) {
    throw new Foundation0ValidationError(
      `${fieldName} must match "${expected}", got "${actual}"`,
    );
  }
}

function reconciliationAttemptFromValidatedInput(
  validated: {
    actionRequest: TerminateResourceAction;
    actionAttempt: ActionAttempt;
    allowedDecision: PolicyDecision;
    idempotencyKey: string;
    resourceId: string;
    identityDigest: string;
  },
  state: ActiveCleanupAttempt["state"] = "reconciliation_required",
): ActiveCleanupAttempt {
  return {
    mission_id: validated.actionRequest.mission_id,
    resource_id: validated.resourceId,
    identity_digest: validated.identityDigest,
    idempotency_key: validated.idempotencyKey,
    action_id: validated.actionRequest.action_id,
    action_attempt_id: validated.actionAttempt.action_attempt_id,
    policy_decision_id: validated.allowedDecision.policy_decision_id,
    started_at: validated.actionAttempt.started_at,
    state,
    blocking_event_ids: [],
  };
}

/**
 * Validate the cross-field shape contract of the acquisition inputs. The
 * individual objects are validated against their first-slice validators; this
 * function enforces the cross-references listed in the task doc:
 *
 * - mission_id is consistent across action / attempt / decisions
 * - action_id is consistent across action / attempt / decisions
 * - action_attempt_id is consistent across attempt / decisions
 * - evaluation_point on both decisions is "execution"
 * - allowedDecision.result === "allowed"  (for the acquire path)
 * - cleanupInProgressDecision.result === "cleanup_in_progress"
 * - target.entity_type === "resource" and target.resource_id === resourceId
 * - identityDigest is a valid Foundation-0 digest
 */
function validateAcquisitionInput(input: AcquireCleanupAttemptInput): {
  actionRequest: TerminateResourceAction;
  actionAttempt: ActionAttempt;
  allowedDecision: PolicyDecision;
  cleanupInProgressDecision: PolicyDecision;
  idempotencyKey: string;
  resourceId: string;
  identityDigest: string;
} {
  const actionRequest = validateTerminateResourceAction(input.actionRequest);
  if (actionRequest.payload_kind !== "terminate_resource") {
    throw new Foundation0ValidationError(
      `actionRequest.payload_kind must be "terminate_resource", got "${actionRequest.payload_kind}"`,
    );
  }
  if (actionRequest.capability !== "terminate_resource") {
    throw new Foundation0ValidationError(
      `actionRequest.capability must be "terminate_resource", got "${actionRequest.capability}"`,
    );
  }
  if (actionRequest.target.entity_type !== "resource") {
    throw new Foundation0ValidationError(
      `actionRequest.target.entity_type must be "resource", got "${actionRequest.target.entity_type}"`,
    );
  }
  const resourceId = requireString(input.resourceId, "resourceId");
  ensureSameId(
    "actionRequest.target.resource_id",
    actionRequest.target.resource_id,
    resourceId,
  );

  const actionAttempt = validateActionAttempt(input.actionAttempt);
  ensureSameMission(
    "actionAttempt.mission_id",
    actionRequest.mission_id,
    actionAttempt.mission_id,
  );
  ensureSameId(
    "actionAttempt.action_id",
    actionRequest.action_id,
    actionAttempt.action_id,
  );

  const allowedDecision = validatePolicyDecision(input.allowedDecision);
  ensureSameMission(
    "allowedDecision.mission_id",
    actionRequest.mission_id,
    allowedDecision.mission_id,
  );
  ensureSameId(
    "allowedDecision.action_id",
    actionRequest.action_id,
    allowedDecision.action_id,
  );
  ensureSameId(
    "allowedDecision.action_attempt_id",
    actionAttempt.action_attempt_id,
    allowedDecision.action_attempt_id,
  );
  if (allowedDecision.evaluation_point !== "execution") {
    throw new Foundation0ValidationError(
      `allowedDecision.evaluation_point must be "execution", got "${allowedDecision.evaluation_point}"`,
    );
  }
  if (allowedDecision.result !== "allowed") {
    throw new Foundation0ValidationError(
      `allowedDecision.result must be "allowed" for acquisition, got "${allowedDecision.result}"`,
    );
  }

  const cleanupInProgressDecision = validatePolicyDecision(
    input.cleanupInProgressDecision,
  );
  ensureSameMission(
    "cleanupInProgressDecision.mission_id",
    actionRequest.mission_id,
    cleanupInProgressDecision.mission_id,
  );
  ensureSameId(
    "cleanupInProgressDecision.action_id",
    actionRequest.action_id,
    cleanupInProgressDecision.action_id,
  );
  ensureSameId(
    "cleanupInProgressDecision.action_attempt_id",
    actionAttempt.action_attempt_id,
    cleanupInProgressDecision.action_attempt_id,
  );
  if (cleanupInProgressDecision.evaluation_point !== "execution") {
    throw new Foundation0ValidationError(
      `cleanupInProgressDecision.evaluation_point must be "execution", got "${cleanupInProgressDecision.evaluation_point}"`,
    );
  }
  if (cleanupInProgressDecision.result !== "cleanup_in_progress") {
    throw new Foundation0ValidationError(
      `cleanupInProgressDecision.result must be "cleanup_in_progress" for conflict recording, got "${cleanupInProgressDecision.result}"`,
    );
  }

  const identityDigest = validateDigest(
    input.identityDigest,
    "identityDigest",
  );
  const idempotencyKey = assertIdempotencyKey(
    input.idempotencyKey ?? actionRequest.idempotency_key,
    "idempotencyKey",
  );

  return {
    actionRequest,
    actionAttempt,
    allowedDecision,
    cleanupInProgressDecision,
    idempotencyKey,
    resourceId,
    identityDigest,
  };
}

interface ProjectedAttempt {
  attempt: ActiveCleanupAttempt;
  pendingEvent?: Event;
  reason?:
    | "missing_payload"
    | "payload_digest_mismatch"
    | "unsupported_schema"
    | "crash_before_cleanup_pending";
}

interface PrePendingCandidate {
  action: TerminateResourceAction;
  actionEvent: Event;
  attempt: ActionAttempt;
  attemptEvent: Event;
  decision: PolicyDecision;
  decisionEvent: Event;
}

function reconciliationAttemptFromCandidate(
  candidate: PrePendingCandidate,
  key: CleanupAttemptKey,
): ActiveCleanupAttempt {
  return {
    mission_id: key.mission_id,
    resource_id: key.resource_id,
    identity_digest: key.identity_digest,
    idempotency_key: candidate.action.idempotency_key,
    action_id: candidate.action.action_id,
    action_attempt_id: candidate.attempt.action_attempt_id,
    policy_decision_id: candidate.decision.policy_decision_id,
    started_at: candidate.attempt.started_at,
    state: "reconciliation_required",
    blocking_event_ids: [
      candidate.actionEvent.event_id,
      candidate.attemptEvent.event_id,
      candidate.decisionEvent.event_id,
    ],
  };
}

async function readValidatedTerminateActionPayload(
  missionDir: string,
  event: Event,
): Promise<TerminateResourceAction | null> {
  try {
    return validateTerminateResourceAction(
      await readFoundation0EventPayload(missionDir, event),
    );
  } catch {
    return null;
  }
}

async function readValidatedActionAttemptPayload(
  missionDir: string,
  event: Event,
): Promise<ActionAttempt | null> {
  try {
    return validateActionAttempt(await readFoundation0EventPayload(missionDir, event));
  } catch {
    return null;
  }
}

async function readValidatedPolicyDecisionPayload(
  missionDir: string,
  event: Event,
): Promise<PolicyDecision | null> {
  try {
    return validatePolicyDecision(await readFoundation0EventPayload(missionDir, event));
  } catch {
    return null;
  }
}

async function projectCrashBeforePendingAttempt(
  missionDir: string,
  events: Event[],
  key: CleanupAttemptKey,
): Promise<ProjectedAttempt | null> {
  const pendingAttemptIds = new Set(
    events
      .filter((event) => event.event_type === "resource_cleanup_pending")
      .map((event) => event.action_attempt_id)
      .filter((value): value is string => value !== undefined),
  );
  const actionById = new Map<string, { action: TerminateResourceAction; event: Event }>();
  const attemptById = new Map<string, { attempt: ActionAttempt; event: Event }>();
  const allowedDecisionByAttemptId = new Map<string, { decision: PolicyDecision; event: Event }>();

  for (const event of events) {
    if (event.mission_id !== key.mission_id) continue;
    if (event.event_type === "action_requested") {
      const action = await readValidatedTerminateActionPayload(missionDir, event);
      if (action === null) continue;
      if (action.target.resource_id !== key.resource_id) continue;
      actionById.set(action.action_id, { action, event });
      continue;
    }
    if (event.event_type === "action_attempt_started") {
      const attempt = await readValidatedActionAttemptPayload(missionDir, event);
      if (attempt === null) continue;
      attemptById.set(attempt.action_attempt_id, { attempt, event });
      continue;
    }
    if (event.event_type === "policy_decision_recorded") {
      const decision = await readValidatedPolicyDecisionPayload(missionDir, event);
      if (decision === null) continue;
      if (decision.evaluation_point !== "execution" || decision.result !== "allowed") continue;
      allowedDecisionByAttemptId.set(decision.action_attempt_id, { decision, event });
    }
  }

  let latest: ProjectedAttempt | null = null;
  for (const { attempt, event: attemptEvent } of attemptById.values()) {
    if (pendingAttemptIds.has(attempt.action_attempt_id)) continue;
    const actionEntry = actionById.get(attempt.action_id);
    const decisionEntry = allowedDecisionByAttemptId.get(attempt.action_attempt_id);
    if (actionEntry === undefined || decisionEntry === undefined) continue;
    if (decisionEntry.decision.action_id !== attempt.action_id) continue;
    // This boundary is deliberately conservative: without a
    // resource_cleanup_pending payload, the durable log lacks the exact
    // identity_digest binding for the in-flight cleanup intent. A later
    // caller may be asking for the same identity pair, but replay cannot
    // prove that safely, so acquisition is blocked for reconciliation instead
    // of writing a second pending event.
    const candidate: PrePendingCandidate = {
      action: actionEntry.action,
      actionEvent: actionEntry.event,
      attempt,
      attemptEvent,
      decision: decisionEntry.decision,
      decisionEvent: decisionEntry.event,
    };
    latest = {
      attempt: reconciliationAttemptFromCandidate(candidate, key),
      reason: "crash_before_cleanup_pending",
    };
  }

  return latest;
}

/**
 * Reconstruct the active attempts for a single (mission_id, resource_id,
 * identity_digest) key from canonical events. Returns the most recent
 * `resource_cleanup_pending` event's projection, including a
 * `reconciliation_required` reason if the backing payload is missing or
 * digest-mismatched.
 */
async function projectActiveAttempt(
  missionDir: string,
  key: CleanupAttemptKey,
): Promise<ProjectedAttempt | null> {
  const events = await readFoundation0Events(missionDir);

  let latest: ProjectedAttempt | null = null;

  for (const event of events) {
    if (event.event_type !== "resource_cleanup_pending") continue;
    if (event.mission_id !== key.mission_id) continue;
    if (event.entity_id !== key.resource_id) continue;
    if (event.action_id === undefined) continue;

    let payload: unknown;
    try {
      payload = await readFoundation0EventPayload(missionDir, event);
    } catch (error) {
      if (error instanceof MissingPayloadError) {
        const attempt: ActiveCleanupAttempt = {
          mission_id: key.mission_id,
          resource_id: key.resource_id,
          identity_digest: key.identity_digest,
          idempotency_key: "",
          action_id: event.action_id ?? "",
          action_attempt_id: event.action_attempt_id ?? "",
          policy_decision_id: event.policy_decision_id ?? "",
          started_at: event.created_at,
          state: "reconciliation_required",
          blocking_event_ids: [event.event_id],
        };
        latest = {
          attempt,
          pendingEvent: event,
          reason: "missing_payload",
        };
        continue;
      }
      if (error instanceof PayloadDigestMismatchError) {
        const attempt: ActiveCleanupAttempt = {
          mission_id: key.mission_id,
          resource_id: key.resource_id,
          identity_digest: key.identity_digest,
          idempotency_key: "",
          action_id: event.action_id ?? "",
          action_attempt_id: event.action_attempt_id ?? "",
          policy_decision_id: event.policy_decision_id ?? "",
          started_at: event.created_at,
          state: "reconciliation_required",
          blocking_event_ids: [event.event_id],
        };
        latest = {
          attempt,
          pendingEvent: event,
          reason: "payload_digest_mismatch",
        };
        continue;
      }
      throw error;
    }

    let acquisition: CleanupAttemptAcquisitionPayload;
    try {
      acquisition = validateCleanupAttemptAcquisitionPayload(payload);
    } catch {
      const attempt: ActiveCleanupAttempt = {
        mission_id: key.mission_id,
        resource_id: key.resource_id,
        identity_digest: key.identity_digest,
        idempotency_key: "",
        action_id: event.action_id ?? "",
        action_attempt_id: event.action_attempt_id ?? "",
        policy_decision_id: event.policy_decision_id ?? "",
        started_at: event.created_at,
        state: "reconciliation_required",
        blocking_event_ids: [event.event_id],
      };
      latest = {
        attempt,
        pendingEvent: event,
        reason: "unsupported_schema",
      };
      continue;
    }

    if (acquisition.identity_digest !== key.identity_digest) continue;

    latest = {
      attempt: {
        mission_id: acquisition.mission_id,
        resource_id: acquisition.resource_id,
        identity_digest: acquisition.identity_digest,
        idempotency_key: acquisition.idempotency_key,
        action_id: acquisition.action_id,
        action_attempt_id: acquisition.action_attempt_id,
        policy_decision_id: acquisition.policy_decision_id,
        started_at: acquisition.acquired_at,
        state: "active",
        blocking_event_ids: [event.event_id],
      },
      pendingEvent: event,
    };
  }

  if (latest !== null) return latest;
  return projectCrashBeforePendingAttempt(missionDir, events, key);
}

async function appendAcquisitionEvents(
  input: {
    missionDir: string;
    actionRequest: TerminateResourceAction;
    actionAttempt: ActionAttempt;
    allowedDecision: PolicyDecision;
    acquisition: CleanupAttemptAcquisitionPayload;
    baseIdempotencyKey: string;
  },
): Promise<{
  actionRequested: Event;
  attemptStarted: Event;
  policyDecisionRecorded: Event;
  cleanupPending: Event;
}> {
  const { missionDir, actionRequest, actionAttempt, allowedDecision, acquisition, baseIdempotencyKey } = input;
  const lockId = cleanupAttemptEventAppendLockId(actionRequest.mission_id);
  const actionRequested = await appendFoundation0Event({
    missionDir,
    missionId: actionRequest.mission_id,
    eventType: "action_requested",
    entityType: "action",
    entityId: actionRequest.action_id,
    payload: actionRequest,
    actionId: actionRequest.action_id,
    idempotencyKey: eventIdempotencyKeySuffix("action_requested", baseIdempotencyKey),
    lockId,
  });
  const attemptStarted = await appendFoundation0Event({
    missionDir,
    missionId: actionAttempt.mission_id,
    eventType: "action_attempt_started",
    entityType: "action",
    entityId: actionAttempt.action_attempt_id,
    payload: actionAttempt,
    actionId: actionAttempt.action_id,
    actionAttemptId: actionAttempt.action_attempt_id,
    idempotencyKey: eventIdempotencyKeySuffix("attempt_started", baseIdempotencyKey),
    lockId,
  });
  const policyDecisionRecorded = await appendFoundation0Event({
    missionDir,
    missionId: allowedDecision.mission_id,
    eventType: "policy_decision_recorded",
    entityType: "action",
    entityId: allowedDecision.policy_decision_id,
    payload: allowedDecision,
    actionId: allowedDecision.action_id,
    actionAttemptId: allowedDecision.action_attempt_id,
    policyDecisionId: allowedDecision.policy_decision_id,
    idempotencyKey: eventIdempotencyKeySuffix("policy_decision", baseIdempotencyKey),
    lockId,
  });
  const cleanupPending = await appendFoundation0Event({
    missionDir,
    missionId: acquisition.mission_id,
    eventType: "resource_cleanup_pending",
    entityType: "resource" satisfies EventEntityType,
    entityId: acquisition.resource_id,
    payload: acquisition,
    actionId: acquisition.action_id,
    actionAttemptId: acquisition.action_attempt_id,
    policyDecisionId: acquisition.policy_decision_id,
    idempotencyKey: eventIdempotencyKeySuffix("cleanup_pending", baseIdempotencyKey),
    lockId,
  });
  return { actionRequested, attemptStarted, policyDecisionRecorded, cleanupPending };
};

export async function acquireCleanupAttempt(
  input: AcquireCleanupAttemptInput,
): Promise<CleanupAttemptAcquisitionResult> {
  const validated = validateAcquisitionInput(input);
  const now = input.nowIso ?? (() => new Date().toISOString());
  const baseIdempotencyKey = deriveIdempotencyKey({
    missionId: validated.actionRequest.mission_id,
    resourceId: validated.resourceId,
    identityDigest: validated.identityDigest,
    idempotencyKey: validated.idempotencyKey,
  });

  const lockPath = acquisitionLockPath(input.missionDir);
  const lock: AcquiredLock = await acquireLock(lockPath, {
    lockId: cleanupAttemptAcquisitionLockId(
      validated.actionRequest.mission_id,
      validated.resourceId,
    ),
    missionId: validated.actionRequest.mission_id,
    purpose: "cleanup_attempt_acquisition",
    timeoutMs: input.lockTimeoutMs ?? 5_000,
    retryDelayMs: input.lockRetryDelayMs ?? 10,
    staleMs: input.lockStaleMs ?? 60_000,
  });

  try {
    const key: CleanupAttemptKey = {
      mission_id: validated.actionRequest.mission_id,
      resource_id: validated.resourceId,
      identity_digest: validated.identityDigest,
    };
    let existing: ProjectedAttempt | null;
    try {
      existing = await projectActiveAttempt(input.missionDir, key);
    } catch (error) {
      if (error instanceof PartialEventLogError) {
        return {
          result: "reconciliation_required",
          attempt: reconciliationAttemptFromValidatedInput(validated),
          reason: "partial_event_log",
          events: [],
        };
      }
      throw error;
    }

    if (existing !== null) {
      if (existing.attempt.state === "reconciliation_required") {
        const reason = existing.reason ?? "partial_event_log";
        const fallbackAttempt: ActiveCleanupAttempt = {
          ...existing.attempt,
          idempotency_key: validated.idempotencyKey,
        };
        return {
          result: "reconciliation_required",
          attempt: fallbackAttempt,
          reason,
          events: [],
        };
      }
      if (existing.attempt.idempotency_key === validated.idempotencyKey) {
        return {
          result: "idempotent_replay",
          attempt: existing.attempt,
          events: [],
        };
      }
      // Active attempt exists with a different idempotency key. Record the
      // conflict policy decision but do not write a second pending event.
      const conflictEvent = await appendFoundation0Event({
        missionDir: input.missionDir,
        missionId: validated.cleanupInProgressDecision.mission_id,
        eventType: "policy_decision_recorded",
        entityType: "action",
        entityId: validated.cleanupInProgressDecision.policy_decision_id,
        payload: validated.cleanupInProgressDecision,
        actionId: validated.cleanupInProgressDecision.action_id,
        actionAttemptId: validated.cleanupInProgressDecision.action_attempt_id,
        policyDecisionId: validated.cleanupInProgressDecision.policy_decision_id,
        idempotencyKey: `cleanup_attempt:${validated.actionRequest.mission_id}:${validated.resourceId}:${validated.identityDigest}:${validated.idempotencyKey}:conflict_policy_decision`,
        lockId: cleanupAttemptEventAppendLockId(validated.actionRequest.mission_id),
      });
      return {
        result: "cleanup_in_progress",
        active_attempt: existing.attempt,
        policy_decision: validated.cleanupInProgressDecision,
        events: [conflictEvent],
      };
    }

    const acquiredAt = now();
    const acquisition: CleanupAttemptAcquisitionPayload = {
      schema_version: 1,
      mission_id: validated.actionRequest.mission_id,
      resource_id: validated.resourceId,
      identity_digest: validated.identityDigest,
      idempotency_key: validated.idempotencyKey,
      action_id: validated.actionRequest.action_id,
      action_attempt_id: validated.actionAttempt.action_attempt_id,
      policy_decision_id: validated.allowedDecision.policy_decision_id,
      acquired_at: acquiredAt,
    };

    const { actionRequested, attemptStarted, policyDecisionRecorded, cleanupPending } =
      await appendAcquisitionEvents({
        missionDir: input.missionDir,
        actionRequest: validated.actionRequest,
        actionAttempt: validated.actionAttempt,
        allowedDecision: validated.allowedDecision,
        acquisition,
        baseIdempotencyKey,
      });

    const attempt: ActiveCleanupAttempt = {
      mission_id: acquisition.mission_id,
      resource_id: acquisition.resource_id,
      identity_digest: acquisition.identity_digest,
      idempotency_key: acquisition.idempotency_key,
      action_id: acquisition.action_id,
      action_attempt_id: acquisition.action_attempt_id,
      policy_decision_id: acquisition.policy_decision_id,
      started_at: acquisition.acquired_at,
      state: "active",
      blocking_event_ids: [
        actionRequested.event_id,
        attemptStarted.event_id,
        policyDecisionRecorded.event_id,
        cleanupPending.event_id,
      ],
    };

    return {
      result: "acquired",
      attempt,
      events: [actionRequested, attemptStarted, policyDecisionRecorded, cleanupPending],
    };
  } finally {
    await lock.release();
  }
}

/**
 * Reconstruct the active cleanup attempts in a mission by replaying the
 * canonical event log. This is the projection used by the lock-free
 * inspection path; it does not require holding the cleanup-attempt lock.
 *
 * Only attempts whose `resource_cleanup_pending` payload identity_digest
 * matches the canonical key are returned. Attempts with missing or
 * digest-mismatched payloads are surfaced with `state: "reconciliation_required"`
 * so callers can route them to reconciliation rather than retry blindly.
 */
export async function readActiveCleanupAttempts(
  missionDir: string,
): Promise<ActiveCleanupAttempt[]> {
  const events = await readFoundation0Events(missionDir);
  const byKey = new Map<string, ActiveCleanupAttempt>();

  for (const event of events) {
    if (event.event_type !== "resource_cleanup_pending") continue;

    let payload: unknown;
    try {
      payload = await readFoundation0EventPayload(missionDir, event);
    } catch (error) {
      if (error instanceof MissingPayloadError) {
        const key = projectionKey(event, "");
        byKey.set(key, {
          mission_id: event.mission_id,
          resource_id: event.entity_id,
          identity_digest: "",
          idempotency_key: "",
          action_id: event.action_id ?? "",
          action_attempt_id: event.action_attempt_id ?? "",
          policy_decision_id: event.policy_decision_id ?? "",
          started_at: event.created_at,
          state: "reconciliation_required",
          blocking_event_ids: [event.event_id],
        });
        continue;
      }
      if (error instanceof PayloadDigestMismatchError) {
        const key = projectionKey(event, "");
        byKey.set(key, {
          mission_id: event.mission_id,
          resource_id: event.entity_id,
          identity_digest: "",
          idempotency_key: "",
          action_id: event.action_id ?? "",
          action_attempt_id: event.action_attempt_id ?? "",
          policy_decision_id: event.policy_decision_id ?? "",
          started_at: event.created_at,
          state: "reconciliation_required",
          blocking_event_ids: [event.event_id],
        });
        continue;
      }
      throw error;
    }

    let acquisition: CleanupAttemptAcquisitionPayload;
    try {
      acquisition = validateCleanupAttemptAcquisitionPayload(payload);
    } catch {
      const key = projectionKey(event, "");
      byKey.set(key, {
        mission_id: event.mission_id,
        resource_id: event.entity_id,
        identity_digest: "",
        idempotency_key: "",
        action_id: event.action_id ?? "",
        action_attempt_id: event.action_attempt_id ?? "",
        policy_decision_id: event.policy_decision_id ?? "",
        started_at: event.created_at,
        state: "reconciliation_required",
        blocking_event_ids: [event.event_id],
      });
      continue;
    }

    const key = projectionKey(event, acquisition.identity_digest);
    byKey.set(key, {
      mission_id: acquisition.mission_id,
      resource_id: acquisition.resource_id,
      identity_digest: acquisition.identity_digest,
      idempotency_key: acquisition.idempotency_key,
      action_id: acquisition.action_id,
      action_attempt_id: acquisition.action_attempt_id,
      policy_decision_id: acquisition.policy_decision_id,
      started_at: acquisition.acquired_at,
      state: "active",
      blocking_event_ids: [event.event_id],
    });
  }

  return Array.from(byKey.values());
}

function projectionKey(event: Event, identityDigest: string): string {
  return `${event.mission_id}\n${event.entity_id}\n${identityDigest}`;
}
