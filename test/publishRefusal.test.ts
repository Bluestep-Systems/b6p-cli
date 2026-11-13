// A publish refused because of the build manifest: clear messages, paths, "rebuild and push", --json field (CU-86bd2nrvf).
import { describe, it } from "node:test";
import assert from "node:assert";
import { bsjsGit, Err, type PushResult } from "@bluestep-systems/b6p-core";
import { describePublishRefusal, publishRefusalOf, publishRefusalOfError } from "../src/publishRefusal";
import { describePush, pushExitCode, toPushJson } from "../src/pushOutcome";
import { pushFailureOf } from "../src/pushFailure";
import { describeDeploy } from "../src/deployRun";

const STALE =
  "Publish refused (BUILD_STALE): The script was not published: its build is stale against scripts/app.ts, tsconfig.json; " +
  "rebuild and push the draft. The published script is unchanged.";
const MISSING =
  "Publish refused (BUILD_MANIFEST_MISSING): The script was not published: no build manifest at .build/.b6p-build.json";
const INVALID =
  "Publish refused (BUILD_MANIFEST_INVALID): The script was not published: .build/.b6p-build.json is not valid";

const REFUSED: PushResult = {
  pushed: true,
  commitSha: "a".repeat(40),
  publishedSha: null,
  publishError: STALE,
  switchedToGit: false,
  typeCheckDiagnostics: 0,
  liveVerified: null,
  liveMismatches: [],
  keptPlatformOnly: [],
};

describe("publishRefusalOf (what a push reports)", () => {
  it("recognizes the three reasons and reads the stale paths", () => {
    assert.deepStrictEqual(publishRefusalOf(STALE), {
      reason: "BUILD_STALE",
      withheld: ["scripts/app.ts", "tsconfig.json"],
    });
    assert.strictEqual(publishRefusalOf(MISSING)?.reason, "BUILD_MANIFEST_MISSING");
    assert.strictEqual(publishRefusalOf(INVALID)?.reason, "BUILD_MANIFEST_INVALID");
  });

  it("drops an 'and N more' tail and ignores other publish errors", () => {
    const more = STALE.replace("tsconfig.json;", "tsconfig.json, and 5 more;");
    assert.deepStrictEqual(publishRefusalOf(more)?.withheld, ["scripts/app.ts", "tsconfig.json"]);
    assert.strictEqual(publishRefusalOf("Publish failed: 500"), null);
    assert.strictEqual(publishRefusalOf("Publish refused (DRAFT_MOVED): x"), null);
    assert.strictEqual(publishRefusalOf(null), null);
  });
});

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
  it("each lists the paths it knows and says to rebuild and push", () => {
    const stale = describePublishRefusal({ reason: "BUILD_STALE", withheld: ["scripts/app.ts", "tsconfig.json"] });
    assert.match(stale, /scripts\/app\.ts\ntsconfig\.json/);
    assert.match(stale, /Rebuild and push again/);
    const missing = describePublishRefusal({ reason: "BUILD_MANIFEST_MISSING", withheld: [".build/.b6p-build.json"] });
    assert.match(missing, /\.build\/\.b6p-build\.json/);
    assert.match(missing, /Rebuild and push again/);
    assert.match(missing, /--externally-built/);
    const invalid = describePublishRefusal({ reason: "BUILD_MANIFEST_INVALID", withheld: [] });
    assert.match(invalid, /Rebuild and push again/);
  });
});

describe("push, --json and exit code", () => {
  it("a refused publish exits 1 on a snapshot, with publishRefusal in the JSON and the paths in the text", () => {
    assert.strictEqual(pushExitCode(REFUSED, true), 1);
    assert.deepStrictEqual(toPushJson(REFUSED).publishRefusal, {
      reason: "BUILD_STALE",
      withheld: ["scripts/app.ts", "tsconfig.json"],
    });
    const lines = describePush(REFUSED, true);
    assert.match(lines.errors[0], /Rebuild and push again/);
    assert.match(lines.errors[0], /scripts\/app\.ts/);
  });

  it("publishRefusal is null for a clean push and for another publish error", () => {
    assert.strictEqual(
      toPushJson({ ...REFUSED, publishError: null, publishedSha: "b".repeat(40) }).publishRefusal,
      null
    );
    assert.strictEqual(toPushJson({ ...REFUSED, publishError: "Publish failed: 500" }).publishRefusal, null);
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
        switchedToGit: false,
      },
    ]);
    assert.strictEqual(out.exitCode, 1);
    assert.match(out.errors[0], /Rebuild and push again/);
  });

  it("a target that threw a refusal is described by its paths", () => {
    const out = describeDeploy([
      {
        target: "https://a/",
        pushed: false,
        commitSha: null,
        publishedSha: null,
        publishError: null,
        switchedToGit: false,
        error: new bsjsGit.PublishBuildManifestMissingError({ withheld: [".build/.b6p-build.json"] }, "m"),
      },
    ]);
    assert.strictEqual(out.exitCode, 1);
    assert.match(out.errors[0], /\.build\/\.b6p-build\.json/);
  });
});
