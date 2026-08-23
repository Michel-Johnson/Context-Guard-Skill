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
5. Treat the user's own wording as context when it contains requirements, preferences, constraints, credentials, route changes, or bad-case reports. Preserve short user messages without turning context into a full transcript.
6. Prefer one-line summaries. If a detail is not needed for resume, route choice, or recurrence prevention, omit it.
7. When exporting or displaying context, show the shortest useful view first and leave secondary details folded or linked.

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
6. Maintain user-message memory at `.codex/context/user-messages.md`.
7. Store local-only sensitive memory under `.codex/context/private/`; keep it gitignored and never project it into HTML.
8. Store task-specific context under `.codex/context/tasks/<task-id>/`.
9. Store task-oriented evaluation scenarios under `.codex/context/task-cases/` when a reusable long workflow is more useful than isolated bug checks.
10. Store the Test Hub registry and run evidence under `.codex/context/test-hub/`.
11. Store shared bad-case and test-chain context at `.codex/context/bad-cases.md` unless a bad case belongs only inside one task folder.
12. If no canonical context exists, read legacy bad-case locations if present: `.codex/bad-cases.md`, `BAD_CASES.md`, `docs/bad-cases.md`, or `.agents/bad-cases.md`.
13. If legacy context exists and the task modifies context, migrate or copy it into `.codex/context/` unless the repository clearly standardizes on the legacy path.
14. Use `references/context-template.md` for index, roadmap, task-folder, and task-case formats.
15. Use `references/register-template.md` when creating or updating bad-case entries.

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

## First Use: Architecture Map

The architecture map is created once: the first time Context Guard is used in a folder. It is not a later “import from GitHub” action, not a dump of the directory tree, and not an instant click.

1. Treat a folder as first use only when there is no map yet: `.codex/context/` does not exist, or `map_bootstrap` is missing/`pending` **and** `architecture.md` has no proposed or confirmed first layer. If a proposed or confirmed map already exists, later sessions open that map. Do not re-analyze.
2. First-use analysis is work, not a speed run. The agent must read README, package/workspace boundaries, existing docs, and runtime entrypoints, then write a detailed `architecture.md` at **development granularity** (commands, main loops, panels, contracts you would actually change). This takes time. Do not emit one node per file, copy the folder tree, stop at seven slogan names, or treat the map as an instant import.
3. First use itself is the trigger. Do not wait for a GitHub URL or an import button. Do not pretend the map can appear in one click.
4. The HTML map uses L1 as a confirmation gate, not as the analysis. Propose **4–8 L1 modules** (cluster if more; greenfield = root only). Clicking an L1 card **enters** it. If that module would show more than about eight work siblings, cluster them into **submodules** (still `kind: module` cards: name + purpose that names the files). Work units hang under those submodules. Do not park work units in an inbox. Only internals of a work unit go to inbox. Later agents must not read unconfirmed proposals.
5. The human confirms, rewrites, or hides L1. The root canvas is a **module grid**; click enters. Do not peek children on the root. Do not dump 15 files as siblings of a module. Empty slogan umbrellas (`CLI` / `TUI` / `UI` with no files underneath) are still forbidden. Unpack inbox layers when they enter a work unit. Depth must already exist in `architecture.md`.
6. If the folder is greenfield (almost no code or docs), create a root node only. Do not invent a fake architecture.
7. After proposing L1, set `map_bootstrap` to `proposed`. After the human confirms the first layer, or explicitly starts from an empty root, set `map_bootstrap` to `ready`. Later sessions load the existing map and must not re-split the repository unless the user asks to rebuild.
8. Confirming the first-use map does not authorize every module for the current session. New sessions still load a small readable slice.

## Map grammar

Every node is one of two kinds. Mixing them on the same layer is what makes first-use maps unreadable.

| Kind | Where | Canvas | Title | Not this |
|------|--------|--------|--------|----------|
| **module** | L1 and true nested subsystems | Large card: name + one-line purpose | Short architecture bucket that names the files it owns | Empty slogan umbrellas (`CLI` / `TUI` / `UI` with no children) |
| **work** | Under a module that is already at development grain (typically ≤8 siblings) | Small capsule | File, command, or loop you would change | Rules, status, memories, bugs |

Hard rules for the proposing agent:

