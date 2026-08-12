import * as path from "path";
import * as fs from "fs/promises";
import * as os from "os";
import { SharedFilePersistence } from "@bluestep-systems/b6p-core";

/**
 * Secret-storage key written by the basic-auth provider that core removed in
 * 0.5.0. Core's `BearerAuthProvider` stores under a different key (`bearerAuth`),
 * so an upgraded install is re-prompted for a token automatically — but the dead
 * username/password pair is only purged if the user happens to run
 * `b6p auth clear`.
 */
const LEGACY_BASIC_AUTH_KEY = "basicAuth";

/**
 * Delete the credentials left behind by the removed basic-auth scheme.
 *
 * Idempotent and safe to run on every invocation: it is a single lookup against
 * the already-loaded secret store, and a no-op once the key is gone. This runs
 * *after* {@link migrateLegacyDotfiles} on purpose — that migration seeds secrets
 * out of the legacy plaintext `~/.b6p/secrets.json`, so purging first would let
 * it re-import the very pair being retired.
 * @lastreviewed null
 */
export async function purgeLegacyBasicAuth(persistence: SharedFilePersistence): Promise<void> {
  if ((await persistence.getSecret(LEGACY_BASIC_AUTH_KEY)) !== undefined) {
    await persistence.deleteSecret(LEGACY_BASIC_AUTH_KEY);
  }
}

/**
 * One-shot migration from previous persistence formats into the shared
 * `~/.b6p/state.json` + `secrets.enc`. Merges every file in the old
 * per-workspace `~/.b6p/state/` directory (the largest one wins on key
 * collision, since that's almost always the VS Code extension's store)
 * and the plaintext `~/.b6p/secrets.json`. Only runs when the shared
 * target file doesn't yet exist.
 * @lastreviewed null
 */
export async function migrateLegacyDotfiles(persistence: SharedFilePersistence): Promise<void> {
  const configDir = path.join(os.homedir(), ".b6p");
  const legacySecretsPath = path.join(configDir, "secrets.json");
  const legacyStateDir = path.join(configDir, "state");

  await persistence.seedIfMissing({
    publicEntries: async () => {
      let entries: { size: number; data: Record<string, unknown> }[] = [];
      try {
        const names = await fs.readdir(legacyStateDir);
        for (const name of names) {
          if (!name.endsWith(".json")) {
            continue;
          }
          const full = path.join(legacyStateDir, name);
          try {
            const raw = await fs.readFile(full, "utf-8");
            const data = JSON.parse(raw) as Record<string, unknown>;
            entries.push({ size: raw.length, data });
          } catch {
            /* skip unreadable */
          }
        }
      } catch {
        /* no legacy dir */
      }
      // Merge small → large so larger files win on collision.
      entries.sort((a, b) => a.size - b.size);
      const merged: Record<string, unknown> = {};
      for (const e of entries) {
        Object.assign(merged, e.data);
      }
      return merged;
    },
    secretEntries: async () => {
      try {
        const raw = await fs.readFile(legacySecretsPath, "utf-8");
        return JSON.parse(raw) as Record<string, string>;
      } catch {
        return {};
      }
    },
  });
}
