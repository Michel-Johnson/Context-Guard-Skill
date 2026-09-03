import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { once } from "node:events";
import { isolatedEnvironment, allowedMethods, run, rpcClient } from "./client-protocol.mjs";
import { assertInside, codexEvents, verifyInstalled, verifyCodexDiscovery, verifyNativeSession, verifyWorkbench, isCursorAuthBoundary } from "./smoke-clients.mjs";
import { installedFiles } from "./package-contract.mjs";

function scratch(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "context-guard-client-unit-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }));
  return root;
}

test("child environments isolate personal directories and discard credentials/options", (t) => {
  const root = scratch(t);
  const env = isolatedEnvironment(root, { PATH: "test-path", HOME: "/personal", CODEX_HOME: "/personal/codex",
    OPENAI_API_KEY: "secret", ANTHROPIC_API_KEY: "secret", CURSOR_API_KEY: "secret", GITHUB_TOKEN: "secret", NODE_OPTIONS: "--require malicious", CONTEXT_GUARD_SKILL_TARGET: "/personal/skill" });
  assert.equal(env.PATH, "test-path");
  for (const key of ["HOME", "USERPROFILE", "CODEX_HOME", "CURSOR_HOME", "CLAUDE_HOME", "CLAUDE_CONFIG_DIR", "APPDATA", "LOCALAPPDATA", "TMP", "TEMP"]) assertInside(root, env[key]);
  for (const key of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "CURSOR_API_KEY", "GITHUB_TOKEN", "NODE_OPTIONS", "CONTEXT_GUARD_SKILL_TARGET"]) assert.equal(env[key], undefined);
});

test("inspection protocol never allows conversation generation or authentication", () => {
  for (const method of ["turn/start", "turn/steer", "session/prompt", "authenticate", "hooks/approve", "skills/config/write"]) assert.ok(!allowedMethods.has(method));
});

test("process runner preserves Unicode, rejects failure, and enforces deadlines", { timeout: 10_000 }, async (t) => {
  const root = scratch(t), env = isolatedEnvironment(root);
  const result = await run(process.execPath, ["-e", "process.stdout.write('中文 / English')"], { cwd: root, env });
  assert.equal(result.stdout, "中文 / English");
  await assert.rejects(run(process.execPath, ["-e", "console.error('broken');process.exit(7)"], { cwd: root, env }), (error) => /exited with 7/.test(error.message) && error.stderr.includes("broken"));
  const started = Date.now();
  await assert.rejects(run(process.execPath, ["-e", "setInterval(()=>{},1000)"], { cwd: root, env, timeout: 300 }), /timed out/);
  assert.ok(Date.now() - started < 7500, "Timed-out test process was not promptly terminated");
  await assert.rejects(run(path.join(root, "missing-executable"), [], { cwd: root, env }), /ENOENT/);
});

test("RPC separates request ids, rejects forbidden methods and shuts down on EOF", async (t) => {
  const root = scratch(t), env = isolatedEnvironment(root);
  const server = "require('readline').createInterface({input:process.stdin}).on('line',l=>{const m=JSON.parse(l); if(m.id) console.log(JSON.stringify({id:m.id,result:{method:m.method}}));});";
  const rpc = rpcClient(process.execPath, ["-e", server], { cwd: root, env });
  try {
    assert.deepEqual(await rpc.request("initialize"), { method: "initialize" });
    assert.deepEqual(await rpc.request("skills/list"), { method: "skills/list" });
    assert.throws(() => rpc.request("turn/start"), /Forbidden RPC method/);
    assert.throws(() => rpc.notify("session/prompt"), /Forbidden RPC method/);
  } finally { await rpc.close(); }
});

test("RPC errors and invalid output cannot be mistaken for successful inspection", async (t) => {
  const root = scratch(t), env = isolatedEnvironment(root);
  for (const response of ["console.log('invalid-json')", "console.log(JSON.stringify({id:m.id,error:{code:-32000,message:'Authentication required'}}))"]) {
    const rpc = rpcClient(process.execPath, ["-e", `require('readline').createInterface({input:process.stdin}).on('line',l=>{const m=JSON.parse(l);${response}});`], { cwd: root, env });
    try { await assert.rejects(rpc.request("initialize"), /Invalid RPC JSON|Authentication required/); }
    finally { await rpc.close(); }
  }
  const rpc = rpcClient(process.execPath, ["-e", "process.stdin.resume()"], { cwd: root, env, timeout: 200 });
  try { await assert.rejects(rpc.request("initialize"), /RPC timed out/); }
  finally { await rpc.close(); }
});

test("discovery checker rejects missing, disabled, wrong-path skills and hooks", (t) => {
  const root = scratch(t), skill = path.join(root, "skill"), hooksPath = path.join(root, "hooks.json");
  const good = {
    skills: { data: [{ cwd: root, errors: [], skills: [{ name: "context-guard", enabled: true, path: path.join(skill, "SKILL.md") }] }] },
    hooks: { data: [{ cwd: root, errors: [], hooks: Object.values(codexEvents).map((eventName) => ({ eventName, enabled: true, handlerType: "command", command: "python context_guard_hook.py --platform codex", sourcePath: hooksPath, trustStatus: "untrusted" })) }] }
  };
  assert.equal(verifyCodexDiscovery(good, root, skill, hooksPath).length, 11);
  for (const mutate of [
    (value) => { value.skills.data[0].skills = []; },
    (value) => { value.skills.data[0].skills[0].enabled = false; },
    (value) => { value.skills.data[0].skills[0].path = path.join(root, "wrong"); },
    (value) => { value.hooks.data[0].hooks.shift(); },
    (value) => { value.hooks.data[0].hooks[0].enabled = false; },
    (value) => { value.hooks.data[0].errors.push("bad JSON"); }
  ]) {
    const broken = structuredClone(good); mutate(broken);
    assert.throws(() => verifyCodexDiscovery(broken, root, skill, hooksPath));
  }
});

