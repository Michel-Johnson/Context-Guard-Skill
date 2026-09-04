import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

export const clients = ["codex", "cursor", "claude"];
export const requiredFiles = [
  "index.md", "FIND.md", "architecture.md", "preferences.json",
  "sessions.jsonl", "user-messages.md", "bugs-index.json", "map.json"
];
export const requiredDirectories = ["tasks", "bugs", "fixes", "cards", "sessions", "private"];

export function clientInvocation(client, prompt, sessionId = "", model = "") {
  assert.ok(clients.includes(client), `Unknown client: ${client}`);
  const modelArgs = model ? ["--model", model] : [];
  if (client === "codex") {
    // Keep installed config and normal hook trust checks. Never bypass hook trust.
    const execArgs = ["exec", "--sandbox", "workspace-write", "-c", "approval_policy=\"never\"", "-c", "features.multi_agent=false"];
    const args = sessionId
      ? [...execArgs, "resume", ...modelArgs, "--json", "--skip-git-repo-check", sessionId, prompt]
      : [...execArgs, ...modelArgs, "--json", "--skip-git-repo-check", prompt];
    return { command: "codex", args };
  }
  // Put the positional prompt before variadic permission flags (Claude).
  const args = ["-p", prompt, "--output-format", "stream-json", ...modelArgs];
  if (sessionId) args.push("--resume", sessionId);
  if (client === "cursor") {
    // This workspace is created by the harness; this is not hook-trust bypass.
    args.push("--trust");
  } else {
    // --bare would disable the very skills/hooks we are testing.
    args.push("--verbose", "--max-turns", "8", "--max-budget-usd", "1",
      "--allowedTools", "Read,Glob,Grep,Bash(context-guard *)",
      "--disallowedTools", "Agent,Task");
  }
  return { command: client === "cursor" ? "agent" : "claude", args };
}
export function parseClientOutput(client, output) {
  assert.ok(clients.includes(client));
  const events = output.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  assert.ok(events.length, "Client returned no JSON events");
  assert.ok(!events.some((event) => event.type === "error" || event.type === "turn.failed" || event.is_error === true),
    "Client reported an error; a zero process exit alone is not success");
  if (client === "codex") {
    const start = events.find((event) => event.type === "thread.started");
    assert.ok(start?.thread_id, "Codex did not emit a thread ID");
    assert.ok(events.some((event) => event.type === "turn.completed"), "Codex turn did not complete");
    const messages = events.filter((event) => event.type === "item.completed" && event.item?.type === "agent_message");
    const text = messages.map((event) => event.item.text || "").join("\n");
    assert.ok(text.trim(), "Codex did not produce an assistant reply");
    return { sessionId: start.thread_id, text };
  }
  const result = events.filter((event) => event.type === "result").at(-1);
  assert.ok(result && result.subtype === "success" && result.session_id,
    `${client} did not emit a successful result with a session ID`);
  assert.equal(typeof result.result, "string", "Client result has no assistant text");
  assert.ok(result.result.trim(), "Client returned an empty reply");
  return { sessionId: result.session_id, text: result.result };
}

export function asksLanguage(text) {
  return /中文|Chinese/i.test(text) && /English|英文|英语/i.test(text)
    && /[?？]|选择|选用|哪种|偏好|choose|prefer|which|would you like/i.test(text);
}

export function runtimeEnvironment(source) {
  // Package installation and assertions never inherit provider/GitHub credentials,
  // custom skill targets, local client homes, NODE_OPTIONS, or project-root hints.
  const keep = ["PATH", "Path", "HOME", "USERPROFILE", "SYSTEMROOT", "SystemRoot",
    "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL", "SSL_CERT_FILE", "SSL_CERT_DIR"];
  const env = Object.fromEntries(keep.filter((key) => source[key]).map((key) => [key, source[key]]));
  return { ...env, CI: "true", CONTEXT_GUARD_HEADLESS: "1", PYTHONDONTWRITEBYTECODE: "1" };
}

export function redact(text, secrets = []) {
  let result = String(text);
  for (const secret of secrets.filter(Boolean)) result = result.split(secret).join("[REDACTED]");
  return result.replace(/\b(?:sk-[A-Za-z0-9_-]{10,}|gh[pousr]_[A-Za-z0-9_]{10,})\b/g, "[REDACTED]");
}

