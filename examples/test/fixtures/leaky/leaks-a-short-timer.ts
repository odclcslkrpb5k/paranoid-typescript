// Run only by meta.test.ts: a timer shorter than the leak check's settling window must still fail.
import { test } from "node:test";
import "../../support/leaks.ts";

test("leaves a short timer pending", () => {
  setTimeout(() => undefined, 150);
});
