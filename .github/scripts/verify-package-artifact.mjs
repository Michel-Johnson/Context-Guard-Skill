#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const directory = path.resolve(args.find((arg) => !arg.startsWith("--")) || "dist");
const writeHash = args.includes("--write-hash");

if (!fs.existsSync(directory)) {
  throw new Error(`Package artifact directory is missing: ${directory}`);
}

const tarballs = fs.readdirSync(directory)
  .filter((name) => name.endsWith(".tgz") && fs.statSync(path.join(directory, name)).isFile());
if (tarballs.length !== 1) {
  throw new Error(`Expected exactly one package tarball in ${directory}, found ${tarballs.length}.`);
}

const tarball = path.join(directory, tarballs[0]);
const hashPath = path.join(directory, "package.sha256");
const digest = crypto.createHash("sha256").update(fs.readFileSync(tarball)).digest("hex");

if (writeHash) {
  fs.writeFileSync(hashPath, `${digest}\n`);
} else {
  if (!fs.existsSync(hashPath)) {
    throw new Error(`Package hash is missing: ${hashPath}`);
  }
  const expected = fs.readFileSync(hashPath, "utf8").trim().toLowerCase();
  if (digest !== expected) {
    throw new Error(`Package digest mismatch: ${digest} != ${expected}`);
  }
}

if (process.env.GITHUB_ENV) {
  fs.appendFileSync(process.env.GITHUB_ENV, `PACKAGE_TARBALL=${tarball}\n`);
}

console.log(`${writeHash ? "Recorded" : "Verified"} package SHA-256: ${digest}`);
console.log(`Package tarball: ${tarball}`);
