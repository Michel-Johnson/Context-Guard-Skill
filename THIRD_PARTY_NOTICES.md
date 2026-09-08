# Third-party notices

## Marked

- Upstream: https://github.com/markedjs/marked
- Pinned version: npm `marked@15.0.12` (Node 18 compatible); integrity is recorded in package-lock.json.
- Distributed browser module: `prototype/vendor/marked.mjs`, copied from `lib/marked.esm.js` without behavioral changes.
- MIT license and upstream copyright notices: [licenses/Marked-MIT.txt](licenses/Marked-MIT.txt).
- Used only as a Markdown lexer. Context Guard builds restricted DOM nodes instead of inserting generated HTML; remote images are not fetched.

## Portless

- Upstream: https://github.com/vercel-labs/portless
- Referenced version: npm `portless@0.15.6`, source module `src/routes.ts`.
- Copyright 2025 Vercel Inc.
- License: Apache License 2.0; full text is distributed in
  [licenses/Portless-Apache-2.0.txt](licenses/Portless-Apache-2.0.txt).
- Derived file: `scripts/workbench/portless-routes.mjs`.
- Changes: reduced to local HTTP route storage and name ownership; replaced
  writes with atomic private-file replacement; added strict project/instance
  validation; removed force termination, tunnel metadata, stale PID pruning and
  route-file locks (writes are serialized by one Context Guard proxy process).

The workbench proxy, startup adapter and project-binding code are Context Guard
implementations, not the full Portless CLI. TLS, certificate installation, LAN
access, tunnels and framework launching are not included. This notice identifies
the code's origin and does not imply endorsement by Vercel.
