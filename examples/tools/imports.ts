/**
 * Judges the project's own import graph, whole, against the layers declared in
 * `import-layers.json` (LN-12). Lint judges one file's imports by their text; this judges which
 * file each import reaches, so `../adapters/http.ts` from domain code is refused like a driver
 * import is, and a cycle that only closes across several files is found.
 *
 *   node tools/imports.ts    exit 0 clean, 3 findings, 2 the check itself could not run
 *
 * Every file belongs to the first layer whose patterns match it, and a file no layer matches is a
 * finding. A file may import its own layer and the layers its layer names in `may`. Any import
 * cycle is a finding, within a layer too. Imports are read with the TypeScript parser: static and
 * type-only imports, re-exports, `import()` and `import("...")` types alike. An `import()` whose
 * specifier is not a literal cannot be judged, so it is a finding. Package imports are LN-9's.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

export const LAYERS = "import-layers.json";
const ROOTS = ["src", "test", "tools", "lint"];

export interface Layer {
  readonly name: string;
  readonly patterns: readonly string[];
  readonly may: readonly string[];
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strings(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item === "") return undefined;
    out.push(item);
  }
  return out;
}

/** The layer file, or every reason it cannot be used. */
export function parseLayers(text: string): readonly Layer[] | readonly string[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [`${LAYERS} is not JSON`];
  }
  if (!isRecord(raw) || raw["version"] !== 1 || !Array.isArray(raw["layers"])) {
    return [`${LAYERS} is not {"version": 1, "layers": [...]}`];
  }
  const layers: Layer[] = [];
  const problems: string[] = [];
  raw["layers"].forEach((entry: unknown, index) => {
    const at = `${LAYERS} layer ${String(index + 1)}`;
    if (!isRecord(entry)) {
      problems.push(`${at} is not an object`);
      return;
    }
    const { name } = entry;
    const patterns = strings(entry["patterns"]);
    const may = strings(entry["may"]);
    if (typeof name !== "string" || name === "") problems.push(`${at}: no name`);
    if (patterns === undefined || patterns.length === 0) problems.push(`${at}: no patterns`);
    if (may === undefined) problems.push(`${at}: no "may" list (an empty one is allowed)`);
    if (typeof name === "string" && name !== "" && patterns !== undefined && may !== undefined) {
      if (patterns.length === 0) return;
      if (layers.some((l) => l.name === name)) problems.push(`${at}: ${name} is named twice`);
      layers.push({ name, patterns, may });
    }
  });
  const names = new Set(layers.map((l) => l.name));
  for (const layer of layers) {
    for (const target of layer.may) {
      if (!names.has(target))
        problems.push(`${LAYERS}: ${layer.name} may import ${target}, no layer`);
      if (target === layer.name) problems.push(`${LAYERS}: ${layer.name} names itself in "may"`);
    }
  }
  return problems.length === 0 ? layers : problems;
}

export function isLayers(value: readonly Layer[] | readonly string[]): value is readonly Layer[] {
  return value.every((item) => typeof item !== "string");
}

/** The first layer one of whose patterns matches `file`, a path relative to the project. */
export function layerOf(file: string, layers: readonly Layer[]): Layer | undefined {
  return layers.find((layer) => layer.patterns.some((p) => path.posix.matchesGlob(file, p)));
}

/** A relative specifier found in a file, or `undefined` for an `import()` that is not a literal. */
export type Specifier = string | undefined;

