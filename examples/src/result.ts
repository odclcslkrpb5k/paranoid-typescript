/**
 * Errors as values (ER-1, ER-2). A function that can fail in a way its caller must handle returns
 * a `Result`; its error is a discriminated union the caller switches on exhaustively. `panic` is
 * for what the types say cannot happen, and is the only `throw` outside the code that stands at the
 * program's edge: adapters, the fakes that stand in for foreign code, and tools (ER-2, ER-3).
 */

export type Result<T, E> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/** A broken invariant: a bug in this program, never a failure of something it depends on. */
export class Panic extends Error {
  override name = "Panic";
}

export function panic(message: string): never {
  throw new Panic(message);
}

/**
 * The `default` of a switch the compiler has checked is exhaustive. Taking `never` makes adding a
 * variant to the union a compile error here until the switch handles it. The value is deliberately
 * left out of the message: it may be outside data, which never travels in an error (DP-3).
 */
export function unreachable(_value: never): never {
  return panic("a case the types rule out");
}
