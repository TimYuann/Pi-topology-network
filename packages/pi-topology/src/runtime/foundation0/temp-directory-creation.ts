/**
 * Foundation-0 T7: Temp-Directory Creation, Identity, and Marker.
 *
 * Implements the narrow creation path for managed temp directories:
 *
 * 1. Validate the approved temp root registry and resolve its realpath.
 * 2. Validate and build the target path under the resolved root.
 * 3. Durably append `action_requested`, `action_attempt_started`,
 *    `policy_decision_recorded`, `resource_planned`.
 * 4. Create exactly one managed directory under the resolved root.
 * 5. Write and verify `.pi-topology-resource.json` inside it.
 * 6. Compute `TempDirectoryIdentity` from lstat + creation_nonce + marker.
 * 7. Durably append `resource_identity_observed`, `resource_registered`,
 *    `resource_activated`, `initial_outcome_recorded`.
 *
 * T7 MUST NOT delete, unlink, recursively remove, rename managed temp
 * directories, spawn processes, signal processes, integrate with v0.5
 * runtime, Ghostty, Pi topology spawn, or dogfood. Reconciliation is
 * triggered when crash / marker mismatch / payload corruption makes a
 * second creation unsafe.
 */
import { createHash, randomUUID } from "node:crypto";
import { lstat as lstatAsync, mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { canonicalizeForDigest, computeSha256Digest, Foundation0ValidationError, validateId } from "./ids.ts";
import {
  type ActionAttempt,
  type ApprovedTempRoot,
  type ApprovedTempRootRegistry,
  type CreateManagedResourceAction,
  type CreateManagedResourceInitialOutcome,
  type Event,
  type EventEntityType,
  type ObservedTempDirectoryResource,
  type PolicyDecision,
  type ResolvedApprovedTempRoot,
  type ResourceCreationPlan,
  type TempDirectoryCleanupPolicy,
  type TempDirectoryCreationPayload,
  type TempDirectoryIdentity,
  type TempDirectoryIdentityObservation,
  type TempDirectoryMarker,
} from "./schema.ts";
import {
  validateActionAttempt,
  validateApprovedTempRoot,
  validateCreateManagedResourceAction,
  validateObservedTempDirectoryResource,
  validatePolicyDecision,
  validateTempDirectoryCreationPayload,
  validateTempDirectoryIdentity,
  validateTempDirectoryMarker,
} from "./validation.ts";
import {
  computeResourceCreationPlanFingerprint,
} from "./resource-creation-plan.ts";
import {
  appendFoundation0Event,
  foundation0StoragePaths,
  MissingPayloadError,
  PartialEventLogError,
  PayloadDigestMismatchError,
  readFoundation0EventPayload,
  readFoundation0Events,
} from "./event-append.ts";
import { fsyncFile, fsyncDirectory, unlinkIfExists, writeDurableFile } from "./durable-fs.ts";

// ============================================================ errors

export class TempDirectoryCreationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "TempDirectoryCreationError";
    this.code = code;
  }
}

export class ApprovedTempRootResolutionError extends TempDirectoryCreationError {
  readonly root_id: string;
  constructor(root_id: string, message: string) {
    super("approved_temp_root_unresolved", message);
    this.name = "ApprovedTempRootResolutionError";
    this.root_id = root_id;
  }
}

export class ProtectedPathError extends TempDirectoryCreationError {
  readonly path: string;
  constructor(path: string, message: string) {
    super("protected_path", message);
    this.name = "ProtectedPathError";
    this.path = path;
  }
}

export class InvalidTargetPathError extends TempDirectoryCreationError {
  readonly path: string;
  constructor(path: string, message: string) {
    super("invalid_target_path", message);
    this.name = "InvalidTargetPathError";
    this.path = path;
  }
}

// ============================================================ approved root resolution

export interface ResolveApprovedTempRootOptions {
  lstat?: (path: string) => Promise<{
    isSymbolicLink(): boolean;
    isDirectory(): boolean;
  }>;
  realpath?: (path: string) => Promise<string>;
}

export interface ResolveApprovedTempRootInput {
  registry: ApprovedTempRoot[];
  root_id: string;
  protected_realpaths: string[];
  options?: ResolveApprovedTempRootOptions;
}

export async function resolveApprovedTempRoot(
  input: ResolveApprovedTempRootInput,
): Promise<ResolvedApprovedTempRoot> {
  validateId(input.root_id, "resolveApprovedTempRoot.root_id");
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const root of input.registry) {
    // Validate the registry entry shape even when callers skipped validator.
    const validated = validateApprovedTempRoot(root);
    if (validated.root_id === input.root_id) {
      if (seen.has(validated.root_id)) {
        duplicates.add(validated.root_id);
        continue;
      }
      seen.add(validated.root_id);
    }
  }
  if (duplicates.has(input.root_id)) {
    throw new ApprovedTempRootResolutionError(
      input.root_id,
      `approved temp root "${input.root_id}" appears more than once in registry`,
    );
  }

  const matches = input.registry.filter(
    (root) => validateApprovedTempRoot(root).root_id === input.root_id,
  );
  if (matches.length === 0) {
    throw new ApprovedTempRootResolutionError(
      input.root_id,
      `approved temp root "${input.root_id}" not found in registry`,
    );
  }

  const target = validateApprovedTempRoot(matches[0]!);
  const lstat = input.options?.lstat ?? defaultLstat;
  const realpathFn = input.options?.realpath ?? defaultRealpath;

  const stats = await lstat(target.path);
  if (stats.isSymbolicLink()) {
    throw new ApprovedTempRootResolutionError(
      input.root_id,
      `approved temp root "${input.root_id}" configured path "${target.path}" must not be a symlink`,
    );
  }
  if (!stats.isDirectory()) {
    throw new ApprovedTempRootResolutionError(
      input.root_id,
      `approved temp root "${input.root_id}" configured path "${target.path}" must be a directory`,
    );
  }

  const resolved = await realpathFn(target.path);
  const protectedNormalized = await normalizeProtectedRealpaths(
    input.protected_realpaths,
    realpathFn,
  );
  for (const protectedPath of protectedNormalized) {
    if (samePath(resolved, protectedPath) || isAncestorPath(resolved, protectedPath)) {
      throw new ApprovedTempRootResolutionError(
        input.root_id,
        `approved temp root "${input.root_id}" realpath "${resolved}" must not equal or contain a protected path`,
      );
    }
  }

  return {
    root_id: target.root_id,
    configured_path: target.path,
    realpath: resolved,
  };
}

