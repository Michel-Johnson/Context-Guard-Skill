import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { getScanner, toolRoot, sha256, pythonInvocation } from "./security-tool.mjs";
import { packedFiles } from "./package-contract.mjs";

export class SecurityError extends Error {
  constructor(message, findings = []) { super(message); this.findings = findings; }
}

export function command(program, args, options = {}) {
  const result = spawnSync(program, args, { encoding: "utf8", windowsHide: true, timeout: 120_000, maxBuffer: 64 * 1024 * 1024, ...options });
  if (result.error || result.status !== 0) throw new SecurityError("A required security operation failed; output withheld to protect secrets.");
  return result.stdout;
}
export const git = (root, args) => command("git", args, { cwd: root });
export const repositoryRoot = (root = process.cwd()) => git(root, ["rev-parse", "--show-toplevel"]).trim();
export const isZero = (value) => /^0{40,64}$/.test(value || "");
export function commit(root, value) {
  if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/i.test(value || "")) throw new SecurityError("Invalid or missing commit ID.");
  return git(root, ["rev-parse", "--verify", `${value}^{commit}`]).trim();
}
export function safePath(name) {
  return typeof name === "string" && name.length > 0 && !/[\\:\x00-\x1f\x7f]/.test(name) && !name.startsWith("/") &&
    name.split("/").every(part => part && part !== "." && part !== ".." && part.toLowerCase() !== ".git");
}
export function forbiddenPath(name, packageMode = false) {
  if (!safePath(name)) return true;
  const parts = name.toLowerCase().split("/");
  const leaf = parts.at(-1);
  if (parts.some(p => [".codex", "node_modules", "output", ".security-tools", "__pycache__", ".pytest_cache", "coverage"].includes(p))) return true;
  if (leaf === ".npmrc" || /^(?:id_rsa|id_dsa|id_ecdsa|id_ed25519)$/.test(leaf) || /\.(?:key|p12|pfx|log)$/.test(leaf)) return true;
  if ((leaf === ".env" || leaf.startsWith(".env.")) && ![".env.example", ".env.sample", ".env.template"].includes(leaf)) return true;
  if (/^(?:credentials|secrets?)(?:\.local)?\.(?:json|ya?ml|toml)$/.test(leaf)) return true;
  return packageMode && parts.some(p => [".github", ".githooks", "tests", "fixtures", ".claude", ".cursor", ".agents"].includes(p));
}
function location(file, rule = "forbidden-path", line = 0) {
  // File paths themselves can contain sensitive values. Never echo raw scanner fields.
  return { rule: /^[a-z0-9_-]{1,100}$/i.test(rule) ? rule : "secret", fileId: sha256(String(file)).slice(0, 16), line: Number.isInteger(line) ? line : 0 };
}
export function checkPaths(names, packageMode = false) {
  const findings = names.filter(name => forbiddenPath(name, packageMode)).map(name => location(name));
  if (findings.length) throw new SecurityError("Forbidden local/private paths detected.", findings);
}
export function temporary(action) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "context-guard-security-"));
  try { return action(directory); }
  finally {
    // Only remove the exact directory created by mkdtemp, never a caller-provided path.
    if (path.dirname(directory) === path.resolve(os.tmpdir()) && path.basename(directory).startsWith("context-guard-security-")) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
}
export function scannerOutcome(result, reportText, target) {
  if (result.error || ![0, 10].includes(result.status) || reportText === null) throw new SecurityError("Secret scanner unavailable, interrupted, or failed; scan did not pass.");
  if (result.status === 0 && (result.stderr.trim() || result.stdout.trim())) throw new SecurityError("Scanner emitted unexpected diagnostics; refusing a possibly incomplete scan.");
  let rows;
  try { rows = JSON.parse(reportText); } catch { throw new SecurityError("Invalid scanner report; scan did not pass."); }
  if (!Array.isArray(rows)) throw new SecurityError("Invalid scanner report; scan did not pass.");
  const findings = rows.map(row => {
    const file = String(row.File || "");
    const relative = (path.isAbsolute(file) ? path.relative(target, file) : file).replaceAll("\\", "/");
    return { ...location(relative, row.RuleID, row.StartLine),
      ...(typeof row.Commit === "string" && /^[a-f0-9]{40,64}$/.test(row.Commit) ? { commit: row.Commit } : {}) };
  });
  if (result.status !== 0 || findings.length) throw new SecurityError("Potential secrets detected; remove or rotate them before continuing.", findings);
  return { findings: 0 };
}
export function scan(mode, target, extra = [], scanner = getScanner()) {
  return temporary(directory => {
    const report = path.join(directory, "report.json");
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GITLEAKS_/i.test(key)));
    const result = spawnSync(scanner, [mode, target, ...extra,
      "--config", path.join(toolRoot, ".github/security/gitleaks.toml"),
      "--gitleaks-ignore-path", path.join(toolRoot, ".github/security/gitleaks.ignore"),
      "--ignore-gitleaks-allow", "--redact=100", "--no-banner", "--no-color", "--log-level=error",
      "--max-decode-depth=2", "--report-format=json", "--report-path", report, "--exit-code=10", "--timeout=90"
    ], { cwd: directory, env, encoding: "utf8", windowsHide: true, timeout: 100_000, maxBuffer: 16 * 1024 * 1024 });
    return scannerOutcome(result, fs.existsSync(report) ? fs.readFileSync(report, "utf8") : null, target);
  });
}

