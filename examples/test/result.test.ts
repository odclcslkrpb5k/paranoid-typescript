import assert from "node:assert/strict";
import { test } from "node:test";
import { err, ok, Panic, panic, unreachable, type Result } from "../src/result.ts";
import { fails, must, succeeds } from "./support/assert.ts";
import "./support/leaks.ts";

type Shape = { readonly kind: "circle"; readonly r: number } | { readonly kind: "square" };

function area(shape: Shape): number {
  switch (shape.kind) {
    case "circle":
      return Math.PI * shape.r * shape.r;
    case "square":
      return 1;
    default:
      return unreachable(shape);
  }
}

test("ok and err build the two halves of a Result", () => {
  const good: Result<number, string> = ok(1);
  const bad: Result<number, string> = err("no");
  assert.equal(succeeds(good), 1);
  assert.equal(fails(bad), "no");
});

test("panic throws a Panic, whose name survives logging by class", () => {
  assert.throws(
    () => panic("broken"),
    (e: unknown) => e instanceof Panic && e.name === "Panic",
  );
});

/**
 * A type predicate that lies, which is how a value the types rule out reaches `unreachable` in
 * production too: corrupted input, or a guard elsewhere that is wrong. BD-2 counts a predicate as a
 * coercion for exactly this reason; here the lie is the point of the test.
 */
function pretendImpossible(_value: unknown): _value is never {
  return true;
}

test("unreachable panics without echoing the value it was given", () => {
  const corrupted: unknown = { kind: "hexagon", secret: "s3cr3t" };
  assert.ok(pretendImpossible(corrupted));
  assert.throws(
    () => area(corrupted),
    (e: unknown) => e instanceof Panic && !e.message.includes("s3cr3t"),
  );
});

test("must returns the value, and fails the test with its description when absent", () => {
  const xs = [7];
  assert.equal(must(xs[0], "the first element"), 7);
  assert.throws(() => must(xs[1], "the second element"), /the second element/);
});

test("succeeds and fails refuse the wrong half", () => {
  assert.throws(() => succeeds(err("boom")), /expected success/);
  assert.throws(() => fails(ok(1)), /expected an error/);
});