1. L1 count is 4–8. If analysis finds more concerns, cluster them. Do not emit 12 sibling modules.
2. After entering a module, if more than about eight work units would sit as siblings, **build submodules** first. A submodule is a module card whose purpose names locatable artifacts (`src/commands/onboard.ts`, `src/tui/tui.ts`). Prefer that over a flat fan of files. Prefer `src/commands/onboard.ts` under a “安装与守护” card over an empty `CLI 入口`.
3. Memories, constraints, and bugs are **content on a node**, never sibling nodes. “禁止把 skill 安装目录当项目根” belongs as a memory on the CLI module, not as a card.
4. Do not emit one node per file at the layer the human first sees after entering a module. Group what you would change together; title work units with the primary path.
5. Root canvas is a **grid of L1 module cards** (title + one-line purpose). Click a card to enter. Left-right / top-down layout applies to the work-unit tree **inside** a module, not to the root catalog. Do not print files on the module card. Do not peek L2 on the root. Depth lives in `architecture.md`.
6. Every node must answer “when would I open this” in the record language. If the human cannot tell, the analysis failed: delete or rewrite, the agent must not defend it.
7. Do not invent a dumpster module (`其他`, `misc`). Cluster or drop the leftover. Work-unit titles should name a locatable artifact (file, command, or panel), not an abstract bucket.

## User Message Memory

User messages are not disposable chat noise. Short user instructions, corrections, preferences, constraints, route hints, server connection details, credentials needed for the current task, and bad-case reports must be preserved in project context so a later Codex turn does not ask the user to repeat them.

