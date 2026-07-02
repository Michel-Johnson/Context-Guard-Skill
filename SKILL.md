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

### Project Context Location

The project context folder must be saved at:

```text
<opened Codex project root>/.codex/context/
```

The opened Codex project root is the local folder selected in the Codex sidebar or the local workspace root for the current thread. Resolve it in this order:

1. An explicit `--root <local project root>` passed to `context_guard.py`.
2. A workspace/project path from hook payload or Codex environment.
3. The local git repository root containing the current workspace.
4. The local current working directory only when it is the opened project folder.

Do not use the active chat/thread name, the skill installation directory, a remote SSH working directory, or a temporary script directory as the project root. If the correct local project root is ambiguous, stop and ask or pass an explicit `--root`.

1. Prefer the canonical context root: `.codex/context/`.
2. Create the context root the first time Codex works in a folder.
3. Maintain the quick-browse index at `.codex/context/index.md`.
4. Maintain the main route map at `.codex/context/roadmap.md`.
5. Maintain folder preferences at `.codex/context/preferences.json`.
6. Store task-specific context under `.codex/context/tasks/<task-id>/`.
7. Store task-oriented evaluation scenarios under `.codex/context/task-cases/` when a reusable long workflow is more useful than isolated bug checks.
8. Store the Test Hub registry and run evidence under `.codex/context/test-hub/`.
9. Store shared bad-case and test-chain context at `.codex/context/bad-cases.md` unless a bad case belongs only inside one task folder.
10. If no canonical context exists, read legacy bad-case locations if present: `.codex/bad-cases.md`, `BAD_CASES.md`, `docs/bad-cases.md`, or `.agents/bad-cases.md`.
11. If legacy context exists and the task modifies context, migrate or copy it into `.codex/context/` unless the repository clearly standardizes on the legacy path.
12. Use `references/context-template.md` for index, roadmap, task-folder, and task-case formats.
13. Use `references/register-template.md` when creating or updating bad-case entries.

Do not store project context inside the skill directory. If a command would use `/Users/.../.agents/skills/context-guard` or another installed skill path as the implicit root, stop and rerun it from the opened Codex workspace or pass the workspace with `--root`. Do not create a separate top-level bad-case folder; bad cases are part of `context`.

## Remote / SSH Work Boundary

When Codex uses SSH or another remote shell to develop a service, the context root still belongs to the local Codex workspace or the local folder the user opened, not to the remote server path.

1. Do not initialize or update `.codex/context/` on the remote server unless the user explicitly asks that the remote repository should own its own context.
2. Record remote hosts, remote paths, service names, and SSH commands as metadata inside the local context task.
3. Run remote commands for code inspection, tests, logs, and deployment only; write roadmap, bad-case, and task context locally.
4. If Codex is working across local and remote copies, treat the local folder as the control-plane context and the remote path as an execution target.
5. Before running `context_guard.py init`, `checkpoint-roadmap-node`, `create-branch-task`, or `show-roadmap` while inside a remote shell, stop and switch back to the local workspace root or pass an explicit local `--root`.

## Language Preference

Context records need a folder-scoped language preference so Codex does not mix languages across sessions.

1. On the first use in a folder, create `.codex/context/preferences.json` with `record_language: "unset"`.
2. If `record_language` is missing or `unset`, ask the user which language to use for future context records before writing substantive roadmap, task, or bad-case content.
3. After the user chooses, run or emulate `scripts/context_guard.py set-language --language <language>` and store the normalized value in `.codex/context/preferences.json`.
4. Write future `index.md`, `roadmap.md`, `bad-cases.md`, task context, bad-case titles, summaries, Guard/verification notes, Trigger/reproduction notes, and test-chain notes in the configured record language.
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
   - Promote a checkpoint to `Level: major` when it changes the skill's operating model, creates a branch/mainline, changes bad-case/test-chain semantics, adds a durable hook/command, or closes a user-reported high-risk bad case.
   - Do not let a route accumulate many hidden checkpoints while its visible overview card stays stale. If a route has more than eight checkpoints after the latest major node, add or promote a concise major node that summarizes the new phase.
8. Do not walk the same path twice: when a direction is rejected or superseded, record why so future Codex does not re-propose it without new evidence.
9. Link each roadmap node to related bad cases and test-chain notes when relevant.
10. If the user explicitly says the work is a branch, side route, fork, 支线, or 分支, run or emulate `scripts/context_guard.py create-branch-task --title <task title> --branch <branch name> --parent-node <parent NODE id>` before implementation. This must create/select the task folder, park the previous current task when needed, update `index.md`, and write a roadmap node with `Branch:` and `Parent:`.
11. If the requested implementation direction significantly drifts from the current mainline architecture but the user did not explicitly call it a branch, ask whether to create a branch before treating it as normal continuation.

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
- one-line `Display title` for the human roadmap card; keep it short, natural, and readable at a glance
- one-line `User request` summary copied from the user's actual intent; do not invent this from `Outcome` or `Decision / reason`
- optional `Progress summary` and `Method summary` for the human node detail page; use them when raw outcome/decision fields would read like implementation notes
- one-line outcome
- key decision or reason for the step
- next step
- links to task folder, linked bad cases, and relevant test-chain notes

