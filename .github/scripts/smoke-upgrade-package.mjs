#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { npmInvocation } from "./npm-command.mjs";
import { installedFiles, forbiddenInstalledPaths } from "./package-contract.mjs";
import { assertDigest, packageName, sha256 } from "./release-checks.mjs";

const platforms = ["codex", "cursor", "claude"];
const thirdParty = { type: "command", command: "echo keep-third-party-hook", timeout: 7 };

export function assertCliContents(actual, expected) {
  // npm/bin-links fixes CRLF only on a bin's shebang; do not normalize its body.
  const normalized = expected.replace(/^(#![^\n]+)\r\n/, "$1\n");
  assert.equal(sha256(Buffer.from(actual)), sha256(Buffer.from(normalized)), "Installed CLI differs from candidate (excluding npm shebang normalization)");
}

export function snapshotFiles(root) {
  const snapshot = {};
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) snapshot[path.relative(root, full)] = sha256(fs.readFileSync(full));
      else throw new Error(`Unexpected non-file in context snapshot: ${full}`);
    }
  }
  visit(root);
  return snapshot;
}

export function assertPreserved(root, snapshot) {
  for (const [relative, expected] of Object.entries(snapshot)) {
    const target = path.join(root, relative);
    assert.ok(fs.existsSync(target), `User file was removed: ${relative}`);
    assert.equal(sha256(fs.readFileSync(target)), expected, `User file changed: ${relative}`);
  }
}

export function assertHooks(config, platform, skill) {
  assert.deepEqual(config.userSetting, { keep: true }, `${platform}: user settings changed`);
  const events = platform === "cursor"
    ? ["sessionStart", "subagentStart", "beforeSubmitPrompt", "subagentStop", "stop"]
    : ["SessionStart", "SubagentStart", "UserPromptSubmit", "SubagentStop", "Stop"];
  const normalized = ["session-start", "subagent-start", "user-prompt-submit", "subagent-stop", "stop"];
  events.forEach((event, index) => {
    const entries = config.hooks?.[event] || [];
    const hooks = platform === "cursor" ? entries : entries.flatMap((group) => group.hooks || []);
    const managed = hooks.filter((hook) => hook.command?.includes("context_guard_hook.py"));
    assert.equal(managed.length, 1, `${platform}/${event}: expected exactly one managed hook`);
    const expected = `${JSON.stringify(path.join(skill, "scripts", "context_guard_hook.py"))} ${normalized[index]} --platform ${platform}`;
    assert.ok(managed[0].command.endsWith(expected), `${platform}/${event}: stale hook target`);
    if (index === events.length - 1) {
      assert.equal(hooks.filter((hook) => hook.command === thirdParty.command).length, 1, `${platform}: third-party hook missing or duplicated`);
      assert.deepEqual(hooks.find((hook) => hook.command === thirdParty.command), thirdParty);
    }
  });
}

