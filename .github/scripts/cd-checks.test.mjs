import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assertDigest, assertPublishable, packageName, prepareBaseline, receiptMarkdown, sha256, verifyPublished } from "./release-checks.mjs";
import { assertCliContents, assertHooks, assertPreserved, snapshotFiles } from "./smoke-upgrade-package.mjs";
import { verifyReleaseHardening } from "./verify-workflows.mjs";

const bytes = Buffer.from("candidate tarball bytes");
const tarball = "https://registry.npmjs.org/@michelj/context-guard/-/context-guard-0.4.5.tgz";
function metadata(version = "0.4.5") {
  return {
    name: packageName, "dist-tags": { latest: version },
    versions: { [version]: {
      name: packageName, version,
      repository: { url: "git+https://github.com/Michel-Johnson/Context-Guard-Skill.git" },
      dist: { tarball, integrity: `sha512-${crypto.createHash("sha512").update(bytes).digest("base64")}` }
    } }
  };
}
const registry = (value = metadata(), payload = bytes) => async (url) => new Response(url === tarball ? payload : JSON.stringify(value));
const noWait = async () => {};

test("SHA-256 accepts identical bytes and rejects changed bytes or malformed expected digest", () => {
  assert.equal(assertDigest(bytes, sha256(bytes)), sha256(bytes));
  assert.throws(() => assertDigest(Buffer.from("different"), sha256(bytes)), /mismatch/);
  assert.throws(() => assertDigest(bytes, "bad-hash"), /Invalid expected/);
});

test("CLI comparison allows npm shebang normalization but rejects body changes", () => {
  const source = "#!/usr/bin/env node\r\nconsole.log(1);\r\n";
  assertCliContents(source.replace("node\r\n", "node\n"), source);
  assert.throws(() => assertCliContents(source.replaceAll("\r\n", "\n"), source), /CLI differs/);
  assert.throws(() => assertCliContents(source.replace("node\r\n", "node\n").replace("log(1)", "log(2)"), source), /CLI differs/);
});

for (const [latest, target] of [["0.4.4", "0.4.5"], ["0.4.9", "0.4.10"], ["0.9.9", "0.10.0"], ["0.99.99", "1.0.0"]]) {
  test(`version guard accepts ${latest} -> ${target}`, () => assert.equal(assertPublishable(target, metadata(latest)), latest));
}
for (const target of ["0.4.5", "0.4.4", "0.3.99", "0.4.6-beta.1", "v0.4.6", "00.4.6", "1.0", "1.0.0+build"]) {
  test(`version guard blocks duplicate, older or invalid target ${target}`, () => assert.throws(() => assertPublishable(target, metadata())));
}
test("version guard fails closed for unknown latest, wrong package or missing registry versions", () => {
  for (const edit of [
    (value) => { delete value["dist-tags"].latest; },
    (value) => { value["dist-tags"].latest = "0.5.0-beta"; },
    (value) => { value["dist-tags"].latest = "0.5.0"; },
    (value) => { value.name = "another-package"; },
    (value) => { delete value.versions; }
  ]) {
    const value = metadata(); edit(value);
    assert.throws(() => assertPublishable("0.5.1", value));
  }
});