Preferred source format is one `### NODE-YYYYMMDD-001: Title` section per node with bullet fields below it. If a legacy or interrupted session wrote loose bullet blocks with fields such as `ID`, `Title`, `Level`, and `Status`, the roadmap projector should still recognize those blocks instead of showing an empty roadmap; normalize them back to formal sections when editing the source file.

Support displaying the route map with `scripts/context_guard.py show-roadmap`, which reads `.codex/context/roadmap.md`, writes the human-facing HTML overview to the stable file `.codex/context/roadmap/roadmap.html`, writes human-facing details to `.codex/context/roadmap/roadmap-details.html`, updates the stable agent-readable Markdown copy at `.codex/context/roadmap/roadmap.md`, writes the stable structured agent index at `.codex/context/roadmap/roadmap.json`, and prints the generated overview path and `file://` URL. Use `export-roadmap --format md` only when only the Markdown export is needed.

Do not create timestamped HTML roadmap exports for display. The roadmap folder should contain stable user-facing HTML files that get overwritten, plus stable agent-readable formats as needed.

### User-Facing Overview

`roadmap.html` is the user's quick overview. Keep it sparse:

- Show the roadmap tracks, concise node titles, status/date chips, and at most one short summary line.
- Overview node titles must use `Display title:` when present. Keep them close to the user's wording and outcome, not implementation-log language. Use short natural phrases such as "节点详情更容易读" instead of "压缩节点详情长字段".
- Show only `Level: major` nodes as main route cards; summarize hidden checkpoints compactly and put checkpoint details in `roadmap-details.html`.
- Number visible overview cards consecutively per route group after checkpoint filtering; keep source node IDs and source-order detail anchors hidden from the overview.
- When there is only one route group, show only the main route cards in the default overview. Do not show the Bad Cases lane, Test Chain lane, or the left lane-label column. Keep linked bad cases and recurrence checks inside clicked node details, source context, and agent-readable exports.
- In single-route overview mode, keep the board content-height compact: main route cards should size to content, and summaries may use up to three readable lines before truncation.
- When there are multiple route groups, show all route lines together as a branch overview so users can see where each side route forked. Do not show a separate always-visible bad-case/test-chain drilldown under the route map; keep detailed case/check relationships in source context and agent-readable exports.
- In multi-route branch overview, treat route cards as a compact map skeleton: show the number, title, and small date/status cues only. Hide outcome summaries from the visible cards and keep them in same-file details/source context.
- When user-approved tests exist, show a compact test route directly under the route cards in multi-route overview. Align each visible test slot to the corresponding roadmap node column, so users can see which task phase has approved recurrence coverage.
- If no user-approved tests exist for a route, do not show a test route for that route at all.
- Empty test slots should be thin timeline placeholders only when the route has at least one approved test elsewhere; do not create blank cards or "no test" messages.
- Test route items must come from user-approved tests with an explicit `Run policy`, approved task-case checkpoints, or approved test registry entries. Do not treat ordinary linked bad-case guards as tests unless the user approved them as tests and a run policy is recorded. Do not populate the human-facing test route from roadmap node development logs.
- Show parent/fork markers only for side routes whose parent node belongs to another route. Never show a fork marker on the Main route merely because a later main node references an earlier node.
- In branch overview, visually align each side route's starting position to the parent node's visible position on its parent route. Do not render every side route from the first column.
- Place branch route titles, parent chips, and checkpoint text near that branch's first visible card by using the same spacer/grid coordinate as the branch cards. Do not leave branch labels pinned to the far-left edge when the branch starts later.
- Use a shared horizontal route canvas for branch overview. Represent route offsets with spacer columns inside the route grid, not by shifting or clipping the entire route section boundary.
- Keep branch connector lines aligned with the same offset coordinate used by spacer columns; connector lines should not stay pinned to the route section's left edge.
- Draw branch connector lines from the visible parent node card to the branch route anchor so users can see exactly which node created the branch. If the true parent node is hidden as a checkpoint, connect from the nearest visible parent card on that parent route while still showing the true parent label.
- Anchor branch connector endpoints to the small status dots inside the source and target node cards when those dots exist; only fall back to card edges for non-node placeholders.
- Keep route and branch connector semantics distinct: ordinary route progression is card-to-card through the gap between cards, while branch/fork connectors are dot-to-dot and must not pass through node cards or text.
- Side routes may drift right from the exact parent column to create a clean branch corridor; do not force every route to align perfectly if doing so makes connectors cross nodes.
- Render connector layers behind route cards; cards should visually mask any connector segment that would otherwise pass over card content.
- Do not infer branch relationships from vertical row adjacency, and do not use local decorative ticks that fail to show the parent node. A main-route branch must not look connected to a sibling branch just because that sibling route is above it.
- Use smooth rounded connector curves rather than hard elbow lines. Draw subtle node-to-node connectors within each route so branch connectors can route through the gaps between nodes instead of crossing node cards.
- Hide heavy native horizontal scrollbar chrome in the roadmap overview while preserving trackpad/mouse horizontal scrolling.
- Use route depth color semantics in branch overview: the main route is green, first-level branches move to cool cyan/teal, deeper branch levels move colder toward blue and indigo.
- Prefer color, symbols, and compact visual markers over visible status/frequency/linkage words.
- Show meaningful tags as compact colored chips with small emoji cues when they help scanning, especially for bad cases; keep overview tags limited and put full tags in the detail page.
- Keep raw `#tag-slug` values only in source context. In user-facing HTML, remove `#`, avoid slug-like text, and localize tag labels to the selected/user language.
- Do not show full Outcome, Decision, Next, internal links, source paths, or long bad-case text on the overview.
- Do not show implementation chrome such as "human-facing view" labels or export/update timestamps in the overview header.
- Link each node, bad case, and test-chain item to same-file detail anchors in `roadmap.html` by default, so `file://` views do not need to navigate to another local HTML file.
- Keep detailed fields out of overview cards. In human-facing node details, render each clicked node as a clear node-focused page with four plain sections: what the user asked or reported, related bad cases to solve, method taken, and current progress. The "what the user asked" section must come from the node's `User request:` field, which should be a concise summary of the user's actual input; do not freely infer it from `Outcome`, `Decision / reason`, or implementation notes. `当前进度` should prefer `Progress summary:` and `采取方法` should prefer `Method summary:`; these should read as short natural sentences, not fragments copied from schema, CLI, guard, or implementation logs. Keep full links and source fields in agent-readable context files and exports.
- Do not render a visible detail list below the roadmap by default. The default `roadmap.html` view should show only the roadmap; node or bad-case details may exist in the HTML but must be hidden until the user clicks a roadmap item.
- In human-facing bad-case details, do not mirror the full register. Show only a one-sentence summary and compact tags by default; keep reusable recurrence checks, phenomenon/trigger/root cause/fix/red/green/failure-reason fields in source context and agent-readable exports.
- Human-facing detail sections should follow the visible route map: prefer major route nodes and their linked bad cases. Hidden checkpoints and complete bad-case registers belong in `.codex/context/roadmap.md`, `bad-cases.md`, and `roadmap.json`.
- Do not show node detail pages as a global list of summaries plus a separate bad-case dump. A clicked node should read as one page for that node, with node-scoped bad cases and concise progress; do not mix verification command logs into the progress section unless the user explicitly asks for technical evidence.
- Support language-aware projection in the stable HTML files, starting with Chinese and English. Keep one source context, localize user-facing record titles, summaries, bad cases, tags, Guard/verification notes, Trigger/reproduction notes, and test-chain snippets to the configured folder language, and avoid visible language selector controls by default.
- Human-facing bad-case details must follow the folder language preference for phenomenon, trigger, root cause, fix, and guard notes. Preserve code identifiers, commands, paths, and product names, but do not leave ordinary English prose mixed into Chinese detail cards.
- When the folder language is Chinese, user-facing overview text should not fall back to untranslated English prose except for intentional technical names, commands, paths, APIs, and product names.

