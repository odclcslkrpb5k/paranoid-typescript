import type * as v from "valibot";
import { isRecord } from "./records.ts";

/**
 * One reason a value was refused, in this program's own words: where (a member path) and what
 * kind of refusal, never the value itself or the schema library's message, which quotes it (DP-3).
 */
export interface Problem {
  readonly path: string;
  readonly expected: string;
}

/**
 * The schema one path step further in, for the shapes whose keys the schema itself names: object
 * entries, array items, and the wrappers that hold another schema. A record's or map's keys are the
 * sender's, so there is no step into them that keeps the key.
 */
function stepInto(
  schema: unknown,
  key: unknown,
): { readonly next: unknown; readonly named: boolean } {
  if (!isRecord(schema)) return { next: undefined, named: false };
  const entries = schema["entries"];
  if (isRecord(entries) && typeof key === "string" && Object.hasOwn(entries, key)) {
    return { next: entries[key], named: true };
  }
  if (schema["type"] === "array" && typeof key === "number") {
    return { next: schema["item"], named: true };
  }
  if (["optional", "nullable", "nullish", "exact_optional"].includes(String(schema["type"]))) {
    return stepInto(schema["wrapped"], key);
  }
  return { next: undefined, named: false };
}

/**
 * Converts the schema library's issues into `Problem`s. Each key in a path is kept only when the
 * schema declares it (an object member, an array index); any other key came from the data — a
 * record keyed by username or token, say — and is replaced, whatever it looks like.
 */
export function toProblems(
  schema: v.GenericSchema,
  issues: readonly v.BaseIssue<unknown>[],
): readonly Problem[] {
  return issues.map((issue) => {
    let current: unknown = schema;
    const segments = (issue.path ?? []).map((item) => {
      const { next, named } = stepInto(current, item.key);
      current = next;
      return named ? String(item.key) : "?";
    });
    return { path: segments.join("."), expected: issue.expected ?? issue.type };
  });
}
