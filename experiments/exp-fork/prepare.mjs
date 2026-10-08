import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';

const exec = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2), options = {};
for (let i = 0; i < argv.length; i++) {
  const key = argv[i];
  if (key === '--offline') { options.offline = true; continue; }
  if (!['--workspace', '--source-root', '--provider', '--prefix', '--family'].includes(key) || !argv[i + 1]) throw new Error('Unknown or incomplete preparation option');
  options[key.slice(2)] = argv[++i];
}
const manifest = JSON.parse(await fs.readFile(path.join(here, 'manifest.json'), 'utf8'));
if (!options.workspace || !options['source-root'] || !options.family || Boolean(options.offline) === Boolean(options.provider)) throw new Error('Provide workspace, source-root, family, and exactly one of offline/provider');
if (!['strategy', 'web', 'optimization', 'reception', 'policy', 'comparison', 'ui'].includes(options.family)) throw new Error('Unknown experiment family');
const workspace = path.resolve(options.workspace), sourceRoot = path.resolve(options['source-root']);
const git = async (cwd, args) => (await exec('git', args, { cwd, windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 })).stdout.trim();
if (await git(workspace, ['rev-parse', 'HEAD']) !== manifest.historicalProductCommit) throw new Error('Workspace must already be checked out at the exact historical product commit');
if (await git(sourceRoot, ['cat-file', '-t', manifest.pinnedCodexCommit]) !== 'commit') throw new Error('Source clone does not contain the pinned Codex commit');
const target = path.join(workspace, 'temp/learning-lab'), sourceTarget = path.join(workspace, 'temp/codex-learning-source');
await git(workspace, ['check-ignore', '--', 'temp/learning-lab']);
for (const p of [target, sourceTarget, path.join(workspace, 'temp/local-coordinator-data')]) {
  try { await fs.lstat(p); throw new Error('Refusing to overwrite existing local experiment directories'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const sourceFiles = [];
for (const entry of manifest.files) {
  if (!/^source\/[A-Za-z0-9.-]+$/.test(entry.path)) throw new Error('Invalid archive manifest path');
  const bytes = await fs.readFile(path.join(here, entry.path));
  if (createHash('sha256').update(bytes).digest('hex') !== entry.archiveSha256) throw new Error('Archive source fingerprint differs');
  sourceFiles.push({ name: path.basename(entry.path), bytes });
}
const provider = options.offline ? { baseUrl: 'https://open.bigmodel.cn/api/anthropic', model: 'glm-5.3', token: 'offline-fixture-only', maxTokens: 8192, thinking: { type: 'disabled' }, timeoutMs: 120000 }
  : JSON.parse(await fs.readFile(path.resolve(options.provider), 'utf8'));
if (!provider.baseUrl || !provider.model || !provider.token) throw new Error('Provider file lacks required fields');
const prefix = options.prefix ? JSON.parse(await fs.readFile(path.resolve(options.prefix), 'utf8')) : [];
if (!Array.isArray(prefix)) throw new Error('Prefix must be a message array');
await fs.mkdir(target, { recursive: true });
for (const entry of sourceFiles) await fs.writeFile(path.join(target, entry.name), entry.bytes, { flag: 'wx' });
await exec('git', ['clone', '--shared', '--bare', '--', sourceRoot, sourceTarget], { windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024 });
const configDirectory = path.join(workspace, 'temp/local-coordinator-data');
await fs.mkdir(configDirectory, { recursive: true });
await fs.writeFile(path.join(configDirectory, 'provider.json'), JSON.stringify(provider), { flag: 'wx', mode: 0o600 });
await fs.writeFile(path.join(configDirectory, 'local-config.json'), JSON.stringify({ adminToken: randomUUID(), browserToken: randomUUID() }), { flag: 'wx', mode: 0o600 });
const load = name => import(pathToFileURL(path.join(target, name)).href);
const [{ Experiment }, { Source }, { codexMap }, { createLearningMapTools }, { createWebSearch }] = await Promise.all([
  load('engine.mjs'), load('source.mjs'), load('map.mjs'), load('map-tools.mjs'), load('web-search.mjs'),
]);
const source = await new Source({ root: sourceTarget, commit: manifest.pinnedCodexCommit, map: codexMap(manifest.pinnedCodexCommit) }).init();
const mapEnabled = ['strategy', 'web', 'optimization', 'ui'].includes(options.family);
const mapTools = mapEnabled ? createLearningMapTools(async (route, input) => {
  if (route !== '/map' || input !== undefined) throw Object.assign(new Error('Read-only preparation'), { code: 'FORBIDDEN' });
  return { version: 'benchmark-fixed', document: source.map };
}) : null;
const e = await new Experiment({ directory: path.join(target, 'data/study'), source, provider, phase: 'study', mapTools,
  webSearch: mapEnabled ? createWebSearch({ token: provider.token }) : null }).init();
try {
  e.history.validate(prefix);
  await e.newTrial('seed'); const trial = e.trial('seed');
  for (const message of prefix) await e.history.append(trial.session, message);
  const text = '我想知道codex这个记忆的底层有哪些文件';
  await e.history.append(trial.session, { role: 'user', content: text });
  trial.requests.push({ id: 'memory-query', text, fingerprint: e.db.fingerprint, status: 'completed' });
  await e.save();
} finally { await e.close(); }
console.log(JSON.stringify({ prepared: true, family: options.family, offline: Boolean(options.offline), prefixMessages: prefix.length,
  exactHistoricalPrefix: false, note: 'Preparation makes no model requests. An empty prefix creates a new experiment, not an exact historical replay.' }));
