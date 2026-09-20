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
  const plan = selectImpact({ config, eventName: "push", changedPaths: ["docs/README.md"] });
  assert.equal(plan.full, true);
  assert.ok(Object.values(plan.jobs).every(Boolean));
});

test("repository-only documentation runs security and selector only", () => {
  const plan = selectImpact({ config, eventName: "pull_request", changedPaths: ["docs/README.md", "CI_todo.md"] });
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
    site: false,
  });
});

test("site-only changes select only the site job", () => {
  const plan = selectImpact({ config, eventName: "pull_request", changedPaths: ["site/src/App.tsx"] });
  assert.deepEqual(Object.entries(plan.jobs).filter(([, enabled]) => enabled).map(([job]) => job), ["site"]);
});

test("client installation changes include package, compatibility and minimum runtime", () => {
  const plan = selectImpact({ config, eventName: "pull_request", changedPaths: ["bin/context-guard-skill.js"] });
  for (const job of ["test", "package", "install", "minimum-runtime", "clients"]) assert.equal(plan.jobs[job], true);
  assert.equal(plan.jobs.browser, false);
  assert.equal(plan.jobs.site, false);
});

test("CI selector and governance changes force the complete CI", () => {
  for (const path of [".github/ci-impact.json", ".github/workflows/ci.yml", "docs/test-governance.md"]) {
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
