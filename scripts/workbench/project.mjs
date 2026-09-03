import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { atomicWrite, encode, readJSON, withFileLock, hash } from './io.mjs';
import { MapError } from '../../prototype/map-model.mjs';

const execFileAsync = promisify(execFile);
const digest = value => createHash('sha256').update(String(value)).digest('hex');

async function git(root, args, { optional = false } = {}) {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10000,
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout.trim();
  } catch (error) {
    if (optional) return '';
    throw error;
  }
}

export async function refreshMain(project) {
  if (project.kind !== 'git' || project.bindingRequired) {
    return { status: project.kind === 'git' ? 'binding-required' : 'local-folder', branch: project.mainBranch || '', sha: project.mainSha || '', checkedAt: new Date().toISOString() };
  }
  let status = 'ready', error = '';
  if (project.binding?.main?.mode === 'remote') {
    try { await git(project.worktreeRoot, ['fetch', '--quiet', project.binding.main.remote, project.mainBranch]); }
    catch (cause) { status = 'offline'; error = cause.code || 'FETCH_FAILED'; }
  }
  const current = await resolveProject(project.worktreeRoot);
  return {
    status,
    branch: current.mainBranch,
    ref: current.mainRef,
    sha: current.mainSha,
    github: current.github,
    checkedAt: new Date().toISOString(),
    ...(error ? { error } : {}),
  };
}