export function assertInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  assert.ok(relative && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative),
    `Path is not inside the disposable workspace: ${target}`);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function sessionFile(ctx, sessionId) {
  const safe = sessionId.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-._]+|[-._]+$/g, "").slice(0, 120);
  assert.ok(safe, "Empty session identifier");
  return path.join(ctx, "sessions", `${safe}.md`);
}

export async function inspectPhase({ project, client, reply, phase, marker, firstSessionId, previousWorkbench }) {
  const ctx = path.join(project, ".codex", "context");
  for (const file of requiredFiles) assert.ok(fs.existsSync(path.join(ctx, file)), `Missing generated file: ${file}`);
  for (const directory of requiredDirectories) assert.ok(fs.statSync(path.join(ctx, directory)).isDirectory(), `Missing directory: ${directory}`);
  const events = fs.readFileSync(path.join(ctx, "sessions.jsonl"), "utf8").trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
  for (const event of ["session-start", "user-prompt-submit", "stop"]) {
    assert.ok(events.some((item) => item.platform === client && item.session_id === reply.sessionId && item.event === event),
      `No native ${client} ${event} evidence for session ${reply.sessionId}; check client hook loading/trust`);
  }
  assert.ok(fs.existsSync(sessionFile(ctx, reply.sessionId)), "Native session directory entry is missing");
  assert.ok(fs.readFileSync(path.join(ctx, "user-messages.md"), "utf8").includes(marker), "User message was not recorded by its hook");
  const language = readJson(path.join(ctx, "preferences.json")).record_language;
  if (phase === "first") {
    assert.equal(language, "unset", "Language was inferred before the user selected it");
    assert.ok(asksLanguage(reply.text), "The real assistant did not ask the user to choose 中文 / English");
  } else {
    assert.equal(language, "zh", "The user's language choice was not persisted");
  }
  if (phase === "new-session") {
    assert.notEqual(reply.sessionId, firstSessionId, "The new-session check accidentally resumed the first session");
    assert.ok(fs.existsSync(sessionFile(ctx, firstSessionId)), "Starting a session removed the previous session record");
    assert.ok(!asksLanguage(reply.text), "A later session asked for language again");
  }
  const workbench = readJson(path.join(ctx, "private", "workbench.json"));
  const url = new URL(workbench.url);
  assert.equal(url.protocol, "http:");
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "Workbench URL must be loopback");
  const healthResponse = await fetch(new URL("/__context_guard/health", url), { signal: AbortSignal.timeout(5000) });
  assert.equal(healthResponse.status, 200, "Workbench health failed");
  const health = await healthResponse.json();
  assert.equal(path.resolve(health.root), path.resolve(project), "Workbench serves the wrong project");
  assert.equal(health.pid, workbench.pid, "Workbench state points at the wrong process");
  const page = await fetch(url, { signal: AbortSignal.timeout(5000) });
  assert.equal(page.status, 200, "Workbench page did not load");
  assert.match(await page.text(), /Context Guard/);
  if (previousWorkbench) {
    assert.equal(workbench.pid, previousWorkbench.pid, "A follow-up session started a duplicate workbench");
    assert.equal(workbench.url, previousWorkbench.url);
  }
  if (phase === "bad-case") {
    const index = readJson(path.join(ctx, "bugs-index.json"));
    const ids = Object.keys(index).filter((id) => /^B\d+$/.test(id));
    const recorded = ids.find((id) => {
      const file = path.join(ctx, "bugs", `${id}.md`);
      return fs.existsSync(file) && fs.readFileSync(file, "utf8").includes(marker);
    });
    assert.ok(recorded, "The reported bad case was not written to an indexed bug card");
    const map = readJson(path.join(ctx, "map.json"));
    const hasBug = (node) => node && ((node.bugs || []).some((item) => item.id === recorded)
      || (node.children || []).some(hasBug));
    assert.ok(hasBug(map.root) || (map.unassigned_bugs || []).some((item) => item.id === recorded),
      "Indexed bad case is not linked to the map or its unassigned list");
  }
  return workbench;
}

