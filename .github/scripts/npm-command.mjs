import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export function npmInvocation() {
  if (process.platform !== "win32") {
    return { command: "npm", args: [] };
  }

  let npmBinDirectory = "";
  if (process.env.npm_execpath) {
    npmBinDirectory = path.dirname(process.env.npm_execpath);
  } else {
    const lookup = spawnSync("where.exe", ["npm.cmd"], {
      encoding: "utf8",
      windowsHide: true
    });
    if (lookup.error || lookup.status !== 0) {
      throw new Error("Unable to locate npm.cmd on Windows.");
    }
    const npmCommand = lookup.stdout.split(/\r?\n/).find(Boolean);
    const npmRoot = path.dirname(npmCommand);
    npmBinDirectory = path.join(npmRoot, "node_modules", "npm", "bin");
  }

  const cli = path.join(npmBinDirectory, "npm-cli.js");
  if (!fs.existsSync(cli)) {
    throw new Error(`Unable to locate the npm CLI: ${cli}`);
  }
  return { command: process.execPath, args: [cli] };
}
