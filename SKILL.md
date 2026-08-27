---
name: context-guard
description: "Keep folder-scoped project memory: sessions, bugs, tasks, and the architecture map. Use at the start of a folder, when the map or a bug is involved, when direction changes, and during coding/debugging/review."
---

# Context Guard

Human–agent project memory. The agent records. The human confirms in the HTML workbench, not the CLI.

## When to use

- First time this folder is used (no live map yet)
- The human asks to open or change the map
- Direction changes, park/resume, coding, debugging, review

## What to do

Four stores only:

1. **Sessions** — append `.codex/context/sessions.jsonl`
2. **Bugs** — thin card in `.codex/context/bugs/{id}.md` plus how-to in `fixes/{id}.md`; stub on the map node
3. **Tasks** — playbook in `.codex/context/tasks/{id}.md`
4. **Map** — live tree in `.codex/context/map.json`; short memories and ideas stay on the node

How to find a file: read `.codex/context/FIND.md`, then the small indexes (`owns-index.json`, `bugs-index.json`, `tasks-index.json`, last lines of `sessions.jsonl`). Open only the hit Markdown. After the map changes: `python3 scripts/map_owns.py cards`.

Formats: `.codex/context/FORMAT.md`. Human canvas: `prototype/workbench.html`.

First use (no map yet): talk with the human layer by layer. First offer several ways to cut L1, or a larger set of candidate modules whose titles a person can read in seconds. After they lock L1 (about 4–8), design L2, then L3. Write `architecture.md` as you go. Put the agreed L1 into `map.json` with `owns` paths and `map_bootstrap` proposed. Later sessions open that map. Do not dump a full tree, a directory listing, or one node per file.

CLI: `python3 scripts/context_guard.py init --root <project>` and `set-language`. People look at the workbench, not a generated roadmap page.

## What not to do

- Do not paste `map.json` or `jump-index.json` into the turn
- Do not Grep the whole `.codex/context/` tree
- Do not treat Markdown links as the agent’s hop
- Do not expand Test Hub, feature chains, Stop-hook gates, or Roadmap HTML
- Do not write context into the skill install directory, a chat folder, or an SSH remote path
- Do not put secrets in git-tracked context; redacted pointer only, raw values in `.codex/context/private/`
- Do not keep a second bad-case register in `bad-cases.md`
- Do not invent Test Hub scripts