function githubRepository(remote) {
  const value = String(remote || '').trim();
  const match = value.match(/^(?:https?:\/\/|ssh:\/\/git@|git@)github\.com(?::|\/)([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (!match) return null;
  return { owner: match[1], repo: match[2], slug: `${match[1]}/${match[2]}` };
}

async function defaultBranch(root, remote = 'origin') {
  const symbolic = await git(root, ['symbolic-ref', '--quiet', '--short', `refs/remotes/${remote}/HEAD`], { optional: true });
  if (symbolic.startsWith(`${remote}/`)) return symbolic.slice(remote.length + 1);
  return '';
}

async function worktreeMetadata(root, main = null) {
  const head = await git(root, ['rev-parse', 'HEAD'], { optional: true });
  const currentBranch = await git(root, ['branch', '--show-current'], { optional: true });
  let gitDir = await git(root, ['rev-parse', '--path-format=absolute', '--git-dir'], { optional: true });
  if (gitDir) gitDir = await fs.realpath(gitDir).catch(() => path.resolve(root, gitDir));
  const mainBranch = main?.branch || '';
  const mainRef = main?.ref || '';
  const mainSha = mainRef ? await git(root, ['rev-parse', '--verify', '--quiet', `${mainRef}^{commit}`], { optional: true }) : '';
  return { branch: currentBranch, head, gitDir, mainBranch, mainRef, mainSha };
}

export const projectBindingPath = project => path.join(project.sharedDir, 'project-binding.json');
export const sessionBindingsPath = project => project.kind === 'git'
  ? path.join(project.sharedDir, 'workbench-bindings.json')
  : path.join(project.worktreeRoot, '.codex/context/sessions/workbench-bindings.json');

function mainTarget({ mode = 'remote', remote = 'origin', branch } = {}) {
  const name = String(branch || '').trim();
  if (!name) throw new Error('A main branch is required');
  if (mode === 'local') return { mode, remote: '', branch: name, ref: `refs/heads/${name}` };
  const remoteName = String(remote || 'origin').trim();
  if (!/^[A-Za-z0-9._-]+$/.test(remoteName)) throw new Error('Invalid Git remote name');
  return { mode: 'remote', remote: remoteName, branch: name, ref: `refs/remotes/${remoteName}/${name}` };
}

export async function resolveProject(openedRoot) {
  const requestedRoot = await fs.realpath(path.resolve(openedRoot));
  const topLevel = await git(requestedRoot, ['rev-parse', '--show-toplevel'], { optional: true });
  if (!topLevel) {
    const projectId = `folder-${digest(requestedRoot).slice(0, 20)}`;
    return {
      projectId,
      kind: 'folder',
      openedRoot: requestedRoot,
      worktreeRoot: requestedRoot,
      worktreeId: `worktree-${digest(requestedRoot).slice(0, 20)}`,
      commonDir: null,
      sharedDir: path.join(requestedRoot, '.codex/context/private/project-workbench'),
      remote: '',
      github: null,
      bindingRequired: false,
      binding: { source: 'folder', main: null },
      ...(await worktreeMetadata(requestedRoot)),
    };
  }
  const worktreeRoot = await fs.realpath(topLevel);
  let commonDir = await git(worktreeRoot, ['rev-parse', '--path-format=absolute', '--git-common-dir'], { optional: true });
  if (!commonDir) {
    const relative = await git(worktreeRoot, ['rev-parse', '--git-common-dir']);
    commonDir = path.resolve(worktreeRoot, relative);
  }
  commonDir = await fs.realpath(commonDir);
  const projectId = `git-${digest(commonDir).slice(0, 20)}`;
  const sharedDir = path.join(commonDir, 'context-guard');
  const stored = await readJSON(path.join(sharedDir, 'project-binding.json'), null);
  if (stored && (stored.projectId !== projectId || !stored.main?.branch)) throw new Error('Invalid project binding; repair it explicitly, do not recreate it');
  const originUrl = await git(worktreeRoot, ['config', '--get', 'remote.origin.url'], { optional: true });
  const originGithub = githubRepository(originUrl);
  const automaticBranch = originGithub ? await defaultBranch(worktreeRoot) : '';
  const automatic = automaticBranch ? mainTarget({ remote: 'origin', branch: automaticBranch }) : null;
  const selected = stored?.projectId === projectId && stored?.main?.branch ? mainTarget(stored.main) : automatic;
  const remote = selected?.mode === 'remote'
    ? await git(worktreeRoot, ['config', '--get', `remote.${selected.remote}.url`], { optional: true })
    : '';
  const github = githubRepository(remote);
  const metadata = await worktreeMetadata(worktreeRoot, selected);
  return {
    projectId,
    kind: 'git',
    openedRoot: requestedRoot,
    worktreeRoot,
    // The Git administration directory survives a supported `git worktree move`
    // and changes when a different worktree is later created at the same path.
    // An absolute checkout path has the opposite behaviour and caused stale
    // bindings to look current after path reuse.
    worktreeId: `worktree-${digest(metadata.gitDir || worktreeRoot).slice(0, 20)}`,
    commonDir,
    sharedDir,
    remote,
    github,
    bindingRequired: !selected || !metadata.mainSha,
    binding: selected ? { source: stored?.projectId === projectId ? 'explicit' : 'github-default', main: selected } : null,
    ...metadata,
  };
}

export async function ensureProjectBinding(project) {
  if (project.kind !== 'git' || !project.binding || project.binding.source === 'explicit') return project;
  await atomicWrite(projectBindingPath(project), encode({ v: 1, projectId: project.projectId, main: project.binding.main, source: project.binding.source, updatedAt: new Date().toISOString() }));
  return { ...project, binding: { ...project.binding, source: 'explicit' } };
}

export async function saveMainBinding(openedRoot, options) {
  const project = await resolveProject(openedRoot);
  if (project.kind !== 'git') throw new Error('Main branch binding requires a Git project');
  const target = mainTarget(options);
  const valid = await git(project.worktreeRoot, ['check-ref-format', '--branch', target.branch], { optional: true });
  if (valid !== target.branch) throw new Error('Invalid main branch name');
  if (target.mode === 'remote') {
    const remoteUrl = await git(project.worktreeRoot, ['remote', 'get-url', target.remote], { optional: true });
    if (!remoteUrl) throw new Error(`Unknown Git remote: ${target.remote}`);
    if (!await git(project.worktreeRoot, ['rev-parse', '--verify', '--quiet', `${target.ref}^{commit}`], { optional: true })) {
      await git(project.worktreeRoot, ['fetch', '--quiet', target.remote, target.branch]);
    }
  }
  if (!await git(project.worktreeRoot, ['rev-parse', '--verify', '--quiet', `${target.ref}^{commit}`], { optional: true })) throw new Error(`Main ref does not resolve: ${target.ref}`);
  await atomicWrite(projectBindingPath(project), encode({ v: 1, projectId: project.projectId, main: target, source: 'user', updatedAt: new Date().toISOString() }));
  return resolveProject(openedRoot);
}

export async function bindingStatus(project, sessionId = '') {
  const bindings = await readJSON(sessionBindingsPath(project), { sessions: {} });
  const session = sessionId ? bindings?.sessions?.[sessionId] || null : null;
  let state = 'unbound';
  if (session) {
    if (session.projectId !== project.projectId) state = 'project-mismatch';
    else if (session.worktreeId === project.worktreeId) state = session.worktreeRoot === project.worktreeRoot ? 'current' : 'moved';
    else if (!session.gitDir && session.worktreeRoot === project.worktreeRoot) state = 'current-legacy';
    else {
      const target = await fs.realpath(session.worktreeRoot || '').catch(() => null);
      state = target ? 'other-worktree' : 'stale';
    }
  }
  return {
    projectId: project.projectId,
    kind: project.kind,
    main: project.binding?.main || null,
    bindingRequired: project.bindingRequired,
    workbenchState: project.kind === 'git' ? path.join(project.sharedDir, 'workbench.json') : path.join(project.worktreeRoot, '.codex/context/private/workbench.json'),
    session: session
      ? { ...session, state, bound: ['current', 'current-legacy', 'moved'].includes(state), pathChanged: state === 'moved', migrationNeeded: state === 'current-legacy' }
      : { bound: false, state, sessionId },
  };
}

export async function projectPreferences(project, language) {
  const file = path.join(project.sharedDir, 'preferences.json');
  return withFileLock(file + '.lock', async () => {
    const stored = await readJSON(file, null);
    if (await readJSON(path.join(project.sharedDir, 'memory-client.json'), null)) {
      const { memoryRequest } = await import('./memory.mjs');
      const remote = (await memoryRequest(project, 'preferences')).preferences;
      const chosen = language === undefined ? remote?.language || stored?.record_language : language;
      if (!chosen) return { record_language: 'unset', display_language: 'auto' };
      if (!['zh', 'en'].includes(chosen)) throw new Error('Language must be zh or en');
      const result = remote?.language === chosen ? remote : (await memoryRequest(project, 'preferences', { operationId: `language:${remote?.version || 'initial'}:${chosen}`, baseVersion: remote?.version || null, language: chosen })).snapshot;
      const value = { record_language: result.language, display_language: result.language, serverVersion: result.version };
      await atomicWrite(file, encode(value)); return value;
    }
    if (language !== undefined) {
      if (!['zh', 'en'].includes(language)) throw new Error('Language must be zh or en');
      const next = { ...stored, record_language: language, display_language: language, updatedAt: new Date().toISOString() };
      await atomicWrite(file, encode(next));
      const verified = await readJSON(file);
      if (verified.record_language !== language) throw new Error('Language persistence verification failed');
      return verified;
    }
    if (stored) {
      if (!['zh', 'en'].includes(stored.record_language)) throw new Error('Invalid shared language configuration');
      return stored;
    }
    const values = new Set();
    for (const root of await listWorktrees(project)) {
      const value = await readJSON(path.join(root, '.codex/context/preferences.json'), null);
      if (['zh', 'en'].includes(value?.record_language)) values.add(value.record_language);
    }
    if (values.size > 1) throw Object.assign(new Error('Confirmed language settings conflict; ask which project language to retain'), { code: 'LANGUAGE_CONFLICT' });
    if (!values.size) return { record_language: 'unset', display_language: 'auto' };
    const value = { record_language: [...values][0], display_language: [...values][0], migrated: true };
    await atomicWrite(file, encode(value));
    return readJSON(file);
  });
}

export async function sameProject(leftRoot, rightRoot) {
  const [left, right] = await Promise.all([resolveProject(leftRoot), resolveProject(rightRoot)]);
  return left.projectId === right.projectId;
}

export async function listWorktrees(project) {
  if (project.kind !== 'git') return [project.worktreeRoot];
  const text = await git(project.worktreeRoot, ['worktree', 'list', '--porcelain']);
  const roots = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('worktree ')) continue;
    const root = await fs.realpath(line.slice('worktree '.length)).catch(() => null);
    if (root) roots.push(root);
  }
  return [...new Set(roots)];
}

export async function mainWorktree(project) {
  if (project.kind !== 'git' || !project.mainBranch) return null;
  const text = await git(project.worktreeRoot, ['worktree', 'list', '--porcelain']);
  let candidate = null;
  for (const line of `${text}\n`.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) candidate = line.slice('worktree '.length);
    else if (line === `branch refs/heads/${project.mainBranch}` && candidate) {
      return fs.realpath(candidate).catch(() => null);
    } else if (!line && candidate) candidate = null;
  }
  return null;
}