### User-Facing Labels

Keep stable IDs in source context files because Codex needs them for linking nodes, bad cases, and tests. Do not expose those IDs in the default user-facing HTML roadmap.

For `roadmap.html`, show concise natural-language labels:

- Show node titles without `NODE-...` prefixes.
- Show bad-case titles without `BC-...` prefixes.
- Do not show `CTX-...` task IDs by default.
- In the default overview, keep linked bad cases out of single-route cards; show them only in clicked node details or compact multi-route coverage when applicable.
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

Use `.codex/context/roadmap/roadmap.md` and `.codex/context/roadmap/roadmap.json` only as stable agent-readable exports for quick scanning, handoff, route lookup, bad-case lookup, and recurrence-guard lookup. Update source files first; exports are projections.

### Roadmap Display Model

The HTML roadmap is a route-grouped board:

1. A roadmap may contain multiple route groups, using `Branch:` on nodes. Missing `Branch:` means `Main`.
2. Horizontal movement inside each route group follows that route's nodes over time.
3. If there is only one route group, the default overview shows only the main route cards. Bad cases and test-chain notes stay in clicked node details and agent-readable context.
4. If there are multiple route groups, the overview first shows all route lines as a branch map with parent/fork markers and a compact test line aligned under the visible route nodes. Selecting a route may change the route focus state, but it must not open a separate always-visible bad-case/test-chain drilldown below the map.
5. Linked bad cases and verification chain should appear only as compact node-aligned route details, while full details stay in source context and agent-readable exports.

Treat a single-route roadmap as the user's mainline summary first, not as a three-lane board. Treat multi-route roadmaps as route navigation first, with compact bad-case/test coverage scoped to the visible route. Use `Parent:` when a branch forks from an earlier node.

### Show Roadmap Request

When the user invokes `$context-guard` and asks to show, open, view, display, export, or 展示 the roadmap:

1. Do not merely explain the command.
2. Run `scripts/context_guard.py show-roadmap --root <opened Codex workspace>` for the user's current project. The script may live in the skill directory, but the `--root` must be the project/workspace folder, not the skill folder.
3. If an in-app browser or file-opening capability is available, open the generated `file://` URL.
4. Return a clickable link to the generated HTML file.
5. If the roadmap has no nodes yet, still show the generated empty roadmap and say no nodes are recorded yet.
6. Reuse the stable display file; do not generate a new timestamped HTML file for each view request.

## Context Evidence and Guards

The core artifact is context, not scripts. Record enough context that a future Codex can understand what happened, why it mattered, how it was resolved, and how to check it without rediscovering everything.

