// Fails only under noFallthroughCasesInSwitch: case 1 falls into case 2.
export function pick(x: number): number {
  let y = 0;
  switch (x) {
    case 1:
      y = 1;
    case 2:
      y = 2;
      break;
  }
  return y;
}
