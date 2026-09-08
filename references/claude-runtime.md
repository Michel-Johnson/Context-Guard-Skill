# Managed Claude CLI receiver

Claude uses `CLAUDE_CONFIG_DIR` for settings and installed Skills. The installer
honors that variable first and retains `CLAUDE_HOME` as a legacy fallback. Keep
executor and CI profiles and real Session IDs separate; use one shared project
backend and device heartbeat service, not a timer in every Hook.

After the real Claude Session has emitted its native startup Hook and bound to
the project, the local operator can configure its receiver:

```sh
context-guard workbench claude --root <worktree> --session <uuid> --input <private-runtime.json>
```

The private input contains absolute `command`, `root`, `configDir` and
`environmentFile` paths, optional command-prefix `args`, plus `name`, `model` and
`role` (`executor` or `ci`). `resumeExisting:true` is required when the native
Session already has a persisted conversation. `systemPromptFile` points to the
installed role prompt. The role field identifies the local runner; it does not
issue a Cloud CI or Coordinator capability.

For CI, also configure `executorSessionId` and an exact `ciCommands` allowlist
(for example `npm test` and `npm run build`). The CI worktree must differ from
the developer worktree. Cloud's private project Coordinator configuration must
declare `ciReceivers[ciSessionId] = {executorSessionId, worktreeId}`. A body field
or local role label cannot grant that authority. The backend reuses device login
and the existing persistent transport; it does not start another heartbeat.

On `ci.request`, the receiver checks out the handed-off SHA only in the clean CI
worktree. `map ci context` returns the logical developer Session, task, exact SHA,
immutable reference versions and allowed commands. `map ci exchange --input -`
accepts normal protocol JSON; the backend supplies that logical Session rather
than changing the native CI Session identity. Allowed operations are
`object.read`, evidence-only `object.put` with refs prefixed `ci:<ciSessionId>:`,
and `ci.result` for this task and SHA. A changed HEAD or dirty worktree prevents
a CI result. CI Hooks allow only the configured test commands without a Plan;
business-source writes and development Plans remain forbidden.

## Reviewed developer tasks

`map task plan --input <file>` accepts `{operationId,content:{paths,steps}}`.
It records an immutable Plan at the actual HEAD and requests Coordinator review.
Keep the operation ID after an uncertain reply; use a new ID for a revised Plan.
Approval names the exact task, Plan version and source SHA. Read `map execution`
and pass its `taskId`, `planRef` and `planVersion` to the usual `plan-start` input.

After committing the delivered code, `map task handoff --input <file>` accepts
`{operationId,ciTodo:{items:[...]},unitTests:[...],experiences:[...]}`. Test evidence
must describe actual runs; experiences may be empty if nothing reusable was
learned. The command refuses a dirty worktree, persists immutable objects and
reports their references with the exact commit SHA. It does not assert CI success,
human acceptance or a merge. The Coordinator consumes the existing protocol
journal to receive brief decisions, Plan submissions and CI results; model
failures remain paused until an explicit retry.

`environmentFile` is private JSON containing only the required `ANTHROPIC_*`
provider fields and optional `CLAUDE_CODE_SUBAGENT_MODEL` and
`CLAUDE_CODE_ATTRIBUTION_HEADER`. Keep credentials out of runtime arguments,
prompts, logs and Map data. `permissionMode:"bypassPermissions"` is accepted only
with `isolated:true`; the operator must actually provide an isolated execution
environment. This flag does not install or create a sandbox.

Cloud remains responsible for task ordering. The local receiver permits one
native turn per Session; a busy receiver leaves the next notification pending
in the existing inbox. Accepted invocations have durable identities. A local
backend restart can recover a lost acknowledgement from the receiver's saved
intent without launching the same prompt again. Native workers outlive backend
restarts; they do not own another heartbeat service.

An interrupted or uncertain native turn remains visible and is not automatically
re-executed. Do not delete its saved intent to retry. Controlled recovery and CI
delegation must be verified before claiming full lifecycle support. Native turn
completion is not a successful task, human acceptance, GitHub merge, or archive.
