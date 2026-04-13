import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import type { IPersistence } from '@bluestep-systems/b6p-core';

/**
 * File-based persistence for CLI use.
 *
 * Public state:  `~/.b6p/state/<workspace-hash>.json`
 * Secret state:  `~/.b6p/secrets.json` (chmod 600)
 *
 * The workspace hash scopes public state per-project, matching the behaviour
 * of VS Code's `workspaceState`.
 */
export class DotfilePersistence implements IPersistence {
  private readonly configDir: string;
  private readonly statePath: string;
  private readonly secretsPath: string;

  private stateCache: Record<string, unknown> | null = null;
  private secretsCache: Record<string, string> | null = null;

  constructor(workspacePath: string) {
    this.configDir = path.join(os.homedir(), '.b6p');
    const hash = crypto.createHash('sha256').update(workspacePath).digest('hex').slice(0, 12);
    this.statePath = path.join(this.configDir, 'state', `${hash}.json`);
    this.secretsPath = path.join(this.configDir, 'secrets.json');
  }

  // ── Public state ──────────────────────────────────────────────────

  async get<T>(key: string): Promise<T | undefined> {
    const state = await this.loadState();
    return state[key] as T | undefined;
  }

  async set<T>(key: string, value: T): Promise<void> {
    const state = await this.loadState();
    state[key] = value;
    await this.saveState(state);
  }

  async delete(key: string): Promise<void> {
    const state = await this.loadState();
    delete state[key];
    await this.saveState(state);
  }

  async clearPublic(): Promise<void> {
    this.stateCache = {};
    await this.saveState({});
  }

  // ── Secret state ──────────────────────────────────────────────────

  async getSecret(key: string): Promise<string | undefined> {
    const secrets = await this.loadSecrets();
    return secrets[key];
  }

  async setSecret(key: string, value: string): Promise<void> {
    const secrets = await this.loadSecrets();
    secrets[key] = value;
    await this.saveSecrets(secrets);
  }

  async deleteSecret(key: string): Promise<void> {
    const secrets = await this.loadSecrets();
    delete secrets[key];
    await this.saveSecrets(secrets);
  }

  async clearSecrets(): Promise<void> {
    this.secretsCache = {};
    await this.saveSecrets({});
  }

  // ── Internal ──────────────────────────────────────────────────────

  private async loadState(): Promise<Record<string, unknown>> {
    if (this.stateCache) {
      return this.stateCache;
    }
    this.stateCache = await this.readJsonFile<Record<string, unknown>>(this.statePath) ?? {};
    return this.stateCache;
  }

  private async saveState(state: Record<string, unknown>): Promise<void> {
    this.stateCache = state;
    await this.writeJsonFile(this.statePath, state);
  }

  private async loadSecrets(): Promise<Record<string, string>> {
    if (this.secretsCache) {
      return this.secretsCache;
    }
    this.secretsCache = await this.readJsonFile<Record<string, string>>(this.secretsPath) ?? {};
    return this.secretsCache;
  }

  private async saveSecrets(secrets: Record<string, string>): Promise<void> {
    this.secretsCache = secrets;
    await this.writeJsonFile(this.secretsPath, secrets, 0o600);
  }

  private async readJsonFile<T>(filePath: string): Promise<T | null> {
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  private async writeJsonFile(filePath: string, data: unknown, mode?: number): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    if (mode !== undefined) {
      await fs.chmod(filePath, mode);
    }
  }
}
