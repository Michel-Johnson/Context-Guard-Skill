# Context Guard Skill

Language: **English** | [中文](README.zh-CN.md)

Context Guard is a Codex skill for durable project memory. It keeps the task route, branches, bad cases, and verification paths inside the project's own `.codex/context/` folder, so Codex can understand where the work is, what went wrong before, and how to avoid repeating fixed mistakes across sessions.

## What It Does

- **Four stores**: sessions, bugs, tasks, map — in the opened project’s `.codex/context/`
- **First-use map**: the agent reads the repo, writes `architecture.md`, and proposes 4–8 L1 modules. Later sessions open that map
- **Human workbench**: people confirm in `prototype/workbench.html`. Agents read small indexes, not the whole map
- **User wording**: durable prompts go in `user-messages.md`; secrets stay under `private/`
- **Record language**: Chinese or English per folder

v1 does **not** include Roadmap HTML, Test Hub, or feature chains.

## Human workbench

People confirm the architecture map in `prototype/workbench.html`. Agents read the small indexes under `.codex/context/`; they do not drive the canvas.

**Current workbench (this branch):** [prototype/workbench.html](https://github.com/Michel-Johnson/Context-Guard-Skill/blob/cursor/web-dev-f54e/prototype/workbench.html) · [open in browser](https://raw.githack.com/Michel-Johnson/Context-Guard-Skill/cursor/web-dev-f54e/prototype/workbench.html)

The first browser open may show GitHack’s “One more step” page (it is only a proxy and does not review the HTML). Click **Open the page**.

The workbench chrome is Chinese or English. Use **中 / EN** in the top bar. Map titles, purposes, and memories stay in the language they were written.

Serve the repo root so the page can load `.codex/context/map.json`:

```bash
python3 -m http.server 8877
# then open http://127.0.0.1:8877/prototype/workbench.html
```

### Overview

Root catalog: 4–8 module cards. Click a card to enter. Bugs stay in the right-hand list.

![Workbench overview](docs/shots/workbench/overview.png)

### Inside a module

Work units hang under the module. Hierarchy is parent–child solid curves.

![Inside a module](docs/shots/workbench/module.png)

### Module relations

「关系」 highlights produce/consume partners and dims the rest. It does not enter the module.

![Module relations](docs/shots/workbench/relations.png)

### Session flow

Click a bug with an assigned session. The path from the root to that node lights up; current session beads run along the chain.

![Session flow](docs/shots/workbench/session-flow.png)

### Auth / inspect mode

「授权模式」 marks which slices this session’s agent may read. Grey cards are not authorized.

![Auth mode](docs/shots/workbench/auth-mode.png)

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

This also enables the current `[features] hooks = true` setting in `~/.codex/config.toml` and migrates the deprecated `codex_hooks` alias without changing other settings.

Use from GitHub before the npm package is published:

```bash
npx github:Michel-Johnson/Context-Guard-Skill install
```

Manual install is also supported:

```bash
git clone git@github.com:Michel-Johnson/Context-Guard-Skill.git
cd Context-Guard-Skill
mkdir -p ~/.codex/skills/context-guard
rsync -a --delete \
  SKILL.md README.md README.zh-CN.md agents references scripts tests \
  ~/.codex/skills/context-guard/
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

Short user prompts that matter for future work are kept in:

```text
<Codex project root>/.codex/context/user-messages.md
```

If the user provides a credential that future Codex turns need, Context Guard records only a redacted pointer in public context. Raw durable secrets must stay local-only under:

```text
<Codex project root>/.codex/context/private/
```

When running scripts manually, pass the project root:

```bash
python3 scripts/context_guard.py init --root /path/to/project
python3 scripts/context_guard.py set-language --root /path/to/project --language English
```

People look at `prototype/workbench.html`. `show-roadmap` only prints that path.

## Common Usage

```text
Use $context-guard. Four stores: sessions, bugs, tasks, map.
```

```bash
python3 scripts/context_guard.py init --root /path/to/project
python3 scripts/context_guard.py set-language --root /path/to/project --language English
```

Open `prototype/workbench.html` to see the map.

## Main Files

```text
.codex/context/
|-- FIND.md
|-- sessions.jsonl
|-- bugs/ and fixes/
|-- tasks/
|-- map.json
|-- owns-index.json and cards/   # generated
|-- preferences.json
|-- user-messages.md
`-- private/                     # gitignored
```

See [`SKILL.md`](SKILL.md) (one page) and `.codex/context/FIND.md`.