test("installation checker rejects missing hook config and development leakage", (t) => {
  const root = scratch(t);
  for (const file of installedFiles) { const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, "fixture"); }
  const hooks = Object.fromEntries(["sessionStart", "beforeSubmitPrompt", "stop", "subagentStart", "subagentStop"].map((name) => [name, [{ type: "command", command: "python context_guard_hook.py --platform cursor" }]]));
  verifyInstalled(root, { hooks }, "cursor");
  assert.throws(() => verifyInstalled(root, {}, "cursor"), /Missing installed cursor hook/);
  fs.mkdirSync(path.join(root, "tests"));
  assert.throws(() => verifyInstalled(root, { hooks }, "cursor"), /Development file leaked/);
});

test("native initialization requires real-shaped session evidence, not just files", (t) => {
  const root = scratch(t);
  assert.throws(() => verifyNativeSession(root, "claude"), /No native SessionStart evidence/);
  const ctx = path.join(root, ".codex", "context");
  for (const dir of ["tasks", "bugs", "fixes", "cards", "sessions", "private"]) fs.mkdirSync(path.join(ctx, dir), { recursive: true });
  for (const file of ["index.md", "FIND.md", "architecture.md", "preferences.json", "user-messages.md", "bugs-index.json", "map.json"]) fs.writeFileSync(path.join(ctx, file), "fixture");
  fs.writeFileSync(path.join(ctx, "sessions.jsonl"), JSON.stringify({ platform: "claude", event: "session-start", root_source: "hook payload", session_id: "test-session" }));
  assert.throws(() => verifyNativeSession(root, "claude"), /Missing native session record/);
  fs.writeFileSync(path.join(ctx, "sessions", "test-session.md"), "fixture");
  assert.equal(verifyNativeSession(root, "claude").length, 1);
  assert.throws(() => verifyNativeSession(root, "codex"), /No native SessionStart evidence/);
});

test("workbench checks health, project, PID, page and instance reuse", async (t) => {
  const root = scratch(t);
  let responseRoot = root;
  const server = http.createServer((request, response) => {
    response.setHeader("Content-Type", request.url.includes("health") ? "application/json" : "text/html");
    response.end(request.url.includes("health") ? JSON.stringify({ root: responseRoot, pid: 123 }) : "<title>Context Guard</title>");
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  const ctx = path.join(root, ".codex", "context", "private"); fs.mkdirSync(ctx, { recursive: true });
  const state = { url: `http://127.0.0.1:${server.address().port}/`, pid: 123 };
  const write = (value) => fs.writeFileSync(path.join(ctx, "workbench.json"), JSON.stringify(value));
  write(state); await verifyWorkbench(root, state);
  responseRoot = path.join(root, "wrong"); await assert.rejects(verifyWorkbench(root), /wrong project/); responseRoot = root;
  write({ ...state, pid: 456 }); await assert.rejects(verifyWorkbench(root), /PID mismatch/);
  write(state); await assert.rejects(verifyWorkbench(root, { ...state, pid: 456 }), /Duplicate workbench/);
  write({ ...state, url: "http://example.com/" }); await assert.rejects(verifyWorkbench(root), /loopback/);
});

test("only the exact Cursor auth response is a known coverage boundary", () => {
  assert.ok(isCursorAuthBoundary({ rpcError: { code: -32000, message: "Authentication required" } }));
  for (const error of [undefined, new Error("network failure"), { rpcError: { code: -1, message: "Authentication required" } }, { rpcError: { code: -32000, message: "Internal error" } }]) assert.ok(!isCursorAuthBoundary(error));
});

test("cleanup rejects workspace root, parent and sibling paths", (t) => {
  const root = scratch(t);
  assertInside(root, path.join(root, "child"));
  for (const target of [root, path.dirname(root), `${root}-sibling`]) assert.throws(() => assertInside(root, target), /inside/);
});

test("cleanup resolves temporary-directory aliases without allowing link escapes", (t) => {
  const root = scratch(t), real = path.join(root, "real"), alias = path.join(root, "alias"), outside = path.join(root, "outside");
  fs.mkdirSync(path.join(real, "child"), { recursive: true }); fs.mkdirSync(outside);
  const kind = process.platform === "win32" ? "junction" : "dir";
  fs.symlinkSync(real, alias, kind);
  assertInside(alias, path.join(alias, "child"));
  assertInside(alias, path.join(alias, "missing", "child"));
  assert.throws(() => assertInside(real, alias), /linked target/);
  assert.throws(() => assertInside(alias, outside), /inside/);
  const escape = path.join(real, "escape"); fs.symlinkSync(outside, escape, kind);
  assert.throws(() => assertInside(real, escape), /linked target/);
  assert.throws(() => assertInside(real, path.join(escape, "missing")), /inside/);
});