export async function buildManagedTempDirectoryPath(
  input: BuildManagedTempDirectoryPathInput,
): Promise<string> {
  if (input.directory_basename.length === 0) {
    throw new InvalidTargetPathError(
      "",
      "directory_basename must not be empty",
    );
  }
  if (input.directory_basename === "." || input.directory_basename === "..") {
    throw new InvalidTargetPathError(
      input.directory_basename,
      `directory_basename must not be "${input.directory_basename}"`,
    );
  }
  if (input.directory_basename.includes("/") || input.directory_basename.includes("\0")) {
    throw new InvalidTargetPathError(
      input.directory_basename,
      "directory_basename must not contain '/' or null",
    );
  }
  validateId(input.directory_basename, "buildManagedTempDirectoryPath.directory_basename");

  const realpathFn = input.options?.realpath ?? defaultRealpath;
  const resolvedRoot = await realpathFn(input.root_realpath);
  const target = join(resolvedRoot, input.directory_basename);
  if (target === resolvedRoot) {
    throw new InvalidTargetPathError(
      target,
      "managed temp target must not equal the approved root realpath",
    );
  }
  if (!target.startsWith(resolvedRoot + "/")) {
    throw new InvalidTargetPathError(
      target,
      `managed temp target "${target}" must be under approved root realpath "${resolvedRoot}"`,
    );
  }

  const protectedNormalized = await normalizeProtectedRealpaths(
    input.protected_realpaths,
    realpathFn,
  );
  for (const protectedPath of protectedNormalized) {
    if (samePath(target, protectedPath)) {
      throw new ProtectedPathError(
        target,
        `managed temp target "${target}" must not equal a protected path`,
      );
    }
  }
  return target;
}

// ============================================================ helpers

async function normalizeProtectedRealpaths(
  paths: string[],
  realpathFn: (path: string) => Promise<string>,
): Promise<string[]> {
  const out: string[] = [];
  for (const path of paths) {
    if (path.length === 0) continue;
    try {
      out.push(await realpathFn(path));
    } catch {
      // missing paths simply do not collide; do not throw at registration time
    }
  }
  return out;
}

function samePath(a: string, b: string): boolean {
  return stripTrailingSlash(a) === stripTrailingSlash(b);
}

function isAncestorPath(ancestor: string, child: string): boolean {
  const normalizedAncestor = stripTrailingSlash(ancestor);
  const normalizedChild = stripTrailingSlash(child);
  return normalizedChild.startsWith(`${normalizedAncestor}/`);
}

function stripTrailingSlash(path: string): string {
  if (path === "/") return path;
  return path.replace(/\/+$/, "");
}

const defaultLstat = async (path: string) => {
  const stats = await lstatAsync(path);
  return {
    isSymbolicLink: () => stats.isSymbolicLink(),
    isDirectory: () => stats.isDirectory(),
  };
};

const defaultRealpath = async (path: string): Promise<string> => realpath(path);

// ============================================================ createManagedTempDirectory (T7)

export interface CreateManagedTempDirectoryHooks {
  beforeMkdir?: () => Promise<void>;
  afterEventAppend?: (event: Event) => Promise<void>;
  afterMarkerWrite?: (path: string) => Promise<void>;
}

export interface CreateManagedTempDirectoryInput {
  missionDir: string;
  repositoryRoot: string;
  currentWorkingDirectory: string;
  approvedTempRoots: ApprovedTempRoot[];
  actionRequest: CreateManagedResourceAction;
  actionAttempt: ActionAttempt;
  allowedDecision: PolicyDecision;
  plan: ResourceCreationPlan;
  cleanupPolicy: TempDirectoryCleanupPolicy;
  creationPayload: TempDirectoryCreationPayload;
  hooks?: CreateManagedTempDirectoryHooks;
  nowIso?: () => string;
}

export type TempDirectoryCreationResult =
  | {
      result: "created";
      resource: ObservedTempDirectoryResource;
      identity: TempDirectoryIdentity;
      marker: TempDirectoryMarker;
      events: Event[];
    }
  | {
      result: "idempotent_replay";
      resource: ObservedTempDirectoryResource;
      identity: TempDirectoryIdentity;
      marker: TempDirectoryMarker;
      events: Event[];
    }
  | {
      result: "reconciliation_required";
      reason:
        | "directory_exists_without_marker"
        | "marker_mismatch"
        | "identity_mismatch"
        | "missing_payload"
        | "payload_digest_mismatch"
        | "partial_event_log"
        | "unsupported_schema"
        | "unsupported_root";
      resource_id: string;
      planned_path?: string;
      events: Event[];
    };

type TempDirectoryReconciliationReason = Extract<
  TempDirectoryCreationResult,
  { result: "reconciliation_required" }
>["reason"];

