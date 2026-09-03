# Server-backed development memory

Use this contract only when a project's explicit policy selects a private memory
server. The Context Guard development repository selects this mode in `RULE.md`;
other projects do not inherit its server address or binding.

**Status: partially implemented.** Local and Cloud workbenches now isolate Main
and Session Maps, use Session-scoped Cloud credentials, and publish to Main only
after verifying a merged commit. The complete server storage of Session Markdown,
messages, full Bug/fix/task records and indexes remains open in `CI_todo.md`.

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

All Sessions reads only the server's published Main baseline. Identify it by the
authoritative repository, branch, main commit SHA and memory revision. A Session
upload or `sync finish` is not a Main publication. After verifying that the
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
