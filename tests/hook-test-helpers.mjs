import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { resolveProject, sessionBinding, sessionBindingsPath } from '../scripts/workbench/project.mjs';
import { stopServer } from '../scripts/workbench/cli.mjs';
import { pythonCommand } from '../.github/scripts/python-command.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hookScript = path.join(repository, 'scripts/context_guard_hook.py');
const contextScript = path.join(repository, 'scripts/context_guard.py');
const workbenchCli = path.join(repository, 'scripts/workbench/cli.mjs');
const python = pythonCommand();

function run(command, args, options = {}) {
  const started = performance.now();
  const result = spawnSync(command, args, {
    cwd: options.cwd || repository,
    encoding: 'utf8',
    input: options.input,
    env: { ...process.env, CONTEXT_GUARD_NAMED_WORKBENCH: '0', CONTEXT_GUARD_DISABLE_WORKBENCH: '1', CONTEXT_GUARD_HEADLESS: '1', ...options.env },
    // The Workbench HTTP request itself has a 40s budget. The former 30s
    // parent deadline killed valid plan requests before that budget elapsed.
    timeout: options.timeout || (args[1] === 'plan-start' ? 180_000 : 30_000),
    windowsHide: true,
  });
  if (process.env.CONTEXT_GUARD_TEST_TRACE) console.error(`[hook-test] ${path.basename(command)} ${args[1] || args[0]}: ${Math.round(performance.now() - started)} ms`);
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')}\n${result.error?.code || result.signal || result.status}\n${result.stdout}\n${result.stderr}`);
  return result;
}

function hook(event, project, sessionId, extra = {}) {
  const { platform = 'codex', ...hookExtra } = extra;
  const payload = {
    session_id: sessionId,
    cwd: project,
    hook_event_name: event,
    turn_id: hookExtra.turn_id || 'turn-one',
    ...hookExtra,
  };
  const result = run(python, [hookScript, event.replaceAll(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, ''), '--platform', platform], {
    cwd: project,
    input: JSON.stringify(payload),
  });
  return { ...result, json: result.stdout.trim() ? JSON.parse(result.stdout) : {} };
}

async function fixture() {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), 'context-guard-hooks-'));
  await fs.mkdir(path.join(project, 'src'), { recursive: true });
  return project;
}

async function confirmBinding(root, session) {
  const project = await resolveProject(root);
  const file = sessionBindingsPath(project);
  const existing = JSON.parse(await fs.readFile(file, 'utf8').catch(() => '{"sessions":{}}'));
  existing.sessions[session] = await sessionBinding(project, session);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(existing));
}

async function dispose(project) {
  // Git fixtures store runtime state in their shared Git directory, not only
  // .codex/context/private. Use the same resolver and drain check as the CLI.
  await stopServer(project);
  await fs.rm(project, { recursive: true, force: true, maxRetries: 3 });
}

async function freePort() {
  // This is one candidate, not a reserved/free guarantee. The real CLI performs
  // its unchanged bounded bind attempts and browser-compatible URL verification.
  return randomInt(49152, 65515);
}

async function waitForHealth(url) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(new URL('/api/health', url));
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error(`cloud server did not start: ${url}`);
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

async function waitForProcessExit(pid, timeout = 5_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (!processIsAlive(pid)) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.fail(`workbench process ${pid} did not exit within ${timeout} ms`);
}

async function stopFixtureWorkbench(project, pid) {
  const stopped = spawnSync(process.execPath, [workbenchCli, 'workbench', '--root', project, '--stop'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15_000,
  });
  assert.equal(stopped.status, 0, stopped.stderr || stopped.error?.message);
  assert.equal(JSON.parse(stopped.stdout).stopped, true);
  await waitForProcessExit(pid);
  const privateDir = path.join(project, '.codex/context/private');
  await assert.rejects(fs.access(path.join(privateDir, 'node-workbench.lock')), { code: 'ENOENT' });
  await assert.rejects(fs.access(path.join(privateDir, 'workbench.json')), { code: 'ENOENT' });
}