1. Test design is human-owned. Codex may run existing tests, execute user-provided checks, or draft a short proposed check, but it must not silently design durable tests, task cases, guard scripts, or broad verification plans on the user's behalf.
2. When the user explicitly asks to create, write, generate, design, or add a test / testing task / task case, the first user-visible sentence must acknowledge that Context Guard recognized a test-creation request. Use the folder language and a compact style such as `测试创建识别：我会先把测试目标确认成一句话：从 <起点> 到 <终点>，主要验证 <风险/行为>。` This visible intake is required so the user knows the test mechanism activated.
3. Treat a user-approved test case, user-provided reproduction, native project test, or existing recorded guard as the source of truth. Codex can structure it, link it to bad cases, run it, and log results.
4. When the user creates or approves a test, register it with `Run policy: every-dev-completion` by default. This means every development turn that changes code, behavior, UI, workflow, docs with behavior rules, or project artifacts must run that test before the final answer.
5. Only change a registered test's run policy when the user says it does not need to run every time. Supported policies: `every-dev-completion`, `relevant-only`, `manual`, `release-only`, `goal-final`, `disabled-with-reason`, or a user-defined cadence. Record the user's reason next to the policy.
6. Prefer the existing `Guard / verification` note on the bad case: it may be a command, native test, manual check, screenshot comparison, log invariant, reproduction note, or script.
7. Reuse recorded commands, tests, and manual checks before proposing any new check.
8. After a test design is user-approved, prefer automation when the check can be safely and repeatably encapsulated as a native project test, command, script, or task-case runner. The goal is to reduce future Codex judgment: already-built tests should run automatically and report structured results.
9. Do not turn every bad case into a script. Create or update a durable script only when the user explicitly asked for it or confirmed the proposed test design, and the check is repeatable, valuable, and cheaper than repeatedly reconstructing it.
10. If a user-approved script is justified and does not belong in the native test suite, place it under `.codex/context/bad-case-tests/`, for example `.codex/context/bad-case-tests/BC-YYYYMMDD-001.sh`.
11. Scripted tests and task-case runners should own their temporary workspace. On full success, they should clean up generated temporary files automatically. On failure, they should preserve the smallest useful artifacts, logs, screenshots, fixtures, or temp directory path needed for Codex to diagnose the bad case.
12. If an approved automated test fails, Codex must analyze the failed phase/checkpoint or artifact, record/update the bad case, fix the cause when within scope, and rerun the same approved test until it passes or an external blocker is reached.
13. If a test cannot proceed because of a non-actionable blocker such as missing credentials, unavailable external service, permission denial, hardware/resource limits, network outage, destructive-risk confirmation, or user-only domain judgment, stop the loop and ask or warn the user with the exact blocker and the preserved evidence path.
14. Record why the chosen guard is enough. If the guard is manual-only, record the exact manual steps and why automation is not currently worth it.
15. Add tags and frequency notes for recurring bad cases, such as `#hot`, `#flaky`, `#ui`, `#data-loss`, or `#route-risk`, so Codex can quickly spot high-risk patterns.
16. Treat each resolved bad case guard as a red-capable recurrence signal: it must be able to catch the original symptom if it returns, not merely prove that related code ran.
17. For resolved or recurred cases, record `Guard type`, `Red condition`, `Green condition`, `Expected failure reason`, and `Run policy` in addition to `Guard / verification`.
18. When a new guard is needed but no human-approved design exists, write it as `proposed` with a short confirmation prompt instead of creating or running a durable test.
19. Promote repeated or high-frequency bad cases into fixed pressure checks only after the user approves that pressure check.
20. Keep verification proportional for agent-selected ad hoc checks, but do not use the verification budget to skip user-approved tests whose policy is `every-dev-completion`.
21. Default verification budget for ordinary turns is one primary check plus the complete human-approved `every-dev-completion` test set, plus at most two extra relevant bad-case guards. Exceed this only when the user-approved always-run set requires it, or for high-risk, shared, release, security/data-loss, or user-requested exhaustive work.
22. Select extra guards by overlap: changed files, feature area, route branch, bad-case tags, and the original user-visible symptom. Skip unrelated resolved cases unless their `Run policy` says they must run every development completion.
23. Prefer existing native project tests or one focused symptom check over adding new `.codex/context/bad-case-tests/` scripts. Add a new script only after explicit user approval.
24. Do not let guard work become an agent-created testing loop. If the user-approved always-run suite is too broad or expensive, ask the user which tests to demote instead of silently skipping or redesigning it.
25. Do not import a strict test-first workflow into every task. Context Guard requires credible evidence, not always a newly written failing test. For urgent bugs, remote patches, UI polish, or small documentation/skill edits, existing user evidence plus one targeted verification is enough unless the user asks for TDD or the risk is high.

Preferred bad-case source format is one `### BC-YYYYMMDD-001: Title` section per case with bullet fields below it. If a legacy or interrupted session wrote loose bullet blocks with fields such as `ID`, `Title`, `Status`, and `Nodes`, the roadmap projector should still recognize those blocks instead of showing "No linked bad cases"; normalize them back to formal sections when editing the source file.

Recording and display must stay connected. Every bad case that should appear on a roadmap must have either `Roadmap nodes:` / `Nodes:` pointing to one or more `NODE-...` IDs, or the roadmap node must list that case under `Linked bad cases:`. Do not rely on task-level proximity alone.

