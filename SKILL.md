---
name: context-guard
description: "Maintain and enforce a project context folder for bad-case regression memory. Use at the beginning and end of every assistant response, especially for coding, debugging, implementation, refactoring, review, QA, and verification tasks: at the beginning, detect whether the user reports a bad case and load relevant existing context; at the end, decide whether regression checks are needed, reuse recorded context and guards, avoid inventing duplicate tests, analyze recurrences, and immediately fix regressions unless an approved technical route change explains them."
---

# Context Guard

## Purpose

Prevent solved bad cases from silently returning. Treat every bad case as durable project context: record the phenomenon, fix status, fix method, verification method, and any later recurrence analysis.

## Context Folder

Maintain a project-local context folder so bad-case memory and reusable guards travel with the codebase.

1. Prefer the canonical context register: `.codex/context/bad-cases.md`.
2. If no canonical register exists, read legacy locations if present: `.codex/bad-cases.md`, `BAD_CASES.md`, `docs/bad-cases.md`, or `.agents/bad-cases.md`.
3. If a legacy register exists and the task modifies bad-case context, migrate or copy its contents into `.codex/context/bad-cases.md` unless the repository clearly standardizes on the legacy path.
4. If no register exists and a bad case is discovered, create `.codex/context/bad-cases.md` at the repository root. If there is no Git repository, create `.codex/context/bad-cases.md` in the current working directory.
5. Use the format in `references/register-template.md` when creating or updating the register.

Do not store project bad cases inside the skill directory. Do not create a top-level "bad case folder"; the durable project folder is `context`.

## Context Evidence and Guards

The core artifact is context, not scripts. Record enough context that a future Codex can understand what happened, why it mattered, how it was resolved, and how to check it without rediscovering everything.

1. Prefer the existing `Guard / verification` note on the bad case: it may be a command, native test, manual check, screenshot comparison, log invariant, reproduction note, or script.
2. Reuse recorded commands, tests, and manual checks before inventing new checks.
3. Do not turn every bad case into a script. Create or update a durable script only when the check is repeatable, valuable, and cheaper than repeatedly reconstructing it.
4. If a script is justified and does not belong in the native test suite, place it under `.codex/context/bad-case-tests/`, for example `.codex/context/bad-case-tests/BC-YYYYMMDD-001.sh`.
5. Record why the chosen guard is enough. If the guard is manual-only, record the exact manual steps and why automation is not currently worth it.

## What Counts

A bad case is any observed or credible unwanted behavior from the task lifecycle: failing tests, broken UI states, regressions, race conditions, wrong output, data loss, misleading errors, performance cliffs, build failures, or user-reported defects.

A recurrence is the same bad case, or a materially equivalent symptom/root cause, appearing again after it was marked resolved.

Do not count it as a recurrence when an approved technical route change intentionally changes the behavior. In that case, update the bad case as `superseded-by-route-change`, document the decision, and add the new expected behavior plus any new guard needed.

## Required Workflow

### Turn Start: Bad Case Intake

Run this before any substantive answer or action. For non-development conversation, keep the intake brief and do not create a register unless the user reports a bad case.

1. Decide whether the user's latest message reports a bad case, reveals a bad case, or changes expected behavior for an existing bad case.
2. Locate and read the project context register if it exists.
3. If the user reports a bad case, add or update the matching entry before fixing it.
4. Identify entries relevant to the files, features, tests, or workflows likely to be touched.
5. Keep those entries in mind as non-regression constraints while planning and editing.
6. At the start of the user-visible answer, include a compact intake statement when useful: `Bad-case intake: none reported`, `Bad-case intake: recorded BC-...`, or `Bad-case intake: route change affects BC-...`.

### During Work

Whenever a bad case appears:

1. Add a new entry or update the matching existing entry.
2. Record the exact phenomenon, reproduction steps or trigger, affected scope, suspected or confirmed cause, current status, and evidence.
3. If fixed, record the solution and the verification command/manual check that proves the fix.
4. If not fixed, mark it `open` or `deferred` and explain why it cannot be completed in the current task.
5. Record the best available verification guard. Prefer existing project tests or clear manual checks; add a script only when it materially improves future reuse.

Use stable IDs such as `BC-YYYYMMDD-001` or the next local sequence already used by the register.

### Turn End: Regression Gate

Run this before every final answer. If no development work happened and no bad-case register is relevant, explicitly treat the gate as not applicable. If development work happened, or a relevant register exists, run the regression gate.

1. Re-read the project context register.
2. Select every entry whose scope overlaps the changed code, plus any entry with a relevant recorded guard.
3. Re-run or re-perform the recorded guard for selected resolved entries. Use the existing context, command, native test, script, or manual check first.
4. If no recorded guard exists, choose the lightest useful verification and record it. Do not create a script unless it will clearly save future work.
5. If the guard is manual-only, perform the recorded manual verification when feasible and explain any limitation in the register.
6. If a resolved bad case recurs:
   - Mark it `recurred`.
   - Explain why it recurred: missed guard, incomplete fix, route conflict, test gap, refactor side effect, environment drift, or unknown.
   - Fix it immediately unless the user explicitly pauses the work or the recurrence is due to an approved technical route change.
   - Add or update the context and guard so the recurrence is easier to catch next time.
   - Re-run the verification and update the entry back to `resolved` only when evidence passes.
7. If a case is exempt because of a technical route change, mark it `superseded-by-route-change` and document the approved change.

## Completion Report

At the end of every response, include a compact bad-case summary when development work, bad-case intake, or a register was involved. Keep it one line for non-development responses.

- Register path used.
- Context folder used.
- Bad-case intake result from this turn.
- New or updated bad cases.
- Previously resolved cases rechecked, including reused context, tests, commands, scripts, or manual checks.
- Any recurrence found and fixed.
- Any route-change supersession.

If no register exists and no bad cases were found, say that explicitly.
