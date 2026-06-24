import * as readline from "readline/promises";
import type { IPrompt } from "@bluestep-systems/b6p-core";

/**
 * CLI implementation of the prompt provider.
 *
 * When `autoYes` is true, confirmations return the first option automatically
 * and input boxes return their default value (or throw if none). This enables
 * non-interactive usage with `--yes`.
 */
export interface ActivityPauser {
  pause(): void;
  resume(): void;
}

export class CliPrompt implements IPrompt {
  private rl: readline.Interface | null = null;
  private readonly autoYes: boolean;
  private readonly jsonMode: boolean;
  private pauser: ActivityPauser | null = null;

  constructor(opts: { autoYes?: boolean; json?: boolean } = {}) {
    this.autoYes = opts.autoYes ?? false;
    this.jsonMode = opts.json ?? false;
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
      this.rl = readline.createInterface({
        input: process.stdin,
        output: process.stderr, // keep stdout clean for --json
      });
    }
    return this.rl;
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
      const answer = await this.getRL().question(query);
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
    const input = process.stdin;
    const output = process.stderr;

    if (!input.isTTY || typeof input.setRawMode !== "function") {
      // Cannot mask non-TTY input — fall back to the standard (echoing) read.
      return this.getRL()
        .question(query)
        .then((answer) => answer || undefined);
    }

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
      this.rl?.close();
      this.rl = null;
      input.removeAllListeners("keypress");

      const wasRaw = input.isRaw;
      input.setRawMode(true);
      input.resume();
      input.setEncoding("utf8");

      const cleanup = (): void => {
        if (done) {
          return;
        }
        done = true;
        input.removeListener("data", onData);
        input.setRawMode(wasRaw);
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
      const answer = await this.getRL().question(`${message}\n${optStr}: `);
      if (!answer) {
        return options[0];
      }
      return options.find((o) => o.toLowerCase() === answer.toLowerCase());
    });
  }

  info(message: string): void {
    if (!this.jsonMode) {
      this.pauser?.pause();
      process.stderr.write(`${message}\n`);
      this.pauser?.resume();
    }
  }

  async popup(message: string): Promise<void> {
    this.info(message);
  }

  warn(message: string): void {
    this.pauser?.pause();
    process.stderr.write(`WARNING: ${message}\n`);
    this.pauser?.resume();
  }

  error(message: string): void {
    this.pauser?.pause();
    process.stderr.write(`ERROR: ${message}\n`);
    this.pauser?.resume();
  }

  /** Close the readline interface. Call when the CLI is done. */
  close(): void {
    this.rl?.close();
    this.rl = null;
  }
}
