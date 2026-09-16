# Idea.md format

Only the Coordinator reads and writes Idea documents. Whether an Idea becomes a Todo is decided by the user and Coordinator in conversation and is not recorded in Idea.md.

## Template

```md
# <Idea ID> <Title>

Status: <Proposed|Accepted>

## 1. Idea

<Idea text>

## 2. Discussion and conclusion

- <Time or round>: <Discussion conclusion>
```

## Example

```md
# I002 Include the current node with feedback

Status: Proposed

## 1. Idea

When feedback is created from a node, include its ID and title automatically so the user does not need to describe the location manually.

## 2. Discussion and conclusion

- C1: retain the stable node ID; use the title for display only so renaming does not break the relationship.
- C2: implementation has not been decided, so this remains an Idea.
```