### Feature-Oriented Test Chains

Use as few durable test chains as possible to cover as many bad-case recurrence checks as possible. The durable testing unit is a feature or workflow chain, not an individual bad case.

A feature chain has:

- a clear input or entry point, such as clicking a button, submitting a task, opening a page, or starting a workflow
- ordered checkpoints that match the real user/business flow
- strict red and green conditions for the final result and any critical intermediate step
- linked bad cases attached to the specific checkpoint where they can recur

When a new bad case appears:

1. First ask whether it belongs to an existing feature chain.
2. If it does, attach the bad case to the matching chain node and strengthen that node's checkpoint instead of creating a separate long-lived test.
3. If no existing chain matches the feature or workflow, propose a new feature chain with the same short human-facing confirmation style as task cases.
4. Only approve or automate the chain after user confirmation, unless the user explicitly provided the exact test to implement.

Store feature chains in `.codex/context/test-hub/feature-chains.json`. Use:

```bash
python3 ~/.agents/skills/context-guard/scripts/context_guard.py feature-chain-add \
  --root <project> \
  --title "GPU 监控按钮" \
  --entry "点击 GPU 监控按钮" \
  --exit-check "打开包含有效 grafana_url 的监控页" \
  --command-text "<approved command>"

python3 ~/.agents/skills/context-guard/scripts/context_guard.py feature-chain-attach-bc \
  --root <project> \
  --chain-id FC-YYYYMMDD-001 \
  --node-title "后端返回监控 URL" \
  --bad-case BC-YYYYMMDD-001 \
  --check "grafana_url 不为空且前端没有卡住"
```

Approved feature chains with `Run policy: every-dev-completion` are included in `dev-complete` and the Stop hook. Relevant-only or proposed chains remain context until the user approves or asks to run them.

### Task-Oriented Test Cases

When verification would otherwise become many tiny bug-specific tests, prefer a task-oriented case that simulates a real workflow end to end. A task case is a scenario with phases, checkpoints, logs, and linked bad-case coverage.

Use `.codex/context/task-cases/<task-case-id>.md` for reusable scenario specs and logs. Keep `.codex/context/bad-case-tests/` for small reusable scripts that guard one bad case or one checkpoint.

Task-case design is also human-owned. Codex may propose a compact task-case draft, but the task case stays `proposed` and must not become `approved`, `active`, `stable`, or executable durable automation until the user confirms the business flow and risk.

A good task case records:

- task case ID, title, scope, and owner route/task
- design status: proposed, approved, active, stable, deferred, or obsolete
- run policy: `every-dev-completion` by default after user approval, unless the user sets another cadence
- automation entry: native command, script, prompt/manual runner, or none
- realistic setup and trigger
- ordered phases that match the real workflow
- checkpoint logs for each phase
- linked bad cases covered by each checkpoint
- stop condition, cleanup expectations, and failure artifact policy
- red condition, green condition, and failure-localization notes

Do not replace every bad-case guard with a long task case. Use task cases when the real risk is interaction across phases, such as scheduling, worker allocation, state transitions, review, recovery, cleanup, browser flows, or multi-step agent workflows.

Prefer this structure:

```text
Task Case: full workflow
  Phase 1: setup/input
    Checkpoint: invariant/log/assertion
    Covers: BC-...
  Phase 2: state transition
    Checkpoint: invariant/log/assertion
    Covers: BC-...
  Phase 3: recovery/cleanup
    Checkpoint: invariant/log/assertion
    Covers: BC-...
```

The failure report should say which phase/checkpoint failed, not only which test file failed. Bad-case guards remain useful, but they should often become checkpoint coverage inside a task case instead of isolated scripts.

For approved task cases, prefer an automated runner when feasible. The runner should produce concise phase logs, clean temporary files after all checkpoints pass, preserve diagnostic artifacts on failure, and exit with a clear non-zero status for red conditions. Codex should usually only read the runner output and preserved evidence, not redesign the test.

Before writing any new durable task case or task-case script, present a very short business-facing proposal and ask for user confirmation. The proposal should say only: from what state to what state, what main task it simulates, and what major risk it is meant to catch. Avoid listing technical phases, checkpoints, logs, stop conditions, cleanup, or exclusions in the confirmation prompt unless the user asks. Do not silently create task cases or scripts from agent guesses.

If the latest user message explicitly asks to create/generate/write/design a test, start the response with a visible test intake line before any file inspection or implementation summary. Keep it natural and short, for example: `测试创建识别：这个测试我会先确认成“从编辑器输入 Markdown 到预览正确渲染”，主要防止预览更新或格式渲染回归。` Then continue with the short confirmation proposal or implement the exact test if the user already gave explicit implementation permission.

Confirmation proposal format:

```text
测试 case：从 <起点> 到 <终点>
主要任务：<一句话业务任务>
主要风险：<一句话说明要防什么>
是否需要这个测试 case？
```

User confirmation is not required for reusing an already approved task case, running a native project test, or when the user explicitly asks Codex to implement a specific test case without another review. Once approved, default its run policy to `every-dev-completion`; only lower that frequency if the user asks. Adding a checkpoint to an approved case requires confirmation unless it is purely a log/evidence note for an already approved phase. If the user is unavailable during autonomous work, record the case as `proposed` and use only the minimal existing checks until approval.

