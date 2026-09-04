#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const packageName = "@michelj/context-guard";
const registry = "https://registry.npmjs.org/";
const repository = "git+https://github.com/Michel-Johnson/Context-Guard-Skill.git";
const metadataUrl = `${registry}${encodeURIComponent(packageName)}`;
export const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

function stableVersion(value) {
  assert.match(value || "", /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, `Not a stable version: ${value}`);
  return value.split(".").map(BigInt);
}

export function assertPublishable(version, metadata) {
  const target = stableVersion(version);
  assert.equal(metadata.name, packageName, "Unexpected registry package identity");
  assert.ok(metadata.versions && typeof metadata.versions === "object", "Missing registry versions");
  assert.ok(!Object.hasOwn(metadata.versions, version), `${version} is already published`);
  const latest = metadata["dist-tags"]?.latest;
  const current = stableVersion(latest);
  assert.equal(metadata.versions[latest]?.version, latest, "latest does not resolve to a published version");
  const difference = target.findIndex((part, index) => part !== current[index]);
  assert.ok(difference >= 0 && target[difference] > current[difference], `${version} must be newer than latest (${latest})`);
  return latest;
}

export function assertDigest(bytes, expected) {
  assert.match(expected, /^[0-9a-f]{64}$/, "Invalid expected SHA-256");
  const actual = sha256(bytes);
  assert.equal(actual, expected, `Package SHA-256 mismatch: downloaded ${actual}, expected ${expected}`);
  return actual;
}

function officialUrl(value) {
  const url = new URL(value);
  assert.ok(url.origin === new URL(registry).origin && !url.username && !url.password, "Only the public npm registry is allowed");
  return url.href;
}

async function download(url, fetchImpl) {
  const response = await fetchImpl(officialUrl(url), {
    redirect: "error", cache: "no-store", signal: AbortSignal.timeout(20_000),
    headers: { "cache-control": "no-cache" }
  });
  if (!response.ok) {
    const error = new Error(`npm registry HTTP ${response.status}`);
    error.retryable = response.status === 404 || response.status === 429 || response.status >= 500;
    throw error;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    assert.ok(size <= 32 * 1024 * 1024, "Registry response exceeds 32 MiB limit");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readMetadata(fetchImpl) {
  return JSON.parse((await download(metadataUrl, fetchImpl)).toString("utf8"));
}

function exactMetadata(metadata, version) {
  assert.equal(metadata.name, packageName, "Unexpected registry package identity");
  const exact = metadata.versions?.[version];
  assert.equal(exact?.name, packageName, "Published package name mismatch");
  assert.equal(exact.version, version, "Published version mismatch");
  assert.equal(exact.repository?.url, repository, "Published repository mismatch");
  officialUrl(exact.dist?.tarball);
  return exact;
}

function assertRegistryIntegrity(bytes, integrity) {
  // npm currently serves SHA-512 SRI for this package; fail closed if absent or changed.
  assert.match(integrity || "", /^sha512-[A-Za-z0-9+/]+={0,2}$/, "Missing or unsupported npm integrity");
  assert.equal(`sha512-${crypto.createHash("sha512").update(bytes).digest("base64")}`, integrity, "npm integrity mismatch");
}

export async function prepareBaseline(directory, { fetchImpl = fetch } = {}) {
  const metadata = await readMetadata(fetchImpl);
  const version = metadata["dist-tags"]?.latest;
  stableVersion(version);
  const exact = exactMetadata(metadata, version);
  const bytes = await download(exact.dist.tarball, fetchImpl);
  assertRegistryIntegrity(bytes, exact.dist.integrity);
  fs.mkdirSync(directory, { recursive: true });
  const baseline = { name: packageName, version, sha256: sha256(bytes) };
  fs.writeFileSync(path.join(directory, "previous.tgz"), bytes);
  fs.writeFileSync(path.join(directory, "release.json"), `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(`Pinned upgrade baseline: ${packageName}@${version} SHA-256 ${baseline.sha256}`);
  return baseline;
}

export async function verifyPublished(version, expected, {
  fetchImpl = fetch, attempts = 18,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  receipt = {}
} = {}) {
  stableVersion(version);
  assert.match(expected, /^[0-9a-f]{64}$/);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const metadata = await readMetadata(fetchImpl);
      assert.equal(metadata.name, packageName, "Unexpected registry package identity");
      receipt.latest = metadata["dist-tags"]?.latest || "unavailable";
      if (!metadata.versions?.[version] || receipt.latest !== version) {
        const error = new Error(`${packageName}@${version} or latest is not visible yet (latest: ${receipt.latest})`);
        error.retryable = true;
        throw error;
      }
      const exact = exactMetadata(metadata, version);
      receipt.tarball = exact.dist.tarball;
      const bytes = await download(exact.dist.tarball, fetchImpl);
      receipt.actual = sha256(bytes);
      assertDigest(bytes, expected);
      assertRegistryIntegrity(bytes, exact.dist.integrity);
      return receipt;
    } catch (error) {
      const transient = error.retryable || error.name === "TimeoutError" || error.name === "TypeError";
      if (!transient || attempt === attempts) throw error;
      console.log(`Registry verification attempt ${attempt}/${attempts}: ${error.message}; retrying in 10s`);
      await sleep(10_000);
    }
  }
  throw new Error("No registry verification attempts were made");
}

export function receiptMarkdown(version, expected, receipt, { commit = process.env.GITHUB_SHA || "local", error } = {}) {
  const clean = (value) => String(value ?? "unavailable").replace(/[\r\n|`<>]/g, " ");
  return [
    "## CD | npm 发布回验凭证", "",
    error ? "❌ 发布后的回验失败。包可能已上传；不会自动回滚、删除或重新发布。" : "✅ npm 精确版本、latest、包身份和下载内容一致。",
    "", "| 检查项 | 结果 |", "| --- | --- |",
    `| npm 包 | ${packageName}@${clean(version)} |`,
    `| 源码提交 | ${clean(commit)} |`,
    `| latest | ${clean(receipt.latest)} |`,
    `| 发布前 SHA-256 | ${clean(expected)} |`,
    `| npm 下载 SHA-256 | ${clean(receipt.actual)} |`,
    "", `[在 npm 查看该版本](https://www.npmjs.com/package/${packageName}/v/${encodeURIComponent(version)})`,
    "", "此凭证验证 registry 和 tarball；随后还须通过精确版本安装及 npx latest 安装。",
    ...(error ? ["", `失败原因：${clean(error.message)}`] : []), ""
  ].join("\n");
}

async function main() {
  const [mode, directory = "dist"] = process.argv.slice(2);
  if (mode === "prepare-baseline") {
    await prepareBaseline(path.resolve(directory));
    return;
  }
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  assert.equal(pkg.name, packageName);
  if (mode === "guard") {
    const latest = assertPublishable(pkg.version, await readMetadata(fetch));
    console.log(`Publish guard passed: ${pkg.version} > latest ${latest}; version is not published`);
  } else if (mode === "verify") {
    const expected = fs.readFileSync(path.join(directory, "package.sha256"), "utf8").trim();
    const receipt = {};
    let failure;
    try {
      await verifyPublished(pkg.version, expected, { receipt });
    } catch (error) {
      failure = error;
    } finally {
      const summary = receiptMarkdown(pkg.version, expected, receipt, { error: failure });
      console.log(summary);
      if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
    }
    if (failure) throw failure;
  } else {
    throw new Error("Usage: release-checks.mjs guard | prepare-baseline <directory> | verify <dist>");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.stack); process.exitCode = 1; });
}
