export const WORKBENCH_PROTOCOL = 2;
export const WORKBENCH_RUNTIME_SCHEMA = 3;
export const WORKBENCH_BUILD = 'project-workbench-v3';
export const WORKBENCH_CAPABILITIES = Object.freeze([
  'git-common-dir-project',
  'named-origin-verification',
  'prepared-session-binding',
  'private-main-baseline',
  'stable-worktree-identity',
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