export async function sessionBinding(project, sessionId) {
  return {
    sessionId,
    projectId: project.projectId,
    worktreeId: project.worktreeId,
    gitDir: project.gitDir || null,
    worktreeRoot: project.worktreeRoot,
    branch: project.branch,
    head: project.head,
    mainBranch: project.mainBranch,
    baseMainSha: project.mainSha,
    workbenchState: project.kind === 'git' ? path.join(project.sharedDir, 'workbench.json') : path.join(project.worktreeRoot, '.codex/context/private/workbench.json'),
    updatedAt: new Date().toISOString(),
  };
}

export const bindingPath = root => path.join(root, '.codex/context/private/project-binding.json');
async function commonDir(root) {
  const { stdout } = await execFileAsync('git', ['rev-parse', '--git-common-dir'], { cwd: root, windowsHide: true, timeout: 5000 });
  return fs.realpath(path.resolve(root, stdout.trim()));
}
export async function resolveProjectRoot(root) {
  root = await fs.realpath(path.resolve(root));
  const binding = await readJSON(bindingPath(root), null);
  if (!binding) return root;
  if (binding.version !== 1 || !path.isAbsolute(binding.projectRoot || '')) throw new MapError('INVALID_BINDING', 'Invalid workbench project binding');
  const target = await fs.realpath(binding.projectRoot);
  if (target === root || await readJSON(bindingPath(target), null)) throw new MapError('INVALID_BINDING', 'Workbench binding chains are not supported');
  if (await commonDir(root) !== await commonDir(target)) throw new MapError('INVALID_BINDING', 'Bound worktrees must belong to the same local Git repository');
  await fs.access(path.join(target, '.codex/context/map.json'));
  return target;
}
export async function bindProject(root, target, { keepLocal = false } = {}) {
  root = await fs.realpath(root); target = await fs.realpath(target);
  if (root === target || await resolveProjectRoot(target) !== target) throw new MapError('INVALID_BINDING', 'Select an unbound, different project worktree');
  if (await commonDir(root) !== await commonDir(target)) throw new MapError('INVALID_BINDING', 'Different Git projects cannot share this binding');
  await fs.access(path.join(target, '.codex/context/map.json'));
  const existing = await readJSON(bindingPath(root), null);
  if (existing && existing.projectRoot !== target) throw new MapError('BINDING_EXISTS', 'An existing binding cannot be silently replaced');
  const localMap = await fs.stat(path.join(root, '.codex/context/map.json')).catch(e => e.code === 'ENOENT' ? null : Promise.reject(e));
  if (localMap && !keepLocal) throw new MapError('LOCAL_MAP_EXISTS', 'Local Map is preserved. Pass --keep-local to confirm keeping its Session seed; no Map is merged or deleted');
  // Do not change an active worktree's data source under its service or pages.
  const state = await readJSON(path.join(root, '.codex/context/private/workbench.json'), null);
  if (state?.pid) { let alive = true; try { process.kill(state.pid, 0); } catch (e) { if (e.code === 'ESRCH') alive = false; }
    if (alive) throw new MapError('WORKBENCH_ACTIVE', 'Stop this worktree workbench before binding it'); }
  await atomicWrite(bindingPath(root), encode({ version: 1, projectRoot: target, boundAt: new Date().toISOString() }));
  return { root, projectRoot: target, localMapPreserved: !!localMap };
}
export const projectId = root => hash(root).slice(0, 24);
export function projectName(value, root) {
  const name = String(value || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63).replace(/-+$/g, '');
  return name || `project-${projectId(root).slice(0, 12)}`;
}