export function smokeUpgrade(tarball, baselineDirectory, workspace) {
  fs.mkdirSync(workspace, { recursive: true });
  const root = fs.mkdtempSync(path.join(path.resolve(workspace), "upgrade-"));
  const npm = npmInvocation();
  const env = { ...process.env };
  // Never inspect personal npm credentials, client homes, or project configuration.
  for (const key of Object.keys(env)) {
    if (/^(npm_config_|context_guard_|codex_home$|cursor_home$|claude_home$|node_auth_token$|npm_token$)/i.test(key)) delete env[key];
  }
  const home = path.join(root, "home");
  fs.mkdirSync(home);
  Object.assign(env, {
    HOME: home, USERPROFILE: home, APPDATA: path.join(home, "AppData", "Roaming"),
    LOCALAPPDATA: path.join(home, "AppData", "Local"), XDG_CONFIG_HOME: path.join(home, ".config"),
    CODEX_HOME: path.join(home, ".codex"), CURSOR_HOME: path.join(home, ".cursor"), CLAUDE_HOME: path.join(home, ".claude"),
    npm_config_cache: path.join(root, "npm-cache"), npm_config_userconfig: path.join(root, ".npmrc"),
    npm_config_globalconfig: path.join(root, "global.npmrc"), npm_config_registry: "https://registry.npmjs.org/",
    npm_config_audit: "false", npm_config_fund: "false", PYTHONUTF8: "1"
  });
  fs.writeFileSync(env.npm_config_userconfig, "");
  fs.writeFileSync(env.npm_config_globalconfig, "");
  const prefix = path.join(root, "npm-prefix");
  const packageRoot = path.join(prefix, ...(process.platform === "win32" ? [] : ["lib"]), "node_modules", "@michelj", "context-guard");
  const cli = path.join(packageRoot, "bin", "context-guard-skill.js");
  const project = path.join(root, "user-project");
  const context = path.join(project, ".codex", "context");

  function run(command, args) {
    const result = spawnSync(command, args, { cwd: root, env, encoding: "utf8", windowsHide: true, timeout: 180_000 });
    if (result.error || result.status !== 0) {
      throw new Error(`Upgrade command failed: ${command} ${args.join(" ")}\nstatus=${result.status} signal=${result.signal || "none"}\n${result.error || ""}\n${result.stdout}\n${result.stderr}`);
    }
    return result.stdout;
  }
  const npmRun = (args) => run(npm.command, [...npm.args, ...args]);
  const configPath = (platform) => path.join(env[`${platform.toUpperCase()}_HOME`], platform === "claude" ? "settings.json" : "hooks.json");
  const skillPath = (platform) => path.join(env[`${platform.toUpperCase()}_HOME`], "skills", "context-guard");
  let passed = false;
  try {
    const baseline = JSON.parse(fs.readFileSync(path.join(baselineDirectory, "release.json"), "utf8"));
    assert.equal(baseline.name, packageName);
    const previous = path.join(baselineDirectory, "previous.tgz");
    assertDigest(fs.readFileSync(previous), baseline.sha256);
    for (const platform of platforms) {
      fs.mkdirSync(path.dirname(configPath(platform)), { recursive: true });
      const event = platform === "cursor" ? "stop" : "Stop";
      const entry = platform === "cursor" ? thirdParty : { hooks: [thirdParty] };
      fs.writeFileSync(configPath(platform), JSON.stringify({ userSetting: { keep: true }, hooks: { [event]: [entry] } }));
    }
    const toml = path.join(env.CODEX_HOME, "config.toml");
    fs.writeFileSync(toml, '# User-owned configuration\nmodel = "user-model"\n\n[features]\nhooks = true\nuser_feature = true\n\n[profiles.personal]\nmodel = "personal-model"\n');
    npmRun(["install", "--global", "--prefix", prefix, previous]);
    assert.equal(JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"))).version, baseline.version);
    const baselineSkillSnapshots = {};
    for (const platform of platforms) {
      assertHooks(JSON.parse(fs.readFileSync(configPath(platform))), platform, skillPath(platform));
      baselineSkillSnapshots[platform] = snapshotFiles(skillPath(platform));
    }
    // The currently published Windows launcher predates reliable Store-alias
    // detection. Existing users already have state, so create that old-format
    // baseline through the published package's Python entry instead of requiring
    // its launcher to initialize a brand-new project during an upgrade test.
    const baselinePython = process.platform === "win32" ? "python" : "python3";
    run(baselinePython, [path.join(packageRoot, "scripts", "context_guard.py"), "init", "--root", project]);
    fs.appendFileSync(path.join(context, "index.md"), "\nUser-maintained context: preserve me.\n");
    fs.writeFileSync(path.join(context, "user-notes.md"), "Personal decisions and unfinished work.\n");
    const before = snapshotFiles(context);
    const beforeToml = fs.readFileSync(toml, "utf8");

    const expectedRoot = path.join(root, "expected");
    fs.mkdirSync(expectedRoot);
    run("tar", ["-xzf", path.resolve(tarball), "-C", expectedRoot]);
    const expectedPackage = path.join(expectedRoot, "package");
    const candidate = JSON.parse(fs.readFileSync(path.join(expectedPackage, "package.json")));
    assert.equal(candidate.name, packageName);
    function verifyUpgrade(globalUpgrade = true) {
      assert.equal(JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"))).version, globalUpgrade ? candidate.version : baseline.version);
      if (globalUpgrade) assertCliContents(fs.readFileSync(cli, "utf8"), fs.readFileSync(path.join(expectedPackage, "bin", "context-guard-skill.js"), "utf8"));
      for (const platform of platforms) {
        const skill = skillPath(platform);
        for (const file of installedFiles) {
          const actual = fs.readFileSync(path.join(skill, file));
          const expected = fs.readFileSync(path.join(expectedPackage, file));
          if (file === "bin/context-guard-skill.js") assertCliContents(actual.toString("utf8"), expected.toString("utf8"));
          else assertDigest(actual, sha256(expected));
        }
        for (const excluded of forbiddenInstalledPaths) assert.ok(!fs.existsSync(path.join(skill, excluded)), `Unexpected installed path: ${excluded}`);
        assertHooks(JSON.parse(fs.readFileSync(configPath(platform))), platform, skill);
      }
      assert.equal(fs.readFileSync(toml, "utf8"), beforeToml, "User TOML settings changed during upgrade");
      assertPreserved(context, before);
    }
    npmRun(["install", "--global", "--prefix", prefix, path.resolve(tarball)]);
    verifyUpgrade();
    assert.match(run(process.execPath, [cli, "--help"]), /context-guard/);
    run(process.execPath, [cli, "init", "--root", project]);
    verifyUpgrade();
    npmRun(["exec", "--yes", "--offline", "--package", path.resolve(tarball), "--", "context-guard", "install", "--platform", "all"]);
    verifyUpgrade();

    // Restore the old managed Skill, then exercise the npx/npm-exec-only upgrade path.
    npmRun(["install", "--global", "--prefix", prefix, previous]);
    for (const platform of platforms) {
      assert.deepEqual(snapshotFiles(skillPath(platform)), baselineSkillSnapshots[platform],
        `${platform}: reinstalling the published baseline did not restore its exact managed Skill`);
    }
    const execCandidate = (args) => npmRun(["exec", "--yes", "--offline", "--package", path.resolve(tarball), "--", "context-guard", ...args]);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      execCandidate(["install", "--platform", "all"]);
      verifyUpgrade(false);
    }
    assert.match(execCandidate(["--help"]), /context-guard/);
    execCandidate(["init", "--root", project]);
    verifyUpgrade(false);
    console.log(`Upgrade acceptance passed: ${baseline.version} -> ${candidate.version}; npm-global and npm-exec upgrades, 3 clients, candidate bytes, user settings/context, third-party hooks, repeated install`);
    passed = true;
  } finally {
    // This newly created child is the only cleanup target; keep evidence on failure.
    if (passed && path.dirname(root) === path.resolve(workspace)) fs.rmSync(root, { recursive: true, force: true });
    else console.error(`Preserved failed upgrade evidence: ${root}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [tarball = process.env.PACKAGE_TARBALL, baseline = "dist/baseline", workspace] = process.argv.slice(2);
  assert.ok(tarball && workspace, "Usage: smoke-upgrade-package.mjs <tarball> <baseline-directory> <workspace>");
  smokeUpgrade(path.resolve(tarball), path.resolve(baseline), path.resolve(workspace));
}
