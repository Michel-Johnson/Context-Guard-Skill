import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SecurityError, git, repositoryRoot, commit, isZero, snapshot, history, initialBase, scanPackage, scan } from "./security-lib.mjs";

export function run(mode, args = [], root = repositoryRoot()) {
  if (mode === "staged") return snapshot(root);
  if (mode === "tree") return snapshot(root, commit(root, args[0] || git(root, ["rev-parse", "HEAD"]).trim()));
  if (mode === "package") {
    if (!args[0]) throw new SecurityError("Provide the exact package tarball.");
    return scanPackage(args[0]);
  }
  if (mode === "audit") {
    if (git(root, ["rev-parse", "--is-shallow-repository"]).trim() !== "false") throw new SecurityError("Audit requires full history.");
    const refs = git(root, ["for-each-ref", "--format=%(refname) %(objectname)", "refs/heads", "refs/remotes", "refs/tags"]).trim().split(/\r?\n/);
    const commits = Number(git(root, ["rev-list", "--all", "--count"]).trim());
    scan("git", root, ["--log-opts=--all --full-history -m"]);
    return { refs, commits, findings: 0 };
  }
  if (mode === "push") {
    const lines = fs.readFileSync(0, "utf8").trim().split(/\r?\n/).filter(Boolean);
    let commits = 0;
    for (const line of lines) {
      const fields = line.split(/\s+/);
      if (fields.length !== 4) throw new SecurityError("Invalid pre-push input.");
      const [, local, , remote] = fields;
      if (isZero(local)) continue; // Deleting a ref uploads no new content.
      const head = commit(root, local);
      snapshot(root, head);
      const base = isZero(remote) ? initialBase(root, head) : commit(root, remote);
      commits += history(root, head, base).commits;
    }
    return { updates: lines.length, commits };
  }
  if (mode === "ci") {
    if (!process.env.GITHUB_EVENT_PATH) throw new SecurityError("Missing GitHub event payload.");
    const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
    const checkout = commit(root, process.env.GITHUB_SHA);
    snapshot(root, checkout);
    if (process.env.GITHUB_EVENT_NAME === "pull_request") {
      return history(root, event.pull_request?.head?.sha, event.pull_request?.base?.sha);
    }
    if (process.env.GITHUB_EVENT_NAME !== "push") throw new SecurityError("Unsupported CI security event.");
    return history(root, checkout, !event.before || isZero(event.before) ? initialBase(root, checkout) : event.before);
  }
  throw new SecurityError("Unknown security scan mode.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [mode, ...args] = process.argv.slice(2);
    console.log(JSON.stringify({ security: "passed", mode, ...run(mode, args) }));
  } catch (error) {
    console.error(JSON.stringify({ security: "blocked", message: error instanceof SecurityError ? error.message : "Security check failed; raw output withheld.",
      findings: error instanceof SecurityError ? error.findings : [] }));
    process.exitCode = 1;
  }
}