interface ValidatedCreationInput {
  actionRequest: CreateManagedResourceAction;
  actionAttempt: ActionAttempt;
  allowedDecision: PolicyDecision;
  plan: ResourceCreationPlan;
  cleanupPolicy: TempDirectoryCleanupPolicy;
  creationPayload: TempDirectoryCreationPayload;
  resolvedRoot: ResolvedApprovedTempRoot;
  targetPath: string;
}

function requireSame(fieldName: string, expected: string, actual: string): void {
  if (expected !== actual) {
    throw new Foundation0ValidationError(
      `${fieldName} must match "${expected}", got "${actual}"`,
    );
  }
}

async function validateCreationInput(
  input: CreateManagedTempDirectoryInput,
): Promise<ValidatedCreationInput> {
  const actionRequest = validateCreateManagedResourceAction(input.actionRequest);
  if (actionRequest.capability !== "create_managed_resource") {
    throw new Foundation0ValidationError(
      `actionRequest.capability must be "create_managed_resource", got "${actionRequest.capability}"`,
    );
  }
  if (actionRequest.payload_kind !== "create_managed_resource") {
    throw new Foundation0ValidationError(
      `actionRequest.payload_kind must be "create_managed_resource", got "${actionRequest.payload_kind}"`,
    );
  }
  if (actionRequest.target.entity_type !== "resource") {
    throw new Foundation0ValidationError(
      `actionRequest.target.entity_type must be "resource", got "${actionRequest.target.entity_type}"`,
    );
  }

  const actionAttempt = validateActionAttempt(input.actionAttempt);
  requireSame(
    "actionAttempt.mission_id",
    actionRequest.mission_id,
    actionAttempt.mission_id,
  );
  requireSame(
    "actionAttempt.action_id",
    actionRequest.action_id,
    actionAttempt.action_id,
  );

  const allowedDecision = validatePolicyDecision(input.allowedDecision);
  requireSame(
    "allowedDecision.mission_id",
    actionRequest.mission_id,
    allowedDecision.mission_id,
  );
  requireSame(
    "allowedDecision.action_id",
    actionRequest.action_id,
    allowedDecision.action_id,
  );
  requireSame(
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
      `allowedDecision.result must be "allowed" for create_managed_resource, got "${allowedDecision.result}"`,
    );
  }

  const plan = input.plan;
  requireSame(
    "plan.mission_id",
    actionRequest.mission_id,
    plan.mission_id,
  );
  requireSame(
    "plan.resource_id",
    actionRequest.target.resource_id,
    plan.resource_id,
  );
  if (plan.resource_type !== "temp_directory") {
    throw new Foundation0ValidationError(
      `plan.resource_type must be "temp_directory", got "${plan.resource_type}"`,
    );
  }
  if (plan.creation_kind !== "create_temp_directory") {
    throw new Foundation0ValidationError(
      `plan.creation_kind must be "create_temp_directory", got "${plan.creation_kind}"`,
    );
  }
  if (plan.requested_by_action_id !== actionRequest.action_id) {
    throw new Foundation0ValidationError(
      `plan.requested_by_action_id must equal actionRequest.action_id "${actionRequest.action_id}", got "${plan.requested_by_action_id}"`,
    );
  }
  if (plan.authorization_id !== actionRequest.authorization_id) {
    throw new Foundation0ValidationError(
      `plan.authorization_id must equal actionRequest.authorization_id "${actionRequest.authorization_id}", got "${plan.authorization_id}"`,
    );
  }
  const expectedFingerprint = computeResourceCreationPlanFingerprint(plan);
  if (plan.effect_fingerprint !== expectedFingerprint) {
    throw new Foundation0ValidationError(
      `plan.effect_fingerprint does not match canonical plan inputs`,
    );
  }

  const cleanupPolicy: TempDirectoryCleanupPolicy = {
    rename_strategy: "atomic_rename_under_root",
    delete_strategy: "recursive_no_follow",
    ...(input.cleanupPolicy ?? {}),
  } as TempDirectoryCleanupPolicy;

  const creationPayload = validateTempDirectoryCreationPayload(input.creationPayload);
  if (creationPayload.approved_temp_root_id !== plan.creation_payload.approved_temp_root_id) {
    throw new Foundation0ValidationError(
      `creationPayload.approved_temp_root_id must equal plan.creation_payload.approved_temp_root_id`,
    );
  }

  const protectedPaths = [
    input.missionDir,
    foundation0StoragePaths(input.missionDir).rootDir,
    input.repositoryRoot,
    input.currentWorkingDirectory,
  ];

  const resolvedRoot = await resolveApprovedTempRoot({
    registry: input.approvedTempRoots,
    root_id: creationPayload.approved_temp_root_id,
    protected_realpaths: protectedPaths,
  });

  const targetPath = await buildManagedTempDirectoryPath({
    root_realpath: resolvedRoot.realpath,
    directory_basename: creationPayload.directory_basename,
    protected_realpaths: protectedPaths,
  });

  return {
    actionRequest,
    actionAttempt,
    allowedDecision,
    plan,
    cleanupPolicy,
    creationPayload,
    resolvedRoot,
    targetPath,
  };
}

const T7_LOCK_PREFIX = "temp_directory_creation_event_append";

function tempDirectoryEventAppendLockId(missionId: string): string {
  const hex = createHash("sha256")
    .update(canonicalizeForDigest({ scope: "t7_event_append", mission_id: missionId }))
    .digest("hex")
    .slice(0, 32);
  return validateId(`t7_event_append_${hex}`, "tempDirectoryEventAppendLockId");
}

function eventIdempotencyKeySuffix(
  scope:
    | "action_requested"
    | "attempt_started"
    | "execution_policy"
    | "resource_planned"
    | "identity_observed"
    | "resource_registered"
    | "resource_activated"
    | "initial_outcome",
  baseKey: string,
): string {
  return `${baseKey}:${scope}`;
}

