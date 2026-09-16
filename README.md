<div align="center">

# ✍️ pr-craft

**An agentic CLI that reads your branch and writes the pull request.**

[![eve](https://img.shields.io/badge/built%20with-eve-000000?style=for-the-badge&logo=vercel&logoColor=white)](https://eve.dev)
[![Gemini](https://img.shields.io/badge/Google-Gemini-4285F4?style=for-the-badge&logo=googlegemini&logoColor=white)](https://ai.google.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Node](https://img.shields.io/badge/Node.js-24.x-5FA04E?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org)

[![Local only](https://img.shields.io/badge/runs-100%25%20local-success?style=flat-square)](#-privacy)
[![No Vercel account](https://img.shields.io/badge/Vercel%20account-not%20required-blue?style=flat-square)](#-how-eve-is-used)
[![Read only](https://img.shields.io/badge/git%20access-read--only-informational?style=flat-square)](#-safety)
[![Tests](https://img.shields.io/badge/tests-16%20passing-brightgreen?style=flat-square)](#-development)

</div>

---

## What is this?

`pr-craft` is a command-line tool you run inside a git repository. It compares your
current branch against its base branch, **investigates the change the way a person
would**, and writes a pull request title and description for it.

It is not a prompt wrapped around `git diff`. It is an **agent**: it decides what to
look at. It starts with a cheap summary of which files changed, pulls the patch,
and then — only when the diff does not explain itself — reads the surrounding
source or the commit history. When a branch is too large to read at once, it
narrows its own request file by file instead of reasoning about a truncated patch.

```
┌─────────────────┐     ┌──────────────────┐     ┌────────────────────┐
│  Git repository │ ──▶ │  pr-craft agent  │ ──▶ │  PR title + body   │
│  (your branch)  │     │  (Gemini + eve)  │     │  stdout + PR_MSG.md│
└─────────────────┘     └──────────────────┘     └────────────────────┘
                               │    ▲
                    reads ─────┘    └───── decides what it still needs
```

---

## ✨ Demo

```console
$ cd ~/work/my-service && git checkout duration-units
$ pr-craft

Analyzing duration-units against main...

PR TITLE
────────
feat: add unit suffix support to parseDuration and introduce formatDuration

PR DESCRIPTION
──────────────
## Description

Extends `parseDuration` to support unit suffixes (`ms`, `s`, `m`, `h`, `d`) and
introduces a new `formatDuration` helper for converting millisecond values into
human-readable strings.

## Type of Change

- [ ] Bug fix (non-breaking change which fixes an issue)
- [x] New feature (non-breaking change which adds functionality)
...

Written to /Users/you/work/my-service/PR_MSG.md
```

---

## 🚀 Quick start

**Requirements:** Node 24+, git, and a [Google Gemini API key](https://aistudio.google.com/apikey).

```bash
# 1. Install dependencies
pnpm install

# 2. Add your Gemini key
echo 'GOOGLE_GENERATIVE_AI_API_KEY=your-key-here' > .env.local

# 3. Put pr-craft on your PATH
npm link
```

Then, from **any** repository on your machine:

```bash
cd ~/work/some-project
git checkout my-feature-branch
pr-craft
```

The result prints to your terminal and is written to `PR_MSG.md` in the repository
root, ready to copy into your PR.

> [!TIP]
> Add `PR_MSG.md` to that project's `.gitignore` so drafts never get committed.

---

## 📖 Usage

```
pr-craft [options]
```

| Flag | Default | What it does |
| :--- | :--- | :--- |
| `--base <ref>` | auto-detected | Branch to compare against |
| `--out <path>` | `PR_MSG.md` | Where to write the result |
| `--no-out` | off | Print only, write no file |
| `--json` | off | Emit `{"title","description"}` for piping |
| `--model <id>` | `gemini-3.5-flash-lite` | Use a different Gemini model |
| `-h`, `--help` | — | Show usage |

**Base branch detection** tries, in order: your `--base` flag → `origin/HEAD` →
the first of `main`, `master`, `develop` that exists. If none resolve, it stops
with an error rather than silently diffing against the wrong thing.

---

## 🧠 How it works

Every run is one durable agent turn:

1. **The CLI** resolves your repository from the current directory, detects the
   base branch, and mints a one-time credential.
2. **It starts the eve server** on an ephemeral loopback port, passing your repo
   path through `PRCRAFT_REPO`.
3. **The agent investigates** using its five tools, deciding for itself how deep
   to go.
4. **It returns structured output** — a typed `{title, description}` object, not
   prose the CLI has to parse.
5. **The CLI prints, writes, and shuts the server down.**

### The agent's tools

| Tool | What the agent uses it for |
| :--- | :--- |
| `git_diff_stat` | The cheap first look: which files changed, and by how much |
| `git_diff` | The actual patch, scopeable to specific paths |
| `git_log` | Commit messages, when the *why* isn't visible in the code |
| `read_repo_file` | Surrounding source a patch alone doesn't explain |
| `pr_template` | The repo's PR template, or the built-in default |

### Output rules the agent follows

- **Titles are always prefixed** — `feat:`, `fix:`, `bug:`, `docs:`, `test:`, or
  `chore:`, chosen to match the change's primary purpose.
- **Your repo's PR template wins.** If `.github/pull_request_template.md` exists,
  the agent fills that structure exactly. Otherwise it uses a detailed built-in
  default.
- **Descriptions are thorough.** No length limit — one bullet per distinct change,
  naming the file or symbol and explaining it in full sentences.
- **Checkboxes are handled carefully.** The agent ticks *classification* boxes
  like `## Type of Change`, because a diff shows what kind of change it is. It
  **never** ticks *attestation* boxes — "I self-reviewed", "tests pass",
  "manually tested" — because those are claims only you can make.
- **Empty sections stay empty.** No invented issue numbers, no fabricated test
  plans, no imaginary screenshots.

---

## 🗂 Project structure

```
prcraft/
│
├── bin/
│   └── pr-craft.ts              ← CLI entry: flags, server lifecycle, output
│
├── agent/                       ← everything eve compiles into the agent
│   ├── agent.ts                 ← model selection (Gemini) + runtime config
│   ├── instructions.md          ← the agent's always-on system prompt
│   │
│   ├── channels/
│   │   └── eve.ts               ← HTTP route auth (per-run credential)
│   │
│   ├── lib/                     ← shared authored code, not tools
│   │   ├── git.ts               ← repo resolution, safe exec, path guards
│   │   └── default-pr-template.ts  ← fallback template when a repo has none
│   │
│   └── tools/                   ← one file per tool; filename = tool name
│       ├── git_diff_stat.ts     ← changed files + line counts
│       ├── git_diff.ts          ← the patch, with truncation reporting
│       ├── git_log.ts           ← commits on this branch vs base
│       ├── read_repo_file.ts    ← read a file from the working tree
│       └── pr_template.ts       ← repo template, or the built-in default
│
├── tests/
│   └── git.test.ts              ← unit tests against real git fixtures
│
├── docs/
│   └── architecture.md          ← deeper design notes and rationale
│
└── spec/
    └── spec-01.md               ← the specification this was built from
```

---

## 🔌 How eve is used

[eve](https://eve.dev) is a filesystem-first framework for durable agents. You
author an agent as *files*, and eve compiles them into a running server. This
project uses it deliberately narrowly:

| eve feature | How pr-craft uses it |
| :--- | :--- |
| `agent/instructions.md` | The always-on system prompt — how to investigate, how to write |
| `agent/tools/*.ts` | Five typed tools with Zod schemas; the filename is the tool name |
| `agent/agent.ts` | `defineAgent` selecting Gemini via a direct AI SDK provider |
| `agent/channels/eve.ts` | The built-in HTTP channel, locked to a per-run credential |
| `outputSchema` | A typed `{title, description}` result instead of parsed prose |
| `eve build` / `eve start` | Compiles and serves the agent as a local Node server |

### No Vercel account required

eve is often shown with Vercel's hosted services, but none of them are mandatory,
and pr-craft uses none of them:

- **Model** — Gemini through `@ai-sdk/google` as a **direct provider**, not the
  Vercel AI Gateway. Only `GOOGLE_GENERATIVE_AI_API_KEY` is needed.
- **Hosting** — `eve start` runs a local Node server on an ephemeral port.
- **Workflows** — the local Workflow world, storing state under `.eve/`.
- **Sandbox** — unused. `defaultTools: false` turns off eve's sandbox tools
  entirely, because they operate on eve's sandbox rather than your checkout and
  would only mislead the agent.

> [!NOTE]
> Because eve looks a model's context window up in the AI Gateway catalog — which
> doesn't list direct-provider models — `agent.ts` sets
> `modelContextWindowTokens` explicitly. Without it, the agent won't compile.

---

## 🔒 Safety

Custom tools in eve run in your app runtime, **not** in eve's sandbox. Since these
tools touch your real repository, each one is constrained:

- **Read-only.** No tool writes, stages, commits, or mutates anything. The only
  file ever written is the output file, by the CLI.
- **No shell.** Git runs via `execFile` with an argument array, so a branch or
  path name can never be interpreted as a command.
- **Path-guarded.** File reads resolve against the repository root and reject
  anything escaping it, including absolute paths elsewhere on disk.
- **Per-run credential.** The server listens on loopback and requires a random
  32-byte token minted for that invocation, so no other local process can drive it.

### 🕵️ Privacy

Everything runs on your machine. The only network call is to the Gemini API, and
it carries exactly what the agent chose to read: diffs, commit messages, and any
source files it opened. **If your repository contains secrets or code you cannot
send to a third-party model, do not run this on it.**

---

## 🛠 Development

```bash
pnpm test              # 16 unit tests against real git fixtures
pnpm exec tsc          # typecheck
pnpm exec eve info     # inspect the compiled agent
pnpm exec eve dev      # interactive REPL against the agent
```

The CLI rebuilds automatically when anything under `agent/` is newer than the last
build, so editing `instructions.md` or a tool takes effect on the next run. You'll
see `Building the agent...` when that happens.

### Changing behavior

| To change… | Edit… |
| :--- | :--- |
| How the agent investigates or writes | `agent/instructions.md` |
| The fallback PR template | `agent/lib/default-pr-template.ts` |
| The model | `agent/agent.ts`, or pass `--model` |
| What the agent can do | Add a file to `agent/tools/` |

---

## 📚 Further reading

- [`docs/architecture.md`](./docs/architecture.md) — design decisions and rationale
- [`spec/spec-01.md`](./spec/spec-01.md) — the specification this was built from
- [eve documentation](https://eve.dev/docs) — the framework
- [AI SDK providers](https://ai-sdk.dev/docs/foundations/providers-and-models) — swapping models

---

## ⚠️ Limitations

- **One-shot.** No refinement loop — regenerate, or edit `PR_MSG.md` by hand.
- **Local only.** It describes branches; it never creates or pushes a PR.
- **Committed work only.** Uncommitted changes are invisible to it.
- **Quality tracks the branch.** Clean, focused commits produce good descriptions;
  a branch with twenty unrelated changes produces a description that says so.
