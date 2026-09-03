# Server-backed development memory

Use this contract only when a project's explicit policy selects a private memory
server. The Context Guard development repository selects this mode in `RULE.md`;
other projects do not inherit its server address or binding.

**Status: private service/client implementation with automated local acceptance;
real deployment and historical migration require separate approval.** When
`CONTEXT_GUARD_MEMORY_CONFIG` is configured, the normal Cloud process mounts this
API at the same HTTPS origin. Without that explicit configuration, no private
memory routes are enabled. Runtime adoption and migration remain in `CI_todo.md`.

## Runtime interface

Point `CONTEXT_GUARD_MEMORY_CONFIG` at a private JSON configuration outside source
control: an absolute `dataDir`, `adminToken`, and `projects`. `scripts/cloud/server.mjs`
then serves Cloud and memory through one process and one HTTPS origin. The standalone
`scripts/cloud/memory.mjs` entry remains available for loopback-only testing and
rejects non-loopback listeners. Each project maps its ID to a scoped `token`
and an administrator-configured repository mirror `root`, authoritative `ref`,
optional `remote` to fetch on publication, and public repository identifier.
Use a TLS reverse proxy or SSH loopback tunnel; the client rejects non-loopback
plain HTTP, URL credentials, redirects, and credentials in query parameters.

Configure a client using `context-guard memory configure --root <project> --input
<private-file>` containing `url`, `projectId`, `token`. It verifies the endpoint
before replacing existing configuration. Never put the credential on the command
line, in a node, in a Session record, or in Git. Configure publisher credentials
only in an authorized publication environment, not every Agent worktree.

The authenticated API is `/v1/projects/<id>/main`, `/preferences`,
`/sessions/<session-id>`, and `/publish`. Public Cloud routes do not expose these
records. Session writes carry `operationId`, `baseVersion`, `baseMainVersion`,
`sourceCommit`, and `memory:{map,records}`. Snapshot and idempotency receipt are
committed in one fsynced atomic replacement under a per-project lock. A reused ID
with different content fails. Private/runtime paths are rejected by a strict record
allowlist; retain records without retention pruning. Session snapshots include the
server write time. Do not upload secret content.

`memory prepare` fetches versioned main/Session records and preserves conflicting
local edits. `memory sync` uploads only to the current bound Session and replays an
uncertain durable queued operation before generating a new one. `memory rebase`
merges disjoint main changes into the Session, backs up the old map, and rejects
overlapping changes for explicit reconciliation. Archive invokes sync when configured;
failure preserves the local draft and is reported, not treated as success.

`memory publish --input <private-request>` requires publisher/admin credentials,
`operationId`, `baseVersion`, `sessionId`, `sessionVersion`, `expectedMainSha`.
The server checks the actual configured mirror/ref and verifies Session source
ancestry; the Session must already be reconciled to the current main-memory version.
Main advancement, unmerged source or concurrent publication fails without changing
the baseline. Workbench refreshes the baseline every 30 seconds and shows stale or
unavailable status instead of overwriting the last good snapshot. Repositories
without a configured authoritative ref cannot publish.

## Authority and storage

- GitHub is authoritative for source code, product documentation and formal tests.
  Keep the existing branch, PR, test and secret-check rules. The entire project
  `.codex/` stays out of source commits, public attachments and release artifacts.
- The private server is authoritative for all development memory: main baselines,
  Sessions, user messages, tasks, Bugs/fixes, Maps, indexes and record preferences.
  Retain these records without pruning by long-term versus temporary value.
  This does not make private keys, tokens, raw dumps or machine runtime state
  into memory; do not copy `.codex/context/private/` blindly.
- Local `.codex/context/` files are versioned caches, working copies and pending
  writes only. Fetch the relevant server indexes and records on demand, not the
  entire history on each reply. Never infer authority from the newest local mtime.
- Connection details belong in untracked local configuration, not public docs or
  bundled Skill defaults. An SSH host is deployment information, not an API URL,
  a project binding or evidence that a memory service has been initialized.

## Session and main separation

One Git project has one server-side project and one workbench identity. Every
actual Session binds explicitly to that project and its own worktree. Different
Sessions have separate working-memory scopes; authorized historical reads must
retain their source Session and version, not silently overlay another worktree.

All Sessions reads only the server's published main baseline. Identify it by the
authoritative repository, branch, main commit SHA and memory revision. A Session
upload or `sync finish` is not a main publication. After verifying that the
corresponding source change is merged into the configured main branch, reconcile
its associated memory and publish the complete baseline atomically. Preserve
other Session records; do not promote unrelated unmerged changes. If GitHub main
advances before publication completes, show the last confirmed baseline as stale
or pending rather than claim it is current. If no unambiguous main branch exists,
ask the user to choose the authoritative remote/branch or local branch.

## Read and write discipline

1. On every human prompt, validate the actual Session, project/worktree binding
   and server memory version before relying on development history. Missing or
   ambiguous bindings require a user choice, not historical-session discovery.
2. Read the relevant main baseline plus that Session's records from the server.
   A local cache is usable as current only after its version is confirmed against
   the server. Source-code inspection still reads the actual working tree.
3. Archive new memory to the Session's server scope using version checks and
   retry-safe operation identities. Keep pending local data until a server
   acknowledgment confirms persistence; never overwrite concurrent records with
   an unchecked directory copy. Sync failure must not be reported as success.
4. When not configured, disconnected or unsupported, state the missing capability
   and mark local drafts unsynced. Do not create an empty replacement project,
   silently trust stale history, or upload records to GitHub as a fallback.
   Tasks based only on current user input and inspected source may proceed;
   memory-dependent decisions wait for a confirmed source or explicit direction.

## Privacy and migration

Both reads and writes require project-scoped authorization. A public read-only
Map is still public; the existing Cloud public endpoints must not expose private
memory. Use protected transport and keep server data and backups outside the
source checkout. Credentials and machine-specific access/port/process state stay
outside memory snapshots.

Migration needs a separately approved deployment plan: inventory local records,
preserve a backup, import into the correct project/Session scopes, verify content
and version coverage, then switch reads to the server. Do not delete local data
or claim migration complete merely because a service health endpoint responds.
Follow `references/cloud-deployment.md` for existing Cloud installation mechanics,
but do not use its Map-only connect/push flow as a substitute for this contract.
