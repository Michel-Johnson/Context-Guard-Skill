import path from 'node:path';
import os from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { atomicWrite, encode, readJSON, withFileLock, pause } from '../shared/io.mjs';
import { fail } from '../shared/protocol.mjs';

async function request(origin, route, input, fetcher) {
  let response;
  try {
    response = await fetcher(new URL(route, origin), { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  } catch { fail('UNAVAILABLE', 'Cloud authorization is unavailable; retry the same connection command'); }
  if ([404, 405, 426].includes(response.status)) fail('UPGRADE_REQUIRED', 'Cloud does not support browser authorization; upgrade Cloud or use the explicit private-input login');
  if (!response.headers.get('content-type')?.includes('application/json')) fail('UNAVAILABLE', 'Cloud returned an invalid authorization reply');
  let result;
  try {
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > 16384) fail('TOO_LARGE', 'Authorization reply is too large'); chunks.push(chunk); }
    result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) { if (error.code === 'TOO_LARGE') throw error; fail('UNAVAILABLE', 'Cloud authorization reply was interrupted'); }
  if (!response.ok || result?.ok !== true) fail(result?.error?.code || 'UNAVAILABLE', result?.error?.message || 'Cloud authorization failed');
  if (!result.data || typeof result.data !== 'object') fail('UNAVAILABLE', 'Cloud returned an invalid authorization reply');
  return { data: result.data, credential: response.headers.get('x-context-guard-credential') };
}

// The model sees only the verification URL/code. The backend keeps the claim
// secret and final credential private, including across a stopped CLI invocation.
export async function browserLogin(device, { repository, repositoryId, wait = false, onPending = () => {}, fetcher = fetch, label = os.hostname() }) {
  const origin = new URL(device.origin);
  if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash || origin.protocol !== 'https:' && !(device.allowLoopback && origin.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname))) fail('FORBIDDEN', 'Cloud authorization requires an HTTPS origin');
  const file = path.join(device.directory, 'browser-login.json');
  let first = true;
  for (;;) {
    const outcome = await withFileLock(file + '.lock', async () => {
      const connected = await readJSON(device.file, null);
      if (connected?.origin === device.origin && connected.repositoryId === repositoryId && connected.credential) {
        try {
          await device.transmit({ v: 2, id: randomUUID(), type: 'sync.heartbeat', payload: { sessions: [] } });
          const { credential: _secret, origin: _origin, ...data } = connected;
          return { connected: true, ...data };
        } catch (error) {
          if (error.code !== 'UNAUTHORIZED') throw error;
        }
      }
      let pending = await readJSON(file, null);
      if (!pending?.deviceCode || pending.origin !== device.origin || pending.repository !== repository || pending.repositoryId !== repositoryId || Date.parse(pending.expiresAt) <= Date.now()) {
        pending = { origin: device.origin, repository, repositoryId, deviceCode: randomBytes(32).toString('base64url'), label: String(label).slice(0, 80),
          expiresAt: new Date(Date.now() + 600000).toISOString() };
        await atomicWrite(file, encode(pending));
      }
      if (!pending.verificationUrl) {
        const identity = await device.identity();
        const { data } = await request(device.origin, '/api/auth/device/start', { repository, clientId: identity.clientId, deviceCode: pending.deviceCode, label: pending.label }, fetcher);
        const verification = new URL(data.verificationPath, device.origin);
        if (verification.origin !== device.origin || verification.pathname !== '/connect' || !/^[A-F0-9]{4}-[A-F0-9]{4}$/.test(data.userCode) || verification.searchParams.get('code') !== data.userCode || !Number.isFinite(Date.parse(data.expiresAt)) || !Number.isInteger(data.expiresIn) || data.expiresIn <= 0 || data.expiresIn > 600) fail('UNAVAILABLE', 'Cloud returned an invalid authorization link');
        pending = { ...pending, verificationUrl: verification.href, userCode: data.userCode, expiresAt: new Date(Date.now() + data.expiresIn * 1000).toISOString() };
        await atomicWrite(file, encode(pending));
      }
      const safe = { connected: false, authorizationRequired: true, verificationUrl: pending.verificationUrl, userCode: pending.userCode, expiresAt: pending.expiresAt };
      if (first) await onPending(safe);
      let result;
      try { result = await request(device.origin, '/api/auth/device/poll', { deviceCode: pending.deviceCode }, fetcher); }
      catch (error) {
        if (['UNAUTHORIZED', 'FORBIDDEN'].includes(error.code)) await atomicWrite(file, encode({ status: error.code }));
        throw error;
      }
      if (result.data.status === 'pending') return safe;
      if (!result.credential || result.credential.length < 32 || !result.data.projectId || !result.data.capabilities?.includes('device-memory')) fail('UNAVAILABLE', 'Cloud did not issue a project device connection');
      await device.saveConnection(result.data, result.credential, { repositoryId });
      await atomicWrite(file, encode({ status: 'connected' }));
      return { connected: true, ...result.data };
    });
    if (outcome.connected || !wait) return outcome;
    if (Date.now() >= Date.parse(outcome.expiresAt)) fail('UNAUTHORIZED', 'Browser authorization expired; retry the connection command');
    first = false;
    await pause(5000);
  }
}
