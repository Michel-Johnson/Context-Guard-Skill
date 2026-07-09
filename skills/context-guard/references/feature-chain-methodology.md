# Feature Chain Methodology

Use feature chains when the goal is to prevent fixed bad cases from reappearing without creating one durable test per bad case.

## Core Idea

The durable test unit is a user-visible feature or workflow. A bad case is coverage attached to one checkpoint inside that workflow.

```text
Feature chain
  Entry: the real trigger users or Codex will perform
  Checkpoint 1: expected intermediate state
    Covers: BC-...
  Checkpoint 2: expected transition or output
    Covers: BC-..., BC-...
  Exit check: strict final green condition
```

## Creation Rule

When a bad case appears:

1. Identify the feature entry that can reproduce or guard the symptom.
2. Search existing feature chains for the same entry, workflow, component, route, or service. Use the read-only planning helper first:

   ```bash
   python3 ~/.agents/skills/context-guard/scripts/context_guard.py feature-chain-plan --root <project> --query "<bad case or feature text>"
   ```

   The query can be natural language or a `BC-...` ID. The planner is read-only: it either says `action: review-existing-chain` with match evidence and an after-confirmation attach-command skeleton, or `action: propose-new-chain` with a compact user-confirmation prompt and a `feature-chain-propose` command skeleton. The proposed skeleton must contain a checkpoint and explicit coverage state: use `--bad-cases` for a real bad-case seed, or `--coverage-pending-reason` for a user-described test target that has no concrete bad case yet. If the input is only a `BC-...` ID, the prompt should describe the bad case by title or summary instead of asking the user to confirm an opaque ID. It must not create a feature chain, attach a bad case, or approve automation; run the skeleton only after user confirmation.

3. Use `feature-chain-suggest` when you only need raw candidate chains/checkpoints. If only a bad-case ID is available, the helper expands it from `bad-cases.md` first so matching uses the case title, summary, phenomenon, trigger, cause, and tags rather than the opaque ID alone.
4. Use `feature-chain-coverage` when you need the whole register view. It should show covered cases, unassigned candidates, and possible existing chains for visible candidates without changing the registry. Strong suggestions should include short match evidence terms; if the evidence is weak or unreadable, treat the suggestion as planning noise rather than coverage.
5. Use `feature-chain-candidates` when the unassigned list is too large. It groups unassigned bad cases by shared feature tags, prefers more specific tag combinations over broad single tags, suppresses repeated groups that add little new coverage, and proposes a small set of candidate feature chains. Treat `new coverage` as the key signal: a candidate with high total count but low new coverage may be a subcase of an earlier chain. It must not create, attach, or approve anything; it only helps choose which user-visible flow is worth designing.
6. Use `feature-chain-overlap` before approving automation, or whenever several proposed chains sound similar. It is read-only and flags pairs that likely describe the same workflow. If it reports overlap, merge the intent or extend one chain before creating another always-run test.
7. If a chain exists and the match is semantically correct, attach the bad case to the closest checkpoint and tighten that checkpoint.
8. If no chain exists, propose a new chain in one short business-facing sentence and wait for user confirmation before approving or automating it.

For natural-language test requests, keep the user's business intent but remove the request wrapper before writing the confirmation prompt. For example, `写一个测试，检验每次开发完成后 Markdown 编辑器里的单行、多行和矩阵公式都能正常渲染` should become a compact subject such as `Markdown 编辑器里的单行、多行和矩阵公式能正常渲染`, not a verbatim copy of the whole chat sentence. This keeps the prompt useful for human confirmation while avoiding agent-invented workflow details.

When the user already gives a workflow shape, preserve it. A request like `创建一个测试任务：从编辑器输入 Markdown 到预览正确渲染，主要验证公式渲染回归` should be confirmed as `从「编辑器输入 Markdown」到「预览正确渲染」，主要验证「公式渲染回归」`. Do not replace explicit entry/exit/risk wording with generic "相关入口到正确结果" language.

For this explicit shape, `feature-chain-plan` may prefill the after-confirmation `feature-chain-propose` skeleton with the stated entry and exit check, and may print the stated risk as a suggested checkpoint. This is still only a confirmation aid: it must not create the chain, approve automation, or invent missing checkpoint details before the user confirms the business flow.

CLI rule: `feature-chain-add` creates `status: proposed` by default. Do not treat this as an approved test. `feature-chain-add --test-status approved` is not allowed for `every-dev-completion` chains because it skips the user confirmation and approval dry-run gates. Use `feature-chain-approve` on the same proposed chain instead.

After the user confirms a candidate flow, use `feature-chain-propose` when you need to record a safe draft with seed bad-case coverage:

```bash
python3 ~/.agents/skills/context-guard/scripts/context_guard.py feature-chain-propose \
  --root <project> \
  --title "<confirmed feature title>" \
  --entry "<confirmed user-visible entry>" \
  --exit-check "<confirmed strict final green condition>" \
  --node-title "<confirmed checkpoint>" \
  --bad-cases "BC-..., BC-..." \
  --check "<checkpoint recurrence check>"
```

