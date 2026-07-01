# Context Guard Skill

Language: **English** | [中文](README.zh-CN.md)

Context Guard is a Codex skill for durable project memory. It keeps the task route, branches, bad cases, and verification paths inside the project's own `.codex/context/` folder, so Codex can understand where the work is, what went wrong before, and how to avoid repeating fixed mistakes across sessions.

## What It Does

- **Maintains project context**: creates and updates `.codex/context/`.
- **Records the roadmap**: tracks main routes, side routes, branch points, and progress.
- **Tracks bad cases**: records symptoms, triggers, causes, fixes, and recurrence checks.
- **Generates Roadmap HTML**: shows a human-readable roadmap with clickable node details.
- **Separates human and agent views**: HTML is for humans; Markdown/JSON are for Codex.
- **Supports record language preferences**: writes future context in Chinese or English.
- **Handles task switches**: parks, resumes, and branches interrupted work.
- **Keeps tests human-designed**: Codex reuses approved checks or proposes drafts, but does not silently create durable tests.
- **Runs approved tests by default**: user-created or user-approved tests run at every development completion unless the user sets another cadence.

## Install

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

## Where Context Lives

Context must be saved under the local project currently opened in Codex:

```text
<Codex project root>/.codex/context/
```

Do not write project context into:

- the skill install directory
- a chat/thread directory
- a temporary directory
- an SSH remote server path

When running scripts manually, pass the project root explicitly:

```bash
python3 ~/.agents/skills/context-guard/scripts/context_guard.py show-roadmap --root /path/to/project
```

## Common Usage

Ask Codex to maintain context:

```text
Use $context-guard to maintain this task context.
```

Show the current roadmap:

```text
Use $context-guard to show the roadmap.
```

Initialize project context:

```bash
python3 ~/.agents/skills/context-guard/scripts/context_guard.py init --root /path/to/project
```

Set the record language:

```bash
python3 ~/.agents/skills/context-guard/scripts/context_guard.py set-language --root /path/to/project --language English
```

Generate the roadmap:

```bash
python3 ~/.agents/skills/context-guard/scripts/context_guard.py show-roadmap --root /path/to/project
```

Create a branch task:

```bash
python3 ~/.agents/skills/context-guard/scripts/context_guard.py create-branch-task \
  --root /path/to/project \
  --title "branch task title" \
  --branch "branch name" \
  --parent-node NODE-YYYYMMDD-001
```

Record a roadmap checkpoint:

```bash
python3 ~/.agents/skills/context-guard/scripts/context_guard.py checkpoint-roadmap-node \
  --root /path/to/project \
  --title "source title for Codex" \
  --display-title "short human title" \
  --user-request "what the user asked" \
  --progress-summary "current progress" \
  --method-summary "method used" \
  --branch Main \
  --level major \
  --outcome "result"
```

## Main Files

```text
.codex/context/
|-- index.md              # quick index and active task
|-- roadmap.md            # agent-readable roadmap
|-- bad-cases.md          # bad-case register
|-- preferences.json      # language and project preferences
|-- roadmap/
|   |-- roadmap.html      # human-facing roadmap
|   |-- roadmap.md        # agent-readable export
|   `-- roadmap.json      # structured index
|-- tasks/                # task-level context
|-- task-cases/           # task-oriented test cases
`-- bad-case-tests/       # reusable bad-case checks
```

## Principles

- Record only meaningful progress, not every small action.
- Human-facing titles should read naturally, not like implementation logs.
- A bad case should help future Codex prevent recurrence.
- Test design belongs to humans; Codex can run approved checks or draft a proposal for confirmation.
- User-approved tests default to `every-dev-completion`; Codex may lower that cadence only when the user asks.
- Verification should reuse existing commands, scripts, screenshots, or manual checks first.
- Do not create a new script for every bad case.
- For frontend or HTML changes, inspect the rendered page or screenshot before claiming success.
- For any new durable test case, draft a short task-case proposal and confirm with the user before making it active.

See [`skills/context-guard/SKILL.md`](skills/context-guard/SKILL.md) for the full behavior rules.
