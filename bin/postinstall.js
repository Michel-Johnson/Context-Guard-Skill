#!/usr/bin/env node
"use strict";

const path = require("path");
const { spawnSync } = require("child_process");

const isGlobalInstall = String(process.env.npm_config_global || "").toLowerCase() === "true";
const autoInstall = process.env.CONTEXT_GUARD_AUTO_INSTALL === "1";
const skipInstall = process.env.CONTEXT_GUARD_SKIP_AUTO_INSTALL === "1";

if (skipInstall) {
  process.exit(0);
}

if (!isGlobalInstall && !autoInstall) {
  console.log("[context-guard-skill] package installed. Run `npx @michelj/context-guard install` to install the Codex skill.");
  process.exit(0);
}

const cli = path.join(__dirname, "context-guard-skill.js");
const result = spawnSync(process.execPath, [cli, "install"], { stdio: "inherit" });

if (result.error) {
  console.warn(`[context-guard-skill] auto install skipped: ${result.error.message}`);
  process.exit(0);
}

process.exit(result.status === null ? 0 : result.status);
