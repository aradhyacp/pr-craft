import { defineTool } from "eve/tools";
import { z } from "zod";

import {
  diffRange,
  runGit,
  targetBaseRef,
  targetRepoRoot,
  truncateBytes,
} from "#lib/git.ts";

/**
 * Cap on a single patch handed to the model.
 *
 * Large enough for an ordinary branch to arrive whole, small enough that one
 * call cannot crowd out the rest of the context window.
 */
const MAX_PATCH_BYTES = 120_000;

export default defineTool({
  description:
    "Show the actual patch for this branch relative to the base branch. Pass `paths` to scope it to specific files, which you should do when the full diff comes back truncated. Large patches are cut at a byte limit and say so.",
  inputSchema: z.object({
    paths: z
      .array(z.string().min(1))
      .optional()
      .describe(
        "Limit the patch to these repository-relative paths. Omit for the whole branch.",
      ),
    contextLines: z
      .number()
      .int()
      .min(0)
      .max(25)
      .optional()
      .describe("Lines of context around each hunk. Defaults to 3."),
  }),
  label: {
    start: ({ paths }) =>
      paths?.length ? `Reading diff for ${paths.length} file(s)` : "Reading full diff",
  },
  async execute({ paths, contextLines }) {
    const repoRoot = targetRepoRoot();
    const base = targetBaseRef(repoRoot);

    const args = ["diff", "-M", `--unified=${contextLines ?? 3}`, diffRange(base)];
    // `--` stops git reading a path as a ref, and keeps user paths out of option space.
    if (paths?.length) args.push("--", ...paths);

    const patch = runGit(repoRoot, args);

    if (patch.length === 0) {
      return {
        base,
        patch: "",
        truncated: false,
        note: paths?.length
          ? "No changes to those paths on this branch."
          : "No changes on this branch relative to the base.",
      };
    }

    const { text, truncated } = truncateBytes(patch, MAX_PATCH_BYTES);

    return {
      base,
      patch: text,
      truncated,
      ...(truncated && {
        note: "This patch was truncated. Call git_diff again with `paths` set to the files you still need.",
      }),
    };
  },
});