test("published receipt proves exact version, latest, identity, and downloaded bytes", async () => {
  const receipt = await verifyPublished("0.4.5", sha256(bytes), { fetchImpl: registry() });
  assert.equal(receipt.actual, sha256(bytes));
  assert.equal(receipt.latest, "0.4.5");
  const summary = receiptMarkdown("0.4.5", sha256(bytes), receipt, { commit: "abc123" });
  assert.match(summary, /abc123/);
  assert.match(summary, /npmjs.com\/package\/@michelj\/context-guard\/v\/0.4.5/);
});
test("published verification retries delayed metadata and transient HTTP failures", async () => {
  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    if (calls === 1) return new Response("not visible", { status: 404 });
    if (calls === 2) return new Response(JSON.stringify(metadata("0.4.4")));
    if (calls === 3) return new Response("temporary outage", { status: 503 });
    return registry()(url);
  };
  await verifyPublished("0.4.5", sha256(bytes), { fetchImpl, sleep: noWait, attempts: 4 });
  assert.equal(calls, 5);
});
test("unavailable latest and network failures exhaust bounded retries", async () => {
  await assert.rejects(verifyPublished("0.4.5", sha256(bytes), { fetchImpl: registry(metadata("0.4.4")), sleep: noWait, attempts: 2 }), /not visible/);
  await assert.rejects(verifyPublished("0.4.5", sha256(bytes), { fetchImpl: async () => { throw new TypeError("network unavailable"); }, sleep: noWait, attempts: 2 }), /network unavailable/);
});
test("hash mismatch fails without retries and produces an honest failure receipt", async () => {
  const receipt = {};
  let waits = 0;
  await assert.rejects(verifyPublished("0.4.5", "0".repeat(64), {
    fetchImpl: registry(), receipt, sleep: async () => { waits += 1; }
  }), /SHA-256 mismatch/);
  assert.equal(waits, 0);
  assert.equal(receipt.actual, sha256(bytes));
  assert.match(receiptMarkdown("0.4.5", "0".repeat(64), receipt, { error: new Error("mismatch") }), /不会自动回滚/);
});
test("registry identity, repository, version, integrity and tarball origin are enforced", async () => {
  for (const edit of [
    (value) => { value.name = "wrong"; },
    (value) => { value.versions["0.4.5"].name = "wrong"; },
    (value) => { value.versions["0.4.5"].version = "0.4.6"; },
    (value) => { value.versions["0.4.5"].repository.url = "wrong"; },
    (value) => { value.versions["0.4.5"].dist.tarball = "https://example.com/package.tgz"; },
    (value) => { value.versions["0.4.5"].dist.tarball = "http://registry.npmjs.org/package.tgz"; },
    (value) => { value.versions["0.4.5"].dist.integrity = "sha512-wrong"; }
  ]) {
    const value = metadata(); edit(value);
    await assert.rejects(verifyPublished("0.4.5", sha256(bytes), { fetchImpl: registry(value), attempts: 1 }));
  }
});

test("baseline is pinned with independently checked npm integrity", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "context-guard-cd-unit-"));
  try {
    const baseline = await prepareBaseline(root, { fetchImpl: registry() });
    assert.equal(baseline.version, "0.4.5");
    assertDigest(fs.readFileSync(path.join(root, "previous.tgz")), baseline.sha256);
    await assert.rejects(prepareBaseline(root, { fetchImpl: registry(metadata(), Buffer.from("corrupt")) }), /integrity mismatch/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("preservation check detects removed or overwritten user context", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "context-guard-cd-unit-"));
  try {
    const file = path.join(root, "notes.md");
    fs.writeFileSync(file, "user data");
    const before = snapshotFiles(root);
    assertPreserved(root, before);
    fs.writeFileSync(file, "overwritten");
    assert.throws(() => assertPreserved(root, before), /changed/);
    fs.unlinkSync(file);
    assert.throws(() => assertPreserved(root, before), /removed/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test("hook acceptance rejects missing or duplicate managed hooks", () => {
  assert.throws(() => assertHooks({ userSetting: { keep: true }, hooks: {} }, "codex", "/fake"), /exactly one/);
  const config = { userSetting: { keep: true }, hooks: { sessionStart: [
    { command: "python context_guard_hook.py" }, { command: "python context_guard_hook.py" }
  ] } };
  assert.throws(() => assertHooks(config, "cursor", "/fake"), /exactly one/);
});

test("workflow guards reject per-tag locks, invalid queue keys, cancellation, or missing release checks", () => {
  const publish = fs.readFileSync(".github/workflows/npm-publish.yml", "utf8");
  verifyReleaseHardening(publish);
  for (const [from, to] of [
    ["group: npm-publish-stable", "group: npm-publish-${{ github.ref }}"],
    ["cancel-in-progress: false", "cancel-in-progress: true"],
    ["- name: CD | 发布前再次确认版本仍可发布\n        run: node .github/scripts/release-checks.mjs guard", "- name: CD | 发布前再次确认版本仍可发布\n        run: node .github/scripts/release-checks.mjs guard-disabled"],
    ["release-checks.mjs verify dist", "release-checks.mjs missing dist"],
    ["smoke-upgrade-package.mjs", "missing-upgrade.mjs"]
  ]) {
    const changed = publish.replaceAll("\r\n", "\n").replace(from, to);
    assert.notEqual(changed, publish.replaceAll("\r\n", "\n"), `Mutation did not apply: ${from}`);
    assert.throws(() => verifyReleaseHardening(changed));
  }
  assert.throws(() => verifyReleaseHardening(`${publish}\nqueue: max\n`), /does not support/);
});
