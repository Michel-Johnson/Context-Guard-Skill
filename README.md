[Website & interactive demos](https://michel-johnson.github.io/Context-Guard-Skill/?lang=en)

# Context Guard

Language: **English** | [中文](README.zh-CN.md)

**A next-generation collaboration layer for humans and coding agents.**

Most tools still treat *chat* as the workplace. The thread is the memory, the approval surface, and the project. When it ends, the next agent starts cold. A human “yes” in chat is not a grant, not a publication, and not a durable record.

Context Guard treats the **project** as the workplace:

1. **A shared Map** — modules, responsibilities, bugs, todos, and verification live on one durable structure. Current storage law is [`fs-v2`](references/design-current.md).
2. **Isolated Sessions** — each execution run writes its own Session. A chat is not Main. When the user mounts the Coordinator onto a TODO or Bug, a new execution Session is created and bound to that item. Approving the brief still gates dispatch.
3. **The human talks to Coordinator** — Cloud Coordinator, the local workbench Coordinator, or a Codex Session acting as Coordinator. Confirmation and “go implement this” happen there. Execution Sessions do not talk to the human. Grey-card visibility slicing is later work, not the current default.
4. **Publication into Main** — only reviewed work enters the committed-main baseline. Session drafts stay drafts until the gate. Humans may edit Main TODOs directly.

It installs as a skill for **Codex**, **Cursor**, and **Claude**. New Hooks are not in scope this round.

[Repository docs and file layout](docs/README.md) · [One-page skill](SKILL.md)

## Why this is a different paradigm

| Chat as the workplace | Context Guard |
| --- | --- |
| History in a thread | Structure on a Map |
| Next session starts over | Next session opens the same Map |
| “Looks good” in a random chat | Human confirms with Coordinator |
| Agent sees whatever was pasted | Execution Agents work a bound TODO/Bug |
| Memory is retrieval over files | Memory is owned project state, with version and publication |

This is not another prompt pack, RAG folder, or “remember this” plugin. It is a **human–agent operating loop** for software work: locate the node, confirm the intent, execute in a Session, verify, then publish.

Role prompts for Coordinator / Developer / Tester exist so a project can split planning, implementation, and checks. Role text does not grant protocol permissions. Automatic multi-agent orchestration is still advancing; the collaboration contract (Map, Session, grant, human confirmation, Main) is the product.

## See the workbench

People look at the Map in the workbench. Coordinator may drive focus, tours, and structure edits. Execution Agents do not talk to the human.

**Cloud:** when configured, Cloud is the only human-facing workbench. The local service syncs and delivers to the host. Private deployments require browser login. A device logs in once per project; new Sessions reuse that connection.

**Local:** verify the actual Session binding and reuse the project’s established service. First-time setup, ambiguous identity, and worktree migration need a human choice. A new Session in an already connected project does not.

### Overview

Root catalog: 4–8 module cards. Click a card to enter. Bugs stay in the right-hand list.

![Workbench overview](docs/shots/workbench/overview.png)

### Inside a module

Work units hang under the module. Hierarchy is parent–child solid curves.

![Inside a module](docs/shots/workbench/module.png)

### Module relations

「关系」 highlights produce/consume partners and dims the rest. It does not enter the module.

![Module relations](docs/shots/workbench/relations.png)

### Session flow

Click a bug with an assigned session. The path from the root to that node lights up; current session beads run along the chain.

![Session flow](docs/shots/workbench/session-flow.png)

### Auth / inspect mode

「授权模式」 can mark slices. Grey-card visibility slicing is later work, not the current default. New Sessions currently see their own Session Map.

![Auth mode](docs/shots/workbench/auth-mode.png)

Open **Settings** on the far right of the top bar for language and theme. Map titles, purposes, and memories stay in the language they were written.

## Install

Install with npx. The installer detects Codex, Cursor, and Claude, then installs both the skill and lifecycle hooks while preserving existing configuration:

```bash
npx @michelj/context-guard install
```

Or install globally:

```bash
npm install -g @michelj/context-guard --registry=https://registry.npmjs.org
```

Force all three clients:

```bash
npx @michelj/context-guard install --platform all
```

Hooks are on by default. Skill only:

```bash
npx @michelj/context-guard install --no-hooks
```

Default skill paths are `~/.codex/skills/context-guard`, `~/.cursor/skills/context-guard`, and `~/.claude/skills/context-guard`. The installer backs up and merges existing hook/settings files. For Codex it also enables `[features] hooks = true`.

Before the npm package is published:

```bash
npx github:Michel-Johnson/Context-Guard-Skill install
```

After installation, clients should discover `SKILL.md` in those skill directories.

Then, in a real project:

```bash
context-guard workbench --root /path/to/project --session <actual-session-id>
context-guard doctor --platform cursor --root /path/to/project
```

Local URLs default to `http://project-name.localhost:1355`. Binding pins the named URL, Git project, backend, and Session; it never auto-switches to a newer task. See [named workbenches](references/named-workbench.md).

## How a loop runs

1. **Open the Map** — first use: human and agent lock L1 together (readable titles), then L2, then L3. Later sessions open that Map.
2. **Bind the Session** — `context-guard workbench --root <project> --session <actual-session-id>`.
3. **Grant a slice** — the human marks what this Session may read.
4. **Work** — the agent reads `map read`, writes through `map apply` with a real session, base version, and stable operation id. Chat assent does not write the Map.
5. **Confirm** — ordinary proposals wait in the workbench.
6. **Publish** — verified Session work can enter Main. Session drafts are not Main.

On the first session, if record language is still unset, the hook tells the agent to ask “中文 or English?” and persist the answer. Later sessions do not ask again.

```text
Use $context-guard. Shared Map, isolated Sessions, human confirmation, publication into Main.
```

Useful commands:

```bash
context-guard workbench --binding-status --root /path/to/project --session <actual-session-id>
context-guard workbench --list --root /path/to/project
context-guard map read --root /path/to/project --session <actual-session-id> --node <id>
context-guard doctor --platform codex --root /path/to/project
```

`record-bad-case` / `record-bad-case-fix` close a failure/fix loop. `archive-session` saves durable Session results onto accepted Map nodes covered by `owns`; unowned files stay unclassified until a human confirms assignment.

Codex installs eleven lifecycle hooks (excluding `SessionEnd`). At reasoning boundaries they deliver the real Map, grants, assigned TODOs/Bugs, and other-session changes. New requirements become Map TODOs. `TODO.md` stays human-owned.

## Cloud

When Cloud is configured it is the only human-facing workbench. Sync is event-based (project SSE), not a periodic full Map replace. `sync prepare` before development, `sync finish` after verification. Disjoint changes rebase; overlapping node, field, or file scopes return `WORK_IMPACT` and stay unverified.

Server install, project credentials, and host moves: [Cloud deployment](references/cloud-deployment.md). Protocol: [Cloud Sync](references/cloud-sync-interface.md). Memory authority: [server memory](references/server-memory.md).

## Documentation

| Topic | Where |
| --- | --- |
| Skill (one page, for the agent) | [SKILL.md](SKILL.md) |
| Docs index | [docs/README.md](docs/README.md) |
| Workbench / map CLI | [workbench interface](references/workbench-interface.md) |
| Roles (Coordinator / Developer / Tester) | [roles.md](roles.md) |
| npm publish | [release runbook](docs/npm-release-runbook.md) |

This repository keeps **source** on GitHub `main` and **development memory** on the user-designated private server. The entire `.codex/` tree stays out of Git and npm. Other projects do not inherit this repo’s server config. See [RULE.md](RULE.md).

The local `.codex/context/` tree is a compatibility cache and draft, not a second authority. Cloud Agent read surface is moving to node/module Markdown in [Memory Filesystem v2](references/memory-filesystem-v2/README.md); until that projection is exposed, do not pretend private server files are directly readable.