If a task case or guard is itself wrong, record or update a bad case for the test chain. Common test-chain bad cases include false positive, false negative, wrong granularity, missing phase, wrong assertion, non-realistic setup, missing cleanup, and unclear failure localization.

### Goal Mode Task Cases

In goal mode, task cases are phase gates for long-running work, not permission to test endlessly.

1. At goal start or first relevant milestone, select an existing human-approved task case for the goal workflow. If none exists and the goal appears to need one, draft a proposed task case and ask for confirmation with the short business-facing format when user input is available.
2. During autonomous continuation, run or update only the phase/checkpoint that matches the current goal phase unless risk justifies a fuller pass.
3. Record checkpoint logs as the goal advances so the next continuation knows which phase passed, failed, or remains untested.
4. Before marking a goal complete, run the smallest human-approved task-case path that covers the final user-visible workflow and the highest-risk linked bad cases.
5. If a goal changes route, pause the old task-case coverage and decide whether to create a new proposed task case rather than mutating the old one into an inaccurate workflow.
6. If a task-case design needs user judgment and the user is not present, do not invent a broad test suite. Mark the task case `proposed`, run only existing relevant human-approved guards, and report the pending confirmation.

### Test Chain Semantics

The test chain is a human-designed recurrence-detection path for bad cases, not a development verification log and not an agent-generated test suite.

For each resolved or relevant bad case, record the shortest reusable check that could reveal the same bad case after future changes:

- a task-case checkpoint when the bad case appears only inside a realistic multi-step workflow
- a command, native test, or script path when the check is cheap and repeatable
- a prompt or Codex checklist when judgment is needed
- a manual visual check or screenshot instruction when layout matters
- an invariant, reproduction prompt, or log check when that is the fastest reliable signal

The reusable check must come from a human-approved test case, a user-provided reproduction, an existing native test, or an explicit user-approved Codex proposal. If none exists, record a proposed check and ask for confirmation instead of treating it as active coverage.

Approved tests are a durable test registry. Unless the user sets a different `Run policy`, every approved task case, approved guard script, or approved manual/prompt check must be run or explicitly reported as blocked at the end of each development turn. Relevant-only or manual policies are opt-outs chosen by the user, not defaults chosen by Codex.

Approved automated tests should be executed with minimal Codex involvement: run the registered command/script, read its structured result, and avoid re-deriving the test logic. Successful runs should clean their temporary files. Failed runs should preserve evidence and become a bad-case analysis loop: diagnose, fix, rerun the same approved test, and stop only when it passes or a non-actionable blocker requires user input.

### Test Hub

Use the Test Hub as the automation control plane for approved tests. The hub collects human-approved tests and lets Codex send one completion signal instead of manually reconstructing every check.

- Store the explicit test registry at `.codex/context/test-hub/registry.json`.
- Keep the hub simple: one registry, one `dev-complete` runner, `last-run.json`, and lightweight registry management commands. Do not build a heavy scheduling platform unless the user asks.
- Register only user-created or user-approved tests. Do not auto-promote ordinary bad-case guards, roadmap `Test chain:` notes, or Codex implementation logs into the registry.
- A registry entry with `status: approved | active | stable` and `run_policy: every-dev-completion` is part of the always-run set.
- Manage registry tests with `test-hub-list`, `test-hub-enable`, `test-hub-disable`, `test-hub-set-policy`, and `test-hub-remove`.
- Use `show-test-hub` to write the stable read-only human-facing page at `.codex/context/test-hub/test-hub.html`.
- The Test Hub HTML is a status page only. Do not make users start tests from HTML buttons; approved tests run from the Stop hook or `dev-complete`.
- Task cases in `.codex/context/task-cases/` may also join the always-run set only when they are `approved | active | stable`, have `Run policy: every-dev-completion`, and include an automated entry command.
- At development completion, the Stop hook should invoke `scripts/context_guard.py dev-complete --root <project>` so registered tests run automatically. If running manually, use `dev-complete` over hand-running tests one by one. Use `--jobs <n>` only when parallel execution is safe for the registered tests.
- `dev-complete` must report passed, failed, and blocked tests. On full success it should clean the run artifacts; on failure or blocker it should preserve evidence under `.codex/context/test-hub/runs/`.
- If the user says a test should not run every time, update the registry or task case run policy instead of silently skipping it.
- If no approved every-dev-completion tests exist, the hub should report that clearly and exit successfully; Codex should not invent tests to fill the gap.

Each reusable check should answer four questions:

- Red condition: what output, visual state, error, or assertion means the bad case has recurred
- Green condition: what evidence means the bad case is absent
- Expected failure reason: why the check should fail when the old symptom is present, so Codex can distinguish a real recurrence from a broken test
- Guard type: script, native-test, manual, browser-screenshot, browser-dom, curl, cli, prompt, log-invariant, fixture, unit, integration, e2e, or another concise type
- Artifact policy: cleanup-on-pass, preserve-on-fail, or manual-preserve, including the log/temp path convention when relevant