async function appendPreEffectEvents(
  input: {
    missionDir: string;
    actionRequest: CreateManagedResourceAction;
    actionAttempt: ActionAttempt;
    allowedDecision: PolicyDecision;
    plan: ResourceCreationPlan;
    baseIdempotencyKey: string;
    hooks?: CreateManagedTempDirectoryHooks;
  },
): Promise<{
  actionRequested: Event;
  attemptStarted: Event;
  policyDecisionRecorded: Event;
  resourcePlanned: Event;
}> {
  const lockId = tempDirectoryEventAppendLockId(input.actionRequest.mission_id);
  const actionRequested = await appendFoundation0Event({
    missionDir: input.missionDir,
    missionId: input.actionRequest.mission_id,
    eventType: "action_requested",
    entityType: "action",
    entityId: input.actionRequest.action_id,
    payload: input.actionRequest,
    actionId: input.actionRequest.action_id,
    idempotencyKey: eventIdempotencyKeySuffix(
      "action_requested",
      input.baseIdempotencyKey,
    ),
    lockId,
  });
  await input.hooks?.afterEventAppend?.(actionRequested);
  const attemptStarted = await appendFoundation0Event({
    missionDir: input.missionDir,
    missionId: input.actionAttempt.mission_id,
    eventType: "action_attempt_started",
    entityType: "action",
    entityId: input.actionAttempt.action_attempt_id,
    payload: input.actionAttempt,
    actionId: input.actionAttempt.action_id,
    actionAttemptId: input.actionAttempt.action_attempt_id,
    idempotencyKey: eventIdempotencyKeySuffix(
      "attempt_started",
      input.baseIdempotencyKey,
    ),
    lockId,
  });
  await input.hooks?.afterEventAppend?.(attemptStarted);
  const policyDecisionRecorded = await appendFoundation0Event({
    missionDir: input.missionDir,
    missionId: input.allowedDecision.mission_id,
    eventType: "policy_decision_recorded",
    entityType: "action",
    entityId: input.allowedDecision.policy_decision_id,
    payload: input.allowedDecision,
    actionId: input.allowedDecision.action_id,
    actionAttemptId: input.allowedDecision.action_attempt_id,
    policyDecisionId: input.allowedDecision.policy_decision_id,
    idempotencyKey: eventIdempotencyKeySuffix(
      "execution_policy",
      input.baseIdempotencyKey,
    ),
    lockId,
  });
  await input.hooks?.afterEventAppend?.(policyDecisionRecorded);
  const resourcePlanned = await appendFoundation0Event({
    missionDir: input.missionDir,
    missionId: input.plan.mission_id,
    eventType: "resource_planned",
    entityType: "resource",
    entityId: input.plan.resource_id,
    payload: input.plan,
    actionId: input.plan.requested_by_action_id,
    idempotencyKey: eventIdempotencyKeySuffix(
      "resource_planned",
      input.baseIdempotencyKey,
    ),
    lockId,
  });
  await input.hooks?.afterEventAppend?.(resourcePlanned);
  return {
    actionRequested,
    attemptStarted,
    policyDecisionRecorded,
    resourcePlanned,
  };
}

function preEventList(preEvents: {
  actionRequested: Event;
  attemptStarted: Event;
  policyDecisionRecorded: Event;
  resourcePlanned: Event;
}): Event[] {
  return [
    preEvents.actionRequested,
    preEvents.attemptStarted,
    preEvents.policyDecisionRecorded,
    preEvents.resourcePlanned,
  ];
}

function reconciliationResult(
  validated: ValidatedCreationInput,
  reason: TempDirectoryReconciliationReason,
  events: Event[],
): TempDirectoryCreationResult {
  return {
    result: "reconciliation_required",
    reason,
    resource_id: validated.actionRequest.target.resource_id,
    planned_path: validated.targetPath,
    events,
  };
}

function replayErrorReason(error: unknown): TempDirectoryReconciliationReason | undefined {
  if (error instanceof PartialEventLogError) return "partial_event_log";
  if (error instanceof MissingPayloadError) return "missing_payload";
  if (error instanceof PayloadDigestMismatchError) return "payload_digest_mismatch";
  if (error instanceof TempDirectoryCreationError && error.code === "unsupported_schema") {
    return "unsupported_schema";
  }
  return undefined;
}

function deriveBaseIdempotencyKey(input: {
  actionRequest: CreateManagedResourceAction;
  creationPayload: TempDirectoryCreationPayload;
}): string {
  return `temp_directory_creation:${input.actionRequest.mission_id}:${input.actionRequest.target.resource_id}:${input.creationPayload.creation_nonce}:${input.actionRequest.idempotency_key}`;
}

export const MARKER_FILENAME = ".pi-topology-resource.json";
export const MARKER_TEMP_PREFIX = ".pi-topology-marker-";
function getErrnoCode(error: unknown): unknown {
  if (typeof error !== "object" || error === null) return undefined;
  if (!("code" in error)) return undefined;
  return error.code;
}

function isErrnoCode(error: unknown, code: string): boolean {
  return getErrnoCode(error) === code;
}

type EnsureTargetResult =
  | { state: "created"; stats: import("node:fs").Stats; canonicalPath: string }
  | { state: "directory_exists_without_marker" }
  | { state: "marker_mismatch" };

