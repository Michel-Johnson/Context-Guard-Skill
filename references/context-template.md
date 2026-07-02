# Context Folder Template

Use this structure for project context:

```text
<opened Codex project root>/
.codex/context/
├── index.md
├── roadmap.md
├── bad-cases.md
├── preferences.json
├── roadmap/
│   ├── roadmap.html
│   ├── roadmap-details.html
│   ├── roadmap.md
│   └── roadmap.json
├── tasks/
│   └── CTX-YYYYMMDD-short-slug/
│       ├── context.md
│       └── bad-cases.md
├── task-cases/
├── test-hub/
│   ├── registry.json
│   ├── last-run.json
│   └── runs/
├── bad-case-tests/
└── archive/
```

The opened Codex project root is the local folder selected in Codex or the local workspace root for the current thread. Do not place this folder inside a skill installation directory, remote SSH path, chat/thread-specific folder, or temporary execution directory unless the user explicitly asks that location to own its own context.

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
- Display title: short human-facing card title; use clear language close to what the user cares about
- User request: concise summary of the user's actual request, using the user's wording as much as possible
- Progress summary: short human-facing current progress; omit if Outcome already reads naturally
- Method summary: short human-facing method; omit if Decision / reason already reads naturally
- Outcome: one-line result
- Decision / reason: why this node exists, one line
- Avoid going back: rejected path or lesson, only if it prevents backtracking
- Next: next useful node or action
- Linked bad cases: BC-YYYYMMDD-001, BC-YYYYMMDD-002
- Test chain: compact checkpoint evidence only; user-facing recurrence checks come from linked bad-case guards
- End-of-work self-check: changed behavior checked; for frontend/layout work include browser/plugin/screenshot evidence or the exact blocker
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

## Verification / Self-Check

- Behavior checked before final answer.
- Frontend/layout artifacts opened with a browser/plugin or inspected via screenshot when possible.
- If visual inspection was blocked, record the blocker and residual risk.

## Next Step

The smallest useful action to resume this task.
```

## task-cases/<task-case-id>.md

Use task cases for realistic multi-step verification flows. They should catch bugs by simulating a real task, not by testing one isolated bug at a time. Task-case design is human-owned: Codex may draft and structure a proposal, but durable task cases must stay `proposed` until the user confirms them.

```md
# Task Case: short realistic workflow title

- ID: TC-YYYYMMDD-short-slug
- Status: proposed | approved | active | stable | deferred | obsolete
- Route/task: `CTX-...` or branch name
- Scope: feature, service, UI flow, agent workflow, or subsystem
- Last checked: YYYY-MM-DD
- Design confirmation: pending | user-approved YYYY-MM-DD
- Run policy: every-dev-completion | relevant-only | manual | release-only | goal-final | disabled-with-reason | user-defined cadence
- Automation entry: native command | script path | prompt/manual runner | none
- Artifact policy: cleanup-on-pass | preserve-on-fail | manual-preserve
- Linked roadmap nodes: NODE-...
- Linked bad cases: BC-..., BC-...
- Entry command/prompt: command, prompt, manual setup, or fixture
- Not covered: explicit exclusions to avoid fake confidence
- Stop condition: what means the workflow is complete
- Cleanup: required cleanup or none

## Phases

### Phase 1: setup or trigger

- Action: one realistic action
- Expected checkpoint: invariant, log, UI state, file state, API result, or assertion
- Covers bad cases: BC-...
- Failure localization: what this phase failure usually means
- Log note: what the script/agent should record

### Phase 2: transition or recovery

- Action: one realistic action
- Expected checkpoint: invariant, log, UI state, file state, API result, or assertion
- Covers bad cases: BC-...
- Failure localization: what this phase failure usually means
- Log note: what the script/agent should record

## Result Log

