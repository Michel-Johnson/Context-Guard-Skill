---
name: context-guard
description: "Keep folder-scoped project memory: sessions, bugs, tasks, and the architecture map. Use at the start of a folder, when the map or a bug is involved, when direction changes, and during coding/debugging/review."
---

# Context Guard

Human–agent project memory for Codex, Cursor, and Claude. The agent records. The human looks at the HTML workbench and confirms there (local write-back) or in chat after a GitHack view (cloud). Not the CLI.

## When to use

- First session in this folder, or no live map yet
- The human asks to open or change the map
- Direction changes, park/resume, coding, debugging, review

## What to do

Four stores only:

1. **Sessions** — lifecycle hooks append `.codex/context/sessions.jsonl` and create `sessions/{id}.md`
2. **Bugs** — thin card in `.codex/context/bugs/{id}.md` plus how-to in `fixes/{id}.md`; stub on the map node
3. **Tasks** — playbook in `.codex/context/tasks/{id}.md`
4. **Map** — live tree in `.codex/context/map.json`; short memories and ideas stay on the node

How to find a file: read `.codex/context/FIND.md`, then the small indexes (`owns-index.json`, `bugs-index.json`, `tasks-index.json`, last lines of `sessions.jsonl`). Open only the hit Markdown. After the map changes: `python3 scripts/map_owns.py cards`.

Formats: `.codex/context/FORMAT.md`. Human canvas: `prototype/workbench.html`. Agent does not drive the canvas.

### Workbench — cloud vs local

**Cloud (GitHub static page / GitHack):** after you push, give the human the workbench link. They look. They confirm or request changes **in chat**. You edit `.codex/context/map.json` (and bugs/tasks), run `python3 scripts/map_owns.py cards`, then push. Clicks on the static page do not reach this workspace. Do not expect live write-back from GitHack.

**Local (browser and repo on the same machine):** SessionStart can start a local workbench and inject its URL (`context-guard workbench --root <project>`). Or use the workbench 「连接仓库」 control so the browser writes `map.json` on disk. Next turn, re-read the small indexes. Do not reuse a map pasted in an earlier message.

**Add or change a module/node in the cloud:** propose titles and purposes in chat (readable in seconds). After the human agrees, write them into `map.json` under the agreed parent, then regenerate cards. Do not rebuild L1 unless asked.

### Bugs — record fast

When you find a bug: next `B` id, thin `bugs/{id}.md` plus `fixes/{id}.md` (`怎么修` is `未修` if still open), stub on that map node’s `bugs[]`, regenerate indexes, push. Prefer `context-guard record-bad-case` when that command is available. Tell the human the id. On GitHack they can see the open-bug list after push. Status changes: human says so in chat (cloud) or writes back from the local workbench (local). Do not create `bad-cases.md`.

First session language: when `.codex/context/preferences.json` has `record_language: unset`, ask the user whether project context should be recorded in 中文 or English before substantive project work. Do not infer the answer. Persist it with `context-guard set-language --root <project> --language <zh-or-en>`. Do not ask again after it is set.

### First use

First use (no map yet): talk with the human layer by layer. First offer several ways to cut L1, or a larger set of candidate modules whose titles a person can read in seconds. After they lock L1 (about 4–8), design L2, then L3. Write `architecture.md` as you go. Put the agreed L1 into `map.json` with `owns` paths and `map_bootstrap` proposed. Later sessions open that map. Do not dump a full tree, a directory listing, or one node per file.

When a credible failure or user-reported bad case appears, record it immediately with `context-guard record-bad-case --root <project> --title <title> --phenomenon <what-failed> --trigger <trigger> --cause <cause-or-pending> --guard <regression-guard> --node <map-node> --keys <comma-separated>`. Do not create a bad case from a guess.

CLI: `context-guard init`, `set-language`, `workbench`, and `record-bad-case`. People look at the workbench, not a generated roadmap page.

## What not to do

- Do not paste `map.json` or `jump-index.json` into the turn
- Do not Grep the whole `.codex/context/` tree
- Do not treat Markdown links as the agent’s hop
- Do not expand Test Hub, feature chains, Stop-hook gates, or Roadmap HTML
- Do not write context into the skill install directory, a chat folder, or an SSH remote path
- Do not put secrets in git-tracked context; redacted pointer only, raw values in `.codex/context/private/`
- Do not keep a second bad-case register in `bad-cases.md`
- Do not invent Test Hub scripts
