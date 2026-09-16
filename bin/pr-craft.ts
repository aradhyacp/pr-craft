#!/usr/bin/env node
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "eve/client";

import { GitError, detectBaseRef, resolveRepoRoot, runGit } from "../agent/lib/git.ts";

/** The pr-craft installation, as opposed to the repository being described. */
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const USAGE = `pr-craft — generate a pull request title and description from your branch

Usage
  pr-craft [options]

Options
  --base <ref>    Base branch to compare against (default: auto-detected)
  --out <path>    Where to write the description (default: PR_MSG.md in the repo root)
  --no-out        Do not write a file
  --json          Print {"title","description"} as JSON
  --model <id>    Gemini model to use (default: gemini-3.5-flash-lite)
  -h, --help      Show this message
`;

interface Options {
  base?: string;
  out: string | null;
  json: boolean;
  model?: string;
}

class UsageError extends Error {}

function parseArgs(argv: readonly string[]): Options {
  const options: Options = { out: undefined as unknown as string, json: false };
  let outExplicit: string | null | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const takeValue = (name: string): string => {
      const value = argv[++i];
      if (value === undefined || value.startsWith("-")) {
        throw new UsageError(`${name} needs a value`);
      }
      return value;
    };

    switch (arg) {
      case "--base":
        options.base = takeValue("--base");
        break;
      case "--out":
        outExplicit = takeValue("--out");
        break;
      case "--no-out":
        outExplicit = null;
        break;
      case "--json":
        options.json = true;
        break;
      case "--model":
        options.model = takeValue("--model");
        break;
      case "-h":
      case "--help":
        process.stdout.write(USAGE);
        process.exit(0);
      default:
        throw new UsageError(`Unknown option: ${arg}`);
    }
  }

  return { ...options, out: outExplicit === undefined ? "" : outExplicit };
}

/**
 * Loads `.env.local` from the pr-craft installation.
 *
 * The agent server inherits this process's environment, and a globally invoked
 * CLI does not otherwise see the install directory's env file. Existing
 * variables win, so a shell export overrides the file.
 */
function loadEnvFile(): void {
  const envPath = path.join(PROJECT_ROOT, ".env.local");
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key!] !== undefined) continue;
    process.env[key!] = rawValue!.trim().replace(/^["']|["']$/g, "");
  }
}

/** Reserves a free port by binding and releasing it. */
async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Could not reserve a port"));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

