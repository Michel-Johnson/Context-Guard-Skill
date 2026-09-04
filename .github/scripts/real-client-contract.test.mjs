import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { asksLanguage, assertInside, clientInvocation, clients, inspectPhase, parseClientOutput,
  redact, requiredDirectories, requiredFiles, runtimeEnvironment } from "./real-client-contract.mjs";
import { requireLiveRunner, run } from "./smoke-real-client.mjs";

test("all three adapters use real CLI entrypoints and explicit resume IDs", () => {
  for (const client of clients) {
    const first = clientInvocation(client, "hello");
    assert.ok(["codex", "agent", "claude"].includes(first.command));
    assert.ok(!first.args.includes("session-1"));
    const next = clientInvocation(client, "中文", "session-1", "test-model");
    assert.ok(next.args.includes("session-1"));
    assert.ok(next.args.includes("test-model"));
    assert.ok(next.args.includes("中文"));
    if (client !== "codex") assert.equal(next.args[1], "中文");
    assert.ok(!next.args.some((arg) => /--bare|bypass-hook-trust|danger-full-access|skip-permissions|--force|--yolo/.test(arg)));
  }
  assert.throws(() => clientInvocation("unknown", "hello"));
});

test("Codex parser requires a completed turn, native ID, and real assistant output", () => {
  const events = [
    { type: "thread.started", thread_id: "native-codex-id" },
    { type: "item.completed", item: { type: "agent_message", text: "中文还是 English？" } },
    { type: "turn.completed" }
  ];
  const lines = (items) => items.map(JSON.stringify).join("\n");
  assert.equal(parseClientOutput("codex", lines(events)).sessionId, "native-codex-id");
  assert.throws(() => parseClientOutput("codex", lines(events.slice(0, -1))));
  assert.throws(() => parseClientOutput("codex", lines([...events, { type: "turn.failed" }])));
  assert.throws(() => parseClientOutput("codex", "not JSON"));
});

for (const client of ["cursor", "claude"]) {
  test(`${client} parser rejects failed, incomplete, empty and misleading outputs`, () => {
    const result = { type: "result", subtype: "success", is_error: false, session_id: `${client}-id`, result: "Hello" };
    assert.equal(parseClientOutput(client, JSON.stringify(result)).text, "Hello");
    for (const patch of [{ is_error: true }, { subtype: "error_max_turns" }, { session_id: "" }, { result: "" }]) {
      assert.throws(() => parseClientOutput(client, JSON.stringify({ ...result, ...patch })));
    }
    assert.throws(() => parseClientOutput(client, JSON.stringify({ type: "assistant", text: "All tests passed" })));
    assert.throws(() => parseClientOutput(client, ""));
  });
}

test("language check distinguishes a choice question from an inferred preference", () => {
  assert.ok(asksLanguage("你希望用中文还是 English 记录项目？"));
  assert.ok(asksLanguage("Would you prefer Chinese or English?"));
  assert.ok(!asksLanguage("I will use English."));
  assert.ok(!asksLanguage("已保存中文，不再询问。"));
});

test("installation/assertions do not inherit credentials or installation overrides", () => {
  const env = runtimeEnvironment({ PATH: "/bin", HOME: "/home/test", OPENAI_API_KEY: "secret",
    CLIENT_API_KEY: "secret", GITHUB_TOKEN: "secret", NODE_OPTIONS: "--require malware",
    CODEX_HOME: "/personal", CLAUDE_HOME: "/personal", WORKSPACE_ROOT: "/wrong",
    CONTEXT_GUARD_SKILL_TARGET: "/wrong", CONTEXT_GUARD_SKIP_AUTO_INSTALL: "1" });
  assert.equal(env.HOME, "/home/test");
  assert.equal(env.CONTEXT_GUARD_HEADLESS, "1");
  for (const key of ["OPENAI_API_KEY", "CLIENT_API_KEY", "GITHUB_TOKEN", "NODE_OPTIONS", "CODEX_HOME",
    "CLAUDE_HOME", "WORKSPACE_ROOT", "CONTEXT_GUARD_SKILL_TARGET", "CONTEXT_GUARD_SKIP_AUTO_INSTALL"]) assert.ok(!(key in env));
  assert.equal(redact("key=test-credential again=test-credential", ["test-credential"]), "key=[REDACTED] again=[REDACTED]");
  assert.equal(redact("sk-ant-api03-0123456789"), "[REDACTED]");
});

test("live entrypoint refuses personal machines and reused runners", () => {
  assert.throws(() => requireLiveRunner({}, "win32"), /GitHub-hosted Ubuntu/);
  assert.throws(() => requireLiveRunner({}, "linux"), /personal client homes/);
  assert.throws(() => requireLiveRunner({ GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "self-hosted" }, "linux"), /self-hosted/);
  assert.throws(() => assertInside(os.tmpdir(), os.tmpdir()));
  assert.throws(() => assertInside(path.join(os.tmpdir(), "one"), path.join(os.tmpdir(), "other")));
});