async function installMap(project) {
  const ctx = path.join(project, '.codex/context');
  const map = JSON.parse(await fs.readFile(path.join(ctx, 'map.json'), 'utf8'));
  map.root.children = [{
    id: 'N1', title: 'Runtime', kind: 'module', state: 'dirty', proposal: 'accepted', isNew: false,
    purpose: 'Own runtime code', memories: [], ideas: [], todos: [], bugs: [], dormant: [], files: [], owns: ['src/'], children: [],
  }];
  map.bootstrap = 'ready';
  await fs.writeFile(path.join(ctx, 'map.json'), `${JSON.stringify(map, null, 2)}\n`);
  return map;
}

function findMapNode(node, nodeId) {
  if (!node) return null;
  if (node.id === nodeId) return node;
  for (const child of [...(node.children || []), ...(node._inbox || [])]) {
    const found = findMapNode(child, nodeId);
    if (found) return found;
  }
  return null;
}

async function seedHumanReview(project, session, nodeId = 'N1') {
  const review = {
    decision: 'approved', sessionId: session, reviewedAt: new Date().toISOString(), reason: 'recorded human review',
  };
  const item = { id: 'TD-human-review', title: '验收本轮工作', status: 'done', sessions: [session], review };
  const identity = await resolveProject(project);
  const stateFile = path.join(identity.sharedDir, 'workbench.json');
  let state = null;
  try { state = JSON.parse(await fs.readFile(stateFile, 'utf8')); } catch { state = null; }
  if (state?.url) {
    const boot = await fetch(new URL('/__context_guard/bootstrap', state.url)).then(response => response.json());
    const headers = { Authorization: `Bearer ${boot.token}`, 'Content-Type': 'application/json' };
    const current = await fetch(new URL('/api/state', state.url), { headers }).then(response => response.json());
    const node = findMapNode(current.doc.root, nodeId) || current.doc.root;
    const todos = [...(node.todos || [])];
    const index = todos.findIndex(entry => entry.id === item.id);
    if (index >= 0) todos[index] = { ...todos[index], ...item };
    else todos.push(item);
    const committed = await fetch(new URL('/api/commit', state.url), {
      method: 'POST', headers,
      body: JSON.stringify({
        baseVersion: current.version, operationId: `human-review:${session}`,
        operations: [{ type: 'update', id: node.id, fields: { todos } }],
      }),
    });
    assert.equal(committed.status, 200, await committed.text());
    return;
  }
  const mapFile = path.join(project, '.codex/context/map.json');
  const map = JSON.parse(await fs.readFile(mapFile, 'utf8'));
  const node = findMapNode(map.root, nodeId) || map.root;
  node.todos = Array.isArray(node.todos) ? node.todos : [];
  const index = node.todos.findIndex(entry => entry.id === item.id);
  if (index >= 0) node.todos[index] = { ...node.todos[index], ...item };
  else node.todos.push(item);
  await fs.writeFile(mapFile, `${JSON.stringify(map, null, 2)}\n`);
}

async function startPlan(t, project, session, paths = ['src/'], { humanReview = true } = {}) {
  const ctx = path.join(project, '.codex/context');
  await fs.writeFile(path.join(ctx, 'sessions/workbench-access.json'), JSON.stringify({ sessions: { [session]: { nodes: ['N1'] } } }));
  if (humanReview) await seedHumanReview(project, session);
  run(process.execPath, [workbenchCli, 'workbench', '--root', project, '--port', String(await freePort())]);
  return JSON.parse(run(python, [contextScript, 'plan-start', '--root', project, '--session', session, '--input', '-'], {
    input: JSON.stringify({ approved: true, summary: '实现并验证运行时', node_ids: ['N1'], paths }),
  }).stdout);
}

function archivePlan(project, session, files = 'src/scratch.txt', extra = {}) {
  return run(python, [contextScript, 'archive-session', '--root', project, '--session', session,
    '--summary', '完成运行时开发', '--files', files, '--input', '-'], {
    input: JSON.stringify({ verification: 'hook-lifecycle fixture: verified output', assessment: { decision: 'reuse', reason: '属于现有运行时节点' }, ...extra }),
  });
}

function finishPlan(project, session) {
  return run(python, [contextScript, 'plan-finish', '--root', project, '--session', session]);
}


export { repository, hookScript, contextScript, workbenchCli, python, run, hook, fixture, confirmBinding, dispose, freePort, waitForHealth, processIsAlive, waitForProcessExit, stopFixtureWorkbench, installMap, findMapNode, seedHumanReview, startPlan, archivePlan, finishPlan };
