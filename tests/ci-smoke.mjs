#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "context-guard-ci-"));
const npmCommand = process.env.npm_execpath ? process.execPath : "npm";
const npmPrefix = process.env.npm_execpath ? [process.env.npm_execpath] : [];
let workbenchProject = null;
let passed = false;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repositoryRoot,
    env: { ...process.env, ...options.env },
    input: options.input,
    encoding: "utf8",
    windowsHide: true
  });
  if (result.error || result.status !== 0) {
    throw new Error([
      `Command failed: ${command} ${args.join(" ")}`,
      result.error?.stack || "",
      result.stdout || "",
      result.stderr || ""
    ].filter(Boolean).join("\n"));
  }
  return result;
}

function findPython() {
  for (const candidate of process.platform === "win32" ? ["python", "python3"] : ["python3", "python"]) {
    const result = spawnSync(candidate, ["--version"], { encoding: "utf8", windowsHide: true });
    if (!result.error && result.status === 0) return candidate;
  }
  throw new Error("Python 3 is required for Context Guard CI.");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function countSkillFiles(root) {
  let count = 0;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) count += countSkillFiles(full);
    if (entry.isFile() && entry.name === "SKILL.md") count += 1;
  }
  return count;
}

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

function installedPath(home) {
  return path.join(home, "skills", "context-guard");
}

