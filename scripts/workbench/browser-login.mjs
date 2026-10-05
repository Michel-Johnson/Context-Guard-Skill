import path from 'node:path';
import os from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { atomicWrite, encode, readJSON, withFileLock, pause } from '../shared/io.mjs';
import { fail } from '../shared/protocol.mjs';

async function request(origin, route, input, fetcher, timeoutMs = 15000) {
  let response;
  try {
    response = await fetcher(new URL(route, origin), { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
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
export async function browserLogin(device, { repository, repositoryId, wait = false, onPending = () => {}, fetcher = fetch, label = os.hostname(), clock = () => performance.now(), sleep = pause }) {
  const origin = new URL(device.origin);
  if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash || origin.protocol !== 'https:' && !(device.allowLoopback && origin.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname))) fail('FORBIDDEN', 'Cloud authorization requires an HTTPS origin');
  const file = path.join(device.directory, 'browser-login.json');
  let deadline = clock() + 600000, grant;
  const checkDeadline = () => {
    if (wait && clock() >= deadline) fail('UNAUTHORIZED', 'Browser authorization expired; retry the connection command');
  };
  const authorize = async (route, input) => {
    checkDeadline();
    try {
      const result = await request(device.origin, route, input, fetcher, wait ? Math.max(1, Math.min(15000, Math.ceil(deadline - clock()))) : 15000);
      checkDeadline();
      return result;
    } catch (error) { checkDeadline(); throw error; }
  };
  let first = true;
  for (;;) {
    checkDeadline();
    const outcome = await withFileLock(file + '.lock', async () => {
      checkDeadline();
      const connected = await readJSON(device.file, null);
      if (connected?.origin === device.origin && connected.repositoryId === repositoryId && connected.credential) {
        try {
          await device.transmit({ v: 2, id: randomUUID(), type: 'sync.heartbeat', payload: { sessions: [] } });
          checkDeadline();
          const { credential: _secret, origin: _origin, ...data } = connected;
          return { connected: true, ...data };
        } catch (error) {
          if (error.code !== 'UNAUTHORIZED') throw error;
        }
      }
      let pending = await readJSON(file, null);
      checkDeadline();
      if (grant && ['deviceCode', 'verificationUrl', 'userCode', 'expiresAt', 'origin', 'repository', 'repositoryId'].some(key => pending?.[key] !== grant[key])) fail('CONFLICT', 'Browser authorization changed; retry the connection command');
      if (!pending?.deviceCode || pending.origin !== device.origin || pending.repository !== repository || pending.repositoryId !== repositoryId || !Number.isFinite(Date.parse(pending.expiresAt)) || !grant && Date.parse(pending.expiresAt) <= Date.now()) {
        pending = { origin: device.origin, repository, repositoryId, deviceCode: randomBytes(32).toString('base64url'), label: String(label).slice(0, 80),
          expiresAt: new Date(Date.now() + 600000).toISOString() };
        await atomicWrite(file, encode(pending));
      }
      if (!pending.verificationUrl) {
        const identity = await device.identity();
        const { data } = await authorize('/api/auth/device/start', { repository, clientId: identity.clientId, deviceCode: pending.deviceCode, label: pending.label });
        const verification = new URL(data.verificationPath, device.origin);
        if (verification.origin !== device.origin || verification.pathname !== '/connect' || !/^[A-F0-9]{4}-[A-F0-9]{4}$/.test(data.userCode) || verification.searchParams.get('code') !== data.userCode || !Number.isFinite(Date.parse(data.expiresAt)) || !Number.isInteger(data.expiresIn) || data.expiresIn <= 0 || data.expiresIn > 600) fail('UNAVAILABLE', 'Cloud returned an invalid authorization link');
        pending = { ...pending, verificationUrl: verification.href, userCode: data.userCode, expiresAt: new Date(Date.now() + data.expiresIn * 1000).toISOString() };
        await atomicWrite(file, encode(pending));
      }
      const safe = { connected: false, authorizationRequired: true, verificationUrl: pending.verificationUrl, userCode: pending.userCode, expiresAt: pending.expiresAt };
      if (wait && !grant) {
        // A displayed grant and this invocation's budget never renew in a wait loop.
        deadline = Math.min(deadline, clock() + Math.max(0, Date.parse(pending.expiresAt) - Date.now()));
        grant = { ...pending };
      }
      checkDeadline();
      if (first) await onPending(safe);
      let result;
      try { result = await authorize('/api/auth/device/poll', { deviceCode: pending.deviceCode }); }
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
    checkDeadline();
    first = false;
    await sleep(Math.min(5000, Math.max(1, deadline - clock())));
    checkDeadline();
  }
}
