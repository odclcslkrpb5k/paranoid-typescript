// expect TS2339
// A Result has no value until its `ok` has been checked (ER-1).
import { parseOrderId } from "../../../src/ids.ts";
export const id = parseOrderId("ord_abcdefghijklmnop", "order.id").value;
