#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { npmInvocation } from "./npm-command.mjs";
import { installedFiles } from "./package-contract.mjs";
import { assertInside, clientInvocation, clients, inspectPhase, parseClientOutput, redact, runtimeEnvironment } from "./real-client-contract.mjs";

export function run(command, args, { cwd, env, timeout = 180_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    let stdout = "";
    let stderr = "";
    let failure;
    const terminate = (reason) => {
      failure ||= new Error(reason);
      try {
        if (process.platform === "win32") child.kill("SIGKILL");
        else process.kill(-child.pid, "SIGKILL");
      } catch { /* The process may already have exited. */ }
    };
    const timer = setTimeout(() => terminate(`${command} timed out after ${timeout} ms`), timeout);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length + stderr.length > 8_000_000) terminate(`${command} exceeded the output limit`);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (stdout.length + stderr.length > 8_000_000) terminate(`${command} exceeded the output limit`);
    });
    child.on("error", (error) => { failure = error; });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (failure || code !== 0) {
        const error = failure || new Error(`${command} exited with ${code}`);
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      } else resolve({ stdout, stderr });
    });
  });
}

export function requireLiveRunner(env, platform) {
  assert.equal(platform, "linux", "Live client acceptance currently runs on GitHub-hosted Ubuntu only");
  assert.equal(env.GITHUB_ACTIONS, "true", "Refusing to use personal client homes; run the live workflow on GitHub");
  assert.equal(env.RUNNER_ENVIRONMENT, "github-hosted", "Live tests must not run on a reused self-hosted runner");
  assert.ok(env.RUNNER_TEMP && path.isAbsolute(env.RUNNER_TEMP), "RUNNER_TEMP must be an absolute path");
  assert.ok(clients.includes(env.TEST_CLIENT), "TEST_CLIENT must be codex, cursor, or claude");
  assert.ok(env.PACKAGE_TARBALL && fs.existsSync(env.PACKAGE_TARBALL), "A verified package artifact is required");
}

