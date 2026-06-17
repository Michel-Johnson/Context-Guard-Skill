---
name: context-guard
description: "Maintain and enforce a folder-scoped project context folder, route-map index, dynamic task queue, and bad-case/test-chain memory. Use at the beginning and end of every assistant response, especially when a Codex folder is first used, the user asks to show/open/export the roadmap, changes task direction, uses goal mode or long-running autonomous work, parks/resumes work, or performs coding/debugging/review/QA."
---

# Context Guard

## Purpose

Maintain durable folder-scoped context across threads and interruptions. Preserve the task route map, park active design threads when urgent work interrupts, resume them when appropriate, and prevent solved bad cases from silently returning.

## Conciseness Contract

Context is a navigation aid, not a transcript. Record only information that helps future Codex resume, avoid a wrong route, or prevent a bad case from recurring.

1. Keep `index.md` to four Quick Scan lines plus the current/resume task summary.
2. Keep major roadmap nodes for significant changes only; record small implementation updates as `Level: checkpoint`.
3. Keep task context to key points only: objective, constraints/decisions, open questions, touched areas, and next step.
4. Record a bad case only when it is user-visible, recurring, risky, fixed, deferred, or needed to explain a guard.
5. Prefer one-line summaries. If a detail is not needed for resume, route choice, or recurrence prevention, omit it.
6. When exporting or displaying context, show the shortest useful view first and leave secondary details folded or linked.

## Context Folder

Maintain a folder-local context folder so task context, route nodes, bad-case memory, and reusable guards travel with the Codex folder. This context belongs to the folder, not to a single thread.

1. Prefer the canonical context root: `.codex/context/`.
2. Create the context root the first time Codex works in a folder.
3. Maintain the quick-browse index at `.codex/context/index.md`.
4. Maintain the main route map at `.codex/context/roadmap.md`.
5. Maintain folder preferences at `.codex/context/preferences.json`.
6. Store task-specific context under `.codex/context/tasks/<task-id>/`.
7. Store shared bad-case and test-chain context at `.codex/context/bad-cases.md` unless a bad case belongs only inside one task folder.
8. If no canonical context exists, read legacy bad-case locations if present: `.codex/bad-cases.md`, `BAD_CASES.md`, `docs/bad-cases.md`, or `.agents/bad-cases.md`.
9. If legacy context exists and the task modifies context, migrate or copy it into `.codex/context/` unless the repository clearly standardizes on the legacy path.
10. Use `references/context-template.md` for index, roadmap, and task-folder formats.
11. Use `references/register-template.md` when creating or updating bad-case entries.

Do not store project context inside the skill directory. Do not create a separate top-level bad-case folder; bad cases are part of `context`.

## Language Preference

Context records need a folder-scoped language preference so Codex does not mix languages across sessions.

1. On the first use in a folder, create `.codex/context/preferences.json` with `record_language: "unset"`.
2. If `record_language` is missing or `unset`, ask the user which language to use for future context records before writing substantive roadmap, task, or bad-case content.
3. After the user chooses, run or emulate `scripts/context_guard.py set-language --language <language>` and store the normalized value in `.codex/context/preferences.json`.
4. Write future `index.md`, `roadmap.md`, `bad-cases.md`, task context, bad-case titles, summaries, and test-chain notes in the configured record language.
5. Preserve code identifiers, file paths, commands, API names, exact errors, logs, and quoted user text in their original form.
6. If the user asks to change language later, update `.codex/context/preferences.json` and use the new language going forward.
7. Do not bulk-translate historical records unless the user explicitly asks for migration.
8. The HTML roadmap follows the folder language preference by default. Do not show a visible language selector in the human-facing roadmap unless the user explicitly asks for one.

## Dynamic Task Index

Use `.codex/context/index.md` as a small, actively maintained queue of work context and `.codex/context/roadmap.md` as the route map. A route map may have one mainline, forked side routes, or multiple parallel mainlines.

