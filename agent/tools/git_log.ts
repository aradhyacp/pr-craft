import { defineTool } from "eve/tools";
import { z } from "zod";

import { runGit, targetBaseRef, targetRepoRoot } from "#lib/git.ts";

/** Field separator unlikely to appear in a commit message. */
const FIELD = "";
const RECORD = "";

export default defineTool({
  description:
    "List the commits on this branch that are not on the base branch, newest first, with their full messages. Commit messages often state intent the diff alone does not show.",
  inputSchema: z.object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .optional()
      .describe("Maximum commits to return. Defaults to 50."),
  }),
  label: { start: () => "Reading commit history" },
  async execute({ limit }) {
    const repoRoot = targetRepoRoot();
    const base = targetBaseRef(repoRoot);

    const output = runGit(repoRoot, [
      "log",
      `--max-count=${limit ?? 50}`,
      `--format=%h${FIELD}%an${FIELD}%aI${FIELD}%s${FIELD}%b${RECORD}`,
      `${base}..HEAD`,
    ]);

    const commits = output
      .split(RECORD)
      .map((record) => record.trim())
      .filter(Boolean)
      .map((record) => {
        const [hash, author, date, subject, body] = record.split(FIELD);
        return {
          hash,
          author,
          date,
          subject,
          body: body?.trim() || null,
        };
      });

    return { base, count: commits.length, commits };
  },
});