/** Every module specifier one file uses, read by the TypeScript parser. */
export function specifiers(file: string, text: string): readonly Specifier[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found: Specifier[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      found.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [first] = node.arguments;
      found.push(first !== undefined && ts.isStringLiteralLike(first) ? first.text : undefined);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      found.push(node.argument.literal.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** The project's own files each file imports: relative specifiers resolved, packages left out. */
export type Graph = ReadonlyMap<string, readonly Specifier[]>;

/** Each strongly connected group of more than one file, and each file that imports itself. */
export function cycles(graph: Graph): readonly (readonly string[])[] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const found: string[][] = [];
  let next = 0;
  // Tarjan's algorithm, iterative, so a long chain cannot overflow the stack (BD-1).
  for (const start of [...graph.keys()].sort()) {
    if (index.has(start)) continue;
    const work: { node: string; edges: readonly string[]; at: number }[] = [];
    const enter = (node: string): void => {
      index.set(node, next);
      low.set(node, next);
      next += 1;
      stack.push(node);
      onStack.add(node);
      const edges = (graph.get(node) ?? []).filter((e): e is string => e !== undefined);
      work.push({ node, edges: [...new Set(edges)].sort(), at: 0 });
    };
    enter(start);
    while (work.length > 0) {
      const frame = work[work.length - 1];
      if (frame === undefined) break;
      const edge = frame.edges[frame.at];
      if (edge !== undefined) {
        frame.at += 1;
        if (!graph.has(edge)) continue;
        if (!index.has(edge)) {
          enter(edge);
        } else if (onStack.has(edge)) {
          low.set(frame.node, Math.min(low.get(frame.node) ?? 0, index.get(edge) ?? 0));
        }
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent !== undefined) {
        low.set(parent.node, Math.min(low.get(parent.node) ?? 0, low.get(frame.node) ?? 0));
      }
      if (low.get(frame.node) !== index.get(frame.node)) continue;
      const group: string[] = [];
      for (;;) {
        const member = stack.pop();
        if (member === undefined) break;
        onStack.delete(member);
        group.push(member);
        if (member === frame.node) break;
      }
      if (group.length > 1 || frame.edges.includes(frame.node)) found.push(group.sort());
    }
  }
  return found;
}

/** Every problem: unassigned files, unjudgeable imports, imports across layers, and cycles. */
export function judgeImports(graph: Graph, layers: readonly Layer[]): readonly string[] {
  const problems: string[] = [];
  for (const [file, imports] of [...graph].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const from = layerOf(file, layers);
    if (from === undefined) {
      problems.push(`${file}: in no layer of ${LAYERS}`);
      continue;
    }
    for (const target of imports) {
      if (target === undefined) {
        problems.push(`${file}: an import() whose specifier is not a literal cannot be judged`);
        continue;
      }
      const to = layerOf(target, layers);
      if (to === undefined) {
        // The target is reported in its own right if it is a project file; a missing one is tsc's.
        continue;
      }
      if (to.name !== from.name && !from.may.includes(to.name)) {
        problems.push(`${file}: ${from.name} may not import ${to.name} (${target})`);
      }
    }
  }
  for (const group of cycles(graph)) problems.push(`an import cycle: ${group.join(" -> ")}`);
  return problems;
}

/** Every `.ts` file under the roots, as a path relative to the project with `/` separators. */
function projectFiles(): readonly string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(full);
    }
  };
  for (const root of ROOTS) walk(root);
  return files.sort();
}

/** The graph of the project's files: each relative specifier resolved against its file. */
export function buildGraph(files: ReadonlyMap<string, string>): Graph {
  const graph = new Map<string, readonly Specifier[]>();
  for (const [file, text] of files) {
    const targets = specifiers(file, text)
      .filter((s) => s === undefined || s.startsWith("./") || s.startsWith("../"))
      .map((s) => (s === undefined ? s : path.posix.join(path.posix.dirname(file), s)));
    graph.set(file, targets);
  }
  return graph;
}

function fail(message: string): never {
  console.error(`imports: ${message}`);
  process.exit(2);
}

if (import.meta.main) {
  let layerText: string;
  try {
    layerText = readFileSync(LAYERS, "utf8");
  } catch {
    fail(`cannot read ${LAYERS}`);
  }
  const layers = parseLayers(layerText);
  if (!isLayers(layers)) fail(layers.join("\n"));
  const files = new Map(projectFiles().map((file) => [file, readFileSync(file, "utf8")]));
  if (files.size === 0) fail("no files to judge");
  const problems = judgeImports(buildGraph(files), layers);
  for (const problem of problems) console.log(problem);
  process.exit(problems.length === 0 ? 0 : 3);
}
