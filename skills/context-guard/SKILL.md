---
name: context-guard
description: "Maintain and enforce a folder-scoped project context folder, route-map index, dynamic task queue, and bad-case/test-chain memory. Use at the beginning and end of every assistant response, especially when a Codex folder is first used, the user changes task direction, parks a design discussion for an urgent bug, resumes prior work, or performs coding/debugging/review/QA: load folder context, update concise route nodes, link nodes to bad cases and tests, and ask whether to resume parked work when appropriate."
---

# Context Guard

## Purpose

Maintain durable folder-scoped context across threads and interruptions. Preserve the task route map, park active design threads when urgent work interrupts, resume them when appropriate, and prevent solved bad cases from silently returning.

## Context Folder

Maintain a folder-local context folder so task context, route nodes, bad-case memory, and reusable guards travel with the Codex folder. This context belongs to the folder, not to a single thread.

1. Prefer the canonical context root: `.codex/context/`.
2. Create the context root the first time Codex works in a folder.
3. Maintain the quick-browse index at `.codex/context/index.md`.
4. Maintain the main route map at `.codex/context/roadmap.md`.
5. Store task-specific context under `.codex/context/tasks/<task-id>/`.
6. Store shared bad-case and test-chain context at `.codex/context/bad-cases.md` unless a bad case belongs only inside one task folder.
7. If no canonical context exists, read legacy bad-case locations if present: `.codex/bad-cases.md`, `BAD_CASES.md`, `docs/bad-cases.md`, or `.agents/bad-cases.md`.
8. If legacy context exists and the task modifies context, migrate or copy it into `.codex/context/` unless the repository clearly standardizes on the legacy path.
9. Use `references/context-template.md` for index, roadmap, and task-folder formats.
10. Use `references/register-template.md` when creating or updating bad-case entries.

Do not store project context inside the skill directory. Do not create a separate top-level bad-case folder; bad cases are part of `context`.

## Dynamic Task Index

Use `.codex/context/index.md` as a small, actively maintained queue of work context and `.codex/context/roadmap.md` as the mainline route map.

1. At turn start, compare the user's latest request with the current index entry.
2. If the request continues the same direction, update that task folder.
3. If the request is a sharp direction change, urgent bug, or unrelated event, park the current task before switching:
   - Summarize the current idea, decisions, open questions, files, constraints, and next step.
   - Mark it `parked` or `resume-candidate`.
   - Create or update its folder under `.codex/context/tasks/<task-id>/`.
4. Create or select a task folder for the new direction and mark it `current`.
5. At turn end, if urgent or unrelated work completed and a parked task exists, ask briefly whether to resume it.
6. Keep the index dynamic rather than cumulative:
   - Keep the current task plus a small set of recent parked or resume-candidate tasks.
   - Move done or stale items to an archive section or `.codex/context/archive/` when they no longer need active attention.
   - Do not delete unresolved user intent; compress it into a concise archived summary instead.
7. Keep roadmap nodes concise. Each node should capture one meaningful step, decision, pivot, or checkpoint.
8. Do not walk the same path twice: when a direction is rejected or superseded, record why so future Codex does not re-propose it without new evidence.
9. Link each roadmap node to related bad cases and test-chain notes when relevant.

Suggested task states: `current`, `parked`, `resume-candidate`, `done`, `archived`.

## Route Map

The route map is the mainline history of the task. It should be fast for Codex to skim.

Each node should include:

- node ID, title, date, and status
- one-line outcome
- key decision or reason for the step
- next step
- links to task folder, linked bad cases, and relevant test-chain notes

Support exporting the route map with `scripts/context_guard.py export-roadmap`, which reads `.codex/context/roadmap.md` and writes a clean Markdown roadmap under `.codex/context/exports/`.

## Context Evidence and Guards

The core artifact is context, not scripts. Record enough context that a future Codex can understand what happened, why it mattered, how it was resolved, and how to check it without rediscovering everything.

1. Prefer the existing `Guard / verification` note on the bad case: it may be a command, native test, manual check, screenshot comparison, log invariant, reproduction note, or script.
2. Reuse recorded commands, tests, and manual checks before inventing new checks.
3. Do not turn every bad case into a script. Create or update a durable script only when the check is repeatable, valuable, and cheaper than repeatedly reconstructing it.
4. If a script is justified and does not belong in the native test suite, place it under `.codex/context/bad-case-tests/`, for example `.codex/context/bad-case-tests/BC-YYYYMMDD-001.sh`.
5. Record why the chosen guard is enough. If the guard is manual-only, record the exact manual steps and why automation is not currently worth it.
6. Add tags and frequency notes for recurring bad cases, such as `#hot`, `#flaky`, `#ui`, `#data-loss`, or `#route-risk`, so Codex can quickly spot high-risk patterns.

## What Counts As A Bad Case

A bad case is any observed or credible unwanted behavior from the task lifecycle: failing tests, broken UI states, regressions, race conditions, wrong output, data loss, misleading errors, performance cliffs, build failures, or user-reported defects.

A recurrence is the same bad case, or a materially equivalent symptom/root cause, appearing again after it was marked resolved.

Do not count it as a recurrence when an approved technical route change intentionally changes the behavior. In that case, update the bad case as `superseded-by-route-change`, document the decision, and add the new expected behavior plus any new guard needed.

## Required Workflow

### Turn Start: Context Intake

Run this before any substantive answer or action.

1. Ensure the folder-scoped context skeleton exists when this is the first task in a Codex folder.
2. Decide whether the user's latest message continues the current task, starts a substantially different task, reports a bad case, or changes expected behavior.
3. Locate and read `.codex/context/index.md`, `.codex/context/roadmap.md`, and the relevant task folder if they exist.
4. If the request changes direction, park the previous task context before switching.
5. If the user reports a bad case, add or update the matching bad-case entry before fixing it.
6. Identify context entries relevant to the files, features, tests, or workflows likely to be touched.
7. Keep relevant context in mind while planning and editing.
8. At the start of the user-visible answer, include a compact intake statement when useful: `Context intake: continuing <task>`, `Context intake: parked <task>, starting <task>`, `Bad-case intake: recorded BC-...`, or `Context intake: no active context`.

### During Work

Whenever design context appears, update the active task context enough that another turn can resume it without re-deriving it:

- current idea or objective
- important constraints
- decisions made and rejected
- open questions
- files or commands touched
- next step

Whenever a task makes meaningful progress, add or update one concise roadmap node. Link the node to bad cases and test-chain context when relevant.

Whenever a bad case appears:

1. Add a new entry or update the matching existing entry.
2. Record the exact phenomenon, reproduction steps or trigger, affected scope, suspected or confirmed cause, current status, and evidence.
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
11. If urgent or unrelated work is complete and a parked task exists, ask the user whether to resume the most relevant parked task.

## Completion Report

At the end of every response, include a compact context summary when development work, context intake, task switching, bad-case intake, or a register was involved. Keep it one line for unrelated conversation.

- Context folder used.
- Current task index status.
- Roadmap node updated or exported.
- Bad-case intake result from this turn.
- New or updated context.
- Previously resolved cases rechecked, including reused context, tests, commands, scripts, or manual checks.
- Any parked task that should be offered for resume.

If no context exists and no context-worthy event happened, say that the context gate was not applicable.
