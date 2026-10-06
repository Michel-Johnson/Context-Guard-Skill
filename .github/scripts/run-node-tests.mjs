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
  // Priority affects order only, never the discovered execution set.
  const priorities = ["tests/hook-lifecycle.test.mjs", "tests/hook-records.test.mjs",
    "tests/named-workbench.test.mjs", ".github/scripts/multiworktree.test.mjs",
    ".github/scripts/workbench-project.test.mjs"];
  for (const preferred of [...priorities].reverse()) {
    const index = files.indexOf(preferred);
    if (index > 0) files.unshift(...files.splice(index, 1));
  }
  return files;
}

function timingWriter(scope) {
  const started = performance.now();
  return (phase, fields = {}) => {
    const elapsedMs = Math.round(performance.now() - started);
    process.stderr.write(`[node-test-timing] ${JSON.stringify({
      scope, phase, utc: new Date().toISOString(), elapsedMs, ...fields,
    })}\n`);
    return elapsedMs;
  };
}

function observeTests(stream, files, emit) {
  // Fixed to discovered files; unknown event paths/names never grow this map or
  // enter logs. These are event receipt times, not child process boundaries.
  const key = file => {
    try {
      const resolved = path.resolve(/^file:/i.test(file) ? fileURLToPath(file) : file);
      return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    } catch { return null; }
  };
  const known = new Map(files.map(file => [key(file), { file, firstObservedTestMs: null,
    lastObservedResultMs: null, observedResults: 0 }]));
  const formats = { fileURI: 0, absolute: 0, relative: 0, absent: 0 };
  const locate = data => {
    const file = data?.file;
    const format = typeof file !== 'string' ? 'absent' : /^file:/i.test(file) ? 'fileURI'
      : path.isAbsolute(file) ? 'absolute' : 'relative';
    formats[format]++;
    return typeof file === 'string' ? known.get(key(file)) : undefined;
  };
  stream.on('test:dequeue', data => {
    const item = locate(data);
    if (!item || item.firstObservedTestMs !== null) return;
    item.firstObservedTestMs = emit('first-observed-test', { file: item.file, event: 'test:dequeue' });
  });
  // Use one outcome channel, avoiding duplicate counts from completion and
  // declaration-ordered verdicts. Node 18 has only the latter public channel.
  const executionResults = Number(process.versions.node.split('.')[0]) >= 22;
  const result = (event, data) => {
    const item = locate(data);
    if (!item) return;
    item.observedResults++;
    const duration = data.details?.duration_ms;
    item.lastObservedResultMs = emit('observed-result', { file: item.file, event,
      order: executionResults ? 'execution' : 'declaration-report',
      line: Number.isInteger(data.line) && data.line > 0 ? data.line : null,
      nesting: Number.isInteger(data.nesting) && data.nesting >= 0 ? data.nesting : null,
      durationMs: Number.isFinite(duration) && duration >= 0 ? duration : null,
      passed: event === 'test:complete' ? data.details?.passed === true : event === 'test:pass' });
  };
  if (executionResults) stream.on('test:complete', data => result('test:complete', data));
  else for (const event of ['test:pass', 'test:fail']) stream.on(event, data => result(event, data));
  stream.once('end', () => {
    for (const item of known.values()) emit('file-observations', { ...item, processBoundaries: 'unavailable' });
    emit('file-field-formats', { formats });
  });
}

const entry = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === entry) {
  const started = Date.now();
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 1 || args[0] !== "--execute")) throw new Error("Unsupported Node test runner arguments");
    if (args[0] === "--execute") {
      const files = discoverNodeTests(), emit = timingWriter('tests-stream');
      emit('execute-start', { files: files.length, concurrency: 2 });
      const stream = runTests({ files, concurrency: 2 });
      stream.on("test:fail", () => { process.exitCode = 1; });
      observeTests(stream, files, emit);
      await pipeline(stream, tap, process.stdout);
      emit('stream-ended');
    } else {
      // One owned child tree retains the original deadline and cleanup policy.
      const emit = timingWriter('parent');
      emit('launch-request');
      try {
        await runProcess(process.execPath, [entry, "--execute"], {
          inheritOutput: true, timeout: 15 * 60 * 1000,
        });
        emit('owned-child-close-observed', { outcome: 'success' });
      } catch (error) {
        emit('owned-child-close-observed', { outcome: 'failure' });
        throw error;
      }
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
