/**
 * A JSON object, as opposed to an array, `null` or a scalar: the first narrowing of a value read
 * as `unknown` (BD-7). Defined once so no copy forgets that `typeof null === "object"`.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