async function ensureTargetDirectory(
  target: string,
  rootRealpath: string,
  expectedMarkerDigest?: string,
): Promise<EnsureTargetResult> {
  let firstAttempt = true;
  for (;;) {
    try {
      await mkdir(target, { recursive: false });
      await fsyncDirectory(rootRealpath);
      const stats = await lstatAsync(target);
      if (stats.isSymbolicLink()) {
        throw new TempDirectoryCreationError(
          "symlink_target",
          `managed temp target "${target}" must not be a symlink`,
        );
      }
      if (!stats.isDirectory()) {
        throw new TempDirectoryCreationError(
          "not_a_directory",
          `managed temp target "${target}" must be a directory`,
        );
      }
      const canonicalPath = await realpath(target);
      return { state: "created", stats, canonicalPath };
    } catch (error) {
      if (isErrnoCode(error, "EEXIST")) {
        const existingMarker = await readExistingMarker(target);
        if (existingMarker.state === "absent") {
          return { state: "directory_exists_without_marker" };
        }
        if (existingMarker.state === "invalid") {
          return { state: "marker_mismatch" };
        }
        if (
          expectedMarkerDigest !== undefined
          && existingMarker.marker.identity_digest !== expectedMarkerDigest
        ) {
          return { state: "marker_mismatch" };
        }
        return { state: "marker_mismatch" };
      }
      if (isErrnoCode(error, "ENOENT")) {
        throw error;
      }
      if (firstAttempt) {
        firstAttempt = false;
        continue;
      }
      throw error;
    }
  }
}

async function writeMarker(target: string, marker: TempDirectoryMarker): Promise<void> {
  const markerPath = join(target, MARKER_FILENAME);
  const markerTempName = `${MARKER_TEMP_PREFIX}${randomUUID()}.tmp`;
  const markerTempPath = join(target, markerTempName);
  const canonical = `${canonicalizeForDigest(marker)}\n`;
  // Write marker temp file with fsync.
  await writeDurableFile(markerTempPath, canonical, "w", 0o600);
  try {
    await rename(markerTempPath, markerPath);
  } catch (error) {
    await unlinkIfExists(markerTempPath);
    throw error;
  }
  await fsyncFile(markerPath);
  await fsyncDirectory(target);
  const markerStats = await lstatAsync(markerPath);
  if (markerStats.isSymbolicLink()) {
    throw new TempDirectoryCreationError(
      "marker_symlink",
      `marker path "${markerPath}" must not be a symlink`,
    );
  }
  // Verify marker bytes/digest roundtrip.
  const raw = await readFile(markerPath, "utf8");
  if (raw !== canonical) {
    throw new TempDirectoryCreationError(
      "marker_bytes_mismatch",
      `marker bytes do not match canonical JSON at "${markerPath}"`,
    );
  }
  const parsed = JSON.parse(raw);
  if (parsed.schema_version !== 1) {
    throw new TempDirectoryCreationError(
      "unsupported_schema",
      `marker schema_version is not 1 at "${markerPath}"`,
    );
  }
  const verified = validateTempDirectoryMarker(parsed);
  if (verified.identity_digest !== marker.identity_digest) {
    throw new TempDirectoryCreationError(
      "marker_identity_mismatch",
      `marker.identity_digest does not match sha256(canonical(identity_core)) at "${markerPath}"`,
    );
  }
}

function buildIdentityCore(input: {
  approvedTempRootId: string;
  canonicalPath: string;
  stats: import("node:fs").Stats;
  creationNonce: string;
}): TempDirectoryIdentity["identity_core"] {
  return {
    approved_temp_root_id: input.approvedTempRootId,
    canonical_path: input.canonicalPath,
    device_id: input.stats.dev,
    inode: input.stats.ino,
    owner_uid: input.stats.uid,
    creation_nonce: input.creationNonce,
  };
}

function buildIdentity(
  identityCore: TempDirectoryIdentity["identity_core"],
  marker: TempDirectoryMarker,
): TempDirectoryIdentity {
  const identity_digest = computeSha256Digest(identityCore);
  const marker_digest = computeSha256Digest(marker);
  return { identity_core: identityCore, identity_digest, marker_digest };
}

async function recoverIdentityFromExistingMarker(
  validated: ValidatedCreationInput,
  marker: TempDirectoryMarker,
): Promise<
  | { state: "recovered"; identity: TempDirectoryIdentity; marker: TempDirectoryMarker }
  | { state: "reconciliation_required"; reason: TempDirectoryReconciliationReason }
> {
  let stats: import("node:fs").Stats;
  let canonicalPath: string;
  try {
    stats = await lstatAsync(validated.targetPath);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      return { state: "reconciliation_required", reason: "marker_mismatch" };
    }
    canonicalPath = await realpath(validated.targetPath);
  } catch (error) {
    if (isErrnoCode(error, "ENOENT")) {
      return { state: "reconciliation_required", reason: "marker_mismatch" };
    }
    throw error;
  }

  const identityCore = buildIdentityCore({
    approvedTempRootId: validated.creationPayload.approved_temp_root_id,
    canonicalPath,
    stats,
    creationNonce: validated.creationPayload.creation_nonce,
  });
  const identity = buildIdentity(identityCore, marker);
  if (identity.identity_digest !== marker.identity_digest) {
    return { state: "reconciliation_required", reason: "identity_mismatch" };
  }
  try {
    const validatedIdentity = validateTempDirectoryIdentity(identity, { marker });
    return { state: "recovered", identity: validatedIdentity, marker };
  } catch {
    return { state: "reconciliation_required", reason: "identity_mismatch" };
  }
}

