# Project-named local workbench

`context-guard workbench --root /path/to/project` now prints an HTTP URL such as
`http://my-project.localhost:1355/prototype/workbench.html`. SessionStart uses the
same entry. No global Portless install, DNS edit, certificate, administrator
permission, or additional npm runtime dependency is needed.

The name is derived from the Map's project name and normalized to lowercase DNS
letters, digits and hyphens (`Context_Guard` becomes `context-guard`). Non-ASCII
only names use a stable `project-<id>` fallback. Set a readable explicit name with:

```sh
context-guard workbench --root /path/to/project --name my-project
```

Different projects cannot take over the same registered name, even when a backend
is stopped. Choose another name; this command never kills the other project.
Runtime routes are private local state, not project memory or files to commit.

## Multiple sessions and worktrees

Sessions in one folder reuse its workbench. A second Git worktree must be
**explicitly** bound to the worktree containing the desired existing Map:

```sh
context-guard workbench bind --root /path/to/second-worktree --project-root /path/to/map-worktree
```

The two paths must have the same local Git common directory. Unrelated clones,
same-name folders and different repositories are not silently joined. Binding
chains are rejected. Stop any service in the second worktree first, after saving
its drafts. The target Map must already exist; this command does not create one.
If the second worktree has its own Map, binding fails unless `--keep-local` is
explicitly provided. That flag preserves its files unchanged but leaves that
local Map inactive; it does not merge or delete data.

After binding, the CLI and Python lifecycle records use the target's local Map
and context storage. Actual session IDs remain separate; hook events retain the
source `worktree_root`. Existing records in the second worktree are not migrated.
Restart/re-enter its session so the lifecycle hook can record it in the selected
workbench. This is a local Map binding, not implementation of the private-server
memory contract, Session/main publication, or Cloud migration.

Automatic opening is claimed atomically by the backend: live workbench pages
suppress another open, and parallel first starts share a five-second opening
window. A failed browser launch can therefore delay a retry for five seconds.
An explicit CLI command still prints the URL for manual opening. Headless/CI and
resume/compact hooks do not open a browser.

## Process lifecycle and compatibility

One loopback-only HTTP proxy is shared across projects, independent of each
backend. Closing one project does not close the proxy or other projects. The
proxy does no directory polling, certificate work, LAN exposure or tunnelling.
SSE is streamed; WebSockets are intentionally unsupported.

Default proxy port is 1355. If another application (including full Portless) owns
it, the proxy chooses a free port among the next 20 and returns that actual URL;
it never takes over the existing listener. The chosen URL still has a port. A
proxy/backend crash is recovered on the next `workbench`/SessionStart invocation;
there is no always-polling supervisor. Run the command again after an unexpected
exit. A still-live but unhealthy owner fails visibly instead of being killed.

Each forwarded request checks the backend's instance identity before sending
capabilities. Host, Origin and the forwarding capability are checked; agent
grants and cross-project token isolation remain in force. These are local
single-user safeguards, not protection against another process running with
full access to the same user's files.

An old running backend is not automatically restarted. Use `--direct` for its
existing address, or save drafts and stop it explicitly before upgrading. Browser
recovery storage belongs to its origin: export unresolved drafts before changing
names/origins; this feature does not migrate browser storage.

- `CONTEXT_GUARD_NAMED_WORKBENCH=0` or `--direct`: old direct loopback URL.
- `CONTEXT_GUARD_NAMED_STATE_DIR`: isolated private proxy state directory (default
  `~/.context-guard/named-workbench`). Never share this directory across OS users.
- `CONTEXT_GUARD_NAMED_PORT`: preferred proxy port, default 1355.

## Attribution and tests

The reduced route store derives from Portless 0.15.6 under Apache-2.0. See
`THIRD_PARTY_NOTICES.md` and `licenses/Portless-Apache-2.0.txt`; both are included
in the npm package and installed Skill. The proxy/adapter are separate Context
Guard implementations, not a vendored full Portless CLI.

`tests/named-workbench.test.mjs` is part of `npm test`: authorization, Origin/Host,
read/write, five sessions/SSE streams, opening claims, name collision, backend
identity/port reuse, proxy restart, multi-project isolation, corrupt route state,
concurrent process startup, explicit Git worktree binding and the real Python
SessionStart handler. This does not prove delivery by every desktop host, OS or
browser. Outstanding coverage is tracked in `CI_todo.md`.
