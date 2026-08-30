#!/usr/bin/env node

import fs from "node:fs";
import { packedFiles } from "./package-contract.mjs";

const expectedFiles = [...packedFiles].sort();

const [packJsonPath] = process.argv.slice(2);
if (!packJsonPath) {
  throw new Error("Usage: verify-npm-package.mjs <npm-pack.json>");
}

const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const packResult = JSON.parse(fs.readFileSync(packJsonPath, "utf8"));
if (!Array.isArray(packResult) || packResult.length !== 1) {
  throw new Error(`Expected one packed package, received ${Array.isArray(packResult) ? packResult.length : "invalid JSON"}.`);
}

const [packedPackage] = packResult;
if (packedPackage.name !== packageJson.name || packedPackage.version !== packageJson.version) {
  throw new Error(
    `Packed identity mismatch: ${packedPackage.name}@${packedPackage.version} != ${packageJson.name}@${packageJson.version}`
  );
}

const actualFiles = packedPackage.files.map(({ path }) => path).sort();
const missingFiles = expectedFiles.filter((file) => !actualFiles.includes(file));
const unexpectedFiles = actualFiles.filter((file) => !expectedFiles.includes(file));
if (missingFiles.length || unexpectedFiles.length) {
  const details = [
    missingFiles.length ? `Missing required files:\n- ${missingFiles.join("\n- ")}` : "",
    unexpectedFiles.length ? `Unexpected files:\n- ${unexpectedFiles.join("\n- ")}` : ""
  ].filter(Boolean);
  throw new Error(`npm package content contract failed.\n${details.join("\n")}`);
}

const cliPath = packageJson.bin?.["context-guard"];
if (cliPath !== "bin/context-guard-skill.js" || !actualFiles.includes(cliPath)) {
  throw new Error(`The context-guard CLI entry is invalid or missing: ${cliPath}`);
}

console.log(`Verified npm package contract: ${actualFiles.length} exact files.`);
