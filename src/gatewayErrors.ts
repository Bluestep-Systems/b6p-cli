import { Err } from "@bluestep-systems/b6p-core";

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
export function describeGatewayError(err: unknown): string | undefined {
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
  if (err instanceof Err.GatewayAliasTakenError) {
    return `${what}\nChoose another --alias, or replace that token with \`b6p auth token rotate --tokenid <alias>\`.`;
  }
  if (err instanceof Err.GatewayInvalidArgumentError) {
    return what;
  }
  if (err instanceof Err.GatewayTokenAmbiguousError) {
    return `${what}\nMore than one token matches. Pass the token id (see \`b6p auth token list\`) as --tokenid. Matching ids: ${err.ids.join(", ")}.`;
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
  if (err instanceof Err.GatewayConflictError) {
    return `${what}\nThe knowledge base moved on since your copy. Run \`b6p kb pull <ref> <dir>\` to fast-forward the folder, re-apply your change if they overlap, then push again.`;
  }
  if (err instanceof Err.GatewayTooLargeError) {
    return `${what}\nThe push is bigger than the gateway accepts. Push fewer or smaller files.`;
  }
  if (err instanceof Err.GatewayUnavailableError) {
    return `${what}\nThe gateway or the git server behind it could not be reached, or stopped responding. Check your network and try again in a minute.`;
  }
  if (err instanceof Err.GatewayConfigError) {
    return `${what}\nCheck the gateway address: \`b6p config set gatewayUrl https://gateway.bluestep.net\`.`;
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
    }
  }
  if (err instanceof Err.GatewayWorkingCopyError) {
    switch (err.reason) {
      case "not-empty":
        return `${what}\nThat folder has files but is not a clone. Choose an empty or new folder.`;
      case "wrong-repository":
        return `${what}\nThat folder is a clone of a different repository. Choose another folder.`;
      case "not-a-clone":
        return `${what}\nThat folder is not a git clone. Pull into a new folder first, then run this inside it.`;
      case "detached":
        return `${what}\nThe folder is on a detached head. Check out a branch (\`git switch <branch>\`) and try again.`;
      case "no-upstream":
        return `${what}\nThe branch tracks nothing. Check out the knowledge base's branch that came from the pull and try again.`;
      case "diverged":
        return `${what}\nBoth your folder and the server have new commits. b6p only fast-forwards: merge or rebase with git inside the folder, then push, or pull into a fresh folder.`;
      case "ref-not-found":
        return `${what}\nThe server has no such branch or tag. See \`b6p marketplace list\` for the available tags.`;
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
        return `${what}\nThe folder is on ${now}, and pushes go to ${live} only. Switch to ${live} (\`git switch ${live}\`) before pushing.`;
      }
    }
  }
  if (err instanceof Err.GatewayUnexpectedResponseError) {
    return `${what}\nThe gateway answered in a way b6p does not understand; this may be a version mismatch. Try \`b6p check-updates\`.`;
  }
  return what;
}
