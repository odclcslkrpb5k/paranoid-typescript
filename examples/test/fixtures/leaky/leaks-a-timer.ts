// Run only by meta.test.ts, to prove the leak check fails a test that leaves a timer behind. The
// timer is ref'd (the check cannot see an unref'd one) and fires once, so this process still ends.
import { test } from "node:test";
import "../../support/leaks.ts";

test("leaves a timer pending", () => {
  setTimeout(() => undefined, 1500);
});
