import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { atomicWrite, encode, readJSON, hash } from './io.mjs';
import { MapError } from '../../prototype/map-model.mjs';

const exec = promisify(execFile);
export const bindingPath = root => path.join(root, '.codex/context/private/project-binding.json');
async function commonDir(root) {
  const { stdout } = await exec('git', ['rev-parse', '--git-common-dir'], { cwd: root, windowsHide: true, timeout: 5000 });
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
  if (localMap && !keepLocal) throw new MapError('LOCAL_MAP_EXISTS', 'Local Map is preserved. Pass --keep-local to explicitly leave it inactive; no Map is merged or deleted');
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
