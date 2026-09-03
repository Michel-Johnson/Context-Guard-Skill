import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const digest = value => createHash('sha256').update(String(value)).digest('hex');

async function git(root, args, { optional = false } = {}) {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10000,
      maxBuffer: 1024 * 1024,
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
  try { await git(project.worktreeRoot, ['fetch', '--quiet', 'origin', project.mainBranch]); }
  catch (cause) { status = 'offline'; error = cause.code || 'FETCH_FAILED'; }
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

async function defaultBranch(root) {
  const symbolic = await git(root, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], { optional: true });
  if (symbolic.startsWith('origin/')) return symbolic.slice('origin/'.length);
  for (const branch of ['main', 'master']) {
    if (await git(root, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}^{commit}`], { optional: true })) return branch;
  }
  return '';
}

async function worktreeMetadata(root, branch) {
  const head = await git(root, ['rev-parse', 'HEAD'], { optional: true });
  const currentBranch = await git(root, ['branch', '--show-current'], { optional: true });
  const mainRef = branch ? `refs/remotes/origin/${branch}` : '';
  const mainSha = mainRef ? await git(root, ['rev-parse', '--verify', '--quiet', `${mainRef}^{commit}`], { optional: true }) : '';
  return { branch: currentBranch, head, mainBranch: branch, mainRef, mainSha };
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
      ...(await worktreeMetadata(requestedRoot, '')),
    };
  }
  const worktreeRoot = await fs.realpath(topLevel);
  let commonDir = await git(worktreeRoot, ['rev-parse', '--path-format=absolute', '--git-common-dir'], { optional: true });
  if (!commonDir) {
    const relative = await git(worktreeRoot, ['rev-parse', '--git-common-dir']);
    commonDir = path.resolve(worktreeRoot, relative);
  }
  commonDir = await fs.realpath(commonDir);
  const remote = await git(worktreeRoot, ['config', '--get', 'remote.origin.url'], { optional: true });
  const github = githubRepository(remote);
  const mainBranch = await defaultBranch(worktreeRoot);
  const projectId = `git-${digest(commonDir).slice(0, 20)}`;
  return {
    projectId,
    kind: 'git',
    openedRoot: requestedRoot,
    worktreeRoot,
    worktreeId: `worktree-${digest(worktreeRoot).slice(0, 20)}`,
    commonDir,
    sharedDir: path.join(commonDir, 'context-guard'),
    remote,
    github,
    bindingRequired: !github || !mainBranch,
    ...(await worktreeMetadata(worktreeRoot, mainBranch)),
  };
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
    updatedAt: new Date().toISOString(),
  };
}
