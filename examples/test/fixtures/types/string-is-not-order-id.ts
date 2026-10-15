// expect TS2345
// A plain string is not an order id: only the parse function mints one (BD-5).
import type { OrderId } from "../../../src/ids.ts";
declare function cancel(id: OrderId): void;
cancel("ord_abcdefghijklmnop");
