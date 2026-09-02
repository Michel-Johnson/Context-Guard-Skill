import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import readline from "node:readline";

function terminateTree(child, env) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    // Only terminate the process tree spawned by this test, never by image name.
    const killer = spawn("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], { env, windowsHide: true, stdio: "ignore" });
    const fallback = setTimeout(() => child.kill("SIGKILL"), 1000);
    const finish = () => { clearTimeout(fallback); child.kill("SIGKILL"); };
    killer.on("error", finish);
    killer.on("close", finish);
  } else {
    try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill(); }
  }
}

export function isolatedEnvironment(root, source = process.env) {
  const keep = ["PATH", "Path", "SYSTEMROOT", "SystemRoot", "COMSPEC", "ComSpec", "PATHEXT", "WINDIR", "LANG", "LC_ALL", "SSL_CERT_FILE", "SSL_CERT_DIR"];
  const env = Object.fromEntries(keep.filter((key) => source[key]).map((key) => [key, source[key]]));
  const home = path.join(root, "home");
  const temp = path.join(root, "tmp");
  for (const dir of [home, temp, path.join(home, ".codex"), path.join(home, ".cursor"), path.join(home, ".claude"), path.join(home, "AppData", "Roaming"), path.join(home, "AppData", "Local")]) fs.mkdirSync(dir, { recursive: true });
  return { ...env, HOME: home, USERPROFILE: home, TEMP: temp, TMP: temp, TMPDIR: temp,
    APPDATA: path.join(home, "AppData", "Roaming"), LOCALAPPDATA: path.join(home, "AppData", "Local"),
    XDG_CONFIG_HOME: path.join(home, ".config"), XDG_DATA_HOME: path.join(home, ".local", "share"), XDG_CACHE_HOME: path.join(home, ".cache"),
    CODEX_HOME: path.join(home, ".codex"), CURSOR_HOME: path.join(home, ".cursor"),
    CLAUDE_HOME: path.join(home, ".claude"), CLAUDE_CONFIG_DIR: path.join(home, ".claude"),
    CI: "true", CONTEXT_GUARD_HEADLESS: "1", PYTHONDONTWRITEBYTECODE: "1", PYTHONIOENCODING: "utf-8",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", DISABLE_AUTOUPDATER: "1", OTEL_SDK_DISABLED: "true",
    npm_config_cache: path.join(root, "npm-cache") };
}

export function run(command, args, { cwd, env, timeout = 60_000, input = "" } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, windowsHide: true, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "", failure;
    const stop = (message) => { failure ||= new Error(message); terminateTree(child, env); };
    const timer = setTimeout(() => stop(`Process timed out after ${timeout} ms`), timeout);
    child.stdout.setEncoding("utf8").on("data", (data) => { stdout += data; if (stdout.length + stderr.length > 8_000_000) stop("Process output limit exceeded"); });
    child.stderr.setEncoding("utf8").on("data", (data) => { stderr += data; if (stdout.length + stderr.length > 8_000_000) stop("Process output limit exceeded"); });
    child.on("error", (error) => { failure = error; });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (failure || code !== 0) reject(Object.assign(failure || new Error(`Process exited with ${code}`), { stdout, stderr }));
      else resolve({ stdout, stderr });
    });
  });
}

// Deliberately excludes turn/start, session/prompt and authenticate: no model
// requests, no personal credentials and no interactive login can be sent here.
export const allowedMethods = new Set(["initialize", "initialized", "skills/list", "hooks/list", "session/new", "session/load"]);

export function rpcClient(command, args, { cwd, env, timeout = 30_000 } = {}) {
  const child = spawn(command, args, { cwd, env, windowsHide: true, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map();
  const messages = [];
  let nextId = 1, stderr = "", closed = false, outputSize = 0;
  const exited = new Promise((resolve) => child.once("close", resolve));
  child.stderr.setEncoding("utf8").on("data", (data) => { stderr += data; });
  child.stdin.on("error", () => {});
  const fail = (error) => {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error); }
    pending.clear();
  };
  child.on("error", fail);
  child.on("close", (code) => { closed = true; fail(new Error(`RPC process exited with ${code}: ${stderr.slice(-2000)}`)); });
  const lines = readline.createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    outputSize += line.length;
    if (outputSize + stderr.length > 8_000_000) { fail(new Error("RPC output limit exceeded")); terminateTree(child, env); return; }
    let message;
    try { message = JSON.parse(line); } catch { fail(new Error(`Invalid RPC JSON: ${line.slice(0, 200)}`)); return; }
    messages.push(message);
    const request = pending.get(message.id);
    if (request && !message.method) {
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(Object.assign(new Error(message.error.message), { rpcError: message.error }));
      else request.resolve(message.result);
    } else if (message.id !== undefined && message.method) {
      // Inspection never approves tools, authentication, writes, or subagents.
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Inspection client does not execute tools" } })}\n`);
    }
  });
  return {
    messages,
    get stderr() { return stderr; },
    request(method, params = {}) {
      assert.ok(allowedMethods.has(method), `Forbidden RPC method: ${method}`);
      assert.ok(!closed, "RPC process is closed");
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`RPC timed out: ${method}`)); }, timeout);
        pending.set(id, { resolve, reject, timer });
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      });
    },
    notify(method, params = {}) {
      assert.ok(allowedMethods.has(method), `Forbidden RPC method: ${method}`);
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
    },
    async close() {
      child.stdin.end();
      const timer = setTimeout(() => terminateTree(child, env), 2000);
      let deadline;
      try {
        await Promise.race([exited, new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error("RPC process did not shut down")), 10_000); })]);
      } finally {
        clearTimeout(timer);
        clearTimeout(deadline);
        lines.close();
        child.stdout.destroy(); child.stderr.destroy(); child.stdin.destroy();
        fail(new Error("RPC inspection complete"));
      }
    }
  };
}