This command creates only a `proposed` chain. It records the user-confirmed shape and seed bad cases, but it does not add an executable command and must not enter `dev-complete` until `feature-chain-approve` is run with user-approved automation.

If the user confirms the feature flow before any concrete bad case exists, keep the same command but replace `--bad-cases ...` with `--coverage-pending-reason "<why there is no linked bad case yet>"`. This records the draft so it is not lost, but it is not recurrence coverage and cannot be approved for `every-dev-completion` until a real bad case is attached to a checkpoint.

When a later bad case appears, run `feature-chain-plan` first. If it points to a coverage-pending chain/checkpoint, attach the bad case there with `feature-chain-attach-bc` and tighten the checkpoint text. The attach step should clear the pending-coverage note, because the checkpoint now has real bad-case coverage.

The expected lifecycle is:

1. `feature-chain-plan` turns user wording or a bad-case ID into a read-only confirmation prompt.
2. After user confirmation, `feature-chain-propose` records a non-executable draft with either linked bad cases or a coverage-pending reason.
3. Later bad cases are routed through `feature-chain-plan` and attached to the nearest existing checkpoint when semantically correct.
4. `feature-chain-summary` gives the fast coverage map; `feature-chain-overlap` checks duplicate workflow coverage before approval.
5. `feature-chain-approve` is the only path into the always-run set and must pass the checkpoint dry run.
6. `dev-complete` runs the approved chain with structured checkpoint markers and cleans success artifacts.

This lifecycle is the core experiment: fewer feature chains should cover more bad-case recurrence checks without Codex inventing a broad test suite.

Multi-project trials are the sanity check for this method. These trials must start from fresh sandbox projects instead of reusing an existing project, existing context folder, or previous test registry; otherwise the result may only prove that old context happened to work. The sandbox themes should also be genuinely different, such as a life utility, a creative tool, and a game or interaction, not merely three variants of the same engineering workflow. In small linear flows, one feature chain with two to four checkpoints can cover about three related bad cases and localize the failed phase. Treat planner checkpoint suggestions as hints, not business truth: Codex or the user must attach each bad case to the real phase where it can recur. When the workflow has queues, retries, multiple workers, recovery branches, or cross-process cleanup, upgrade the design to a task case instead of stretching a simple feature chain.

A single-chain trial is not enough to validate Context Guard itself. A system-level regression should include at least two independent approved feature chains in one fresh project, then prove that `dev-complete` runs both, reports one chain failure without hiding the other chain's pass result, preserves the failing evidence, and returns to all-pass after the same chain is fixed. This checks the Test Hub orchestration layer rather than only the lifecycle of one feature chain.

Before approving automation, use a dry run when the proposed command or checkpoint markers need validation:

```bash
python3 ~/.agents/skills/context-guard/scripts/context_guard.py feature-chain-dry-run \
  --root <project> \
  --chain-id FC-YYYYMMDD-001 \
  --command-text "<candidate command>"
```

Dry run executes the candidate command against the proposed chain's registered checkpoints, reports missing/failed/unknown checkpoint markers, cleans success artifacts, and preserves failure evidence under `.codex/context/test-hub/dry-runs/`. It does not approve the chain, does not write the command into `feature-chains.json`, and does not add the chain to `dev-complete`.

Dry-run evidence paths must be unique per run. Fast repeated or parallel dry runs must not reuse or overwrite a previous failure directory, because the preserved evidence is what lets Codex locate the failed checkpoint without reinterpreting the whole task.

## Approval Rule

After the user confirms the feature flow and test design, promote the existing proposed chain with:

```bash
python3 ~/.agents/skills/context-guard/scripts/context_guard.py feature-chain-approve \
  --root <project> \
  --chain-id FC-YYYYMMDD-001 \
  --command-text "<approved command>"
```

Approval is a safety gate and the only supported path from proposed feature-chain automation to `every-dev-completion`. It refuses a chain that has no checkpoint, no checkpoint check text, no linked bad-case coverage, or no automated command when the run policy is `every-dev-completion`. For `every-dev-completion` automation, approval must also run a dry-run preflight before mutating the registry. If the command misses a required checkpoint marker, emits an unknown marker, emits a `FAIL` marker, times out, or hits a blocker, approval fails and the chain stays `proposed`. Do not bypass this by hand-editing `feature-chains.json`, using `feature-chain-add --test-status approved`, or creating a second approved chain.

## Policy Rule

After approval, the user's cadence still wins. If the user says a feature chain should not run after every development turn, update the existing chain instead of deleting or duplicating it:

```bash
python3 ~/.agents/skills/context-guard/scripts/context_guard.py feature-chain-set-policy \
  --root <project> \
  --chain-id FC-YYYYMMDD-001 \
  --run-policy relevant-only \
  --reason "User said this chain is only needed when touching GPU monitor flows."
```

