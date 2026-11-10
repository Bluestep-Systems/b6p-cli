// Spec for the gateway "how to fix" text and the --expires logic. Core says what happened; the CLI
// says what to do, so each typed error must come out with its remedy.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Err } from "@bluestep-systems/b6p-core";
import type { GatewayMintedToken } from "@bluestep-systems/b6p-core";
import { describeGatewayError } from "../src/gatewayErrors";
import { confirmNeverExpires, parseExpires, type NeverExpiresPrompt } from "../src/tokenExpiry";

const minted: GatewayMintedToken = {
  id: "1",
  token: "b6pt_SECRET",
  alias: "a",
  scopes: [],
  expiresAt: null,
  neverExpires: true,
};

function text(err: Error): string {
  const t = describeGatewayError(err);
  assert.ok(t !== undefined, "a gateway error must be described");
  return t;
}

test("a non-gateway error is not described (the caller rethrows it)", () => {
  assert.equal(describeGatewayError(new Error("boom")), undefined);
  assert.equal(describeGatewayError("x"), undefined);
});

test("auth errors point at `b6p auth set`", () => {
  for (const reason of ["token-missing", "token-invalid", "token-malformed"] as const) {
    assert.match(text(new Err.GatewayAuthError("m", reason, null)), /b6p auth set/);
  }
});

test("a missing scope names the scope to mint", () => {
  assert.match(text(new Err.GatewayScopeError("m", "kb:push")), /`kb:push`/);
  assert.match(text(new Err.GatewayScopeError("m", "tokens:self")), /tokens:self/);
  assert.match(text(new Err.GatewayScopeError("m", null)), /Mint a token/);
  assert.match(text(new Err.GatewayScopeEscalationError("m")), /fewer scopes/);
});

test("alias, ambiguity and argument errors say what to do", () => {
  const taken = text(new Err.GatewayAliasTakenError("m"));
  assert.match(taken, /another --alias/);
  assert.match(taken, /revoke/);
  assert.ok(!/rotate/.test(taken), "rotate keeps the old scopes and lifetime, so it is not the answer to a clash");
  const amb = text(new Err.GatewayTokenAmbiguousError("m", ["1", "2"]));
  assert.ok(!amb.includes("1, 2"), "core's message already lists the ids");
  assert.match(amb, /web token page/);
  assert.equal(text(new Err.GatewayInvalidArgumentError("bad alias")), "bad alias");
});

test("a failed token store points at `b6p auth set` and never prints the secret", () => {
  const t = text(new Err.GatewayTokenStoreError("could not store", minted));
  assert.match(t, /b6p auth set/);
  assert.ok(!t.includes("b6pt_SECRET"));
});

test("permission, not-found, conflict and availability errors", () => {
  assert.match(text(new Err.GatewayKnowledgeBasePushNotPermittedError("m", "global/x")), /global\/x/);
  assert.match(text(new Err.GatewayNotPermittedError("m", null)), /not allowed/);
  assert.match(text(new Err.GatewayNotFoundError("m", null)), /b6p kb list/);
  const conflict = text(new Err.GatewayConflictError("m", null));
  assert.match(conflict, /merge or rebase/);
  assert.ok(!/`b6p kb pull <ref> <dir>` to fast-forward/.test(conflict), "pull would refuse a diverged folder");
  assert.match(text(new Err.GatewayTooLargeError("m", null)), /smaller/);
  assert.match(text(new Err.GatewayUnavailableError("m", 502, null)), /try again/);
  const cfg = describeGatewayError(new Err.GatewayConfigError("m"), { gatewayUrl: "https://staging.example/gw" });
  assert.ok(cfg !== undefined);
  assert.match(cfg, /https:\/\/staging\.example\/gw/);
  assert.ok(!cfg.includes("gateway.bluestep.net"), "the production URL must not be hard-coded");
  assert.match(cfg, /server/);
});

