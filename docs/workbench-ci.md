# Workbench / Agent CI

The `CI` workflow runs on branch/tag pushes and pull requests targeting `main`.
`Required` succeeds only when package checks, all three installation jobs, and
the Ubuntu Chromium browser job succeed. A failed, skipped or cancelled job is
not a pass. This workflow does not publish npm packages or call AI models.

## Run locally

Product checks require Node 18+ and Python 3. Browser development requires Node
20+ (CI uses Node 24) for the pinned dev-only Playwright dependency.

```sh
npm test
npm ci --ignore-scripts --no-audit --no-fund
npx --no-install playwright install chromium
npm run test:browser
```

On Linux CI, `playwright install --with-deps chromium` installs the required
system libraries as described in the [Playwright CI guide](https://playwright.dev/docs/ci).
`--ignore-scripts` prevents our package's postinstall from modifying a personal
Skill installation. Browser tests use bundled Chromium, not a signed-in browser.

## What is checked

- `npm test`: existing client driver/runtime checks; transactional installation
  boundaries; actual npm package contents, lifecycle hooks, language setup,
  session/message/bad-case persistence; workbench/inbox checks including
  interrupted writes, version conflicts, exact acknowledgements, project path
  aliases, Windows short-path watchers and stop-then-restart behavior.
- `npm run test:browser`: a real SessionStart hook creates a synthetic session in
  an outside-checkout temporary project. The real page and public CLI check
  bidirectional persistence, human-only proposal confirmation, inbox redelivery,
  exact/idempotent ack, preservation of later edits, rejection of stale writes,
  and duplicate-operation safety. Existing editing/recovery scenarios also run.
- Browser reports identify the failed stage and completed checks. Screenshots and
  reports contain only synthetic test data. No credentials, full temporary home,
  real map, or server private state is uploaded. Success removes owned fixtures;
  failures retain the browser fixture locally for diagnosis.

The npm file allowlist and exact package contract exclude all tests, development
dependencies, CI files and reports. The browser job has no login/API secrets.
It does not prove model comprehension, native client conversations, reading
isolation, or background monitoring. Those are outside this CI's scope.

Path watchers use canonical paths to avoid the Windows short-path assertion
tracked in [libuv #5010](https://github.com/libuv/libuv/issues/5010).
Shutdown explicitly closes idle connections for [Node 18 compatibility](https://nodejs.org/download/release/v18.20.3/docs/api/http.html#servercloseidleconnections)
and waits for the project lock to be released before reporting CLI success.
