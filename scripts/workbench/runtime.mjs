export const WORKBENCH_PROTOCOL = 2;
export const WORKBENCH_RUNTIME_SCHEMA = 4;
export const WORKBENCH_BUILD = 'project-workbench-v8';
export const WORKBENCH_CAPABILITIES = Object.freeze([
  'git-common-dir-project',
  'named-origin-verification',
  'prepared-session-binding',
  'private-main-baseline',
  'stable-worktree-identity',
  'global-project-registry',
  'session-auto-binding',
  'dynamic-session-access',
  'confirmed-main-baseline-migration',
  'runtime-instance-check',
  'journal-recovery',
]);

export function runtimeIdentity() {
  return {
    protocol: WORKBENCH_PROTOCOL,
    runtimeSchema: WORKBENCH_RUNTIME_SCHEMA,
    buildId: WORKBENCH_BUILD,
    capabilities: [...WORKBENCH_CAPABILITIES],
  };
}

export function compatibleRuntime(value) {
  if (!value || value.protocol !== WORKBENCH_PROTOCOL || value.runtimeSchema !== WORKBENCH_RUNTIME_SCHEMA) return false;
  const advertised = new Set(Array.isArray(value.capabilities) ? value.capabilities : []);
  return WORKBENCH_CAPABILITIES.every(capability => advertised.has(capability));
}

export function upgradeableRuntime(value) {
  return !!value
    && value.protocol === WORKBENCH_PROTOCOL
    && Number.isInteger(value.runtimeSchema)
    && value.runtimeSchema > 0
    && value.runtimeSchema <= WORKBENCH_RUNTIME_SCHEMA
    && /^project-workbench-v\d+$/.test(String(value.buildId || ''))
    && Array.isArray(value.capabilities)
    && value.capabilities.includes('git-common-dir-project')
    && value.capabilities.includes('named-origin-verification');
}
