// Specs for the component command's repo-URL resolution: the positional wins,
// a clone's origin is read straight from .git/config (no git spawn), and
// neither being available fails with both ways to supply it named.
import { test } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { originUrlFromClone, parseOriginUrl } from "../src/commands/component";

const CONFIG = `[core]
\trepositoryformatversion = 0
\tbare = false
[remote "origin"]
\turl = https://config.example.net/git/component/revenue-tile.git
\tfetch = +refs/heads/*:refs/remotes/origin/*
[branch "draft"]
\tremote = origin
`;

test("parseOriginUrl reads the url of the origin section only", () => {
  assert.equal(parseOriginUrl(CONFIG), "https://config.example.net/git/component/revenue-tile.git");
  const other = CONFIG.replace('"origin"', '"upstream"');
  assert.equal(parseOriginUrl(other), null, "a non-origin remote must not answer");
  assert.equal(parseOriginUrl("[core]\n\tbare = false\n"), null);
});

test("parseOriginUrl is not fooled by a url line in another section", () => {
  const tricky = `[remote "upstream"]\n\turl = https://wrong.example.net/x.git\n[remote "origin"]\n\turl = https://right.example.net/git/component/a.git\n`;
  assert.equal(parseOriginUrl(tricky), "https://right.example.net/git/component/a.git");
});

test("originUrlFromClone walks up to the nearest .git/config", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "b6p-component-"));
  try {
    fs.mkdirSync(path.join(root, ".git"), { recursive: true });
    fs.writeFileSync(path.join(root, ".git", "config"), CONFIG);
    const nested = path.join(root, "src", "deep");
    fs.mkdirSync(nested, { recursive: true });
    assert.equal(originUrlFromClone(nested), "https://config.example.net/git/component/revenue-tile.git");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("originUrlFromClone follows a .git FILE to the linked worktree's shared config", () => {
  // In a linked worktree (and a submodule) `.git` is a file: `gitdir: <path>`.
  // The worktree's config lives in the directory its `commondir` file names.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "b6p-worktree-"));
  try {
    const mainGit = path.join(root, "main", ".git");
    const wtGitDir = path.join(mainGit, "worktrees", "wt");
    fs.mkdirSync(wtGitDir, { recursive: true });
    fs.writeFileSync(path.join(mainGit, "config"), CONFIG);
    fs.writeFileSync(path.join(wtGitDir, "commondir"), "../..\n");
    const worktree = path.join(root, "wt");
    fs.mkdirSync(worktree, { recursive: true });
    fs.writeFileSync(path.join(worktree, ".git"), `gitdir: ${wtGitDir}\n`);
    assert.equal(originUrlFromClone(worktree), "https://config.example.net/git/component/revenue-tile.git");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("originUrlFromClone stops at the nearest repo instead of answering an enclosing one", () => {
  // A repo with no origin must answer null, not walk up to a PARENT repo's
  // origin — that is a different project's URL.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "b6p-nested-"));
  try {
    fs.mkdirSync(path.join(root, ".git"), { recursive: true });
    fs.writeFileSync(path.join(root, ".git", "config"), CONFIG);
    const inner = path.join(root, "sub");
    fs.mkdirSync(path.join(inner, ".git"), { recursive: true });
    fs.writeFileSync(path.join(inner, ".git", "config"), "[core]\n\tbare = false\n");
    assert.equal(originUrlFromClone(inner), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("parseOriginUrl unquotes the value and drops a trailing config comment", () => {
  assert.equal(
    parseOriginUrl('[remote "origin"]\n\turl = "https://h.example.net/git/component/a.git"\n'),
    "https://h.example.net/git/component/a.git"
  );
  assert.equal(
    parseOriginUrl('[remote "origin"]\n\turl = https://h.example.net/git/component/a.git ; platform remote\n'),
    "https://h.example.net/git/component/a.git"
  );
});

test("originUrlFromClone answers null outside any repo", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "b6p-norepo-"));
  try {
    assert.equal(originUrlFromClone(root), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
