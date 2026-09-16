import { readFile } from "node:fs/promises";
import path from "node:path";

import { defineTool } from "eve/tools";
import { z } from "zod";

import { DEFAULT_PR_TEMPLATE } from "#lib/default-pr-template.ts";
import { targetRepoRoot } from "#lib/git.ts";

/**
 * Where hosting providers look for a PR template, in the order they check.
 *
 * GitHub accepts the file at the repo root, under `.github/`, or under `docs/`,
 * and treats the name as case-insensitive; the common casings are listed here.
 */
const TEMPLATE_PATHS = [
  ".github/pull_request_template.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/PULL_REQUEST_TEMPLATE/pull_request_template.md",
  "docs/pull_request_template.md",
  "docs/PULL_REQUEST_TEMPLATE.md",
  "pull_request_template.md",
  "PULL_REQUEST_TEMPLATE.md",
  ".gitlab/merge_request_templates/default.md",
];

export default defineTool({
  description:
    "Return the pull request template to fill in: this repository's own, or pr-craft's default when it has none. Always call this before writing the description, and always follow the structure it returns.",
  inputSchema: z.object({}),
  label: { start: () => "Checking for a PR template" },
  async execute() {
    const repoRoot = targetRepoRoot();

    for (const candidate of TEMPLATE_PATHS) {
      try {
        const contents = await readFile(path.join(repoRoot, candidate), "utf8");
        if (contents.trim().length === 0) continue;
        return {
          source: "repository" as const,
          path: candidate,
          template: contents,
          note: "This repository defines its own template. Follow it exactly: keep its headings, their order, and their wording.",
        };
      } catch {
        // Missing is the common case; keep looking.
      }
    }

    return {
      source: "default" as const,
      path: null,
      template: DEFAULT_PR_TEMPLATE,
      note: "This repository has no template of its own, so fill in pr-craft's default. Keep every heading and its order.",
    };
  },
});
