import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import { parseCustomerId, parseOrderId, type CustomerId, type OrderId } from "../src/ids.ts";
import { fails, succeeds } from "./support/assert.ts";
import { propertyRuns } from "./support/properties.ts";
import "./support/leaks.ts";

/** Stands for any function that must only ever receive an order id. */
function cancel(id: OrderId): string {
  return `cancelled ${id}`;
}

test("an order id parses from its issued form, and only that", () => {
  const id = succeeds(parseOrderId("ord_abcdefghijklmnop", "order.id"));
  assert.equal(cancel(id), "cancelled ord_abcdefghijklmnop");
  for (const bad of ["ord_ABCDEFGHIJKLMNOP", "ord_abc", "abcdefghijklmnop", 7, null]) {
    assert.deepEqual(fails(parseOrderId(bad, "order.id")), {
      kind: "not-an-id",
      member: "order.id",
    });
  }
});

test("a customer id refuses text, even text holding a number", () => {
  const id: CustomerId = succeeds(parseCustomerId(42, "customer"));
  assert.equal(id, 42);
  for (const bad of ["42", 0, -1, 1.5, 2 ** 53, Number.NaN]) {
    assert.deepEqual(fails(parseCustomerId(bad, "customer")), {
      kind: "not-an-id",
      member: "customer",
    });
  }
});

test("id parse functions never throw, whatever they are given (TS-16)", () => {
  fc.assert(
    fc.property(fc.anything(), (value) => {
      assert.equal(typeof parseOrderId(value, "x").ok, "boolean");
      assert.equal(typeof parseCustomerId(value, "x").ok, "boolean");
    }),
    propertyRuns(),
  );
});

test("every positive safe integer is a customer id", () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }), (n) => {
      assert.equal(succeeds(parseCustomerId(n, "x")), n);
    }),
    propertyRuns(),
  );
});

test("every well-formed order id is accepted", () => {
  const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
  const base32 = fc.integer({ min: 0, max: ALPHABET.length - 1 }).map((i) => ALPHABET.charAt(i));
  const issued = fc.string({ unit: base32, minLength: 16, maxLength: 16 }).map((s) => `ord_${s}`);
  fc.assert(
    fc.property(issued, (text) => {
      assert.equal(succeeds(parseOrderId(text, "x")), text);
    }),
    propertyRuns(),
  );
});
