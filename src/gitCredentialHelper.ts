import type { Readable } from "node:stream";

/**
 * What {@link answerGitCredential} needs: the request's source, where the answer goes, where a
 * diagnostic goes, and core's answer.
 * @lastreviewed null
 */
export interface GitCredentialIo {
  /** git's request (stdin). */
  input: Readable;
  /** The answer, and nothing else (stdout). */
  writeAnswer(text: string): void;
  /** A diagnostic line, never carrying the token (stderr). */
  writeDiagnostic(text: string): void;
  /** `core.gitCredential.answer`, run inside a core session. */
  answer(action: string, input: string): Promise<string>;
}

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

/**
 * Run one `b6p auth git-credential <action>` call from git: read the request, write core's answer
 * and nothing else, and return the exit code, which is always `0`. git must never see a failure or
 * a partial answer, so anything that goes wrong is one generic line on the diagnostic channel (no
 * error text, which could in principle quote the request) and an empty answer, and git asks its
 * other helpers.
 * @param action git's argument (`get`, `store`, `erase`); absent is answered with nothing
 * @lastreviewed null
 */
export async function answerGitCredential(action: string | undefined, io: GitCredentialIo): Promise<0> {
  let out = "";
  try {
    const request = await readAll(io.input);
    out = await io.answer(action ?? "", request);
  } catch (err) {
    const name = err instanceof Error ? err.name : "error";
    io.writeDiagnostic(`b6p: the git credential request could not be answered (${name}); git will ask elsewhere.\n`);
    out = "";
  }
  if (out !== "") {
    io.writeAnswer(out);
  }
  return 0;
}
