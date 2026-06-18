const esbuild = require("esbuild");
const fs = require("fs");

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
    // Bundle @bluestep-systems/b6p-core in (don't externalize) so the CLI is self-contained.
    // Only Node builtins are external; npm-installed deps (commander, fast-xml-parser) get bundled.
    // NOTE: this `external` list is coupled to package.json. Because everything non-builtin is
    // bundled, runtime deps live in `devDependencies`. If you externalize any package here
    // (e.g. to shrink bundle size), move it back to `dependencies` or `npm install` will break.
    external: ['path', 'fs', 'fs/promises', 'crypto', 'readline/promises', 'url'],
    logLevel: 'silent',
    banner: { js: '#!/usr/bin/env node' },
    plugins: [problemMatcher, chmodCli],
  });

  if (watch) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
