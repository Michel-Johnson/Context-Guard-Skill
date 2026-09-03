#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { npmInvocation } from "./npm-command.mjs";
import { installedFiles, forbiddenInstalledPaths } from "./package-contract.mjs";
import { isolatedEnvironment, run, rpcClient } from "./client-protocol.mjs";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const versions = JSON.parse(fs.readFileSync(new URL("../client-versions.json", import.meta.url), "utf8"));
export const codexEvents = {
  SessionStart: "sessionStart", SubagentStart: "subagentStart", UserPromptSubmit: "userPromptSubmit",
  PreToolUse: "preToolUse", PermissionRequest: "permissionRequest", PostToolUse: "postToolUse",
  PreCompact: "preCompact", PostCompact: "postCompact", SubagentStop: "subagentStop",
  Stop: "stop", Interrupt: "interrupt",
};
const claudeEvents = ["SessionStart", "SubagentStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "SubagentStop", "Stop"];
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const contextPath = (project) => path.join(project, ".codex", "context");

function canonicalPath(target) {
  try { return fs.realpathSync(target); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    assert.ok(!fs.lstatSync(target, { throwIfNoEntry: false })?.isSymbolicLink(), "Refusing a dangling linked target");
    const parent = path.dirname(target);
    assert.notEqual(parent, target, "Cannot resolve the target directory");
    return path.join(canonicalPath(parent), path.basename(target));
  }
}

export function assertInside(root, target) {
  const absolute = path.resolve(target);
  assert.ok(!fs.lstatSync(absolute, { throwIfNoEntry: false })?.isSymbolicLink(), "Refusing a linked target");
  // macOS /var and /private/var can name the same temporary directory. Resolve
  // both sides, including the nearest existing ancestor of a not-yet-made path.
  const relative = path.relative(fs.realpathSync(root), canonicalPath(absolute));
  assert.ok(relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), "Target must be inside the disposable directory");
}

export function verifyInstalled(skill, config, client) {
  for (const file of installedFiles) assert.ok(fs.statSync(path.join(skill, file)).isFile(), `Missing installed file: ${file}`);
  for (const file of forbiddenInstalledPaths) assert.ok(!fs.existsSync(path.join(skill, file)), `Development file leaked: ${file}`);
  const names = client === "cursor" ? ["sessionStart", "beforeSubmitPrompt", "stop", "subagentStart", "subagentStop"]
    : client === "codex" ? Object.keys(codexEvents) : claudeEvents;
  for (const name of names) {
    const groups = config.hooks?.[name] || [];
    const handlers = client === "cursor" ? groups : groups.flatMap((group) => group.hooks || []);
    assert.ok(handlers.some((hook) => hook.type === "command" && hook.command?.includes("context_guard_hook.py") && hook.command.includes(`--platform ${client}`)), `Missing installed ${client} hook: ${name}`);
  }
}

export function verifyCodexDiscovery(result, project, skill, hooksPath) {
  const skills = result.skills.data.find((item) => path.resolve(item.cwd) === path.resolve(project));
  assert.ok(skills && skills.errors.length === 0, "Codex skill discovery returned errors");
  assert.ok(skills.skills.some((item) => item.name === "context-guard" && item.enabled === true && path.resolve(item.path) === path.join(skill, "SKILL.md")), "Codex did not discover the installed Skill");
  const hooks = result.hooks.data.find((item) => path.resolve(item.cwd) === path.resolve(project));
  assert.ok(hooks && hooks.errors.length === 0, "Codex hook discovery returned errors");
  for (const event of Object.values(codexEvents)) {
    assert.ok(hooks.hooks.some((item) => item.eventName === event && item.enabled && item.handlerType === "command" && item.command.includes("context_guard_hook.py") && item.command.includes("--platform codex") && path.resolve(item.sourcePath) === hooksPath), `Codex did not discover hook: ${event}`);
  }
  return hooks.hooks.filter((item) => item.command.includes("context_guard_hook.py")).map(({ eventName, trustStatus }) => ({ eventName, trustStatus }));
}

