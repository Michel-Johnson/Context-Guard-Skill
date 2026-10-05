# Cloud Session synchronization

Read this reference for a Cloud-connected project or a preserved synchronization
conflict. Memory authority and publication remain defined in `server-memory.md`.

## One connection, isolated Sessions

Use `context-guard workbench connect --url <origin> --root <project> --session
<actual-session-id> --wait` for browser authorization. Once connected, ordinary
`workbench --root <project> --session <actual-session-id>` reuses the project
connection. The workbench owns the background connection; never start a separate
project-wide Map daemon or point a Session at Main to bypass publication.

Local edits enter a durable outbox. Cloud changes are read through events with
heartbeat recovery. Receipts, queues and cursors remain isolated per Session:

```text
<project-shared-dir>/session-memory/<session-hash>/remote-sync/
  state.json
  server-base.json
  outbox.json
  conflict.json
```

These are private data, not repository files. The workbench preserves uncertain
requests and retries their original operation IDs. Independent edits can merge;
overlapping edits preserve base, local and remote documents for review.

## Commands and confirmation

```bash
context-guard sync status --root <project> --session <actual-session-id>
context-guard sync ensure --root <project> --session <actual-session-id>
context-guard sync prepare --root <project> --session <actual-session-id>
context-guard sync checkpoint --root <project> --session <actual-session-id>
context-guard sync finish --root <project> --session <actual-session-id>
```

`status` reads saved Session synchronization state without printing credentials;
it is not a fresh server receipt. `ensure` reuses the workbench. `prepare`, `pull`
and `checkpoint` use the current memory read/reconciliation path. `finish` uploads
the Session through the durable memory path and returns `confirmed: true` only
with a server snapshot version. None of these commands publishes Main or records
human acceptance. Lifecycle `plan-finish` still enforces archive and review gates.

The retired project-wide development windows are not supported. Plan scope stays
in the lifecycle plan; `sync track`, `sync connect` and `sync serve` must not start
the old transport. Use `workbench connect` for authentication.

## Upgrades and conflicts

Old `.codex/context/private/cloud-sync/` data and shared `cloud-sync/` configuration
are inspected read-only. Unconfirmed work, a changed draft, unreadable state or a
conflict returns `UPGRADE_REQUIRED` with reason `legacy-sync-state-pending`.
Preserve and reconcile those records; do not delete them or infer that an old
project Map belongs to a particular Session. A configuration-only remnant does
not block an already connected current client. If it is the only connection,
`legacy-sync-reconnect` requests current browser authorization.

Network failure leaves current queues on disk. Reconnect retries with backoff;
conflicts require explicit reconciliation. Do not manufacture a new request ID,
erase private state or report success merely because a connection is alive.

The private Session service uses authorized `/v1/projects/:project/sessions/`
reads, changes/events and map writes. Session generations and server authorization
remain enforced. Credentials never belong in Maps, logs or generated HTML.
