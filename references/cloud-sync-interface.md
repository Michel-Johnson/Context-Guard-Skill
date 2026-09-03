# Cloud Sync interface

Read this reference only when a project is connected to Context Guard Cloud or a
`WORK_IMPACT` conflict must be resolved.

For first-time server installation, project enrollment, upgrades, and host
migration, read `references/cloud-deployment.md` first.

This document describes Map/event synchronization, including Session Map
isolation. It does not yet cover complete Markdown record storage. Projects that
use the private server as authority for all memory must also follow
`references/server-memory.md`.

## Model

Cloud is a directory of projects. It does not merge projects. In isolated mode,
each project owns one Main Map plus one Map per Session. All Sessions reads Main.

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

In isolated mode, `prepare` refreshes that Session from Main, stores its scoped
base version, and opens a durable development window. The Codex hook runs it once at the first
mutating tool of a plan. Later `PostToolUse` hooks only add observed paths with
`sync track`; they do not perform remote synchronization for every file.

After development and verification:

```bash
context-guard sync finish --root <project> --session <session-id>
```

In legacy mode, `finish` checks remote events as described below. In isolated
mode, it three-way merges only that Session Map and never writes Main:

- Disjoint node/field/path scopes are rebased automatically.
- Overlapping scope returns `WORK_IMPACT`; local files are preserved and the
  window remains `conflict`/unverified.
- A successful result records `work.completed`, updates the cloud snapshot,
  and refreshes the local Map from that snapshot.

After the PR is merged, publish the Session Map to Main explicitly:

```bash
context-guard sync publish --root <project> --session <session-id> \
  --commit <full-sha-on-main>
```

The Cloud server freshly fetches its configured source repository, verifies the
commit is an ancestor of `main`, and then applies a conflict-detecting merge.

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
- Project token: enroll Sessions, synchronize Main, and request verified publication for one project.
- Session token: read/write only one Session Map; generated once and kept in private local config.
- Workbench token: browser editing only; exchanged for an HttpOnly cookie at
  `/auth?token=...&next=/`.
- In private mode, pages and the project directory require the workbench cookie;
  scoped API clients use their project or Session token.

The bootstrap response and generated HTML must never contain an admin or project
token.
