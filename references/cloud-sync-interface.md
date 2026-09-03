# Cloud Sync interface

Read this reference only when a project is connected to Context Guard Cloud or a
`WORK_IMPACT` conflict must be resolved.

For first-time server installation, project enrollment, upgrades, and host
migration, read `references/cloud-deployment.md` first.

This document describes the existing Map/event protocol, not full development
memory synchronization. Projects requiring a private server as the authority for
all memory must also follow `references/server-memory.md`. Session isolation,
complete record storage and main-baseline publication are not implemented by
connecting every worktree to a single mutable Cloud Map.

## Model

Cloud is a directory of projects. It does not merge projects into one Map. Each
project owns one independent snapshot and one ordered event stream.

The local repository remains the working copy. Credentials, cursors, inboxes and
development windows live under:

```text
.codex/context/private/cloud-sync/
```

This directory must never be committed.

## Connect

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

## Event protocol

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
and opens a durable development window. The Codex hook runs it once at the first
mutating tool of a plan. Later `PostToolUse` hooks only add observed paths with
`sync track`; they do not perform remote synchronization for every file.

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
Every lifecycle observation and plan transition is also written with occurrence
and recording timestamps plus stable event/plan IDs for later reconstruction.

## Status and recovery

```bash
context-guard sync status --root <project>
context-guard sync pull --root <project>
context-guard sync ensure --root <project>
```

The workbench represents status only:

- spinner: connecting, receiving, or pending
- check: synchronized
- exclamation: conflict or failure

Never solve a conflict by deleting private state or inventing a new work ID.
Read the impact list, re-read the affected nodes/files, reconcile the local
change, then retry the same window. Operation IDs and work IDs are idempotency
keys.

## Cloud authorization

- Admin token: create projects and rotate project tokens only.
- Project token: one project's Map, events and development windows only.
- Workbench token: browser editing only; exchanged for an HttpOnly cookie at
  `/auth?token=...&next=/`.
- Public pages and project directory are read-only.

The bootstrap response and generated HTML must never contain an admin or project
token.