1. At `UserPromptSubmit` or turn start, record the latest user prompt in `.codex/context/user-messages.md` when it contains durable context. For normal short prompts, keep the user's wording as written or near-verbatim.
2. Do not store every long pasted file, log, generated artifact, or giant attachment. For large inputs, record the file/source, purpose, first meaningful line or summary, and critical identifiers only.
3. Keep `.codex/context/user-messages.md` agent-readable and concise: recent user signals plus durable constraints. Promote stable requirements into the active task context or roadmap `User request:` fields, then archive stale chatter.
4. Preserve exact code identifiers, paths, hosts, ports, commands, API names, and error messages unless they are secrets.
5. Never put raw secrets in `index.md`, `roadmap.md`, `bad-cases.md`, task context, Roadmap HTML, exported JSON/Markdown, logs, README, git-tracked files, or final answers.
6. If the user explicitly provides a credential, token, password, or similar secret that future Codex turns need, store the raw value only in `.codex/context/private/secrets.local.json` with local-only permissions or an OS credential store. In public context, record only a redacted pointer such as `USER-SECRET-...`.
7. Do not persist one-time codes such as OTP or short-lived verification codes. Record only a redacted note that a one-time code was supplied.
8. If safe private storage is unavailable, record a redacted note and ask the user to re-provide the secret or use a secure store when needed.
9. When creating a roadmap node, derive `User request:` from the preserved user wording rather than from implementation logs, `Outcome`, or `Decision / reason`.

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
- Keep two presentations in the same stable `roadmap.html`: a card view for reading a small route and a compact overview for scanning many nodes. Use icon-only controls with accessible labels, preserve the user's selected mode locally, and default to compact overview when more than sixteen major nodes are visible.
- In compact overview, wrap concise node tiles into the available viewport width, show only the visible number, short title, and status cue, and keep every tile linked to the same node detail. Do not duplicate or discard source context to create the compact view.
- Compact overview may replace connector curves with route grouping and parent labels to avoid lines crossing wrapped tiles; the card view remains the detailed branch-connector view.
- Number visible overview cards consecutively per route group after checkpoint filtering; keep source node IDs and source-order detail anchors hidden from the overview.
- When there is only one route group, show only the main route cards in the default overview. Do not show the Bad Cases lane, Test Chain lane, or the left lane-label column. Keep linked bad cases and recurrence checks inside clicked node details, source context, and agent-readable exports.
- In single-route overview mode, keep the board content-height compact: main route cards should size to content, and summaries may use up to three readable lines before truncation.
- When there are multiple route groups, show all route lines together as a branch overview so users can see where each side route forked. Do not show a separate always-visible bad-case/test-chain drilldown under the route map; keep detailed case/check relationships in source context and agent-readable exports.
- In multi-route branch overview, treat route cards as a compact map skeleton: show the number, title, and small date/status cues only. Hide outcome summaries from the visible cards and keep them in same-file details/source context.
- Do not show a compact test route, bad-case lane, recurrence-check lane, or node-linked test notes in the default overview. Keep the overview focused on route nodes only.
- Keep user-approved tests, bad cases, and recurrence checks in clicked node details, the Test Hub page, and agent-readable exports. Do not create a second row of cards under route nodes for this information.
- Do not show empty test slots, "no test" placeholders, or compact test cards under roadmap nodes.
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
- `.codex/context/user-messages.md`
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
4. If there are multiple route groups, the overview first shows all route lines as a branch map with parent/fork markers. Selecting a route may change the route focus state, but it must not open a separate always-visible bad-case/test-chain drilldown below the map.
5. Linked bad cases and verification chain should appear only in clicked node details, the Test Hub page, source context, and agent-readable exports.

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
3. When a task changes user-visible behavior, fixes a recurring bug, touches a multi-step workflow, changes UI/HTML/browser behavior, updates remote/service operations, or enters goal-mode work, gently remind the user that this may be a good moment to create a reusable test task. Keep the reminder optional and one sentence, for example: `这个流程后续可能会复发，要不要把它沉淀成一个测试任务？`
4. Do not ask for a test task on every turn. Skip the reminder when the task is purely conversational, already covered by an approved test, very small, or the user has recently declined/demoted similar coverage.
5. Treat a user-approved test case, user-provided reproduction, native project test, or existing recorded guard as the source of truth. Codex can structure it, link it to bad cases, run it, and log results.
6. When the user creates or approves a test, register it with `Run policy: every-dev-completion` by default. This means every development turn that changes code, behavior, UI, workflow, docs with behavior rules, or project artifacts must run that test before the final answer.
7. Only change a registered test's run policy when the user says it does not need to run every time. Supported policies: `every-dev-completion`, `relevant-only`, `manual`, `release-only`, `goal-final`, `disabled-with-reason`, or a user-defined cadence. Record the user's reason next to the policy.
8. Prefer the existing `Guard / verification` note on the bad case: it may be a command, native test, manual check, screenshot comparison, log invariant, reproduction note, or script.
9. Reuse recorded commands, tests, and manual checks before proposing any new check.
10. After a test design is user-approved, prefer automation when the check can be safely and repeatably encapsulated as a native project test, command, script, or task-case runner. The goal is to reduce future Codex judgment: already-built tests should run automatically and report structured results.
11. Do not turn every bad case into a script. Create or update a durable script only when the user explicitly asked for it or confirmed the proposed test design, and the check is repeatable, valuable, and cheaper than repeatedly reconstructing it.
12. If a user-approved script is justified and does not belong in the native test suite, place it under `.codex/context/bad-case-tests/`, for example `.codex/context/bad-case-tests/BC-YYYYMMDD-001.sh`.
13. Scripted tests and task-case runners should own their temporary workspace. On full success, they should clean up generated temporary files automatically. On failure, they should preserve the smallest useful artifacts, logs, screenshots, fixtures, or temp directory path needed for Codex to diagnose the bad case.
14. If an approved automated test fails, Codex must analyze the failed phase/checkpoint or artifact, record/update the bad case, fix the cause when within scope, and rerun the same approved test until it passes or an external blocker is reached.
15. If a test cannot proceed because of a non-actionable blocker such as missing credentials, unavailable external service, permission denial, hardware/resource limits, network outage, destructive-risk confirmation, or user-only domain judgment, stop the loop and ask or warn the user with the exact blocker and the preserved evidence path.
16. Record why the chosen guard is enough. If the guard is manual-only, record the exact manual steps and why automation is not currently worth it.
17. Add tags and frequency notes for recurring bad cases, such as `#hot`, `#flaky`, `#ui`, `#data-loss`, or `#route-risk`, so Codex can quickly spot high-risk patterns.
18. Treat each resolved bad case guard as a red-capable recurrence signal: it must be able to catch the original symptom if it returns, not merely prove that related code ran.
19. For resolved or recurred cases, record `Guard type`, `Red condition`, `Green condition`, `Expected failure reason`, and `Run policy` in addition to `Guard / verification`.
20. When a new guard is needed but no human-approved design exists, write it as `proposed` with a short confirmation prompt instead of creating or running a durable test.
21. Promote repeated or high-frequency bad cases into fixed pressure checks only after the user approves that pressure check.
22. Keep verification proportional for agent-selected ad hoc checks, but do not use the verification budget to skip user-approved tests whose policy is `every-dev-completion`.
23. Default verification budget for ordinary turns is one primary check plus the complete human-approved `every-dev-completion` test set, plus at most two extra relevant bad-case guards. Exceed this only when the user-approved always-run set requires it, or for high-risk, shared, release, security/data-loss, or user-requested exhaustive work.
24. Select extra guards by overlap: changed files, feature area, route branch, bad-case tags, and the original user-visible symptom. Skip unrelated resolved cases unless their `Run policy` says they must run every development completion.
25. Prefer existing native project tests or one focused symptom check over adding new `.codex/context/bad-case-tests/` scripts. Add a new script only after explicit user approval.
26. Do not let guard work become an agent-created testing loop. If the user-approved always-run suite is too broad or expensive, ask the user which tests to demote instead of silently skipping or redesigning it.
27. Do not import a strict test-first workflow into every task. Context Guard requires credible evidence, not always a newly written failing test. For urgent bugs, remote patches, UI polish, or small documentation/skill edits, existing user evidence plus one targeted verification is enough unless the user asks for TDD or the risk is high.

