const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");
const { version } = require("./package.json");

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

// Node builtins that must stay external in EVERY build here, including the test
// build in esbuild.test.js — which is why this is exported rather than inlined.
// `platform: 'node'` alone is not enough: esbuild does not treat the bare subpath
// form `readline/promises` as a builtin (only `readline` and `node:readline/…`),
// so a build without this list fails to resolve CliPrompt's import.
const NODE_EXTERNALS = ['path', 'fs', 'fs/promises', 'crypto', 'readline/promises', 'url'];
module.exports = { NODE_EXTERNALS };

const problemMatcher = {
  name: 'esbuild-problem-matcher',
  setup(build) {
    build.onStart(() => console.log('[watch] build started'));
    build.onEnd((result) => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`);
        if (location) {
          console.error(`    ${location.file}:${location.line}:${location.column}:`);
        }
      });
      console.log('[watch] build finished');
    });
  },
};

const chmodCli = {
  name: 'chmod-cli',
  setup(build) {
    build.onEnd(() => {
      try { fs.chmodSync('dist/cli.js', 0o755); } catch {}
    });
  },
};

// Ship TypeScript's standard library declarations next to the bundle so the
// core's bundled compile can resolve them — once bundled, TS can't find them
// relative to __filename. Copy the whole set so any lib/target combination
// resolves; the SEA binary embeds these instead (scripts/build-sea.mjs).
//
// These libs must match the compiler that READS them, which is the TypeScript
// esbuild bundled into dist/cli.js — i.e. b6p-core's own `typescript` (an exact
// pin in its `dependencies`), NOT this package's devDependency. The two are
// deliberately different majors: we type-check with TS 7 while core still
// transpiles with TS 5, so resolving from the repo root here would ship TS 7
// lib.*.d.ts to a TS 5 compiler and break `b6p push --snapshot`. Resolve from
// core's directory so the libs always track the bundled compiler.
const copyTsLibs = {
  name: 'copy-ts-libs',
  setup(build) {
    build.onEnd(() => {
      // require.resolve('typescript') → <pkg>/lib/typescript.js, so its dirname
      // is the lib dir. Resolved from core's own location, so it finds core's
      // nested copy when npm can't dedupe it to the root. No hard-coded path.
      const coreDir = path.dirname(require.resolve('@bluestep-systems/b6p-core/package.json'));
      const tsLibDir = path.dirname(require.resolve('typescript', { paths: [coreDir] }));
      const destDir = path.join('dist', 'lib');
      // Rebuild from scratch so a TypeScript upgrade can't leave stale (removed
      // or renamed) lib.*.d.ts behind to be shipped.
      fs.rmSync(destDir, { recursive: true, force: true });
      fs.mkdirSync(destDir, { recursive: true });
      let copied = 0;
      for (const file of fs.readdirSync(tsLibDir)) {
        if (file.startsWith('lib.') && file.endsWith('.d.ts')) {
          fs.copyFileSync(path.join(tsLibDir, file), path.join(destDir, file));
          copied++;
        }
      }
      if (copied === 0) {
        throw new Error(`copy-ts-libs: no lib.*.d.ts found in ${tsLibDir}`);
      }

      // Assert the libs we just shipped belong to the compiler that actually got
      // bundled. Both are meant to be core's TypeScript, but nothing else forces
      // that: resolving from the repo root instead looks like a harmless tidy-up,
      // and today it fails loudly only because TS 7 ships no lib.*.d.ts at all.
      // Once core moves to TS 7 that accident disappears and a mismatch would
      // ship silently, breaking `b6p push --snapshot` at runtime with
      // "Cannot find global type 'Array'" for users while every build stayed
      // green. Cheap end-to-end check: the bundled compiler embeds its own
      // version string.
      const tsVersion = require(path.join(tsLibDir, '..', 'package.json')).version;
      const bundle = fs.readFileSync('dist/cli.js', 'utf8');
      if (!bundle.includes(`"${tsVersion}"`)) {
        throw new Error(
          `copy-ts-libs: shipped lib.*.d.ts came from TypeScript ${tsVersion}, but dist/cli.js does not ` +
            `embed that version — the bundled compiler and its standard library have diverged. ` +
            `Both must resolve from b6p-core (${coreDir}).`
        );
      }
    });
  },
};

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ['src/index.ts'],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    outfile: 'dist/cli.js',
    // Inject the package version at build time. The CLI ships as a single bundle
    // (and as a SEA binary) with no package.json available at runtime, so the
    // version can't be require()'d — esbuild replaces __B6P_VERSION__ inline.
    define: { __B6P_VERSION__: JSON.stringify(version) },
    // Bundle @bluestep-systems/b6p-core in (don't externalize) so the CLI is self-contained.
    // Only Node builtins are external; npm-installed deps (commander, fast-xml-parser) get bundled.
    // NOTE: this `external` list is coupled to package.json. Because everything non-builtin is
    // bundled, runtime deps live in `devDependencies`. If you externalize any package here
    // (e.g. to shrink bundle size), move it back to `dependencies` or `npm install` will break.
    external: NODE_EXTERNALS,
    logLevel: 'silent',
    banner: { js: '#!/usr/bin/env node' },
    plugins: [problemMatcher, chmodCli, copyTsLibs],
  });

  if (watch) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

// Only build when run directly (`node esbuild.js`). esbuild.test.js requires this
// file for NODE_EXTERNALS, and must not kick off a dist/ build by doing so.
if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}
