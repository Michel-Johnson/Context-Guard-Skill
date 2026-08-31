import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { npmInvocation } from "./npm-command.mjs";
import { toolRoot, pythonInvocation, getScanner } from "./security-tool.mjs";
import { SecurityError, forbiddenPath, snapshot, history, scan, scanPackage, scannerOutcome } from "./security-lib.mjs";

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "context-guard-security-tests-"));
const env = { ...process.env, GIT_AUTHOR_NAME: "Security Test", GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "Security Test", GIT_COMMITTER_EMAIL: "test@example.invalid" };
let count = 0;
let passed = false;
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: temporaryRoot, env, encoding: "utf8", windowsHide: true, timeout: 120_000, ...options });
  if (result.error || result.status !== 0) throw new Error("Test setup operation failed; output withheld.");
  return result.stdout;
}
function git(root, ...args) { return run("git", ["-c", "commit.gpgsign=false", ...args], { cwd: root }).trim(); }
function check(name, action) {
  try { action(); count++; console.log(`Security check passed: ${name}`); }
  catch { throw new Error(`Security check failed: ${name}. Evidence retained; raw values withheld.`); }
}
function blocked(action) { assert.throws(action, SecurityError); }
function write(root, name, value) { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); }
function createRepository(name) {
  const root = path.join(temporaryRoot, name);
  fs.mkdirSync(root);
  git(root, "init", "--initial-branch=main", "--quiet");
  write(root, "README.md", "Safe public documentation.\n");
  git(root, "add", "README.md");
  git(root, "commit", "--quiet", "-m", "Initial safe state");
  return root;
}
function cli(script, args, root, options = {}) {
  return spawnSync(process.execPath, [path.join(toolRoot, ".github/scripts", script), ...args], {
    cwd: root, env, encoding: "utf8", windowsHide: true, timeout: 120_000, ...options
  });
}
// Synthetic, never valid credentials. Construct at runtime instead of committing token literals.
const token = ["gh", "p_"].join("") + crypto.randomBytes(27).toString("base64").replace(/[+/]/g, "A");
const accessKey = ["AK", "IA"].join("") + Array.from(crypto.randomBytes(16), value => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[value % 32]).join("");
const privateKey = crypto.generateKeyPairSync("rsa", { modulusLength: 1024 }).privateKey.export({ type: "pkcs8", format: "pem" });

