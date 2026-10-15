/**
 * Branded identifiers (BD-5). Each is minted only by its schema, so a `string` or a different id
 * cannot be passed where an `OrderId` is wanted. valibot's `brand` action produces the branded type
 * itself, which removes the one cast a hand-written brand constructor would need.
 */
import * as v from "valibot";
import { err, ok, type Result } from "./result.ts";

/** An order id as the order service issues it: `ord_` and 16 lowercase base-32 characters. */
export const OrderIdSchema = v.pipe(v.string(), v.regex(/^ord_[a-z2-7]{16}$/), v.brand("OrderId"));
export type OrderId = v.InferOutput<typeof OrderIdSchema>;

/**
 * A customer id: a positive integer the customer table issues. A safe integer, since anything
 * above 2^53 would need `bigint` (BD-4).
 */
export const CustomerIdSchema = v.pipe(
  v.number(),
  v.safeInteger(),
  v.minValue(1),
  v.brand("CustomerId"),
);
export type CustomerId = v.InferOutput<typeof CustomerIdSchema>;

/** Why a value was refused as an id: the member it came from and the kind of refusal, no value. */
export interface IdError {
  readonly kind: "not-an-id";
  readonly member: string;
}

/**
 * The parse functions take `unknown` and check the JSON type first, so a sender that switches a
 * numeric id to text is refused rather than silently accepted.
 */
export function parseOrderId(value: unknown, member: string): Result<OrderId, IdError> {
  const parsed = v.safeParse(OrderIdSchema, value);
  return parsed.success ? ok(parsed.output) : err({ kind: "not-an-id", member });
}

export function parseCustomerId(value: unknown, member: string): Result<CustomerId, IdError> {
  const parsed = v.safeParse(CustomerIdSchema, value);
  return parsed.success ? ok(parsed.output) : err({ kind: "not-an-id", member });
}