In roadmap overview, single-route pages hide the Test Chain lane by default, while multi-route compact test routes must be generated only from user-approved tests with explicit `Run policy`, approved task-case checkpoints, or approved test registry entries. Ordinary linked bad-case guards are recurrence context, not user-approved tests, unless the user approved that guard as a test and the source record has a run policy. Do not fill user-facing test coverage from roadmap node `Test chain:` history. Roadmap node `Test chain:` may keep compact checkpoint evidence in source/details, but it is not the primary bad-case recurrence chain.

When a task-oriented case exists for the changed workflow, prefer running or following that scenario and its checkpoint logs over running several disconnected bad-case scripts. Stay within the verification budget by selecting the smallest relevant task case and only the checkpoint guards that overlap the current change.

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
11. At the start of the user-visible answer, include a compact intake statement when useful: `Context intake: continuing <task>`, `Context intake: parked <task>, starting <task>`, `Bad-case intake: recorded BC-...`, `测试创建识别：...`, or `Context intake: no active context`.

### During Work

Whenever design context appears, update the active task context enough that another turn can resume it without re-deriving it:

- objective or current idea
- key constraints and decisions
- rejected route only when it prevents backtracking
- open question or blocker
- touched areas only when useful to resume
- next step

Write these context updates in the configured record language from `.codex/context/preferences.json`. Keep literal technical strings unchanged.

Whenever a task reaches meaningful progress, first decide whether that progress deserves a roadmap node. Create or update a concise node only when it changed direction, made a durable decision, fixed or exposed a bad case, created a branch/fork, reached a user-visible milestone, or prevents future backtracking. Link the node to bad cases and test-chain context when relevant.

During goal mode, do this during the work as soon as a goal checkpoint is reached. Do not defer roadmap and bad-case updates until the final response.

Whenever a bad case appears:

1. Add a new entry or update the matching existing entry.
2. Record the exact phenomenon, minimal trigger, affected scope, suspected or confirmed cause, current status, and evidence.
3. Before fixing, reproduce it or document why reproduction is blocked; for fixed cases, keep the original trigger as the red-capable signal.
4. If not fixed, mark it `open` or `deferred` and explain why it cannot be completed in the current task.
5. If fixed, record the solution plus `Guard / verification`, `Guard type`, `Red condition`, `Green condition`, and `Expected failure reason`.
6. Prefer existing project tests or clear manual checks; add a script only when it materially improves future reuse.

Use stable IDs such as `BC-YYYYMMDD-001` or the next local sequence already used by the register.

### End-of-Work Self-Check

Run this before the final answer whenever Codex changed code, generated artifacts, updated UI, modified a workflow, or claimed that something works.

1. Identify the user-visible behavior or workflow that changed.
2. Run the smallest real check that proves the changed behavior works, using the product/tool the user would actually use when feasible. This is the primary check and is usually enough for small, low-risk changes. If credible user evidence or logs already establish the red state, do not spend extra turns manufacturing a new failing test before implementation.
3. For frontend, HTML, CSS, visual, document, slide, image, or layout work, perform a visual inspection:
   - Prefer the Codex Browser / browser plugin or the available in-app browser to open the target and inspect the rendered result.
   - Use screenshots when the visual state matters; compare the screenshot against the user request and known bad cases.
   - Check for obvious visual errors: clipped text, overlap, detached connector lines, huge empty gaps, wrong alignment, broken colors, missing content, unreadable labels, wrong language, blank canvas, or inaccessible interactions.
4. If the preferred browser/plugin cannot access the target, use the next safest available evidence: generated screenshot, renderer output, local image inspection, DOM/static checks tied to the visual invariant, or a clear manual-check note.
5. Do not end with only string/DOM assertions when the risk is visual. If visual inspection is blocked, say exactly what was blocked, record the residual risk, and avoid claiming visual polish was verified.
6. If the self-check reveals a new or recurring bad case, record it immediately, fix it before the final answer unless the user pauses, and rerun the self-check.
7. Record the self-check evidence in the relevant roadmap node, bad-case entry, or task context using the folder language preference.
8. Treat the Stop hook as a completion reliability gate, not a decorative reminder. If the hook asks for verification evidence, branch-task handling, or BC summary, satisfy it before finalizing.
9. Do not claim a bug is fixed because a build passed or a helper restarted. Verify the original user-visible symptom with the smallest real check that could falsify the claim.
10. If the work touched frontend, browser, UI binding, routing, HTML/CSS, or visual state, the self-check must include Browser/plugin/screenshot/DOM evidence tied to the original symptom, or an explicit blocker and residual risk.
11. Keep the self-check inside the verification budget unless risk is high. If the budget would be exceeded, prefer the original symptom check and the highest-risk relevant guard, then record the skipped checks as unrelated or deferred.
12. Stop condition: once the original symptom has a credible cause and the next useful action is a code/config/doc edit, do the edit. Do not run more discovery or guard commands unless the current evidence is contradictory or the edit target is still unknown.

### Turn End: Context Checkpoint

Run this before every final answer.

