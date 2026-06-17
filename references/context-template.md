# Context Folder Template

Use this structure for project context:

```text
.codex/context/
├── index.md
├── roadmap.md
├── bad-cases.md
├── roadmap/
│   ├── roadmap.html
│   ├── roadmap-details.html
│   └── roadmap.md
├── tasks/
│   └── CTX-YYYYMMDD-short-slug/
│       ├── context.md
│       └── bad-cases.md
├── bad-case-tests/
└── archive/
```

## index.md

```md
# Context Index

This is a dynamic queue of active and recently parked folder context. Keep it short enough to scan in seconds.

## Quick Scan

- Current: CTX-YYYYMMDD-short-slug
- Latest roadmap node: NODE-YYYYMMDD-001
- Hot bad-case tags: #hot-ui, #flaky-test
- Resume candidate: CTX-YYYYMMDD-other-slug

Keep Quick Scan to these four lines unless the user explicitly asks for a fuller view.

## Current

- ID: CTX-YYYYMMDD-short-slug
- Title: short task title
- State: current
- Folder: `.codex/context/tasks/CTX-YYYYMMDD-short-slug/`
- Last updated: YYYY-MM-DD
- Summary: one sentence of the current direction
- Next step: the next useful action

## Parked / Resume Candidates

### CTX-YYYYMMDD-other-slug

- Title: short task title
- State: parked | resume-candidate
- Folder: `.codex/context/tasks/CTX-YYYYMMDD-other-slug/`
- Parked because: urgent bug, unrelated request, waiting on user, etc.
- Resume prompt: concise question to ask when the interruption is done
- Last updated: YYYY-MM-DD

## Archived

Keep only concise summaries here. Move detailed stale context to `.codex/context/archive/`.
```

## roadmap.md

```md
# Context Roadmap

This is the mainline route through the task. Keep nodes concise. Do not record every tiny action or chat turn.

## Nodes

### NODE-YYYYMMDD-001: Short node title

- Date: YYYY-MM-DD
- Status: planned | active | done | superseded
- Task: `CTX-YYYYMMDD-short-slug`
- Outcome: one-line result
- Decision / reason: why this node exists, one line
- Avoid going back: rejected path or lesson, only if it prevents backtracking
- Next: next useful node or action
- Linked bad cases: BC-YYYYMMDD-001, BC-YYYYMMDD-002
- Test chain: short guard names, commands, screenshots, logs, or manual checks
```

## tasks/<task-id>/context.md

```md
# Task Context: short task title

- ID: CTX-YYYYMMDD-short-slug
- State: current | parked | resume-candidate | done | archived
- Created: YYYY-MM-DD
- Last updated: YYYY-MM-DD

## Objective

One sentence describing what the user is trying to accomplish.

## Key Points

- Important ideas, constraints, and decisions only.
- Rejected approaches only when they prevent repeating a wrong route.
- Product, design, architecture, or implementation notes only when needed to resume.

## Open Questions

- Questions that need user input or future investigation.

## Files / Areas

- Relevant files, modules, commands, screenshots, or external references.

## Bad Cases

- Link to shared `.codex/context/bad-cases.md` entries or task-local `bad-cases.md`.

## Roadmap Nodes

- Link to `NODE-...` entries in `.codex/context/roadmap.md`.

## Next Step

The smallest useful action to resume this task.
```

## Maintenance Rules

- Keep `index.md` small and useful, not exhaustive.
- Keep `roadmap.md` as the mainline. It should show progress as nodes, not a raw transcript.
- Each node should be concise enough for Codex to scan quickly: outcome, decision, next step, linked bad cases.
- Link nodes to bad cases and test-chain notes instead of duplicating full details.
- Treat `.codex/context/index.md`, `.codex/context/roadmap.md`, `.codex/context/bad-cases.md`, and task context files as the source of truth.
- Treat `.codex/context/roadmap/roadmap.html` as a human-facing view only. Codex should not use it for context intake or bad-case management.
- Treat `.codex/context/roadmap/roadmap.md` as a stable agent-readable export for quick scanning or handoff, not as the primary editable source.
- Keep `NODE-...`, `BC-...`, and `CTX-...` IDs in source files for linking, but hide them in the default human-facing HTML. Show short natural-language node and bad-case labels instead.
- A sharp task direction change should park the current task before starting a new one.
- When an interruption finishes, ask whether to resume the most relevant parked task.
- Do not let parked items grow endlessly. Mark stale items `archived` and compress them to a short summary.
- Do not delete unresolved user intent unless the user explicitly discards it.
- Use `scripts/context_guard.py show-roadmap` to generate and display the stable human-friendly overview at `.codex/context/roadmap/roadmap.html`, with details at `.codex/context/roadmap/roadmap-details.html`. Use `export-roadmap --format md` only for agent-readable Markdown at `.codex/context/roadmap/roadmap.md`.
- Do not accumulate timestamped HTML roadmap files. Showing the roadmap overwrites the same stable HTML files.
- The HTML roadmap should read as three horizontal tracks: Main Route on top, Bad Cases in the middle, Test Chain on the bottom. Each vertical node column aligns those three lanes for the same roadmap node.
- Keep the overview sparse. Put full Outcome, Decision, Next, and guard details in `roadmap-details.html`.

## Pruning Rules

- Do not record normal implementation chatter.
- Do not record every command; record only commands that prove a checkpoint or guard a bad case.
- Merge tiny adjacent updates into one roadmap node.
- Archive stale parked tasks as a one-sentence summary.
- If a reader cannot use a detail to resume, decide, verify, or avoid recurrence, remove it.
