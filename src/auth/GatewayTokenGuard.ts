import type { ConfirmOptions, Prompt } from "@bluestep-systems/b6p-core";

/**
 * The prefix of a BlueStep AI gateway token. It authenticates the AI tools, not the b6p CLI:
 * stored as the CLI's access token, every request then fails with `HTTP Error: 401` from `/gql`,
 * which reads as platform trouble (ClickUp 86bbp800v, item 2).
 * @lastreviewed null
 */
export const GATEWAY_TOKEN_PREFIX = "b6pt_";

/**
 * Thrown when a gateway token is entered where the CLI access token is asked for. Nothing has been
 * stored at that point.
 * @lastreviewed null
 */
export class GatewayTokenError extends Error {
  constructor() {
    super(
      `That is a gateway token (it starts with ${GATEWAY_TOKEN_PREFIX}), used by the BlueStep AI tools. ` +
        `b6p needs a CLI access token instead. Nothing was stored.`
    );
    this.name = "GatewayTokenError";
  }
}

/**
 * The prompt handed to the auth provider, and only to it: every `inputBox` that
 * `BearerAuthProvider` makes asks for the access token (on first use from any command, and from
 * `b6p auth set`), so checking its answers here stops a gateway token before it is stored, with no
 * need to recognize the question's text. Everything else passes straight through.
 *
 * It throws rather than asking again: with piped input, a second question would take the next
 * line meant for something else.
 * @lastreviewed null
 */
export class GatewayTokenGuardPrompt implements Prompt {
  constructor(private readonly inner: Prompt) {}

  /**
   * Ask through the wrapped prompt, and refuse a gateway token.
   * @param options As {@link Prompt.inputBox}
   * @returns The answer, unchanged
   * @throws a {@link GatewayTokenError} when the answer, trimmed, starts with `b6pt_`
   * @lastreviewed null
   */
  async inputBox(options: { prompt: string; password?: boolean; value?: string }): Promise<string | undefined> {
    const answer = await this.inner.inputBox(options);
    if (answer !== undefined && answer.trim().startsWith(GATEWAY_TOKEN_PREFIX)) {
      throw new GatewayTokenError();
    }
    return answer;
  }

  confirm(message: string, options: string[], opts?: ConfirmOptions): Promise<string | undefined> {
    return this.inner.confirm(message, options, opts);
  }

  info(message: string): void {
    this.inner.info(message);
  }

  popup(message: string): Promise<void> {
    return this.inner.popup(message);
  }

  warn(message: string): void {
    this.inner.warn(message);
  }

  error(message: string): void {
    this.inner.error(message);
  }
}
