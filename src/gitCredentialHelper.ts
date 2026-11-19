import type { Readable } from "node:stream";

/**
 * Whether this run is git calling b6p as its credential helper: `b6p auth git-credential <action>`,
 * the command line `b6p auth setup-git` writes (`!b6p auth git-credential`, to which git appends
 * `get`, `store` or `erase`). Matched by position, `argv[2] === "auth"` and `argv[3] ===
 * "git-credential"`, never by searching the arguments, so `b6p script pull --workspace
 * git-credential` is an ordinary command. Whatever follows is the helper's: the first is the
 * action, the rest are ignored.
 * @param argv `process.argv`
 * @lastreviewed null
 */
export function isGitCredentialHelperArgv(argv: readonly string[]): boolean {
  return argv[2] === "auth" && argv[3] === "git-credential";
}

/**
 * A writable the helper writes to: `process.stdout` and `process.stderr` satisfy it.
 * @lastreviewed null
 */
export interface HelperStream {
  write(text: string, callback: (err?: Error | null) => void): unknown;
  on(event: "error", listener: (err: Error) => void): unknown;
}

/**
 * The slice of `process` the helper uses, injectable for tests.
 * @lastreviewed null
 */
export interface HelperProcess {
  stdin: Readable;
  stdout: HelperStream;
  stderr: HelperStream;
  on(event: "unhandledRejection" | "uncaughtException", listener: () => void): unknown;
  exit(code: 0): void;
}

/**
 * The one line said on stderr when anything goes wrong. It never carries error text, which could in
 * principle quote the request or the token.
 */
export const HELPER_DIAGNOSTIC =
  "b6p: the git credential request could not be fully answered; git will ask elsewhere.\n";

/**
 * Read a stream to its end as UTF-8. git writes the request and then closes the helper's stdin.
 * @lastreviewed null
 */
export async function readAll(input: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of input) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function write(stream: HelperStream, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(text, (err) => (err ? reject(err) : resolve()));
  });
}

/**
 * Run one `b6p auth git-credential <action>` call from git, before Commander parses anything: read
 * the request, write core's answer and nothing else, then exit `0`. git must never see a failure or
 * a partial answer, so everything is contained, for this run only:
 *
 * - a failure reading, answering or writing gives an empty answer and {@link HELPER_DIAGNOSTIC};
 * - an unhandled rejection (core's caches hydrate in the background as the SDK is built, and one
 *   that fails has nothing to do with the answer) is that one line, and the run carries on;
 * - an uncaught exception is that line and exit `0`;
 * - an `error` on stdout or stderr (a closed pipe, a full disk: any code) exits `0` quietly.
 *
 * The run ends with an explicit exit once the answer is written, so nothing core left running can
 * add output or change the code afterwards.
 * @param action git's argument (`get`, `store`, `erase`); absent is answered with nothing
 * @param answer `core.gitCredential.answer`, run inside a core session
 * @lastreviewed null
 */
export async function runGitCredentialHelper(
  action: string | undefined,
  answer: (action: string, input: string) => Promise<string>,
  proc: HelperProcess = process
): Promise<void> {
  let said = false;
  const diagnose = (): void => {
    if (said) {
      return;
    }
    said = true;
    try {
      proc.stderr.write(HELPER_DIAGNOSTIC, () => {});
    } catch {
      /* stderr is gone too; git still gets exit 0 */
    }
  };
  proc.stdout.on("error", () => proc.exit(0));
  proc.stderr.on("error", () => proc.exit(0));
  proc.on("unhandledRejection", diagnose);
  proc.on("uncaughtException", () => {
    diagnose();
    proc.exit(0);
  });
  try {
    const request = await readAll(proc.stdin);
    const out = await answer(action ?? "", request);
    if (out !== "") {
      await write(proc.stdout, out);
    }
  } catch {
    diagnose();
  }
  proc.exit(0);
}
