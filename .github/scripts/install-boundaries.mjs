import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { isolatedEnvironment } from "./client-protocol.mjs";
import { installedFiles } from "./package-contract.mjs";

const clients = ["codex", "cursor", "claude"];
const configName = client => client === "claude" ? "settings.json" : "hooks.json";
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const write = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof data === "string" ? data : JSON.stringify(data));
};

function snapshot(root) {
  const result = {};
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else result[path.relative(root, file)] = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    }
  }
  visit(root);
  return result;
}

function installWithFault(cli, env, method, matches, args = ["install", "--platform", "cursor"]) {
  const require = createRequire(cli);
  const denied = Object.assign(new Error("EACCES: injected install failure"), { code: "EACCES" });
  const stopped = new Error("exit");
  const errors = [];
  let injected = false, exited;
  try {
    vm.runInNewContext(fs.readFileSync(cli, "utf8"), {
      __dirname: path.dirname(cli),
      console: { log() {}, warn() {}, error(message) { errors.push(message); } },
      require(name) {
        if (name === "fs") return new Proxy(fs, { get(target, key) {
          if (key !== method) return target[key];
          return (...values) => {
            if (!injected && matches(...values)) { injected = true; throw denied; }
            return target[key](...values);
          };
        } });
        if (name === "os") return { ...require(name), homedir: () => env.HOME };
        return require(name);
      },
      process: { platform: process.platform, env, argv: [process.execPath, cli, ...args], exit(code) { exited = code; throw stopped; } }
    });
  } catch (error) { if (error !== stopped) throw error; }
  assert.ok(injected, `The ${method} failure path must actually be reached`);
  assert.equal(exited, 1);
  assert.match(errors.join("\n"), /EACCES: injected install failure/);
  assert.ok(!errors.some(message => message.includes("Recovery needed")), "Automatic rollback must complete");
}