test("the 2026-11-10 delta errors each say how to go on", () => {
  assert.match(text(new Err.GatewayInvalidRequestError("m", "invalid-request")), /rejected what was sent/);
  const limit = text(new Err.GatewayTokenLimitError("m", 50));
  assert.match(limit, /maximum of 50 live tokens/);
  assert.match(limit, /b6p auth token revoke --tokenid <alias>/);
  assert.match(text(new Err.GatewayTokenLimitError("m", null)), /maximum number of live tokens/);

  const at = "2026-12-01T00:00:00.000Z";
  const dated = text(new Err.GatewayTokenExpiryRefusedError("m", "2027-03-01T00:00:00Z", at));
  assert.match(dated, /expires 2027-03-01T00:00:00Z/);
  assert.match(dated, new RegExp(`expires ${at}`));
  assert.match(dated, /--expires before/);
  assert.match(text(new Err.GatewayTokenExpiryRefusedError("m", null, at)), /never expires/);

  const registry = text(new Err.GatewayUnavailableError("m", 503, "registry-unavailable"));
  assert.match(registry, /web-global/);
  assert.match(registry, /Try again/);
  assert.ok(!/git server/.test(registry));
  assert.match(text(new Err.GatewayUnavailableError("m", 502, "forge-unavailable")), /git server/);

  // Only the push conflict talks about merging; any other 409 code gets the neutral advice.
  const other = text(new Err.GatewayConflictError("m", "stale-state"));
  assert.match(other, /conflict with its current state/);
  assert.ok(!/merge or rebase/.test(other));
  assert.match(text(new Err.GatewayConflictError("m", "non-fast-forward")), /merge or rebase/);
});

test("a refused mint that the expiry does not explain mentions the rollout; other 403s do not", () => {
  const err = new Err.GatewayNotPermittedError("m", "not-permitted");
  const mint = describeGatewayError(err, { operation: "token-create" });
  assert.ok(mint !== undefined);
  assert.match(mint, /rolled out/);
  assert.match(text(err), /not allowed/);
  assert.ok(!/rolled out/.test(text(err)));
});

test("a dirty tree lists its paths; a mismatch asks for another folder", () => {
  const dirty = text(new Err.GatewayDirtyWorkingTreeError("m", ["a.md", "docs/b.md"]));
  assert.match(dirty, /a\.md/);
  assert.match(dirty, /docs\/b\.md/);
  assert.match(text(new Err.GatewayCloneMismatchError("m", "different-repo", "/d", "core")), /another folder/);
  assert.match(text(new Err.GatewayCloneMismatchError("m", "different-ref", "/d", "core")), /different branch or tag/);
});

test("every working-copy reason has advice", () => {
  const reasons = [
    "not-empty",
    "not-a-clone",
    "detached",
    "no-upstream",
    "diverged",
    "ref-not-found",
    "wrong-repository",
  ] as const;
  for (const r of reasons) {
    assert.ok(text(new Err.GatewayWorkingCopyError("what happened", r)).length > "what happened".length, r);
  }
  assert.match(text(new Err.GatewayWorkingCopyError("m", "wrong-repository")), /another folder/);
  assert.match(text(new Err.GatewayWorkingCopyError("m", "diverged")), /merge or rebase/);
});

