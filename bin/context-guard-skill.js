#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const packageRoot = path.resolve(__dirname, "..");
const sourceSkillDir = packageRoot;
const sourceHooksPath = path.join(packageRoot, "hooks.json");
const pythonScript = path.join(sourceSkillDir, "scripts", "context_guard.py");
const skillInstallEntries = [
  "SKILL.md",
  "README.md",
  "README.zh-CN.md",
  "agents",
  "prototype",
  "references",
  "scripts"
];

function usage() {
  console.log(`Context Guard Skill

Usage:
  context-guard install [--platform auto|all|codex|cursor|claude] [--no-hooks]
                        [--target <dir>] [--hooks-target <file>] [--config-target <file>]
  context-guard path
  context-guard <context_guard.py command> [args...]

Examples:
  npx @michelj/context-guard install
  npx @michelj/context-guard install --platform all
  npx @michelj/context-guard init --root /path/to/project
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

const PLATFORM_SPECS = {
  codex: { env: "CODEX_HOME", folder: ".codex", hooksFile: "hooks.json", configFile: "config.toml" },
  cursor: { env: "CURSOR_HOME", folder: ".cursor", hooksFile: "hooks.json" },
  claude: { env: "CLAUDE_HOME", folder: ".claude", hooksFile: "settings.json" }
};

function platformHome(platform) {
  const spec = PLATFORM_SPECS[platform];
  return path.resolve(expandHome(process.env[spec.env] || path.join(os.homedir(), spec.folder)));
}

function platformTargets(platform) {
  const home = platformHome(platform);
  return {
    target: path.join(home, "skills", "context-guard"),
    hooksTarget: path.join(home, PLATFORM_SPECS[platform].hooksFile),
    configTarget: PLATFORM_SPECS[platform].configFile
      ? path.join(home, PLATFORM_SPECS[platform].configFile)
      : null
  };
}

function selectedPlatforms(requested) {
  if (requested === "all") return Object.keys(PLATFORM_SPECS);
  if (requested !== "auto") return [requested];
  const detected = Object.entries(PLATFORM_SPECS)
    .filter(([, spec]) => Boolean(process.env[spec.env]) || fs.existsSync(platformHomeBySpec(spec)))
    .map(([name]) => name);
  return detected.length ? detected : ["codex"];
}

function platformHomeBySpec(spec) {
  return path.resolve(expandHome(process.env[spec.env] || path.join(os.homedir(), spec.folder)));
}

function parseInstallArgs(args) {
  const options = {
    platform: "auto",
    target: process.env.CONTEXT_GUARD_SKILL_TARGET
      ? path.resolve(expandHome(process.env.CONTEXT_GUARD_SKILL_TARGET))
      : null,
    withHooks: true,
    hooksTarget: process.env.CONTEXT_GUARD_HOOKS_TARGET
      ? path.resolve(expandHome(process.env.CONTEXT_GUARD_HOOKS_TARGET))
      : null,
    configTarget: null,
    targetExplicit: Boolean(process.env.CONTEXT_GUARD_SKILL_TARGET),
    hooksTargetExplicit: Boolean(process.env.CONTEXT_GUARD_HOOKS_TARGET),
    dryRun: false
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--target") {
      const value = args[++i];
      if (!value) fail("--target requires a directory");
      options.target = path.resolve(expandHome(value));
      options.targetExplicit = true;
    } else if (arg === "--platform") {
      const value = String(args[++i] || "").toLowerCase();
      if (!["auto", "all", ...Object.keys(PLATFORM_SPECS)].includes(value)) {
        fail("--platform must be auto, all, codex, cursor, or claude");
      }
      options.platform = value;
    } else if (arg === "--with-hooks" || arg === "--hooks") {
      options.withHooks = true;
    } else if (arg === "--no-hooks") {
      options.withHooks = false;
    } else if (arg === "--hooks-target") {
      const value = args[++i];
      if (!value) fail("--hooks-target requires a file path");
      options.hooksTarget = path.resolve(expandHome(value));
      options.hooksTargetExplicit = true;
    } else if (arg === "--config-target") {
      const value = args[++i];
      if (!value) fail("--config-target requires a file path");
      options.configTarget = path.resolve(expandHome(value));
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "-h" || arg === "--help") {
      usage();
      process.exit(0);
    } else {
      fail(`unknown install option: ${arg}`);
    }
  }
  if ((options.target || options.hooksTarget || options.configTarget) && options.platform === "all") {
    fail("custom targets can only be used with one platform");
  }
  if (options.targetExplicit && !options.hooksTargetExplicit) {
    const platform = options.platform === "auto" ? "codex" : options.platform;
    options.hooksTarget = path.join(path.dirname(options.target), PLATFORM_SPECS[platform].hooksFile);
  }
  if (!options.configTarget && options.hooksTarget && (options.platform === "auto" || options.platform === "codex")) {
    options.configTarget = path.join(path.dirname(options.hooksTarget), "config.toml");
  }
  return options;
}

function migrateHooksFeatureConfig(configTarget, dryRun) {
  const original = fs.existsSync(configTarget) ? fs.readFileSync(configTarget, "utf8") : "";
  const lines = original ? original.replace(/\r\n/g, "\n").split("\n") : [];
  const sectionStart = lines.findIndex((line) => /^\s*\[features\]\s*(?:#.*)?$/.test(line));
  let nextLines = lines.slice();

  if (sectionStart === -1) {
    while (nextLines.length && nextLines[nextLines.length - 1] === "") nextLines.pop();
    if (nextLines.length) nextLines.push("");
    nextLines.push("[features]", "hooks = true", "");
  } else {
    let sectionEnd = nextLines.length;
    for (let i = sectionStart + 1; i < nextLines.length; i += 1) {
      if (/^\s*\[[^\]]+\]/.test(nextLines[i])) {
        sectionEnd = i;
        break;
      }
    }
    const hooksIndex = nextLines.findIndex(
      (line, index) => index > sectionStart && index < sectionEnd && /^\s*hooks\s*=/.test(line)
    );
    const legacyIndexes = [];
    nextLines.forEach((line, index) => {
      if (index > sectionStart && index < sectionEnd && /^\s*codex_hooks\s*=/.test(line)) legacyIndexes.push(index);
    });

    if (hooksIndex >= 0) {
      nextLines[hooksIndex] = nextLines[hooksIndex].replace(/^\s*hooks\s*=.*$/, "hooks = true");
      for (const index of legacyIndexes.reverse()) nextLines.splice(index, 1);
    } else if (legacyIndexes.length) {
      const first = legacyIndexes.shift();
      nextLines[first] = nextLines[first].replace(/^\s*codex_hooks\s*=.*$/, "hooks = true");
      for (const index of legacyIndexes.reverse()) nextLines.splice(index, 1);
    } else {
      nextLines.splice(sectionStart + 1, 0, "hooks = true");
    }
  }

  const next = `${nextLines.join("\n").replace(/\n*$/, "")}\n`;
  if (next === original.replace(/\r\n/g, "\n")) return;
  if (dryRun) {
    console.log(`[context-guard-skill] would enable hooks in ${configTarget}`);
    return;
  }
  fs.mkdirSync(path.dirname(configTarget), { recursive: true });
  if (fs.existsSync(configTarget)) {
    const backupPath = `${configTarget}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    fs.copyFileSync(configTarget, backupPath);
    console.log(`[context-guard-skill] backed up config: ${backupPath}`);
  }
  fs.writeFileSync(configTarget, next);
  console.log(`[context-guard-skill] enabled hooks: ${configTarget}`);
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
  fs.mkdirSync(target, { recursive: true });
  for (const entry of skillInstallEntries) {
    const from = path.join(sourceSkillDir, entry);
    if (!fs.existsSync(from)) continue;
    const to = path.join(target, entry);
    fs.cpSync(from, to, { recursive: true });
  }
  console.log(`[context-guard-skill] installed skill: ${target}`);
}

