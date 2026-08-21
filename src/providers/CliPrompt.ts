import * as readline from "readline/promises";
import type { Readable, Writable } from "node:stream";
import type { Prompt } from "@bluestep-systems/b6p-core";

/**
 * Thrown when the core asks for input that stdin cannot supply - piped input
 * that ran out, or a closed/absent stdin.
 *
 * This exists because the alternative is silent success. readline's question()
 * promise never settles once stdin has ended: the event loop drains, node exits
 * **0**, and a command that did nothing reports success to the shell. Every
 * non-interactive b6p run without stored credentials hit exactly that
 * (Enter your access token: then exit 0, nothing pulled), as does any push that
 * reaches a second overwrite prompt with only one piped answer. Failing loudly
 * is the point; do not soften this into a return value.
 * @lastreviewed null
 */
export class NonInteractiveInputError extends Error {
  constructor(query: string) {
    super(
      `No input available for prompt: \"${query.trim()}\". stdin reached end of input, so this ` +
        `value cannot be asked for interactively. Run the command in a terminal, pipe an answer, ` +
        `or configure the value up front (for credentials: \`b6p auth set\`).`
    );
    this.name = "NonInteractiveInputError";
  }
}

/**
 * CLI implementation of the prompt provider.
 *
 * When `autoYes` is true, confirmations return the first option automatically
 * and input boxes return their default value when they have one. An input box
 * with no default still needs a real answer: it is read from stdin, and if stdin
 * has nothing to give, {@link NonInteractiveInputError} is thrown rather than
 * hanging on a promise that can never settle.
 */
export interface ActivityPauser {
  pause(): void;
  resume(): void;
}

/** The subset of a stdin-like stream this provider uses. process.stdin satisfies it structurally. */
type InputStream = Readable & {
  isTTY?: boolean;
  isRaw?: boolean;
  setRawMode?: (mode: boolean) => unknown;
};

export class CliPrompt implements Prompt {
  private rl: readline.Interface | null = null;
  private readonly autoYes: boolean;
  private readonly jsonMode: boolean;
  private pauser: ActivityPauser | null = null;
  private readonly input: InputStream;
  private readonly output: Writable;
  /** Set once stdin has ended; every later prompt fails fast instead of re-reading a dead stream. */
  private stdinExhausted = false;

  constructor(opts: { autoYes?: boolean; json?: boolean; input?: InputStream; output?: Writable } = {}) {
    this.autoYes = opts.autoYes ?? false;
    this.jsonMode = opts.json ?? false;
    this.input = opts.input ?? process.stdin;
    this.output = opts.output ?? process.stderr; // keep stdout clean for --json
  }

  /** Attach a background activity indicator (e.g. Spinner) that should be
   *  paused while the prompt reads from stdin or writes user-facing text. */
  setActivityPauser(pauser: ActivityPauser | null): void {
    this.pauser = pauser;
  }

  private async aroundIO<T>(fn: () => Promise<T>): Promise<T> {
    this.pauser?.pause();
    try {
      return await fn();
    } finally {
      this.pauser?.resume();
    }
  }

  private getRL(): readline.Interface {
    if (!this.rl) {
      const rl = readline.createInterface({
        input: this.input,
        output: this.output,
      });
      // stdin ending is terminal for interactive input. Remember it so the next
      // prompt reports the real problem instead of readline's internal
      // \"readline was closed\" from a reused dead interface.
      rl.once("close", () => {
        this.stdinExhausted = true;
        if (this.rl === rl) {
          this.rl = null;
        }
      });
      this.rl = rl;
    }
    return this.rl;
  }

  /**
   * Close and forget the current interface **without** treating it as stdin
   * ending - used by the masked read, which deliberately tears the interface
   * down so it can drive raw mode itself.
   * @lastreviewed null
   */
  private discardRL(): void {
    const rl = this.rl;
    this.rl = null;
    if (rl) {
      rl.removeAllListeners("close");
      rl.close();
    }
  }

  /**
   * Read one line, rejecting rather than hanging when stdin cannot answer.
   *
   * question() alone is not enough: at end-of-input its promise simply never
   * settles. Racing it against the interface's close event turns that silent
   * hang into a thrown {@link NonInteractiveInputError}.
   * @param query The fully-formatted prompt to display
   * @returns The line the user (or piped input) supplied
   * @throws a {@link NonInteractiveInputError} When stdin has ended
   * @lastreviewed null
   */
  private async ask(query: string): Promise<string> {
    if (this.stdinExhausted) {
      throw new NonInteractiveInputError(query);
    }
    const rl = this.getRL();
    return await new Promise<string>((resolve, reject) => {
      let settled = false;
      const finish = (act: () => void): void => {
        if (settled) {
          return;
        }
        settled = true;
        rl.off("close", onClose);
        act();
      };
      // `close` routinely fires in the SAME turn as the answer being delivered:
      // piped input ends immediately after its bytes, and readline flushes the
      // final line before closing. Rejecting straight from the event would
      // therefore discard an answer that did arrive — it broke
      // `echo Sync | b6p ...`, the exact workaround this error recommends.
      // Deferring one macrotask lets any delivered line settle first, because
      // question()'s `then` runs as a microtask; a genuine EOF still has
      // nothing pending and rejects.
      const onClose = (): void => {
        setImmediate(() => finish(() => reject(new NonInteractiveInputError(query))));
      };
      rl.once("close", onClose);
      rl.question(query).then(
        (answer) => finish(() => resolve(answer)),
        (error: unknown) => finish(() => reject(error instanceof Error ? error : new Error(String(error))))
      );
    });
  }

