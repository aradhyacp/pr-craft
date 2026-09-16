import { defineTool } from "eve/tools";
import { z } from "zod";

import { diffRange, runGit, targetBaseRef, targetRepoRoot } from "#lib/git.ts";

/** `--name-status` letters, mapped to words the model does not have to decode. */
const STATUS_WORDS: Record<string, string> = {
  A: "added",
  C: "copied",
  D: "deleted",
  M: "modified",
  R: "renamed",
  T: "type-changed",
};

export default defineTool({
  description:
    "List every file changed on this branch relative to the base branch, with how many lines were added and removed in each. Call this first: it is small, and it tells you which files are worth reading in full.",
  inputSchema: z.object({}),
  label: { start: () => "Summarizing changed files" },
  async execute() {
    const repoRoot = targetRepoRoot();
    const base = targetBaseRef(repoRoot);
    const range = diffRange(base);

    // numstat gives counts; name-status gives the kind of change. Keyed by path.
    const numstat = runGit(repoRoot, ["diff", "--numstat", "-M", range]);
    const nameStatus = runGit(repoRoot, ["diff", "--name-status", "-M", range]);

    const statuses = new Map<string, string>();
    for (const line of nameStatus.split("\n").filter(Boolean)) {
      const [code, ...paths] = line.split("\t");
      // A rename reports both old and new path; the new one is what we report.
      const filePath = paths.at(-1);
      if (!filePath || !code) continue;
      statuses.set(filePath, STATUS_WORDS[code[0]!] ?? code);
    }

    const files = numstat
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [added, removed, ...paths] = line.split("\t");
        const filePath = paths.at(-1) ?? "";
        return {
          path: filePath,
          // git writes "-" for binary files rather than a count.
          insertions: added === "-" ? null : Number(added),
          deletions: removed === "-" ? null : Number(removed),
          binary: added === "-",
          status: statuses.get(filePath) ?? "modified",
        };
      });

    const commitCount = runGit(repoRoot, [
      "rev-list",
      "--count",
      `${base}..HEAD`,
    ]);

    return {
      base,
      branch: runGit(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]),
      commits: Number(commitCount),
      totalFiles: files.length,
      files,
    };
  },
});
