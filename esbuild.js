const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");
const { version } = require("./package.json");

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

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
const copyTsLibs = {
  name: 'copy-ts-libs',
  setup(build) {
    build.onEnd(() => {
      // require.resolve('typescript') → <pkg>/lib/typescript.js, so its dirname
      // is the lib dir. Robust to hoisting; no hard-coded node_modules path.
      const tsLibDir = path.dirname(require.resolve('typescript'));
      const destDir = path.join('dist', 'lib');
      fs.mkdirSync(destDir, { recursive: true });
      for (const file of fs.readdirSync(tsLibDir)) {
        if (file.startsWith('lib.') && file.endsWith('.d.ts')) {
          fs.copyFileSync(path.join(tsLibDir, file), path.join(destDir, file));
        }
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
    external: ['path', 'fs', 'fs/promises', 'crypto', 'readline/promises', 'url'],
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

main().catch(e => { console.error(e); process.exit(1); });
