# pr-craft — Project Specification

## 1. Overview

pr-craft is a CLI agentic tool built using Vercel's eve framework.

It analyzes the changes on the current Git branch compared to the base branch and generates:

- A pull request title
- A pull request description

The tool uses Google Gemini as the AI model through the AI SDK.

## 2. Core Flow

```
Git repository
      ↓
   git diff
      ↓
     eve
      ↓
PR title + description
```

The user runs `pr-craft` from a Git repository.

The agent then determines what changed and gathers additional context when needed.

Example agent flow:

```
User runs pr-craft
       ↓
Agent: "I need to understand the changes."
       ↓
git_diff_stat()
       ↓
Agent: "I see auth changes. I need more context."
       ↓
read_repo_file("src/auth/oauth.ts")
       ↓
git_log()
       ↓
Agent: "Okay, I understand the change."
       ↓
Generate PR title + description
```

## 3. Agent Behavior

The agent should:

- Inspect the current branch's changes compared to the base branch.
- Understand what the changes are doing.
- Gather additional context from the repository when necessary.
- Use that context to produce a concise and accurate PR title and description.

The agent may use repository context such as:

- Git diff
- Relevant files
- Commit history
- The repository's PR template, when one exists

## 4. Output

The generated output consists of a PR title and PR description.

Example:

**PR title:**

```
feat: add GitHub OAuth authentication
```

**PR description:** the repository's PR template filled in, or pr-craft's built-in
default template when the repository defines none. See §4.3.

### 4.1 Destinations

The result is delivered two ways:

1. **stdout** — always. Human-readable by default, or a `{title, description}` JSON
   object under `--json` so the output can be piped into other tooling.
2. **A file** — written to `PR_MSG.md` in the repository root by default, so it is
   easy to open, edit, and copy from. `--out <path>` moves it; `--no-out` skips the
   file entirely. Projects should add `PR_MSG.md` to their `.gitignore`.

Both destinations label the title and the description separately. A pull request
title is its own field, not a heading inside the body, and an unlabeled first line
reads as part of the description.

Creating the pull request itself (for example via `gh pr create`) is out of scope.
pr-craft produces text; the user decides what to do with it.

### 4.2 Title convention

Every title must begin with one of `feat:`, `fix:`, `bug:`, `docs:`, `test:`, or
`chore:`, chosen to match the branch's primary purpose. Prefixes are never
combined, and the chosen prefix must agree with the box ticked under
`## Type of Change`.

The requirement is stated in the instructions and enforced as a `pattern` on the
output schema. When a title arrives without a prefix, the CLI warns rather than
rewriting it: silently patching the title would hide the model ignoring its
instructions.

### 4.3 Formatting

If the repository defines a PR template, the agent fills that template's structure
exactly, preserving headings, their order, and their HTML comments. Otherwise it
fills pr-craft's built-in default template, which lives in
`agent/lib/default-pr-template.ts`.

Descriptions are detailed. There is no word or character limit: `## Changes Made`
carries one bullet per distinct change, naming the file or symbol and describing
it in full sentences.

### 4.4 Checkbox policy

Templates mix two kinds of checkbox, and the agent treats them differently.

- **Classification boxes**, such as `## Type of Change`, ask what the change is.
  A diff answers that, so the agent ticks the one that fits.
- **Attestation boxes** — "I have performed a self-review", "All existing tests
  pass", "Manually tested" — assert what a person did. Nothing in a diff supports
  them, and a pre-ticked attestation is a false claim made on the author's behalf.
  The agent never ticks one.

When the kind of a box is unclear, it is left unticked.

Sections with no answer in the branch are left as the template wrote them. An
invented issue number under `Fixes #` is worse than a blank.

## 5. AI Model

The project uses Google Gemini through the AI SDK, configured as a direct provider
model rather than through the Vercel AI Gateway:

```ts
import { google } from "@ai-sdk/google";
import { defineAgent } from "eve";

export default defineAgent({
  model: google("gemini-3.5-flash-lite"),
});
```

This requires `GOOGLE_GENERATIVE_AI_API_KEY` in the environment (or `.env.local`).
No Vercel account, AI Gateway key, or deployment is involved.

The model ID is overridable with `--model <id>` or `PRCRAFT_MODEL`, so a different
Gemini version can be selected without editing source.

## 6. Product Scope

pr-craft is intentionally a CLI-only tool.

It does not include:

- Dashboard
- Database
- User accounts
- Fancy UI

The product is:

