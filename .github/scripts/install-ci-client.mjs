#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createHash } from "node:crypto";
import { npmInvocation } from "./npm-command.mjs";
import { isolatedEnvironment, run } from "./client-protocol.mjs";

const [client, target] = process.argv.slice(2);
const versions = JSON.parse(fs.readFileSync(new URL("../client-versions.json", import.meta.url), "utf8"));
assert.ok(Object.hasOwn(versions, client) && target, "Usage: install-ci-client.mjs <codex|cursor|claude> <tools-directory>");
const directory = path.resolve(target);
fs.mkdirSync(directory, { recursive: true });
const env = isolatedEnvironment(path.join(directory, "installer"));
const version = versions[client];
let command, args, archiveSha256;
if (client === "cursor") {
  assert.ok(["win32", "linux", "darwin"].includes(process.platform));
  const platform = { win32: "windows", linux: "linux", darwin: "darwin" }[process.platform];
  const filename = process.platform === "win32" ? "agent-cli-package.zip" : "agent-cli-package.tar.gz";
  const archive = path.join(directory, filename);
  const url = `https://downloads.cursor.com/lab/${version}/${platform}/${process.arch}/${filename}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  assert.ok(response.ok, `Cursor download failed: ${response.status} (${url})`);
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(archive));
  archiveSha256 = createHash("sha256").update(fs.readFileSync(archive)).digest("hex");
  if (process.platform === "win32") {
    // Paths are passed through an isolated child environment, never interpolated
    // into PowerShell source. The personal installer and PATH are not modified.
    await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      "Expand-Archive -LiteralPath $env:CG_ARCHIVE -DestinationPath $env:CG_DEST -Force"],
    { cwd: directory, env: { ...env, CG_ARCHIVE: archive, CG_DEST: directory }, timeout: 180_000 });
  } else {
    await run("tar", ["-xzf", archive, "-C", directory], { cwd: directory, env, timeout: 180_000 });
  }
  // This is the same bundled Node + entry point used by the official launcher.
  command = path.join(directory, "dist-package", process.platform === "win32" ? "node.exe" : "node");
  args = [path.join(directory, "dist-package", "index.js")];
} else {
  const name = client === "codex" ? "@openai/codex" : "@anthropic-ai/claude-code";
  const npm = npmInvocation();
  await run(npm.command, [...npm.args, "install", "--prefix", directory, "--ignore-scripts", "--no-audit", "--no-fund", `${name}@${version}`],
    { cwd: directory, env, timeout: 180_000 });
  const packageRoot = path.join(directory, "node_modules", ...name.split("/"));
  if (client === "claude") {
    // The pinned package's postinstall replaces its placeholder with the
    // optional native binary, within this disposable tool installation only.
    await run(process.execPath, [path.join(packageRoot, "install.cjs")], { cwd: packageRoot, env });
  }
  const metadata = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
  const entry = path.resolve(packageRoot, metadata.bin[client]);
  command = /\.(?:c|m)?js$/.test(entry) ? process.execPath : entry;
  args = command === process.execPath ? [entry] : [];
}
assert.ok(fs.existsSync(command) && (!args.length || fs.existsSync(args[0])), `Missing ${client} executable`);
const actual = (await run(command, [...args, "--version"], { cwd: directory, env })).stdout.trim();
assert.ok(actual.includes(version), `Expected ${client} ${version}, got ${actual}`);
fs.writeFileSync(path.join(directory, "command.json"), `${JSON.stringify({ client, version, actual, command, args, archiveSha256 }, null, 2)}\n`);
console.log(`Installed isolated ${client}: ${actual}`);
