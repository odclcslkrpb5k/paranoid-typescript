// expect TS2345
// An order id is not a customer id, though both are minted from plain values (BD-5).
import { parseOrderId, type CustomerId } from "../../../src/ids.ts";
declare function charge(id: CustomerId): void;
const parsed = parseOrderId("ord_abcdefghijklmnop", "order.id");
if (parsed.ok) charge(parsed.value);
