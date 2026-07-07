import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// Replaced at build time by esbuild's `define` with the package.json version
// (see esbuild.js). Used to namespace the SEA extraction dir so a stale lib set
// never survives a CLI upgrade.
declare const __B6P_VERSION__: string;

/** Minimal shape of the Node SEA API we depend on (`node:sea`, newer Node only). */
interface SeaApi {
  isSea(): boolean;
  getAsset(key: string, encoding: string): string;
}

// Single JSON asset embedded in the SEA blob: { "lib.d.ts": "<contents>", ... }.
// Kept in sync with sea-config.json and scripts/build-sea.mjs.
const SEA_LIB_ASSET = "ts-libs.json";
// A file present in every TypeScript lib directory; the core probes for the same
// sentinel, so a dir that has it is a valid `typescriptLibDirs` entry.
const LIB_SENTINEL = "lib.d.ts";

/**
 * Directories to hand the core as `providers.typescriptLibDirs` so its pre-flight
 * TypeScript compile can resolve `lib.*.d.ts` even though b6p-core is bundled —
 * TypeScript's default host looks for them next to `__filename`, i.e. inside the
 * bundle, where none exist.
 *
 * - SEA binary: extract the embedded lib set to a versioned temp dir and use it.
 * - npm bundle: the libs esbuild copied to `dist/lib/`, next to this bundle.
 *
 * Returns `[]` when neither is available (an old-Node npm run without `node:sea`,
 * or a lib-less build); the core then falls back to the target project's own
 * `node_modules/typescript/lib`.
 */
export function resolveTsLibDirs(): string[] {
  const sea = loadSea();
  if (sea?.isSea()) {
    const dir = extractSeaLibs(sea);
    return dir ? [dir] : [];
  }
  const bundled = path.join(__dirname, "lib");
  if (fs.existsSync(path.join(bundled, LIB_SENTINEL))) {
    return [bundled];
  }
  return [];
}

/** Load `node:sea` if the runtime provides it; `undefined` on older Node. */
function loadSea(): SeaApi | undefined {
  try {
    return require("node:sea") as SeaApi;
  } catch {
    return undefined;
  }
}

/**
 * Write the SEA-embedded lib set to a version-stamped temp dir and return it, or
 * `undefined` if the asset is missing or extraction fails. Idempotent: files that
 * already exist are left untouched, so repeat runs are cheap.
 */
function extractSeaLibs(sea: SeaApi): string | undefined {
  try {
    const files = JSON.parse(sea.getAsset(SEA_LIB_ASSET, "utf8")) as Record<string, string>;
    const dir = path.join(os.tmpdir(), "b6p-ts-libs", __B6P_VERSION__);
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, contents] of Object.entries(files)) {
      const dest = path.join(dir, name);
      if (!fs.existsSync(dest)) {
        fs.writeFileSync(dest, contents);
      }
    }
    return fs.existsSync(path.join(dir, LIB_SENTINEL)) ? dir : undefined;
  } catch {
    return undefined;
  }
}
