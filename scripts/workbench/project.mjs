import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { atomicWrite, encode, readJSON } from './io.mjs';

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
  for (const branch of ['main', 'master']) {
    if (await git(root, ['rev-parse', '--verify', '--quiet', `refs/remotes/${remote}/${branch}^{commit}`], { optional: true })) return branch;
  }
  return '';
}

async function worktreeMetadata(root, main = null) {
  const head = await git(root, ['rev-parse', 'HEAD'], { optional: true });
  const currentBranch = await git(root, ['branch', '--show-current'], { optional: true });
  const mainBranch = main?.branch || '';
  const mainRef = main?.ref || '';
  const mainSha = mainRef ? await git(root, ['rev-parse', '--verify', '--quiet', `${mainRef}^{commit}`], { optional: true }) : '';
  return { branch: currentBranch, head, mainBranch, mainRef, mainSha };
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
    worktreeId: `worktree-${digest(worktreeRoot).slice(0, 20)}`,
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
  return {
    projectId: project.projectId,
    kind: project.kind,
    main: project.binding?.main || null,
    bindingRequired: project.bindingRequired,
    workbenchState: project.kind === 'git' ? path.join(project.sharedDir, 'workbench.json') : path.join(project.worktreeRoot, '.codex/context/private/workbench.json'),
    session: session ? { bound: session.projectId === project.projectId && session.worktreeRoot === project.worktreeRoot, ...session } : { bound: false, sessionId },
  };
}

export async function readMainMap(project, ref = project.mainRef) {
  if (project.kind !== 'git' || !ref) return '';
  return git(project.worktreeRoot, ['show', `${ref}:.codex/context/map.json`], { optional: true });
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
    worktreeRoot: project.worktreeRoot,
    branch: project.branch,
    head: project.head,
    mainBranch: project.mainBranch,
    baseMainSha: project.mainSha,
    workbenchState: project.kind === 'git' ? path.join(project.sharedDir, 'workbench.json') : path.join(project.worktreeRoot, '.codex/context/private/workbench.json'),
    updatedAt: new Date().toISOString(),
  };
}
