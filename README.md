# Context Guard Skill

Context Guard is a Codex skill for keeping project context durable, concise, and regression-aware. It maintains a folder-scoped `.codex/context/` directory so Codex can remember the active task route, parked work, bad cases, and verification chains across threads and interruptions.

The core promise is simple: important context should not disappear, and solved bad cases should not silently come back.

## What It Maintains

For each project folder, Context Guard uses:

```text
.codex/context/
|-- index.md
|-- roadmap.md
|-- bad-cases.md
|-- preferences.json
|-- roadmap/
|   |-- roadmap.html
|   |-- roadmap-details.html
|   `-- roadmap.md
|-- tasks/
|-- bad-case-tests/
`-- archive/
```

- `index.md`: quick scan for the current task, latest roadmap node, hot bad-case tags, and resume candidate.
- `roadmap.md`: agent-readable route map with major nodes, checkpoints, branches, and bad-case links.
- `bad-cases.md`: compact register of bad cases, fixes, recurrence analysis, and reusable guards.
- `preferences.json`: folder-scoped preferences such as the language used for future context records.
- `tasks/`: task-specific context for current, parked, resume-candidate, or archived work.
- `roadmap/roadmap.html`: stable human-facing roadmap overview.
- `roadmap/roadmap-details.html`: stable human-facing details page.
- `roadmap/roadmap.md`: stable agent-readable export.

## Key Behavior

- Runs context intake at the start of work and checkpointing at the end.
- Keeps context folder-scoped, not thread-scoped.
- Parks interrupted work and asks whether to resume it later.
- Records bad cases when they appear, including symptoms, root cause, fix, and guard.
- Reuses existing bad-case guards before inventing new tests or scripts.
- Asks for a folder-level record language on first use, then keeps future context records in that language.
- Supports goal-mode work by recording compact checkpoints during long-running progress.
- Exports a concise human roadmap with three horizontal tracks: Main Route, Bad Cases, and Test Chain.
- Supports route branches and multiple parallel mainlines with route-focused drilldown.
- Keeps user-facing roadmap text compact, hides internal IDs, and supports Chinese/English display.

## Installation

This repository can be used as a Codex plugin or installed manually as a local skill.

### Plugin Layout

The plugin manifest is:

```text
.codex-plugin/plugin.json
```

It exposes skills from:

```text
skills/context-guard/
```

### Manual Skill Install

Clone the repository and copy the skill folder into the cross-runtime skills directory:

```bash
git clone git@github.com:Michel-Johnson/Context-Guard-Skill.git
cd Context-Guard-Skill
mkdir -p ~/.agents/skills/context-guard
rsync -a --delete skills/context-guard/ ~/.agents/skills/context-guard/
```

After installation, Codex should discover:

```text
~/.agents/skills/context-guard/SKILL.md
```

## Optional Hooks

The repository includes `hooks.json` and `scripts/context_guard_hook.py` as a lightweight fallback. Hooks do not replace the skill; they remind Codex to run context intake and checkpointing at lifecycle moments where forgetting is most costly.

Hook events covered:

- `SessionStart`: initialize `.codex/context/`.
- `UserPromptSubmit`: detect possible task switches, bad cases, or goal-mode work.
- `Stop`: remind Codex to update index, roadmap, bad cases, and test-chain links before finalizing, and to include a final BC summary with archived/updated cases plus currently unresolved cases.

## Usage

Invoke the skill directly when you want reliable context handling:

```text
Use $context-guard to maintain this task context.
```

Show the current roadmap:

```text
Use $context-guard to show the roadmap.
```

Or run the helper script directly:

```bash
python3 ~/.agents/skills/context-guard/scripts/context_guard.py init --root /path/to/project
python3 ~/.agents/skills/context-guard/scripts/context_guard.py set-language --root /path/to/project --language 中文
python3 ~/.agents/skills/context-guard/scripts/context_guard.py show-roadmap --root /path/to/project
```

The roadmap command overwrites the same stable files every time:

```text
.codex/context/roadmap/roadmap.html
.codex/context/roadmap/roadmap-details.html
.codex/context/roadmap/roadmap.md
```

It does not create timestamped roadmap files.

## Language Preference

On first use in a project folder, Context Guard creates:

```text
.codex/context/preferences.json
```

If `record_language` is `unset`, Codex should ask which language to use for future context records before writing substantive roadmap, task, or bad-case entries. After the user chooses, update the preference:

```bash
python3 ~/.agents/skills/context-guard/scripts/context_guard.py set-language --root /path/to/project --language 中文
```

Future `index.md`, `roadmap.md`, `bad-cases.md`, task context, bad-case summaries, and test-chain notes should use that language. Literal commands, paths, code identifiers, API names, logs, and exact error messages stay unchanged.

The language can be changed later with the same `set-language` command. Existing history is not bulk-translated unless the user explicitly requests migration.

## How Bad Cases Should Be Recorded

Record only bad cases that are useful for future prevention:

