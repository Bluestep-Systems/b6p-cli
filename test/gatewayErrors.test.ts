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
  assert.match(text(new Err.GatewayAliasTakenError("m")), /rotate/);
  assert.match(text(new Err.GatewayTokenAmbiguousError("m", ["1", "2"])), /token id.*1, 2/);
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
  assert.match(text(new Err.GatewayConflictError("m", null)), /pull/);
  assert.match(text(new Err.GatewayTooLargeError("m", null)), /smaller/);
  assert.match(text(new Err.GatewayUnavailableError("m", 502, null)), /try again/);
  assert.match(text(new Err.GatewayConfigError("m")), /gatewayUrl/);
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
  assert.match(wrong, /Switch to master/);
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