Preferred bad-case source format is one `### BC-YYYYMMDD-001: Title` section per case with bullet fields below it. If a legacy or interrupted session wrote loose bullet blocks with fields such as `ID`, `Title`, `Status`, and `Nodes`, the roadmap projector should still recognize those blocks instead of showing "No linked bad cases"; normalize them back to formal sections when editing the source file.

Recording and display must stay connected. Every bad case that should appear on a roadmap must have either `Roadmap nodes:` / `Nodes:` pointing to one or more `NODE-...` IDs, or the roadmap node must list that case under `Linked bad cases:`. Do not rely on task-level proximity alone.

### Feature-Oriented Test Chains

When designing or updating a feature chain, read `references/feature-chain-methodology.md`.

Use as few durable test chains as possible to cover as many bad-case recurrence checks as possible. The durable testing unit is a feature or workflow chain, not an individual bad case.

A feature chain has:

- a clear input or entry point, such as clicking a button, submitting a task, opening a page, or starting a workflow
- ordered checkpoints that match the real user/business flow
- strict red and green conditions for the final result and any critical intermediate step
- linked bad cases attached to the specific checkpoint where they can recur

When a new bad case appears:

1. First ask whether it belongs to an existing feature chain.
2. Use `feature-chain-plan --query <bad-case or feature text>` as the default intake before proposing a new chain. This command is read-only; it says whether to review an existing chain or propose a new chain, shows match evidence for strong candidates, and must not approve or mutate coverage.
3. Use `feature-chain-suggest --query <bad-case or feature text>` when you only need raw candidate chains/checkpoints.
4. If a strong existing-chain match is semantically correct, attach the bad case to the matching chain node and strengthen that node's checkpoint instead of creating a separate long-lived test.
5. If no existing chain matches the feature or workflow, propose a new feature chain with the same short human-facing confirmation style as task cases.
6. Only approve or automate the chain after user confirmation, unless the user explicitly provided the exact test to implement.

Store feature chains in `.codex/context/test-hub/feature-chains.json`. Use:

```bash
python3 ~/.agents/skills/context-guard/scripts/context_guard.py feature-chain-add \
  --root <project> \
  --title "GPU 监控按钮" \
  --entry "点击 GPU 监控按钮" \
  --exit-check "打开包含有效 grafana_url 的监控页"

python3 ~/.agents/skills/context-guard/scripts/context_guard.py feature-chain-attach-bc \
  --root <project> \
  --chain-id FC-YYYYMMDD-001 \
  --node-title "后端返回监控 URL" \
  --bad-case BC-YYYYMMDD-001 \
  --check "grafana_url 不为空且前端没有卡住"

python3 ~/.agents/skills/context-guard/scripts/context_guard.py feature-chain-suggest \
  --root <project> \
  --query "GPU 监控点击后没有打开 grafana_url"

python3 ~/.agents/skills/context-guard/scripts/context_guard.py feature-chain-plan \
  --root <project> \
  --query BC-YYYYMMDD-001
```

`feature-chain-plan` is the safest first step for Codex. If it finds a strong existing match, it prints `action: review-existing-chain`, the candidate chain/checkpoint, short `match evidence`, and an after-confirmation attach-command skeleton. If it does not find a strong match, it prints `action: propose-new-chain` plus a compact confirmation prompt and a `feature-chain-propose` command skeleton, not `feature-chain-add`. The skeleton must include one concrete checkpoint (`--node-title` and `--check`) plus either `--bad-cases` when the query came from real bad-case coverage, or `--coverage-pending-reason` when it is only a user-described test target. When the query is a `BC-...` ID, the confirmation prompt must use the bad-case title or display summary instead of the opaque ID so the user can judge the business flow. It must not create feature chains, attach bad cases, or approve automation; the skeleton is only for use after user confirmation.

For natural-language test requests, the confirmation prompt should strip request scaffolding such as "写一个测试", "创建测试任务", "检验", "验证", or "每次开发完成后" and keep the short business behavior/risk phrase. If the user explicitly describes a workflow as "从 A 到 B，主要验证 C", preserve that entry/exit/risk shape in the confirmation prompt instead of replacing it with generic wording, and use the stated entry/exit to prefill the after-confirmation command skeleton. The stated risk may be printed as a suggested checkpoint, but it remains a confirmation aid only. Preserve the original query in debug output if useful, but the user-facing confirmation prompt should read like a compact test goal rather than a copied chat sentence.

`feature-chain-suggest` may receive a natural-language symptom or a `BC-...` ID. When a `BC-...` ID is provided, it should expand the query from `bad-cases.md` using that case's title, summary, phenomenon, trigger, root cause, and tags before scoring candidate chains. The command remains read-only; it suggests where to attach coverage but must not mutate the registry.