async function main() {
  requireLiveRunner(process.env, process.platform);
  const client = process.env.TEST_CLIENT;
  const secret = process.env.CLIENT_API_KEY || "";
  // Codex uses the official Action's local proxy, not an inherited API key.
  if (client !== "codex") assert.ok(secret, `Missing ${client} API credential; live acceptance did not run`);
  const runtimeEnv = runtimeEnvironment(process.env);
  const root = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP, `context-guard-live-${client}-`));
  assertInside(process.env.RUNNER_TEMP, root);
  const project = path.join(root, "project");
  const evidence = path.join(root, "evidence");
  const prefix = path.join(root, "tools");
  const cli = path.join(prefix, "bin", "context-guard");
  const skillTarget = path.join(os.homedir(), `.${client}`, "skills", "context-guard");
  const env = { ...runtimeEnv, PATH: `${path.join(prefix, "bin")}${path.delimiter}${runtimeEnv.PATH || runtimeEnv.Path || ""}`,
    npm_config_cache: path.join(root, "npm-cache") };
  let clientCommand;
  if (client !== "codex") {
    const commandFile = process.env.CLIENT_COMMAND_FILE;
    assert.ok(commandFile && fs.existsSync(commandFile), `Missing pinned ${client} command metadata`);
    clientCommand = JSON.parse(fs.readFileSync(commandFile, "utf8"));
    assert.equal(clientCommand.client, client, "Pinned client command belongs to another client");
    assert.ok(fs.existsSync(clientCommand.command), `Pinned ${client} executable is missing`);
  }
  fs.mkdirSync(project);
  fs.mkdirSync(evidence);
  fs.writeFileSync(path.join(project, "README.md"), "# Empty acceptance project\n\nA disposable project for checking an installed client integration.\n");
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `evidence=${evidence}\n`);
  const report = { client, status: "running", sourceCommit: process.env.GITHUB_SHA, activePhase: "installation", phases: [] };
  const save = () => fs.writeFileSync(path.join(evidence, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  const capture = (phase, result) => {
    fs.writeFileSync(path.join(evidence, `${phase}.jsonl`), redact(result.stdout || "", [secret]));
    fs.writeFileSync(path.join(evidence, `${phase}.stderr.log`), redact(result.stderr || "", [secret]));
  };
  save();
  let failed;
  try {
    assert.ok(!fs.existsSync(skillTarget), "Client skill target was already populated; this is not a fresh install");
    const npm = npmInvocation();
    const installation = await run(npm.command, [...npm.args, "install", "--global", "--prefix", prefix,
      "--no-audit", "--no-fund", process.env.PACKAGE_TARBALL], { cwd: project, env });
    capture("install", installation);
    // --platform is public CLI syntax. No hook files, skill paths, language or
    // session records are manually supplied by the test harness.
    await run(cli, ["install", "--platform", client], { cwd: project, env });
    for (const file of installedFiles) assert.ok(fs.existsSync(path.join(skillTarget, file)), `Missing installed file: ${file}`);
    assert.ok(!fs.existsSync(path.join(project, ".codex", "context")), "Context must be created by the real client's hook");

    if (client === "cursor") {
      // Test permissions only; do not modify the installed skill or hooks.
      const config = path.join(project, ".cursor");
      fs.mkdirSync(config);
      fs.writeFileSync(path.join(config, "cli.json"), JSON.stringify({ permissions: {
        allow: ["Read(**)", `Read(${skillTarget}/**)`, "Shell(context-guard:*)"],
        deny: ["Shell(git)", "Shell(gh)", "Shell(sudo)", "Shell(curl)", "Shell(wget)", "Shell(env)", "Shell(printenv)", "WebFetch(*)"]
      } }, null, 2));
    }
    const command = clientCommand?.command || clientInvocation(client, "unused").command;
    const commandPrefix = clientCommand?.args || [];
    report.clientVersion = (await run(command, [...commandPrefix, "--version"], { cwd: project, env, timeout: 30_000 })).stdout.trim();
    report.phases.push({ name: "installation", status: "passed" });
    save();
    const clientEnv = { ...env };
    if (client === "cursor") clientEnv.CURSOR_API_KEY = secret;
    if (client === "claude") clientEnv.ANTHROPIC_API_KEY = secret;
    const unique = randomUUID();
    const marker = (phase) => `CGCI_${phase}_${unique}`;
    const safety = "Do not use subagents, commit, push, install software, make external network requests, or modify product code.";
    let workbench;
    const turn = async (phase, prompt, sessionId = "", firstSessionId = "") => {
      const invocation = clientInvocation(client, `${prompt}\n${safety}`, sessionId, process.env.CLIENT_MODEL || "");
      report.activePhase = phase;
      save();
      let result;
      try {
        result = await run(clientCommand?.command || invocation.command, [...(clientCommand?.args || []), ...invocation.args], { cwd: project, env: clientEnv });
      } catch (error) {
        capture(phase, error);
        throw error;
      }
      capture(phase, result);
      const reply = parseClientOutput(client, result.stdout);
      if (sessionId) assert.equal(reply.sessionId, sessionId, "Follow-up did not resume the requested session");
      workbench = await inspectPhase({ project, client, reply, phase, marker: marker(phase), firstSessionId, previousWorkbench: workbench });
      report.phases.push({ name: phase, status: "passed", sessionId: reply.sessionId });
      save();
      return reply.sessionId;
    };
    const first = await turn("first", `Hello, please help me get started with this project. Request marker: ${marker("first")}.`);
    await turn("language", `中文，请保存这个选择。暂时不要设计地图或修改其他项目内容。标记：${marker("language")}`, first);
    const second = await turn("new-session", `请告诉我当前项目的目录，不要修改项目内容。标记：${marker("new-session")}`, "", first);
    await turn("bad-case", `我发现一个明确的问题：点击工作台的刷新按钮后显示空白页，已复现两次。请记录这个问题并保留复现标记 ${marker("bad-case")}，先不要修复。`, second);
    report.status = "passed";
  } catch (error) {
    failed = error;
    report.status = "failed";
    report.error = redact(error.message, [secret]);
    report.phases.push({ name: report.activePhase, status: "failed" });
  } finally {
    // Only collect an explicit allowlist; NEVER upload client homes/auth files,
    // the npm cache, environment dumps, or .codex/context/private.
    const ctx = path.join(project, ".codex", "context");
    for (const file of ["preferences.json", "sessions.jsonl", "user-messages.md", "bugs-index.json"]) {
      if (fs.existsSync(path.join(ctx, file))) {
        fs.writeFileSync(path.join(evidence, file), redact(fs.readFileSync(path.join(ctx, file), "utf8"), [secret]));
      }
    }
    for (const directory of ["bugs", "sessions"]) {
      const source = path.join(ctx, directory);
      if (!fs.existsSync(source)) continue;
      for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
        if (!entry.isFile() || !/^[A-Za-z0-9._-]+\.md$/.test(entry.name)) continue;
        const target = path.join(evidence, directory);
        fs.mkdirSync(target, { recursive: true });
        fs.writeFileSync(path.join(target, entry.name), redact(fs.readFileSync(path.join(source, entry.name), "utf8"), [secret]));
      }
    }
    if (fs.existsSync(cli)) {
      try { await run(cli, ["workbench", "--root", project, "--stop"], { cwd: project, env, timeout: 15_000 }); }
      catch (error) {
        failed ||= error;
        report.status = "failed";
        report.cleanupError = redact(error.message, [secret]);
      }
    }
    delete report.activePhase;
    save();
    if (process.env.GITHUB_STEP_SUMMARY) {
      const rows = report.phases.map((phase) => `- ${phase.name}: ${phase.status}`).join("\n");
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
        `## ${client}: ${report.status}\n\nCLI: ${report.clientVersion || "not started"}\n\n${rows}\n\n${report.error || ""}\n\nThis checks the real CLI, not the desktop UI.\n`);
    }
    // These targets were created by this invocation and are never client homes.
    // Failure evidence remains available; successful scratch projects are removed.
    if (!failed) {
      for (const target of [project, prefix, path.join(root, "npm-cache")]) {
        assertInside(root, target);
        fs.rmSync(target, { recursive: true, force: true });
      }
    }
  }
  if (failed) throw new Error(`${client} live acceptance failed: ${redact(failed.message, [secret])}. Evidence: ${evidence}`);
  console.log(`${client} real-client acceptance passed. Evidence: ${evidence}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(redact(error.message, [process.env.CLIENT_API_KEY])); process.exitCode = 1; });
}
