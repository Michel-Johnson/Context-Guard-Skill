#!/usr/bin/env node

import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

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

const result = spawnSync(process.execPath, ["--test", ...files], {
  stdio: "inherit",
  timeout: 15 * 60 * 1000,
  windowsHide: true,
});

if (result.error) {
  throw result.error;
}
if (result.signal) {
  throw new Error(`Node tests terminated by ${result.signal}.`);
}
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
