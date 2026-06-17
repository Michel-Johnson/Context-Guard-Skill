---
name: context-guard
description: "Maintain and enforce a project context folder for bad-case regression memory. Use at the beginning and end of every assistant response, especially for coding, debugging, implementation, refactoring, review, QA, and verification tasks: at the beginning, detect whether the user reports a bad case and load relevant existing context; at the end, decide whether regression guards must run, re-run recorded guards for relevant resolved bad cases, prefer reusable scripts/commands over inventing new tests, analyze recurrences, and immediately fix regressions unless an approved technical route change explains them."
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

## Reusable Test Assets

Use project-local reusable guards instead of recreating one-off tests.

1. Prefer the `Guard / verification` command already recorded on the bad case.
2. If a recorded script exists, run it exactly as recorded before considering any new test.
3. If a bad case can be checked by a script and no durable guard exists, create one reusable project-local guard under `.codex/context/bad-case-tests/`, for example `.codex/context/bad-case-tests/BC-YYYYMMDD-001.sh` or `.codex/context/bad-case-tests/BC-YYYYMMDD-001.test.ts`.
4. Record the script path and command in the bad-case register.
5. Reuse or update an existing guard when behavior changes. Do not create a new script for the same bad case unless the old guard is obsolete and the register explains why.
6. If the project already has a native test suite, prefer adding a stable regression test there and record that command instead of creating a separate script.

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
5. If the bad case can be checked automatically, create or update a reusable guard once and record the command. Avoid repeated ad hoc test-script generation.

Use stable IDs such as `BC-YYYYMMDD-001` or the next local sequence already used by the register.

### Turn End: Regression Gate

Run this before every final answer. If no development work happened and no bad-case register is relevant, explicitly treat the gate as not applicable. If development work happened, or a relevant register exists, run the regression gate.

1. Re-read the project context register.
2. Select every entry whose scope overlaps the changed code, plus any entry with a direct regression test, recorded script, or cheap verification command.
3. Re-run the recorded guard for selected resolved entries. Use the existing recorded script or command first.
4. If no recorded guard exists but an automated check is practical, create one durable guard under `.codex/context/bad-case-tests/` or the native test suite, record it, then run it.
5. If no automated check is practical, perform the recorded manual verification and explain the limitation in the register.
6. If a resolved bad case recurs:
   - Mark it `recurred`.
   - Explain why it recurred: missed guard, incomplete fix, route conflict, test gap, refactor side effect, environment drift, or unknown.
   - Fix it immediately unless the user explicitly pauses the work or the recurrence is due to an approved technical route change.
   - Add or update an automated guard when practical.
   - Re-run the verification and update the entry back to `resolved` only when evidence passes.
7. If a case is exempt because of a technical route change, mark it `superseded-by-route-change` and document the approved change.

## Completion Report

At the end of every response, include a compact bad-case summary when development work, bad-case intake, or a register was involved. Keep it one line for non-development responses.

- Register path used.
- Context folder used.
- Bad-case intake result from this turn.
- New or updated bad cases.
- Previously resolved cases rechecked, including reused script/command names.
- Any recurrence found and fixed.
- Any route-change supersession.

If no register exists and no bad cases were found, say that explicitly.
