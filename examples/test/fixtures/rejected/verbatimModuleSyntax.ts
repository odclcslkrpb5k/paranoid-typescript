// Fails only under verbatimModuleSyntax: a type imported without `import type`.
import { Shape } from "./_types.ts";
export const s: Shape = { sides: 3 };