async function appendIdentityObserved(
  input: {
    missionDir: string;
    missionId: string;
    resourceId: string;
    payload: TempDirectoryIdentityObservation;
    baseIdempotencyKey: string;
    actionId: string;
    hooks?: CreateManagedTempDirectoryHooks;
  },
): Promise<Event> {
  const event = await appendFoundation0Event({
    missionDir: input.missionDir,
    missionId: input.missionId,
    eventType: "resource_identity_observed",
    entityType: "resource",
    entityId: input.resourceId,
    payload: input.payload,
    actionId: input.actionId,
    idempotencyKey: eventIdempotencyKeySuffix(
      "identity_observed",
      input.baseIdempotencyKey,
    ),
    lockId: tempDirectoryEventAppendLockId(input.missionId),
  });
  await input.hooks?.afterEventAppend?.(event);
  return event;
}

function buildObservedResource(
  validated: ValidatedCreationInput,
  identity: TempDirectoryIdentity,
  lifecycleState: "registered" | "active",
  observedAt: string,
): ObservedTempDirectoryResource {
  return {
    schema_version: 1,
    resource_id: validated.actionRequest.target.resource_id,
    mission_id: validated.actionRequest.mission_id,
    resource_type: "temp_directory",
    ownership_origin: "created",
    owned_by_actor_id: validated.plan.planned_resource.owned_by_actor_id,
    cleanup_owner_actor_id: validated.plan.planned_resource.cleanup_owner_actor_id,
    registered_by_action_id: validated.actionRequest.action_id,
    authorization_id: validated.actionRequest.authorization_id,
    lifecycle_state: lifecycleState,
    verification_state: "verified",
    identity,
    identity_digest: identity.identity_digest,
    cleanup_policy: validated.cleanupPolicy,
    created_at: validated.plan.planned_resource.created_at,
    updated_at: observedAt,
  };
}

async function appendLifecycleEvent(input: {
  missionDir: string;
  missionId: string;
  resourceId: string;
  actionId: string;
  actionAttemptId: string;
  eventType:
    | "resource_identity_observed"
    | "resource_registered"
    | "resource_activated"
    | "initial_outcome_recorded";
  entityType: EventEntityType;
  payload: unknown;
  baseIdempotencyKey: string;
  suffix:
    | "identity_observed"
    | "resource_registered"
    | "resource_activated"
    | "initial_outcome";
  hooks?: CreateManagedTempDirectoryHooks;
}): Promise<Event> {
  const event = await appendFoundation0Event({
    missionDir: input.missionDir,
    missionId: input.missionId,
    eventType: input.eventType,
    entityType: input.entityType,
    entityId: input.resourceId,
    payload: input.payload,
    actionId: input.actionId,
    actionAttemptId: input.actionAttemptId,
    idempotencyKey: eventIdempotencyKeySuffix(
      input.suffix,
      input.baseIdempotencyKey,
    ),
    lockId: tempDirectoryEventAppendLockId(input.missionId),
  });
  await input.hooks?.afterEventAppend?.(event);
  return event;
}

async function appendRemainingLifecycleEvents(input: {
  missionDir: string;
  validated: ValidatedCreationInput;
  identity: TempDirectoryIdentity;
  marker: TempDirectoryMarker;
  baseIdempotencyKey: string;
  hooks?: CreateManagedTempDirectoryHooks;
  observedAt: string;
}): Promise<{
  resource: ObservedTempDirectoryResource;
  identity: TempDirectoryIdentity;
  marker: TempDirectoryMarker;
  events: Event[];
}> {
  const identityObservation: TempDirectoryIdentityObservation = {
    schema_version: 1,
    resource_id: input.validated.actionRequest.target.resource_id,
    identity: input.identity,
    marker: input.marker,
    observed_at: input.observedAt,
  };
  const identityObservedEvent = await appendLifecycleEvent({
    missionDir: input.missionDir,
    missionId: input.validated.actionRequest.mission_id,
    resourceId: input.validated.actionRequest.target.resource_id,
    actionId: input.validated.actionRequest.action_id,
    actionAttemptId: input.validated.actionAttempt.action_attempt_id,
    eventType: "resource_identity_observed",
    entityType: "resource",
    payload: identityObservation,
    baseIdempotencyKey: input.baseIdempotencyKey,
    suffix: "identity_observed",
    hooks: input.hooks,
  });

  const registeredResource = buildObservedResource(
    input.validated,
    input.identity,
    "registered",
    input.observedAt,
  );
  const registeredEvent = await appendLifecycleEvent({
    missionDir: input.missionDir,
    missionId: input.validated.actionRequest.mission_id,
    resourceId: input.validated.actionRequest.target.resource_id,
    actionId: input.validated.actionRequest.action_id,
    actionAttemptId: input.validated.actionAttempt.action_attempt_id,
    eventType: "resource_registered",
    entityType: "resource",
    payload: registeredResource,
    baseIdempotencyKey: input.baseIdempotencyKey,
    suffix: "resource_registered",
    hooks: input.hooks,
  });

  const activeResource = buildObservedResource(
    input.validated,
    input.identity,
    "active",
    input.observedAt,
  );
  const activatedEvent = await appendLifecycleEvent({
    missionDir: input.missionDir,
    missionId: input.validated.actionRequest.mission_id,
    resourceId: input.validated.actionRequest.target.resource_id,
    actionId: input.validated.actionRequest.action_id,
    actionAttemptId: input.validated.actionAttempt.action_attempt_id,
    eventType: "resource_activated",
    entityType: "resource",
    payload: activeResource,
    baseIdempotencyKey: input.baseIdempotencyKey,
    suffix: "resource_activated",
    hooks: input.hooks,
  });

  const outcome: CreateManagedResourceInitialOutcome = {
    schema_version: 1,
    outcome_id: `outcome_${input.validated.actionRequest.target.resource_id}_${input.validated.actionAttempt.action_attempt_id}`,
    action_attempt_id: input.validated.actionAttempt.action_attempt_id,
    action_id: input.validated.actionRequest.action_id,
    mission_id: input.validated.actionRequest.mission_id,
    action_payload_kind: "create_managed_resource",
    status: "succeeded",
    result_code: "created",
    created_at: input.observedAt,
  };
  const outcomeEvent = await appendLifecycleEvent({
    missionDir: input.missionDir,
    missionId: input.validated.actionRequest.mission_id,
    resourceId: input.validated.actionRequest.target.resource_id,
    actionId: input.validated.actionRequest.action_id,
    actionAttemptId: input.validated.actionAttempt.action_attempt_id,
    eventType: "initial_outcome_recorded",
    entityType: "action",
    payload: outcome,
    baseIdempotencyKey: input.baseIdempotencyKey,
    suffix: "initial_outcome",
    hooks: input.hooks,
  });

  return {
    resource: activeResource,
    identity: input.identity,
    marker: input.marker,
    events: [
      identityObservedEvent,
      registeredEvent,
      activatedEvent,
      outcomeEvent,
    ],
  };
}