try {
  getScanner();
  check("forbidden paths and explicit safe examples", () => {
    for (const name of [".codex/context/map.json", "nested/.codex/session.md", ".env", ".env.production", ".npmrc", "id_rsa", "key.key", "secrets.json", "output/report.json", "node_modules/file.js", "../escape", "a\\b"]) assert.equal(forbiddenPath(name), true);
    for (const name of ["README.md", ".env.example", "agents/openai.yaml", ".github/scripts/security-checks.test.mjs"]) assert.equal(forbiddenPath(name), false);
    assert.equal(forbiddenPath(".github/scripts/check.mjs", true), true);
  });
  const root = createRepository("index");
  check("clean staged snapshot", () => snapshot(root));
  check("unstaged secrets do not change the staged snapshot", () => { write(root, "README.md", token); snapshot(root); });
  check("staged secret is blocked despite clean working file", () => {
    git(root, "add", "README.md"); write(root, "README.md", "Clean working file\n"); blocked(() => snapshot(root));
  });
  check("CLI report and stderr never contain the synthetic secret", () => {
    const result = cli("security-scan.mjs", ["staged"], root);
    assert.notEqual(result.status, 0);
    assert.equal(`${result.stdout}${result.stderr}`.includes(token), false);
    assert.equal(JSON.parse(result.stderr).findings.length > 0, true);
  });
  git(root, "add", "README.md");
  check("private staged paths are rejected without deleting local data", () => {
    write(root, ".codex/context/map.json", "{\"private\":true}");
    const before = fs.readFileSync(path.join(root, ".codex/context/map.json"));
    git(root, "add", "-f", ".codex");
    blocked(() => snapshot(root));
    git(root, "rm", "--cached", "-r", ".codex");
    assert.deepEqual(fs.readFileSync(path.join(root, ".codex/context/map.json")), before);
    snapshot(root);
  });
  const content = path.join(temporaryRoot, "content"); fs.mkdirSync(content);
  for (const [name, value] of [["API token in source", `const credential = '${token}';`], ["AK in documentation", `AWS_ACCESS_KEY_ID=${accessKey}`], ["private key in ordinary text", privateKey]]) {
    check(name, () => { write(content, "public.txt", value); blocked(() => scan("dir", content)); });
  }
  check("inline allow comments cannot suppress secrets", () => {
    write(content, "public.txt", `const credential = '${token}'; // gitleaks:allow`); blocked(() => scan("dir", content));
  });
  check("missing scanner fails closed", () => blocked(() => scan("dir", content, [], path.join(temporaryRoot, "missing-scanner"))));
  check("crashed scanner fails closed", () => blocked(() => scan("dir", content, [], process.execPath)));
  check("timeout, malformed report and partial diagnostics fail closed", () => {
    const clean = { status: 0, stdout: "", stderr: "" };
    blocked(() => scannerOutcome({ ...clean, error: new Error("timeout") }, "[]", content));
    blocked(() => scannerOutcome(clean, "not json", content));
    blocked(() => scannerOutcome(clean, null, content));
    blocked(() => scannerOutcome({ ...clean, stderr: token }, "[]", content));
  });
  check("finding locations are stable and raw fields are excluded", () => {
    const rows = [{ File: path.join(content, "public.txt"), RuleID: "synthetic", StartLine: 2, Secret: token, Match: token }];
    try { scannerOutcome({ status: 10, stdout: token, stderr: token }, JSON.stringify(rows), content); assert.fail(); }
    catch (error) {
      assert.equal(error instanceof SecurityError, true);
      assert.equal(JSON.stringify(error.findings).includes(token), false);
      assert.equal(error.findings[0].fileId, crypto.createHash("sha256").update("public.txt").digest("hex").slice(0, 16));
    }
  });
  const historical = createRepository("history");
  const base = git(historical, "rev-parse", "HEAD");
  write(historical, "removed.js", `const credential = '${token}';`);
  git(historical, "add", "removed.js"); git(historical, "commit", "--quiet", "-m", "Synthetic test change");
  git(historical, "rm", "--quiet", "removed.js"); git(historical, "commit", "--quiet", "-m", "Remove synthetic change");
  const head = git(historical, "rev-parse", "HEAD");
  check("deleted intermediate secret is still rejected", () => { snapshot(historical, head); blocked(() => history(historical, head, base)); });
  check("pre-push checks outgoing history", () => {
    const result = cli("security-scan.mjs", ["push"], historical, { input: `refs/heads/main ${head} refs/heads/main ${base}\n` });
    assert.notEqual(result.status, 0); assert.equal(`${result.stdout}${result.stderr}`.includes(token), false);
  });
  check("first push does not skip history", () => {
    const result = cli("security-scan.mjs", ["push"], historical, { input: `refs/heads/main ${head} refs/heads/main ${"0".repeat(40)}\n` });
    assert.notEqual(result.status, 0);
  });
  check("deleting a branch requires no content upload", () => {
    const result = cli("security-scan.mjs", ["push"], historical, { input: `(delete) ${"0".repeat(40)} refs/heads/main ${head}\n` });
    assert.equal(result.status, 0);
  });
  check("missing comparison history fails closed", () => blocked(() => history(historical, head, "f".repeat(40))));
  check("local record added then removed is rejected from outgoing history", () => {
    const records = createRepository("record-history");
    const start = git(records, "rev-parse", "HEAD");
    write(records, ".codex/session.md", "Private conversation placeholder\n");
    git(records, "add", ".codex"); git(records, "commit", "--quiet", "-m", "Synthetic local record");
    git(records, "rm", "--quiet", "-r", ".codex"); git(records, "commit", "--quiet", "-m", "Remove local record");
    const end = git(records, "rev-parse", "HEAD");
    snapshot(records, end);
    blocked(() => history(records, end, start));
    blocked(() => history(records, end));
  });
  check("shallow clone fails closed", () => {
    const shallow = path.join(temporaryRoot, "shallow");
    run("git", ["clone", "--quiet", "--depth=1", new URL(`file:///${historical.replaceAll("\\", "/").replace(/^\//, "")}`).href, shallow]);
    blocked(() => history(shallow, head));
  });
  check("PR event scans actual head/base", () => {
    const payload = path.join(temporaryRoot, "event.json");
    fs.writeFileSync(payload, JSON.stringify({ pull_request: { head: { sha: head }, base: { sha: base } } }));
    const result = cli("security-scan.mjs", ["ci"], historical, { env: { ...env, GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: payload, GITHUB_SHA: head } });
    assert.notEqual(result.status, 0); assert.equal(`${result.stdout}${result.stderr}`.includes(token), false);
  });
  const hooks = createRepository("hooks");
  check("developer hooks install and status", () => {
    assert.equal(cli("security-hooks.mjs", ["install"], hooks).status, 0);
    assert.equal(cli("security-hooks.mjs", ["status"], hooks).status, 0);
  });
  check("actual git commit hook rejects staged secret", () => {
    write(hooks, "sample.js", `const credential = '${token}';`); git(hooks, "add", "sample.js");
    const result = spawnSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "Must be blocked"], { cwd: hooks, env, encoding: "utf8", windowsHide: true });
    assert.notEqual(result.status, 0); assert.equal(`${result.stdout}${result.stderr}`.includes(token), false);
  });
  check("actual git commit hook permits clean change", () => {
    write(hooks, "sample.js", "export const safe = true;\n"); git(hooks, "add", "sample.js"); git(hooks, "commit", "--quiet", "-m", "Safe change");
  });
  check("actual local git push permits clean history", () => {
    const remote = path.join(temporaryRoot, "clean-remote.git");
    run("git", ["init", "--bare", "--quiet", remote]);
    git(hooks, "push", "--quiet", remote, "HEAD:refs/heads/main");
    assert.equal(git(remote, "rev-parse", "refs/heads/main"), git(hooks, "rev-parse", "HEAD"));
  });
  check("actual local git push blocks historical secret before remote update", () => {
    const remote = path.join(temporaryRoot, "blocked-remote.git");
    run("git", ["init", "--bare", "--quiet", remote]);
    assert.equal(cli("security-hooks.mjs", ["install"], historical).status, 0);
    const result = spawnSync("git", ["push", remote, "HEAD:refs/heads/main"], { cwd: historical, env, encoding: "utf8", windowsHide: true });
    assert.notEqual(result.status, 0);
    assert.equal(result.stderr.includes('"security":"blocked"'), true);
    assert.equal(`${result.stdout}${result.stderr}`.includes(token), false);
    assert.equal(git(remote, "for-each-ref", "--format=%(refname)"), "");
  });
  check("existing user hooks are preserved", () => {
    const existing = createRepository("custom-hook");
    write(existing, ".git/hooks/pre-commit", "#!/bin/sh\nexit 0\n");
    assert.notEqual(cli("security-hooks.mjs", ["install"], existing).status, 0);
    assert.equal(fs.readFileSync(path.join(existing, ".git/hooks/pre-commit"), "utf8"), "#!/bin/sh\nexit 0\n");
  });
  const npm = npmInvocation();
  const packed = JSON.parse(run(npm.command, [...npm.args, "pack", "--json", "--ignore-scripts", "--pack-destination", temporaryRoot], { cwd: toolRoot }))[0];
  const tarball = path.join(temporaryRoot, packed.filename);
  check("actual clean npm tarball passes", () => scanPackage(tarball));
  const python = pythonInvocation();
  function altered(name, kind) {
    const destination = path.join(temporaryRoot, `${name}.tgz`);
    const source = [
      "import io,sys,tarfile",
      "source,dest,kind,token=sys.argv[1:]",
      "with tarfile.open(source,'r:gz') as src, tarfile.open(dest,'w:gz') as out:",
      " for member in src:",
      "  data=src.extractfile(member).read()",
      "  if kind=='secret' and member.name=='package/README.md': data=token.encode(); member.size=len(data)",
      "  out.addfile(member,io.BytesIO(data))",
      " if kind!='secret':",
      "  name={'private':'package/.codex/context/map.json','traversal':'package/../outside','link':'package/link','duplicate':'package/README.md'}[kind]",
      "  member=tarfile.TarInfo(name)",
      "  if kind=='link': member.type=tarfile.SYMTYPE; member.linkname='../outside'",
      "  out.addfile(member,io.BytesIO(b''))"
    ].join("\n");
    run(python.command, [...python.prefix, "-c", source, tarball, destination, kind, token]);
    return destination;
  }
  for (const kind of ["secret", "private", "traversal", "link", "duplicate"]) {
    check(`final package rejects ${kind}`, () => blocked(() => scanPackage(altered(kind, kind))));
  }
  check("workflow safety invariants", () => run(process.execPath, [".github/scripts/verify-workflows.mjs"], { cwd: toolRoot }));
  passed = true;
  console.log(`Security acceptance passed: ${count} checks; synthetic secrets only; no publication.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (passed && path.dirname(temporaryRoot) === path.resolve(os.tmpdir()) && path.basename(temporaryRoot).startsWith("context-guard-security-tests-")) fs.rmSync(temporaryRoot, { recursive: true, force: true });
  else console.error(`Preserved synthetic test evidence: ${temporaryRoot}`);
}
