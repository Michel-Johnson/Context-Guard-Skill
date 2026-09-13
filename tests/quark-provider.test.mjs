import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createQuarkProvider, quarkShare } from '../scripts/cloud/quark-provider.mjs';

test('Quark shares accept only exact HTTPS origin, path and extraction code', () => {
  assert.equal(quarkShare({ share_url: 'https://pan.quark.cn/s/abc', passcode: 'Ab12' }).url, 'https://pan.quark.cn/s/abc');
  for (const url of ['http://pan.quark.cn/s/abc', 'https://pan.quark.cn.evil/s/abc', 'javascript:alert(1)', 'https://user@pan.quark.cn/s/abc', 'https://pan.quark.cn/s/abc?redirect=evil']) assert.throws(() => quarkShare({ share_url: url, passcode: 'Ab12' }));
  assert.throws(() => quarkShare({ share_url: 'https://pan.quark.cn/s/abc', passcode: '' }));
});

test('pinned CLI executes without shell, conversation arguments, or public-share defaults', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'quark-provider-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const cliPath = path.join(directory, 'fake.cjs');
  const source = `const assert=require('node:assert/strict'); const args=process.argv.slice(2); const action=args.shift();
    assert(!args.some(a=>/session|raw-query/.test(a)));
    assert.equal(process.env.CONTEXT_GUARD_PROVIDER_TEST_VALUE,undefined);
    if(action==='share') assert.deepEqual(args,['fid','--url-type','2','--expired-type','1']);
    console.log(JSON.stringify({code:0,action,type:'result',data: action==='upload'?{successCount:1,fids:['fid']}:{share_url:'https://pan.quark.cn/s/abc',passcode:'Ab12'}}));`;
  await fs.writeFile(cliPath, source);
  const previous = process.env.CONTEXT_GUARD_PROVIDER_TEST_VALUE;
  process.env.CONTEXT_GUARD_PROVIDER_TEST_VALUE = 'synthetic-private-setting';
  t.after(() => { if(previous === undefined) delete process.env.CONTEXT_GUARD_PROVIDER_TEST_VALUE; else process.env.CONTEXT_GUARD_PROVIDER_TEST_VALUE = previous; });
  const sha256 = createHash('sha256').update(source).digest('hex');
  await assert.rejects(createQuarkProvider({ cliPath, sha256: '0'.repeat(64) }), { code: 'QUARK_CONFIG' });
  const provider = await createQuarkProvider({ cliPath, sha256 });
  assert.equal(await provider.upload('space ; name.pdf'), 'fid');
  assert.equal((await provider.share('fid')).passcode, 'Ab12');
});

test('CLI timeout is bounded and never returns private stderr', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'quark-timeout-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const cliPath = path.join(directory, 'fake.cjs'), source = `console.error('PRIVATE_ACCOUNT_VALUE');setInterval(()=>{},1000);`;
  await fs.writeFile(cliPath, source);
  const provider = await createQuarkProvider({ cliPath, sha256: createHash('sha256').update(source).digest('hex'), timeoutMs: 150 });
  await assert.rejects(provider.upload('fixture.pdf'), error => error.code === 'QUARK_FAILED' && !error.message.includes('PRIVATE_ACCOUNT'));
});

test('kuake uses private cookie, unique remote paths, bounded visibility retries and protected shares', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'kuake-provider-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const cliPath = path.join(directory, 'kuake'), cookieFile = path.join(directory, 'cookie');
  await fs.writeFile(cliPath, 'synthetic executable');
  await fs.writeFile(cookieFile, '__pus=synthetic-test-value;', { mode: 0o600 });
  const calls = []; let invisible = 2, wrongIdentity = false;
  const spawnProcess = (command, args, options) => {
    assert.equal(command, cliPath);
    assert.equal(options.shell, false);
    assert.equal(options.env.KUAKE_LOAD_DOTENV, '0');
    assert.equal(options.env.KUAKE_COOKIE, '__pus=synthetic-test-value;');
    assert.equal(options.env.CODEX_THREAD_ID, undefined);
    assert(!args.join(' ').includes('synthetic-test-value'));
    calls.push(args);
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => queueMicrotask(() => child.emit('close', 1));
    queueMicrotask(() => {
      const missing = args[0] === 'info' && invisible-- > 0;
      const data = args[0] === 'share' ? { share_url: 'https://pan.quark.cn/s/test', passcode: 'Ab12' } : { fid: wrongIdentity ? 'other' : 'file123' };
      child.stdout.end(JSON.stringify({ success: !missing, code: missing ? 'FILE_NOT_FOUND' : 'OK', data }));
      child.emit('close', missing ? 1 : 0);
    });
    return child;
  };
  const provider = await createQuarkProvider({ cliPath, cookieFile, workDir: directory, backend: 'kuake',
    sha256: createHash('sha256').update('synthetic executable').digest('hex'), spawnProcess, visibilityDelayMs: 1 });
  const uploaded = await provider.upload('/staged/space ; document.pdf');
  assert.equal(uploaded.fileId, 'file123');
  assert.match(uploaded.remotePath, /^\/cloud-[a-f0-9-]{36}\.pdf$/);
  assert.equal(calls.filter(c => c[0] === 'upload').length, 1);
  assert.equal(calls.filter(c => c[0] === 'info').length, 3);
  assert.equal((await provider.share(uploaded.fileId, uploaded.remotePath)).passcode, 'Ab12');
  assert.deepEqual(calls.at(-1), ['share', uploaded.remotePath, '0', 'true']);
  wrongIdentity = true;
  await assert.rejects(provider.share(uploaded.fileId, uploaded.remotePath), { code: 'QUARK_FAILED' });
  await assert.rejects(provider.share(uploaded.fileId, '/personal.pdf'), { code: 'QUARK_FAILED' });
  invisible = 100;
  const before = calls.length;
  await assert.rejects(provider.upload('/staged/not-visible.pdf'), { code: 'QUARK_NOT_VISIBLE' });
  assert.equal(calls.slice(before).filter(c => c[0] === 'upload').length, 1);
  assert.equal(calls.slice(before).filter(c => c[0] === 'info').length, 4);
  await fs.writeFile(cookieFile, 'invalid');
  await assert.rejects(provider.upload('/staged/test.pdf'), { code: 'QUARK_CONFIG' });
});
