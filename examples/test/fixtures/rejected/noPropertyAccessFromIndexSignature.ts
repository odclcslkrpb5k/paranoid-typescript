// Fails only under noPropertyAccessFromIndexSignature: dot access on an index signature.
declare const row: Record<string, number>;
export const n: number | undefined = row.count;
