// Fails only under noUncheckedIndexedAccess: an index read may be undefined.
const xs: number[] = [];
export const first: number = xs[0];