`feature-chain-add` defaults to `status: proposed` even when a command is supplied. A proposed chain is non-executable context and must not enter the always-run suite. Do not use `feature-chain-add --test-status approved` for `every-dev-completion` chains; the command must refuse that path because it skips the human confirmation and approval dry-run gates. Create or keep the chain as `proposed`, then use `feature-chain-approve` after the user confirms the flow and automation.

After the user confirms a candidate flow but before approving automation, prefer `feature-chain-propose --title ... --entry ... --exit-check ... --node-title ... --bad-cases ... --check ...`. It creates one proposed chain with seed bad-case coverage and a checkpoint, but writes no executable command and must not run in `dev-complete`.

If the user confirms a feature-oriented test target before any concrete bad case exists, use `feature-chain-propose` with `--coverage-pending-reason <why coverage is pending>` instead of inventing a fake bad case. This records a proposed chain and checkpoint for future attachment, but it is not active coverage, cannot be approved for `every-dev-completion`, and should be revisited when a real bad case or user-provided recurrence risk is available.

When a later bad case matches a `coverage_pending_reason` chain or checkpoint, prefer attaching it to that proposed checkpoint with `feature-chain-attach-bc` instead of creating a new chain. After the first real bad case is attached, the pending-coverage note should be removed from that checkpoint because it now has concrete recurrence coverage.

Before approving an automation command for a proposed chain, use `feature-chain-dry-run --chain-id <id> --command-text "<candidate command>"` when the command or checkpoint markers are not yet proven. Dry run checks the proposed chain's checkpoint markers, cleans success artifacts, preserves failure evidence, and must not mutate the chain, approve it, or add it to `dev-complete`.

After the user confirms the business flow and test design, promote the same chain with `feature-chain-approve --chain-id <id> --command-text "<approved command>"`. This is the only supported path for turning a proposed `every-dev-completion` feature chain into an approved automated test. The approval gate must refuse chains that have no checkpoint node, no checkpoint check text, no linked bad-case coverage, or no automated command. It must also run an approval dry-run before mutating the registry; if required checkpoint markers are missing, unknown, failing, blocked, or timed out, the chain must remain `proposed`. Do not bypass approval by hand-editing `feature-chains.json`, by using `feature-chain-add --test-status approved`, or by creating a duplicate approved chain.

Feature-chain commands may emit checkpoint markers so Test Hub can localize failures without Codex reinterpreting the whole log:

```text
CG_CHECKPOINT:<checkpoint title or id>:PASS
CG_CHECKPOINT:<checkpoint title or id>:FAIL:<short reason>
```

For feature-chain tests, any `FAIL` marker is a failed test even if the command exits 0. Use these markers for important workflow phases so the final report says which checkpoint broke, not only that the chain failed.

Checkpoint marker names must match a registered feature-chain checkpoint title or id. An unknown marker is a test-chain failure because it means the automated script has drifted from the approved feature-chain design. For non-English checkpoint titles, preserve the readable title; do not collapse distinct checkpoints into generic IDs such as `test`.

Approved feature-chain commands must emit a marker for every registered checkpoint unless that checkpoint is explicitly marked optional (`optional: true` or `required: false`). A missing marker is a test-chain failure because the run did not prove that the approved workflow step was exercised.

If a registered checkpoint should not be required on every run, update the existing checkpoint with `feature-chain-set-checkpoint --chain-id <id> --node-title <checkpoint> --required optional --reason <short reason>`. Do not hand-edit `feature-chains.json`, remove the checkpoint, or silently ignore missing markers. Use `--required required` when the user later wants that checkpoint restored to every-run coverage.

Use `feature-chain-list --verbose` to audit each chain's required/optional checkpoint counts and optional reasons without opening `feature-chains.json`.

Use `feature-chain-summary` as the fast coverage view before creating or updating test coverage. It shows the small map of feature chain -> checkpoint -> covered bad-case titles, plus any pending checkpoints waiting for a real bad case. It also prints lightweight reuse signals, such as coverage density and whether one workflow already covers multiple bad cases. Prefer this summary when deciding whether one existing chain can absorb a new bad case instead of creating another test.

Use `feature-chain-overlap` before approving automation or when several proposed chains look similar. It is a read-only duplicate-chain audit: it compares chain entries, exits, checkpoints, and linked bad cases, then prints candidate pairs that may belong to the same workflow. If it reports overlap, review whether one chain should absorb the other before creating or approving another always-run test.

Use `feature-chain-coverage` to see which registered bad cases are already covered by feature-chain checkpoints and which remain unassigned candidates. For each visible unassigned candidate, it may show the most likely existing chain and checkpoint based on the bad-case semantics. Strong suggestions should include short `match evidence` terms so Codex and the user can judge why the candidate was suggested. This is a planning aid, not a mandate to create tests for every unassigned bad case, and it must not automatically attach coverage or approve tests.

