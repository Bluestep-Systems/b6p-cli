// ClickUp 86bbp800v, item 2: `b6p auth set` stored a gateway token (b6pt_…) without a word, and
// every later call failed with "HTTP Error: 401" from /gql, which reads as platform trouble. The
// guard wraps the prompt the auth provider uses, so the token is refused before it is stored.
import { describe, it } from "node:test";
import assert from "node:assert";
import { BearerAuthProvider } from "@bluestep-systems/b6p-core";
import type { ConfirmOptions, Logger, Persistence, Prompt } from "@bluestep-systems/b6p-core";
import { GatewayTokenError, GatewayTokenGuardPrompt } from "../src/auth/GatewayTokenGuard";

/** A prompt that answers every inputBox from a list and records every other call. */
class ScriptedPrompt implements Prompt {
  readonly calls: string[] = [];
  constructor(private readonly answers: (string | undefined)[]) {}
  async inputBox(options: { prompt: string }): Promise<string | undefined> {
    this.calls.push(`inputBox:${options.prompt}`);
    return this.answers.shift();
  }
  async confirm(message: string, options: string[], opts?: ConfirmOptions): Promise<string | undefined> {
    this.calls.push(`confirm:${message}:${options.join("|")}:${opts?.destructive === true}`);
    return options[0];
  }
  info(message: string): void {
    this.calls.push(`info:${message}`);
  }
  async popup(message: string): Promise<void> {
    this.calls.push(`popup:${message}`);
  }
  warn(message: string): void {
    this.calls.push(`warn:${message}`);
  }
  error(message: string): void {
    this.calls.push(`error:${message}`);
  }
}

/** In-memory secret storage, enough for BearerAuthProvider. */
class MemoryPersistence implements Persistence {
  readonly secrets = new Map<string, string>();
  private readonly values = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }
  async set<T>(key: string, value: T): Promise<void> {
    this.values.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }
  async getSecret(key: string): Promise<string | undefined> {
    return this.secrets.get(key);
  }
  async setSecret(key: string, value: string): Promise<void> {
    this.secrets.set(key, value);
  }
  async deleteSecret(key: string): Promise<void> {
    this.secrets.delete(key);
  }
  async clearPublic(): Promise<void> {
    this.values.clear();
  }
  async clearSecrets(): Promise<void> {
    this.secrets.clear();
  }
}

const quietLogger: Logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

describe("GatewayTokenGuardPrompt", () => {
  it("refuses a gateway token", async () => {
    const guard = new GatewayTokenGuardPrompt(new ScriptedPrompt(["b6pt_abc123"]));
    await assert.rejects(
      () => guard.inputBox({ prompt: "Enter your access token", password: true }),
      (e: unknown) => {
        assert.ok(e instanceof GatewayTokenError, `expected GatewayTokenError, got ${String(e)}`);
        assert.match(e.message, /gateway token \(it starts with b6pt_\)/);
        assert.match(e.message, /Nothing was stored/);
        assert.doesNotMatch(e.message, /abc123/, "the token itself must never be echoed");
        return true;
      }
    );
  });

  it("refuses it with surrounding whitespace too (a paste with a trailing space)", async () => {
    const guard = new GatewayTokenGuardPrompt(new ScriptedPrompt(["  b6pt_abc123 "]));
    await assert.rejects(() => guard.inputBox({ prompt: "Token", password: true }), GatewayTokenError);
  });

  it("passes any other answer, an empty one and a cancel through unchanged", async () => {
    const guard = new GatewayTokenGuardPrompt(new ScriptedPrompt(["cli-token-b6pt_inside", "", undefined]));
    assert.strictEqual(await guard.inputBox({ prompt: "Token" }), "cli-token-b6pt_inside");
    assert.strictEqual(await guard.inputBox({ prompt: "Token" }), "");
    assert.strictEqual(await guard.inputBox({ prompt: "Token" }), undefined);
  });

  it("delegates every other method, ConfirmOptions included", async () => {
    const inner = new ScriptedPrompt([]);
    const guard = new GatewayTokenGuardPrompt(inner);
    assert.strictEqual(await guard.confirm("q?", ["No", "Yes"], { destructive: true, safeOption: "No" }), "No");
    guard.info("i");
    await guard.popup("p");
    guard.warn("w");
    guard.error("e");
    assert.deepStrictEqual(inner.calls, ["confirm:q?:No|Yes:true", "info:i", "popup:p", "warn:w", "error:e"]);
  });
});

describe("BearerAuthProvider behind the guard (what b6p auth set runs)", () => {
  it("stores nothing when the first token entered is a gateway token", async () => {
    const persistence = new MemoryPersistence();
    const auth = new BearerAuthProvider(
      persistence,
      new GatewayTokenGuardPrompt(new ScriptedPrompt(["b6pt_abc123"])),
      quietLogger
    );
    await assert.rejects(() => auth.update(), GatewayTokenError);
    assert.strictEqual(persistence.secrets.size, 0);
    assert.strictEqual(await auth.hasCredentials(), false);
  });

  it("keeps the stored CLI token when a gateway token is entered to replace it", async () => {
    const persistence = new MemoryPersistence();
    const auth = new BearerAuthProvider(
      persistence,
      new GatewayTokenGuardPrompt(new ScriptedPrompt(["cli-token-1", "b6pt_abc123"])),
      quietLogger
    );
    await auth.getOrCreate(); // stores cli-token-1
    const before = [...persistence.secrets.entries()];
    await assert.rejects(() => auth.update(), GatewayTokenError);
    assert.deepStrictEqual([...persistence.secrets.entries()], before);
    assert.strictEqual(await auth.authHeaderValue(), "Bearer cli-token-1");
  });
});
