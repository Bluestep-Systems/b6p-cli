// Spec for the dual-TypeScript arrangement.
//
// This package type-checks with TypeScript 7 (a devDependency) while b6p-core
// transpiles snapshot pushes with an exact-pinned TypeScript 5.9.2 in its own
// dependencies. npm cannot dedupe the two, and it is core's copy that esbuild
// bundles into dist/cli.js — so the `lib.*.d.ts` shipped in dist/lib must match
// core's compiler, not the root one.
//
// Nothing in the type system can catch a mismatch: it surfaces only at runtime,
// as "Cannot find global type 'Array'" for a user running `b6p push --snapshot`.
// These tests exercise the real path instead.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO = path.join(__dirname, "..");
const DIST_LIB = path.join(REPO, "dist", "lib");
// createRequire rather than a bare require(): the specifier is dynamic, so
// esbuild must leave it alone instead of trying to inline a second compiler.
const req = createRequire(__filename);

const CORE_DIR = path.dirname(req.resolve("@bluestep-systems/b6p-core/package.json", { paths: [REPO] }));
const CORE_TS_ENTRY = req.resolve("typescript", { paths: [CORE_DIR] });
const CORE_TS_LIB_DIR = path.dirname(CORE_TS_ENTRY);
const CORE_TS_VERSION: string = req(path.join(CORE_TS_LIB_DIR, "..", "package.json")).version;

/**
 * The slice of the TypeScript API this spec drives.
 *
 * Declared structurally rather than imported: importing `typescript` would bind
 * to the *root* TS 7, which is precisely the compiler under test that must not
 * be involved. The value comes from core's install at runtime.
 * @lastreviewed null
 */
interface TsDiagnostic {
  messageText: string | { messageText: string };
}
interface TsProgram {
  emit(): { emitSkipped: boolean };
}
interface TsCompilerHost {
  getSourceFile(name: string, languageVersion: unknown, ...rest: unknown[]): unknown;
  writeFile(...args: unknown[]): void;
  getDefaultLibLocation?(): string;
  getDefaultLibFileName(options: unknown): string;
}
interface TsLike {
  version: string;
  ScriptTarget: { ES2022: number };
  ModuleKind: { ESNext: number };
  createCompilerHost(options: unknown): TsCompilerHost;
  createSourceFile(name: string, text: string, languageVersion: unknown, setParentNodes: boolean): unknown;
  createProgram(rootNames: string[], options: unknown, host: TsCompilerHost): TsProgram;
  getPreEmitDiagnostics(program: TsProgram): TsDiagnostic[];
  flattenDiagnosticMessageText(messageText: TsDiagnostic["messageText"], separator: string): string;
  getDefaultLibFileName(options: unknown): string;
}

const ts: TsLike = req(CORE_TS_ENTRY);

test("the compiler that gets bundled is core's, not the root devDependency", () => {
  const rootVersion: string = req(path.join(REPO, "node_modules", "typescript", "package.json")).version;
  assert.equal(ts.version, CORE_TS_VERSION);
  assert.notEqual(
    ts.version,
    rootVersion,
    "core and root TypeScript are the same version — this spec's premise no longer holds, re-check esbuild.js"
  );
  // The bundled compiler embeds its own version string. If dist/cli.js carried
  // the ROOT version, esbuild would be bundling the wrong compiler and dist/lib
  // would be the wrong standard library for it.
  const bundle = fs.readFileSync(path.join(REPO, "dist", "cli.js"), "utf8");
  assert.ok(bundle.includes(`"${CORE_TS_VERSION}"`), `dist/cli.js should embed TypeScript ${CORE_TS_VERSION}`);
  assert.ok(!bundle.includes(`"${rootVersion}"`), `dist/cli.js must not embed the root TypeScript ${rootVersion}`);
});

test("dist/lib carries exactly the lib set of the bundled compiler", () => {
  // Not a subset: a project tsconfig may name any target or `lib`, and a missing
  // file degrades into "Cannot find global type" rather than a clear error.
  const libsOf = (dir: string): string[] =>
    fs
      .readdirSync(dir)
      .filter((f) => f.startsWith("lib.") && f.endsWith(".d.ts"))
      .sort();

  const shipped = libsOf(DIST_LIB);
  assert.deepEqual(shipped, libsOf(CORE_TS_LIB_DIR));
  assert.ok(shipped.length > 0, "no lib.*.d.ts shipped at all");
  // Content, not just names — a same-named lib from a different major differs.
  for (const name of ["lib.d.ts", "lib.es2022.full.d.ts", "lib.dom.d.ts"]) {
    assert.equal(
      fs.readFileSync(path.join(DIST_LIB, name), "utf8"),
      fs.readFileSync(path.join(CORE_TS_LIB_DIR, name), "utf8"),
      `${name} differs from the bundled compiler's copy`
    );
  }
});

test("the bundled compiler can compile ES2022 using only the shipped libs", () => {
  // The end-to-end proof: this is what `b6p script push --snapshot` does, with
  // dist/lib standing in for a lib directory TypeScript cannot find on its own
  // once bundled (its default lookup is relative to __filename).
  const source = `
    export const doubled: number[] = [1, 2, 3].map((n) => n * 2);
    export class Counter {
      static #created = 0;
      #count = 0;
      static { Counter.#created = 0; }
      increment(): number { return ++this.#count; }
      static get created(): number { return Counter.#created; }
    }
    export async function run(): Promise<Map<string, number>> {
      const m = new Map<string, number>();
      m.set("last", doubled.at(-1) ?? 0);
      console.log(Object.entries(m), JSON.stringify([...m]));
      return m;
    }
  `;
  const file = path.join(REPO, "__ts-libs-probe__.ts");
  const options = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    strict: true,
    skipLibCheck: true,
    noEmitOnError: false,
  };

  const host = ts.createCompilerHost(options);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (name: string, languageVersion: unknown, ...rest: unknown[]) =>
    name === file
      ? ts.createSourceFile(name, source, languageVersion, true)
      : originalGetSourceFile(name, languageVersion, ...rest);
  host.writeFile = () => {};
  // Exactly the override ScriptTranspiler.createProgram applies when the CLI
  // supplies `typescriptLibDirs` (see src/tsLibs.ts).
  host.getDefaultLibLocation = () => DIST_LIB;
  host.getDefaultLibFileName = (o: unknown) => path.join(DIST_LIB, ts.getDefaultLibFileName(o));

  const program = ts.createProgram([file], options, host);
  const messages = ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, " "));

  assert.deepEqual(messages, [], "compiling against the shipped libs produced diagnostics");
  assert.equal(program.emit().emitSkipped, false, "emit was skipped");
});

test("the shipped libs are what the CLI actually points the compiler at", () => {
  // src/tsLibs.ts resolves `<dir of cli.js>/lib` on the npm path. Assert the
  // directory it will find is the one the previous tests verified, and that the
  // published package really contains it (`files: ["dist", ...]`).
  const cliDir = path.dirname(path.join(REPO, "dist", "cli.js"));
  assert.equal(path.join(cliDir, "lib"), DIST_LIB);
  assert.ok(fs.existsSync(path.join(DIST_LIB, "lib.d.ts")), "sentinel lib.d.ts missing — resolveTsLibDirs returns []");
});
