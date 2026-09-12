#!/usr/bin/env node

import { readdirSync } from "node:fs";
import path from "node:path";
import { run } from "./client-protocol.mjs";

const roots = [".github/scripts", "tests"];
const standalone = new Set([".github/scripts/security-checks.test.mjs"]);

function discover(root) {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
    .map((entry) => path.posix.join(root, entry.name));
}

const files = roots
  .flatMap(discover)
  .filter((file) => !standalone.has(file))
  .sort();

if (files.length === 0) {
  throw new Error("No Node test files were discovered.");
}

// Several suites launch Git, Python and local servers. Bound file-level
// concurrency instead of scaling subprocesses with the host's CPU count.
const started = Date.now();
try {
  await run(process.execPath, ["--test", "--test-concurrency=4", ...files], {
    inheritOutput: true, timeout: 15 * 60 * 1000,
  });
} catch (error) {
  console.error(`Node test runner failed after ${Math.round((Date.now() - started) / 1000)}s: ${error.message}`);
  process.exitCode = 1;
}
