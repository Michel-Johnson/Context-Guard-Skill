#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { forbiddenInstalledPaths, installedFiles } from "./package-contract.mjs";
import { npmInvocation } from "./npm-command.mjs";

function parseArgs(argv) {
  const options = { tarball: process.env.PACKAGE_TARBALL || "", workspace: "", codexHome: "", withHooks: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--tarball") options.tarball = argv[++index] || "";
    else if (arg === "--workspace") options.workspace = argv[++index] || "";
    else if (arg === "--codex-home") options.codexHome = argv[++index] || "";
    else if (arg === "--with-hooks") options.withHooks = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!options.tarball || !options.workspace) {
    throw new Error("Usage: smoke-npm-package.mjs --tarball <package.tgz> --workspace <dir> [--codex-home <dir>] [--with-hooks]");
  }
  return options;
}

function run(command, args, env) {
  const useWindowsCommandShell = process.platform === "win32" && command.toLowerCase().endsWith(".cmd");
  const result = spawnSync(command, args, {
    env,
    stdio: "inherit",
    windowsHide: true,
    shell: useWindowsCommandShell,
    timeout: 120_000
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}.`);
  }
}

function assertFile(filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`Required installed file is missing: ${filePath}`);
  }
}

function verifyInstalledSkill(skillTarget) {
  for (const relativePath of installedFiles) assertFile(path.join(skillTarget, relativePath));
  for (const relativePath of forbiddenInstalledPaths) {
    const candidate = path.join(skillTarget, relativePath);
    if (fs.existsSync(candidate)) throw new Error(`Forbidden development path leaked into the installed skill: ${candidate}`);
  }

  const pending = [skillTarget];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "__pycache__") throw new Error(`Python cache leaked into the installed skill: ${candidate}`);
        pending.push(candidate);
      } else if (
        entry.name.endsWith(".pyc") ||
        entry.name.endsWith(".log") ||
        entry.name === ".env" ||
        entry.name.startsWith(".env.")
      ) {
        throw new Error(`Forbidden development file leaked into the installed skill: ${candidate}`);
      }
    }
  }
}

function collectHookCommands(hooksConfig) {
  const commands = [];
  for (const groups of Object.values(hooksConfig.hooks || {})) {
    for (const group of groups || []) {
      for (const hook of group.hooks || []) {
        if (typeof hook.command === "string") commands.push(hook.command);
      }
    }
  }
  return commands;
}

const options = parseArgs(process.argv.slice(2));
const npm = npmInvocation();
const tarball = path.resolve(options.tarball);
const workspace = path.resolve(options.workspace);
if (!fs.existsSync(tarball)) throw new Error(`Package tarball is missing: ${tarball}`);

fs.mkdirSync(workspace, { recursive: true });
const npmCache = path.join(workspace, "npm-cache");
const npmPrefix = path.join(workspace, "npm-prefix");
const testEnv = { ...process.env, npm_config_cache: npmCache };
delete testEnv.CONTEXT_GUARD_SKILL_TARGET;
delete testEnv.CONTEXT_GUARD_SKIP_AUTO_INSTALL;
delete testEnv.CONTEXT_GUARD_AUTO_INSTALL;

let codexHome;
if (options.codexHome) {
  codexHome = path.resolve(options.codexHome);
  testEnv.CODEX_HOME = codexHome;
  const disposableUserHome = path.join(workspace, "user-home");
  testEnv.HOME = disposableUserHome;
  testEnv.USERPROFILE = disposableUserHome;
} else {
  if (process.env.GITHUB_ACTIONS !== "true") {
    throw new Error("Refusing to use the real default Codex home outside a disposable GitHub Actions runner; pass --codex-home for local validation.");
  }
  delete testEnv.CODEX_HOME;
  codexHome = path.join(os.homedir(), ".codex");
}

const skillTarget = path.join(codexHome, "skills", "context-guard");
if (fs.existsSync(skillTarget)) {
  throw new Error(`Default Skill target must start empty on the clean runner: ${skillTarget}`);
}

run(npm.command, [...npm.args, "install", "--global", "--prefix", npmPrefix, tarball], testEnv);

const cliDirectory = process.platform === "win32" ? npmPrefix : path.join(npmPrefix, "bin");
const cli = path.join(cliDirectory, process.platform === "win32" ? "context-guard.cmd" : "context-guard");
const skillCli = path.join(cliDirectory, process.platform === "win32" ? "context-guard-skill.cmd" : "context-guard-skill");
assertFile(cli);
assertFile(skillCli);
run(cli, ["--help"], testEnv);
verifyInstalledSkill(skillTarget);

run(npm.command, [
  ...npm.args,
  "exec",
  "--yes",
  "--offline",
  "--package", tarball,
  "--",
  "context-guard",
  "install"
], testEnv);
verifyInstalledSkill(skillTarget);

const projectTarget = path.join(workspace, "project");
run(cli, ["init", "--root", projectTarget], testEnv);
assertFile(path.join(projectTarget, ".codex", "context", "index.md"));

if (options.withHooks) {
  const hooksTarget = path.join(workspace, "hooks.json");
  const configTarget = path.join(workspace, "config.toml");
  const hookSkillTarget = path.join(workspace, "skill-with-hooks");
  run(cli, [
    "install",
    "--target", hookSkillTarget,
    "--with-hooks",
    "--hooks-target", hooksTarget,
    "--config-target", configTarget
  ], testEnv);
  const commands = collectHookCommands(JSON.parse(fs.readFileSync(hooksTarget, "utf8")));
  const launcher = process.platform === "win32" ? "python " : "python3 ";
  if (!commands.length || commands.some((command) => !command.startsWith(launcher))) {
    throw new Error(`Hook commands must use the ${launcher.trim()} launcher on ${process.platform}.`);
  }
}

console.log(`npm package smoke passed on ${process.platform}/${process.version}.`);
console.log(`Verified global install, npx install, default Skill contents, and init: ${skillTarget}`);
