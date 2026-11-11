import { Err } from "@bluestep-systems/b6p-core";

/**
 * What {@link describeGatewayError} may mention besides the error itself.
 * `gatewayUrl` is the configured gateway address (`undefined` when the default is in use).
 * @lastreviewed null
 */
export interface GatewayErrorContext {
  gatewayUrl?: string;
}

/**
 * Compile-time exhaustiveness guard: a reason core adds to a union makes the call a type error.
 * @lastreviewed null
 */
function assertNever(value: never): never {
  throw new Error(`Unhandled gateway error reason: ${String(value)}`);
}

/**
 * Turn an error thrown by core's gateway subsystem into the text a person (or an agent) should read:
 * what happened, then the way out.
 *
 * Core's messages say what happened and why, never how to respond (b6p-core AGENTS.md), because core
 * does not know who is asking. The "how" is the terminal's job and lives here: which command to run,
 * which scope to mint, which folder to choose. Returns `undefined` for anything that is not a gateway
 * error, so the caller rethrows it untouched.
 *
 * Pure: the same error always gives the same text, and no secret is ever read, so it is safe to log.
 * @param err Anything caught around a core gateway call.
 * @lastreviewed null
 */
export function describeGatewayError(err: unknown, context: GatewayErrorContext = {}): string | undefined {
  if (!(err instanceof Err.GatewayError)) {
    return undefined;
  }
  const what = err.message;

  if (err instanceof Err.GatewayAuthError) {
    switch (err.reason) {
      case "token-missing":
        return `${what}\nStore a gateway token with \`b6p auth set\` (paste a \`b6pt_\` token minted in the web token page).`;
      case "token-invalid":
        return `${what}\nThe stored token is expired, revoked or unknown to the gateway. Mint a new one and run \`b6p auth set\`.`;
      case "token-malformed":
        return `${what}\nThe stored value is not a \`b6pt_\` token. Run \`b6p auth set\` and paste the whole token, prefix included.`;
      default:
        return assertNever(err.reason);
    }
  }
  if (err instanceof Err.GatewayScopeEscalationError) {
    return `${what}\nA new token can only carry scopes the token b6p holds already has. Ask for fewer scopes, or mint the wider token in the web token page.`;
  }
  if (err instanceof Err.GatewayScopeError) {
    const scope = err.scope;
    if (scope === null) {
      return `${what}\nThe stored token lacks a scope this command needs. Mint a token with the right scopes and run \`b6p auth set\`.`;
    }
    const extra =
      scope === "tokens:self"
        ? " Token management needs tokens:self; mint a token that has it in the web token page (this command cannot widen your own token)."
        : "";
    return `${what}\nThe stored token lacks the \`${scope}\` scope. Mint a token with \`${scope}\` (kb:read, kb:push, registry:read, tokens:self are the scopes b6p uses) and run \`b6p auth set\`.${extra}`;
  }
  if (err instanceof Err.GatewayInvalidRequestError) {
    return `${what}\nThe gateway rejected what was sent (a malformed value, a bad alias, a past expiry, an unknown scope or a bad filter). Check the options you passed against \`b6p <command> --help\`; if they look right, try \`b6p check-updates\`.`;
  }
  if (err instanceof Err.GatewayTokenLimitError) {
    const max = err.limit === null ? "the maximum number of live" : `the maximum of ${err.limit} live`;
    return `${what}\nYou already hold ${max} tokens. Revoke one you no longer use (see \`b6p auth token list\`, then \`b6p auth token revoke --tokenid <alias>\`) and try again. Expired tokens do not count.`;
  }
  if (err instanceof Err.GatewayTokenExpiryRefusedError) {
    const asked =
      err.requestedExpiresAt === undefined
        ? "would outlive the token b6p is using"
        : err.requestedExpiresAt === null
          ? "never expires"
          : `expires ${err.requestedExpiresAt}`;
    return `${what}\nThe new token ${asked}, but the token b6p is using expires ${err.presentingExpiresAt}, and a new token cannot outlive the one that creates it. Pass a --expires before ${err.presentingExpiresAt}, or leave --expires out to get the longest allowed. For a longer-lived token, mint one in the web token page and store it with \`b6p auth set\`.`;
  }
  if (err instanceof Err.GatewayRestrictedMintsDisabledError) {
    return `${what}\nToken creation for that scope set is not enabled yet; for now only tokens with just the \`mcp\` scope can be minted. Try again later, or use a token with the scopes you need from the web token page if you have one.`;
  }
  if (err instanceof Err.GatewayRewriteNotPermittedError) {
    return `${what}\nThe \`${err.scope}\` scope needs an account that is allowed to rewrite knowledge bases; ask an administrator. To get a token now, create or rotate it without \`${err.scope}\`.`;
  }
  if (err instanceof Err.GatewayAliasTakenError) {
    return `${what}\nChoose another --alias, or revoke the existing token (\`b6p auth token revoke --tokenid <alias>\`) and create this one again.`;
  }
  if (err instanceof Err.GatewayInvalidArgumentError) {
    return what;
  }
  if (err instanceof Err.GatewayTokenAmbiguousError) {
    return `${what}\nb6p cannot tell which one you mean from that value alone, and has no id-only form yet. Rename or revoke the other token, or manage this one in the web token page.`;
  }
  if (err instanceof Err.GatewayTokenStoreError) {
    return `${what}\nThe replacement token is printed once above/in the JSON output. Run \`b6p auth set\` and paste it, or you will be locked out.`;
  }
  if (err instanceof Err.GatewayOffContractTokenError) {
    const done =
      err.operation === "rotate"
        ? err.stored
          ? "The old token is revoked and the new secret has been stored for b6p."
          : "The old token is revoked. If it was the token b6p uses, run `b6p auth set` and paste the new secret, or b6p holds a dead token."
        : "The token was created.";
    return `${what}\n${done} The gateway's answer was malformed, but the new secret was recovered and is printed once (stdout, or the JSON \`secret\` field). Store it now; it cannot be read back. Then check \`b6p auth token list\`.`;
  }
  if (err instanceof Err.GatewayKnowledgeBasePushNotPermittedError) {
    return `${what}\nYou can read ${err.ref} but not push to it. Only that knowledge base's managers (or super users) may push to a global one; ask one of them, or use a tenant you are vouched for.`;
  }
  if (err instanceof Err.GatewayNotPermittedError) {
    return `${what}\nYour account is not allowed to do this, whatever the token's scopes. Ask someone who manages the target.`;
  }
  if (err instanceof Err.GatewayNotFoundError) {
    return `${what}\nIt does not exist or you cannot see it. Check the name with \`b6p kb list\` / \`b6p marketplace list\` / \`b6p auth token list\`.`;
  }
  if (err instanceof Err.GatewayLiveBranchUnprotectedError) {
    return `${what}\nNothing was pushed. The knowledge base's live branch must be protected on the forge, and its protection rule is missing or has changed. Ask a Bluestep administrator to restore the branch protection, then run \`b6p kb push\` again.`;
  }
  if (err instanceof Err.GatewayConflictError && err.code !== null && err.code !== "non-fast-forward") {
    return `${what}\nThe gateway reports a conflict with its current state. Look at \`b6p auth token list\` / \`b6p kb list\` for what is already there, then try again.`;
  }
  if (err instanceof Err.GatewayConflictError) {
    return `${what}\nThe knowledge base has commits your folder does not. Bring them in with git inside the folder (fetch, then merge or rebase; the token is the password), resolve any overlap, then run \`b6p kb push\` again. Or pull into a fresh folder with \`b6p kb pull <ref> <dir>\` and re-apply your changes there.`;
  }
  if (err instanceof Err.GatewayTooLargeError) {
    return `${what}\nThe push is bigger than the gateway accepts. Push fewer or smaller files.`;
  }
  if (err instanceof Err.GatewayOutcomeUnknownError) {
    const done =
      err.operation === "rotate"
        ? "The token may already have been rotated, in which case the old one is revoked and the new secret was never received."
        : "The token may already have been created, and its secret was never received.";
    const next =
      err.operation === "rotate"
        ? "Run `b6p auth token list` to check. If b6p is now refused (`b6p kb list` fails with a token error), mint a new token in the web token page and run `b6p auth set`; otherwise rotate again."
        : "Run `b6p auth token list` to check for the alias. If it is there, revoke it (`b6p auth token revoke --tokenid <alias>`) and create it again, since its secret cannot be recovered.";
    return `${what}\n${done} ${next}`;
  }
  if (err instanceof Err.GatewayUnavailableError && err.code === "registry-unavailable") {
    return `${what}\nThe gateway could not get an answer from web-global, which holds the registry. Try again in a minute; if it keeps failing, tell the gateway's operators.`;
  }
  if (err instanceof Err.GatewayUnavailableError) {
    return `${what}\nThe gateway or the git server behind it could not be reached, or stopped responding. Check your network and try again in a minute.`;
  }
  if (err instanceof Err.GatewayConfigError) {
    const url = context.gatewayUrl === undefined ? "the default address" : context.gatewayUrl;
    return `${what}\nb6p is using ${url} as the gateway. If that is not what you meant, fix it with \`b6p config set gatewayUrl <address>\`. If it is right, the fault is on the server's side (it handed out an address on another origin), so tell the gateway's operators instead of changing your setting.`;
  }
  if (err instanceof Err.GatewayDirtyWorkingTreeError) {
    const list = err.paths.map((p) => `  ${p}`).join("\n");
    return `${what}\nThese files have local changes that the incoming commits also change:\n${list}\nCommit, stash or discard them (nothing was changed), then pull again, or pull into another folder.`;
  }
  if (err instanceof Err.GatewayCloneMismatchError) {
    switch (err.reason) {
      case "different-repo":
        return `${what}\n${err.dir} is a clone of a different repository. Choose another folder.`;
      case "different-ref":
        return `${what}\n${err.dir} is checked out at a different branch or tag than you asked for. Choose another folder, or switch it yourself with git.`;
      case "tag-moved":
        return `${what}\nThe tag now points at a different commit than the one in ${err.dir}. Pull into a fresh folder to get the current one.`;
      case "tag-gone":
        return `${what}\nThe tag no longer exists on the server. Pull into a fresh folder (see \`b6p marketplace list\` for the current tags).`;
      default:
        return assertNever(err.reason);
    }
  }
  if (err instanceof Err.GatewayWorkingCopyError) {
    switch (err.reason) {
      case "not-empty":
        return `${what}\nThat folder has files but is not a clone. Choose an empty or new folder.`;
      case "wrong-repository":
        return `${what}\nThat folder is a clone of a different repository. Choose another folder.`;
      case "not-a-clone":
        return `${what}\nThat folder is not a git clone. Run this from the folder \`b6p kb pull\` made, or anywhere inside it, or pass that folder as [dir].`;
      case "detached":
        return `${what}\nThe folder is on a detached head. Check out a branch (\`git switch <branch>\`) and try again.`;
      case "no-upstream":
        return `${what}\nThe branch tracks nothing. Check out the knowledge base's branch that came from the pull and try again.`;
      case "diverged":
        return `${what}\nBoth your folder and the server have new commits. b6p only fast-forwards: merge or rebase with git inside the folder, then push, or pull into a fresh folder.`;
      case "unsafe-target":
        return `${what}\nThat folder path contains a \`.git\` (or \`git~1\`-style) component, which a clone must not be placed under. Choose a different folder.`;
      case "ref-not-found":
        return `${what}\nThe server has no such branch or tag. See \`b6p marketplace list\` for the available tags.`;
      default:
        return assertNever(err.reason);
    }
  }
  if (err instanceof Err.GatewayKnowledgeBaseError) {
    switch (err.reason) {
      case "bad-ref":
        return `${what}\nAddress a global knowledge base as \`<name>\` and a tenant one as \`U<number>/<name>\` (see \`b6p kb list\`).`;
      case "not-found":
        return `${what}\nNo knowledge base you may read has that address. See \`b6p kb list\`.`;
      case "ambiguous":
        return `${what}\nSeveral match: ${err.candidates.join(", ")}. Use the tenant form \`U<number>/<name>\` to choose one.`;
      case "unsafe-name":
        return `${what}\nPass a folder explicitly: \`b6p kb pull <ref> <dir>\`.`;
      case "not-a-kb":
        return `${what}\nThat folder is not a clone of a knowledge base you can see. Run the command inside a folder made by \`b6p kb pull\`.`;
      case "wrong-branch": {
        const live = err.liveBranch ?? "the live branch";
        const now = err.branch === null ? "a detached head" : `branch ${err.branch}`;
        const tracks =
          err.upstream === null
            ? "tracks nothing"
            : `tracks ${err.upstream}${err.liveBranch !== null && err.upstream === `origin/${err.liveBranch}` ? "" : ` rather than origin/${live}`}`;
        return `${what}\nThe folder is on ${now}${err.branch === null ? "" : ` and ${tracks}`}, and pulls and pushes work on ${live} only. Switch to it (\`git switch ${live}\`; \`git branch --set-upstream-to=origin/${live}\` if it does not track origin/${live}), then try again.`;
      }
      default:
        return assertNever(err.reason);
    }
  }
  if (err instanceof Err.GatewayUnexpectedResponseError && err.code === "redirect-refused") {
    return `${what}\nb6p never follows a redirect, so the token cannot be sent to another address. Check the gateway address (\`b6p config set gatewayUrl https://gateway.bluestep.net\`), and tell the gateway's operators if it is correct.`;
  }
  if (err instanceof Err.GatewayUnexpectedResponseError && err.code === "invalid-git-response") {
    return `${what}\nThe server answered a git request with something that is not git. A proxy or captive portal may be in the way; check your network and the gateway address, then try again.`;
  }
  if (err instanceof Err.GatewayUnexpectedResponseError) {
    // No HTTP status means b6p itself refused what it was handed. Core gives that no code of its own, so
    // the one local cause b6p knows of is named alongside the general one rather than guessed between.
    const local =
      err.status === null
        ? " If you were running `b6p marketplace pull`, the repository's name may not be usable as a folder name: pass [dir]."
        : "";
    return `${what}\nThe gateway answered in a way b6p does not understand; this may be a version mismatch (try \`b6p check-updates\`).${local}`;
  }
  return what;
}
