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
- **Covers bad cases with feature chains**: prefer one real feature/workflow chain covering multiple bad cases over one separate test per bad case.
- **Runs approved tests by default**: user-created or user-approved tests run at every development completion unless the user sets another cadence.
- **Provides a Test Hub entrypoint**: `dev-complete` runs approved always-run tests, cleans success artifacts, and preserves failed evidence.

## Install

Install with npx:

```bash
npx @michelj/context-guard install
```

Or install globally and let the package copy the skill into Codex's skill directory automatically:

```bash
npm install -g @michelj/context-guard --registry=https://registry.npmjs.org
```

Install hooks only when you explicitly want Context Guard reminders at Codex lifecycle events:

```bash
npx @michelj/context-guard install --with-hooks
```

Use from GitHub before the npm package is published:

```bash
npx github:Michel-Johnson/Context-Guard-Skill install
```

Manual install is also supported:

```bash
git clone git@github.com:Michel-Johnson/Context-Guard-Skill.git
cd Context-Guard-Skill
mkdir -p ~/.codex/skills/context-guard
rsync -a --delete skills/context-guard/ ~/.codex/skills/context-guard/
```

After installation, Codex should discover:

```text
~/.codex/skills/context-guard/SKILL.md
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
python3 ~/.codex/skills/context-guard/scripts/context_guard.py show-roadmap --root /path/to/project
```

Register a user-approved automated test:

```bash
python3 ~/.codex/skills/context-guard/scripts/context_guard.py test-hub-add \
  --root /path/to/project \
  --title "Markdown preview rendering" \
  --command-text "npm test"
```

Register a user-approved feature-chain test:

```bash
python3 ~/.codex/skills/context-guard/scripts/context_guard.py feature-chain-add \
  --root /path/to/project \
  --title "GPU monitor button" \
  --entry "Click the GPU monitor button" \
  --exit-check "Open a monitoring page with a valid grafana_url" \
  --command-text "npm test -- gpu-monitor"
```

Attach a bad case to a specific feature-chain checkpoint:

```bash
python3 ~/.codex/skills/context-guard/scripts/context_guard.py feature-chain-attach-bc \
  --root /path/to/project \
  --chain-id FC-... \
  --node-title "Backend returns monitor URL" \
  --bad-case BC-... \
  --check "grafana_url is non-empty and the frontend does not hang"
```

After development, hand completion to the Test Hub:

```bash
python3 ~/.codex/skills/context-guard/scripts/context_guard.py dev-complete --root /path/to/project --jobs 2
```

Open the read-only Test Hub page:

```bash
python3 ~/.codex/skills/context-guard/scripts/context_guard.py show-test-hub --root /path/to/project --open
```

Manage tests lightly:

```bash
python3 ~/.codex/skills/context-guard/scripts/context_guard.py test-hub-list --root /path/to/project
python3 ~/.codex/skills/context-guard/scripts/context_guard.py test-hub-disable --root /path/to/project --test-id TC-... --reason "not needed every time"
python3 ~/.codex/skills/context-guard/scripts/context_guard.py test-hub-enable --root /path/to/project --test-id TC-...
python3 ~/.codex/skills/context-guard/scripts/context_guard.py test-hub-set-policy --root /path/to/project --test-id TC-... --run-policy relevant-only --reason "only editor changes need it"
python3 ~/.codex/skills/context-guard/scripts/context_guard.py test-hub-remove --root /path/to/project --test-id TC-...
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
python3 ~/.codex/skills/context-guard/scripts/context_guard.py init --root /path/to/project
```

Set the record language:

```bash
python3 ~/.codex/skills/context-guard/scripts/context_guard.py set-language --root /path/to/project --language English
```

Generate the roadmap:

```bash
python3 ~/.codex/skills/context-guard/scripts/context_guard.py show-roadmap --root /path/to/project
```

Or use the npm CLI as a thin wrapper:

```bash
npx @michelj/context-guard show-roadmap --root /path/to/project
```

Create a branch task:

```bash
python3 ~/.codex/skills/context-guard/scripts/context_guard.py create-branch-task \
  --root /path/to/project \
  --title "branch task title" \
  --branch "branch name" \
  --parent-node NODE-YYYYMMDD-001
```

Record a roadmap checkpoint:

```bash
python3 ~/.codex/skills/context-guard/scripts/context_guard.py checkpoint-roadmap-node \
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
|-- test-hub/             # test registry, latest result, and failed evidence
`-- bad-case-tests/       # reusable bad-case checks
```

## Principles

- Record only meaningful progress, not every small action.
- Human-facing titles should read naturally, not like implementation logs.
- A bad case should help future Codex prevent recurrence.
- Test design belongs to humans; Codex can run approved checks or draft a proposal for confirmation.
- Prefer feature chains as the durable testing unit: one clear entry, one real workflow, ordered checkpoints, and multiple covered bad cases.
- Attach new bad cases to an existing feature-chain checkpoint first; propose a new chain only when no existing workflow matches.
- User-approved tests default to `every-dev-completion`; Codex may lower that cadence only when the user asks.
- Approved automated tests should go into `.codex/context/test-hub/registry.json` or `.codex/context/test-hub/feature-chains.json` and be scheduled through `dev-complete`.
- Keep the Test Hub simple: one registry, one `dev-complete` runner, one latest-result file, one read-only HTML status page, and a few management commands.
- Final Codex summaries should state the current Test Hub result: whether approved always-run tests all passed, failed, blocked, or do not exist.
- Verification should reuse existing commands, scripts, screenshots, or manual checks first.
- Do not create a new script for every bad case.
- For frontend or HTML changes, inspect the rendered page or screenshot before claiming success.
- For any new durable test case, draft a short task-case proposal and confirm with the user before making it active.

See [`skills/context-guard/SKILL.md`](skills/context-guard/SKILL.md) for the full behavior rules.
