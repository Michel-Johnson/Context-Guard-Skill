import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const source = fs.readFileSync(new URL("../../bin/context-guard-skill.js", import.meta.url), "utf8");
function execute(platform, versions, scriptResult = { status: 0 }) {
  const calls = [], errors = [];
  let exit;
  const stopped = new Error("process exited");
  try {
    vm.runInNewContext(source, {
      __dirname: path.resolve("test-package/bin"),
      require(name) {
        if (name === "fs") return { existsSync: () => true };
        if (name === "os") return os;
        if (name === "path") return path;
        if (name === "child_process") return { spawnSync(command, args, options) {
          calls.push({ command, args: Array.from(args), options });
          return args[0] === "--version" ? versions[command] || { error: { code: "ENOENT" } } : scriptResult;
        } };
        throw new Error(`Unexpected require: ${name}`);
      },
      console: { log() {}, error: (message) => errors.push(message) },
      process: { platform, env: {}, argv: ["node", "context-guard", "set-language", "--language", "zh"], exit(code) { exit = code; throw stopped; } },
    });
  } catch (error) { if (error !== stopped) throw error; }
  return { calls, errors, exit };
}
const valid = { status: 0, stdout: "Python 3.13.7\n" };

test("Windows prefers working python over the python3 Store alias", () => {
  const result = execute("win32", { python: valid, python3: { status: 9009 } });
  assert.equal(result.exit, 0);
  assert.deepEqual(result.calls.map(call => call.command), ["python", "python"]);
  assert.deepEqual(result.calls[1].args.slice(1), ["set-language", "--language", "zh"]);
});

test("unusable aliases, missing commands, and timed-out probes allow fallback", () => {
  for (const broken of [{ status: 9009 }, { error: { code: "ENOENT" } }, { error: { code: "ETIMEDOUT" } }]) {
    const result = execute("win32", { python: broken, python3: valid });
    assert.equal(result.exit, 0);
    assert.deepEqual(result.calls.map(call => call.command), ["python", "python3", "python3"]);
  }
});

test("Unix prefers python3 and accepts its version on stderr", () => {
  const result = execute("linux", { python3: { status: 0, stderr: "Python 3.11.0\n" } });
  assert.equal(result.exit, 0);
  assert.deepEqual(result.calls.map(call => call.command), ["python3", "python3"]);
});

test("Python 2 and non-Python launchers are not usable Python 3", () => {
  const result = execute("linux", { python3: { status: 0, stdout: "Store placeholder" }, python: { status: 0, stdout: "Python 2.7.18\n" } });
  assert.equal(result.exit, 1);
  assert.ok(result.calls.every(call => call.args[0] === "--version"));
  assert.match(result.errors[0], /no working Python 3/);
});

test("a real command failure is propagated without running it twice", () => {
  for (const [scriptResult, expected] of [[{ status: 7 }, 7], [{ status: null }, 1], [{ error: { message: "spawn failed" } }, 1]]) {
    const result = execute("win32", { python: valid, python3: valid }, scriptResult);
    assert.equal(result.exit, expected);
    assert.equal(result.calls.length, 2);
  }
});

test("Python CLI advertises only supported v1 commands", () => {
  const script = fileURLToPath(new URL("../../scripts/context_guard.py", import.meta.url));
  const candidates = process.platform === "win32" ? ["python", "python3"] : ["python3", "python"];
  const result = candidates
    .map(command => spawnSync(command, [script, "--help"], { encoding: "utf8", windowsHide: true }))
    .find(item => !item.error && item.status === 0);
  assert.ok(result, "Python 3 is required for the CLI contract test");
  assert.match(result.stdout, /\binit\b/);
  assert.match(result.stdout, /\bworkbench\b/);
  for (const removed of ["test-hub", "feature-chain", "show-roadmap", "dev-complete"]) {
    assert.doesNotMatch(result.stdout, new RegExp(removed));
  }
});
