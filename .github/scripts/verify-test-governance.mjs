#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const manifestPath = "tests/test-manifest.json";
const manifest = JSON.parse(fs.readFileSync(path.join(root, manifestPath), "utf8"));
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

function walk(directory) {
  return fs.readdirSync(path.join(root, directory), { withFileTypes: true })
    .flatMap((entry) => {
      const relative = path.posix.join(directory, entry.name);
      return entry.isDirectory() ? walk(relative) : [relative];
    });
}

function fail(message) {
  throw new Error(`Test governance: ${message}`);
}

function requireFile(file) {
  if (!fs.statSync(path.join(root, file), { throwIfNoEntry: false })?.isFile()) {
    fail(`manifest entry does not exist: ${file}`);
  }
}

if (manifest.schemaVersion !== 1) fail("unsupported manifest schema version");
const automatic = manifest.automaticNodeTests;
const excluded = new Set(automatic.excluded);
const discovered = automatic.roots
  .flatMap(walk)
  .filter((file) => file.endsWith(automatic.suffix))
  .sort();

for (const file of discovered) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  if (excluded.has(file)) continue;
  if (!source.includes("node:test")) fail(`${file} must use node:test`);
  if (/\b(?:test|describe|it)\.only\s*\(/.test(source)) fail(`${file} contains a focused .only test`);
  for (const match of source.matchAll(/\b(?:test|describe|it)\.skip\s*\(([^\n]*)/g)) {
    if (!/["'`][^"'`]+["'`]/.test(match[1])) fail(`${file} contains a skip without a written reason/name`);
  }
}

for (const file of excluded) {
  if (!discovered.includes(file)) fail(`excluded automatic test is missing: ${file}`);
}

const standalone = new Set();
for (const suite of manifest.standaloneSuites) {
  requireFile(suite.path);
  if (!suite.command || !suite.purpose) fail(`standalone suite lacks command or purpose: ${suite.path}`);
  if (standalone.has(suite.path)) fail(`duplicate standalone suite: ${suite.path}`);
  standalone.add(suite.path);
  if (suite.path.endsWith(automatic.suffix) && !excluded.has(suite.path)) {
    fail(`${suite.path} must be excluded from the automatic runner to avoid duplicate execution`);
  }
}

for (const helper of manifest.helpers) {
  requireFile(helper.path);
  requireFile(helper.usedBy);
  const owner = fs.readFileSync(path.join(root, helper.usedBy), "utf8");
  if (!owner.includes(path.posix.basename(helper.path))) fail(`${helper.usedBy} no longer references helper ${helper.path}`);
}

const classifiedStandalone = new Set([...standalone, ...manifest.helpers.map((item) => item.path)]);
const looseTestFiles = walk("tests")
  .filter((file) => /\.(?:mjs|py)$/.test(file) && !file.endsWith(automatic.suffix));
for (const file of looseTestFiles) {
  if (!classifiedStandalone.has(file)) fail(`unclassified test runner/helper: ${file}`);
}

const allScripts = Object.values(packageJson.scripts).join("\n");
for (const suite of manifest.standaloneSuites) {
  if (!allScripts.includes(suite.path) && !allScripts.includes(suite.command.replace(/^npm (?:run )?/, ""))) {
    fail(`standalone suite is not reachable from package scripts: ${suite.path}`);
  }
}
for (const separate of manifest.separatePackages) {
  if (!fs.statSync(path.join(root, separate.root), { throwIfNoEntry: false })?.isDirectory()) {
    fail(`separate test package is missing: ${separate.root}`);
  }
  const nested = JSON.parse(fs.readFileSync(path.join(root, separate.root, "package.json"), "utf8"));
  if (!nested.scripts?.test) fail(`${separate.root} must expose npm test`);
}

console.log(`Verified ${discovered.length} automatic tests, ${standalone.size} standalone suites, and ${manifest.helpers.length} helpers.`);