export function snapshot(root, tree = "index") {
  return temporary(directory => {
    const raw = tree === "index" ? git(root, ["ls-files", "--stage", "-z"]) : git(root, ["ls-tree", "-r", "-z", tree]);
    const entries = raw.split("\0").filter(Boolean).map(row => {
      const separator = row.indexOf("\t");
      const fields = row.slice(0, separator).split(" ");
      return { mode: fields[0], oid: fields[tree === "index" ? 1 : 2], stage: tree === "index" ? fields[2] : "0", name: row.slice(separator + 1) };
    });
    checkPaths(entries.map(entry => entry.name));
    for (const entry of entries) {
      if (!["100644", "100755"].includes(entry.mode) || entry.stage !== "0") throw new SecurityError("Unmerged entries, links, and submodules require explicit security review.");
      const destination = path.join(directory, entry.name);
      const content = command("git", ["cat-file", "blob", entry.oid], { cwd: root, encoding: null });
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, content);
    }
    scan("dir", directory);
    return { files: entries.length };
  });
}

export function history(root, head, base = null) {
  head = commit(root, head);
  if (base) base = commit(root, base);
  if (git(root, ["rev-parse", "--is-shallow-repository"]).trim() !== "false") throw new SecurityError("Complete Git history is required; fetch full history first.");
  const range = base ? `${base}..${head}` : head;
  const count = Number(git(root, ["rev-list", "--count", range]).trim());
  // This policy removes local records going forward, not existing public history.
  // The boundary never exempts secret content; it applies ONLY to historical paths.
  const legacy = "011682f7b640a7db3cf2ab1c9b6e01674266c0e4";
  const boundary = spawnSync("git", ["merge-base", "--is-ancestor", legacy, head], { cwd: root, stdio: "pipe", windowsHide: true });
  const pathRange = base ? range : boundary.status === 0 ? `${legacy}..${head}` : head;
  const changedPaths = git(root, ["log", "--format=", "--name-only", "-z", "--diff-filter=ACMR", "--full-history", "-m", pathRange])
    .split("\0").map(name => name.replace(/^[\r\n]+/, "")).filter(Boolean);
  checkPaths(changedPaths);
  if (count) scan("git", root, [`--log-opts=${range} --full-history -m`]);
  return { commits: count };
}

export function initialBase(root, head) {
  // A new branch is compared to main, not its own freshly fetched remote ref.
  const main = spawnSync("git", ["rev-parse", "--verify", "refs/remotes/origin/main^{commit}"], { cwd: root, encoding: "utf8", windowsHide: true });
  if (main.status !== 0 || main.stdout.trim() === head) return null;
  const base = spawnSync("git", ["merge-base", head, main.stdout.trim()], { cwd: root, encoding: "utf8", windowsHide: true });
  return base.status === 0 ? commit(root, base.stdout.trim()) : null;
}

export function scanPackage(tarball) {
  const absolute = path.resolve(tarball);
  const before = sha256(fs.readFileSync(absolute));
  return temporary(directory => {
    const expected = path.join(directory, "expected.json");
    const extracted = path.join(directory, "files");
    fs.writeFileSync(expected, JSON.stringify(packedFiles));
    const python = pythonInvocation();
    command(python.command, [...python.prefix, path.join(toolRoot, ".github/scripts/security-extract.py"), absolute, extracted, expected]);
    checkPaths(packedFiles, true);
    scan("dir", extracted);
    if (sha256(fs.readFileSync(absolute)) !== before) throw new SecurityError("Release package changed while being scanned.");
    return { files: packedFiles.length, sha256: before };
  });
}
