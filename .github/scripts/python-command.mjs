import { spawnSync } from 'node:child_process';

export function pythonCommand({ platform = process.platform, probe = spawnSync } = {}) {
  for (const command of platform === 'win32' ? ['python', 'python3'] : ['python3', 'python']) {
    const result = probe(command, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    if (!result.error && result.status === 0 && /^Python 3\./m.test(`${result.stdout || ''}\n${result.stderr || ''}`)) return command;
  }
  throw new Error('No working Python 3 interpreter found');
}
