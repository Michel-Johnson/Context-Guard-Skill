# Bad Case Register Template

Use this format for `.codex/context/bad-cases.md`, task-local `.codex/context/tasks/<task-id>/bad-cases.md`, or the existing project context register.

```md
# Bad Case Register

This register tracks bad cases found during development and the guards that prevent them from recurring.

Record only bad cases that are user-visible, recurring, risky, fixed, deferred, or needed to explain a guard. Do not turn the register into a defect diary.

## Active Cases

### BC-YYYYMMDD-001: Short descriptive title

- Status: open | resolved | recurred | deferred | superseded-by-route-change
- First observed: YYYY-MM-DD
- Last checked: YYYY-MM-DD
- Scope: feature, files, tests, route, UI flow, API, or subsystem
- Context task: `CTX-...` folder or shared
- Roadmap nodes: `NODE-...`
- Tags: #hot | #flaky | #ui | #data-loss | #route-risk | custom tags
- Frequency: first-seen | repeated-N | high-frequency
- Phenomenon: one-line user-visible behavior or failing output
- Trigger / reproduction: shortest command, step, input, environment, or precondition
- Root cause: confirmed cause, suspected cause, or unknown, one line
- Fix method: code/test/config/documentation change that fixed it, one line
- Guard type: script | native-test | manual | browser-screenshot | browser-dom | curl | cli | prompt | log-invariant | fixture | unit | integration | e2e | custom
- Guard / verification: native test, command, reusable script, manual check, screenshot, log, invariant, or reproduction note, one line
- Run policy: every-dev-completion | relevant-only | manual | release-only | goal-final | disabled-with-reason | user-defined cadence
- Red condition: exact output, visual state, assertion, or symptom that means this bad case has recurred
- Green condition: exact evidence that means this bad case is absent
- Expected failure reason: why the guard should fail for the old symptom, not for a broken test or unrelated environment issue
- Reusable guard path: project test file, `.codex/context/task-cases/...#phase-name`, `.codex/context/bad-case-tests/...`, or none
- Covered by task case: TC-YYYYMMDD-short-slug phase/checkpoint, or none
- Test-chain issue: false-positive | false-negative | wrong-granularity | missing-phase | wrong-assertion | unrealistic-setup | missing-cleanup | unclear-localization | none
- Guard reuse rule: reuse this recorded guard before creating any new test or script for this case
- Test chain: ordered checks only when multiple checks are genuinely needed
- High-frequency note: warning text to show Codex when this pattern repeats often
- Recurrence analysis: why it came back, if it ever did
- Route-change note: only when an approved technical route change intentionally changes expected behavior
- Evidence: links to tests, commands run, PRs, commits, screenshots, or logs

## Resolved History

Move old resolved entries here only if the active section becomes noisy. Keep enough detail to replay the guard.
```

Use the `### BC-...` section form as the canonical editable source. If a session accidentally records loose bullet blocks such as `- ID: BC-...`, `- Title: ...`, `- Status: ...`, or `- Nodes: ...`, the renderer should still project them, but future edits should normalize them back into formal case sections.

## Status Rules

- `open`: bad case is known and not fixed.
- `resolved`: fix is implemented and verification passed.
- `recurred`: bad case came back after resolution; must be analyzed and fixed before completion.
- `deferred`: intentionally not fixed in the current task; requires reason and owner/next step.
- `superseded-by-route-change`: old behavior is no longer expected because an approved technical route changed it.

## Context Guard Rules

- Use `.codex/context/` as the project folder for bad-case memory. Do not introduce a separate bad-case folder for new projects.
- Use the configured `.codex/context/preferences.json` `record_language` for bad-case titles, phenomenon, root cause, fix method, guard summaries, and test-chain notes.
- Preserve exact commands, paths, code identifiers, logs, API names, and error messages in their original language.
- Prefer existing recorded context, user-approved commands, native tests, screenshots, logs, or manual checks over newly invented tests.
- When the user creates or approves a test, default its `Run policy` to `every-dev-completion`; Codex must run it at every development completion unless the user sets another cadence.
- Only the user can demote an approved test to `relevant-only`, `manual`, `release-only`, `goal-final`, `disabled-with-reason`, or a custom cadence. Record why.
- For resolved or recurred cases, `Guard / verification`, `Guard type`, `Red condition`, `Green condition`, and `Expected failure reason` are required.
- The guard must be red-capable: it should fail if the same user-visible symptom returns.
- When the bad case is part of a longer workflow, attach it to a human-approved task-case checkpoint instead of creating a separate isolated script. The bad-case entry should say which task case phase covers it.
- If the test chain itself is wrong, record that as a bad case and classify the test-chain issue. Fix the test-chain design before trusting its result.
- Do not script every bad case. Store bad-case-specific scripts under `.codex/context/bad-case-tests/` only when the user approved the test design, the script is genuinely reusable, and it does not belong in the native test suite.
- Name any guard script with the bad case ID so it is easy to find and reuse.
- Update existing context when expected behavior changes; do not create parallel guards for the same case unless the old one is explicitly obsolete.
- If a guard is manual-only, list the exact manual check and why that is acceptable for now.
- Link bad cases to roadmap nodes so Codex can quickly see which mainline decisions created or fixed them.
- Keep record/display linkage explicit: use `Roadmap nodes:` or `Nodes:` on the bad case, or `Linked bad cases:` on the roadmap node.
- Add tags and frequency notes when a bad case repeats often; high-frequency cases should stand out during quick scanning.
- Promote high-frequency cases into fixed pressure checks and rerun them whenever related code, UI, context, or hooks change.
- Keep entries compact. If the same information appears in a roadmap node, link to it instead of duplicating it.