- YYYY-MM-DD: pass/fail, failed phase/checkpoint if any, evidence path or command output summary
```

## Maintenance Rules

- Keep `index.md` small and useful, not exhaustive.
- Keep `roadmap.md` as the route map. It should show progress as nodes, not a raw transcript.
- Use `Level: major` for significant milestones shown as main route cards; use `Level: checkpoint` for minor progress that should live in details.
- Use `Branch:` for forked or parallel routes. Missing `Branch:` means `Main`; use `Parent:` to point to the node where a branch forked.
- In the human overview, visible card numbers should be consecutive per route group after checkpoint filtering, not source node numbers with gaps.
- If the human overview has multiple route groups, show all route lines together with parent/fork markers and a compact test route aligned under visible roadmap nodes.
- Each node should be concise enough for Codex to scan quickly: outcome, decision, next step, linked bad cases.
- Link nodes to bad cases and test-chain notes instead of duplicating full details.
- Treat human-facing test coverage as human-designed bad-case recurrence detection. Single-route overview hides the test lane; multi-route compact test routes should be generated only from user-approved tests with explicit `Run policy`, approved task-case checkpoints, or approved test registry entries, not from ordinary linked bad-case guards or roadmap node checkpoint logs.
- In branch or multi-route views, align each visible test item to the roadmap node whose approved bad-case test or approved task-case checkpoint it covers. If a route has no approved tests, do not show a test route for it. Empty test slots should be subtle timeline placeholders only when the route has at least one approved test elsewhere.
- Prefer a task-oriented case in `.codex/context/task-cases/` when realistic workflow phases matter more than isolated bug checks. Bad-case guards should often point to a task-case checkpoint that covers them.
- Task-case scripts or agents should log the phase/checkpoint that failed, so Codex can locate the broken workflow step without re-debugging the whole task.
- Before writing any new durable task-case script or active task case, ask the user to confirm with only the business path: from what state to what state, the main task, and the major risk. Keep technical phases/checkpoints/logs inside the task-case file, not in the confirmation prompt. If confirmation is unavailable, keep the case `proposed` and avoid broad new scripts.
- When the user explicitly asks to create, write, generate, design, or add a test/test task/task case, start the user-visible response with `测试创建识别：...` or the folder-language equivalent, then summarize the test target from what state to what state and the main risk it catches.
- When the user creates or approves a test, register it with `Run policy: every-dev-completion` by default. At the end of every development turn, run all approved tests with that policy or record the exact blocker.
- Use `.codex/context/test-hub/registry.json` as the explicit Test Hub registry for user-approved automated tests. Do not populate it from ordinary bad-case guards or roadmap node `Test chain:` notes.
- Keep Test Hub as a simple control layer: registry, `dev-complete`, `last-run.json`, and lightweight commands to list, enable, disable, change policy, or remove registry tests.
- At development completion, prefer `context_guard.py dev-complete --root <project>` so the hub runs the approved always-run set, handles parallel workers when safe, cleans success artifacts, and preserves failure evidence under `.codex/context/test-hub/runs/`.
- After approval, automate a test when it can be safely scripted or run as a native command. Future Codex turns should execute the registered entry with minimal reinterpretation.
- Automated tests should clean temporary files after full success and preserve concise diagnostic artifacts on failure.
- Failed approved tests become a bad-case analysis loop: inspect the preserved evidence, fix the in-scope cause, rerun the same approved test, and stop only after pass or a non-actionable blocker.
- If blocked by credentials, unavailable external service, permissions, hardware/resource limits, network, destructive-risk confirmation, or user-only judgment, ask or warn the user with the exact blocker and evidence path.
- Change a test to `relevant-only`, `manual`, `release-only`, `goal-final`, `disabled-with-reason`, or another cadence only when the user explicitly asks. Record the user's reason beside the policy.
- During goal mode, task cases should act as phase gates: select an approved case or propose one for confirmation, log phase progress during continuations, and run the smallest human-approved path before claiming the goal complete.
- Keep multilingual display as an HTML projection concern; do not duplicate source context by language. When supported, localize human-facing record titles, summaries, bad-case labels, and test-chain snippets in the projection.
- Keep source records in the configured `.codex/context/preferences.json` record language. The HTML roadmap should follow that preference and should not show a visible language selector by default.
- During goal mode or long-running autonomous work, keep the active goal aligned to the current task, add compact goal checkpoints during meaningful phase changes, and record bad cases as soon as they appear.
- Treat `.codex/context/index.md`, `.codex/context/roadmap.md`, `.codex/context/bad-cases.md`, and task context files as the source of truth.
- Treat `.codex/context/roadmap/roadmap.html` as a human-facing view only. Codex should not use it for context intake or bad-case management.
- Treat `.codex/context/roadmap/roadmap.md` and `.codex/context/roadmap/roadmap.json` as stable agent-readable exports for quick scanning, route lookup, bad-case lookup, and recurrence-guard lookup, not as primary editable sources.
- Keep `NODE-...`, `BC-...`, and `CTX-...` IDs in source files for linking, but hide them in the default human-facing HTML. Show short natural-language node and bad-case labels instead.
- In human-facing HTML, prefer color, symbols, and compact visual markers over labels like `Status:`, `Nodes:`, `Frequency:`, or fallback text such as `untagged`.
- Show meaningful `#tags` as compact colored chips with small emoji cues in human-facing HTML. Limit overview tags; show full tags on the detail page; omit the tag row when no tags exist.
- A sharp task direction change should park the current task before starting a new one.
- If the user explicitly says a task is a branch/side route/fork/支线/分支, run or emulate `scripts/context_guard.py create-branch-task --title <task title> --branch <branch name> --parent-node <parent NODE id>` before implementation so the task folder, current index entry, and `Branch:`/`Parent:` roadmap node all exist.
- If work significantly drifts from the mainline architecture without an explicit branch request, ask whether to create a branch before silently continuing.
- When an interruption finishes, ask whether to resume the most relevant parked task.
- Do not let parked items grow endlessly. Mark stale items `archived` and compress them to a short summary.
- Do not delete unresolved user intent unless the user explicitly discards it.
- Use `scripts/context_guard.py show-roadmap` to generate and display the stable human-friendly overview at `.codex/context/roadmap/roadmap.html`, with details at `.codex/context/roadmap/roadmap-details.html`, agent-readable Markdown at `.codex/context/roadmap/roadmap.md`, and structured lookup at `.codex/context/roadmap/roadmap.json`. Use `export-roadmap --format md` only for Markdown-only export.
- Do not accumulate timestamped HTML roadmap files. Showing the roadmap overwrites the same stable HTML files.
- With one route group, the HTML roadmap overview should show only the main route cards. Keep linked bad cases and recurrence checks in clicked node details, source context, and agent-readable exports.
- In one-route HTML, do not render bad-case/test-chain lanes or a left lane-label column. The route board should size to real content, and main route summaries should remain readable rather than being clipped after a very short fragment.
- With multiple route groups, the overview should show all route lines as a branch map. If a route has user-approved tests, also show a compact node-aligned test route under that route line. Route selection may affect details, but the default view should not invent tests from ordinary bad-case context.
- Parent/fork markers should appear only on side routes whose parent node is outside that route. Main route should not show a fork marker just because a later main node references an earlier main node.
- Side routes should visually start near their parent node's visible position on the parent route, not all from the first column.
- Branch route labels, parent chips, and checkpoint text should sit near the branch's first visible card by reusing the same spacer/grid coordinate as the branch cards.
- Branch overview should use one shared horizontal route canvas. Route alignment should use grid spacer columns, not padding that shifts or clips the whole route section.
- Branch connector lines should use the same offset coordinate as the route's spacer columns, not a fixed left-edge position.
- Branch connector endpoints should be anchored to the status dots inside the source and target node cards; do not draw connector lines from the whole route section or unrelated card edges.
- Route progression connectors should be card-to-card through card gaps; branch connectors should be dot-to-dot through an empty branch corridor and must not cross node cards or text.
- Side routes may drift right from exact column alignment when that creates a cleaner non-crossing branch path.
- Connector layers should render behind route cards so cards mask any line segment that would otherwise pass over content.
- Hide heavy native horizontal scrollbar chrome in the roadmap overview while preserving horizontal scroll interaction.
- Human-facing node detail cards should show only one concise summary sentence, linked bad cases, and linked bad-case recurrence tests. Do not show a standalone status dot under the node detail title. Keep route, parent, decision, avoid-going-back, and next-step source fields in agent-readable context, not in the human detail card.
- Human-facing bad-case details should localize phenomenon, trigger, root cause, fix, and guard prose to the folder language preference while preserving technical identifiers, commands, and paths.
- Route color should encode branch depth: main route green, first-level branch cool cyan/teal, deeper branch levels progressively colder toward blue and indigo.
- Before finalizing frontend, roadmap HTML, or visual layout work, open or render the artifact with an available browser/plugin or screenshot path and inspect for obvious visual bugs. Do not rely only on string assertions for layout changes.
- Treat Stop hook output as a completion reliability gate. Before claiming fixed/done/passing, record real verification evidence for the changed artifact or workflow and rerun relevant bad-case guards.
- For UI/browser/binding/frontend work, verify the original user-visible symptom, not only build success or process restart.
- User-facing projected text should follow the folder language preference; avoid untranslated English prose in Chinese overview output except for intentional technical strings.
- For a single route group, do not show lane titles or a left label column; the overview is only the main route.
- Keep overview cards sparse. Put full Outcome, Decision, Next, and guard details in same-file detail anchors and the stable `roadmap-details.html` sidecar.
- In multi-route branch overview, route cards should read as a compact map skeleton: number, title, date/status cue, and no visible outcome paragraph. Keep route summaries in details and source context.
- Default overview links should target same-file `#node-*` and `#case-*` anchors, not `roadmap-details.html#...`, to avoid `file://` access-denied navigation.

## Pruning Rules

- Do not record normal implementation chatter.
- Do not record every command; record only commands that prove a checkpoint or guard a bad case.
- Do not let roadmap node `Test chain:` history replace bad-case recurrence guards in user-facing roadmap output.
- Do not split a real workflow into many unrelated bug-level tests when one task case with checkpoints would reveal the failure location more clearly.
- Do not silently enter test creation. If the user explicitly asks to create a test, acknowledge the test-creation intake first so the user can see the skill activated.
- Do not wait until goal completion to record important roadmap progress or bad cases.
- Merge tiny adjacent updates into one roadmap node.
- Archive stale parked tasks as a one-sentence summary.
- If a reader cannot use a detail to resume, decide, verify, or avoid recurrence, remove it.
