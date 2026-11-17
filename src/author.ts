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
 * What the CLI decided about a deploy config's author.
 * @lastreviewed null
 */
export interface DeployAuthorPlan {
  /**
   * The config text to give core (the author converted to `{ name, email }` or injected), or `null` when the file
   * can go to core untouched.
   * @lastreviewed null
   */
  text: string | null;
  /**
   * The author that will sign every target's commit, when the CLI knows one (flag, file or setting); `undefined` when
   * core has to resolve it from git config or the environment.
   * @lastreviewed null
   */
  author: CommitAuthor | undefined;
  /**
   * The config's `sourceRootPath`, when it has one.
   * @lastreviewed null
   */
  sourceRootPath: string | undefined;
}

/**
 * Decides the author of a deploy and rewrites the config text so core sees it. Core reads `author` as
 * `{ name, email }`; the file may also give it as `"Name <email>"`, which is converted. Precedence: `--author`, the
 * file's `author`, then the setting. Only the source that wins is parsed and validated, so a bad lower-priority source
 * never blocks a valid higher one.
 * @param configText The config file's JSON text
 * @param flagText The raw `--author` value, if given
 * @param settingValue The stored `author` setting, unparsed
 * @returns The plan; `text: null` for files core must report itself (unparseable, not an object)
 * @throws {AuthorFormatError} when the winning source is malformed
 * @lastreviewed null
 */
export function planDeployAuthor(
  configText: string,
  flagText: string | undefined,
  settingValue: unknown
): DeployAuthorPlan {
  let parsed: unknown;
  try {
    parsed = JSON.parse(configText);
  } catch {
    return { text: null, author: undefined, sourceRootPath: undefined };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { text: null, author: undefined, sourceRootPath: undefined };
  }
  const config = parsed as Record<string, unknown>;
  const sourceRootPath = typeof config.sourceRootPath === "string" ? config.sourceRootPath : undefined;
  if (flagText !== undefined) {
    const author = parseAuthor(flagText, "--author");
    return { text: JSON.stringify({ ...config, author }, null, 2), author, sourceRootPath };
  }
  if (config.author !== undefined) {
    if (typeof config.author === "string") {
      const author = parseAuthor(config.author, 'The deploy config "author"');
      return { text: JSON.stringify({ ...config, author }, null, 2), author, sourceRootPath };
    }
    const o = config.author as Partial<CommitAuthor> | null;
    if (!o || typeof o.name !== "string" || typeof o.email !== "string") {
      throw new AuthorFormatError(
        'The deploy config "author" must be { "name": "Jane Doe", "email": "jane@example.com" } ' +
          'or the text "Jane Doe <jane@example.com>".'
      );
    }
    return { text: null, author: { name: o.name, email: o.email }, sourceRootPath };
  }
  const author = chooseAuthor(undefined, settingValue);
  return {
    text: author ? JSON.stringify({ ...config, author }, null, 2) : null,
    author,
    sourceRootPath,
  };
}
