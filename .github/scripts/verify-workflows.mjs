#!/usr/bin/env node

import fs from "node:fs";

const ci = fs.readFileSync(".github/workflows/ci.yml", "utf8");
const publish = fs.readFileSync(".github/workflows/npm-publish.yml", "utf8");

function requireMatch(content, pattern, message) {
  if (!pattern.test(content)) throw new Error(message);
}

function forbidMatch(content, pattern, message) {
  if (pattern.test(content)) throw new Error(message);
}

for (const [name, content] of [["CI", ci], ["publish", publish]]) {
  const uses = [...content.matchAll(/^\s*uses:\s*([^\s#]+)/gm)].map((match) => match[1]);
  for (const action of uses) {
    if (action.startsWith("./")) continue;
    if (!/@[0-9a-f]{40}$/i.test(action)) {
      throw new Error(`${name} workflow action is not pinned to a full commit SHA: ${action}`);
    }
  }
}

requireMatch(ci, /^\s*pull_request:\s*$/m, "CI must run for pull requests.");
requireMatch(ci, /^\s*push:\s*$/m, "CI must run after changes reach main.");
requireMatch(ci, /^\s*name:\s*Required\s*$/m, "CI must expose the unique Required status check.");
requireMatch(ci, /^\s*- security\s*$/m, "Required must depend on the security job.");
requireMatch(ci, /test "\$SECURITY_RESULT" = "success"/, "Required must reject failed or skipped security checks.");
requireMatch(ci, /security-scan\.mjs ci/, "CI must scan the event commit range.");
forbidMatch(ci, /^\s*id-token:\s*write\s*$/m, "CI must not receive an OIDC write token.");

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

console.log("Verified CI/CD workflow triggers, required check, OIDC scope, dependencies, and Action SHA pins.");
