# Architecture

Design notes for pr-craft: how a run executes, and why each non-obvious decision
was made. For what the tool does and how to use it, see the [README](../README.md).
For the original requirements, see [`spec/spec-01.md`](../spec/spec-01.md).

## The shape of a run

```
pr-craft (your repo)                    eve server (pr-craft install)
────────────────────                    ─────────────────────────────
resolve repo from cwd
detect base branch
mint per-run token
rebuild if agent/ is newer  ──────────▶ eve build
start server on free port   ──────────▶ eve start   (PRCRAFT_REPO, PRCRAFT_BASE,
poll /eve/v1/health                                  PRCRAFT_TOKEN in env)
                            ◀──────────  ready
POST /eve/v1/session        ──────────▶ agent turn begins
  { message, outputSchema }                │
                                           ├─ git_diff_stat  ─┐
                                           ├─ git_diff        ├─ execFile("git")
                                           ├─ git_log         │  in PRCRAFT_REPO
                                           ├─ read_repo_file ─┘
                                           └─ pr_template
                            ◀──────────  { title, description }
print + write PR_MSG.md
SIGTERM the server
```

The CLI is deliberately thin. It owns process lifecycle, flags, and I/O; every
decision about *what to read* belongs to the agent.

## Why an agent rather than one model call

The naive version is `git diff | model`. It breaks in two ways.

A diff shows *what* changed but often not *why*, and it shows a change without the
code around it. A hunk that modifies a function signature means little without the
call sites. An agent can notice the gap and read the file; a single call cannot.

Large branches are the second failure. A 5,000-line diff either exceeds the context
window or gets silently cut, and a description written from half a patch is
confidently wrong. `git_diff` reports truncation as data, so the agent narrows its
own request by path. The model is told it is missing something, rather than being
left to assume it saw everything.

## Repository targeting

The agent server's working directory is the pr-craft **installation**, not the
repository being described. A globally linked `pr-craft` could be invoked from
anywhere, so the repository path has to travel explicitly.

The CLI resolves the repo from `process.cwd()` and exports `PRCRAFT_REPO`; tools
read it through `targetRepoRoot()`. The base ref travels the same way via
`PRCRAFT_BASE`, resolved **once** by the CLI so every tool in a run compares
against the same ref.

This is also why eve's built-in `bash` and `read_file` tools are unusable here:
they execute inside eve's sandbox, a different filesystem. `defaultTools: false`
turns them off rather than leaving tools the model might call and get nonsense
from.

## Diff range semantics

Diffs use three-dot syntax, `base...HEAD`, which compares against the **merge
base** rather than the tip of `base`.

With two-dot `base..HEAD`, commits that landed on `main` after you branched show
up inverted in your diff — changes you never made, attributed to your branch.
Three-dot answers the question a reviewer actually asks: what did this branch add
since it diverged?

## Base branch detection

In order: an explicit `--base`, then `origin/HEAD`, then the first of `main`,
`master`, `develop` that exists.

`origin/HEAD` is the most reliable signal because it records what the remote calls
its default branch, which is why it is preferred over guessing. It is unset in
repositories that were never cloned, hence the fallbacks. When nothing resolves,
detection fails loudly: silently diffing against the wrong ref produces a
plausible, wrong description, which is worse than an error.

## Route authentication

`eve start` serves a **production** build. eve's `localDev()` authenticator
applies only to `eve dev`, and the scaffold's `placeholderAuth()` rejects
everything else, so the first working version returned `Authorization is required
for this route`.

The fix is a random 32-byte token minted per invocation, passed to the server as
`PRCRAFT_TOKEN`, and presented over HTTP Basic. The server binds to loopback, so
this mainly guards against other local processes; a credential that never outlives
the process that created it costs nothing and closes that gap. The channel keeps
`localDev()` first so `eve dev` still works, and deliberately has **no** anonymous
fallback — the auth walk ends in a 401.

## Rebuild detection

`eve start` serves a build, so editing `instructions.md` had no effect until the
next build. That is a bad failure: the agent keeps working, just with stale
behavior.

The CLI compares the newest mtime under `agent/` against the build output and
rebuilds when source is newer. mtime comparison is imprecise in theory, but the
failure mode is an unnecessary rebuild, not stale behavior.

## Context window configuration

eve resolves a model's context window from the AI Gateway catalog, which does not
list direct-provider models — compilation fails with *"does not have known AI
Gateway context window metadata"*.

`agent.ts` sets `modelContextWindowTokens` explicitly. This is the documented
escape hatch, and it also makes the project independent of catalog coverage: a new
Gemini release works immediately via `--model` without waiting to be listed.

## Structured output

The turn carries an `outputSchema` of `{title, description}`, so the CLI receives
a typed object.

The alternative — asking for markdown and parsing the title out of the first line
— fails the moment the model adds a preamble or wraps output in a code fence.
Schema-shaped output also lets `--json` be a trivial reformat rather than a second
generation path, and the `pattern` constraint on `title` states the required
conventional-commit prefix at the schema level, alongside the instructions.

The CLI **warns** rather than rewrites when a title arrives without a prefix.
Silently patching it would hide the model ignoring its instructions, which is
something worth seeing.

## Checkbox policy

PR templates mix two kinds of checkbox, and conflating them causes real harm.

**Classification** boxes (`## Type of Change`) ask what the change *is*. A diff
answers that, so the agent ticks one.

**Attestation** boxes — "I have performed a self-review", "All existing tests
pass", "Manually tested" — are assertions about what a *person* did. Nothing in a
diff supports them. A pre-ticked attestation is a false claim made on the author's
behalf, and it defeats the purpose of the checklist: someone merges believing a
human confirmed something no one confirmed.

The agent leaves every attestation box unticked, and the instructions say to leave
a box unticked whenever its kind is unclear.

The same reasoning governs empty sections. `Fixes #` with an invented issue number
is worse than a blank line.

## Safety properties

Tools run in the app runtime with full `process.env` access, against the user's
real repository. Three constraints bound that:

- **Read-only.** No tool writes, stages, or mutates. The only write is the CLI's
  output file.
- **No shell.** `execFile` with an argument array. A branch named
  `; rm -rf ~` is an argument, never a command.
- **Path-guarded.** `resolveRepoPath` resolves against the repo root and rejects
  anything escaping it, so a model-supplied path cannot reach `/etc/passwd`.

`read_repo_file` returns guard failures **as data** rather than throwing, so the
model can correct a bad path instead of failing the turn.

## Testing strategy

`tests/git.test.ts` runs against real git repositories created in a temp
directory — real `git init`, real commits, real branches.

Mocking git would test the mock. The behaviors that matter here are precisely the
ones git owns: what `symbolic-ref` returns when `origin/HEAD` is unset, how
`--numstat` marks binary files, what happens when a ref is missing. A fixture
costs ~100ms per test and tests the real thing.

Generation quality is not unit-testable and is verified by running the tool
against real branches.

## Deliberate non-goals

**Creating the PR.** `gh pr create` would make pr-craft responsible for a
side-effecting, hard-to-undo operation. Writing text a human reviews before acting
keeps the blast radius at zero.

**Interactive refinement.** eve's durable sessions make this easy to add, but
one-shot keeps the CLI a pipeline stage. `PR_MSG.md` is editable; so is a rerun.

**Reading uncommitted work.** Describing a PR means describing commits. Including
the working tree would describe something that does not exist on any branch.
