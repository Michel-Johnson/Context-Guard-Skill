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
  "THIRD_PARTY_NOTICES.md",
  "licenses",
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
  context-guard doctor [--platform auto|all|codex|cursor|claude] [--root <project>]
                       [--target <dir>] [--hooks-target <file>] [--config-target <file>] [--json]
  context-guard path
  context-guard sync connect|ensure|status|pull|prepare|track|checkpoint|finish [args...]
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

let detectedPython;
function pythonCommand() {
  if (detectedPython !== undefined) return detectedPython;
  const candidates = process.platform === "win32" ? ["python", "python3"] : ["python3", "python"];
  detectedPython = null;
  for (const command of candidates) {
    const probe = spawnSync(command, ["--version"], { encoding: "utf8", windowsHide: true, timeout: 5000 });
    if (!probe.error && probe.status === 0 && /^Python 3\./m.test(`${probe.stdout || ""}\n${probe.stderr || ""}`)) {
      detectedPython = command;
      break;
    }
  }
  return detectedPython;
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

function migratedHooksFeatureConfig(configTarget) {
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
  return next === original.replace(/\r\n/g, "\n") ? null : next;
}

function copySkill(target) {
  if (!fs.existsSync(path.join(sourceSkillDir, "SKILL.md"))) {
    throw new Error(`source skill folder is missing: ${sourceSkillDir}`);
  }
  fs.mkdirSync(target, { recursive: true });
  for (const entry of skillInstallEntries) {
    const from = path.join(sourceSkillDir, entry);
    if (!fs.existsSync(from)) continue;
    const to = path.join(target, entry);
    const options = entry === "scripts"
      ? {
          recursive: true,
          filter(source) {
            const relative = path.relative(from, source);
            if (relative === "") return true;
            const parts = relative.split(path.sep);
            return parts[0] !== "cloud"
              && relative !== "branch_guard.py"
              && !parts.includes("__pycache__")
              && !/\.py[co]$/i.test(parts.at(-1));
          }
        }
      : { recursive: true };
    fs.cpSync(from, to, options);
  }
}

function hookCommand(skillTarget, event, platform) {
  const hookScript = path.join(skillTarget, "scripts", "context_guard_hook.py");
  const encodedHookScript = JSON.stringify(hookScript);
  const python = pythonCommand();
  if (!python) throw new Error("Python 3 is required before lifecycle hooks can be installed");
  return `${python} ${encodedHookScript} ${event} --platform ${platform}`;
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
      timeout: normalizedEvent === "session-start" ? 20 : 10
    }];
  }
  return { version: 1, hooks };
}

