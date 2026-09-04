import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { atomicWrite, encode, readJSON, withFileLock } from './io.mjs';
import { MapError } from '../../prototype/map-model.mjs';

export const globalWorkbenchDirectory = () => path.resolve(
  process.env.CONTEXT_GUARD_NAMED_STATE_DIR || path.join(os.homedir(), '.context-guard/named-workbench'),
);

export const projectRegistryPath = (dir = globalWorkbenchDirectory()) => path.join(dir, 'projects.json');

function normalize(raw) {
  if (raw === null) return { version: 1, projects: [] };
  if (!raw || raw.version !== 1 || !Array.isArray(raw.projects)) {
    throw new MapError('INVALID_PROJECT_REGISTRY', 'Invalid global workbench registry; restore it before registering projects', 409);
  }
  const ids = new Set(), origins = new Set();
  for (const item of raw.projects) {
    if (!item || typeof item.projectId !== 'string' || !item.projectId || typeof item.sharedDir !== 'string' || !path.isAbsolute(item.sharedDir)) {
      throw new MapError('INVALID_PROJECT_REGISTRY', 'Invalid project record in global workbench registry', 409);
    }
    if (ids.has(item.projectId)) throw new MapError('INVALID_PROJECT_REGISTRY', 'Duplicate project identity in global workbench registry', 409);
    ids.add(item.projectId);
    if (item.origin) {
      let origin;
      try { origin = new URL(item.origin).origin; } catch { throw new MapError('INVALID_PROJECT_REGISTRY', 'Invalid project origin in global workbench registry', 409); }
      if (origin !== item.origin || origins.has(origin)) throw new MapError('INVALID_PROJECT_REGISTRY', 'Duplicate or non-canonical project origin in global workbench registry', 409);
      origins.add(origin);
    }
  }
  return raw;
}

export async function readProjectRegistry({ dir = globalWorkbenchDirectory() } = {}) {
  return normalize(await readJSON(projectRegistryPath(dir), null));
}

export async function registeredProject(project, options = {}) {
  const registry = await readProjectRegistry(options);
  return registry.projects.find(item => item.projectId === project.projectId) || null;
}

export async function rememberProject(project, { dir = globalWorkbenchDirectory(), name = '', origin = '', state = null } = {}) {
  const file = projectRegistryPath(dir);
  return withFileLock(file + '.lock', async () => {
    const registry = normalize(await readJSON(file, null));
    const previous = registry.projects.find(item => item.projectId === project.projectId) || null;
    const canonicalOrigin = origin ? new URL(origin).origin : previous?.origin || '';
    const collision = canonicalOrigin && registry.projects.find(item => item.projectId !== project.projectId && item.origin === canonicalOrigin);
    if (collision) throw new MapError('PROJECT_NAME_CONFLICT', 'The named workbench belongs to another registered project', 409);
    const roots = [...new Set([
      ...(Array.isArray(previous?.roots) ? previous.roots : []),
      project.worktreeRoot,
      project.openedRoot,
    ].filter(item => typeof item === 'string' && path.isAbsolute(item)))];
    const record = {
      version: 1,
      projectId: project.projectId,
      kind: project.kind,
      sharedDir: project.sharedDir,
      roots,
      name: name || previous?.name || '',
      origin: canonicalOrigin,
      main: project.binding?.main || previous?.main || null,
      stateFile: project.kind === 'git'
        ? path.join(project.sharedDir, 'workbench.json')
        : path.join(project.worktreeRoot, '.codex/context/private/workbench.json'),
      runtime: state ? {
        instance: state.instance || '',
        buildId: state.buildId || '',
        runtimeSchema: state.runtimeSchema || null,
        port: Number(new URL(state.url).port),
      } : previous?.runtime || null,
      updatedAt: new Date().toISOString(),
    };
    const next = {
      version: 1,
      projects: [...registry.projects.filter(item => item.projectId !== project.projectId), record]
        .sort((a, b) => a.projectId.localeCompare(b.projectId)),
    };
    await atomicWrite(file, encode(next));
    return record;
  });
}