function hookCommand(skillTarget, event, platform) {
  const hookScript = path.join(skillTarget, "scripts", "context_guard_hook.py");
  const encodedHookScript = JSON.stringify(hookScript);
  const pythonCommand = process.platform === "win32" ? "python" : "python3";
  return `${pythonCommand} ${encodedHookScript} ${event} --platform ${platform}`;
}

function rewriteGroupedHookCommands(hooksConfig, skillTarget, platform) {
  const next = JSON.parse(JSON.stringify(hooksConfig));
  for (const groups of Object.values(next.hooks || {})) {
    for (const group of groups || []) {
      for (const hook of group.hooks || []) {
        if (hook.type === "command" && typeof hook.command === "string" && hook.command.includes("context_guard_hook.py")) {
          const match = hook.command.match(/context_guard_hook\.py["']?\s+([a-z-]+)/);
          const event = match ? match[1] : "session-start";
          hook.command = hookCommand(skillTarget, event, platform);
        }
      }
    }
  }
  return next;
}

function cursorHooks(skillTarget) {
  const events = {
    sessionStart: "session-start",
    subagentStart: "subagent-start",
    beforeSubmitPrompt: "user-prompt-submit",
    subagentStop: "subagent-stop",
    stop: "stop"
  };
  const hooks = {};
  for (const [cursorEvent, normalizedEvent] of Object.entries(events)) {
    hooks[cursorEvent] = [{
      type: "command",
      command: hookCommand(skillTarget, normalizedEvent, "cursor"),
      timeout: 10
    }];
  }
  return { version: 1, hooks };
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

function mergeCursorHooks(existing, incoming) {
  const merged = existing && typeof existing === "object" ? existing : {};
  merged.version = merged.version || 1;
  merged.hooks = merged.hooks && typeof merged.hooks === "object" ? merged.hooks : {};
  for (const [event, hooks] of Object.entries(incoming.hooks || {})) {
    const current = Array.isArray(merged.hooks[event]) ? merged.hooks[event] : [];
    merged.hooks[event] = current
      .filter((hook) => !String(hook && hook.command || "").includes("context_guard_hook.py"))
      .concat(hooks);
  }
  return merged;
}

function writeConfigFile(target, value, label, dryRun) {
  if (dryRun) {
    console.log(`[context-guard-skill] would install ${label} to ${target}`);
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (fs.existsSync(target)) {
    const backupPath = `${target}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    fs.copyFileSync(target, backupPath);
    console.log(`[context-guard-skill] backed up ${label}: ${backupPath}`);
  }
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
  console.log(`[context-guard-skill] installed ${label}: ${target}`);
}

function readObject(target) {
  if (!fs.existsSync(target)) return {};
  const value = JSON.parse(fs.readFileSync(target, "utf8"));
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function installHooks(platform, skillTarget, hooksTarget, dryRun) {
  if (!fs.existsSync(sourceHooksPath)) {
    fail(`source hooks file is missing: ${sourceHooksPath}`);
  }
  const existing = readObject(hooksTarget);
  if (platform === "cursor") {
    writeConfigFile(hooksTarget, mergeCursorHooks(existing, cursorHooks(skillTarget)), "hooks", dryRun);
    return;
  }
  const rawIncoming = JSON.parse(fs.readFileSync(sourceHooksPath, "utf8"));
  const incoming = rewriteGroupedHookCommands(rawIncoming, skillTarget, platform);
  const merged = mergeHooks(existing, incoming);
  writeConfigFile(hooksTarget, merged, platform === "claude" ? "settings hooks" : "hooks", dryRun);
}

function install(args) {
  const options = parseInstallArgs(args);
  let platforms = selectedPlatforms(options.platform);
  if ((options.target || options.hooksTarget || options.configTarget) && options.platform === "auto") {
    platforms = ["codex"];
  }
  for (const platform of platforms) {
    const defaults = platformTargets(platform);
    const skillTarget = options.target || defaults.target;
    const hooksTarget = options.hooksTarget || defaults.hooksTarget;
    const configTarget = options.configTarget || defaults.configTarget;
    copySkill(skillTarget, options.dryRun);
    if (options.withHooks) {
      if (platform === "codex" && configTarget) {
        migrateHooksFeatureConfig(configTarget, options.dryRun);
      }
      installHooks(platform, skillTarget, hooksTarget, options.dryRun);
    }
  }
}

function runPython(args) {
  if (!fs.existsSync(pythonScript)) {
    fail(`context_guard.py is missing: ${pythonScript}`);
  }
  const candidates = process.platform === "win32" ? ["python", "python3"] : ["python3", "python"];
  for (const command of candidates) {
    // Windows Store aliases can exist but exit 9009 instead of raising ENOENT.
    // Probe before running the real command so a failed command is never retried.
    const probe = spawnSync(command, ["--version"], { encoding: "utf8", windowsHide: true, timeout: 5000 });
    if (probe.error || probe.status !== 0 || !/^Python 3\./m.test(`${probe.stdout || ""}\n${probe.stderr || ""}`)) continue;
    const result = spawnSync(command, [pythonScript, ...args], { stdio: "inherit", windowsHide: true });
    if (result.error) fail(result.error.message);
    process.exit(result.status === null ? 1 : result.status);
  }
  fail("Python 3 is required; no working Python 3 interpreter was found (`python`, `python3`).");
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
