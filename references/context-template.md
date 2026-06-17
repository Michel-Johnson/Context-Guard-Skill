# Context Folder Template

Use this structure for project context:

```text
.codex/context/
├── index.md
├── roadmap.md
├── bad-cases.md
├── preferences.json
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

## preferences.json

```json
{
  "record_language": "unset",
  "display_language": "auto",
  "last_updated": "YYYY-MM-DD",
  "note": "Set with: context_guard.py set-language --language <language>"
}
```

Ask the user for a context record language the first time `record_language` is `unset`, then update this file. Use that language for future source context records. Keep literal code identifiers, paths, commands, logs, API names, and exact error text unchanged. If the user changes language later, update this file and use the new language going forward; do not bulk-translate history unless asked.

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

This is the route map through the task. It may contain one mainline, forked side routes, or multiple parallel mainlines. Keep nodes concise. Do not record every tiny action or chat turn.

## Nodes

### NODE-YYYYMMDD-001: Short node title

- Date: YYYY-MM-DD
- Status: planned | active | done | superseded
- Level: major | checkpoint
- Branch: Main | short branch name
- Parent: NODE-YYYYMMDD-000 when this branch forks, otherwise none
- Task: `CTX-YYYYMMDD-short-slug`
- Outcome: one-line result
- Decision / reason: why this node exists, one line
- Avoid going back: rejected path or lesson, only if it prevents backtracking
- Next: next useful node or action
- Linked bad cases: BC-YYYYMMDD-001, BC-YYYYMMDD-002
- Test chain: short guard names, commands, screenshots, logs, or manual checks
```

Use the `### NODE-...` section form as the canonical editable source. If a session accidentally records loose bullet blocks such as `- ID: NODE-...`, `- Title: ...`, `- Level: ...`, the renderer should still project them, but future edits should normalize them back into formal node sections.

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
- Keep `roadmap.md` as the route map. It should show progress as nodes, not a raw transcript.
- Use `Level: major` for significant milestones shown as main route cards; use `Level: checkpoint` for minor progress that should live in details.
- Use `Branch:` for forked or parallel routes. Missing `Branch:` means `Main`; use `Parent:` to point to the node where a branch forked.
- In the human overview, visible card numbers should be consecutive per route group after checkpoint filtering, not source node numbers with gaps.
- If the human overview has multiple route groups, show all route lines together with parent/fork markers, then reveal bad cases/test chain only for the selected route below the branch overview.
- Each node should be concise enough for Codex to scan quickly: outcome, decision, next step, linked bad cases.
- Link nodes to bad cases and test-chain notes instead of duplicating full details.
- Keep multilingual display as an HTML projection concern; do not duplicate source context by language. When supported, localize human-facing record titles, summaries, bad-case labels, and test-chain snippets in the projection.
- Keep source records in the configured `.codex/context/preferences.json` record language. The HTML roadmap should follow that preference and should not show a visible language selector by default.
- During goal mode or long-running autonomous work, keep the active goal aligned to the current task, add compact goal checkpoints during meaningful phase changes, and record bad cases as soon as they appear.
- Treat `.codex/context/index.md`, `.codex/context/roadmap.md`, `.codex/context/bad-cases.md`, and task context files as the source of truth.
- Treat `.codex/context/roadmap/roadmap.html` as a human-facing view only. Codex should not use it for context intake or bad-case management.
- Treat `.codex/context/roadmap/roadmap.md` as a stable agent-readable export for quick scanning or handoff, not as the primary editable source.
- Keep `NODE-...`, `BC-...`, and `CTX-...` IDs in source files for linking, but hide them in the default human-facing HTML. Show short natural-language node and bad-case labels instead.
- In human-facing HTML, prefer color, symbols, and compact visual markers over labels like `Status:`, `Nodes:`, `Frequency:`, or fallback text such as `untagged`.
- Show meaningful `#tags` as compact colored chips with small emoji cues in human-facing HTML. Limit overview tags; show full tags on the detail page; omit the tag row when no tags exist.
- A sharp task direction change should park the current task before starting a new one.
- When an interruption finishes, ask whether to resume the most relevant parked task.
- Do not let parked items grow endlessly. Mark stale items `archived` and compress them to a short summary.
- Do not delete unresolved user intent unless the user explicitly discards it.
- Use `scripts/context_guard.py show-roadmap` to generate and display the stable human-friendly overview at `.codex/context/roadmap/roadmap.html`, with details at `.codex/context/roadmap/roadmap-details.html`. Use `export-roadmap --format md` only for agent-readable Markdown at `.codex/context/roadmap/roadmap.md`.
- Do not accumulate timestamped HTML roadmap files. Showing the roadmap overwrites the same stable HTML files.
- With one route group, the HTML roadmap should read as three horizontal tracks: Main Route on top, Bad Cases in the middle, Test Chain on the bottom. Each vertical node column aligns those three lanes for the same roadmap node.
- With multiple route groups, the overview should show all route lines as a branch map; route selection should affect only the bad-case/test-chain drilldown.
- Parent/fork markers should appear only on side routes whose parent node is outside that route. Main route should not show a fork marker just because a later main node references an earlier main node.
- Side routes should visually start near their parent node's visible position on the parent route, not all from the first column.
- Branch overview should use one shared horizontal route canvas. Route alignment should use grid spacer columns, not padding that shifts or clips the whole route section.
- Branch connector lines should use the same offset coordinate as the route's spacer columns, not a fixed left-edge position.
- User-facing projected text should follow the folder language preference; avoid untranslated English prose in Chinese overview output except for intentional technical strings.
- Show the three lane titles once in the left label column for a single route group, not inside every node card.
- Keep the overview sparse. Put full Outcome, Decision, Next, and guard details in `roadmap-details.html`.

## Pruning Rules

- Do not record normal implementation chatter.
- Do not record every command; record only commands that prove a checkpoint or guard a bad case.
- Do not wait until goal completion to record important roadmap progress or bad cases.
- Merge tiny adjacent updates into one roadmap node.
- Archive stale parked tasks as a one-sentence summary.
- If a reader cannot use a detail to resume, decide, verify, or avoid recurrence, remove it.
