import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import {
  GitError,
  detectBaseRef,
  resolveRepoPath,
  resolveRepoRoot,
  runGit,
  truncateBytes,
} from "../agent/lib/git.ts";

const fixtures: string[] = [];

after(() => {
  for (const dir of fixtures) rmSync(dir, { recursive: true, force: true });
});

/** Creates a real git repo with one commit on `branch`. */
function makeRepo(branch = "main"): string {
  const dir = mkdtempSync(path.join(tmpdir(), "prcraft-test-"));
  fixtures.push(dir);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8" });

  git("init", "--quiet", "--initial-branch", branch);
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  writeFileSync(path.join(dir, "README.md"), "hello\n");
  git("add", ".");
  git("commit", "--quiet", "-m", "initial commit");
  return dir;
}

describe("resolveRepoRoot", () => {
  it("finds the root from a nested directory", () => {
    const repo = makeRepo();
    const nested = path.join(repo, "src", "deep");
    mkdirSync(nested, { recursive: true });

    // macOS reports /var as a symlink to /private/var, so compare realpaths.
    assert.equal(
      execFileSync("git", ["rev-parse", "--show-toplevel"], {
        cwd: nested,
        encoding: "utf8",
      }).trim(),
      resolveRepoRoot(nested),
    );
  });

  it("throws a GitError outside a repository", () => {
    const notARepo = mkdtempSync(path.join(tmpdir(), "prcraft-bare-"));
    fixtures.push(notARepo);

    assert.throws(() => resolveRepoRoot(notARepo), GitError);
  });
});

describe("detectBaseRef", () => {
  it("returns an explicit ref that exists", () => {
    const repo = makeRepo();
    assert.equal(detectBaseRef(repo, "main"), "main");
  });

  it("throws when an explicit ref does not exist", () => {
    const repo = makeRepo();
    assert.throws(() => detectBaseRef(repo, "nope-not-here"), GitError);
  });

  it("falls back to a conventional branch name", () => {
    const repo = makeRepo("master");
    assert.equal(detectBaseRef(repo), "master");
  });

  it("prefers origin/HEAD when it is set", () => {
    const repo = makeRepo("main");
    // Simulate a clone's origin/HEAD without needing a real remote.
    runGit(repo, ["update-ref", "refs/remotes/origin/trunk", "HEAD"]);
    runGit(repo, [
      "symbolic-ref",
      "refs/remotes/origin/HEAD",
      "refs/remotes/origin/trunk",
    ]);

    assert.equal(detectBaseRef(repo), "origin/trunk");
  });

  it("throws when no candidate branch exists", () => {
    const repo = makeRepo("some-feature-branch");
    assert.throws(() => detectBaseRef(repo), GitError);
  });
});

describe("resolveRepoPath", () => {
  it("resolves a path inside the repository", () => {
    const repo = makeRepo();
    assert.equal(resolveRepoPath(repo, "README.md"), path.join(repo, "README.md"));
  });

  it("rejects traversal outside the repository", () => {
    const repo = makeRepo();
    assert.throws(() => resolveRepoPath(repo, "../outside.txt"), GitError);
  });

  it("rejects an absolute path outside the repository", () => {
    const repo = makeRepo();
    assert.throws(() => resolveRepoPath(repo, "/etc/passwd"), GitError);
  });

  it("accepts an absolute path inside the repository", () => {
    const repo = makeRepo();
    const abs = path.join(repo, "README.md");
    assert.equal(resolveRepoPath(repo, abs), abs);
  });
});

describe("truncateBytes", () => {
  it("leaves short text untouched", () => {
    const result = truncateBytes("hello", 100);
    assert.equal(result.truncated, false);
    assert.equal(result.text, "hello");
  });

  it("truncates and reports when over the cap", () => {
    const result = truncateBytes("a".repeat(500), 100);
    assert.equal(result.truncated, true);
    assert.ok(Buffer.byteLength(result.text) <= 100);
  });

  it("does not split a multi-byte character", () => {
    // "é" is two bytes; a cap landing mid-character must not produce U+FFFD.
    const result = truncateBytes("é".repeat(50), 51);
    assert.equal(result.truncated, true);
    assert.ok(!result.text.includes("�"));
  });
});

describe("runGit", () => {
  it("returns stdout for a successful command", () => {
    const repo = makeRepo();
    assert.equal(runGit(repo, ["rev-parse", "--abbrev-ref", "HEAD"]), "main");
  });

  it("throws a GitError carrying stderr for a failing command", () => {
    const repo = makeRepo();
    assert.throws(
      () => runGit(repo, ["rev-parse", "--verify", "definitely-not-a-ref"]),
      GitError,
    );
  });
});
