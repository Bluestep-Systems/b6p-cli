import * as readline from "readline/promises";
import type { Readable, Writable } from "node:stream";
import type { Prompt } from "@bluestep-systems/b6p-core";
import type { FailureTracker } from "../exit";

/**
 * CLI implementation of the prompt provider.
 *
 * When `autoYes` is true, confirmations return the first option automatically.
 * An input box has no such safe default — core never supplies a `value` to fall
 * back on — so it throws {@link NonInteractiveError} rather than blocking. That
 * is the whole point of `--yes`: fail fast and loudly instead of stalling an
 * unattended job on a prompt nobody will answer.
 */
export interface ActivityPauser {
  pause(): void;
  resume(): void;
}

/**
 * Thrown when input is required but cannot be obtained: `--yes` was passed, or
 * stdin reached end-of-file.
 *
 * The EOF case matters more than it looks. `readline`'s `question()` never
 * settles when the stream closes underneath it — the promise is simply abandoned
 * — so without this the whole action promise hangs, the command's `finally` never
 * runs, and Node drains and exits **0** from a command that did nothing.
 * @lastreviewed null
 */
export class NonInteractiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonInteractiveError";
  }
}

/**
 * Thrown when the user interrupts a prompt with Ctrl-C, so the top level can
 * exit `130` (the conventional 128 + SIGINT) rather than a generic failure.
 * @lastreviewed null
 */
export class PromptCancelledError extends Error {
  constructor() {
    super("Cancelled");
    this.name = "PromptCancelledError";
  }
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
  private failures: FailureTracker | null = null;
  private readonly input: InputStream;
  private readonly output: Writable;
  /**
   * Set once stdin has ended. Without it the next prompt reuses a dead
   * interface and surfaces readline's internal 'readline was closed' rather
   * than the real diagnosis - the reported symptom of CU 86bb8f6v0, where a
   * push hit a SECOND overwrite prompt with only one piped answer.
   * @lastreviewed null
   */
  private stdinExhausted = false;

  constructor(opts: { autoYes?: boolean; json?: boolean; input?: InputStream; output?: Writable } = {}) {
    this.autoYes = opts.autoYes ?? false;
    this.jsonMode = opts.json ?? false;
    this.input = opts.input ?? process.stdin;
    this.output = opts.output ?? process.stderr; // keep stdout clean for --json
  }

  /**
   * Attach the tracker that decides this invocation's exit code. See
   * {@link FailureTracker} for why `error` counts and `warn` does not.
   * @lastreviewed null
   */
  setFailureTracker(failures: FailureTracker | null): void {
    this.failures = failures;
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
   * Close and forget the current interface WITHOUT recording stdin as ended -
   * for the masked read, which tears the interface down on purpose so it can
   * drive raw mode itself.
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

  async inputBox(options: { prompt: string; password?: boolean; value?: string }): Promise<string | undefined> {
    if (this.autoYes) {
      if (options.value !== undefined) {
        return options.value;
      }
      // No default to fall back on. Blocking here is what made `b6p --yes script
      // push` sit on a prompt until the CI job timed out, so refuse instead.
      throw new NonInteractiveError(
        `Cannot prompt for "${options.prompt}" with --yes and no default. ` +
          `Supply the value on the command line, or drop --yes to answer interactively.`
      );
    }
    const query = `${options.prompt}: `;
    if (options.password) {
      return this.aroundIO(() => this.readMasked(query));
    }
    return this.aroundIO(() => this.ask(query));
  }

  /**
   * `readline.question`, but rejecting instead of hanging when stdin closes.
   *
   * `question()` returns a promise that is never settled if the interface closes
   * before an answer arrives — which is exactly what happens with stdin at EOF
   * (`b6p … < /dev/null`, or any pipe that has ended). Racing it against the
   * interface's `close` event converts that silent hang into an error the command
   * can report.
   * @lastreviewed null
   */
  /** The one wording for 'stdin cannot answer this', used by both paths below. */
  private noInputMessage(query: string): string {
    return `No input available for "${query.trim()}" (stdin closed).`;
  }

  private ask(query: string): Promise<string | undefined> {
    if (this.stdinExhausted) {
      return Promise.reject(new NonInteractiveError(this.noInputMessage(query)));
    }
    const rl = this.getRL();
    return new Promise<string | undefined>((resolve, reject) => {
      let settled = false;
      // `close` routinely fires in the SAME turn the answer is delivered:
      // piped input ends right after its bytes, and readline flushes the final
      // line before closing. Rejecting straight from the event therefore threw
      // away answers that HAD arrived, which broke piping an answer at all
      // (echo Overwrite | b6p ...) - the very workaround the error suggests.
      // Deferring one macrotask lets question()'s microtask settle first; a
      // genuine EOF has nothing pending and still rejects.
      const onClose = (): void => {
        setImmediate(() => {
          if (settled) {
            return;
          }
          settled = true;
          reject(new NonInteractiveError(this.noInputMessage(query)));
        });
      };
      rl.once("close", onClose);
      const done = (fn: () => void): void => {
        if (settled) {
          return;
        }
        settled = true;
        rl.off("close", onClose);
        fn();
      };
      rl.question(query).then(
        (answer) => done(() => resolve(answer || undefined)),
        (err: unknown) => done(() => reject(err))
      );
    });
  }

  /**
   * Read a line from stdin without echoing the typed characters, masking each
   * with `*`. Output goes to stderr to keep stdout clean for `--json`.
   *
   * Requires a TTY with raw-mode support; when stdin is not a TTY (e.g. piped
   * input) masking is impossible, so it falls back to the standard readline
   * question, which echoes. Handles Enter/Ctrl-D (submit), Ctrl-C (rejects with
   * {@link PromptCancelledError}) and Backspace.
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
      // Routed through ask() so a closed stdin rejects rather than hanging.
      return this.ask(query);
    }
    const setRawMode = input.setRawMode.bind(input);

    return new Promise<string | undefined>((resolve, reject) => {
      output.write(query);
      let value = "";
      let done = false;

      // A readline interface created earlier (e.g. by a preceding unmasked
      // prompt) stays attached to stdin and echoes every keystroke via its own
      // `keypress` handler. Merely pausing it is not enough: resuming stdin for
      // the raw read re-enables that echo, printing the real character next to
      // each masking `*`. Close it and strip the `keypress` listeners so our
      // masking is the only writer. We deliberately leave `data` listeners
      // alone: Node's `emitKeypressEvents` installs a shared, idempotent
      // `data`→`keypress` decoder there, and removing it would prevent any
      // later readline prompt (recreated lazily by getRL()) from receiving
      // input at all.
      // discardRL(), not close(): this teardown is deliberate and must NOT be
      // recorded as stdin ending, or every prompt after a password read would
      // wrongly report end-of-input.
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
              // Reject rather than re-raising SIGINT at ourselves: the default
              // signal disposition terminates the process immediately, racing
              // teardown and any pending stdout flush. The top level maps this
              // to EXIT_SIGINT.
              reject(new PromptCancelledError());
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

  /**
   * Report a failed operation. This is the channel that decides the exit code —
   * see {@link FailureTracker} for why this one counts and `Logger.error` does not.
   * @lastreviewed null
   */
  error(message: string): void {
    // Record before writing: the count must not depend on output mode or on the
    // write succeeding, since it is what the shell sees as the exit code.
    this.failures?.record(message);
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