export function checkInstallBoundaries({ packageDirectory, root }) {
  const cli = path.join(packageDirectory, "bin", "context-guard-skill.js");
  const failures = [];
  let passed = 0;
  function check(name, body) {
    const caseRoot = path.join(root, name);
    const env = isolatedEnvironment(caseRoot);
    // Do not pre-create client folders or set client overrides: exercise the
    // public installer's real default discovery in a disposable user home.
    env.HOME = env.USERPROFILE = path.join(caseRoot, "user with spaces");
    fs.mkdirSync(env.HOME, { recursive: true });
    for (const key of ["CODEX_HOME", "CURSOR_HOME", "CLAUDE_HOME", "CLAUDE_CONFIG_DIR"]) delete env[key];
    const home = client => path.join(env.HOME, `.${client}`);
    const skill = client => path.join(home(client), "skills", "context-guard");
    const config = client => path.join(home(client), configName(client));
    function invoke(args = ["install"], success = true, environment = env) {
      const result = spawnSync(process.execPath, [cli, ...args], {
        cwd: caseRoot, env: environment, encoding: "utf8", windowsHide: true, timeout: 20_000
      });
      assert.ifError(result.error);
      if (success) assert.equal(result.status, 0, result.stderr);
      else {
        assert.notEqual(result.status, 0, "Failed installation must not report success");
        assert.ok(result.stderr.trim(), "Failure needs a diagnostic");
      }
      return result;
    }
    try {
      body({ env, home, skill, config, invoke, caseRoot });
      passed++;
      console.log(`Install boundary passed: ${name}`);
    } catch (error) {
      failures.push(`${name}: ${error.message}`);
      console.error(`Install boundary failed: ${name}: ${error.message}`);
    }
  }

  for (const present of [[], ["codex"], ["cursor"], ["claude"], clients]) {
    check(`auto-${present.join("-") || "empty"}`, ({ home, skill, config, invoke }) => {
      for (const client of present) fs.mkdirSync(home(client));
      invoke();
      const expected = present.length ? present : ["codex"];
      for (const client of clients) {
        if (expected.includes(client)) {
          for (const file of installedFiles) assert.ok(fs.existsSync(path.join(skill(client), file)), `${client}/${file}`);
          assert.ok(fs.existsSync(config(client)), `${client} hooks missing`);
        } else assert.ok(!fs.existsSync(home(client)), `Must not install unrelated ${client}`);
      }
    });
  }

  for (const client of clients) {
    check(`repeat-${client}`, ({ home, skill, config, invoke, env }) => {
      fs.mkdirSync(home(client));
      invoke();
      const settings = readJson(config(client));
      settings.userSetting = { keep: ["中文", "unchanged"] };
      const thirdParty = { type: "command", command: "echo keep-user-hook", timeout: 17 };
      const event = client === "cursor" ? "stop" : "Stop";
      if (client === "cursor") settings.hooks[event].push(thirdParty);
      else {
        // A user hook may share a group with ours. Removing the whole group
        // loses that hook and its matcher/metadata.
        settings.hooks[event][0].hooks.push(thirdParty);
        settings.hooks[event][0].matcher = "user-matcher";
      }
      write(config(client), settings);
      write(path.join(env.HOME, "project", ".codex", "context", "preferences.json"), { record_language: "zh" });
      write(path.join(env.HOME, "project", ".codex", "context", "user-messages.md"), "keep user memory");
      const memory = snapshot(path.join(env.HOME, "project"));
      for (let attempt = 0; attempt < 2; attempt++) {
        invoke();
        const current = readJson(config(client));
        assert.deepEqual(current.userSetting, settings.userSetting);
        for (const groups of Object.values(current.hooks)) {
          const hooks = client === "cursor" ? groups : groups.flatMap(group => group.hooks || []);
          assert.equal(hooks.filter(hook => hook.command?.includes("context_guard_hook.py")).length, 1, "Duplicate or missing managed hook");
        }
        const groups = current.hooks[event];
        const hooks = client === "cursor" ? groups : groups.flatMap(group => group.hooks);
        assert.deepEqual(hooks.filter(hook => hook.command === thirdParty.command), [thirdParty]);
        if (client !== "cursor") assert.equal(groups.find(group => group.hooks.some(h => h.command === thirdParty.command)).matcher, "user-matcher");
        assert.deepEqual(snapshot(path.join(env.HOME, "project")), memory);
        for (const file of installedFiles) assert.ok(fs.existsSync(path.join(skill(client), file)));
      }
      const backups = fs.readdirSync(home(client)).filter(file => file.startsWith(configName(client) + ".bak-"));
      assert.ok(backups.some(file => fs.readFileSync(path.join(home(client), file), "utf8") === JSON.stringify(settings)), "Original config must be recoverable");
    });

    for (const [label, invalid] of [["json", "{ broken"], ["object", "[]"], ["hooks", '{"hooks":[]}'], ["event", '{"hooks":{"Stop":"broken"}}']]) {
      check(`invalid-${label}-${client}`, ({ home, skill, config, invoke, env }) => {
        write(path.join(skill(client), "SKILL.md"), "old installed version");
        write(config(client), invalid);
        if (client === "codex") write(path.join(home(client), "config.toml"), "[features]\nhooks = false\n");
        const before = snapshot(env.HOME);
        invoke(["install"], false);
        assert.deepEqual(snapshot(env.HOME), before, "Invalid config must not change the old installation or settings");
      });
    }
  }

  check("all-preflight", ({ home, skill, config, invoke, env }) => {
    for (const client of clients) {
      write(path.join(skill(client), "SKILL.md"), "old installed version");
      write(config(client), client === "claude" ? "{ broken" : {});
    }
    write(path.join(home("codex"), "config.toml"), "[features]\nhooks = false\n");
    const before = snapshot(env.HOME);
    invoke(["install", "--platform", "all"], false);
    assert.deepEqual(snapshot(env.HOME), before, "A later bad client config must not partially install earlier clients");
  });

  check("blocked-destination", ({ home, invoke, env }) => {
    write(path.join(home("codex"), "skills"), "A file blocks the required directory");
    write(path.join(home("codex"), "config.toml"), "[features]\nhooks = false\n");
    const before = snapshot(env.HOME);
    invoke(["install"], false);
    assert.deepEqual(snapshot(env.HOME), before);
  });

  check("reject-user-home-target", ({ invoke, env }) => {
    write(path.join(env.HOME, "keep.md"), "user data");
    const before = snapshot(env.HOME);
    invoke(["install", "--target", env.HOME], false);
    assert.deepEqual(snapshot(env.HOME), before);
  });

  check("missing-python", ({ env, invoke, caseRoot }) => {
    const noPython = { ...env };
    for (const key of Object.keys(noPython)) if (key.toLowerCase() === "path") delete noPython[key];
    noPython.PATH = path.join(caseRoot, "empty-path");
    fs.mkdirSync(noPython.PATH);
    const project = path.join(env.HOME, "project");
    write(path.join(project, "keep.md"), "user data");
    const before = snapshot(env.HOME);
    const result = invoke(["init", "--root", project], false, noPython);
    assert.match(result.stderr, /Python 3.*required/);
    assert.deepEqual(snapshot(env.HOME), before);
  });

  check("copy-denied", ({ skill, config, env }) => {
    write(path.join(skill("cursor"), "SKILL.md"), "old installed version");
    write(config("cursor"), { userSetting: "keep" });
    const before = snapshot(env.HOME);
    installWithFault(cli, env, "cpSync", () => true);
    assert.deepEqual(snapshot(env.HOME), before, "Copy failure must preserve the old Skill and config");
  });

  check("late-replace-denied", ({ skill, config, home, env }) => {
    for (const client of clients) {
      write(path.join(skill(client), "SKILL.md"), "old installed version");
      write(config(client), { userSetting: "keep" });
    }
    write(path.join(home("codex"), "config.toml"), "[features]\nhooks = false\n");
    const before = snapshot(env.HOME);
    installWithFault(cli, env, "renameSync", (from, to) => path.basename(from) === "next" && to === config("claude"), ["install", "--platform", "all"]);
    assert.deepEqual(snapshot(env.HOME), before, "A late replacement failure must restore every earlier client too");
  });

  check("dry-run", ({ home, invoke, env }) => {
    fs.mkdirSync(home("cursor"));
    const before = snapshot(env.HOME);
    invoke(["install", "--dry-run"]);
    assert.deepEqual(snapshot(env.HOME), before);
  });

  check("no-hooks", ({ home, skill, config, invoke }) => {
    fs.mkdirSync(home("cursor"));
    write(config("cursor"), "{ user config left alone");
    invoke(["install", "--no-hooks"]);
    assert.ok(fs.existsSync(path.join(skill("cursor"), "SKILL.md")));
    assert.equal(fs.readFileSync(config("cursor"), "utf8"), "{ user config left alone");
  });

  if (process.platform !== "win32" && process.getuid?.() !== 0) {
    check("readonly-directory", ({ home, skill, config, invoke, env }) => {
      write(path.join(skill("cursor"), "SKILL.md"), "old installed version");
      write(config("cursor"), { userSetting: "keep" });
      const parent = path.join(home("cursor"), "skills");
      const mode = fs.statSync(parent).mode & 0o777;
      const before = snapshot(env.HOME);
      fs.chmodSync(parent, 0o500);
      try {
        const result = invoke(["install"], false);
        assert.match(result.stderr, /EACCES|permission denied/i);
        assert.deepEqual(snapshot(env.HOME), before);
      } finally { fs.chmodSync(parent, mode); }
    });
  }

  assert.equal(failures.length, 0, failures.join("\n"));
  console.log(`Install boundaries passed: ${passed} cases (copy/replace EACCES injected; native readonly test runs only as non-root on Unix).`);
}