function runEve(args: readonly string[], env: NodeJS.ProcessEnv): ChildProcess {
  return spawn(process.execPath, [path.join(PROJECT_ROOT, "node_modules/eve/bin/eve.js"), ...args], {
    cwd: PROJECT_ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Most recent mtime under `dir`, or 0 when it does not exist. */
async function newestMtime(dir: string): Promise<number> {
  let newest = 0;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    newest = Math.max(
      newest,
      entry.isDirectory() ? await newestMtime(full) : statSync(full).mtimeMs,
    );
  }
  return newest;
}

/**
 * Whether the built server predates the agent source.
 *
 * `eve start` serves a build, so without this check an edit to a tool or to
 * instructions.md would silently not take effect.
 */
async function needsBuild(): Promise<boolean> {
  const output = path.join(PROJECT_ROOT, ".output");
  if (!existsSync(output)) return true;

  const builtAt = await newestMtime(output);
  const sourceAt = Math.max(
    await newestMtime(path.join(PROJECT_ROOT, "agent")),
    statSync(path.join(PROJECT_ROOT, "package.json")).mtimeMs,
  );

  return sourceAt > builtAt;
}

/** Builds the agent server, which `eve start` then serves. */
async function build(env: NodeJS.ProcessEnv): Promise<void> {
  process.stderr.write("Building the agent (first run, and after agent edits)...\n");
  const child = runEve(["build"], env);
  let stderr = "";
  child.stderr?.on("data", (chunk) => (stderr += chunk));

  const code = await new Promise<number>((resolve) => child.on("close", resolve));
  if (code !== 0) {
    throw new Error(`eve build failed:\n${stderr.trim()}`);
  }
}

/** Starts the agent server and resolves once it reports healthy. */
async function startServer(
  env: NodeJS.ProcessEnv,
  port: number,
  token: string,
): Promise<{ child: ChildProcess; host: string }> {
  const host = `http://127.0.0.1:${port}`;
  const child = runEve(["start"], { ...env, PORT: String(port) });

  let stderr = "";
  child.stderr?.on("data", (chunk) => (stderr += chunk));

  let exited: number | null = null;
  child.on("close", (code) => (exited = code));

  const client = clientFor(host, token);
  const deadline = Date.now() + 90_000;

  while (Date.now() < deadline) {
    if (exited !== null) {
      throw new Error(`Agent server exited (code ${exited}):\n${stderr.trim()}`);
    }
    try {
      await client.health();
      return { child, host };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  child.kill("SIGTERM");
  throw new Error(`Agent server did not become ready in time.\n${stderr.trim()}`);
}

/** Title prefixes the agent must choose from. */
const ALLOWED_PREFIXES = ["feat:", "fix:", "bug:", "docs:", "test:", "chore:"] as const;
const TITLE_PREFIX = /^(feat|fix|bug|docs|test|chore): .+/;

/** A labeled section heading for terminal output. */
function rule(label: string): string {
  return `${label}\n${"─".repeat(label.length)}`;
}

/** A client carrying this run's credential, which the agent's channel requires. */
function clientFor(host: string, token: string): Client {
  return new Client({
    host,
    auth: { basic: { username: "pr-craft", password: token } },
  });
}

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    title: {
      type: "string",
      description:
        "One-line PR title. Must begin with one of: 'feat:', 'fix:', 'bug:', 'docs:', 'test:', 'chore:'. Imperative mood, no trailing period.",
      pattern: "^(feat|fix|bug|docs|test|chore): .+",
    },
    description: {
      type: "string",
      description: "The PR description body, in markdown.",
    },
  },
  required: ["title", "description"],
  additionalProperties: false,
} as const;

interface PullRequestDraft {
  title: string;
  description: string;
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  loadEnvFile();

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    process.stderr.write(
      "GOOGLE_GENERATIVE_AI_API_KEY is not set.\n" +
        `Add it to ${path.join(PROJECT_ROOT, ".env.local")} or export it in your shell.\n`,
    );
    return 1;
  }

  // Resolve against the directory the user ran the command from, not the install.
  const repoRoot = resolveRepoRoot(process.cwd());
  const base = detectBaseRef(repoRoot, options.base);
  const branch = runGit(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);

  if (runGit(repoRoot, ["rev-list", "--count", `${base}..HEAD`]) === "0") {
    process.stderr.write(
      `No commits on ${branch} that are not already on ${base}. Nothing to describe.\n`,
    );
    return 1;
  }

  // Fresh per run, so a credential never outlives the process that minted it.
  const token = randomBytes(32).toString("hex");

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PRCRAFT_REPO: repoRoot,
    PRCRAFT_BASE: base,
    PRCRAFT_TOKEN: token,
    ...(options.model && { PRCRAFT_MODEL: options.model }),
  };

  if (await needsBuild()) {
    await build(env);
  }

  process.stderr.write(`Analyzing ${branch} against ${base}...\n`);

  const port = await findFreePort();
  const { child, host } = await startServer(env, port, token);

  let draft: PullRequestDraft;
  try {
    const client = clientFor(host, token);
    const { response } = await client.sessions.create<PullRequestDraft>({
      message:
        `Write the pull request title and description for branch "${branch}", ` +
        `compared against base "${base}". Investigate the branch with your tools first.`,
      outputSchema: OUTPUT_SCHEMA,
    });

    const result = await response.result();

    if (result.status === "failed" || !result.data) {
      process.stderr.write(
        `The agent did not return a result (status: ${result.status}).\n` +
          (result.message ? `${result.message}\n` : ""),
      );
      return 1;
    }

    draft = result.data;

    // The schema and instructions both require a prefix. Say so rather than
    // rewriting the title, which would only hide the model ignoring it.
    if (!TITLE_PREFIX.test(draft.title)) {
      process.stderr.write(
        `Warning: the generated title has no conventional prefix (expected one of ${ALLOWED_PREFIXES.join(", ")}).\n`,
      );
    }
  } finally {
    child.kill("SIGTERM");
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(draft, null, 2)}\n`);
  } else {
    // Label both parts: an unlabeled title reads as part of the description.
    process.stdout.write(
      `${rule("PR TITLE")}\n${draft.title}\n\n` +
        `${rule("PR DESCRIPTION")}\n${draft.description}\n`,
    );
  }

  // "" is the unset sentinel from parseArgs; null means --no-out.
  const outPath = options.out === "" ? path.join(repoRoot, "PR_MSG.md") : options.out;

  if (outPath !== null) {
    const resolved = path.resolve(repoRoot, outPath);
    await mkdir(path.dirname(resolved), { recursive: true });
    // The title is a separate field on a pull request, not part of the body, so
    // label it rather than leaving it to be mistaken for a heading in the body.
    await writeFile(
      resolved,
      `<!-- PR TITLE — paste into the title field -->\n\n` +
        `# ${draft.title}\n\n` +
        `<!-- PR DESCRIPTION — paste everything below into the body -->\n\n` +
        `${draft.description}\n`,
      "utf8",
    );
    process.stderr.write(`\nWritten to ${resolved}\n`);
  }

  return 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  if (error instanceof UsageError) {
    process.stderr.write(`${error.message}\n\n${USAGE}`);
  } else if (error instanceof GitError) {
    process.stderr.write(`${error.message}\n`);
  } else {
    process.stderr.write(`${(error as Error).message ?? String(error)}\n`);
  }
  process.exitCode = 1;
}
