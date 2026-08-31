#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { npmInvocation } from "./npm-command.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "context-guard-cd-rehearsal-"));
const npm = npmInvocation();
let passed = false;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repositoryRoot,
    env: { ...process.env, ...options.env },
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    windowsHide: true,
    timeout: 300_000
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

try {
  run(process.execPath, [".github/scripts/security-tool.mjs"]);
  run(npm.command, [...npm.args, "test"]);
  run(process.execPath, [".github/scripts/verify-workflows.mjs"]);

  const dist = path.join(temporaryRoot, "dist");
  const packJson = path.join(temporaryRoot, "npm-pack.json");
  const npmCache = path.join(temporaryRoot, "npm-cache");
  fs.mkdirSync(dist, { recursive: true });

  const packed = run(
    npm.command,
    [...npm.args, "pack", "--json", "--pack-destination", dist],
    {
      capture: true,
      env: {
        CONTEXT_GUARD_SKIP_AUTO_INSTALL: "1",
        npm_config_cache: npmCache
      }
    }
  );
  fs.writeFileSync(packJson, packed.stdout, "utf8");
  const packResult = JSON.parse(packed.stdout);
  if (!Array.isArray(packResult) || packResult.length !== 1) {
    throw new Error("npm pack did not produce exactly one package.");
  }

  run(process.execPath, [".github/scripts/verify-npm-package.mjs", packJson]);
  run(process.execPath, [".github/scripts/verify-package-artifact.mjs", dist, "--write-hash"]);
  run(process.execPath, [".github/scripts/verify-package-artifact.mjs", dist]);

  const tarball = path.join(dist, packResult[0].filename);
  run(process.execPath, [".github/scripts/security-scan.mjs", "package", tarball]);
  run(process.execPath, [
    ".github/scripts/smoke-npm-package.mjs",
    "--tarball", tarball,
    "--workspace", path.join(temporaryRoot, "smoke"),
    "--codex-home", path.join(temporaryRoot, "default-codex-home"),
    "--with-hooks"
  ]);

  console.log("Context Guard CD rehearsal passed: exact package, digest, global install, npx install, hooks, and init.");
  passed = true;
} finally {
  const resolvedTemporaryRoot = path.resolve(temporaryRoot);
  const resolvedSystemTemp = path.resolve(os.tmpdir());
  if (passed && resolvedTemporaryRoot.startsWith(`${resolvedSystemTemp}${path.sep}`)) {
    fs.rmSync(resolvedTemporaryRoot, { recursive: true, force: true });
  } else {
    console.error(`Preserved failed CD rehearsal artifacts: ${resolvedTemporaryRoot}`);
  }
}