  async inputBox(options: { prompt: string; password?: boolean; value?: string }): Promise<string | undefined> {
    if (this.autoYes && options.value !== undefined) {
      return options.value;
    }
    const query = `${options.prompt}: `;
    if (options.password) {
      return this.aroundIO(() => this.readMasked(query));
    }
    return this.aroundIO(async () => {
      const answer = await this.ask(query);
      return answer || undefined;
    });
  }

  /**
   * Read a line from stdin without echoing the typed characters, masking each
   * with `*`. Output goes to stderr to keep stdout clean for `--json`.
   *
   * Requires a TTY with raw-mode support; when stdin is not a TTY (e.g. piped
   * input) masking is impossible, so it falls back to the standard readline
   * question, which echoes. Handles Enter/Ctrl-D (submit), Ctrl-C (re-raise
   * SIGINT) and Backspace.
   *
   * @param query The fully-formatted prompt to display (e.g. `"Password: "`).
   * @returns The entered string, or `undefined` if the input was empty.
   * @lastreviewed null
   */
  private readMasked(query: string): Promise<string | undefined> {
    const input = this.input;
    const output = this.output;

    if (!input.isTTY || typeof input.setRawMode !== "function") {
      // Cannot mask non-TTY input — fall back to the standard (echoing) read.
      return this.ask(query).then((answer) => answer || undefined);
    }
    const setRawMode = input.setRawMode.bind(input);

    return new Promise<string | undefined>((resolve, reject) => {
      output.write(query);
      let value = "";
      let done = false;

      // A readline interface created earlier (e.g. by the username prompt)
      // stays attached to stdin and echoes every keystroke via its own
      // `keypress` handler. Merely pausing it is not enough: resuming stdin for
      // the raw read re-enables that echo, printing the real character next to
      // each masking `*`. Close it and strip the `keypress` listeners so our
      // masking is the only writer. We deliberately leave `data` listeners
      // alone: Node's `emitKeypressEvents` installs a shared, idempotent
      // `data`→`keypress` decoder there, and removing it would prevent any
      // later readline prompt (recreated lazily by getRL()) from receiving
      // input at all.
      // discardRL() rather than close(): this teardown is deliberate and must
      // NOT be recorded as stdin ending.
      this.discardRL();
      input.removeAllListeners("keypress");

      const wasRaw = input.isRaw === true;
      setRawMode(true);
      input.resume();
      input.setEncoding("utf8");

      const cleanup = (): void => {
        if (done) {
          return;
        }
        done = true;
        input.removeListener("data", onData);
        setRawMode(wasRaw);
        input.pause();
      };

      const onData = (chunk: string): void => {
        // Arrow/function keys arrive as a single chunk starting with ESC (0x1b).
        // Drop the whole sequence so its bytes are never added to the value.
        if (chunk.charCodeAt(0) === 0x1b) {
          return;
        }
        for (const char of chunk) {
          switch (char) {
            case "\n":
            case "\r":
            case "\u0004": // Ctrl-D (EOT)
              output.write("\n");
              cleanup();
              resolve(value || undefined);
              return;
            case "\u0003": // Ctrl-C (ETX)
              output.write("\n");
              cleanup();
              process.kill(process.pid, "SIGINT");
              reject(new Error("Cancelled"));
              return;
            case "\u007f": // Backspace (DEL)
            case "\b":
              if (value.length > 0) {
                value = value.slice(0, -1);
                output.write("\b \b");
              }
              break;
            default:
              // Echo printable characters as `*`; ignore other control bytes
              // (arrow keys, escape sequences, etc.).
              if (char >= " ") {
                value += char;
                output.write("*");
              }
          }
        }
      };

      input.on("data", onData);
    });
  }

  async confirm(message: string, options: string[]): Promise<string | undefined> {
    if (this.autoYes) {
      return options[0];
    }
    return this.aroundIO(async () => {
      const optStr = options.map((o, i) => (i === 0 ? `[${o}]` : o)).join(" / ");
      const answer = await this.ask(`${message}\n${optStr}: `);
      if (!answer) {
        return options[0];
      }
      return options.find((o) => o.toLowerCase() === answer.toLowerCase());
    });
  }

  info(message: string): void {
    if (!this.jsonMode) {
      this.pauser?.pause();
      this.output.write(`${message}\n`);
      this.pauser?.resume();
    }
  }

  async popup(message: string): Promise<void> {
    this.info(message);
  }

  warn(message: string): void {
    this.pauser?.pause();
    this.output.write(`WARNING: ${message}\n`);
    this.pauser?.resume();
  }

  error(message: string): void {
    this.pauser?.pause();
    this.output.write(`ERROR: ${message}\n`);
    this.pauser?.resume();
  }

  /** Close the readline interface. Call when the CLI is done. */
  close(): void {
    this.rl?.close();
    this.rl = null;
  }
}
