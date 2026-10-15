// Run only by meta.test.ts: a server left listening must fail the leak check. It is closed after a
// second, so this process still ends.
import { createServer } from "node:http";
import { test } from "node:test";
import "../../support/leaks.ts";

test("leaves a server listening", () => {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  setTimeout(() => server.close(), 1000).unref();
});