Keep the reason short and human-readable. Use `disabled-with-reason` only when the user asks to disable the chain or it cannot be run safely.

## Design Heuristic

A good chain has:

- one clear entry point
- one realistic flow, not a pile of unrelated checks
- two to five checkpoints
- strict red and green conditions
- failure localization, so the runner reports which checkpoint broke
- cleanup-on-pass and preserve-on-fail behavior

Avoid:

- one script per bad case when one feature flow can cover them
- broad suites that run unrelated product areas
- checks that only prove code executed but cannot catch the old symptom
- durable tests written from agent guesses without user confirmation

## Storage

Store chain metadata in:

```text
.codex/context/test-hub/feature-chains.json
```

Store large scenario specs in `.codex/context/task-cases/` only when the workflow needs richer phases, logs, or human-readable execution notes.

## Execution

Approved chains with `status: approved | active | stable` and `run_policy: every-dev-completion` are part of Test Hub. At development completion, run them through:

```bash
python3 ~/.agents/skills/context-guard/scripts/context_guard.py dev-complete --root <project>
```

The runner should execute the approved command with minimal Codex reinterpretation, clean success artifacts, preserve failure evidence, and report the failed checkpoint or blocker.

A feature-chain experiment is not complete just because one happy path passes. It should prove the closed loop: one chain covers multiple bad cases, a failing checkpoint preserves evidence with an actionable reason, and the fixed path passes while cleaning temporary artifacts.

When an approved chain fails, do not design a new test to prove the same workflow. Treat the failed checkpoint as the recurrence signal, fix the cause, and rerun the same approved chain. A good runner makes this loop cheap by emitting readable checkpoint markers, preserving only the useful failure evidence, and cleaning success artifacts after the rerun passes.

Feature-chain commands can report phase-level status with lightweight markers:

```text
CG_CHECKPOINT:<checkpoint title or id>:PASS
CG_CHECKPOINT:<checkpoint title or id>:FAIL:<short reason>
```

Test Hub treats any `FAIL` marker as a failed feature chain, even if the command exits 0. Prefer these markers when one command covers several checkpoints, because the preserved result will point to the broken workflow step instead of only saying that the whole command failed.

Marker names must match registered checkpoint titles or ids. Unknown markers fail the chain because they usually mean the script no longer matches the approved workflow. Keep non-English checkpoint titles readable and distinct; do not collapse them into generic ids.

Approved feature-chain commands must report every registered checkpoint unless a checkpoint is explicitly optional (`optional: true` or `required: false`). Missing markers fail the chain, because an unreported checkpoint was not proven to run.

If the user or business flow says one checkpoint should not be required every time, change that checkpoint explicitly instead of weakening the whole chain:

```bash
python3 ~/.agents/skills/context-guard/scripts/context_guard.py feature-chain-set-checkpoint \
  --root <project> \
  --chain-id FC-YYYYMMDD-001 \
  --node-title "前端打开监控页" \
  --required optional \
  --reason "Only runs in browser integration environment."
```

Use `--required required` to restore the checkpoint to every-run coverage. This keeps the chain strict by default while allowing intentional, documented exceptions.

Audit required/optional coverage without opening JSON:

```bash
python3 ~/.agents/skills/context-guard/scripts/context_guard.py feature-chain-list --root <project> --verbose
```

Audit the compact coverage map before creating new coverage:

```bash
python3 ~/.agents/skills/context-guard/scripts/context_guard.py feature-chain-summary --root <project>
```

This is the quickest way to see whether a small number of feature chains already covers several bad cases, and which checkpoints are still waiting for a real bad case before approval.
Treat the `coverage density`, `reuse signal`, and `next:` lines as decision aids: they should push Codex toward reusing or extending an existing workflow when possible, not toward creating another standalone test.

Audit possible duplicate feature chains before approval:

```bash
python3 ~/.agents/skills/context-guard/scripts/context_guard.py feature-chain-overlap --root <project>
```

This is a route-choice guard, not a test runner. It compares existing chain wording and linked bad cases, then prints pairs that may be the same workflow. Use it to avoid turning one business flow into multiple always-run tests.

Audit bad-case coverage across chains without mutating records:

```bash
python3 ~/.agents/skills/context-guard/scripts/context_guard.py feature-chain-coverage --root <project>
```

Use this to decide whether a new bad case should attach to an existing chain or remain a standalone guard. Treat unassigned cases as candidates, not as required new tests.

## Quality Gate

After editing feature chains, run:

```bash
python3 ~/.agents/skills/context-guard/scripts/context_guard.py validate-feature-chains --root <project>
```

This gate checks structure, not business judgment. It catches approved chains that are missing an entry point, exit check, automated command, checkpoint nodes, checkpoint check text, linked bad-case coverage, or a clear artifact policy. It does not create tests, approve tests, or decide whether the user's workflow deserves a durable chain.
