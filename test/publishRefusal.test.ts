// A publish refused because of the build manifest: clear messages, paths, "rebuild and push", --json field (CU-86bd2nrvf).
import { describe, it } from "node:test";
import assert from "node:assert";
import { bsjsGit, Err, type PushResult } from "@bluestep-systems/b6p-core";
import { describePublishRefusal, publishRefusalOfError } from "../src/publishRefusal";
import { pushExitCode, pushProblem, toPushJson } from "../src/pushOutcome";
import { pushFailureOf } from "../src/pushFailure";
import { describeDeploy } from "../src/deployRun";

const STALE =
  "Publish refused (BUILD_STALE): The script was not published: its build is stale against scripts/app.ts, tsconfig.json; " +
  "rebuild and push the draft. The published script is unchanged.";

const STALE_REFUSAL = { reason: "BUILD_STALE", withheld: ["scripts/app.ts", "tsconfig.json"] };

const REFUSED: PushResult = {
  pushed: true,
  commitSha: "a".repeat(40),
  publishedSha: null,
  publishError: STALE,
  publishRefusal: STALE_REFUSAL,
  switchedToGit: false,
  route: null,
  snapshotRefused: null,
  build: null,
  buildCommitSha: null,
  buildVouched: null,
  buildError: null,
  buildErrorKind: null,
  buildIncomplete: null,
  buildFastForward: null,
  typeCheckDiagnostics: 0,
  typeCheckErrors: [],
  liveVerified: null,
  liveMismatches: [],
  keptPlatformOnly: [],
};

describe("publishRefusalOfError (what is thrown)", () => {
  it("takes the platform's withheld list from the three classes", () => {
    const details = { withheld: ["a.ts", "b.ts"] };
    const stale = new bsjsGit.PublishBuildStaleError(details, "stale");
    const missing = new bsjsGit.PublishBuildManifestMissingError({ withheld: [".build/.b6p-build.json"] }, "m");
    const invalid = new bsjsGit.PublishBuildManifestInvalidError({ withheld: [".build/.b6p-build.json"] }, "i");
    assert.deepStrictEqual(publishRefusalOfError(stale), { reason: "BUILD_STALE", withheld: ["a.ts", "b.ts"] });
    assert.strictEqual(publishRefusalOfError(missing)?.reason, "BUILD_MANIFEST_MISSING");
    assert.deepStrictEqual(publishRefusalOfError(invalid)?.withheld, [".build/.b6p-build.json"]);
    assert.strictEqual(publishRefusalOfError(new Error("x")), null);
  });
});

describe("messages", () => {
  it("each lists the paths it knows and says to push the snapshot again; none names --externally-built", () => {
    const stale = describePublishRefusal({ reason: "BUILD_STALE", withheld: ["scripts/app.ts", "tsconfig.json"] });
    assert.match(stale, /scripts\/app\.ts\ntsconfig\.json/);
    assert.match(stale, /b6p script push --snapshot/);
    const missing = describePublishRefusal({ reason: "BUILD_MANIFEST_MISSING", withheld: [".build/.b6p-build.json"] });
    assert.match(missing, /\.build\/\.b6p-build\.json/);
    assert.match(missing, /clean build/);
    assert.doesNotMatch(missing, /--externally-built/);
    const invalid = describePublishRefusal({ reason: "BUILD_MANIFEST_INVALID", withheld: [] });
    assert.match(invalid, /b6p script push --snapshot/);
    assert.match(describePublishRefusal({ reason: "DRAFT_MOVED", withheld: [] }), /b6p script pull/);
  });
});

