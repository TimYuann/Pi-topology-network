/**
 * Foundation-0 ID, digest, timestamp grammars and deterministic digest helpers.
 *
 * Per `docs/20-pi-topology-v0.6-foundation-0-first-slice-contract-closure.md` §4:
 *   - ID pattern:    ^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$
 *   - Digest format: sha256:<lowercase-hex>
 *   - Timestamps:    ISO-8601 UTC with millisecond precision
 *
 * These helpers are pure (no fs, no env) so they can be exercised by unit tests
 * without any workspace setup.
 */

import { createHash } from "node:crypto";

export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

export const ISO8601_UTC_MS_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** SHA-256 hex output length (bytes * 2). */
export const SHA256_HEX_LENGTH = 64;

/**
 * Error thrown by every Foundation-0 validator. Callers (tests, runtime) match
 * on `error.name === "Foundation0ValidationError"` for assertion-style checks.
 */
export class Foundation0ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Foundation0ValidationError";
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Foundation0ValidationError(message);
}

// ---------------------------------------------------------------- field helpers

export function validateId(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new Foundation0ValidationError(
      `${fieldName} must be a string, got ${typeof value}`,
    );
  }
  if (!ID_PATTERN.test(value)) {
    throw new Foundation0ValidationError(
      `${fieldName} "${value}" does not match ID pattern ^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$`,
    );
  }
  return value;
}

export function validateDigest(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new Foundation0ValidationError(
      `${fieldName} must be a string, got ${typeof value}`,
    );
  }
  if (!DIGEST_PATTERN.test(value)) {
    throw new Foundation0ValidationError(
      `${fieldName} "${value}" does not match digest pattern sha256:<64 lowercase hex>`,
    );
  }
  return value;
}

export function validateTimestamp(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new Foundation0ValidationError(
      `${fieldName} must be a string, got ${typeof value}`,
    );
  }
  if (!ISO8601_UTC_MS_PATTERN.test(value)) {
    throw new Foundation0ValidationError(
      `${fieldName} "${value}" does not match ISO-8601 UTC with millisecond precision (e.g. 2026-06-26T12:00:00.000Z)`,
    );
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Foundation0ValidationError(
      `${fieldName} "${value}" is not a parseable timestamp`,
    );
  }
  return value;
}

export function validateString(
  value: unknown,
  fieldName: string,
  opts: { allowEmpty?: boolean } = {},
): string {
  if (typeof value !== "string") {
    throw new Foundation0ValidationError(
      `${fieldName} must be a string, got ${typeof value}`,
    );
  }
  if (!opts.allowEmpty && value.length === 0) {
    throw new Foundation0ValidationError(`${fieldName} must be non-empty`);
  }
  return value;
}

export function validateNumber(
  value: unknown,
  fieldName: string,
  opts: { min?: number; max?: number; integer?: boolean } = {},
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Foundation0ValidationError(
      `${fieldName} must be a finite number, got ${typeof value === "number" ? value : typeof value}`,
    );
  }
  if (opts.integer !== false && !Number.isInteger(value)) {
    throw new Foundation0ValidationError(`${fieldName} must be an integer`);
  }
  if (opts.min !== undefined && value < opts.min) {
    throw new Foundation0ValidationError(
      `${fieldName} must be >= ${opts.min}, got ${value}`,
    );
  }
  if (opts.max !== undefined && value > opts.max) {
    throw new Foundation0ValidationError(
      `${fieldName} must be <= ${opts.max}, got ${value}`,
    );
  }
  return value;
}

export function validateBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== "boolean") {
    throw new Foundation0ValidationError(
      `${fieldName} must be a boolean, got ${typeof value}`,
    );
  }
  return value;
}

export function validateEnum<T extends string>(
  value: unknown,
  fieldName: string,
  allowed: readonly T[],
): T {
  if (typeof value !== "string") {
    throw new Foundation0ValidationError(
      `${fieldName} must be a string, got ${typeof value}`,
    );
  }
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Foundation0ValidationError(
      `${fieldName} "${value}" must be one of ${allowed.join(", ")}`,
    );
  }
  return value as T;
}

export function validateStringArray(
  value: unknown,
  fieldName: string,
): string[] {
  if (!Array.isArray(value)) {
    throw new Foundation0ValidationError(
      `${fieldName} must be an array, got ${typeof value}`,
    );
  }
  return value.map((item, i) =>
    validateString(item, `${fieldName}[${i}]`),
  );
}

export function validateObject(
  value: unknown,
  name: string,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Foundation0ValidationError(
      `${name} must be a non-null object`,
    );
  }
  return value as Record<string, unknown>;
}

export function rejectAdditionalProperties(
  obj: Record<string, unknown>,
  allowed: readonly string[],
  objName: string,
): void {
  const extras = Object.keys(obj).filter((k) => !(allowed as readonly string[]).includes(k));
  if (extras.length > 0) {
    throw new Foundation0ValidationError(
      `${objName} has additional properties: ${extras.join(", ")}`,
    );
  }
}

/**
 * Schema-version guard. First slice uses schema_version = 1 universally.
 * Future versions MUST add explicit migration paths before bumping.
 */
export function validateSchemaVersion(
  value: unknown,
  fieldName: string,
): 1 {
  if (value !== 1) {
    throw new Foundation0ValidationError(
      `${fieldName} must be 1 (first slice), got ${JSON.stringify(value)}`,
    );
  }
  return 1;
}

// ----------------------------------------------- canonical JSON for digests

/**
 * Internal: produce a sorted-key copy of `value` suitable for JSON.stringify.
 *
 * Rules:
 * - Object keys are sorted lexicographically (deep).
 * - Arrays preserve order.
 * - null, string, boolean, finite number preserved as-is.
 * - Non-finite numbers, BigInt, functions, undefined, Date, symbols rejected.
 */
function canonicalizeInternal(value: unknown): unknown {
  if (value === null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Foundation0ValidationError(
        `canonicalizeForDigest: non-finite number ${value}`,
      );
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeInternal(item));
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = canonicalizeInternal(obj[key]);
    }
    return sorted;
  }
  throw new Foundation0ValidationError(
    `canonicalizeForDigest: unsupported value type ${typeof value}`,
  );
}

/**
 * Serialize `value` as deterministic JSON for digest computation.
 * Object keys are sorted lexicographically (deep); arrays preserve order;
 * no whitespace. Throws on unsupported value types.
 */
export function canonicalizeForDigest(value: unknown): string {
  return JSON.stringify(canonicalizeInternal(value));
}

/**
 * Compute the Foundation-0 digest of a value via canonical JSON + sha256.
 * Output format: `sha256:<lowercase-hex>` (64 hex chars).
 */
export function computeSha256Digest(value: unknown): string {
  const canonical = canonicalizeForDigest(value);
  const hex = createHash("sha256").update(canonical, "utf8").digest("hex");
  return `sha256:${hex}`;
}