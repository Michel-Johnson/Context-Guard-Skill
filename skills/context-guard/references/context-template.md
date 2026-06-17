# Context Folder Template

Use this structure for project context:

```text
.codex/context/
├── index.md
├── roadmap.md
├── bad-cases.md
├── tasks/
│   └── CTX-YYYYMMDD-short-slug/
│       ├── context.md
│       └── bad-cases.md
├── bad-case-tests/
├── exports/
└── archive/
```

## index.md

```md
# Context Index

This is a dynamic queue of active and recently parked folder context. Keep it short and optimized for quick scanning.

## Quick Scan

- Current: CTX-YYYYMMDD-short-slug
- Latest roadmap node: NODE-YYYYMMDD-001
- Hot bad-case tags: #hot-ui, #flaky-test
- Resume candidate: CTX-YYYYMMDD-other-slug

## Current

- ID: CTX-YYYYMMDD-short-slug
- Title: short task title
- State: current
- Folder: `.codex/context/tasks/CTX-YYYYMMDD-short-slug/`
- Last updated: YYYY-MM-DD
- Summary: one paragraph of the current direction
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

This is the mainline route through the task. Keep nodes concise. Do not record every tiny action.

## Nodes

### NODE-YYYYMMDD-001: Short node title

- Date: YYYY-MM-DD
- Status: planned | active | done | superseded
- Task: `CTX-YYYYMMDD-short-slug`
- Outcome: one-line result
- Decision / reason: why this node exists
- Avoid going back: rejected path or lesson, if any
- Next: next useful node or action
- Linked bad cases: BC-YYYYMMDD-001, BC-YYYYMMDD-002
- Test chain: test names, commands, screenshots, logs, or manual checks
```

## tasks/<task-id>/context.md

```md
# Task Context: short task title

- ID: CTX-YYYYMMDD-short-slug
- State: current | parked | resume-candidate | done | archived
- Created: YYYY-MM-DD
- Last updated: YYYY-MM-DD

## Objective

What the user is trying to accomplish.

## Key Points

- Important ideas, constraints, and decisions.
- Rejected approaches and why.
- Product, design, architecture, or implementation notes.

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
- Each node should be concise enough for Codex to scan quickly.
- Link nodes to bad cases and test-chain notes instead of duplicating full details.
- A sharp task direction change should park the current task before starting a new one.
- When an interruption finishes, ask whether to resume the most relevant parked task.
- Do not let parked items grow endlessly. Mark stale items `archived` and compress them to a short summary.
- Do not delete unresolved user intent unless the user explicitly discards it.
- Use `scripts/context_guard.py show-roadmap` to generate and display a human-friendly HTML route map from `.codex/context/exports/`. Use `export-roadmap --format md` only for agent-readable Markdown.
