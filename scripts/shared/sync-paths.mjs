import path from 'node:path';
import { spawnSync } from 'node:child_process';
export function syncPaths(root) {
  const dir = path.join(root, '.codex/context/private/cloud-sync');
  const common = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 2000,
  });
  const sharedDir = common.status === 0 && common.stdout.trim()
    ? path.join(path.resolve(root, common.stdout.trim()), 'context-guard/cloud-sync')
    : dir;
  return {
    dir,
    sharedDir,
    config: path.join(sharedDir, 'config.json'),
    legacyConfig: path.join(dir, 'config.json'),
    state: path.join(dir, 'state.json'),
    base: path.join(dir, 'base-map.json'),
    inbox: path.join(dir, 'inbox.jsonl'),
    service: path.join(dir, 'service.json'),
    serviceLog: path.join(dir, 'service.log'),
    works: path.join(dir, 'works'),
    lock: path.join(dir, 'transaction.lock'),
    map: path.join(root, '.codex/context/map.json'),
  };
}
