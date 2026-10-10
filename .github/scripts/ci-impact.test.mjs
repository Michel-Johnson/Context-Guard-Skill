#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { selectImpact, validateConfig } from "./ci-impact.mjs";

const config = JSON.parse(fs.readFileSync(new URL("../ci-impact.json", import.meta.url), "utf8"));

test("push events always run the complete CI", () => {
  const plan = selectImpact({ config, eventName: "push", changedPaths: ["development-docs/README.md"] });
  assert.equal(plan.full, true);
  assert.ok(Object.values(plan.jobs).every(Boolean));
});

test("Cursor source branches retain ordinary full CI, exact checkout, main/PR/tag coverage and read-only permissions", () => {
  const workflow = fs.readFileSync(new URL('../workflows/ci.yml', import.meta.url), 'utf8');
  const triggers = workflow.slice(workflow.indexOf('\non:'), workflow.indexOf('\npermissions:'));
  const push = triggers.slice(triggers.indexOf('\n  push:'));
  assert.match(push, /branches:\s*\n\s+- main\s*\n\s+- "cursor\/\*\*"/);
  assert.match(push, /tags:\s*\n\s+- "\*"/);
  assert.match(triggers, /pull_request:\s*\n\s+branches:\s*\n\s+- main/);
  const functional = workflow.slice(workflow.indexOf('\n  test:'), workflow.indexOf('\n  package:'));
  assert.match(functional, /actions\/checkout@[a-f0-9]{40}[^\n]*\n\s+with:\s*\n\s+ref: \$\{\{ github.sha \}\}/);
  assert.match(functional, /name: CI \| 运行功能测试\s*\n\s+run: npm test/);
  assert.match(workflow, /permissions:\s*\n\s+contents: read/);
  assert.doesNotMatch(workflow, /contents: write|pull_request_target:|session\/prompt|continue-on-error: true/);
  const plan = selectImpact({ config, eventName: 'push', changedPaths: ['docs/README.md'] });
  assert.equal(plan.full, true); assert.ok(Object.values(plan.jobs).every(Boolean));
});

test("repository-only documentation runs security and selector only", () => {
  const plan = selectImpact({ config, eventName: "pull_request", changedPaths: ["development-docs/README.md", "CI_todo.md"] });
  assert.equal(plan.full, false);
  assert.ok(Object.values(plan.jobs).every((enabled) => !enabled));
});

test("workbench UI changes select tests, package and browser jobs", () => {
  const plan = selectImpact({ config, eventName: "pull_request", changedPaths: ["prototype/workbench-app.js"] });
  assert.deepEqual(plan.jobs, {
    test: true,
    package: true,
    install: false,
    "minimum-runtime": false,
    browser: true,
    clients: false,
  });
});

test("role documents retain package validation after moving into roles", () => {
  for (const role of ["README", "Coordinator", "Executor", "Tester"]) {
    const plan = selectImpact({ config, eventName: "pull_request", changedPaths: [`roles/${role}.md`] });
    assert.equal(plan.full, false);
    assert.deepEqual(plan.unmatchedPaths, []);
    assert.deepEqual(Object.entries(plan.jobs).filter(([, enabled]) => enabled).map(([job]) => job), ["package"]);
  }
});

test("browser fixture changes select the browser job", () => {
  const plan = selectImpact({ config, eventName: "pull_request", changedPaths: ["tests/fixtures/workbench-fixtures.js"] });
  assert.deepEqual(Object.entries(plan.jobs).filter(([, enabled]) => enabled).map(([job]) => job), ["browser"]);
});

test("moved catalog retains test and package validation", () => {
  for (const [path, expected] of [
    ["skill-reference/interface-contract-v2.json", ["test", "package"]],
  ]) {
    const plan = selectImpact({ config, eventName: "pull_request", changedPaths: [path] });
    assert.equal(plan.full, false);
    assert.deepEqual(plan.unmatchedPaths, []);
    assert.deepEqual(Object.entries(plan.jobs).filter(([, enabled]) => enabled).map(([job]) => job), expected);
  }
});

