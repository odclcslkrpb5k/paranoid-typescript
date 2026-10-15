// Fails only with allowUnreachableCode false: code after a return.
export function f(): number {
  return 1;
  f();
}
