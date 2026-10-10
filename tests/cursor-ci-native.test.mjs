import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { captureCursorCiNativeDistribution, prepareCursorCiNativeIdentity } from '../scripts/workbench/cursor-ci-native.mjs';
import { canonical } from '../scripts/shared/protocol.mjs';

async function fixture() {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'cg-ci-native-')));
  const root = path.join(directory, 'distribution'); await fs.mkdir(root, { mode: 0o700 });
  await fs.mkdir(path.join(root, 'node_modules'), { mode: 0o700 });
  const files = { 'cursor-agent-sea': 'synthetic executable\n', 'cursor-agent': 'synthetic launcher\n',
    'node': 'synthetic node\n', 'index.js': 'synthetic entry\n', '190.index.js': 'synthetic chunk\n', 'node_modules/helper.js': 'synthetic helper\n' };
  for (const [name, contents] of Object.entries(files)) await fs.writeFile(path.join(root, name), contents, { mode: 0o600, flag: 'wx' });
  return { directory, root, files, command: path.join(root, 'cursor-agent'), sea: path.join(root, 'cursor-agent-sea') };
}

test('native identity captures the complete distribution but does not trust self-reported versions', async () => {
  const f = await fixture(), pin = await captureCursorCiNativeDistribution(f.command);
  const files = Object.entries(f.files).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([file, contents]) =>
    ({ path: file, bytes: Buffer.byteLength(contents), sha256: createHash('sha256').update(contents).digest('hex') }));
  assert.equal(pin.identity.distributionSha256, createHash('sha256').update(canonical({ directories: ['', 'node_modules'], files })).digest('hex'));
  assert.equal(pin.identity.command, path.join(f.root, 'node'));
  assert.deepEqual(pin.identity.args, ['--use-system-ca', path.join(f.root, 'index.js')]); await pin.verify();
  let invoked = 0;
  assert.equal(await prepareCursorCiNativeIdentity({ command: f.command, invoke: async () => {
    invoked++; return { stdout: '2026.10.01-e373342\n', stderr: '' };
  }, options: {} }), null);
  assert.equal(invoked, 0, 'same version claims cannot grant identity or even execute an unknown package');
});

for (const change of ['helper', 'chunk', 'entry', 'node', 'sea', 'add-file', 'delete-file', 'same-bytes-inode', 'directory-link', 'hardlink', 'mode']) {
  test(`original native identity permanently detects ${change} without repairing resources`,
    { skip: process.platform === 'win32' && ['directory-link', 'mode'].includes(change) ? 'POSIX mode/link privileges are verified separately' : false }, async () => {
      const f = await fixture(), pin = await captureCursorCiNativeDistribution(f.command);
      const relative = { helper: 'node_modules/helper.js', chunk: '190.index.js', entry: 'index.js', node: 'node', sea: 'cursor-agent-sea' }[change];
      if (relative) await fs.appendFile(path.join(f.root, relative), 'changed');
      if (change === 'add-file') await fs.writeFile(path.join(f.root, 'extra.js'), 'unknown', { mode: 0o600 });
      if (change === 'delete-file') await fs.rename(path.join(f.root, 'node'), path.join(f.directory, 'preserved-node'));
      if (change === 'same-bytes-inode') {
        await fs.rename(f.sea, path.join(f.directory, 'preserved-sea'));
        await fs.writeFile(f.sea, f.files['cursor-agent-sea'], { mode: 0o600 });
      }
      if (change === 'directory-link') {
        await fs.rename(path.join(f.root, 'node_modules'), path.join(f.directory, 'preserved-modules'));
        await fs.symlink(path.join(f.directory, 'preserved-modules'), path.join(f.root, 'node_modules'), 'dir');
      }
      if (change === 'hardlink') await fs.link(f.sea, path.join(f.directory, 'extra-link'));
      if (change === 'mode') await fs.chmod(path.join(f.root, '190.index.js'), 0o644);
      await assert.rejects(pin.verify(), error => error.code === 'CI_NATIVE_CHANGED' || error.code === 'ENOENT');
      if (relative) assert.match(await fs.readFile(path.join(f.root, relative), 'utf8'), /changed$/);
      if (change === 'add-file') assert.equal(await fs.readFile(path.join(f.root, 'extra.js'), 'utf8'), 'unknown');
    });
}

test('native capture rejects linked resources and unsafe writable files before executing any native command',
  { skip: process.platform === 'win32' ? 'POSIX mode/link privileges are verified separately' : false }, async () => {
    for (const change of ['link', 'writable', 'directory-writable']) {
      const f = await fixture();
      if (change === 'link') { await fs.rename(f.sea, path.join(f.directory, 'preserved-sea'));
        await fs.symlink(path.join(f.directory, 'preserved-sea'), f.sea); }
      if (change === 'writable') await fs.chmod(path.join(f.root, 'node'), 0o666);
      if (change === 'directory-writable') await fs.chmod(path.join(f.root, 'node_modules'), 0o777);
      await assert.rejects(captureCursorCiNativeDistribution(f.command), { code: 'CI_NATIVE_CHANGED' });
    }
  });

test('native command aliases pin their exact original target, not a later replacement',
  { skip: process.platform === 'win32' ? 'Windows symlink privileges are verified separately' : false }, async () => {
    const f = await fixture(), alias = path.join(f.directory, 'agent');
    await fs.symlink(f.command, alias);
    const pin = await captureCursorCiNativeDistribution(alias); await pin.verify();
    await fs.rename(alias, path.join(f.directory, 'preserved-alias'));
    await fs.symlink(f.sea, alias);
    await assert.rejects(pin.verify(), { code: 'CI_NATIVE_CHANGED' });
    assert.equal(await fs.readlink(alias), f.sea, 'unexpected aliases are preserved, not rewritten');
  });

test('unrecognized executables remain preparation-only and never run a version probe', async () => {
  let invoked = 0;
  assert.equal(await prepareCursorCiNativeIdentity({ command: process.execPath, invoke: () => { invoked++; }, options: {} }), null);
  assert.equal(invoked, 0);
});

test('native capture refuses non-sticky writable ancestors without repairing them',
  { skip: process.platform === 'win32' ? 'POSIX parent permissions are verified separately' : false }, async () => {
    const f = await fixture(); await fs.chmod(f.directory, 0o777);
    await assert.rejects(captureCursorCiNativeDistribution(f.command), { code: 'CI_NATIVE_CHANGED' });
    assert.equal((await fs.stat(f.directory)).mode & 0o777, 0o777);
  });
