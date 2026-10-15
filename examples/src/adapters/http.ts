/**
 * An HTTP adapter for reading JSON (ER-3, SV-20). It meets `fetch` in one place, gives every attempt
 * a deadline that covers the body as well as the headers, classifies each failure, and returns a
 * `Result`. Errors never carry the URL, a response body or the runtime's message: the URL can hold
 * a credential and the body anything the server chose to send (DP-3, DP-6).
 *
 * The body is read whole before it is parsed. A production adapter reading from an untrusted
 * server would also cap its size; this example does not.
 */
import type * as v from "valibot";
import { err, panic, type Result } from "../result.ts";
import { parseJson, type ParseError } from "./builtins.ts";

export type HttpError =
  | { readonly kind: "timeout" }
  | { readonly kind: "aborted" }
  | { readonly kind: "network" }
  | { readonly kind: "status"; readonly status: number }
  | ParseError
  | { readonly kind: "unexpected"; readonly name: string };

export interface GetJsonOptions {
  /**
   * The deadline for one attempt, headers and body together (SV-20), in whole milliseconds from 1
   * to 2^31 - 1, the range a timer accepts. Anything else is a bug in the caller and panics.
   */
  readonly timeoutMs: number;
  /** The caller's own cancellation, such as a shutdown in progress (SV-4). */
  readonly signal?: AbortSignal;
  /** Injected so tests can drive failures a real server cannot produce on demand. */
  readonly fetch?: typeof globalThis.fetch;
}

const MAX_TIMER_MS = 2 ** 31 - 1;

export async function getJson<S extends v.GenericSchema>(
  url: URL,
  schema: S,
  options: GetJsonOptions,
): Promise<Result<v.InferOutput<S>, HttpError>> {
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1) {
    return panic("getJson: timeoutMs must be a whole number of milliseconds, at least 1");
  }
  if (options.timeoutMs > MAX_TIMER_MS) return panic("getJson: timeoutMs exceeds a timer's range");
  const timeout = AbortSignal.timeout(options.timeoutMs);
  const signal =
    options.signal === undefined ? timeout : AbortSignal.any([timeout, options.signal]);
  const doFetch = options.fetch ?? globalThis.fetch;

  let status: number;
  let text: string;
  try {
    const response = await doFetch(url, { signal, headers: { accept: "application/json" } });
    status = response.status;
    // Read inside the same `try` and under the same signal: `fetch` resolves once the headers
    // arrive, so a connection that drops mid-body fails here, not in the caller.
    text = await response.text();
  } catch (error: unknown) {
    return err(classify(error, timeout, options.signal));
  }

  if (status < 200 || status > 299) return err({ kind: "status", status });
  return parseJson(text, schema);
}

/**
 * Sorts a thrown value. Which signal fired is read from the signals themselves, not from the
 * error: `fetch` rejects with the signal's reason, which for a caller's abort can be any value the
 * caller chose. A network failure is a `TypeError` carrying a `cause`; a `TypeError` without one
 * comes from `fetch` refusing the request itself (credentials in the URL, a bad header), which is
 * a bug in this program and so "unexpected", never an outage.
 */
function classify(error: unknown, timeout: AbortSignal, caller?: AbortSignal): HttpError {
  if (timeout.aborted) return { kind: "timeout" };
  if (caller?.aborted === true) return { kind: "aborted" };
  if (error instanceof TypeError && error.cause !== undefined) return { kind: "network" };
  return { kind: "unexpected", name: error instanceof Error ? error.name : typeof error };
}