Use `feature-chain-candidates` when many bad cases remain unassigned and Codex needs a small set of feature-chain candidates instead of a long case list. It groups unassigned bad cases by shared feature tags, prefers more specific tag combinations over broad single tags, hides cases already covered by existing feature chains, suppresses low-value repeated candidate groups, and prints compact confirmation prompts with `new coverage` counts. Treat the output as planning hints only: ask the user which candidate flow is real before creating a proposed chain or automation.

When an approved feature-chain test fails or is blocked, the completion report must be actionable without rereading the full log: include the feature-chain title, the failed or missing checkpoint, the short reason, and the preserved evidence path. Keep long logs as evidence only.

If the user later says an approved feature chain should not run every time, use `feature-chain-set-policy --chain-id <id> --run-policy <policy> --reason <short reason>` on the existing chain. Do not delete the chain or create a duplicate just to change cadence.

Use `validate-feature-chains` after editing feature-chain records or before relying on a new chain as durable coverage. This validation is a quality gate only: it checks structural readiness, checkpoint coverage, approved automation, and artifact policy, but it does not decide whether the business test should exist.

Approved feature chains with `Run policy: every-dev-completion` are included in `dev-complete` and the Stop/SubagentStop hooks. Relevant-only or proposed chains remain context until the user approves or asks to run them.

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
- The Test Hub HTML is a status page only. Do not make users start tests from HTML buttons; approved tests run from the Stop/SubagentStop hooks or `dev-complete`.
- In the Test Hub HTML, show required/optional checkpoint policy for approved feature-chain tests inside that test card. Do not show proposed feature chains, empty checkpoint placeholders, or ordinary bad-case guards as tests.
- Task cases in `.codex/context/task-cases/` may also join the always-run set only when they are `approved | active | stable`, have `Run policy: every-dev-completion`, and include an automated entry command.
- At development completion, the Stop and SubagentStop hooks should invoke `scripts/context_guard.py dev-complete --root <project>` so registered tests run automatically. If running manually, use `dev-complete` over hand-running tests one by one. Use `--jobs <n>` only when parallel execution is safe for the registered tests.
- `dev-complete` must report passed, failed, and blocked tests. On full success it should clean the run artifacts; on failure or blocker it should preserve evidence under `.codex/context/test-hub/runs/`.
- If the user says a test should not run every time, update the registry or task case run policy instead of silently skipping it.
- If no approved every-dev-completion tests exist, the hub should report that clearly and exit successfully; Codex should not invent tests to fill the gap.

### Subagent Completion Fallback

Some Codex subagent transports may not fire project-local `SubagentStart` or `SubagentStop` hooks, and a subagent launched from a parent workspace may inherit the parent's working directory even when its product files live in a child folder. Treat hooks as supplemental and bind every spawned subagent to its real local project root immediately after `spawn_agent` returns:

```bash
python3 ~/.agents/skills/context-guard/scripts/context_guard.py subagent-register \
  --root <main/control workspace root> \
  --agent-id <agent id> \
  --project-root <subagent project root> \
  --task "<ordinary product task>"
```

Do not initialize or update Context Guard on an SSH server merely because the subagent edits remote files. `--project-root` is always the opened local Codex project folder; remote host/path belongs in task metadata.

If a completed agent is reused with `send_input` for another development round, run `subagent-register` again with the same agent ID and project root before sending or immediately after sending the new request. This marks the assignment active again without losing prior completion history.

When the main agent uses `wait_agent`, receives a completion notification, or closes a completed agent, pass the exact completion output back through the registered assignment:

```bash
python3 ~/.agents/skills/context-guard/scripts/context_guard.py subagent-complete \
  --root <main/control workspace root> \
  --agent-id <agent id> \
  --summary "<short completion summary>" \
  --evidence-file <file containing the exact subagent final output>
```

For simple integrations that cannot write an evidence file, `--summary` remains valid, but it loses detail and should not be preferred. The completion command resolves the registered child root, initializes folder context there, records one idempotent handoff/checkpoint, runs Test Hub `dev-complete`, archives concrete repair evidence, and attempts feature-chain auto-proposal from recorded bad cases. Replaying the same successful completion evidence must not duplicate roadmap nodes or bad cases. If Test Hub fails or blocks, the same completion may be retried after the fix.

When a subagent actually found or fixed a problem, its final output should include this compact evidence block in the folder language. Include it only for observed or reproducible problems, not speculative risks:

```text
CG_BAD_CASE: <short user-visible problem>
CG_PHENOMENON: <what actually happened>
CG_TRIGGER: <minimal reproduction>
CG_CAUSE: <known cause, if confirmed>
CG_FIX: <what changed>
CG_VERIFICATION: <real post-fix evidence>
CG_SCOPE: <feature/workflow>
```

The main agent must pass this exact output to `subagent-complete`; do not rewrite it into a generic "implemented X and smoke passed" summary. Context Guard records verified evidence as a concrete resolved bad case, or as open when verification is absent. It never turns that evidence into approved automation without user confirmation.