1. Re-read the project context index and relevant task folder.
2. Re-read the route map and make a roadmap checkpoint decision. If this turn changed direction, made a durable decision, fixed a problem, created a branch/fork, reached a user-visible milestone, or refreshed a stale route, create or update one concise node. If none of those apply, do not create a node; mention that no roadmap node was needed.
3. Update the active task summary with key decisions, bad cases, open questions, and next step.
4. If the task direction changed this turn, ensure the previous task is parked and the new task is current.
5. Run the End-of-Work Self-Check for the changed behavior or artifact before claiming success.
6. Select only the bad-case entries whose scope clearly overlaps the changed code, feature, route, or user-visible symptom. Do not select all resolved cases merely because they have recorded guards.
7. Run the full human-approved test registry whose `Run policy` is `every-dev-completion`. This includes approved task cases, approved native test commands, approved guard scripts, and approved manual/prompt checks. If any cannot run, record the blocker and residual risk; do not imply the always-run suite passed.
   - For automated approved tests, run the registered command/script rather than reconstructing the test manually.
   - If all approved automated tests pass, ensure their temp files were cleaned or note the script's cleanup policy.
   - If any approved test fails, preserve evidence, analyze the failed phase/checkpoint as a bad case, fix what is in scope, and rerun until the test passes or a non-actionable blocker is reached.
   - If blocked by credentials, unavailable services, permissions, hardware/resource limits, network, destructive-risk confirmation, or user-only judgment, ask or warn the user instead of looping.
8. For tests whose policy is `relevant-only`, `manual`, `release-only`, `goal-final`, `disabled-with-reason`, or a user-defined cadence, follow that policy exactly and mention skipped items only when they overlap the current change or affect confidence.
9. If a relevant task-oriented case exists, use its phase/checkpoint flow as the primary verification and note which checkpoints covered the linked bad cases. Otherwise re-run or re-perform the recorded guard for the highest-risk selected resolved entries, staying within the default budget of one primary check plus the complete always-run test set plus at most two extra relevant bad-case guards unless this is high-risk or the user requested exhaustive verification. Use the existing context, command, native test, script, screenshot/manual check, or visual inspection first.
10. If no recorded human-approved guard exists, do not invent active coverage. Use the lightest credible evidence for this turn, record any new durable guard as `proposed`, and ask for user confirmation with the short business-facing format before writing durable scripts or marking it approved. Existing user screenshots/logs/reproductions may serve as the red condition; a new failing test is optional, not mandatory.
11. If a resolved bad case recurs:
   - Mark it `recurred`.
   - Explain why it recurred: missed guard, incomplete fix, route conflict, test gap, refactor side effect, environment drift, or unknown.
   - Fix it immediately unless the user explicitly pauses the work or the recurrence is due to an approved technical route change.
   - Add or update the context and guard so the recurrence is easier to catch next time.
   - Re-run the verification and update the entry back to `resolved` only when evidence passes.
12. If a case is exempt because of a technical route change, mark it `superseded-by-route-change` and document the approved change.
13. If a bad case becomes frequent, add or update a high-frequency tag and warning note.
14. In goal mode, finish this checkpoint before calling `update_goal` to mark the goal complete or blocked.
15. If urgent or unrelated work is complete and a parked task exists, ask the user whether to resume the most relevant parked task.
16. If the Stop hook detects an explicit branch request, ensure the branch task and `Branch:`/`Parent:` roadmap node exist before finalizing.
17. If the Stop hook detects possible drift from the mainline architecture and no explicit branch exists, ask the user whether this should become a branch instead of silently continuing the mainline.
18. When a roadmap node is needed at turn end, prefer `scripts/context_guard.py checkpoint-roadmap-node --title <source title> --display-title <short human title> --user-request <short summary of the user's actual request> --progress-summary <readable current progress> --method-summary <readable method> --branch <Main or route> --level <major|checkpoint> --outcome <one-line source progress> --next-step <next>` instead of hand-editing. Use `create-branch-task` first when the user explicitly asks for a new branch.
19. Run `scripts/context_guard.py validate-bad-cases` only after updating bad-case entries, changing bad-case schema/renderer/hook behavior, or intentionally auditing the register; do not run it on unrelated code turns. Historical resolved cases without the new fields may remain warnings until touched; use `--strict` only when intentionally migrating or auditing all resolved cases.
20. Run `scripts/context_guard.py validate-roadmap-maintenance` only after adding route nodes, changing roadmap maintenance rules, or before showing the roadmap; if it reports too many hidden checkpoints after a route's latest visible node, promote or add a major node before finalizing.

## Completion Report

At the end of every response, include a compact context summary when development work, context intake, task switching, bad-case intake, or a register was involved. Keep it one line for unrelated conversation.

- Context folder used.
- Current task index status.
- Roadmap node updated, exported, or displayed.
- If no roadmap node was created, the brief reason why it was not needed.
- Bad-case intake result from this turn.
- BC archived/updated this turn. If none were changed, say `none`.
- Current unresolved BC. Use concise human-readable bad-case titles and, when useful, one symptom phrase plus status; do not report only `BC-...` IDs. If none are open/deferred/recurred/unknown, say `none`.
- Current Test Hub status. Say whether all currently approved `every-dev-completion` tests passed, failed, blocked, or whether no approved always-run tests exist. Include concise counts such as `3 passed, 0 failed, 0 blocked`.
- New or updated context, limited to key nodes and bad cases.
- End-of-work self-check performed, including visual inspection evidence for frontend/layout artifacts or the exact blocker if visual inspection was not possible.
- Previously resolved cases rechecked, including reused context, tests, commands, scripts, or manual checks.
- Any parked task that should be offered for resume.

If no context exists and no context-worthy event happened, say that the context gate was not applicable.
