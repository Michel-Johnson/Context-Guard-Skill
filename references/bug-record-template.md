# Bug index card + how-to

Workbench shows the title only.

## Index `.codex/context/bugs/{id}.md`

```md
# {id} {title}

- node: {homeNodeId}
- status: open | fixed | deferred | wontfix
- 现象: one line
- keys: search words, comma separated
- fix: .codex/context/fixes/{id}.md
- card: .codex/context/cards/{homeNodeId}.md
```

## How-to `.codex/context/fixes/{id}.md`

```md
# {id} how to fix

- bug: .codex/context/bugs/{id}.md
- node: {homeNodeId}
- card: .codex/context/cards/{homeNodeId}.md
- status: open | fixed | …

## 根因
## 怎么修
## 怎么防
## 代码
- path/to/source.py
## 证据
- docs/shots/…
```

Unfixed how-to is `未修`. Code is repo-relative paths only.
