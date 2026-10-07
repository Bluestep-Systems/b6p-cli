import * as path from "path";
import * as fs from "fs/promises";
import * as os from "os";
import { SharedFilePersistence } from "@bluestep-systems/b6p-core";

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
