import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { sharedMappings } from './shared-package-contract.mjs';
import { buildRuntime } from '../../bin/build-runtime.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const destination = path.join(root, 'dist');
await buildRuntime();
await fs.mkdir(destination, { recursive: true });
const stage = await fs.mkdtemp(path.join(destination, 'shared-stage-'));
const checksums = [];
try {
  for (const kind of ['core', 'workbench']) {
    const directory = path.join(stage, kind);
    for (const [source, relative] of sharedMappings(kind)) {
      const sourceFile = path.join(root, source), target = path.join(directory, relative);
      if (!(await fs.lstat(sourceFile)).isFile()) throw new Error('Shared package sources must be ordinary files');
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(sourceFile, target);
    }
    // 核心包的角色和参考来自 Skill 唯一源码，不在源码树复制副本。
    const descriptor = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
    descriptor.files = sharedMappings(kind).map(([, file]) => file);
    await fs.writeFile(path.join(directory, 'package.json'), JSON.stringify(descriptor, null, 2) + '\n');
    const args = ['pack', '--ignore-scripts', '--json', '--pack-destination', destination];
    const windows = process.platform === 'win32';
    const result = spawnSync(windows ? process.env.ComSpec || 'cmd.exe' : 'npm', windows ? ['/d', '/s', '/c', `npm ${args.map(value => `"${value}"`).join(' ')}`] : args,
      { cwd: directory, encoding: 'utf8', windowsHide: true, windowsVerbatimArguments: windows });
    if (result.status !== 0) throw new Error(`Unable to pack ${kind}: ${result.stderr}`);
    const [packed] = JSON.parse(result.stdout);
    const expected = sharedMappings(kind).map(([, file]) => file).sort();
    if (JSON.stringify(packed.files.map(file => file.path).sort()) !== JSON.stringify(expected)) throw new Error('Shared package file contract mismatch');
    if (path.basename(packed.filename) !== packed.filename) throw new Error('Invalid shared artifact path');
    const bytes = await fs.readFile(path.join(destination, packed.filename));
    checksums.push(`${createHash('sha256').update(bytes).digest('hex')}  ${packed.filename}`);
  }
  await fs.writeFile(path.join(destination, 'SHA256SUMS'), checksums.join('\n') + '\n');
  console.log(checksums.join('\n'));
} finally {
  await fs.rm(stage, { recursive: true, force: true });
}