- user-visible bugs
- recurring failures
- risky regressions
- fixed problems that need a guard
- deferred problems that need explicit context
- route changes that explain why old behavior is no longer expected

Each bad case should stay compact:

```md
### BC-YYYYMMDD-001: Short descriptive title

- Status: open | resolved | recurred | deferred | superseded-by-route-change
- First observed: YYYY-MM-DD
- Last checked: YYYY-MM-DD
- Scope: affected feature, file, test, route, or workflow
- Roadmap nodes: NODE-YYYYMMDD-001
- Tags: #ui #route-risk #flaky
- Phenomenon: one-line symptom
- Trigger / reproduction: shortest useful reproduction
- Root cause: confirmed, suspected, or unknown
- Fix method: one-line fix summary
- Guard / verification: command, test, script, manual check, screenshot, or invariant
```

Do not turn every bad case into a script. Add scripts under `.codex/context/bad-case-tests/` only when the guard is repeatable, valuable, and cheaper than reconstructing the check.

The renderer tolerates legacy loose bullet records like `ID`, `Title`, `Status`, and `Nodes`, but `### BC-...` sections are the canonical source format. To appear on the roadmap, a case must link to route context through `Roadmap nodes:` or `Nodes:`, or the roadmap node must list it in `Linked bad cases:`.

## Test Chain Semantics

In Context Guard, a test chain is the quickest reusable way to detect whether a known bad case has returned. It is not the history of commands Codex ran while developing a node.

Good test-chain entries are short and actionable:

- a script or native test command
- a prompt/checklist for Codex to run
- a manual screenshot or visual inspection step
- a reproduction prompt, log invariant, or data check

The human roadmap's Test Chain lane is generated from linked bad cases, especially `Guard / verification`, `Reusable guard path`, and `Trigger / reproduction`. Roadmap node `Test chain:` fields may remain as compact checkpoint evidence in source/details, but they should not drive the user-facing recurrence lane.

## Roadmap Model

The roadmap is not a transcript. It should record meaningful progress, decisions, forks, and checkpoints.

- Use `Level: major` for large user-visible progress, route changes, architecture/product decisions, or completed milestones.
- Use `Level: checkpoint` for smaller implementation, validation, documentation, or UI polish updates.
- Use `Branch:` when work forks into side routes or parallel mainlines.
- Use `Parent:` when a branch starts from a specific earlier node.
- Link roadmap nodes to bad cases and test-chain notes instead of duplicating full details.
- In branch overview, route depth uses color temperature: main route green, first-level branches cool cyan/teal, deeper branches colder blue/indigo.

The human HTML view shows only the concise overview. Details belong in `roadmap-details.html`.

When there is one route, the overview shows the three aligned tracks directly. When there are multiple routes, the overview shows all route lines as a branch map with fork markers; selecting a route reveals only that route's bad cases and test chain.

## Verification

Before changing the skill, run at least:

```bash
python3 -m py_compile scripts/context_guard.py skills/context-guard/scripts/context_guard.py
python3 scripts/context_guard.py init --root /tmp/context-guard-check
python3 scripts/context_guard.py show-roadmap --root /tmp/context-guard-check
```

Recommended regression checks for roadmap changes:

- frontend/layout changes are opened or rendered with an available browser/plugin or screenshot path before claiming completion
- the visual pass checks for obvious layout bugs such as clipped text, overlap, detached lines, large empty gaps, wrong alignment, broken colors, blank content, or wrong language
- stable roadmap folder contains only `roadmap.html`, `roadmap-details.html`, and `roadmap.md`
- overview hides `NODE-...`, `BC-...`, and `CTX-...` IDs
- overview avoids visible metadata labels like `Status:`, `Nodes:`, `Frequency:`, or `untagged`
- overview tag chips hide raw `#tag-slug` values and show localized human labels
- overview does not show a visible language selector; it follows the folder language preference
- overview header does not show view-type labels or export/update timestamps
- major nodes appear in the overview while checkpoints stay in details
- branch routes render as selectable route groups with route-scoped bad cases and test chain
- multi-route overview shows all route lines together and marks branch parent/fork relationships
- loose bullet node blocks with `ID`, `Title`, `Level`, and `Status` do not render as an empty roadmap
- loose bad-case blocks with `ID`, `Title`, `Status`, and `Nodes` render as linked bad cases
- Chinese mode localizes record titles, summaries, bad cases, and test-chain snippets

## Repository Layout

```text
.
|-- .codex-plugin/plugin.json
|-- SKILL.md
|-- agents/openai.yaml
|-- hooks.json
|-- references/
|-- scripts/
`-- skills/context-guard/
```

The root skill files and `skills/context-guard/` mirror are kept in sync so the repository can work both as a simple skill source and as a plugin package.

## Design Principles

- Context is navigation, not a transcript.
- Bad-case memory is part of context, not a separate top-level system.
- HTML roadmap is for humans; source Markdown files remain Codex's source of truth.
- Reuse existing guards before writing new ones.
- Keep the overview sparse and put detail behind links.
- Prefer durable folder context over fragile thread memory.
