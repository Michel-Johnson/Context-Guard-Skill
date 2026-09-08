import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { wantsHelp, parseInputJSON } from "../../scripts/workbench/cli.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const publicCli = path.join(repositoryRoot, "bin", "context-guard-skill.js");
const workbenchCli = path.join(repositoryRoot, "scripts", "workbench", "cli.mjs");

test("JSON input errors identify missing input without reflecting the submitted content", () => {
  assert.throws(() => parseInputJSON(" \n"), { code: "INPUT_REQUIRED" });
  assert.throws(() => parseInputJSON("private-input-marker{"), error => error.code === "INVALID_JSON" && !error.message.includes("private-input-marker"));
  assert.deepEqual(parseInputJSON('{"operationId":"handoff"}'), { operationId: "handoff" });
});

function runCli(script, args, cwd) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    timeout: 8000,
    env: {
      ...process.env,
      CI: "1",
      CONTEXT_GUARD_HEADLESS: "1",
      CONTEXT_GUARD_NAMED_WORKBENCH: "0",
    },
  });
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function assertHelpOnly(result, directory, expected) {
  const leftover = fs.existsSync(path.join(directory, ".codex"));
  if (leftover) {
    runCli(publicCli, ["workbench", "--stop", "--root", directory], directory);
  }
  assert.equal(result.error, undefined, result.error?.stack || "");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Usage:/);
  assert.match(result.stdout, expected);
  assert.doesNotMatch(result.stdout, /SESSION_REQUIRED/);
  const payload = parseJson(result.stdout);
  assert.equal(payload, null, "help must print usage text, not JSON");
  assert.equal(leftover, false, "help must not write .codex/context");
}

function withEmptyRoot(fn) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cg-help-"));
  try {
    return fn(directory);
  } finally {
    if (fs.existsSync(path.join(directory, ".codex"))) {
      runCli(publicCli, ["workbench", "--stop", "--root", directory], directory);
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test("public workbench --help prints usage and does not start a service", () => {
  withEmptyRoot((directory) => {
    assertHelpOnly(runCli(publicCli, ["workbench", "--help"], directory), directory, /--session/);
  });
});

test("public workbench -h and --help after --root stay side-effect free", () => {
  withEmptyRoot((directory) => {
    assertHelpOnly(runCli(publicCli, ["workbench", "-h"], directory), directory, /--diagnose/);
    assertHelpOnly(
      runCli(publicCli, ["workbench", "--help", "--root", directory], directory),
      directory,
      /--binding-status/,
    );
    assertHelpOnly(
      runCli(publicCli, ["workbench", "--root", directory, "--help"], directory),
      directory,
      /--bind-main/,
    );
  });
});

test("public map --help prints usage instead of SESSION_REQUIRED", () => {
  withEmptyRoot((directory) => {
    assertHelpOnly(runCli(publicCli, ["map", "--help"], directory), directory, /\bstatus\b/);
    assertHelpOnly(runCli(publicCli, ["map", "-h", "--root", directory], directory), directory, /\bread\b/);
  });
});

test("task handoff and plan help disclose required JSON without starting a project", () => {
  withEmptyRoot((directory) => {
    assertHelpOnly(runCli(publicCli, ["map", "task", "handoff", "--help"], directory), directory, /ciTodo.*unitTests.*experiences/);
    assertHelpOnly(runCli(publicCli, ["map", "task", "plan", "--help"], directory), directory, /operationId.*paths.*steps/);
    assertHelpOnly(runCli(publicCli, ["map", "ci", "exchange", "--help"], directory), directory, /"type":"object.read"/);
    assertHelpOnly(runCli(publicCli, ["map", "ci", "context", "--help"], directory), directory, /"type":"ci.result"/);
  });
});

test("direct Node workbench CLI honors --help before init", () => {
  withEmptyRoot((directory) => {
    assertHelpOnly(runCli(workbenchCli, ["workbench", "--help"], directory), directory, /--local-main/);
  });
});

test("public memory, preferences, and sync --help do not require a project", () => {
  withEmptyRoot((directory) => {
    assertHelpOnly(runCli(publicCli, ["memory", "--help"], directory), directory, /\bconfigure\b/);
    assertHelpOnly(runCli(publicCli, ["preferences", "--help"], directory), directory, /--language/);
    assertHelpOnly(runCli(publicCli, ["sync", "--help"], directory), directory, /\bcheckpoint\b/);
  });
});

test("help flags are not consumed when they are option values", () => {
  assert.equal(wantsHelp(["workbench", "--help"]), true);
  assert.equal(wantsHelp(["workbench", "-h"]), true);
  assert.equal(wantsHelp(["workbench", "--root", "/tmp", "-h"]), true);
  assert.equal(wantsHelp(["map", "apply", "--input", "-h"]), false);
  assert.equal(wantsHelp(["map", "apply", "--input", "-h", "--help"]), true);
  assert.equal(wantsHelp(["workbench", "--session", "-h"]), false);
  assert.equal(wantsHelp(["sync", "connect", "--token", "-h"]), false);
  withEmptyRoot((directory) => {
    const result = runCli(publicCli, ["sync", "connect", "--token", "-h"], directory);
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.doesNotMatch(result.stdout, /Usage:/);
    const payload = parseJson(result.stdout);
    assert.equal(payload?.error?.code, "USAGE");
    assert.equal(fs.existsSync(path.join(directory, ".codex")), false);
  });
});
