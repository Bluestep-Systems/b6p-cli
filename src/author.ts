// The commit author of a push or deploy (b6p-core 0.9.0 makes every script commit by someone).
//
// Precedence, first complete one wins: `--author`, the `author` key of a deploy config (deploy only),
// the `author` setting (`b6p config set author "Name <email>"`), then what core resolves itself:
// `git config user.name`/`user.email` for the script folder, then GIT_AUTHOR_* / GIT_COMMITTER_* in the
// environment. There is no default author, so nothing ever commits as nobody.

/**
 * Who a script commit is by. Structurally core's own identity type (core does not export it).
 * @lastreviewed null
 */
export interface CommitAuthor {
  name: string;
  email: string;
}

/**
 * The name of the settings key (`b6p config set author "Name <email>"`) holding the default author.
 * @lastreviewed null
 */
export const AUTHOR_SETTING = "author";

/**
 * Why an author string or object could not be used, with the fix in the message.
 * @lastreviewed null
 */
export class AuthorFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthorFormatError";
  }
}

const AUTHOR_SHAPE = /^\s*([^<>]+?)\s*<\s*([^<>\s]+@[^<>\s]+)\s*>\s*$/;

/**
 * Parses `Name <email>`.
 * @param text The `--author` value or `author` setting
 * @param origin Where the text came from, for the error ("--author", "the author setting", …)
 * @returns The author
 * @throws {AuthorFormatError} when the text is not `Name <email>`
 * @lastreviewed null
 */
export function parseAuthor(text: string, origin: string): CommitAuthor {
  const match = AUTHOR_SHAPE.exec(text);
  if (!match) {
    throw new AuthorFormatError(
      `${origin} must look like "Jane Doe <jane@example.com>" (a name, then an email in angle brackets); got "${text}".`
    );
  }
  return { name: match[1], email: match[2] };
}

/**
 * Picks the author the CLI itself decided on: `--author` over the `author` setting.
 * `undefined` leaves the choice to core (git config, then the environment).
 * @param flag The `--author` value
 * @param setting The stored `author` setting (any JSON value a `config set` could have stored)
 * @returns The author, or `undefined`
 * @throws {AuthorFormatError} when the chosen one is malformed
 * @lastreviewed null
 */
export function chooseAuthor(flag: string | undefined, setting: unknown): CommitAuthor | undefined {
  if (flag !== undefined) {
    return parseAuthor(flag, "--author");
  }
  if (typeof setting === "string") {
    return parseAuthor(setting, 'The "author" setting');
  }
  if (setting !== undefined && setting !== null) {
    throw new AuthorFormatError(
      'The "author" setting must be text like "Jane Doe <jane@example.com>". ' +
        'Fix it with: b6p config set author "Jane Doe <jane@example.com>"'
    );
  }
  return undefined;
}

/**
 * The message for a push or deploy that found no author anywhere: what was tried and every way to fix it.
 * @param coreMessage Core's own explanation of what it searched
 * @returns Text for stderr
 * @lastreviewed null
 */
export function missingAuthorMessage(coreMessage: string): string {
  return (
    `${coreMessage}.\n` +
    "A push is a git commit and must say who made it. Give an author any one of these ways:\n" +
    '  b6p push ... --author "Jane Doe <jane@example.com>"     (this run)\n' +
    '  b6p config set author "Jane Doe <jane@example.com>"     (every run on this machine)\n' +
    '  git config --global user.name "Jane Doe" && git config --global user.email jane@example.com\n' +
    "  or set GIT_AUTHOR_NAME and GIT_AUTHOR_EMAIL in the environment"
  );
}

/**
 * Whether an error is core's "no commit author found" (bsjs-git's `GitIdentityError`, code `IDENTITY_REQUIRED`).
 * Matched by code, not class, so the CLI needs no direct dependency on the git package.
 * @param e Anything thrown
 * @lastreviewed null
 */
export function isMissingAuthorError(e: unknown): e is Error {
  return e instanceof Error && (e as Error & { code?: unknown }).code === "IDENTITY_REQUIRED";
}

/**
 * Rewrites a deploy config's text so core sees the author the CLI chose. Core reads `author` as
 * `{ name, email }`; the file may also give it as `"Name <email>"`, which is converted. Precedence: the
 * CLI's choice (`--author`, then the setting) is applied only when the file has none, except that `--author`
 * on the command line overrides the file too.
 * @param configText The config file's JSON text
 * @param flagAuthor The parsed `--author`, if given
 * @param settingAuthor The parsed `author` setting, if set
 * @returns The new text, or `null` when the file can go to core untouched
 * @throws {AuthorFormatError} when the file's own `author` is malformed
 * @lastreviewed null
 */
export function deployConfigWithAuthor(
  configText: string,
  flagAuthor: CommitAuthor | undefined,
  settingAuthor: CommitAuthor | undefined
): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(configText);
  } catch {
    return null; // core reports unparseable files itself
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const config = parsed as Record<string, unknown>;
  let fileAuthor: CommitAuthor | undefined;
  let fileNeedsRewrite = false;
  if (typeof config.author === "string") {
    fileAuthor = parseAuthor(config.author, 'The deploy config "author"');
    fileNeedsRewrite = true;
  } else if (config.author !== undefined) {
    const o = config.author as Partial<CommitAuthor> | null;
    if (!o || typeof o.name !== "string" || typeof o.email !== "string") {
      throw new AuthorFormatError(
        'The deploy config "author" must be { "name": "Jane Doe", "email": "jane@example.com" } ' +
          'or the text "Jane Doe <jane@example.com>".'
      );
    }
    fileAuthor = { name: o.name, email: o.email };
  }
  const chosen = flagAuthor ?? fileAuthor ?? settingAuthor;
  if (!chosen || (!fileNeedsRewrite && chosen === fileAuthor)) {
    return null;
  }
  return JSON.stringify({ ...config, author: chosen }, null, 2);
}
