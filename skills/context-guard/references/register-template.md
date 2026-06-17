# Bad Case Register Template

Use this format for `.codex/context/bad-cases.md`, task-local `.codex/context/tasks/<task-id>/bad-cases.md`, or the existing project context register.

```md
# Bad Case Register

This register tracks bad cases found during development and the guards that prevent them from recurring.

## Active Cases

### BC-YYYYMMDD-001: Short descriptive title

- Status: open | resolved | recurred | deferred | superseded-by-route-change
- First observed: YYYY-MM-DD
- Last checked: YYYY-MM-DD
- Scope: feature, files, tests, route, UI flow, API, or subsystem
- Context task: `CTX-...` folder or shared
- Phenomenon: what went wrong, including exact user-visible behavior or failing output
- Trigger / reproduction: commands, steps, inputs, environment, or preconditions
- Root cause: confirmed cause, suspected cause, or unknown
- Fix method: code/test/config/documentation change that fixed it
- Guard / verification: native test, command, reusable script, manual check, screenshot, log, invariant, or reproduction note
- Reusable guard path: project test file, `.codex/context/bad-case-tests/...`, or none
- Guard reuse rule: reuse this recorded guard before creating any new test or script for this case
- Recurrence analysis: why it came back, if it ever did
- Route-change note: only when an approved technical route change intentionally changes expected behavior
- Evidence: links to tests, commands run, PRs, commits, screenshots, or logs

## Resolved History

Move old resolved entries here only if the active section becomes noisy. Keep enough detail to replay the guard.
```

## Status Rules

- `open`: bad case is known and not fixed.
- `resolved`: fix is implemented and verification passed.
- `recurred`: bad case came back after resolution; must be analyzed and fixed before completion.
- `deferred`: intentionally not fixed in the current task; requires reason and owner/next step.
- `superseded-by-route-change`: old behavior is no longer expected because an approved technical route changed it.

## Context Guard Rules

- Use `.codex/context/` as the project folder for bad-case memory. Do not introduce a separate bad-case folder for new projects.
- Prefer existing recorded context, commands, tests, screenshots, logs, or manual checks over newly invented tests.
- Do not script every bad case. Store bad-case-specific scripts under `.codex/context/bad-case-tests/` only when they are genuinely reusable and do not belong in the native test suite.
- Name any guard script with the bad case ID so it is easy to find and reuse.
- Update existing context when expected behavior changes; do not create parallel guards for the same case unless the old one is explicitly obsolete.
- If a guard is manual-only, list the exact manual check and why that is acceptable for now.
