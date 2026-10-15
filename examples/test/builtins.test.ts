import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import * as v from "valibot";
import { parseBigInt, parseJson, parseUrl } from "../src/adapters/builtins.ts";
import { fails, succeeds } from "./support/assert.ts";
import { propertyRuns } from "./support/properties.ts";
import "./support/leaks.ts";

const Order = v.object({ id: v.string(), lines: v.array(v.object({ qty: v.number() })) });

test("parseJson returns the typed value for conforming text", () => {
  const order = succeeds(parseJson('{"id":"a","lines":[{"qty":2}],"extra":true}', Order));
  assert.deepEqual(order, { id: "a", lines: [{ qty: 2 }] });
});

test("parseJson names malformed text without quoting it", () => {
  assert.deepEqual(fails(parseJson('{"id": "s3cr3t", ', Order)), { kind: "malformed-json" });
});

test("parseJson reports where and what, never the refused value", () => {
  const error = fails(parseJson('{"id":"a","lines":[{"qty":"s3cr3t"}]}', Order));
  assert.deepEqual(error, {
    kind: "schema",
    problems: [{ path: "lines.0.qty", expected: "number" }],
  });
  assert.ok(!JSON.stringify(error).includes("s3cr3t"));
});

test("parseJson hides every record key, even one shaped like a member name", () => {
  const ByUser = v.record(v.string(), v.number());
  const error = fails(
    parseJson('{"someone@example.com":"x","alice":"y","sk_live_51Hx":"z"}', ByUser),
  );
  assert.ok(error.kind === "schema");
  assert.deepEqual(
    error.problems.map((p) => p.path),
    ["?", "?", "?"],
  );
  assert.ok(!/alice|sk_live|someone/.test(JSON.stringify(error)));
});

test("parseJson never throws, whatever the text (TS-16)", () => {
  // `fc.jsonValue()` serialized, rather than `fc.json()`: the ER-4 lint selector that refuses
  // `response.json()` matches by method name and cannot tell the two apart.
  const anyText = fc.oneof(
    fc.string(),
    fc.string({ unit: "binary" }),
    fc.jsonValue().map((value) => JSON.stringify(value)),
  );
  fc.assert(
    fc.property(anyText, (text) => {
      const result = parseJson(text, Order);
      assert.equal(typeof result.ok, "boolean");
    }),
    propertyRuns(),
  );
});

test("parseJson gives back exactly the value that was serialized, for every valid order", () => {
  // Integer quantities, since JSON does not carry -0 or the full range of a double exactly.
  const validOrder = fc.record(
    {
      id: fc.string(),
      lines: fc.array(fc.record({ qty: fc.integer() }, { noNullPrototype: true })),
    },
    { noNullPrototype: true },
  );
  fc.assert(
    fc.property(validOrder, (order) => {
      assert.deepEqual(succeeds(parseJson(JSON.stringify(order), Order)), order);
    }),
    propertyRuns(),
  );
});

test("parseUrl accepts absolute URLs and refuses the rest without throwing", () => {
  assert.equal(succeeds(parseUrl("https://example.com/a?b=c")).hostname, "example.com");
  assert.deepEqual(fails(parseUrl("not a url")), { kind: "malformed-url" });
  fc.assert(
    fc.property(fc.webUrl(), (text) => {
      assert.equal(succeeds(parseUrl(text)).protocol.startsWith("http"), true);
    }),
    propertyRuns(),
  );
  fc.assert(
    fc.property(fc.string({ unit: "binary" }), (text) => {
      assert.equal(typeof parseUrl(text).ok, "boolean");
    }),
    propertyRuns(),
  );
});

test("parseBigInt reads plain decimal integers of any size, and nothing else", () => {
  assert.equal(succeeds(parseBigInt("-9007199254740993")), -9007199254740993n);
  assert.equal(succeeds(parseBigInt("-0")), 0n);
  assert.equal(succeeds(parseBigInt("9".repeat(10_000))).toString().length, 10_000);
  assert.deepEqual(fails(parseBigInt("9".repeat(10_001))), { kind: "not-an-integer" });
  for (const text of ["", "1.5", "1e3", " 1", "0x10", "01", "+1"]) {
    assert.deepEqual(
      fails(parseBigInt(text)),
      { kind: "not-an-integer" },
      `for ${JSON.stringify(text)}`,
    );
  }
});

test("parseBigInt round-trips every bigint and never throws on any string", () => {
  fc.assert(
    fc.property(fc.bigInt(), (n) => {
      assert.equal(succeeds(parseBigInt(n.toString())), n);
    }),
    propertyRuns(),
  );
  fc.assert(
    fc.property(fc.string({ unit: "binary" }), (text) => {
      assert.equal(typeof parseBigInt(text).ok, "boolean");
    }),
    propertyRuns(),
  );
});