1. At turn start, compare the user's latest request with the current index entry.
2. If the request continues the same direction, update that task folder.
3. If the request is a sharp direction change, urgent bug, or unrelated event, park the current task before switching:
   - Summarize only the current idea, key decision/constraint, open blocker, and next step.
   - Mark it `parked` or `resume-candidate`.
   - Create or update its folder under `.codex/context/tasks/<task-id>/`.
4. Create or select a task folder for the new direction and mark it `current`.
5. At turn end, if urgent or unrelated work completed and a parked task exists, ask briefly whether to resume it.
6. Keep the index dynamic rather than cumulative:
   - Keep the current task plus a small set of recent parked or resume-candidate tasks.
   - Move done or stale items to an archive section or `.codex/context/archive/` when they no longer need active attention.
   - Do not delete unresolved user intent; compress it into a concise archived summary instead.
7. Keep roadmap nodes concise. Each node should capture one meaningful step, decision, pivot, fork, or checkpoint, not every action.
   - Use `Level: major` only for large user-visible progress, route changes, architecture/product decisions, or completed milestones.
   - Use `Level: checkpoint` for small UI polish, validation, documentation, or implementation details that should not appear as main route cards.
8. Do not walk the same path twice: when a direction is rejected or superseded, record why so future Codex does not re-propose it without new evidence.
9. Link each roadmap node to related bad cases and test-chain notes when relevant.

Suggested task states: `current`, `parked`, `resume-candidate`, `done`, `archived`.

## Goal Mode

When the user starts or uses goal mode, treat the active goal as a long-running current task, not as a context exception.

1. If goal tools are available, call `get_goal` at goal-mode turn start or before a long autonomous continuation to learn the objective, status, and remaining budget.
2. Ensure `.codex/context/index.md` points to the task serving that goal. If no matching task exists, create or select one before implementation work continues.
3. Add a goal checkpoint whenever the goal changes phase, reaches a meaningful milestone, hits a blocker, changes technical route, finds/fixes a bad case, or consumes enough work that the next continuation would otherwise need to rediscover state.
4. Use `Level: checkpoint` for ordinary goal progress and `Level: major` only for a user-visible milestone, route change, completed goal phase, or final goal outcome.
5. Record bad cases as soon as they appear during goal work. Do not wait for the final answer or final `update_goal` call.
6. Before marking a goal complete or blocked with `update_goal`, run the Turn End context checkpoint: update index, roadmap, active task context, bad cases, and relevant guards first.
7. If the goal continues across automatic turns, keep checkpoint text short: current phase, decision, bad cases, verification, and next step.

## Route Map

The route map is the main route history of the task, plus any explicit forked or parallel routes. It should be fast for Codex to skim.

Each node should include:

- node ID, title, date, and status
- level: `major` for user-facing milestones, `checkpoint` for minor progress
- optional branch name and parent node when the route forks
- one-line outcome
- key decision or reason for the step
- next step
- links to task folder, linked bad cases, and relevant test-chain notes

Preferred source format is one `### NODE-YYYYMMDD-001: Title` section per node with bullet fields below it. If a legacy or interrupted session wrote loose bullet blocks with fields such as `ID`, `Title`, `Level`, and `Status`, the roadmap projector should still recognize those blocks instead of showing an empty roadmap; normalize them back to formal sections when editing the source file.

Support displaying the route map with `scripts/context_guard.py show-roadmap`, which reads `.codex/context/roadmap.md`, writes the human-facing HTML overview to the stable file `.codex/context/roadmap/roadmap.html`, writes human-facing details to `.codex/context/roadmap/roadmap-details.html`, updates the stable agent-readable Markdown copy at `.codex/context/roadmap/roadmap.md`, and prints the generated overview path and `file://` URL. Use `export-roadmap --format md` only when only the Markdown export is needed.

Do not create timestamped HTML roadmap exports for display. The roadmap folder should contain stable user-facing HTML files that get overwritten, plus stable agent-readable formats as needed.