type ReadMarkerResult =
  | { state: "absent" }
  | { state: "valid"; marker: TempDirectoryMarker }
  | { state: "invalid" };

async function readExistingMarker(target: string): Promise<ReadMarkerResult> {
  const markerPath = join(target, MARKER_FILENAME);
  let raw: string;
  try {
    raw = await readFile(markerPath, "utf8");
  } catch (error) {
    if (isErrnoCode(error, "ENOENT")) return { state: "absent" };
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { state: "invalid" };
  }
  try {
    const marker = validateTempDirectoryMarker(parsed);
    return { state: "valid", marker };
  } catch {
    return { state: "invalid" };
  }
}

async function checkForExistingCreation(
  input: CreateManagedTempDirectoryInput,
  validated: ValidatedCreationInput,
): Promise<
  | { state: "needs_new_creation" }
  | { state: "active_replay"; resource: ObservedTempDirectoryResource; identity: TempDirectoryIdentity; marker: TempDirectoryMarker }
  | { state: "complete_lifecycle"; identity: TempDirectoryIdentity; marker: TempDirectoryMarker }
  | { state: "reconciliation_required"; reason: TempDirectoryReconciliationReason }
> {
  const events = await readFoundation0EventsInternal(input.missionDir);
  const resourceEvents = events.filter((event) =>
    event.mission_id === validated.actionRequest.mission_id
    && event.entity_id === validated.actionRequest.target.resource_id
  );

  // Look for active terminal event (resource_activated with lifecycle: active).
  const activated = resourceEvents.find((event) => event.event_type === "resource_activated");
  if (activated !== undefined) {
    const resource = await readPayloadAsObservedResource(input.missionDir, activated);
    const identityObserved = resourceEvents.find((event) => event.event_type === "resource_identity_observed");
    if (identityObserved === undefined) {
      return { state: "reconciliation_required", reason: "partial_event_log" };
    }
    const observation = await readPayloadAsIdentityObservation(input.missionDir, identityObserved);
    // Verify on-disk marker matches the identity observation. A mismatch
    // after creation means the on-disk resource was tampered with; replay
    // must NOT silently claim ownership of a forged directory.
    const onDiskMarker = await readExistingMarker(validated.targetPath);
    if (onDiskMarker.state !== "valid") {
      return { state: "reconciliation_required", reason: "marker_mismatch" };
    }
    if (
      onDiskMarker.marker.identity_digest !== observation.marker.identity_digest
      || onDiskMarker.marker.mission_id !== observation.marker.mission_id
      || onDiskMarker.marker.resource_id !== observation.marker.resource_id
    ) {
      return { state: "reconciliation_required", reason: "marker_mismatch" };
    }
    return {
      state: "active_replay",
      resource,
      identity: observation.identity,
      marker: observation.marker,
    };
  }

  const identityObserved = resourceEvents.find((event) => event.event_type === "resource_identity_observed");
  if (identityObserved !== undefined) {
    const observation = await readPayloadAsIdentityObservation(input.missionDir, identityObserved);
    const onDiskMarker = await readExistingMarker(validated.targetPath);
    if (onDiskMarker.state !== "valid") {
      return { state: "reconciliation_required", reason: "marker_mismatch" };
    }
    if (
      onDiskMarker.marker.identity_digest !== observation.marker.identity_digest
      || onDiskMarker.marker.mission_id !== observation.marker.mission_id
      || onDiskMarker.marker.resource_id !== observation.marker.resource_id
    ) {
      return { state: "reconciliation_required", reason: "marker_mismatch" };
    }
    const recovered = await recoverIdentityFromExistingMarker(validated, onDiskMarker.marker);
    if (recovered.state === "reconciliation_required") return recovered;
    if (recovered.identity.identity_digest !== observation.identity.identity_digest) {
      return { state: "reconciliation_required", reason: "identity_mismatch" };
    }
    return {
      state: "complete_lifecycle",
      identity: observation.identity,
      marker: observation.marker,
    };
  }

  // No active event. Check if a directory exists on disk but no marker.
  let targetExists = false;
  try {
    await lstatAsync(validated.targetPath);
    targetExists = true;
  } catch (error) {
    if (!isErrnoCode(error, "ENOENT")) throw error;
  }
  if (targetExists) {
    const existingMarker = await readExistingMarker(validated.targetPath);
    if (existingMarker.state === "absent") {
      return { state: "reconciliation_required", reason: "directory_exists_without_marker" };
    }
    if (existingMarker.state === "invalid") {
      return { state: "reconciliation_required", reason: "marker_mismatch" };
    }
    const recovered = await recoverIdentityFromExistingMarker(validated, existingMarker.marker);
    if (recovered.state === "reconciliation_required") return recovered;
    return {
      state: "complete_lifecycle",
      identity: recovered.identity,
      marker: recovered.marker,
    };
  }

  return { state: "needs_new_creation" };
}

