# Task Case Template

Use task cases for realistic multi-step verification. A task case should simulate a full user or agent workflow and log phase-level checkpoints so failures identify the broken step. Test design is human-owned: Codex can draft a proposal, but a durable task case stays `proposed` until the user confirms it.

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
- Blocker handling: credentials | external service | permissions | resource limits | network | destructive confirmation | user judgment | none

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

Rules:

- When the user explicitly asks to create, write, generate, design, or add a test/task case, begin the user-visible response with a compact intake line such as `测试创建识别：...` before proposing or implementing the case.
- Prefer one task case with clear checkpoints over many disconnected bug-level scripts when the same workflow is being exercised.
- Link bad cases to the checkpoint that catches them.
- Keep the task case realistic enough to match actual product or agent usage.
- Once a test is approved, automate it when it can be safely encapsulated. Future Codex turns should run the registered entry instead of reinterpreting the test design.
- Automated approved tests should be registered in `.codex/context/test-hub/registry.json` or represented by this approved task-case file with `Run policy: every-dev-completion` and an executable `Entry command/prompt`.
- At development completion, run the approved always-run set through `context_guard.py dev-complete --root <project>` instead of manually reconstructing each test.
- Automated task cases should clean temporary files after full success and preserve the smallest useful evidence on failure.
- If the automated case fails, Codex should analyze the failed phase/checkpoint, record or update the bad case, fix in scope, and rerun the same approved test until it passes or a non-actionable blocker is reached.
- If blocked by credentials, unavailable services, permissions, hardware/resource limits, network, destructive-risk confirmation, or user-only judgment, stop and ask or warn the user with the blocker and evidence path.
- Keep checkpoint logs concise and useful for localizing failure.
- Keep the case in `proposed` state until the user confirms the design.
- Once the user confirms the design, default `Run policy` to `every-dev-completion`; lower the cadence only when the user explicitly asks.
- In goal mode, use human-approved task cases as phase gates and log phase progress; do not create broad new scripts or active task cases without confirmation unless the user explicitly asked for that exact test.