### User-Facing Overview

`roadmap.html` is the user's quick overview. Keep it sparse:

- Show the roadmap tracks, concise node titles, status/date chips, and at most one short summary line.
- Show only `Level: major` nodes as main route cards; summarize hidden checkpoints compactly and put checkpoint details in `roadmap-details.html`.
- Number visible overview cards consecutively per route group after checkpoint filtering; keep source node IDs and source-order detail anchors hidden from the overview.
- When there is one route group, show the three lane titles once in a left-side label column. Do not repeat Main Route, Bad Cases, and Test Chain inside every node card.
- When there are multiple route groups, show all route lines together as a branch overview so users can see where each side route forked. Use route selection only to switch the compact bad-case/test-chain drilldown.
- Show parent/fork markers only for side routes whose parent node belongs to another route. Never show a fork marker on the Main route merely because a later main node references an earlier node.
- In branch overview, visually align each side route's starting position to the parent node's visible position on its parent route. Do not render every side route from the first column.
- Use a shared horizontal route canvas for branch overview. Represent route offsets with spacer columns inside the route grid, not by shifting or clipping the entire route section boundary.
- Prefer color, symbols, and compact visual markers over visible status/frequency/linkage words.
- Show meaningful tags as compact colored chips with small emoji cues when they help scanning, especially for bad cases; keep overview tags limited and put full tags in the detail page.
- Keep raw `#tag-slug` values only in source context. In user-facing HTML, remove `#`, avoid slug-like text, and localize tag labels to the selected/user language.
- Do not show full Outcome, Decision, Next, internal links, source paths, or long bad-case text on the overview.
- Do not show implementation chrome such as "human-facing view" labels or export/update timestamps in the overview header.
- Link each node, bad case, and test-chain item to `roadmap-details.html`.
- Put detailed fields in `roadmap-details.html`, not in the overview.
- Support language-aware projection in the stable HTML files, starting with Chinese and English. Keep one source context, localize user-facing record titles, summaries, bad cases, tags, and test-chain snippets to the configured folder language, and avoid visible language selector controls by default.
- When the folder language is Chinese, user-facing overview text should not fall back to untranslated English prose except for intentional technical names, commands, paths, APIs, and product names.

### User-Facing Labels

Keep stable IDs in source context files because Codex needs them for linking nodes, bad cases, and tests. Do not expose those IDs in the default user-facing HTML roadmap.

For `roadmap.html`, show concise natural-language labels:

- Show node titles without `NODE-...` prefixes.
- Show bad-case titles without `BC-...` prefixes.
- Do not show `CTX-...` task IDs by default.
- Summarize linked bad cases as short text or counts, then show the linked bad-case titles in the Bad Cases lane.
- Avoid visible metadata labels such as `Status:`, `Nodes:`, `Frequency:`, or fallback chips such as `untagged` in user-facing HTML; use color or small visual markers when the information is useful.
- Do not show fake tags. If an item has no tags, omit the tag row.
- Do not expose raw `#tag-slug` strings in default human-facing HTML; display localized human labels instead.
- Use emoji only as compact tag cues or explicit user-requested visual markers; do not turn the roadmap into decoration.
- Only expose internal IDs when the user explicitly asks for debug/source details.

### Source Of Truth

Do not use roadmap.html as a context source. The HTML file is only a human-facing view.

For Codex context intake, checkpointing, bad-case review, and task switching, read the source context files directly:

- `.codex/context/index.md`
- `.codex/context/roadmap.md`
- `.codex/context/bad-cases.md`
- `.codex/context/tasks/<task-id>/context.md`
- task-local bad-case files when present

Use `.codex/context/roadmap/roadmap.md` only as a stable agent-readable export for quick scanning or handoff. Update source files first; exports are projections.

### Roadmap Display Model

The HTML roadmap is a route-grouped board:

