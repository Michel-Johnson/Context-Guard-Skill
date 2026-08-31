import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { getScanner, toolRoot, pythonInvocation } from "./security-tool.mjs";
import { run } from "./security-scan.mjs";
import { command, git, repositoryRoot, SecurityError } from "./security-lib.mjs";

try {
  const mode = process.argv[2];
  const root = repositoryRoot();
  const hooks = path.join(toolRoot, ".githooks");
  if (["install", "status"].includes(mode)) {
    const lookup = spawnSync("git", ["config", "--get", "core.hooksPath"], { cwd: root, encoding: "utf8", windowsHide: true });
    if (![0, 1].includes(lookup.status)) throw new SecurityError("Cannot read hooks configuration.");
    const previous = lookup.stdout.trim();
    const active = previous ? path.resolve(root, previous) : null;
    if (mode === "status") {
      getScanner();
      if (active !== hooks) throw new SecurityError("Security hooks are not enabled for this repository. Run npm run hooks:install.");
      for (const hook of ["pre-commit", "pre-push"]) if (!fs.existsSync(path.join(hooks, hook))) throw new SecurityError("A security hook is missing.");
      console.log("Security hooks and pinned scanner are enabled.");
    } else {
      getScanner();
      if (active && active !== hooks && active !== path.join(root, ".githooks")) throw new SecurityError("Custom hooksPath exists; refusing to replace it. Integrate security checks explicitly.");
      if (!active) {
        const common = path.resolve(root, git(root, ["rev-parse", "--git-common-dir"]).trim());
        for (const hook of ["pre-commit", "pre-push"]) {
          if (fs.existsSync(path.join(common, "hooks", hook))) throw new SecurityError("An existing user hook must be integrated explicitly; nothing was replaced.");
        }
      }
      // An absolute path also protects sibling worktrees on older branches.
      git(root, ["config", "--local", "core.hooksPath", hooks.replaceAll("\\", "/")]);
      for (const hook of ["pre-commit", "pre-push"]) fs.chmodSync(path.join(hooks, hook), 0o755);
      console.log("Repository-local security hooks enabled; no global Git settings changed.");
    }
  } else {
    const result = run(mode, [], root);
    if (mode === "staged") {
      const python = pythonInvocation();
      command(python.command, [...python.prefix, path.join(toolRoot, "scripts/branch_guard.py")], { cwd: root });
    }
    console.log(JSON.stringify({ security: "passed", mode, ...result }));
  }
} catch (error) {
  console.error(JSON.stringify({ security: "blocked", message: error instanceof SecurityError ? error.message : "Security hook failed; raw output withheld.",
    findings: error instanceof SecurityError ? error.findings : [] }));
  process.exitCode = 1;
}
