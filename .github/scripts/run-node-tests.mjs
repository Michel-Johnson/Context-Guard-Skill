#!/usr/bin/env node

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { run } from "./client-protocol.mjs";

const roots = [".github/scripts", "tests"];
const standalone = new Set([".github/scripts/security-checks.test.mjs"]);
const manifest = JSON.parse(readFileSync("tests/test-manifest.json", "utf8"));

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

// Several suites launch Git, Python and local servers. Two concurrent files
// avoid starving Coordinator shutdown while keeping the full suite bounded.
const started = Date.now();
try {
  await run(process.execPath, ["--test", "--test-concurrency=2", ...files], {
    inheritOutput: true, timeout: 15 * 60 * 1000,
  });
  for (const separate of manifest.separatePackages) {
    const packageFile = JSON.parse(readFileSync(path.join(separate.root, "package.json"), "utf8"));
    if (packageFile.scripts?.test !== 'node --test test/*.test.mjs') throw new Error(`Unsupported isolated test entry: ${separate.root}`);
    await run(process.execPath, ['--test', ...discover(path.posix.join(separate.root, 'test'))], {
      inheritOutput: true, timeout: 60_000,
    });
  }
} catch (error) {
  console.error(`Node test runner failed after ${Math.round((Date.now() - started) / 1000)}s: ${error.message}`);
  process.exitCode = 1;
}
