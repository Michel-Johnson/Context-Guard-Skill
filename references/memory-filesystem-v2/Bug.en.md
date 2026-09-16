# Bug.md format

## Status

- `Open`: recorded, not started.
- `InProgress`: the Developer and Tester workflow is not complete.
- `Pending`: tests are complete and human acceptance is pending.
- `Resolved`: human acceptance passed.
- `Deferred`: work was explicitly postponed and may be resumed later.
- `WontFix`: a decision was made not to repair it, and the workflow is closed.

The current migration generator incorrectly projects `Deferred` and `WontFix` as `Open`. This is a compatibility gap, not authorization to restart the work.

Attribution attempts use only `Confirmed` and `Refuted`. A supported attribution starts as `Confirmed`. A later attempt changes it to `Refuted` and adds `RefutedBy` and the reason.

## Template

```md
# <Bug ID> <Title>

Reporter: <Human|Agent>
Status: <Open|InProgress|Pending|Resolved|Deferred|WontFix>
CurrentAttempt: <A1...An>

## 1. Phenomenon

<Original observable phenomenon>

## 2. Later correction events

- <Attempt / Human|Agent>: <Feedback or new evidence>

## 3. Reproduction

### A1
<Reproduction steps for this attempt>

## 4. Cause and code changes

### Current valid conclusion
<Causes and fixes that still hold>

### A1
Status: <Confirmed|Refuted>
RefutedBy: <Attempt, only when Refuted>
Reason: <Reason, only when Refuted>

Cause: <Attribution made by that attempt>

#### code index
- `<code path>`
  <Change summary>

## 5. Tests

- [A1](tests/<Bug ID>-A1.md): <one-line result>

## 6. Repair Session index

- [A1](traces/<Bug ID>-A1.md)
```

The Tests section does not record human acceptance. The Session section contains links only.

## Four-attempt example

```md
# B002 Repeated clicks create duplicate feedback

Reporter: Human
Status: Pending
CurrentAttempt: A4

## 1. Phenomenon

Clicking submit again before the first request finishes creates two identical feedback records.

## 2. Later correction events

- A1 / Human: rapid double-click still duplicates; acceptance failed because disabling the button misses the queued second event.
- A2 / Human: retry after a weak-network timeout still duplicates; the synchronous lock covers one window only.
- A3 / Agent B: two windows can submit the same draft; the request-key lookup does not prevent concurrent creation.
- A4 / Tester B: concurrency, retry, and conflict regressions pass; awaiting human acceptance.

## 3. Reproduction

### A1
Enter feedback and double-click Submit.

### A2
Delay the first request until timeout, then retry in the UI.

### A3
Let the server create the record, drop the response, and retry with the same request key.

### A4
Submit the same draft from two windows; retry with the same key and same content, then the same key and different content.

## 4. Cause and code changes

### Current valid conclusion
A synchronous UI lock prevents single-window re-entry. An atomic server uniqueness constraint guarantees one record across windows and retries, while different content with the same key returns a conflict.

### A1
Status: Refuted
RefutedBy: A2
Reason: the second queued click occurs before the disabled state is committed.

Cause: the submit button permits repeated clicks.

#### code index
- `src/ui/FeedbackForm.tsx`
  Disable the button when submission starts.

### A2
Status: Confirmed

Cause: there is a re-entry window before UI state updates.

#### code index
- `src/ui/submitFeedback.ts`
  Add a synchronous lock at the submission boundary.

### A3
Status: Refuted
RefutedBy: A4
Reason: request-key lookup and insertion are not atomic.

Cause: retry does not reuse an existing record; reusing the request key is sufficient.

#### code index
- `src/server/createFeedback.ts`
  Look up the request key before creation.

### A4
Status: Confirmed

Cause: concurrent requests can both pass the non-atomic lookup.

#### code index
- `src/storage/migrations/004_feedback_unique_key.sql`
  Add a unique constraint over user and request key.
- `src/server/createFeedback.ts`
  Create atomically; return the existing record on an equivalent conflict and reject different content.

## 5. Tests

- [A1](tests/B002-A1.md): repeated clicks still reproduce the bug.
- [A2](tests/B002-A2.md): one window passes; network retry fails.
- [A3](tests/B002-A3.md): sequential retry passes; concurrency fails.
- [A4](tests/B002-A4.md): concurrency, timeout retry, and conflict regressions pass.

## 6. Repair Session index

- [A1](traces/B002-A1.md)
- [A2](traces/B002-A2.md)
- [A3](traces/B002-A3.md)
- [A4](traces/B002-A4.md)
```
