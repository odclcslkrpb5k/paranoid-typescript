// Fails only under noImplicitReturns: one path returns a value and the other falls off the end.
export function half(x: boolean) {
  if (x) {
    return 1;
  }
}