test("Hook integration helper changes select only tests and minimum runtime", () => {
  const plan = selectImpact({ config, eventName: "pull_request", changedPaths: ["tests/hook-test-helpers.mjs"] });
  assert.equal(plan.full, false);
  assert.deepEqual(plan.unmatchedPaths, []);
  assert.deepEqual(plan.matchedRules, ["test-helpers"]);
  assert.deepEqual(plan.jobs, {
    test: true,
    package: false,
    install: false,
    "minimum-runtime": true,
    browser: false,
    clients: false,
  });
});

test("approved test helpers are classified even before Git tracking", () => {
  const manifest = JSON.parse(fs.readFileSync(new URL("../../tests/test-manifest.json", import.meta.url), "utf8"));
  // The impact configuration remains authoritative; the manifest supplies only
  // additional paths to check, never job permissions or selection rules.
  for (const helper of manifest.helpers) {
    const plan = selectImpact({ config, eventName: "pull_request", changedPaths: [helper.path] });
    assert.deepEqual(plan.unmatchedPaths, [], helper.path);
  }
});

test("client installation changes include package, compatibility and minimum runtime", () => {
  const plan = selectImpact({ config, eventName: "pull_request", changedPaths: ["bin/context-guard-skill.js"] });
  for (const job of ["test", "package", "install", "minimum-runtime", "clients"]) assert.equal(plan.jobs[job], true);
  assert.equal(plan.jobs.browser, false);
});

test("CI selector and governance changes force the complete CI", () => {
  for (const path of [
    ".github/ci-impact.json",
    ".github/workflows/ci.yml",
    "development-docs/engineering/README.md",
    "development-docs/ci.md",
    "bin/build-runtime.mjs",
    "package-lock.json",
    "tests/cursor-ci-runner-docker.mjs",
    "scripts/cloud/server.mjs",
    "scripts/sync/client.mjs",
  ]) {
    const plan = selectImpact({ config, eventName: "pull_request", changedPaths: [path] });
    assert.equal(plan.full, true, path);
  }
});

test("unknown paths fail closed to the complete CI", () => {
  const plan = selectImpact({ config, eventName: "pull_request", changedPaths: ["new-area/service.mjs"] });
  assert.equal(plan.full, true);
  assert.deepEqual(plan.unmatchedPaths, ["new-area/service.mjs"]);
});

test("empty pull request diffs fail closed to the complete CI", () => {
  const plan = selectImpact({ config, eventName: "pull_request", changedPaths: [] });
  assert.equal(plan.full, true);
  assert.equal(plan.reason, "empty-diff");
});

test("configuration rejects unknown jobs", () => {
  const invalid = structuredClone(config);
  invalid.rules[0].jobs.push("invented");
  assert.throws(() => validateConfig(invalid), /Unknown CI impact job/);
});

test("every tracked repository path is classified or explicitly forces full CI", () => {
  const paths = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", windowsHide: true }).split("\0").filter(Boolean);
  const unknown = paths.filter((path) => {
    const plan = selectImpact({ config, eventName: "pull_request", changedPaths: [path] });
    return plan.reason === "unmatched-path";
  });
  assert.deepEqual(unknown, []);
});

test("push CLI accepts an empty PR base and writes a full plan", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "context-guard-ci-impact-"));
  try {
    const output = path.join(directory, "output");
    const planPath = path.join(directory, "plan.json");
    const result = spawnSync(process.execPath, [
      ".github/scripts/ci-impact.mjs",
      "--event", "push",
      "--base", "",
      "--head", "HEAD",
      "--output", output,
      "--plan", planPath,
    ], { encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
    assert.equal(plan.full, true);
    assert.match(fs.readFileSync(output, "utf8"), /^minimum_runtime=true$/m);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
