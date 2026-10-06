#!/usr/bin/env node

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { run as runTests } from "node:test";
import { tap } from "node:test/reporters";
import { pipeline } from "node:stream/promises";
import { run as runProcess } from "./client-protocol.mjs";

const roots = [".github/scripts", "tests"];
const standalone = new Set([".github/scripts/security-checks.test.mjs"]);

function discover(root, cwd = process.cwd()) {
  return readdirSync(path.join(cwd, root), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
    .map((entry) => path.posix.join(root, entry.name));
}

export function discoverNodeTests(cwd = process.cwd()) {
  const files = roots.flatMap(root => discover(root, cwd))
    .filter(file => !standalone.has(file)).sort();
  if (files.length === 0) throw new Error("No Node test files were discovered.");
  // Start the long lifecycle suite in the first scheduling wave. The Node CLI
  // re-sorts positional files, whereas the public run API accepts this order.
  const lifecycle = files.indexOf("tests/hook-lifecycle.test.mjs");
  if (lifecycle > 0) files.unshift(...files.splice(lifecycle, 1));
  return files;
}

const entry = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === entry) {
  const started = Date.now();
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 1 || args[0] !== "--execute")) throw new Error("Unsupported Node test runner arguments");
    if (args[0] === "--execute") {
      const stream = runTests({ files: discoverNodeTests(), concurrency: 2 });
      stream.on("test:fail", () => { process.exitCode = 1; });
      await pipeline(stream, tap, process.stdout);
    } else {
      // One owned child tree retains the original deadline and cleanup policy.
      await runProcess(process.execPath, [entry, "--execute"], {
        inheritOutput: true, timeout: 15 * 60 * 1000,
      });
      const manifest = JSON.parse(readFileSync("tests/test-manifest.json", "utf8"));
      for (const separate of manifest.separatePackages) {
        const packageFile = JSON.parse(readFileSync(path.join(separate.root, "package.json"), "utf8"));
        if (packageFile.scripts?.test !== 'node --test test/*.test.mjs') throw new Error(`Unsupported isolated test entry: ${separate.root}`);
        await runProcess(process.execPath, ['--test', ...discover(path.posix.join(separate.root, 'test'))], {
          inheritOutput: true, timeout: 60_000,
        });
      }
    }
  } catch (error) {
    console.error(`Node test runner failed after ${Math.round((Date.now() - started) / 1000)}s: ${error.message}`);
    process.exitCode = 1;
  }
}