export function verifyNativeSession(project, client) {
  const ctx = contextPath(project);
  assert.ok(fs.existsSync(path.join(ctx, "sessions.jsonl")), "No native SessionStart evidence");
  for (const file of ["index.md", "FIND.md", "architecture.md", "preferences.json", "user-messages.md", "bugs-index.json", "map.json"]) {
    assert.ok(fs.existsSync(path.join(ctx, file)), `Missing initialized file: ${file}`);
  }
  for (const folder of ["tasks", "bugs", "fixes", "cards", "sessions", "private"]) assert.ok(fs.statSync(path.join(ctx, folder)).isDirectory());
  const entries = fs.readFileSync(path.join(ctx, "sessions.jsonl"), "utf8").trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
  const native = entries.filter((item) => item.platform === client && item.event === "session-start" && item.root_source === "hook payload");
  assert.ok(native.length && native.every((item) => item.session_id), "No native SessionStart evidence");
  for (const event of native) {
    assert.match(event.session_id, /^[A-Za-z0-9._-]+$/);
    assert.ok(fs.existsSync(path.join(ctx, "sessions", `${event.session_id}.md`)), "Missing native session record");
  }
  return native;
}

export async function verifyWorkbench(project, previous) {
  const state = readJson(path.join(contextPath(project), "private", "workbench.json"));
  const url = new URL(state.url);
  assert.equal(url.protocol, "http:");
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "Workbench must be loopback");
  const health = await fetch(new URL("/__context_guard/health", url), { signal: AbortSignal.timeout(5000) });
  assert.equal(health.status, 200);
  const info = await health.json();
  assert.equal(path.resolve(info.root), path.resolve(project), "Workbench serves the wrong project");
  assert.equal(info.pid, state.pid, "Workbench PID mismatch");
  const page = await fetch(url, { signal: AbortSignal.timeout(5000) });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Context Guard/);
  if (previous) { assert.equal(state.pid, previous.pid, "Duplicate workbench process"); assert.equal(state.url, previous.url); }
  return { pid: state.pid, url: state.url };
}