test("live harness requires pinned command metadata for non-Codex clients", () => {
  const source = fs.readFileSync(".github/scripts/smoke-real-client.mjs", "utf8");
  assert.match(source, /CLIENT_COMMAND_FILE/);
  assert.match(source, /clientCommand\.client/);
  assert.match(source, /clientCommand\?\.args/);
});

test("process adapter preserves Unicode and propagates nonzero exits and timeouts", async () => {
  const env = runtimeEnvironment(process.env);
  const result = await run(process.execPath, ["-e", "process.stdout.write('中文')"], { env });
  assert.equal(result.stdout, "中文");
  await assert.rejects(run(process.execPath, ["-e", "process.exit(7)"], { env }), /exited with 7/);
  await assert.rejects(run(process.execPath, ["-e", "setInterval(()=>{},1000)"], { env, timeout: 100 }), /timed out/);
});

test("observable-state assertions go red for missing hooks, language, workbench, sessions and bugs", async () => {
  // Synthetic evidence tests the checker only. This is NOT real-client acceptance.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "context-guard-client-contract-"));
  const project = path.join(root, "project");
  const ctx = path.join(project, ".codex", "context");
  let reportedRoot = project;
  const server = http.createServer((request, response) => {
    if (request.url === "/__context_guard/health") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ root: reportedRoot, pid: 42 }));
    } else response.end("<h1>Context Guard</h1>");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const state = { url: `http://127.0.0.1:${server.address().port}/prototype/workbench.html`, pid: 42 };
  const json = (relative, data) => fs.writeFileSync(path.join(ctx, relative), JSON.stringify(data));
  let passed = false;
  try {
    for (const directory of requiredDirectories) fs.mkdirSync(path.join(ctx, directory), { recursive: true });
    for (const file of requiredFiles) fs.writeFileSync(path.join(ctx, file), "{}");
    json("private/workbench.json", state);
    json("preferences.json", { record_language: "unset" });
    const events = (id) => ["session-start", "user-prompt-submit", "stop"].map((event) => ({ event, session_id: id, platform: "cursor" }));
    const writeEvents = (items) => fs.writeFileSync(path.join(ctx, "sessions.jsonl"), items.map(JSON.stringify).join("\n"));
    writeEvents(events("session-one"));
    fs.writeFileSync(path.join(ctx, "sessions/session-one.md"), "first session");
    fs.writeFileSync(path.join(ctx, "user-messages.md"), "unique-marker");
    const first = { project, client: "cursor", phase: "first", marker: "unique-marker",
      reply: { sessionId: "session-one", text: "中文还是 English？" } };
    assert.deepEqual(await inspectPhase(first), state);
    writeEvents(events("session-one").slice(0, 2));
    await assert.rejects(inspectPhase(first), /No native cursor stop/);
    writeEvents(events("session-one"));
    json("preferences.json", { record_language: "en" });
    await assert.rejects(inspectPhase(first), /inferred/);
    json("preferences.json", { record_language: "unset" });
    await assert.rejects(inspectPhase({ ...first, reply: { ...first.reply, text: "Ready." } }), /did not ask/);
    reportedRoot = root;
    await assert.rejects(inspectPhase(first), /wrong project/);
    reportedRoot = project;
    await assert.rejects(inspectPhase({ ...first, previousWorkbench: { ...state, pid: 999 } }), /duplicate workbench/);
    json("preferences.json", { record_language: "zh" });
    const next = { ...first, phase: "new-session", firstSessionId: "session-one", reply: { sessionId: "session-two", text: "项目目录如下。" } };
    await assert.rejects(inspectPhase(next), /No native/);
    writeEvents([...events("session-one"), ...events("session-two")]);
    fs.writeFileSync(path.join(ctx, "sessions/session-two.md"), "second session");
    assert.deepEqual(await inspectPhase(next), state);
    await assert.rejects(inspectPhase({ ...next, reply: { ...next.reply, text: "中文还是 English？" } }), /asked for language again/);
    const bug = { ...next, phase: "bad-case" };
    await assert.rejects(inspectPhase(bug), /not written/);
    json("bugs-index.json", { B1: { status: "open" } });
    fs.writeFileSync(path.join(ctx, "bugs/B1.md"), "blank page unique-marker");
    await assert.rejects(inspectPhase(bug), /not linked to the map/);
    json("map.json", { root: null, unassigned_bugs: [{ id: "B1" }] });
    assert.deepEqual(await inspectPhase(bug), state);
    passed = true;
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    assertInside(os.tmpdir(), root);
    if (passed) fs.rmSync(root, { recursive: true, force: true });
    else console.error(`Preserved failed checker evidence: ${root}`);
  }
});