describe("push, --json and exit code", () => {
  it("a refused publish exits 1 on a snapshot, with publishRefusal in the JSON and the paths in the text", () => {
    assert.strictEqual(pushExitCode(REFUSED, true), 1);
    const problem = pushProblem(REFUSED, true);
    assert.strictEqual(problem?.kind, "PUBLISH_REFUSED");
    assert.match(problem?.howTo ?? "", /b6p script push --snapshot/);
    assert.match(problem?.howTo ?? "", /scripts\/app\.ts/);
  });

  it("--json carries core's publishRefusal as is, and a refusal that is not a build one gets a generic message", () => {
    assert.deepStrictEqual(toPushJson(REFUSED, true).publishRefusal, STALE_REFUSAL);
    const moved = { reason: "DRAFT_MOVED", withheld: ["a.ts"] };
    assert.deepStrictEqual(toPushJson({ ...REFUSED, publishRefusal: moved }, true).publishRefusal, moved);
    const other = { reason: "SOMETHING_NEW", withheld: ["a.ts"] };
    assert.match(describePublishRefusal(other), /SOMETHING_NEW/);
  });

  it("publishRefusal is null for a clean push and for a publish failure that is not a refusal", () => {
    assert.strictEqual(toPushJson({ ...REFUSED, publishError: null, publishRefusal: null }, true).publishRefusal, null);
    const failed = { ...REFUSED, publishError: "Publish failed: 500", publishRefusal: null };
    assert.strictEqual(toPushJson(failed, true).publishRefusal, null);
    assert.strictEqual(pushProblem(failed, true)?.kind, "PUBLISH_FAILED");
  });

  it("a thrown refusal is a failure with the paths and publishRefusal in the JSON", () => {
    const e = new bsjsGit.PublishBuildStaleError({ withheld: ["a.ts"] }, "stale");
    const failure = pushFailureOf(e, [], "posix");
    assert.match(failure?.message ?? "", /a\.ts/);
    assert.deepStrictEqual(failure?.json.publishRefusal, { reason: "BUILD_STALE", withheld: ["a.ts"] });
    assert.strictEqual(failure?.json.pushed, false);
  });

  it("a thrown refusal after a switch still reports the switch", () => {
    const e = Object.assign(new bsjsGit.PublishBuildStaleError({ withheld: [] }, "stale"), { switchedToGit: true });
    assert.strictEqual(pushFailureOf(e, [], "posix")?.json.switchedToGit, true);
    assert.ok(new Err.OverwriteDeclinedError("x", []) instanceof Error);
  });
});

describe("deploy", () => {
  it("a target whose publish was refused fails the deploy with the rebuild message", () => {
    const out = describeDeploy([
      {
        target: "https://a/",
        pushed: true,
        commitSha: "c".repeat(40),
        publishedSha: null,
        publishError: STALE,
        publishRefusal: STALE_REFUSAL,
        switchedToGit: false,
        buildCommitSha: null,
        buildVouched: null,
        buildError: null,
        buildErrorKind: null,
        buildIncomplete: null,
        buildFastForward: null,
        snapshotRefused: null,

        typeCheckDiagnostics: null,
        typeCheckErrors: [],
      },
    ], false, [true]);
    assert.strictEqual(out.exitCode, 1);
    assert.match(out.errors[0], /refused to publish/);
    assert.match(out.notices[0], /b6p script push --snapshot/);
  });

  it("a target that threw a refusal is described by its paths", () => {
    const out = describeDeploy([
      {
        target: "https://a/",
        pushed: false,
        commitSha: null,
        publishedSha: null,
        publishError: null,
        publishRefusal: null,
        switchedToGit: false,
        buildCommitSha: null,
        buildVouched: null,
        buildError: null,
        buildErrorKind: null,
        buildIncomplete: null,
        buildFastForward: null,
        snapshotRefused: null,
        typeCheckDiagnostics: null,
        typeCheckErrors: [],
        error: new bsjsGit.PublishBuildManifestMissingError({ withheld: [".build/.b6p-build.json"] }, "m"),
      },
    ]);
    assert.strictEqual(out.exitCode, 1);
    assert.match(out.errors[0], /\.build\/\.b6p-build\.json/);
  });
});
