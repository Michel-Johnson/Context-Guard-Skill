#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const packageRoot = path.resolve(__dirname, "..");
const sourceSkillDir = path.join(packageRoot, "skills", "context-guard");
const sourceHooksPath = path.join(packageRoot, "hooks.json");
const pythonScript = path.join(sourceSkillDir, "scripts", "context_guard.py");

function usage() {
  console.log(`Context Guard Skill

Usage:
  context-guard install [--target <dir>] [--with-hooks] [--hooks-target <file>]
  context-guard path
  context-guard <context_guard.py command> [args...]

Examples:
  npx @michelj/context-guard install
  npx @michelj/context-guard install --with-hooks
  npx @michelj/context-guard show-roadmap --root /path/to/project
`);
}

function fail(message) {
  console.error(`[context-guard-skill] ${message}`);
  process.exit(1);
}

function expandHome(inputPath) {
  if (!inputPath) return inputPath;
  if (inputPath === "~") return os.homedir();
  if (inputPath.startsWith("~/")) return path.join(os.homedir(), inputPath.slice(2));
  return inputPath;
}

function defaultSkillTarget() {
  if (process.env.CONTEXT_GUARD_SKILL_TARGET) {
    return path.resolve(expandHome(process.env.CONTEXT_GUARD_SKILL_TARGET));
  }
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  return path.join(codexHome, "skills", "context-guard");
}

function defaultHooksTarget() {
  if (process.env.CONTEXT_GUARD_HOOKS_TARGET) {
    return path.resolve(expandHome(process.env.CONTEXT_GUARD_HOOKS_TARGET));
  }
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  return path.join(codexHome, "hooks.json");
}

function parseInstallArgs(args) {
  const options = {
    target: defaultSkillTarget(),
    withHooks: false,
    hooksTarget: defaultHooksTarget(),
    dryRun: false
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--target") {
      const value = args[++i];
      if (!value) fail("--target requires a directory");
      options.target = path.resolve(expandHome(value));
    } else if (arg === "--with-hooks" || arg === "--hooks") {
      options.withHooks = true;
    } else if (arg === "--hooks-target") {
      const value = args[++i];
      if (!value) fail("--hooks-target requires a file path");
      options.hooksTarget = path.resolve(expandHome(value));
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "-h" || arg === "--help") {
      usage();
      process.exit(0);
    } else {
      fail(`unknown install option: ${arg}`);
    }
  }
  return options;
}

function copySkill(target, dryRun) {
  if (!fs.existsSync(path.join(sourceSkillDir, "SKILL.md"))) {
    fail(`source skill folder is missing: ${sourceSkillDir}`);
  }
  if (dryRun) {
    console.log(`[context-guard-skill] would install skill to ${target}`);
    return;
  }
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(sourceSkillDir, target, { recursive: true });
  console.log(`[context-guard-skill] installed skill: ${target}`);
}

function rewriteHookCommands(hooksConfig, skillTarget) {
  const hookScript = path.join(skillTarget, "scripts", "context_guard_hook.py");
  const encodedHookScript = JSON.stringify(hookScript);
  const next = JSON.parse(JSON.stringify(hooksConfig));
  for (const groups of Object.values(next.hooks || {})) {
    for (const group of groups || []) {
      for (const hook of group.hooks || []) {
        if (hook.type === "command" && typeof hook.command === "string" && hook.command.includes("context_guard_hook.py")) {
          hook.command = `python3 ${encodedHookScript} ${hook.command.split(" ").pop()}`;
        }
      }
    }
  }
  return next;
}

function mergeHooks(existing, incoming) {
  const merged = existing && typeof existing === "object" ? existing : {};
  merged.hooks = merged.hooks && typeof merged.hooks === "object" ? merged.hooks : {};
  for (const [event, groups] of Object.entries(incoming.hooks || {})) {
    const current = Array.isArray(merged.hooks[event]) ? merged.hooks[event] : [];
    const withoutOldContextGuard = current.filter((group) => {
      const hooks = Array.isArray(group && group.hooks) ? group.hooks : [];
      return !hooks.some((hook) => String(hook.command || "").includes("context_guard_hook.py"));
    });
    merged.hooks[event] = withoutOldContextGuard.concat(groups);
  }
  return merged;
}

function installHooks(skillTarget, hooksTarget, dryRun) {
  if (!fs.existsSync(sourceHooksPath)) {
    fail(`source hooks file is missing: ${sourceHooksPath}`);
  }
  const rawIncoming = JSON.parse(fs.readFileSync(sourceHooksPath, "utf8"));
  const incoming = rewriteHookCommands(rawIncoming, skillTarget);
  let existing = {};
  if (fs.existsSync(hooksTarget)) {
    existing = JSON.parse(fs.readFileSync(hooksTarget, "utf8"));
  }
  const merged = mergeHooks(existing, incoming);
  if (dryRun) {
    console.log(`[context-guard-skill] would install hooks to ${hooksTarget}`);
    return;
  }
  fs.mkdirSync(path.dirname(hooksTarget), { recursive: true });
  if (fs.existsSync(hooksTarget)) {
    const backupPath = `${hooksTarget}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    fs.copyFileSync(hooksTarget, backupPath);
    console.log(`[context-guard-skill] backed up hooks: ${backupPath}`);
  }
  fs.writeFileSync(hooksTarget, `${JSON.stringify(merged, null, 2)}\n`);
  console.log(`[context-guard-skill] installed hooks: ${hooksTarget}`);
}

function install(args) {
  const options = parseInstallArgs(args);
  copySkill(options.target, options.dryRun);
  if (options.withHooks) {
    installHooks(options.target, options.hooksTarget, options.dryRun);
  }
}

function runPython(args) {
  if (!fs.existsSync(pythonScript)) {
    fail(`context_guard.py is missing: ${pythonScript}`);
  }
  const result = spawnSync("python3", [pythonScript, ...args], { stdio: "inherit" });
  if (result.error) fail(result.error.message);
  process.exit(result.status === null ? 1 : result.status);
}

const [command, ...rest] = process.argv.slice(2);

if (!command || command === "-h" || command === "--help" || command === "help") {
  usage();
} else if (command === "install") {
  install(rest);
} else if (command === "path") {
  console.log(sourceSkillDir);
} else {
  runPython([command, ...rest]);
}