On Codex clients that emit the documented `SubagentStop` payload, the hook reads `agent_id` and `last_assistant_message` and invokes this same completion command automatically. The explicit main-agent call remains mandatory when the transport omits the hook, the completion notification arrives without a local hook record, or a resumed agent disappears before its final message is delivered. Native and fallback paths share the same completion fingerprint, so a successful event is archived once.

The completion-risk audit is not a license to invent a test suite. It exists to catch the failure mode where a subagent only reports "done / smoke passed" while a stateful, persistent, reset, replay, copy/export, or input-validation workflow has no bad-case input at all. When a completed subagent summary contains multiple high-risk workflow cues and the project has no parsable bad cases, `subagent-complete` may write one `risk-audit` bad-case candidate. Keep it conservative:

- Do not create a bad case for every small concern.
- Prefer real user-reported, observed, or reproducible bad cases when they exist.
- Treat risk-audit entries as open candidates until a later run confirms, merges, or closes them.
- Let `feature-chain-auto-propose` group those candidates into proposed feature chains; do not approve or execute them without user confirmation.

Do not rely on the subagent's final prose as proof that Context Guard ran. Verify the project has `.codex/context/` and, when approved tests exist, a current `.codex/context/test-hub/last-run.json`.

Each reusable check should answer four questions:

- Red condition: what output, visual state, error, or assertion means the bad case has recurred
- Green condition: what evidence means the bad case is absent
- Expected failure reason: why the check should fail when the old symptom is present, so Codex can distinguish a real recurrence from a broken test
- Guard type: script, native-test, manual, browser-screenshot, browser-dom, curl, cli, prompt, log-invariant, fixture, unit, integration, e2e, or another concise type
- Artifact policy: cleanup-on-pass, preserve-on-fail, or manual-preserve, including the log/temp path convention when relevant

In roadmap overview, both single-route and multi-route pages hide Test Chain lanes, compact test routes, and bad-case lanes by default. Ordinary linked bad-case guards are recurrence context, not user-approved tests, unless the user approved that guard as a test and the source record has a run policy. Do not fill user-facing overview coverage from roadmap node `Test chain:` history. Roadmap node `Test chain:` may keep compact checkpoint evidence in source/details, but it is not the primary bad-case recurrence chain.

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
3. Preserve the latest user prompt in `.codex/context/user-messages.md` when it contains durable context; if it contains a secret, store only a redacted pointer in public context and keep raw values local-only under `.codex/context/private/`.
4. Decide whether the user's latest message continues the current task, starts a substantially different task, reports a bad case, or changes expected behavior.
5. Locate and read `.codex/context/index.md`, `.codex/context/user-messages.md`, `.codex/context/roadmap.md`, `.codex/context/bad-cases.md`, and the relevant task folder if they exist.
6. If the request changes direction, park the previous task context before switching.
7. If the user reports a bad case, add or update the matching bad-case entry before fixing it.
8. Identify context entries relevant to the files, features, tests, or workflows likely to be touched.
9. Keep relevant context in mind while planning and editing.
10. Do not use the generated HTML roadmap as the context source.
11. In goal mode, call `get_goal` when available and align the active task with the goal objective before continuing work.
12. At the start of the user-visible answer, include a compact intake statement when useful: `Context intake: continuing <task>`, `Context intake: parked <task>, starting <task>`, `Bad-case intake: recorded BC-...`, `测试创建识别：...`, `User-message memory: saved`, or `Context intake: no active context`.

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
8. Treat the Stop/SubagentStop hook as a completion reliability gate, not a decorative reminder. If the hook asks for verification evidence, branch-task handling, or BC summary, satisfy it before finalizing.
9. Do not claim a bug is fixed because a build passed or a helper restarted. Verify the original user-visible symptom with the smallest real check that could falsify the claim.
10. If the work touched frontend, browser, UI binding, routing, HTML/CSS, or visual state, the self-check must include Browser/plugin/screenshot/DOM evidence tied to the original symptom, or an explicit blocker and residual risk.
11. Keep the self-check inside the verification budget unless risk is high. If the budget would be exceeded, prefer the original symptom check and the highest-risk relevant guard, then record the skipped checks as unrelated or deferred.
12. Stop condition: once the original symptom has a credible cause and the next useful action is a code/config/doc edit, do the edit. Do not run more discovery or guard commands unless the current evidence is contradictory or the edit target is still unknown.

### Turn End: Context Checkpoint

Run this before every final answer.

