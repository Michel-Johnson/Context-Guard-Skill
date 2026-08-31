import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const version = "8.30.1";
const platforms = {
  "win32-x64": ["windows_x64.zip", "d29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e"],
  "win32-arm64": ["windows_arm64.zip", "b95f5e4f5c425cedca7ee203d9afd29597e692c4924a12ed42f970537c72cc0f"],
  "linux-x64": ["linux_x64.tar.gz", "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb"],
  "linux-arm64": ["linux_arm64.tar.gz", "e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080"],
  "darwin-x64": ["darwin_x64.tar.gz", "dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709"],
  "darwin-arm64": ["darwin_arm64.tar.gz", "b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5"]
};
export const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");
export const toolDirectory = path.join(toolRoot, ".security-tools", `gitleaks-${version}-${process.platform}-${process.arch}`);
const executable = path.join(toolDirectory, process.platform === "win32" ? "gitleaks.exe" : "gitleaks");

export function getScanner() {
  try {
    const metadata = JSON.parse(fs.readFileSync(path.join(toolDirectory, "verified.json"), "utf8"));
    if (metadata.version !== version || sha256(fs.readFileSync(executable)) !== metadata.binarySha256) throw new Error();
    return executable;
  } catch {
    throw new Error("Security scanner missing or changed. Run npm run security:setup first.");
  }
}

export async function installScanner() {
  const platform = platforms[`${process.platform}-${process.arch}`];
  if (!platform) throw new Error("Unsupported security scanner platform.");
  try { getScanner(); return; } catch { /* Reinstall only through the pinned archive. */ }
  fs.mkdirSync(toolDirectory, { recursive: true });
  const name = `gitleaks_${version}_${platform[0]}`;
  const response = await fetch(`https://github.com/gitleaks/gitleaks/releases/download/v${version}/${name}`, {
    signal: AbortSignal.timeout(60_000)
  });
  if (!response.ok) throw new Error("Security scanner download failed.");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (sha256(bytes) !== platform[1]) throw new Error("Security scanner archive checksum mismatch.");
  const archive = path.join(toolDirectory, name);
  fs.writeFileSync(archive, bytes);
  const result = spawnSync("tar", ["-xf", archive, "-C", toolDirectory, path.basename(executable)], {
    encoding: "utf8", windowsHide: true, timeout: 30_000
  });
  if (result.error || result.status !== 0) throw new Error("Cannot extract the verified security scanner.");
  fs.chmodSync(executable, 0o755);
  fs.writeFileSync(path.join(toolDirectory, "verified.json"), JSON.stringify({
    version, archiveSha256: platform[1], binarySha256: sha256(fs.readFileSync(executable))
  }));
  getScanner();
}

export function pythonInvocation() {
  const candidates = process.platform === "win32" ? [["python", []], ["py", ["-3"]], ["python3", []]] : [["python3", []], ["python", []]];
  for (const [command, prefix] of candidates) {
    const result = spawnSync(command, [...prefix, "-c", "import sys; assert sys.version_info >= (3, 9)"], {
      stdio: "pipe", windowsHide: true, timeout: 5000
    });
    if (!result.error && result.status === 0) return { command, prefix };
  }
  throw new Error("Python >= 3.9 is required for the existing branch guard and safe archive checks.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  installScanner().then(() => console.log(`Verified local Gitleaks ${version}. No global installation.`)).catch(() => {
    console.error("Security scanner setup failed; no checks were skipped.");
    process.exitCode = 2;
  });
}
