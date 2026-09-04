#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const workflowDirectory = ".github/workflows";
const workflows = Object.fromEntries(
  fs.readdirSync(workflowDirectory)
    .filter((file) => /\.ya?ml$/i.test(file))
    .sort()
    .map((file) => [file, fs.readFileSync(path.join(workflowDirectory, file), "utf8")]),
);
const ci = workflows["ci.yml"];
const publish = workflows["npm-publish.yml"];
const clients = workflows["client-compatibility.yml"];
const site = workflows["site-pages.yml"];
const dependabot = workflows["dependabot-auto-merge.yml"];
const testRunner = fs.readFileSync(".github/scripts/run-node-tests.mjs", "utf8");
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));

function requireMatch(content, pattern, message) {
  if (!pattern.test(content)) throw new Error(message);
}

function forbidMatch(content, pattern, message) {
  if (pattern.test(content)) throw new Error(message);
}

for (const [name, content] of Object.entries(workflows)) {
  const uses = [...content.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+)/gm)].map((match) => match[1]);
  for (const action of uses) {
    if (action.startsWith("./")) continue;
    if (!/@[0-9a-f]{40}$/i.test(action)) {
      throw new Error(`${name} workflow action is not pinned to a full commit SHA: ${action}`);
    }
  }
}

requireMatch(ci, /^\s*pull_request:\s*$/m, "CI must run for pull requests.");
requireMatch(ci, /^\s*push:\s*$/m, "CI must run after changes reach main.");
requireMatch(ci, /^\s+branches:\s*$[\s\S]*?^\s+- main\s*$/m, "CI push coverage must include main.");
requireMatch(ci, /^\s*name:\s*Required\s*$/m, "CI must expose the unique Required status check.");
requireMatch(ci, /^\s*- security\s*$/m, "Required must depend on the security job.");
requireMatch(ci, /test "\$SECURITY_RESULT" = "success"/, "Required must reject failed or skipped security checks.");
requireMatch(ci, /security-scan\.mjs ci/, "CI must scan the event commit range.");
forbidMatch(ci, /^\s*id-token:\s*write\s*$/m, "CI must not receive an OIDC write token.");
requireMatch(ci, /^  browser:\s*$/m, "CI must execute the approved browser flow.");
requireMatch(ci, /run: npm ci --ignore-scripts/, "Browser dependencies must be locked and must not run the Skill installer.");
requireMatch(ci, /run: npm run test:browser/, "Browser CI must run the real test entry.");
const aggregate = ci.slice(ci.indexOf("  required:"));
for (const job of ["package", "install", "minimum-runtime", "browser", "clients", "site"]) {
  requireMatch(aggregate, new RegExp(`^      - ${job}\\s*$`, "m"), `Required must wait for ${job}.`);
}
for (const result of ["PACKAGE", "INSTALL", "MINIMUM_RUNTIME", "BROWSER", "CLIENTS", "SITE"]) {
  requireMatch(aggregate, new RegExp(`test "\\$${result}_RESULT" = "success"`), `Required must reject failed/skipped ${result.toLowerCase()}.`);
}
forbidMatch(ci, /continue-on-error:\s*true/, "Required CI failures must propagate.");
const installJob = ci.slice(ci.indexOf("  install:"), ci.indexOf("  minimum-runtime:"));
requireMatch(installJob, /os:\s*windows-latest/, "Install CI must retain the Windows runner for workbench process regressions.");
forbidMatch(installJob, /run:\s*npm test/, "Install jobs must not repeat the complete test suite.");
requireMatch(ci, /^  minimum-runtime:\s*$/m, "CI must test the documented minimum runtimes.");
requireMatch(ci, /python-version:\s*"3\.9"/, "CI must test the documented minimum Python version.");
requireMatch(packageJson.scripts.test, /run-node-tests\.mjs/, "npm test must discover Node test files automatically.");
requireMatch(packageJson.scripts.test, /security-checks\.test\.mjs/, "npm test must retain the standalone security acceptance suite.");
requireMatch(testRunner, /endsWith\("\.test\.mjs"\)/, "The Node test runner must discover every .test.mjs file.");
requireMatch(testRunner, /security-checks\.test\.mjs/, "The only standalone test must be explicitly documented by the runner.");
requireMatch(packageJson.scripts.test, /verify-hidden-processes\.mjs/, "npm test must enforce hidden Windows child processes.");
requireMatch(packageJson.scripts.test, /verify-test-governance\.mjs/, "npm test must enforce the shared test manifest and style policy.");

for (const [name, content] of [["CI", ci], ["CD", publish]]) {
  const gate = content.indexOf('security-scan.mjs package "$PACKAGE_TARBALL"');
  const upload = content.indexOf("uses: actions/upload-artifact@");
  if (gate < 0 || upload < gate) throw new Error(`${name} must scan the final package before uploading it.`);
  requireMatch(content, /npm run security:setup/, `${name} must prepare the pinned scanner.`);
}

requireMatch(publish, /^\s*-\s*"v\*"\s*$/m, "Publishing must be triggered by version tags.");
forbidMatch(publish, /^\s*workflow_dispatch:\s*$/m, "Publishing must not have a manual trigger.");
forbidMatch(publish, /^\s*release:\s*$/m, "GitHub Releases must not trigger npm publishing.");
requireMatch(publish, /^\s*needs:\s*publish\s*$/m, "Registry verification must wait for npm publish.");
const oidcGrants = publish.match(/^\s*id-token:\s*write\s*$/gm) || [];
if (oidcGrants.length !== 1) {
  throw new Error(`Only the publish job may receive id-token: write; found ${oidcGrants.length} grants.`);
}

forbidMatch(ci, /secrets\.|openai-api-key|--dangerously|--api-key|session\/prompt|turn\/start/, "No-dialogue client CI must not use AI credentials or generation.");
forbidMatch(clients, /^\s*(?:pull_request_target|workflow_run):/m, "Client CI must not execute elevated untrusted workflows.");
forbidMatch(clients, /^\s*(?:push|pull_request):\s*$/m, "The legacy client workflow must not duplicate pull-request or main CI.");
for (const client of ["codex", "cursor", "claude"]) requireMatch(ci, new RegExp(`client: ${client}\\b`), `Missing real client: ${client}`);
requireMatch(site, /^\s*push:\s*$/m, "Site deployment must run after main changes.");
forbidMatch(site, /^\s*pull_request:\s*$/m, "Site deployment must not duplicate pull-request CI.");
requireMatch(ci, /^  site:\s*$/m, "Required CI must build and test the site.");
requireMatch(dependabot, /update-type == 'version-update:semver-patch'/, "Dependabot patch updates may be eligible for auto-merge.");
forbidMatch(dependabot, /update-type == 'version-update:semver-(?:minor|major)'/, "Dependabot minor and major updates require manual review.");

for (const [name, content] of Object.entries(workflows)) {
  if (name === "npm-publish.yml" || name === "site-pages.yml") continue;
  forbidMatch(content, /^\s*id-token:\s*write\s*$/m, `${name} must not receive an OIDC write token.`);
}
const siteOidcGrants = site.match(/^\s*id-token:\s*write\s*$/gm) || [];
if (siteOidcGrants.length !== 1 || site.indexOf("id-token: write") < site.indexOf("  deploy:")) {
  throw new Error("Only the site deploy job may receive id-token: write.");
}
console.log("Verified CI/CD/client triggers, no-dialogue scope, permissions, and Action SHA pins.");