function mergeHooks(existing, incoming) {
  const merged = existing && typeof existing === "object" ? existing : {};
  merged.hooks = merged.hooks && typeof merged.hooks === "object" ? merged.hooks : {};
  for (const [event, groups] of Object.entries(incoming.hooks || {})) {
    const current = Array.isArray(merged.hooks[event]) ? merged.hooks[event] : [];
    const withoutOldContextGuard = current.flatMap((group) => {
      const hooks = group.hooks.filter((hook) => !String(hook.command || "").includes("context_guard_hook.py"));
      if (hooks.length === group.hooks.length) return [group];
      return hooks.length ? [{ ...group, hooks }] : [];
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

function readObject(target, platform) {
  if (!fs.existsSync(target)) return {};
  const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
  let value;
  try {
    value = JSON.parse(fs.readFileSync(target, "utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new Error(`Cannot read JSON config ${target}: ${error.message}`);
  }
  if (!object(value) || (value.hooks !== undefined && !object(value.hooks))) {
    throw new Error(`Invalid config object or hooks in ${target}; original file was not changed.`);
  }
  for (const [event, entries] of Object.entries(value.hooks || {})) {
    if (!Array.isArray(entries) || entries.some(entry => !object(entry) ||
      (platform !== "cursor" && (!Array.isArray(entry.hooks) || entry.hooks.some(hook => !object(hook)))))) {
      throw new Error(`Invalid hook event ${event} in ${target}; original file was not changed.`);
    }
  }
  return value;
}

function plannedHooks(platform, skillTarget, hooksTarget) {
  if (!fs.existsSync(sourceHooksPath)) {
    throw new Error(`source hooks file is missing: ${sourceHooksPath}`);
  }
  const existing = readObject(hooksTarget, platform);
  if (platform === "cursor") {
    return mergeCursorHooks(existing, cursorHooks(skillTarget));
  }
  const rawIncoming = JSON.parse(fs.readFileSync(sourceHooksPath, "utf8"));
  if (platform === "claude") {
    const supported = new Set(["SessionStart", "SubagentStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "SubagentStop", "Stop"]);
    rawIncoming.hooks = Object.fromEntries(Object.entries(rawIncoming.hooks || {}).filter(([event]) => supported.has(event)));
  }
  const incoming = rewriteGroupedHookCommands(rawIncoming, skillTarget, platform);
  return mergeHooks(existing, incoming);
}

function containsPath(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative));
}

function applyInstallPlan(plan, dryRun) {
  for (const entry of plan) {
    if (containsPath(entry.target, os.homedir())) {
      throw new Error(`Install destination must not replace the user home or its parent: ${entry.target}`);
    }
    if (containsPath(entry.target, sourceSkillDir) || containsPath(sourceSkillDir, entry.target)) {
      throw new Error(`Install destination overlaps its source package: ${entry.target}`);
    }
    const stat = fs.lstatSync(entry.target, { throwIfNoEntry: false });
    if (stat && (stat.isSymbolicLink() || (entry.kind === "skill" ? !stat.isDirectory() : !stat.isFile()))) {
      throw new Error(`Invalid install destination: ${entry.target}`);
    }
    entry.mode = stat ? stat.mode & 0o777 : 0o600;
    for (const other of plan) if (entry !== other && containsPath(entry.target, other.target)) {
      throw new Error(`Overlapping install destinations: ${entry.target} and ${other.target}`);
    }
  }
  if (dryRun) {
    for (const entry of plan) console.log(`[context-guard-skill] would install ${entry.kind}: ${entry.target}`);
    return;
  }

  const staged = [];
  try {
    // Prepare every replacement before touching existing files. Temporary
    // siblings allow renames on the same filesystem, including on Windows.
    for (const entry of plan) {
      fs.mkdirSync(path.dirname(entry.target), { recursive: true });
      entry.temp = fs.mkdtempSync(path.join(path.dirname(entry.target), ".context-guard-install-"));
      entry.next = path.join(entry.temp, "next");
      entry.previous = path.join(entry.temp, "previous");
      staged.push(entry);
      if (entry.kind === "skill") copySkill(entry.next);
      else fs.writeFileSync(entry.next, entry.content, { mode: entry.mode });
    }
    for (const entry of staged) {
      if (fs.existsSync(entry.target)) {
        fs.renameSync(entry.target, entry.previous);
        entry.oldMoved = true;
      }
      fs.renameSync(entry.next, entry.target);
      entry.newMoved = true;
    }
  } catch (error) {
    for (const entry of staged.slice().reverse()) {
      try {
        if (entry.newMoved) fs.rmSync(entry.target, { recursive: entry.kind === "skill", force: true });
        if (entry.oldMoved) fs.renameSync(entry.previous, entry.target);
      } catch (rollbackError) {
        entry.preserve = true;
        console.error(`[context-guard-skill] Recovery needed; kept ${entry.temp}: ${rollbackError.message}`);
      }
    }
    throw error;
  } finally {
    for (const entry of staged) {
      if (entry.preserve) continue;
      try {
        // Keep original client configuration as a uniquely named backup only
        // after a successful replacement. Failed installs restore it instead.
        if (entry.kind !== "skill" && fs.existsSync(entry.previous)) {
          const backup = `${entry.target}.bak-${path.basename(entry.temp)}`;
          fs.renameSync(entry.previous, backup);
          console.log(`[context-guard-skill] backed up config: ${backup}`);
        }
        fs.rmSync(entry.temp, { recursive: true, force: true });
      } catch (error) {
        console.warn(`[context-guard-skill] Kept recovery files at ${entry.temp}: ${error.message}`);
      }
    }
  }
  for (const entry of plan) console.log(`[context-guard-skill] installed ${entry.kind}: ${entry.target}`);
}

function install(args) {
  const options = parseInstallArgs(args);
  let platforms = selectedPlatforms(options.platform);
  if ((options.target || options.hooksTarget || options.configTarget) && options.platform === "auto") {
    platforms = ["codex"];
  }
  const plan = [];
  for (const platform of platforms) {
    const defaults = platformTargets(platform);
    const skillTarget = options.target || defaults.target;
    const hooksTarget = options.hooksTarget || defaults.hooksTarget;
    const configTarget = options.configTarget || defaults.configTarget;
    plan.push({ target: skillTarget, kind: "skill" });
    if (options.withHooks) {
      const hooks = plannedHooks(platform, skillTarget, hooksTarget);
      if (platform === "codex" && configTarget) {
        const content = migratedHooksFeatureConfig(configTarget);
        if (content !== null) plan.push({ target: configTarget, kind: "config", content });
      }
      plan.push({ target: hooksTarget, kind: "hooks", content: `${JSON.stringify(hooks, null, 2)}\n` });
    }
  }
  applyInstallPlan(plan, options.dryRun);
}

function parseDoctorArgs(args) {
  const options = { platform: "auto", root: process.cwd(), target: null, hooksTarget: null, configTarget: null, json: false };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (["--platform", "--root", "--target", "--hooks-target", "--config-target"].includes(arg)) {
      const value = args[++i];
      if (!value) fail(`${arg} requires a value`);
      if (arg === "--platform") {
        const platform = String(value).toLowerCase();
        if (!["auto", "all", ...Object.keys(PLATFORM_SPECS)].includes(platform)) fail("--platform must be auto, all, codex, cursor, or claude");
        options.platform = platform;
      } else options[{ "--root": "root", "--target": "target", "--hooks-target": "hooksTarget", "--config-target": "configTarget" }[arg]] = path.resolve(expandHome(value));
    } else if (arg === "--json") options.json = true;
    else fail(`unknown doctor option: ${arg}`);
  }
  if ((options.target || options.hooksTarget || options.configTarget) && options.platform === "all") fail("custom doctor targets can only be used with one platform");
  return options;
}

function hookCommands(config, platform, event) {
  const entries = config?.hooks?.[event];
  if (!Array.isArray(entries)) return [];
  if (platform === "cursor") return entries.map(item => item?.command).filter(Boolean);
  return entries.flatMap(group => (group?.hooks || []).map(item => item?.command)).filter(Boolean);
}

function doctor(args) {
  const options = parseDoctorArgs(args);
  const results = [];
  const check = (name, ok, detail, required = true) => results.push({ name, ok: Boolean(ok), detail, required });
  const python = pythonCommand();
  check("python", python, python ? `${python} is Python 3` : "no working Python 3 interpreter");
  let platforms = selectedPlatforms(options.platform);
  if ((options.target || options.hooksTarget || options.configTarget) && options.platform === "auto") platforms = ["codex"];
  const eventNames = {
    codex: ["SessionStart", "SubagentStart", "UserPromptSubmit", "PreToolUse", "PermissionRequest", "PostToolUse", "PreCompact", "PostCompact", "SubagentStop", "Stop", "Interrupt"],
    claude: ["SessionStart", "SubagentStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "SubagentStop", "Stop"],
    cursor: ["sessionStart", "subagentStart", "beforeSubmitPrompt", "subagentStop", "stop"]
  };
  for (const platform of platforms) {
    const defaults = platformTargets(platform);
    const target = options.target || defaults.target;
    const hooksTarget = options.hooksTarget || defaults.hooksTarget;
    const configTarget = options.configTarget || defaults.configTarget;
    check(`${platform}.skill`, fs.existsSync(path.join(target, "SKILL.md")) && fs.existsSync(path.join(target, "scripts", "context_guard_hook.py")), target);
    let config = null;
    try { config = readObject(hooksTarget, platform); } catch (error) { check(`${platform}.hooks`, false, error.message); }
    if (config) {
      const missing = eventNames[platform].filter(event => !hookCommands(config, platform, event).some(command => command.includes("context_guard_hook.py") && command.includes(`--platform ${platform}`)));
      check(`${platform}.hooks`, missing.length === 0, missing.length ? `missing ${missing.join(", ")}` : hooksTarget);
    }
    if (platform === "codex" && configTarget) {
      const text = fs.existsSync(configTarget) ? fs.readFileSync(configTarget, "utf8") : "";
      check("codex.hooks-feature", /^\s*hooks\s*=\s*true\s*$/m.test(text), configTarget);
    }
  }
  const ctx = path.join(options.root, ".codex", "context");
  let map = null;
  try { map = JSON.parse(fs.readFileSync(path.join(ctx, "map.json"), "utf8")); } catch {}
  check("project.map", map?.root?.id || map?.root === null, path.join(ctx, "map.json"));
  check("project.sessions", fs.existsSync(path.join(ctx, "sessions.jsonl")), path.join(ctx, "sessions.jsonl"));
  let workbench = null;
  try { workbench = JSON.parse(fs.readFileSync(path.join(ctx, "private", "workbench.json"), "utf8")); } catch {}
  let alive = false;
  if (workbench?.pid) { try { process.kill(workbench.pid, 0); alive = true; } catch {} }
  check("project.workbench", alive && workbench?.protocol === 2, alive ? workbench.url : "not running; SessionStart or `context-guard workbench` can start it", false);
  const ok = results.every(item => !item.required || item.ok);
  if (options.json) console.log(JSON.stringify({ ok, results }, null, 2));
  else {
    for (const item of results) console.log(`[${item.ok ? "ok" : item.required ? "fail" : "warn"}] ${item.name}: ${item.detail}`);
    console.log(`[context-guard-skill] doctor: ${ok ? "ready" : "not ready"}`);
  }
  if (!ok) process.exitCode = 1;
}

function runPython(args) {
  if (!fs.existsSync(pythonScript)) {
    fail(`context_guard.py is missing: ${pythonScript}`);
  }
  const command = pythonCommand();
  if (!command) fail("Python 3 is required; no working Python 3 interpreter was found (`python`, `python3`).");
  const result = spawnSync(command, [pythonScript, ...args], { stdio: "inherit", windowsHide: true });
  if (result.error) fail(result.error.message);
  process.exit(result.status === null ? 1 : result.status);
}

const [command, ...rest] = process.argv.slice(2);

if (!command || command === "-h" || command === "--help" || command === "help") {
  usage();
} else if (command === "install") {
  try { install(rest); } catch (error) { fail(error.message); }
} else if (command === "path") {
  console.log(sourceSkillDir);
} else if (command === "doctor") {
  doctor(rest);
} else if (command === "sync") {
  const result = spawnSync(process.execPath, [path.join(sourceSkillDir, "scripts", "sync", "client.mjs"), ...rest], { stdio: "inherit", windowsHide: true });
  if (result.error) fail(result.error.message);
  process.exit(result.status === null ? 1 : result.status);
} else if (command === "map" || command === "workbench") {
  const result = spawnSync(process.execPath, [path.join(sourceSkillDir, "scripts", "workbench", "cli.mjs"), command, ...rest], { stdio: "inherit", windowsHide: true });
  process.exit(result.status ?? 1);
} else {
  runPython([command, ...rest]);
}
