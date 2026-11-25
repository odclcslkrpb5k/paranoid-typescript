// Run only by meta.test.ts: one Immediate, as Node's fetch leaves when a response completes, fires
// within the turn the leak check allows, so it passes.
import { test } from "node:test";
import "../../support/leaks.ts";

test("leaves one Immediate, which runs a turn later", () => {
  setImmediate(() => undefined);
});
