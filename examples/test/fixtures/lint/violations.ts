// Each marked line must draw exactly the findings its marker names, and no unmarked line may draw
// any; lint-config.test.ts lints this file with the project's real configuration.
import { err, ok, type Result } from "../../../src/result.ts";
import "node:crypto"; // expect: no-restricted-imports

declare function save(): Result<void, "conflict">;
declare const maybe: string | undefined;
declare const count: number;

export function throws(): void {
  throw new Error("x"); // expect: no-restricted-syntax
}

export async function rejects(): Promise<void> {
  await Promise.reject(new Error("x")); // expect: no-restricted-syntax
}

export function catches(): Result<number, "bad"> {
  try {
    return ok(1);
  } catch { // expect: no-restricted-syntax
    return err("bad");
  }
}

export function handleRequestNet(): Result<number, "bad"> {
  try {
    return ok(1);
  } catch {
    return err("bad");
  }
}

export const length = maybe!.length; // expect: @typescript-eslint/no-non-null-assertion
export const cast = maybe as string; // expect: @typescript-eslint/consistent-type-assertions
export const url = new URL("https://example.com"); // expect: no-restricted-syntax
export const parsed: unknown = JSON.parse("{}"); // expect: no-restricted-properties
export const big = BigInt("1"); // expect: no-restricted-globals

export function truthy(): string {
  return count ? "some" : "none"; // expect: @typescript-eslint/strict-boolean-expressions
}

export function discards(): void {
  save(); // expect: paranoid/must-use-result
}

export async function handles(p: Promise<number>): Promise<number> {
  return await p.catch(() => 0); // expect: no-restricted-syntax
}

export async function handlesBoth(p: Promise<number>): Promise<number> {
  return await p.then((n) => n, () => 0); // expect: no-restricted-syntax
}

export async function handlesComputed(p: Promise<number>): Promise<number> {
  return await p["catch"](() => 0); // expect: no-restricted-syntax
}

export async function rejectsByTemplate(): Promise<void> {
  await Promise[`reject`](new Error("x")); // expect: no-restricted-syntax
}

export const built = new Promise<void>((_resolve, reject) => { // expect: no-restricted-syntax
  reject(new Error("x"));
});

export async function readsJson(response: Response): Promise<unknown> {
  return await response.json(); // expect: no-restricted-syntax
}

export const encoded = encodeURIComponent("x"); // expect: no-restricted-globals

export function logs(): void {
  console.log("x"); // expect: no-console
}

export const suppressed = 1; // eslint-disable-line no-console -- expect: @eslint-community/eslint-comments/no-use, unused-directive