async function main() {
  const python = findPython();
  const packedDirectory = path.join(temporaryRoot, "packed");
  const consumerDirectory = path.join(temporaryRoot, "consumer");
  const npmCache = path.join(temporaryRoot, "npm-cache");
  fs.mkdirSync(packedDirectory, { recursive: true });

  const packResult = run(
    npmCommand,
    [...npmPrefix, "pack", "--json", "--pack-destination", packedDirectory],
    { env: { CONTEXT_GUARD_SKIP_AUTO_INSTALL: "1", npm_config_cache: npmCache } }
  );
  const packed = JSON.parse(packResult.stdout);
  assert.equal(packed.length, 1, "npm pack should create exactly one package");
  const tarball = path.join(packedDirectory, packed[0].filename);
  run(
    npmCommand,
    [...npmPrefix, "install", "--prefix", consumerDirectory, "--ignore-scripts", "--no-audit", "--no-fund", tarball],
    { env: { CONTEXT_GUARD_SKIP_AUTO_INSTALL: "1", npm_config_cache: npmCache } }
  );

  const packageDirectory = path.join(consumerDirectory, "node_modules", "@michelj", "context-guard");
  const cli = path.join(packageDirectory, "bin", "context-guard-skill.js");
  const postinstall = path.join(packageDirectory, "bin", "postinstall.js");
  const contextScript = path.join(packageDirectory, "scripts", "context_guard.py");
  const hookScript = path.join(packageDirectory, "scripts", "context_guard_hook.py");
  assert.equal(countSkillFiles(packageDirectory), 1, "published package must contain one skill");
  run(process.execPath, [cli, "--help"]);
  run(python, ["-c", [
    "from pathlib import Path",
    `files=${JSON.stringify([contextScript, hookScript])}`,
    "[compile(Path(p).read_text(encoding='utf-8'), p, 'exec') for p in files]"
  ].join(";")]);

  const homes = {
    codex: path.join(temporaryRoot, "codex-home"),
    cursor: path.join(temporaryRoot, "cursor-home"),
    claude: path.join(temporaryRoot, "claude-home")
  };
  fs.mkdirSync(homes.codex, { recursive: true });
  fs.mkdirSync(homes.cursor, { recursive: true });
  fs.mkdirSync(homes.claude, { recursive: true });
  fs.writeFileSync(
    path.join(homes.codex, "config.toml"),
    "[features]\ncodex_hooks = false\nmulti_agent = true\n\n[model]\nname = \"test\"\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(homes.cursor, "hooks.json"),
    JSON.stringify({ version: 1, hooks: { stop: [{ type: "command", command: "echo keep-me" }] } }, null, 2),
    "utf8"
  );
  fs.writeFileSync(
    path.join(homes.claude, "settings.json"),
    JSON.stringify({ permissions: { allow: ["Read"] } }, null, 2),
    "utf8"
  );
  const clientEnvironment = {
    CODEX_HOME: homes.codex,
    CURSOR_HOME: homes.cursor,
    CLAUDE_HOME: homes.claude,
    CONTEXT_GUARD_SKIP_AUTO_INSTALL: "0",
    CONTEXT_GUARD_HEADLESS: "1"
  };
  run(process.execPath, [cli, "install", "--platform", "all"], { env: clientEnvironment });

  for (const home of Object.values(homes)) {
    assert.ok(fs.existsSync(path.join(installedPath(home), "SKILL.md")));
    assert.ok(fs.existsSync(path.join(installedPath(home), "scripts", "context_guard_hook.py")));
    assert.equal(countSkillFiles(installedPath(home)), 1);
  }
  const codexConfig = fs.readFileSync(path.join(homes.codex, "config.toml"), "utf8");
  assert.match(codexConfig, /hooks = true/);
  assert.match(codexConfig, /multi_agent = true/);
  assert.doesNotMatch(codexConfig, /codex_hooks/);
  const codexHooks = readJson(path.join(homes.codex, "hooks.json"));
  assert.match(codexHooks.hooks.SessionStart[0].hooks[0].command, /--platform codex/);
  const cursorHooks = readJson(path.join(homes.cursor, "hooks.json"));
  assert.equal(cursorHooks.version, 1);
  assert.match(cursorHooks.hooks.sessionStart[0].command, /--platform cursor/);
  assert.ok(cursorHooks.hooks.stop.some((hook) => hook.command === "echo keep-me"));
  const claudeSettings = readJson(path.join(homes.claude, "settings.json"));
  assert.deepEqual(claudeSettings.permissions, { allow: ["Read"] });
  assert.match(claudeSettings.hooks.SessionStart[0].hooks[0].command, /--platform claude/);

  const globalHomes = {
    CODEX_HOME: path.join(temporaryRoot, "global-codex"),
    CURSOR_HOME: path.join(temporaryRoot, "global-cursor"),
    CLAUDE_HOME: path.join(temporaryRoot, "global-claude")
  };
  run(process.execPath, [postinstall], {
    env: {
      ...globalHomes,
      npm_config_global: "true",
      CONTEXT_GUARD_SKIP_AUTO_INSTALL: "0",
      CONTEXT_GUARD_HEADLESS: "1"
    }
  });
  for (const home of Object.values(globalHomes)) {
    assert.ok(fs.existsSync(path.join(installedPath(home), "SKILL.md")));
  }

  const project = path.join(temporaryRoot, "project");
  const unrelatedCwd = path.join(temporaryRoot, "hook-cwd");
  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(unrelatedCwd, { recursive: true });
  const hookEnvironment = {
    CONTEXT_GUARD_DISABLE_WORKBENCH: "1",
    CONTEXT_GUARD_HEADLESS: "1"
  };
  const firstStart = run(
    python,
    [hookScript, "session-start", "--platform", "cursor"],
    {
      cwd: unrelatedCwd,
      env: hookEnvironment,
      input: JSON.stringify({ cwd: project, session_id: "session-one" })
    }
  );
  const firstResponse = JSON.parse(firstStart.stdout);
  assert.match(firstResponse.additional_context, /ask the user whether project context should be recorded/);
  assert.ok(fs.existsSync(path.join(project, ".codex", "context", "index.md")));
  assert.ok(!fs.existsSync(path.join(unrelatedCwd, ".codex", "context")), "payload root must beat process cwd");
  assert.ok(fs.existsSync(path.join(project, ".codex", "context", "sessions", "session-one.md")));

  run(python, [contextScript, "set-language", "--root", project, "--language", "zh"]);
  const secondStart = run(
    python,
    [hookScript, "session-start", "--platform", "codex"],
    {
      cwd: unrelatedCwd,
      env: hookEnvironment,
      input: JSON.stringify({ project_root: project, session_id: "session-two" })
    }
  );
  const secondResponse = JSON.parse(secondStart.stdout);
  assert.doesNotMatch(JSON.stringify(secondResponse), /ask the user whether/);
  assert.equal(readJson(path.join(project, ".codex", "context", "preferences.json")).record_language, "zh");

  const userMessage = "请记住：CI 第一版只保护已经实现的安装流程。";
  run(
    python,
    [hookScript, "user-prompt-submit", "--platform", "claude"],
    {
      cwd: unrelatedCwd,
      env: hookEnvironment,
      input: JSON.stringify({ workspace_root: project, session_id: "session-two", prompt: userMessage })
    }
  );
  run(
    python,
    [hookScript, "stop", "--platform", "claude"],
    {
      cwd: unrelatedCwd,
      env: hookEnvironment,
      input: JSON.stringify({ workspace_root: project, session_id: "session-two" })
    }
  );
  assert.match(fs.readFileSync(path.join(project, ".codex", "context", "user-messages.md"), "utf8"), /CI 第一版/);
  const sessionEvents = fs.readFileSync(path.join(project, ".codex", "context", "sessions.jsonl"), "utf8")
    .trim().split(/\r?\n/).map(JSON.parse);
  assert.ok(sessionEvents.some((event) => event.event === "session-start" && event.session_id === "session-one"));
  assert.ok(sessionEvents.some((event) => event.event === "user-prompt-submit"));
  assert.ok(sessionEvents.some((event) => event.event === "stop"));

  workbenchProject = project;
  const automaticWorkbenchStart = run(
    python,
    [hookScript, "session-start", "--platform", "codex"],
    {
      cwd: unrelatedCwd,
      env: { CONTEXT_GUARD_DISABLE_WORKBENCH: "0", CONTEXT_GUARD_HEADLESS: "1" },
      input: JSON.stringify({ project_root: project, session_id: "session-three" })
    }
  );
  const automaticContext = JSON.parse(automaticWorkbenchStart.stdout).hookSpecificOutput.additionalContext;
  const automaticUrl = automaticContext.match(/http:\/\/[^\s]+\/prototype\/workbench\.html/)?.[0];
  assert.ok(automaticUrl, `SessionStart should inject the automatically started workbench URL\n${automaticWorkbenchStart.stderr}`);
  assert.equal((await fetch(automaticUrl)).status, 200);
  run(python, [contextScript, "workbench", "--root", project, "--stop"]);

  const mapPath = path.join(project, ".codex", "context", "map.json");
  const map = readJson(mapPath);
  map.root = { id: "N1", title: "CI", children: [], bugs: [] };
  fs.writeFileSync(mapPath, `${JSON.stringify(map, null, 2)}\n`, "utf8");
  run(python, [
    contextScript,
    "record-bad-case",
    "--root", project,
    "--title", "安装失败",
    "--phenomenon", "新用户安装后 Hook 未触发",
    "--trigger", "干净环境首次安装",
    "--cause", "待确认",
    "--guard", "跨平台安装冒烟",
    "--node", "N1",
    "--keys", "install,hook"
  ]);
  assert.ok(fs.existsSync(path.join(project, ".codex", "context", "bugs", "B1.md")));
  assert.equal(readJson(path.join(project, ".codex", "context", "bugs-index.json")).B1.status, "open");
  assert.equal(readJson(mapPath).root.bugs[0].id, "B1");

  workbenchProject = project;
  const port = await freePort();
  const workbench = run(
    python,
    [contextScript, "workbench", "--root", project, "--port", String(port), "--no-open"],
    { env: { CONTEXT_GUARD_HEADLESS: "1" } }
  );
  const urlMatch = workbench.stdout.match(/http:\/\/[^\s]+\/prototype\/workbench\.html/);
  assert.ok(urlMatch, "workbench command should return its browser URL");
  const url = urlMatch[0];
  const pageResponse = await fetch(url);
  assert.equal(pageResponse.status, 200);
  assert.match(await pageResponse.text(), /Context Guard/);
  const mapResponse = await fetch(new URL("/.codex/context/map.json", url));
  assert.equal(mapResponse.status, 200);
  assert.equal((await mapResponse.json()).root.id, "N1");
  assert.equal((await fetch(new URL("/package.json", url))).status, 404, "workbench must not expose repository files");
  const firstState = readJson(path.join(project, ".codex", "context", "private", "workbench.json"));
  run(
    python,
    [contextScript, "workbench", "--root", project, "--port", String(port), "--no-open"],
    { env: { CONTEXT_GUARD_HEADLESS: "1" } }
  );
  const secondState = readJson(path.join(project, ".codex", "context", "private", "workbench.json"));
  assert.equal(secondState.pid, firstState.pid, "workbench must reuse the existing project instance");
  run(python, [contextScript, "workbench", "--root", project, "--stop"]);
  workbenchProject = null;

  console.log("Context Guard CI smoke passed: package, clients, hooks, language, workbench, sessions, and bad cases.");
}

try {
  await main();
  passed = true;
} finally {
  if (workbenchProject) {
    const packageDirectory = path.join(temporaryRoot, "consumer", "node_modules", "@michelj", "context-guard");
    const contextScript = path.join(packageDirectory, "scripts", "context_guard.py");
    const python = findPython();
    spawnSync(python, [contextScript, "workbench", "--root", workbenchProject, "--stop"], {
      encoding: "utf8",
      windowsHide: true
    });
  }
  const resolvedTemporaryRoot = path.resolve(temporaryRoot);
  const resolvedSystemTemp = path.resolve(os.tmpdir());
  if (passed && resolvedTemporaryRoot.startsWith(`${resolvedSystemTemp}${path.sep}`)) {
    fs.rmSync(resolvedTemporaryRoot, { recursive: true, force: true });
  } else {
    console.error(`Preserved failed CI artifacts: ${resolvedTemporaryRoot}`);
  }
}
