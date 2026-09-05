import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { lookupRepository } from '../scripts/workbench/protocol-repository.mjs';
import { DeviceConnection } from '../scripts/workbench/protocol-device.mjs';

test('IF-039: GitHub supplies repository identity, follows only GitHub redirects and rejects mismatched Cloud identity', async t => {
  const requests = [];
  const actual = await lookupRepository('example/old', { token: '', fetcher: async url => {
    requests.push(String(url));
    return requests.length === 1 ? new Response('', { status: 301, headers: { location: 'https://api.github.com/repositories/123' } })
      : new Response(JSON.stringify({ id: 123, full_name: 'example/renamed' }));
  } });
  assert.deepEqual(actual, { repositoryId: '123', slug: 'example/renamed' });
  await assert.rejects(lookupRepository('example/repo', { token: '', fetcher: async () => new Response('', { status: 302, headers: { location: 'https://untrusted.example/steal' } }) }), { code: 'FORBIDDEN' });
  await assert.rejects(lookupRepository('example/repo', { token: '', fetcher: async () => new Response('{}') }), { code: 'UNAVAILABLE' });
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-repository-id-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const calls = [];
  const device = new DeviceConnection({ directory, origin: 'https://cloud.example', transport: async (_origin, _credential, message, options) => {
    calls.push(message.type);
    if (message.type === 'auth.open') { options.receiveCredential('synthetic-credential'); return { repositoryId: '456' }; }
    return {};
  } });
  await assert.rejects(device.connect({ v: 2, id: 'login', type: 'auth.open', payload: { repository: 'https://github.com/example/repo', clientId: 'ignored', password: 'test-only' } }, actual), { code: 'FORBIDDEN' });
  assert.equal(await device.connected(), false); assert.deepEqual(calls, ['auth.open', 'auth.close']);
});