1. A roadmap may contain multiple route groups, using `Branch:` on nodes. Missing `Branch:` means `Main`.
2. Horizontal movement inside each route group follows that route's nodes over time.
3. If there is only one route group, each node column has three vertical lanes: Main Route, Bad Cases, and Test Chain.
4. If there are multiple route groups, the overview first shows all route lines as a branch map with parent/fork markers. Selecting a route changes only the bad-case and test-chain drilldown below the map.
5. Vertical movement within a selected route switches from route context to linked bad cases and verification chain.

Treat a single-route roadmap as three parallel horizontal lines, not a three-column dashboard. Treat multi-route roadmaps as route navigation first, with bad cases and tests scoped to the selected route. Use `Parent:` when a branch forks from an earlier node.

### Show Roadmap Request

When the user invokes `$context-guard` and asks to show, open, view, display, export, or 展示 the roadmap:

1. Do not merely explain the command.
2. Run `scripts/context_guard.py show-roadmap` from the current folder or the plugin/skill script path.
3. If an in-app browser or file-opening capability is available, open the generated `file://` URL.
4. Return a clickable link to the generated HTML file.
5. If the roadmap has no nodes yet, still show the generated empty roadmap and say no nodes are recorded yet.
6. Reuse the stable display file; do not generate a new timestamped HTML file for each view request.

## Context Evidence and Guards

The core artifact is context, not scripts. Record enough context that a future Codex can understand what happened, why it mattered, how it was resolved, and how to check it without rediscovering everything.

1. Prefer the existing `Guard / verification` note on the bad case: it may be a command, native test, manual check, screenshot comparison, log invariant, reproduction note, or script.
2. Reuse recorded commands, tests, and manual checks before inventing new checks.
3. Do not turn every bad case into a script. Create or update a durable script only when the check is repeatable, valuable, and cheaper than repeatedly reconstructing it.
4. If a script is justified and does not belong in the native test suite, place it under `.codex/context/bad-case-tests/`, for example `.codex/context/bad-case-tests/BC-YYYYMMDD-001.sh`.
5. Record why the chosen guard is enough. If the guard is manual-only, record the exact manual steps and why automation is not currently worth it.
6. Add tags and frequency notes for recurring bad cases, such as `#hot`, `#flaky`, `#ui`, `#data-loss`, or `#route-risk`, so Codex can quickly spot high-risk patterns.

Preferred bad-case source format is one `### BC-YYYYMMDD-001: Title` section per case with bullet fields below it. If a legacy or interrupted session wrote loose bullet blocks with fields such as `ID`, `Title`, `Status`, and `Nodes`, the roadmap projector should still recognize those blocks instead of showing "No linked bad cases"; normalize them back to formal sections when editing the source file.

Recording and display must stay connected. Every bad case that should appear on a roadmap must have either `Roadmap nodes:` / `Nodes:` pointing to one or more `NODE-...` IDs, or the roadmap node must list that case under `Linked bad cases:`. Do not rely on task-level proximity alone.

## What Counts As A Bad Case

A bad case is any observed or credible unwanted behavior from the task lifecycle: failing tests, broken UI states, regressions, race conditions, wrong output, data loss, misleading errors, performance cliffs, build failures, or user-reported defects.

A recurrence is the same bad case, or a materially equivalent symptom/root cause, appearing again after it was marked resolved.

Do not count it as a recurrence when an approved technical route change intentionally changes the behavior. In that case, update the bad case as `superseded-by-route-change`, document the decision, and add the new expected behavior plus any new guard needed.

## Required Workflow

### Turn Start: Context Intake

Run this before any substantive answer or action.

