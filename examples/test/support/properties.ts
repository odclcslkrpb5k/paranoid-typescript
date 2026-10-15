/**
 * Settings shared by every property test (TS-16). CI runs a fixed seed so a failure reproduces;
 * setting `PROPERTY_SEED` (a scheduled run might use the date) explores new inputs, and fast-check
 * prints the seed and path of any failure so it can be replayed and kept as a fixture.
 */
import type { Parameters } from "fast-check";

const FIXED_SEED = 20261014;

export function propertyRuns<T>(): Parameters<T> {
  // `Number` is checked at once: anything that is not a safe non-zero integer means "no seed given".
  const fromEnv = Number(process.env["PROPERTY_SEED"] ?? "");
  return {
    seed: Number.isSafeInteger(fromEnv) && fromEnv !== 0 ? fromEnv : FIXED_SEED,
    numRuns: 300,
  };
}
