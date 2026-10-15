// Fails only under exactOptionalPropertyTypes: an optional member is not "present but undefined".
export const o: { x?: string } = { x: undefined };