1. Re-read the project context index and relevant task folder.
2. Re-read `.codex/context/user-messages.md` and ensure the latest durable user wording has been promoted into the active task context, bad-case entry, or roadmap `User request:` when relevant.
3. Re-read the route map and make a roadmap checkpoint decision. If this turn changed direction, made a durable decision, fixed a problem, created a branch/fork, reached a user-visible milestone, or refreshed a stale route, create or update one concise node. If none of those apply, do not create a node; mention that no roadmap node was needed.
4. Update the active task summary with key decisions, bad cases, open questions, and next step.
5. If the task direction changed this turn, ensure the previous task is parked and the new task is current.
6. Run the End-of-Work Self-Check for the changed behavior or artifact before claiming success.
7. Select only the bad-case entries whose scope clearly overlaps the changed code, feature, route, or user-visible symptom. Do not select all resolved cases merely because they have recorded guards.
8. Run the full human-approved test registry whose `Run policy` is `every-dev-completion`. This includes approved task cases, approved native test commands, approved guard scripts, and approved manual/prompt checks. If any cannot run, record the blocker and residual risk; do not imply the always-run suite passed.
   - For automated approved tests, run the registered command/script rather than reconstructing the test manually.
   - If all approved automated tests pass, ensure their temp files were cleaned or note the script's cleanup policy.
   - If any approved test fails, preserve evidence, analyze the failed phase/checkpoint as a bad case, fix what is in scope, and rerun until the test passes or a non-actionable blocker is reached.
   - If blocked by credentials, unavailable services, permissions, hardware/resource limits, network, destructive-risk confirmation, or user-only judgment, ask or warn the user instead of looping.
9. For tests whose policy is `relevant-only`, `manual`, `release-only`, `goal-final`, `disabled-with-reason`, or a user-defined cadence, follow that policy exactly and mention skipped items only when they overlap the current change or affect confidence.
10. If a relevant task-oriented case exists, use its phase/checkpoint flow as the primary verification and note which checkpoints covered the linked bad cases. Otherwise re-run or re-perform the recorded guard for the highest-risk selected resolved entries, staying within the default budget of one primary check plus the complete always-run test set plus at most two extra relevant bad-case guards unless this is high-risk or the user requested exhaustive verification. Use the existing context, command, native test, script, screenshot/manual check, or visual inspection first.
11. If no recorded human-approved guard exists, do not invent active coverage. Use the lightest credible evidence for this turn, record any new durable guard as `proposed`, and ask for user confirmation with the short business-facing format before writing durable scripts or marking it approved. Existing user screenshots/logs/reproductions may serve as the red condition; a new failing test is optional, not mandatory.
12. If a resolved bad case recurs:
   - Mark it `recurred`.
   - Explain why it recurred: missed guard, incomplete fix, route conflict, test gap, refactor side effect, environment drift, or unknown.
   - Fix it immediately unless the user explicitly pauses the work or the recurrence is due to an approved technical route change.
   - Add or update the context and guard so the recurrence is easier to catch next time.
   - Re-run the verification and update the entry back to `resolved` only when evidence passes.
13. If a case is exempt because of a technical route change, mark it `superseded-by-route-change` and document the approved change.
14. If a bad case becomes frequent, add or update a high-frequency tag and warning note.
15. In goal mode, finish this checkpoint before calling `update_goal` to mark the goal complete or blocked.
16. If urgent or unrelated work is complete and a parked task exists, ask the user whether to resume the most relevant parked task.
17. If the Stop hook detects an explicit branch request, ensure the branch task and `Branch:`/`Parent:` roadmap node exist before finalizing.
18. If the Stop hook detects possible drift from the mainline architecture and no explicit branch exists, ask the user whether this should become a branch instead of silently continuing the mainline.
19. When a roadmap node is needed at turn end, prefer `scripts/context_guard.py checkpoint-roadmap-node --title <source title> --display-title <short human title> --user-request <short summary of the user's actual request> --progress-summary <readable current progress> --method-summary <readable method> --branch <Main or route> --level <major|checkpoint> --outcome <one-line source progress> --next-step <next>` instead of hand-editing. Use `create-branch-task` first when the user explicitly asks for a new branch.
20. Run `scripts/context_guard.py validate-bad-cases` only after updating bad-case entries, changing bad-case schema/renderer/hook behavior, or intentionally auditing the register; do not run it on unrelated code turns. Historical resolved cases without the new fields may remain warnings until touched; use `--strict` only when intentionally migrating or auditing all resolved cases.
21. Run `scripts/context_guard.py validate-roadmap-maintenance` only after adding route nodes, changing roadmap maintenance rules, or before showing the roadmap; if it reports too many hidden checkpoints after a route's latest visible node, promote or add a major node before finalizing.

## Completion Report

At the end of every response, include a compact context summary when development work, context intake, task switching, bad-case intake, or a register was involved. Keep it one line for unrelated conversation.

- Context folder used.
- User-message memory updated or skipped, with secret handling summarized only as redacted/local-only.
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
