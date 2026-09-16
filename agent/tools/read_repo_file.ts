import { readFile } from "node:fs/promises";

import { defineTool } from "eve/tools";
import { z } from "zod";

import { GitError, resolveRepoPath, targetRepoRoot, truncateBytes } from "#lib/git.ts";

/** Cap on one file handed to the model, matching the patch budget's intent. */
const MAX_FILE_BYTES = 80_000;

export default defineTool({
  description:
    "Read a file from the working tree as it currently stands on this branch. Use it when a patch alone does not explain what a change does, for example to see the surrounding function or the file a change is called from.",
  inputSchema: z.object({
    path: z
      .string()
      .min(1)
      .describe("Repository-relative path, for example 'src/auth/oauth.ts'."),
  }),
  label: { start: ({ path }) => `Reading ${path}` },
  async execute({ path }) {
    const repoRoot = targetRepoRoot();

    let absolute: string;
    try {
      absolute = resolveRepoPath(repoRoot, path);
    } catch (error) {
      // Return the reason rather than throwing, so the model can correct itself.
      return { path, error: (error as GitError).message };
    }

    let contents: string;
    try {
      contents = await readFile(absolute, "utf8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return {
        path,
        error:
          code === "ENOENT"
            ? `No such file on this branch: ${path}`
            : `Could not read ${path}: ${code ?? "unknown error"}`,
      };
    }

    const { text, truncated } = truncateBytes(contents, MAX_FILE_BYTES);

    return {
      path,
      contents: text,
      truncated,
      ...(truncated && { note: "File truncated at the byte limit." }),
    };
  },
});
