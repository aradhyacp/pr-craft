import { execFileSync } from "node:child_process";
import path from "node:path";

/** Branch names tried, in order, when the base branch is not otherwise known. */
const FALLBACK_BRANCHES = ["main", "master", "develop"] as const;

/** Generous ceiling so a large `git diff` reaches us intact and we truncate it ourselves. */
const MAX_GIT_OUTPUT_BYTES = 64 * 1024 * 1024;

/**
 * A git operation that failed for a reason the user can act on: not a
 * repository, an unknown ref, a path outside the repo.
 *
 * Carrying a distinct type lets the CLI print a plain message instead of a
 * stack trace, and lets tools return the reason to the model as text.
 */
export class GitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitError";
  }
}

/** Runs git in `cwd` and returns trimmed stdout, throwing {@link GitError} on failure. */
export function runGit(cwd: string, args: readonly string[]): string {
  try {
    return execFileSync("git", args as string[], {
      cwd,
      encoding: "utf8",
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
      // Capture stderr instead of letting git print to the user's terminal;
      // probing for refs that may not exist is a normal part of detection.
      stdio: ["ignore", "pipe", "pipe"],
      // Keep git from opening an editor, pager, or credential prompt.
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_PAGER: "cat" },
    }).trim();
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new GitError(
      stderr && stderr.length > 0
        ? `git ${args.join(" ")} failed: ${stderr}`
        : `git ${args.join(" ")} failed`,
    );
  }
}

/** Returns the repository root containing `startDir`. */
export function resolveRepoRoot(startDir: string): string {
  try {
    return runGit(startDir, ["rev-parse", "--show-toplevel"]);
  } catch {
    throw new GitError(`Not inside a git repository: ${startDir}`);
  }
}

/** Whether `ref` resolves to a commit in this repository. */
function refExists(repoRoot: string, ref: string): boolean {
  try {
    runGit(repoRoot, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves the branch to diff against.
 *
 * An explicit ref wins but must exist. Otherwise `origin/HEAD` is the most
 * reliable signal of a clone's default branch, and only when it is unset do we
 * guess from conventional names.
 */
export function detectBaseRef(repoRoot: string, explicit?: string): string {
  if (explicit) {
    if (!refExists(repoRoot, explicit)) {
      throw new GitError(`Base ref not found in this repository: ${explicit}`);
    }
    return explicit;
  }

  try {
    const symbolic = runGit(repoRoot, ["symbolic-ref", "refs/remotes/origin/HEAD"]);
    const shorthand = symbolic.replace(/^refs\/remotes\//, "");
    if (shorthand !== symbolic && refExists(repoRoot, shorthand)) return shorthand;
  } catch {
    // origin/HEAD is unset, which is normal in a repo that was never cloned.
  }

  for (const branch of FALLBACK_BRANCHES) {
    for (const candidate of [`origin/${branch}`, branch]) {
      if (refExists(repoRoot, candidate)) return candidate;
    }
  }

  throw new GitError(
    `Could not determine a base branch (looked for origin/HEAD, then ${FALLBACK_BRANCHES.join(", ")}). Pass --base <ref>.`,
  );
}

/**
 * Resolves `candidate` against the repository root, rejecting anything that
 * escapes it. Guards the file-reading tool against `../` traversal and absolute
 * paths pointing elsewhere on the machine.
 */
export function resolveRepoPath(repoRoot: string, candidate: string): string {
  const absolute = path.resolve(repoRoot, candidate);
  const relative = path.relative(repoRoot, absolute);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new GitError(`Path escapes the repository: ${candidate}`);
  }

  return absolute;
}

/**
 * Caps `text` at `maxBytes` without splitting a multi-byte character.
 *
 * Callers report the `truncated` flag to the model so it narrows its next
 * request rather than reasoning about a silently cut patch.
 */
export function truncateBytes(
  text: string,
  maxBytes: number,
): { text: string; truncated: boolean } {
  const buffer = Buffer.from(text, "utf8");
  if (buffer.byteLength <= maxBytes) return { text, truncated: false };

  let decoded = new TextDecoder("utf-8").decode(buffer.subarray(0, maxBytes));
  // A cap landing mid-character decodes to a trailing replacement char; drop it.
  if (decoded.endsWith("�")) decoded = decoded.slice(0, -1);

  return { text: decoded, truncated: true };
}

/**
 * The repository the current invocation targets.
 *
 * The CLI sets `PRCRAFT_REPO` to the directory it was launched from, because the
 * agent server's own cwd is the install location, not the user's checkout.
 */
export function targetRepoRoot(): string {
  return resolveRepoRoot(process.env.PRCRAFT_REPO ?? process.cwd());
}

/**
 * The base ref for this invocation.
 *
 * The CLI resolves it once and exports `PRCRAFT_BASE` so every tool diffs
 * against the same ref; detection reruns only if that is somehow missing.
 */
export function targetBaseRef(repoRoot: string): string {
  const configured = process.env.PRCRAFT_BASE;
  if (configured && configured.length > 0) return configured;
  return detectBaseRef(repoRoot);
}

/**
 * Both ends of the comparison.
 *
 * Diffs use three-dot range syntax (`base...HEAD`), which compares against the
 * merge base rather than the tip of `base`. That keeps unrelated commits landing
 * on the base branch out of this branch's diff.
 */
export function diffRange(base: string): string {
  return `${base}...HEAD`;
}