export function isCursorAuthBoundary(error) {
  return error?.rpcError?.code === -32000 && error.rpcError.message === "Authentication required";
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    assert.ok(["--client", "--tools", "--tarball", "--evidence"].includes(argv[i]) && argv[i + 1], `Invalid option: ${argv[i]}`);
    options[argv[i].slice(2)] = argv[i + 1];
  }
  assert.ok(Object.hasOwn(versions, options.client) && options.tools, "Usage: smoke-clients.mjs --client <codex|cursor|claude> --tools <installed-client-dir> [--tarball <tgz>] [--evidence <dir>]");
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { client } = options;
  const tools = readJson(path.resolve(options.tools, "command.json"));
  assert.equal(tools.client, client);
  assert.equal(tools.version, versions[client], "Install the pinned client version first");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `context-guard-client-${client}-`));
  const project = path.join(root, "project");
  const negativeProject = path.join(root, "negative-project");
  const evidence = path.resolve(options.evidence || path.join(repository, "output", `client-${client}-${randomUUID()}`));
  for (const dir of [project, negativeProject, evidence]) fs.mkdirSync(dir, { recursive: true });
  const env = isolatedEnvironment(root);
  const home = env[`${client.toUpperCase()}_HOME`];
  const skill = path.join(home, "skills", "context-guard");
  const hooksPath = path.join(home, client === "claude" ? "settings.json" : "hooks.json");
  const report = { client, version: tools.actual, os: process.platform, sourceCommit: process.env.GITHUB_SHA || null,
    status: "running", scope: "No-dialogue checks only", aiConversation: "not invoked", credentials: "not inherited",
    checks: [], boundaries: ["AI actually asking for language, semantic bad-case judgment, and desktop UI are not covered."] };
  let cli, failed;
  const save = () => fs.writeFileSync(path.join(evidence, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  const check = async (name, action) => {
    report.activeCheck = name; save();
    const detail = await action();
    report.checks.push({ name, status: "passed", ...(detail === undefined ? {} : { detail }) }); save();
  };
  const executeClient = (args, cwd = project) => run(tools.command, [...tools.args, ...args], { cwd, env });
  try {
    await check("Install the actual npm package into empty client directories", async () => {
      const npm = npmInvocation();
      let tarball = options.tarball && path.resolve(options.tarball);
      if (!tarball) {
        const result = await run(npm.command, [...npm.args, "pack", "--json", "--pack-destination", root], { cwd: repository, env });
        tarball = path.join(root, JSON.parse(result.stdout)[0].filename);
      }
      report.packageSha256 = createHash("sha256").update(fs.readFileSync(tarball)).digest("hex");
      assert.ok(!fs.existsSync(skill), "Skill directory was not empty before installation");
      const consumer = path.join(root, "consumer");
      await run(npm.command, [...npm.args, "install", "--prefix", consumer, "--no-audit", "--no-fund", tarball], { cwd: project, env, timeout: 120_000 });
      cli = path.join(consumer, "node_modules", "@michelj", "context-guard", "bin", "context-guard-skill.js");
      await run(process.execPath, [cli, "install", "--platform", client], { cwd: project, env });
      verifyInstalled(skill, readJson(hooksPath), client);
      assert.ok(!fs.existsSync(contextPath(project)), "Installer must not fabricate native session evidence");
    });
    await check("Pinned real client starts without inherited credentials", async () => {
      const actual = (await executeClient(["--version"])).stdout.trim();
      assert.equal(actual, tools.actual);
      return actual;
    });
    const originalConfig = fs.readFileSync(hooksPath, "utf8");
    await check("Negative: the installation checker rejects missing hooks", async () => {
      const broken = readJson(hooksPath);
      delete broken.hooks[client === "cursor" ? "sessionStart" : "SessionStart"];
      assert.throws(() => verifyInstalled(skill, broken, client), /Missing installed .* hook/);
    });

    if (client === "codex") {
      const query = async () => {
        const rpc = rpcClient(tools.command, [...tools.args, "app-server"], { cwd: project, env });
        try {
          const init = await rpc.request("initialize", { clientInfo: { name: "context_guard_ci", version: "1.0.0" }, capabilities: { experimentalApi: true } });
          assert.equal(path.resolve(init.codexHome), path.resolve(home), "Codex used the personal home");
          rpc.notify("initialized");
          return { skills: await rpc.request("skills/list", { cwds: [project], forceReload: true }), hooks: await rpc.request("hooks/list", { cwds: [project] }) };
        } finally { await rpc.close(); }
      };
      await check("Native discovery: installed Skill and all five hooks", async () => {
        const trust = verifyCodexDiscovery(await query(), project, skill, hooksPath);
        report.boundaries.push("Discovery does not execute hooks. Non-managed hooks require user trust; this test does not bypass it.");
        return trust;
      });
      await check("Negative: real Codex detects an absent Skill", async () => {
        const file = path.join(skill, "SKILL.md"), parked = path.join(skill, "SKILL.md.disabled");
        fs.renameSync(file, parked);
        try {
          const result = await query();
          assert.throws(() => verifyCodexDiscovery(result, project, skill, hooksPath), /did not discover the installed Skill/);
        } finally { fs.renameSync(parked, file); }
      });
      await check("Negative: real Codex detects an absent SessionStart hook", async () => {
        const config = readJson(hooksPath); delete config.hooks.SessionStart;
        fs.writeFileSync(hooksPath, JSON.stringify(config));
        try {
          const result = await query();
          assert.throws(() => verifyCodexDiscovery(result, project, skill, hooksPath), /did not discover hook: sessionStart/);
        } finally { fs.writeFileSync(hooksPath, originalConfig); }
      });
      await check("Restored Codex installation is discoverable", async () => { verifyCodexDiscovery(await query(), project, skill, hooksPath); });
    } else if (client === "claude") {
      let firstSessions, workbench;
      await check("Native --init-only: SessionStart creates files and workbench", async () => {
        await executeClient(["--init-only"]);
        firstSessions = verifyNativeSession(project, client);
        assert.equal(readJson(path.join(contextPath(project), "preferences.json")).record_language, "unset");
        workbench = await verifyWorkbench(project);
        return { sessionId: firstSessions.at(-1).session_id, workbench };
      });
      await check("Second native startup preserves language, sessions and workbench", async () => {
        await run(process.execPath, [cli, "set-language", "--root", project, "--language", "zh"], { cwd: project, env });
        await executeClient(["--init-only"]);
        const sessions = verifyNativeSession(project, client);
        assert.ok(new Set(sessions.map((item) => item.session_id)).size > new Set(firstSessions.map((item) => item.session_id)).size, "No new native session was created");
        assert.equal(readJson(path.join(contextPath(project), "preferences.json")).record_language, "zh");
        await verifyWorkbench(project, workbench);
      });
      await check("Negative: removing the real hook prevents native initialization", async () => {
        const config = readJson(hooksPath); delete config.hooks.SessionStart;
        fs.writeFileSync(hooksPath, JSON.stringify(config));
        try {
          await executeClient(["--init-only"], negativeProject);
          assert.throws(() => verifyNativeSession(negativeProject, client), /No native SessionStart evidence/);
        } finally { fs.writeFileSync(hooksPath, originalConfig); }
      });
      report.boundaries.push("--init-only does not submit user messages or trigger a conversation Stop; those script behaviors remain covered by the base fixture tests.");
    } else {
      const rpc = rpcClient(tools.command, [...tools.args, "acp"], { cwd: project, env });
      try {
        await check("Native ACP initialization (not session lifecycle)", async () => {
          const result = await rpc.request("initialize", { protocolVersion: 1, clientInfo: { name: "context_guard_ci", version: "1.0.0" }, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } });
          assert.equal(result.protocolVersion, 1);
          assert.ok(result.agentCapabilities && result.authMethods.some((item) => item.id === "cursor_login"));
          return { protocolVersion: result.protocolVersion, authentication: "cursor_login" };
        });
        await check("Authentication boundary is reported, never bypassed", async () => {
          let error;
          try { await rpc.request("session/new", { cwd: project, mcpServers: [] }); } catch (failure) { error = failure; }
          assert.ok(isCursorAuthBoundary(error), "Cursor authentication behavior changed; review the pinned client and coverage before accepting it");
          report.boundaries.push("NOT COVERED: Cursor skill discovery and native session hooks require authentication. ACP handshake success is not lifecycle acceptance.");
          return { nativeSessionLifecycle: "not covered", reason: error.rpcError.message };
        });
      } finally { await rpc.close(); }
    }
    report.status = "passed";
  } catch (error) {
    failed = error;
    report.status = "failed";
    report.error = error.message;
    report.checks.push({ name: report.activeCheck, status: "failed" });
    fs.writeFileSync(path.join(evidence, "failure.log"), `${error.stack}\n${error.stdout || ""}\n${error.stderr || ""}`);
  } finally {
    if (cli) for (const target of [project, negativeProject]) {
      if (fs.existsSync(path.join(contextPath(target), "private", "workbench.json"))) {
        try { await run(process.execPath, [cli, "workbench", "--root", target, "--stop"], { cwd: target, env, timeout: 15_000 }); }
        catch (error) { failed ||= error; report.status = "failed"; report.cleanupError = error.message; }
      }
    }
    if (!failed) {
      try {
        assertInside(os.tmpdir(), root);
        fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch (error) { failed = error; report.status = "failed"; report.cleanupError = error.message; }
    }
    delete report.activeCheck;
    if (failed) report.retainedScratch = root;
    save();
    const summary = `## ${client}: ${report.status} (no-dialogue scope only)\n\nVersion: ${tools.actual}\n\n${report.checks.map((item) => `- ${item.status}: ${item.name}`).join("\n")}\n\n### Coverage boundaries\n\n${report.boundaries.map((item) => `- ${item}`).join("\n")}\n`;
    fs.writeFileSync(path.join(evidence, "summary.md"), summary);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  }
  console.log(`${client}: ${report.status}. Report: ${path.join(evidence, "report.json")}`);
  for (const boundary of report.boundaries) console.log(`Coverage boundary: ${boundary}`);
  if (failed) throw new Error(`${client} check failed: ${failed.message}. Evidence: ${evidence}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