async function readFoundation0EventsInternal(missionDir: string) {
  return readFoundation0Events(missionDir);
}

async function readPayloadAsObservedResource(
  missionDir: string,
  event: Event,
): Promise<ObservedTempDirectoryResource> {
  return validateObservedTempDirectoryResource(
    await readFoundation0EventPayload(missionDir, event),
  );
}

async function readPayloadAsIdentityObservation(
  missionDir: string,
  event: Event,
): Promise<TempDirectoryIdentityObservation> {
  const payload = await readFoundation0EventPayload(missionDir, event);
  if (
    typeof payload !== "object"
    || payload === null
    || !("identity" in payload)
    || !("marker" in payload)
  ) {
    throw new TempDirectoryCreationError(
      "unsupported_schema",
      "resource_identity_observed payload is not a temp directory identity observation",
    );
  }
  const observation = payload as TempDirectoryIdentityObservation;
  const marker = validateTempDirectoryMarker(observation.marker);
  const identity = validateTempDirectoryIdentity(observation.identity, { marker });
  return {
    ...observation,
    identity,
    marker,
  };
}

export async function createManagedTempDirectory(
  input: CreateManagedTempDirectoryInput,
): Promise<TempDirectoryCreationResult> {
  const validated = await validateCreationInput(input);
  const baseIdempotencyKey = deriveBaseIdempotencyKey({
    actionRequest: validated.actionRequest,
    creationPayload: validated.creationPayload,
  });

  const hooks = input.hooks ?? {};
  let preEvents: Awaited<ReturnType<typeof appendPreEffectEvents>>;
  try {
    preEvents = await appendPreEffectEvents({
      missionDir: input.missionDir,
      actionRequest: validated.actionRequest,
      actionAttempt: validated.actionAttempt,
      allowedDecision: validated.allowedDecision,
      plan: validated.plan,
      baseIdempotencyKey,
      hooks,
    });
  } catch (error) {
    const reason = replayErrorReason(error);
    if (reason !== undefined) {
      return reconciliationResult(validated, reason, []);
    }
    throw error;
  }

  await hooks.beforeMkdir?.();

  // Replay check: if an active resource exists, return idempotent_replay
  // without touching the filesystem. If a directory exists with no marker,
  // surface reconciliation_required and do NOT overwrite.
  let existing: Awaited<ReturnType<typeof checkForExistingCreation>>;
  try {
    existing = await checkForExistingCreation(input, validated);
  } catch (error) {
    const reason = replayErrorReason(error);
    if (reason !== undefined) {
      return reconciliationResult(validated, reason, preEventList(preEvents));
    }
    throw error;
  }
  if (existing.state === "active_replay") {
    return {
      result: "idempotent_replay",
      resource: existing.resource,
      identity: existing.identity,
      marker: existing.marker,
      events: preEventList(preEvents),
    };
  }
  if (existing.state === "reconciliation_required") {
    return reconciliationResult(validated, existing.reason, preEventList(preEvents));
  }
  if (existing.state === "complete_lifecycle") {
    const observedAt = (input.nowIso ?? (() => new Date().toISOString()))();
    const lifecycle = await appendRemainingLifecycleEvents({
      missionDir: input.missionDir,
      validated,
      identity: existing.identity,
      marker: existing.marker,
      baseIdempotencyKey,
      hooks,
      observedAt,
    });
    return {
      result: "created",
      resource: lifecycle.resource,
      identity: lifecycle.identity,
      marker: lifecycle.marker,
      events: [
        ...preEventList(preEvents),
        ...lifecycle.events,
      ],
    };
  }
  // mkdir or classify filesystem state for replay.

  const ensureResult = await ensureTargetDirectory(
    validated.targetPath,
    validated.resolvedRoot.realpath,
  );
  if (ensureResult.state === "directory_exists_without_marker") {
    return reconciliationResult(
      validated,
      "directory_exists_without_marker",
      preEventList(preEvents),
    );
  }
  if (ensureResult.state === "marker_mismatch") {
    return reconciliationResult(validated, "marker_mismatch", preEventList(preEvents));
  }
  const { stats, canonicalPath } = ensureResult;

  const identityCore = buildIdentityCore({
    approvedTempRootId: validated.creationPayload.approved_temp_root_id,
    canonicalPath,
    stats,
    creationNonce: validated.creationPayload.creation_nonce,
  });

  const expectedIdentityDigest = computeSha256Digest(identityCore);
  const marker: TempDirectoryMarker = {
    schema_version: 1,
    mission_id: validated.actionRequest.mission_id,
    resource_id: validated.actionRequest.target.resource_id,
    identity_digest: expectedIdentityDigest,
    created_by_action_id: validated.actionRequest.action_id,
  };

  await writeMarker(validated.targetPath, marker);

  const identity = buildIdentity(identityCore, marker);
  const validatedIdentity = validateTempDirectoryIdentity(identity, { marker });
  await hooks.afterMarkerWrite?.(join(validated.targetPath, MARKER_FILENAME));

  const observedAt = (input.nowIso ?? (() => new Date().toISOString()))();
  const lifecycle = await appendRemainingLifecycleEvents({
    missionDir: input.missionDir,
    validated,
    identity: validatedIdentity,
    marker,
    baseIdempotencyKey,
    hooks,
    observedAt,
  });

  return {
    result: "created",
    resource: lifecycle.resource,
    identity: lifecycle.identity,
    marker: lifecycle.marker,
    events: [
      ...preEventList(preEvents),
      ...lifecycle.events,
    ],
  };
}
