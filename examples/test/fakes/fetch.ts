/**
 * Fakes of `fetch` for failures a real server cannot produce on demand. They stand for foreign
 * code, so like an adapter they may reject (ER-3); they never `panic`, which would claim a bug in
 * this program rather than a failure of what it calls.
 */

/** A response whose body delivers its first bytes and then fails, as a dropped connection does. */
export function brokenBodyFetch(): typeof fetch {
  let sent = false;
  const body = new ReadableStream<Uint8Array>({
    // Built in `pull`, not `start`: erroring in `start` empties the queue, so no partial body would
    // ever be delivered and a test using it would prove nothing.
    pull(controller) {
      if (sent) {
        // Shaped like Node's own failure for a dropped body: a TypeError whose cause is the
        // socket error. The adapter tells network failures from bugs by that cause.
        controller.error(new TypeError("terminated", { cause: new Error("other side closed") }));
        return;
      }
      sent = true;
      controller.enqueue(new TextEncoder().encode('{"name":'));
    },
  });
  return async () => new Response(body, { status: 200 });
}

/** A `fetch` that rejects with `error`, standing for a failure inside a client or driver. */
export function rejectingFetch(error: Error): typeof fetch {
  return async () => {
    throw error;
  };
}
