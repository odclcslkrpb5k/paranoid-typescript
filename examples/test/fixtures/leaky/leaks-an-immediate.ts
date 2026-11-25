// Run only by meta.test.ts: an Immediate that schedules itself again outlives the one turn the
// leak check allows, so it must fail. It stops after a second, so this process still ends.
import { test } from "node:test";
import "../../support/leaks.ts";

test("leaves an Immediate rescheduling itself", () => {
  const until = Date.now() + 1000;
  const tick = (): void => {
    if (Date.now() < until) setImmediate(tick);
  };
  setImmediate(tick);
});
