# Bug record (map-linked)

Use this for `.codex/context/bugs/{id}.md`. One file per map bug stub. Do **not** use `register-template.md` (Test Hub / 40-field register) on the workbench line.

The map stub in `map.json` keeps `id`, `title`, `status`, `sessions`, evidence `files`, and `record` (this path). The workbench shows **title only**.

```md
# {id} {title}

- node: {homeNodeId}
- also: {otherNodeIds, comma-separated; omit if only one node}
- status: open | fixed | deferred | wontfix
- 现象: one-line user-visible symptom
- 触发: shortest steps or precondition
- 根因: confirmed, suspected, or unknown — one line
- 修复: what changed, or empty if still open
- 守卫: a check a human can repeat; not a Test Hub script
- 证据: repo-relative paths (usually docs/shots/…)
```

Write titles and prose in the folder `record_language`. Keep paths, identifiers, and commands literal.

When recording: write the stub on the **home** node, list other related node ids in `also`, and write this file in the same turn. Do not copy the same case onto two nodes.