1. Ensure the folder-scoped context skeleton exists when this is the first task in a Codex folder.
2. Read `.codex/context/preferences.json`. If the record language is unset, ask the user to choose the context record language and store it before adding substantive context.
3. Decide whether the user's latest message continues the current task, starts a substantially different task, reports a bad case, or changes expected behavior.
4. Locate and read `.codex/context/index.md`, `.codex/context/roadmap.md`, `.codex/context/bad-cases.md`, and the relevant task folder if they exist.
5. If the request changes direction, park the previous task context before switching.
6. If the user reports a bad case, add or update the matching bad-case entry before fixing it.
7. Identify context entries relevant to the files, features, tests, or workflows likely to be touched.
8. Keep relevant context in mind while planning and editing.
9. Do not use the generated HTML roadmap as the context source.
10. In goal mode, call `get_goal` when available and align the active task with the goal objective before continuing work.
11. At the start of the user-visible answer, include a compact intake statement when useful: `Context intake: continuing <task>`, `Context intake: parked <task>, starting <task>`, `Bad-case intake: recorded BC-...`, or `Context intake: no active context`.

### During Work

Whenever design context appears, update the active task context enough that another turn can resume it without re-deriving it:

- objective or current idea
- key constraints and decisions
- rejected route only when it prevents backtracking
- open question or blocker
- touched areas only when useful to resume
- next step

Write these context updates in the configured record language from `.codex/context/preferences.json`. Keep literal technical strings unchanged.

Whenever a task makes meaningful progress, add or update one concise roadmap node. Link the node to bad cases and test-chain context when relevant.

During goal mode, do this during the work as soon as a goal checkpoint is reached. Do not defer roadmap and bad-case updates until the final response.

Whenever a bad case appears:

1. Add a new entry or update the matching existing entry.
2. Record the exact phenomenon, minimal trigger, affected scope, suspected or confirmed cause, current status, and evidence.
3. If fixed, record the solution and the verification command/manual check that proves the fix.
4. If not fixed, mark it `open` or `deferred` and explain why it cannot be completed in the current task.
5. Record the best available verification guard. Prefer existing project tests or clear manual checks; add a script only when it materially improves future reuse.

Use stable IDs such as `BC-YYYYMMDD-001` or the next local sequence already used by the register.

### Turn End: Context Checkpoint

Run this before every final answer.

1. Re-read the project context index and relevant task folder.
2. Re-read the route map and update it with a concise node if this turn changed direction, made a decision, fixed a problem, or created a new checkpoint.
3. Update the active task summary with key decisions, bad cases, open questions, and next step.
4. If the task direction changed this turn, ensure the previous task is parked and the new task is current.
5. Select every bad-case entry whose scope overlaps the changed code, plus any entry with a relevant recorded guard.
6. Re-run or re-perform the recorded guard for selected resolved entries. Use the existing context, command, native test, script, or manual check first.
7. If no recorded guard exists, choose the lightest useful verification and record it. Do not create a script unless it will clearly save future work.
8. If a resolved bad case recurs:
   - Mark it `recurred`.
   - Explain why it recurred: missed guard, incomplete fix, route conflict, test gap, refactor side effect, environment drift, or unknown.
   - Fix it immediately unless the user explicitly pauses the work or the recurrence is due to an approved technical route change.
   - Add or update the context and guard so the recurrence is easier to catch next time.
   - Re-run the verification and update the entry back to `resolved` only when evidence passes.
9. If a case is exempt because of a technical route change, mark it `superseded-by-route-change` and document the approved change.
10. If a bad case becomes frequent, add or update a high-frequency tag and warning note.
11. In goal mode, finish this checkpoint before calling `update_goal` to mark the goal complete or blocked.
12. If urgent or unrelated work is complete and a parked task exists, ask the user whether to resume the most relevant parked task.

## Completion Report

At the end of every response, include a compact context summary when development work, context intake, task switching, bad-case intake, or a register was involved. Keep it one line for unrelated conversation.

- Context folder used.
- Current task index status.
- Roadmap node updated, exported, or displayed.
- Bad-case intake result from this turn.
- New or updated context, limited to key nodes and bad cases.
- Previously resolved cases rechecked, including reused context, tests, commands, scripts, or manual checks.
- Any parked task that should be offered for resume.

If no context exists and no context-worthy event happened, say that the context gate was not applicable.
