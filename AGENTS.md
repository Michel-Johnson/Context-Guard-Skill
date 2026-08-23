# AGENTS.md

## Cursor Cloud specific instructions

This repository is the **Context Guard** package (`@michelj/context-guard`): a Codex
skill distributed as a thin Node CLI wrapper over a Python implementation. It has
**no external runtime dependencies** — only the Node standard library and the
Python standard library. Node (>=18) and `python3` are preinstalled in the cloud
environment.

### Services / components
There is no long-running service or dev server. The "application" is a CLI:
- `node bin/context-guard-skill.js <command> [args]` — entrypoint. `install`/`path`
  are handled in Node; every other command is forwarded to
  `scripts/context_guard.py`.
- Roadmap/Test-Hub output is written as **static HTML** under a target project's
  `.codex/context/` (e.g. `roadmap/roadmap.html`) — open the file directly in a
  browser, there is no server to start.

### Lint / test / build / run
- Build: none.
- Lint + test: `npm test` (see `package.json`). It runs
  `tests/npm-install-smoke.sh` and then `python3 -m py_compile` on the two Python
  scripts — the `py_compile` step is the de-facto Python syntax/lint check.
- Run against a project: initialize with
  `node bin/context-guard-skill.js init --root /path/to/project`, then use
  commands like `checkpoint-roadmap-node` and `show-roadmap` (all take `--root`).

### Gotchas
- `npm install` runs `bin/postinstall.js`, which only copies the skill into
  `~/.codex/skills` on a **global** install or when `CONTEXT_GUARD_AUTO_INSTALL=1`.
  For a plain local `npm install` it just prints a notice and exits, so it will not
  touch your Codex home. Set `CONTEXT_GUARD_SKIP_AUTO_INSTALL=1` to bypass it
  entirely.
- `npm install` has nothing to install (zero deps) but will create an untracked
  `package-lock.json`; it is not committed.
