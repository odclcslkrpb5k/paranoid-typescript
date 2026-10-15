/**
 * Test helpers that assert and narrow (CP-2, TS-13). Each fails the test with a message saying
 * what was expected, where a cast or a `!` would only silence the compiler.
 */
import assert from "node:assert/strict";
import type { Result } from "../../src/result.ts";

/** `value`, or a failed test if it is `null` or `undefined`. Returns the same reference. */
export function must<T>(value: T | null | undefined, what: string): T {
  assert.ok(value !== null && value !== undefined, `expected ${what} to be present`);
  return value;
}

/** The value of a successful `Result`, or a failed test showing the error it held instead. */
export function succeeds<T, E>(result: Result<T, E>): T {
  if (!result.ok) assert.fail(`expected success, got error ${JSON.stringify(result.error)}`);
  return result.value;
}

/** The error of a failed `Result`, to compare exactly; a success fails the test. */
export function fails<T, E>(result: Result<T, E>): E {
  if (result.ok) assert.fail("expected an error, got success");
  return result.error;
}
