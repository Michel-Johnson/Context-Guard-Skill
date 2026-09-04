# Cloud Sync interface

Read this reference only when a project is connected to Context Guard Cloud or a
`WORK_IMPACT` conflict must be resolved.

For first-time server installation, project enrollment, upgrades, and host
migration, read `references/cloud-deployment.md` first.

This document describes two protocols. The current protocol synchronizes each
bound Session Map through the workbench. The old project-wide Map protocol is
kept temporarily for compatibility and must not be started beside the workbench
for the same Session. Full development-memory rules remain in
`references/server-memory.md`.

## Model

Cloud is a directory of projects. It does not merge projects into one Map. Each
project has a committed-main baseline and independent Session Maps. A Session
can write only its own Map; publishing a Session does not silently change main.

The workbench is the only background sync owner. Agents use the normal Map API;
they do not generate temporary synchronization scripts. For every local edit the
workbench first fsyncs an outbox entry, then sends it to Cloud. Cloud persists the
snapshot, receipt and timestamped event atomically before acknowledging it.

The local repository remains the working copy. The current Session sync state is
private and separated by project worktree and Session:

```text
<git-common-dir>/context-guard/session-memory/<session-hash>/remote-sync/
  state.json        # status, server version and last received cursor
  server-base.json  # last acknowledged common base
  outbox.json       # durable unsent/unacknowledged operation
  conflict.json     # base/local/remote documents for manual resolution
```

This directory must never be committed.

The legacy Map-only client still uses `.codex/context/private/cloud-sync/`.

## Session connection

Private memory connection is configured once by the workbench deployment flow.
After a real Session is bound, `SessionStart` runs:

```bash
context-guard sync ensure --root <project> --session <session-id>
```

This ensures the project workbench is running. It does not start a second sync
daemon. Status is read without exposing the project token:

```bash
context-guard sync status --root <project> --session <session-id>
```

The workbench status icon means: spinner = connecting/pending, check = server
acknowledged, exclamation = conflict/error. A successful server disk write whose
response has not reached the client is still shown as pending.

## Legacy project Map connection

An administrator creates or enrolls a project once and gives the project its
scoped sync token. Connect explicitly:

```bash
context-guard sync connect --root <project> --url <cloud-origin> \
  --project <project-id> --token <project-token>
```

If both sides already have different Maps, the command stops with
`INITIAL_SYNC_CONFLICT`. Re-run with exactly one of `--pull` or `--push`
after deciding which side is authoritative. First connection to an empty cloud
project uploads the local Map.

## Session event protocol

The private service exposes project-token-authenticated routes:

```text
GET  /v1/projects/:project/sessions/:session/changes?after=<cursor>
GET  /v1/projects/:project/sessions/:session/events?after=<cursor>
POST /v1/projects/:project/sessions/:session/map
```

Each Session has its own monotonically increasing cursor. Events are appended to
the same durable memory file as the snapshot and idempotency receipt. The SSE
listener subscribes before replaying the durable log, so a commit during connect
cannot fall into a gap. Reconnect sends the last acknowledged cursor.

Map writes carry a stable `operationId`, `baseVersion` and operations. Retrying
the same body after a lost response returns the original receipt. Reusing the ID
with different content is rejected.

Publishing removes only the active generation. If that same real Session edits
again, the workbench first creates its next generation from the latest Main
snapshot, then resumes ordinary Map patches. `SESSION_REOPEN_REQUIRED` triggers
this background path; `SESSION_BASELINE_CONFLICT` or overlapping Main/local fields
preserve the local draft for review. Older generation receipts remain idempotent.

## Legacy project event protocol

Each project event has a monotonically increasing `seq`, stable `eventId`,
`projectId`, type, actor, version, timestamp and affected scope:

```json
{
  "seq": 42,
  "eventId": "uuid",
  "projectId": "context-guard",
  "type": "map.committed",
  "actor": { "kind": "sync", "sessionId": "thread-id" },
  "baseVersion": "old",
  "version": "new",
  "scope": {
    "nodeIds": ["N460"],
    "fields": ["purpose"],
    "paths": ["scripts/cloud/server.mjs"],
    "wildcard": false
  },
  "operations": []
}
```

The listener uses SSE and resumes after its received cursor. Events are appended
to the private inbox immediately. They are not injected into the Agent prompt
one by one. A complete snapshot is fetched only for first connection, explicit
pull, cursor recovery or conflict recovery.

## Development checkpoints

Before changing code or Map state:

```bash
context-guard sync prepare --root <project> --session <session-id> \
  --nodes N460 --paths scripts/cloud/server.mjs
```

`prepare` drains current cloud state, records `baseSeq` and `baseVersion`,
and opens a durable development window. `plan-start` invokes it once, after plan
approval and before implementation. Later `PostToolUse` hooks only record local
observations; they do not perform remote synchronization for every file.

After development and verification:

```bash
context-guard sync finish --root <project> --session <session-id>
```

`finish` checks every remote Map event after `baseSeq` in one serialized
server transaction:

- Disjoint node/field/path scopes are rebased automatically.
- Overlapping scope returns `WORK_IMPACT`; local files are preserved and the
  window remains `conflict`/unverified.
- A successful result records `work.completed`, updates the cloud snapshot,
  and refreshes the local Map from that snapshot.

`sync checkpoint` performs the same impact check without completing the
window. `sync track --paths ...` adds repository-relative files to its scope.
For lifecycle-managed work use `plan-finish`, which checks the archive receipt,
tracks the plan scope, checkpoints and finishes in that order. Direct `sync finish`
does not manufacture a local plan completion receipt. See the plan command schema
in `workbench-interface.md`.
Every lifecycle observation and plan transition is also written with occurrence
and recording timestamps plus stable event/plan IDs for later reconstruction.

## Automatic recovery and conflicts

```bash
context-guard sync status --root <project> --session <session-id>
context-guard sync ensure --root <project> --session <session-id>
```

The workbench represents status only:

- spinner: connecting, receiving, or pending
- check: synchronized
- exclamation: conflict or failure

Network failure leaves the outbox on disk and reconnect uses exponential backoff
with jitter. Starting while Cloud is unavailable follows the same recovery path.
Edits to different node fields are merged automatically. Changes to the same
node field, or delete-vs-edit, create `conflict.json` containing base, local and
remote documents; the local draft is never overwritten.

Never solve a conflict by deleting private state or inventing a new operation
ID. Review the three saved versions, make an explicit resolution, then restart
the Session sync. The old development-window `WORK_IMPACT` process remains only
for callers of the legacy project Map protocol.

## Cloud authorization

- Admin token: create projects and rotate project tokens only.
- Project token: one project's Map, events and development windows only.
- Workbench token: browser editing only; exchanged for an HttpOnly cookie at
  `/auth?token=...&next=/`.
- Public pages and project directory are read-only.

The bootstrap response and generated HTML must never contain an admin or project
token.
