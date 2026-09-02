[Website & interactive demos](https://michel-johnson.github.io/Context-Guard-Skill/?lang=en)

# Context Guard Skill

Language: **English** | [中文](README.zh-CN.md)

Context Guard is a durable project-memory skill for Codex, Cursor, and Claude. It keeps the task route, branches, bad cases, and verification paths inside the project's own `.codex/context/` folder, so agents can understand where the work is, what went wrong before, and how to avoid repeating fixed mistakes across sessions.

## What It Does

- **Four stores**: sessions, bugs, tasks, map — in the opened project’s `.codex/context/`
- **First-use map**: the agent and the human decide the first layer together (several candidate cuts, then lock L1), then L2, then L3. Titles must be instantly readable. Later sessions open that map
- **Human workbench**: people confirm in `prototype/workbench.html`. Agents read small indexes, not the whole map
- **User wording**: durable prompts go in `user-messages.md`; secrets stay under `private/`
- **Record language**: Chinese or English per folder
- **Lifecycle**: create session records, retain user messages, and persist agent-identified bad cases through one command

v1 does **not** include Roadmap HTML, Test Hub, or feature chains.

## Human workbench

People look at the map in `prototype/workbench.html`. Agents read the small indexes under `.codex/context/`; they do not drive the canvas.

**Cloud:** the [GitHack page](https://raw.githack.com/Michel-Johnson/Context-Guard-Skill/main/prototype/workbench.html) shows the last push. Clicks there do not write the repo. Ask for changes in chat; the agent edits files and pushes; refresh the page. The first open may show GitHack’s “One more step” screen — click **Open the page**.

**Local:** with hooks installed, a new session can start one local workbench. You can also start or stop it manually. The Node service automatically persists edits to `map.json` and pushes file/Agent changes back to the page; a browser directory handle is no longer a map writer.

```bash
context-guard workbench --root /path/to/project
context-guard workbench --root /path/to/project --stop
```

The workbench chrome is Chinese or English. Open **Settings** on the far right of the top bar for language and theme. Map titles, purposes, and memories stay in the language they were written.

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

Install with npx. The installer detects Codex, Cursor, and Claude, then installs both the skill and lifecycle hooks while preserving existing configuration:

```bash
npx @michelj/context-guard install
```

Or install globally and let the package configure detected clients automatically:

```bash
npm install -g @michelj/context-guard --registry=https://registry.npmjs.org
```

Force installation for all three clients:

```bash
npx @michelj/context-guard install --platform all
```

Hooks are installed by default. To copy only the skill, opt out explicitly:

```bash
npx @michelj/context-guard install --no-hooks
```

Default skill paths are `~/.codex/skills/context-guard`, `~/.cursor/skills/context-guard`, and `~/.claude/skills/context-guard`. The installer backs up and merges existing hook/settings files. For Codex it also enables `[features] hooks = true` and migrates the deprecated `codex_hooks` alias.

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
  SKILL.md README.md README.zh-CN.md agents prototype references scripts \
  ~/.codex/skills/context-guard/
```

After installation, the matching clients should discover:

```text
~/.codex/skills/context-guard/SKILL.md
~/.cursor/skills/context-guard/SKILL.md
~/.claude/skills/context-guard/SKILL.md
```

## Publishing

GitHub Releases are not part of this package's delivery path. Users install the skill from npm, so publishing is driven by a version tag:

1. Update `package.json` to the next stable version and merge that commit into `main`.
2. Create the matching `vX.Y.Z` tag on that commit.
3. Push the tag. `.github/workflows/npm-publish.yml` validates, packs, smoke-tests, and publishes that exact tarball to npm.

The workflow has no manual trigger. Pushing a matching version tag starts the complete publish pipeline automatically; the validated tarball is retained as a GitHub Actions artifact for 14 days. It reuses npm Trusted Publishing for `Michel-Johnson/Context-Guard-Skill`, workflow filename `npm-publish.yml`, with the `npm publish` action allowed. Local npm login is not required for Actions publishing. See the [release and recovery runbook](https://github.com/Michel-Johnson/Context-Guard-Skill/blob/main/docs/npm-release-runbook.md).

## Where Context Lives

Context stays under the opened local project, independent of the client:

```text
<project root>/.codex/context/
```

Do not write project context into:

- the skill install directory
- a chat/thread directory
- a temporary directory
- an SSH remote server path

Short user prompts that matter for future work are kept in:

```text
<project root>/.codex/context/user-messages.md
```

If the user provides a credential that future turns need, Context Guard records only a redacted pointer in public context. Raw durable secrets must stay local-only under:

```text
<project root>/.codex/context/private/
```

When running scripts manually, pass the project root:

```bash
python3 scripts/context_guard.py init --root /path/to/project
python3 scripts/context_guard.py set-language --root /path/to/project --language English
```

On the first session, if `record_language` is still `unset`, the hook instructs the agent to ask “中文 or English?” and persist the answer. Later sessions do not ask again. The `workbench` command starts the local server and returns its browser URL.

## Common Usage

```text
Use $context-guard. Four stores: sessions, bugs, tasks, map.
```

```bash
python3 scripts/context_guard.py init --root /path/to/project
python3 scripts/context_guard.py set-language --root /path/to/project --language English
python3 scripts/context_guard.py workbench --root /path/to/project
context-guard doctor --platform codex --root /path/to/project
```

Run `context-guard workbench --root /path/to/project` to see the map. The top bar uses `platform-thread-name` (for example, `codex-basic`) while the session ID remains an internal identifier; Settings can switch sessions and grants are persisted across workbench restarts. Use `record-bad-case --session ...` and `record-bad-case-fix` for the minimal failure/fix loop, `write-candidates --input ...` for validated first-use L1 candidates, and `archive-session` to save durable session results.

## Main Files

```text
.codex/context/
|-- FIND.md
|-- sessions.jsonl
|-- sessions/
|-- bugs-index.json
|-- bugs/ and fixes/
|-- tasks/
|-- map.json
|-- owns-index.json and cards/   # generated
|-- preferences.json
|-- user-messages.md
`-- private/                     # gitignored
```

See [`SKILL.md`](SKILL.md) (one page) and `.codex/context/FIND.md`.

## Local workbench synchronization

Node now owns local map submissions and live page updates. Use `context-guard map read` and `map apply` with an actual session ID, a base version and a stable operation ID. Browser cache is recovery-only; static pages are read-only. Python remains required for hooks and context initialization. See [the interface and migration guide](references/workbench-interface.md).
