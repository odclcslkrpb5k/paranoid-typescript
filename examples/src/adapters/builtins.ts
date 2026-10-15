/**
 * Built-ins that throw, wrapped so their failures are values (ER-4). This file is where the
 * standard's lint configuration permits the throwing calls themselves; everywhere else they are
 * refused, so a call that can fail always says so in its type.
 */
import * as v from "valibot";
import { err, ok, type Result } from "../result.ts";
import { toProblems, type Problem } from "../problems.ts";

export type ParseError =
  | { readonly kind: "malformed-json" }
  | { readonly kind: "schema"; readonly problems: readonly Problem[] };

/**
 * Parses JSON text and checks it against `schema` in one step, so no caller ever holds the
 * untyped value `JSON.parse` returns (BD-1). The parser's own message is dropped: it quotes the
 * text around the fault, which may be anything the sender put there.
 */
export function parseJson<S extends v.GenericSchema>(
  text: string,
  schema: S,
): Result<v.InferOutput<S>, ParseError> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return err({ kind: "malformed-json" });
  }
  const parsed = v.safeParse(schema, raw);
  return parsed.success
    ? ok(parsed.output)
    : err({ kind: "schema", problems: toProblems(schema, parsed.issues) });
}

/** `URL.parse` answers `null` rather than throwing, so this wrapper needs no `try`. */
export function parseUrl(text: string): Result<URL, { readonly kind: "malformed-url" }> {
  const url = URL.parse(text);
  return url === null ? err({ kind: "malformed-url" }) : ok(url);
}

/**
 * Plain decimal, at most 10,000 digits. The bound matters: `BigInt` throws on text past an engine
 * limit (hundreds of millions of digits in V8), with a message quoting the text, and no id or
 * amount this program reads comes near it.
 */
const INTEGER = /^-?(?:0|[1-9]\d{0,9999})$/;

/**
 * `BigInt("1.5")` throws, and `BigInt("")` is `0n`, so the text is matched first; within the bound
 * above, `BigInt` then cannot throw.
 */
export function parseBigInt(text: string): Result<bigint, { readonly kind: "not-an-integer" }> {
  return INTEGER.test(text) ? ok(BigInt(text)) : err({ kind: "not-an-integer" });
}
