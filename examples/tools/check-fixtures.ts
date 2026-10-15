/**
 * Proves the compiler settings are honoured (CP-3) and that the types refuse what they should.
 *
 * - `test/fixtures/rejected/<option>.ts`: one fixture per boolean option in `tsconfig.json`. Each
 *   must fail to compile with the project's settings and compile cleanly with only that option
 *   flipped. An option with no fixture fails the check, so a new setting cannot go unproven.
 * - `test/fixtures/types/*.ts`: code the types must refuse. Each names the error it expects on its
 *   first line (`// expect TS2345`), so a fixture that fails for some other reason is caught too.
 *
 * Files whose names start with `_` are helpers that fixtures import, not fixtures.
 */
import { readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

/** Boolean options that configure output or resolution rather than checking. */
const NOT_CHECKS = new Set(["noEmit", "allowImportingTsExtensions", "skipLibCheck"]);

/**
 * Settings that must stay on when an option is flipped, because another option requires them:
 * `exactOptionalPropertyTypes` is refused without `strictNullChecks`, which `strict` supplies.
 */
const KEEP_WHEN_FLIPPED: Readonly<Record<string, ts.CompilerOptions>> = {
  strict: { strictNullChecks: true },
};

export interface Finding {
  readonly fixture: string;
  readonly problem: string;
}

export function loadOptions(tsconfigPath: string): {
  readonly options: ts.CompilerOptions;
  readonly booleans: ReadonlyMap<string, boolean>;
} {
  const read = ts.readConfigFile(tsconfigPath, (file) => ts.sys.readFile(file));
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(tsconfigPath));
  const raw: unknown = read.config;
  const booleans = new Map<string, boolean>();
  if (typeof raw === "object" && raw !== null && "compilerOptions" in raw) {
    const compilerOptions: unknown = raw.compilerOptions;
    if (typeof compilerOptions === "object" && compilerOptions !== null) {
      for (const [key, value] of Object.entries(compilerOptions)) {
        if (typeof value === "boolean" && !NOT_CHECKS.has(key)) booleans.set(key, value);
      }
    }
  }
  return { options: parsed.options, booleans };
}

/**
 * The errors reported in `file` itself. Without ambient `types` (fixtures need none, and loading
 * @types/node for each one is most of the cost of the check) a library that mentions Node's
 * globals reports errors of its own; those say nothing about the fixture, so they are left out.
 */
export function diagnostics(file: string, options: ts.CompilerOptions): readonly ts.Diagnostic[] {
  const program = ts.createProgram([file], { ...options, types: [], noEmit: true });
  const target = path.resolve(file);
  return ts
    .getPreEmitDiagnostics(program)
    .filter((d) => d.file === undefined || path.resolve(d.file.fileName) === target);
}

function isFixture(name: string): boolean {
  return name.endsWith(".ts") && !name.startsWith("_");
}

export function checkRejected(
  directory: string,
  options: ts.CompilerOptions,
  booleans: ReadonlyMap<string, boolean>,
): readonly Finding[] {
  const findings: Finding[] = [];
  const fixtures = new Set(
    readdirSync(directory)
      .filter(isFixture)
      .map((name) => name.slice(0, -".ts".length)),
  );
  for (const [option, value] of booleans) {
    const file = path.join(directory, `${option}.ts`);
    if (!fixtures.has(option)) {
      findings.push({ fixture: file, problem: `the option ${option} has no fixture` });
      continue;
    }
    if (diagnostics(file, options).length === 0) {
      findings.push({ fixture: file, problem: `compiles with ${option} set; it should not` });
    }
    const flipped = diagnostics(file, {
      ...options,
      [option]: !value,
      ...KEEP_WHEN_FLIPPED[option],
    });
    if (flipped.length > 0) {
      const codes = flipped.map((d) => `TS${String(d.code)}`).join(", ");
      findings.push({ fixture: file, problem: `fails even with ${option} flipped (${codes})` });
    }
  }
  for (const name of fixtures) {
    if (!booleans.has(name)) {
      findings.push({
        fixture: path.join(directory, `${name}.ts`),
        problem: "a fixture for an option tsconfig.json does not set",
      });
    }
  }
  return findings;
}

export function checkTypes(directory: string, options: ts.CompilerOptions): readonly Finding[] {
  const findings: Finding[] = [];
  for (const name of readdirSync(directory).filter(isFixture)) {
    const file = path.join(directory, name);
    const firstLine = ts.sys.readFile(file)?.split("\n", 1)[0] ?? "";
    const expected = /^\/\/ expect TS(\d+)$/.exec(firstLine)?.[1];
    if (expected === undefined) {
      findings.push({ fixture: file, problem: "the first line does not say `// expect TS<code>`" });
      continue;
    }
    // Every error must be the expected one: a fixture that also fails for another reason no longer
    // proves what it claims.
    const codes = diagnostics(file, options).map((d) => String(d.code));
    if (codes.length === 0 || codes.some((code) => code !== expected)) {
      const got = codes.length === 0 ? "no error" : codes.map((c) => `TS${c}`).join(", ");
      findings.push({ fixture: file, problem: `expected TS${expected}, got ${got}` });
    }
  }
  return findings;
}

if (import.meta.main) {
  const root = path.dirname(import.meta.dirname);
  const { options, booleans } = loadOptions(path.join(root, "tsconfig.json"));
  if (booleans.size === 0) {
    console.error(
      "check-fixtures: no boolean options read from tsconfig.json; the check is broken",
    );
    process.exit(2);
  }
  const findings = [
    ...checkRejected(path.join(root, "test/fixtures/rejected"), options, booleans),
    ...checkTypes(path.join(root, "test/fixtures/types"), options),
  ];
  for (const f of findings) console.error(`${path.relative(root, f.fixture)}: ${f.problem}`);
  console.log(
    `check-fixtures: ${String(booleans.size)} options, ${String(findings.length)} findings`,
  );
  process.exit(findings.length === 0 ? 0 : 1);
}