test("every knowledge-base reason has advice; wrong-branch says to switch", () => {
  const reasons = ["bad-ref", "not-found", "ambiguous", "unsafe-name", "not-a-kb"] as const;
  for (const r of reasons) {
    assert.ok(text(new Err.GatewayKnowledgeBaseError("what", r, "x", ["a", "b"])).length > 4, r);
  }
  assert.match(
    text(new Err.GatewayKnowledgeBaseError("m", "ambiguous", "x", ["global/x", "tenant/U1/x"])),
    /global\/x, tenant\/U1\/x/
  );
  const wrong = text(
    new Err.GatewayKnowledgeBaseError("m", "wrong-branch", "global/x", [], { branch: "feat", liveBranch: "master" })
  );
  assert.match(wrong, /Switch to it \(`git switch master`/);
  assert.match(wrong, /branch feat/);
  const detached = text(
    new Err.GatewayKnowledgeBaseError("m", "wrong-branch", "global/x", [], { branch: null, liveBranch: "master" })
  );
  assert.match(detached, /detached head/);
});

test("parseExpires: default, days, dates, never, and refusals", () => {
  const now = new Date("2026-11-06T00:00:00.000Z");
  assert.deepEqual(parseExpires(undefined, now), { kind: "default" });
  assert.deepEqual(parseExpires("never", now), { kind: "never" });
  assert.deepEqual(parseExpires("NEVER", now), { kind: "never" });
  assert.deepEqual(parseExpires("90d", now), { kind: "at", iso: "2027-02-04T00:00:00.000Z" });
  assert.deepEqual(parseExpires("2027-01-31", now), { kind: "at", iso: "2027-01-31T00:00:00.000Z" });
  assert.deepEqual(parseExpires("2027-01-31T12:00:00Z", now), { kind: "at", iso: "2027-01-31T12:00:00.000Z" });
  assert.deepEqual(parseExpires("2027-01-31T12:00:00+02:00", now), { kind: "at", iso: "2027-01-31T10:00:00.000Z" });
  assert.deepEqual(parseExpires("2027-01-31T12:00:00.5Z", now), { kind: "at", iso: "2027-01-31T12:00:00.500Z" });
  // Core also takes a date-time without seconds, and up to nine fractional digits.
  assert.deepEqual(parseExpires("2027-01-31T12:00Z", now), { kind: "at", iso: "2027-01-31T12:00:00.000Z" });
  assert.deepEqual(parseExpires("2027-01-31T12:00+02:00", now), { kind: "at", iso: "2027-01-31T10:00:00.000Z" });
  assert.deepEqual(parseExpires("2027-01-31T12:00:00.123456789Z", now), {
    kind: "at",
    iso: "2027-01-31T12:00:00.123Z",
  });
  // Core takes only a zone-qualified ISO date-time with Z or an offset; the rest is refused here, before any request.
  for (const bad of [
    "2027-01-31T12:00:00",
    "2027-01-31T12:00",
    "2027-01-31T12Z",
    "2027-01-31 12:00:00Z",
    "2027-02-31",
    "2027-02-31T00:00:00Z",
    "20270131",
  ]) {
    assert.equal(parseExpires(bad, now).kind, "invalid", bad);
  }
  for (const bad of ["0d", "-5d", "soon", "90", "2020-01-01", "2027-13-45", "d", "1.5d", ""]) {
    assert.equal(parseExpires(bad, now).kind, "invalid", bad);
  }
});

test("never-expires: --yes proceeds only on the explicit flag, otherwise the safe option is first", async () => {
  const asked: { options: string[]; opts?: { destructive?: boolean; safeOption?: string } }[] = [];
  const warnings: string[] = [];
  const make = (answer: (options: string[]) => string | undefined): NeverExpiresPrompt => ({
    warn: (m) => warnings.push(m),
    confirm: async (_m, options, opts) => {
      asked.push({ options, opts });
      return answer(options);
    },
  });

  // --yes: the flag was typed, so it goes ahead without asking, and warns.
  assert.equal(
    await confirmNeverExpires(
      make(() => undefined),
      true
    ),
    true
  );
  assert.equal(asked.length, 0);
  assert.equal(warnings.length, 1);

  // Interactive: asks, safe option first and destructive, so an empty answer (options[0]) declines.
  assert.equal(
    await confirmNeverExpires(
      make((o) => o[0]),
      false
    ),
    false
  );
  assert.equal(asked[0].options[0], "Cancel");
  assert.equal(asked[0].opts?.destructive, true);
  assert.equal(asked[0].opts?.safeOption, "Cancel");
  // An explicit "yes" answer proceeds; no match declines.
  assert.equal(
    await confirmNeverExpires(
      make((o) => o[1]),
      false
    ),
    true
  );
  assert.equal(
    await confirmNeverExpires(
      make(() => undefined),
      undefined
    ),
    false
  );
});

test("an off-contract token answer is described without its secret, with the right next step", () => {
  const SECRET = "b6pt_OFFCONTRACT";
  const create = text(new Err.GatewayOffContractTokenError("malformed", "create", SECRET, false));
  assert.match(create, /printed once/);
  assert.match(create, /token list/);
  const stored = text(new Err.GatewayOffContractTokenError("malformed", "rotate", SECRET, true));
  assert.match(stored, /stored for b6p/);
  const notStored = text(new Err.GatewayOffContractTokenError("malformed", "rotate", SECRET, false));
  assert.match(notStored, /b6p auth set/);
  for (const t of [create, stored, notStored]) {
    assert.ok(!t.includes(SECRET), "the secret must not appear in the description");
  }
});

test("marketplace tag-moved and tag-gone say to pull into a fresh folder", () => {
  assert.match(text(new Err.GatewayCloneMismatchError("m", "tag-moved", "/d", "core")), /fresh folder/);
  assert.match(text(new Err.GatewayCloneMismatchError("m", "tag-gone", "/d", "core")), /fresh folder/);
});

test("a git timeout (unavailable) says the gateway stopped responding and to retry", () => {
  const t = text(new Err.GatewayUnavailableError("The gateway stopped responding.", null, null));
  assert.match(t, /stopped responding/);
  assert.match(t, /try again/);
});

test("token not-found and ambiguous advice never quote the id or alias the user typed", () => {
  const nf = text(new Err.GatewayNotFoundError("No token matches the given id or alias.", null));
  assert.ok(!nf.includes("my-secret-alias"));
});

test("an unknown outcome says the token may exist and how to check", () => {
  const create = text(new Err.GatewayOutcomeUnknownError("No answer came.", "create", null));
  assert.match(create, /may already have been created/);
  assert.match(create, /b6p auth token list/);
  const rotate = text(new Err.GatewayOutcomeUnknownError("No answer came.", "rotate", 504));
  assert.match(rotate, /may already have been rotated/);
  assert.match(rotate, /old one is revoked/);
  assert.match(rotate, /b6p auth set/);
});

test("redirect-refused and invalid-git-response have their own advice", () => {
  assert.match(text(new Err.GatewayUnexpectedResponseError("m", 302, "redirect-refused")), /never follows a redirect/);
  assert.match(text(new Err.GatewayUnexpectedResponseError("m", 200, "invalid-git-response")), /not git/);
  assert.match(text(new Err.GatewayUnexpectedResponseError("m", 418, null)), /version mismatch/);
});

test("unsafe-target asks for another folder", () => {
  assert.match(text(new Err.GatewayWorkingCopyError("m", "unsafe-target")), /different folder/);
});

test("wrong-branch names the branch, what it tracks and the live branch", () => {
  const untracked = text(
    new Err.GatewayKnowledgeBaseError("m", "wrong-branch", "global/x", [], {
      branch: "feat",
      liveBranch: "master",
      upstream: null,
    })
  );
  assert.match(untracked, /branch feat and tracks nothing/);
  assert.match(untracked, /git switch master/);
  const elsewhere = text(
    new Err.GatewayKnowledgeBaseError("m", "wrong-branch", "global/x", [], {
      branch: "master",
      liveBranch: "master",
      upstream: "origin/other",
    })
  );
  assert.match(elsewhere, /tracks origin\/other rather than origin\/master/);
  const detached = text(
    new Err.GatewayKnowledgeBaseError("m", "wrong-branch", "global/x", [], {
      branch: null,
      liveBranch: "master",
      upstream: null,
    })
  );
  assert.match(detached, /detached head/);
});

test("a not-a-clone folder is told to use the clone's top folder or [dir]", () => {
  const t = text(new Err.GatewayWorkingCopyError("m", "not-a-clone"));
  assert.match(t, /inside it/);
  assert.match(t, /\[dir\]/);
});

test("an unexpected response without a status may be an unusable marketplace name: pass [dir]", () => {
  const t = text(new Err.GatewayUnexpectedResponseError("m", null, null));
  assert.match(t, /pass \[dir\]/);
  assert.match(t, /version mismatch/);
});

test("the invalid-argument and unsafe-name cases keep their own words or advice", () => {
  assert.equal(text(new Err.GatewayInvalidArgumentError("The folder is relative.")), "The folder is relative.");
  assert.match(text(new Err.GatewayKnowledgeBaseError("m", "unsafe-name", "x")), /b6p kb pull <ref> <dir>/);
});
