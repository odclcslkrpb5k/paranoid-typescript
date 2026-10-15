/**
 * The HTTP adapter against a real loopback server (TS-9), plus an injected `fetch` for the one
 * failure a server cannot produce on demand: a body that starts and then breaks.
 */
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, test } from "node:test";
import * as v from "valibot";
import { parseUrl } from "../src/adapters/builtins.ts";
import { getJson } from "../src/adapters/http.ts";
import { Panic } from "../src/result.ts";
import { brokenBodyFetch, rejectingFetch } from "./fakes/fetch.ts";
import { fails, must, succeeds } from "./support/assert.ts";
import "./support/leaks.ts";

const Thing = v.object({ name: v.string() });

let server: Server;
let base: URL;
const pending = new Set<() => void>();

before(async () => {
  server = createServer((request, response) => {
    // Node's fetch keeps connections open for reuse; closing each one keeps the pool out of the
    // leak check's counts (TS-3), which would otherwise report it as the test's leak.
    response.shouldKeepAlive = false;
    // A slow response whose client has given up is finished at once, so its socket closes.
    response.on("close", () => {
      for (const finish of pending) finish();
      pending.clear();
    });
    // `url` is `string | undefined`; LN-3 refuses a default as covering `undefined`.
    switch (request.url ?? "") {
      case "/thing":
        response.setHeader("content-type", "application/json");
        response.end('{"name":"widget"}');
        return;
      case "/missing":
        response.statusCode = 404;
        response.end("not here: s3cr3t");
        return;
      case "/garbled":
        response.end("{not json s3cr3t");
        return;
      case "/wrong-shape":
        response.end('{"name":42}');
        return;
      case "/slow-headers":
        // Answers late rather than never, so `server.close()` can finish (TS-9).
        pending.add(() => response.end("{}"));
        return;
      case "/slow-body":
        response.write('{"name":');
        pending.add(() => response.end('"late"}'));
        return;
      default:
        response.statusCode = 500;
        response.end();
    }
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  base = succeeds(parseUrl(`http://127.0.0.1:${String(address.port)}`));
});

after(async () => {
  for (const finish of pending) finish();
  server.closeAllConnections();
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

const at = (path: string): URL => succeeds(parseUrl(`${base.origin}${path}`));

test("a conforming body comes back typed", async () => {
  assert.deepEqual(succeeds(await getJson(at("/thing"), Thing, { timeoutMs: 2000 })), {
    name: "widget",
  });
});

test("a non-2xx status is its own error, without the body", async () => {
  const error = fails(await getJson(at("/missing"), Thing, { timeoutMs: 2000 }));
  assert.deepEqual(error, { kind: "status", status: 404 });
});

test("malformed JSON and a wrong shape are told apart, neither quoting the body", async () => {
  const garbled = fails(await getJson(at("/garbled"), Thing, { timeoutMs: 2000 }));
  assert.deepEqual(garbled, { kind: "malformed-json" });
  const wrong = fails(await getJson(at("/wrong-shape"), Thing, { timeoutMs: 2000 }));
  assert.deepEqual(wrong, { kind: "schema", problems: [{ path: "name", expected: "string" }] });
  assert.ok(!JSON.stringify([garbled, wrong]).includes("s3cr3t"));
});

test("the deadline covers waiting for headers", async () => {
  assert.deepEqual(fails(await getJson(at("/slow-headers"), Thing, { timeoutMs: 100 })), {
    kind: "timeout",
  });
});

test("the deadline also covers the body, which arrives after fetch has resolved (SV-20)", async () => {
  assert.deepEqual(fails(await getJson(at("/slow-body"), Thing, { timeoutMs: 100 })), {
    kind: "timeout",
  });
});

test("the caller's own cancellation is reported as aborted, not as a timeout", async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await getJson(at("/thing"), Thing, { timeoutMs: 2000, signal: controller.signal });
  assert.deepEqual(fails(result), { kind: "aborted" });
});

test("a refused connection is a network error, and the URL never reaches it", async () => {
  // A port taken from a listener that is then closed: a runtime may refuse some ports before
  // connecting at all, which would make the test pass without testing anything (DP-6).
  const probe = createServer();
  await new Promise<void>((resolve) => {
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = must(probe.address(), "the probe's address");
  assert.ok(typeof address === "object");
  await new Promise<void>((resolve) => {
    probe.close(() => {
      resolve();
    });
  });
  const url = succeeds(parseUrl(`http://127.0.0.1:${String(address.port)}/thing?token=s3cr3t`));
  const error = fails(await getJson(url, Thing, { timeoutMs: 2000 }));
  assert.deepEqual(error, { kind: "network" });
});

test("a body that starts and then breaks fails inside the adapter (ER-3)", async () => {
  const options = { timeoutMs: 2000, fetch: brokenBodyFetch() };
  assert.deepEqual(fails(await getJson(at("/thing"), Thing, options)), { kind: "network" });
});

test("something unrecognised is unexpected, named by class, never a network error", async () => {
  class DriverBug extends Error {
    override name = "DriverBug";
  }
  const options = { timeoutMs: 2000, fetch: rejectingFetch(new DriverBug("internal detail")) };
  const error = fails(await getJson(at("/thing"), Thing, options));
  assert.deepEqual(error, { kind: "unexpected", name: "DriverBug" });
});

test("an abort with a reason, mid-flight, is reported as aborted", async () => {
  const controller = new AbortController();
  setTimeout(() => {
    controller.abort(new Error("shutting down"));
  }, 20);
  const options = { timeoutMs: 2000, signal: controller.signal };
  assert.deepEqual(fails(await getJson(at("/slow-headers"), Thing, options)), { kind: "aborted" });
});

test("an abort during the body read is reported as aborted", async () => {
  const controller = new AbortController();
  setTimeout(() => {
    controller.abort("shutdown");
  }, 20);
  const options = { timeoutMs: 2000, signal: controller.signal };
  assert.deepEqual(fails(await getJson(at("/slow-body"), Thing, options)), { kind: "aborted" });
});

test("a timeout the timer cannot hold is a bug in the caller, and panics", async () => {
  for (const timeoutMs of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 31]) {
    await assert.rejects(getJson(at("/thing"), Thing, { timeoutMs }), Panic, String(timeoutMs));
  }
});

test("fetch refusing a request it was given is unexpected, not an outage", async () => {
  // Credentials in the URL make fetch throw a TypeError with no cause: a bug, never a network
  // failure. The credential must not reach the error either (DP-6).
  const url = succeeds(parseUrl(`http://user:s3cr3t@127.0.0.1:${base.port}/thing`));
  const error = fails(await getJson(url, Thing, { timeoutMs: 2000 }));
  assert.deepEqual(error, { kind: "unexpected", name: "TypeError" });
});