```
Git repository → understand changes → PR title + description
```

## 7. Usage

```
pr-craft [options]
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--base <ref>` | auto-detected | Base branch to diff against |
| `--out <path>` | `PR_MSG.md` (repo root) | Where to write the generated description |
| `--no-out` | off | Skip writing a file |
| `--json` | off | Emit `{title, description}` as JSON on stdout |
| `--model <id>` | `gemini-3.5-flash-lite` | Override the Gemini model |
| `--help` | — | Show usage |

During development the tool runs as `pnpm pr-craft` from the project directory. The
`bin` entry is wired so a later `npm link` or global install exposes `pr-craft` on
`PATH` without further packaging work.

## 8. Architecture

```
bin/pr-craft.ts           CLI entry — flags, boots eve, one turn, prints
agent/agent.ts            Gemini via direct provider
agent/instructions.md     agent's job + output contract
agent/lib/git.ts          repo resolution + safe git exec (shared)
agent/tools/
  git_diff_stat.ts        changed files + insertion/deletion counts
  git_diff.ts             the patch, optionally scoped to paths
  git_log.ts              commits on this branch vs base
  read_repo_file.ts       read a file from the working tree
  pr_template.ts          the repo's PR template, or the built-in default
agent/lib/
  default-pr-template.ts  fallback template, compiled into the bundle
```

The CLI is a thin wrapper. It resolves the repository from `process.cwd()`, passes
it to the agent through the `PRCRAFT_REPO` environment variable, starts eve's server
on an ephemeral port, sends a single turn carrying an `outputSchema` of
`{title, description}`, prints the result, and exits.

Using a structured `outputSchema` means the CLI reads a typed object instead of
scraping markdown out of prose.

The agent drives its own exploration: it calls `git_diff_stat` first, then pulls full
patches or reads individual files only where it needs more context. This is what
makes pr-craft an agent rather than a single `generateText` call.

### 8.1 Tools run against the real repository

eve's built-in `bash` and `read_file` tools execute inside eve's sandbox, which is
not the user's checkout. pr-craft therefore ships its own git tools that shell out to
the real working directory.

All such tools are:

- **Read-only.** No tool mutates the repository.
- **Injection-safe.** Invoked with `execFile` and an argument array, never a shell
  string.
- **Path-guarded.** File reads resolve against the repository root and reject paths
  that escape it.

## 9. Resolved Design Decisions

### 9.1 Base branch detection

Resolution order:

1. An explicit `--base <ref>`.
2. `origin/HEAD`, via `git symbolic-ref refs/remotes/origin/HEAD`.
3. The first of `main`, `master`, `develop` that exists.

If none resolve, pr-craft exits with an error naming the problem rather than
silently diffing against the wrong ref.

### 9.2 Large diffs

`git_diff` truncates its output at a byte cap and states in the tool result that
truncation occurred, so the agent knows to narrow its request by path instead of
silently reasoning about a partial patch. Without this, a large branch either
overflows the context window or gets quietly cut.

### 9.3 Interaction model

One-shot. The command generates, prints, and exits. There is no REPL or refinement
loop.

### 9.4 Route authentication

`eve start` serves a production build, where eve's `localDev()` authenticator does
not apply and the scaffold's `placeholderAuth()` rejects everything. The CLI
therefore mints a random 32-byte token per invocation, passes it to the server as
`PRCRAFT_TOKEN`, and authenticates with HTTP Basic against it.

The server listens only on loopback, but binding the route to a per-run credential
also keeps other local processes from driving the agent. The channel keeps
`localDev()` first so `eve dev` still works, and has no anonymous fallback.

### 9.5 Rebuilding

`eve start` serves a build, so an edit to `instructions.md` or a tool would
otherwise not take effect. The CLI compares the newest mtime under `agent/`
against the build output and rebuilds when the source is newer.

### 9.6 Context window

eve resolves a model's context window from the AI Gateway catalog, which does not
list direct-provider models. `modelContextWindowTokens` is set explicitly in
`agent.ts` to skip that lookup; without it the agent fails to compile.

## 10. Testing

Git helpers are unit-tested against a throwaway repository fixture created in a
temporary directory, with real commits and real branches, so base detection and diff
logic are verified against actual git behavior rather than mocks.

Generation quality is not unit-testable; it is verified by running the tool against
real branches.

## 11. Non-Goals

- Creating or updating pull requests on any hosting provider
- Clipboard integration
- Interactive refinement of generated output
- Any deployment target, web UI, or persistent storage
