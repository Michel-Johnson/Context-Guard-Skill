import path from 'node:path';
import os from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { atomicWrite, encode, readJSON, withFileLock, pause } from '../shared/io.mjs';
import { fail } from '../shared/protocol.mjs';

const terminalReasons = new Set(['authorization-already-claimed', 'authorization-denied', 'authorization-expired', 'repository-access-revoked']);
function lifetime(data) {
  if (data.persistent === true && data.status === 'pending' && data.expiresAt === null && data.expiresIn === null) return { persistent: true, expiresAt: null };
  if (data.persistent !== undefined && data.persistent !== false || data.persistent === false && data.status !== 'approved' ||
      typeof data.expiresAt !== 'string' || !Number.isFinite(Date.parse(data.expiresAt)) || !Number.isInteger(data.expiresIn) || data.expiresIn <= 0 || data.expiresIn > 600) {
    fail('UNAVAILABLE', 'Cloud returned an invalid authorization lifetime');
  }
  return { persistent: false, expiresAt: new Date(Date.now() + data.expiresIn * 1000).toISOString() };
}

async function request(origin, route, input, fetcher, timeoutMs = 15000) {
  let response;
  try {
    response = await fetcher(new URL(route, origin), { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
      headers: { 'Content-Type': 'application/json', ...(route.endsWith('/start') ? { 'X-Context-Guard-Device-Grant': 'persistent-v1' } : {}) }, body: JSON.stringify(input) });
  } catch (error) {
    const beforeConnection = ['ENOTFOUND', 'ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT'].includes(error?.cause?.code || error?.code);
    fail('UNAVAILABLE', route.endsWith('/poll') && !beforeConnection ? 'Authorization claim outcome is unknown; explicitly retry browser authorization' : 'Cloud authorization is unavailable; retry the same connection command',
      { retryableConnection: route.endsWith('/start') || beforeConnection });
  }
  if ([404, 405, 426].includes(response.status)) fail('UPGRADE_REQUIRED', 'Cloud does not support browser authorization; upgrade Cloud or use the explicit private-input login');
  if (!response.headers.get('content-type')?.includes('application/json')) fail('UNAVAILABLE', 'Cloud returned an invalid authorization reply');
  let result;
  try {
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > 16384) fail('TOO_LARGE', 'Authorization reply is too large'); chunks.push(chunk); }
    result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) { if (error.code === 'TOO_LARGE') throw error; fail('UNAVAILABLE', 'Cloud authorization reply was interrupted'); }
  if (!response.ok || result?.ok !== true) fail(result?.error?.code || 'UNAVAILABLE', result?.error?.message || 'Cloud authorization failed',
    { retryableConnection: [502, 503, 504].includes(response.status) && result?.error?.code === 'UNAVAILABLE' && result.error.retryable === true,
      ...(terminalReasons.has(result?.error?.reason) ? { reason: result.error.reason } : {}) });
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
    if (wait && clock() >= deadline) fail('UNAUTHORIZED', 'Browser authorization expired; retry the connection command', { reason: 'authorization-wait-expired' });
  };
  const recordFailure = async (pending, error, phase) => {
    // Keep the exact request after uncertain claims. Only a later explicit
    // invocation may replace a definitively rejected request for fresh approval.
    const terminal = ['UNAUTHORIZED', 'FORBIDDEN'].includes(error.code) && error.details?.reason !== 'authorization-wait-expired' &&
      (phase === 'poll' || terminalReasons.has(error.details?.reason));
    await atomicWrite(file, encode({ ...pending, ...(terminal ? { status: error.code } : {}),
      lastFailure: { code: ['UNAUTHORIZED', 'FORBIDDEN', 'UNAVAILABLE', 'UPGRADE_REQUIRED', 'TOO_LARGE'].includes(error.code) ? error.code : 'UNAVAILABLE',
        ...(terminalReasons.has(error.details?.reason) ? { reason: error.details.reason } : {}), at: new Date().toISOString() } }));
  };
  const authorize = async (route, input) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      checkDeadline();
      try {
        const result = await request(device.origin, route, input, fetcher, wait ? Math.max(1, Math.min(15000, Math.ceil(deadline - clock()))) : 15000);
        checkDeadline();
        return result;
      } catch (error) {
        checkDeadline();
        if (attempt === 2 || error.code !== 'UNAVAILABLE' || error.details?.retryableConnection !== true) throw error;
        await sleep(wait ? Math.min(250 * 2 ** attempt, Math.max(1, deadline - clock())) : 250 * 2 ** attempt);
        checkDeadline();
      }
    }
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
      if (grant && ['deviceCode', 'verificationUrl', 'userCode', 'persistent', 'expiresAt', 'origin', 'repository', 'repositoryId'].some(key => pending?.[key] !== grant[key])) fail('CONFLICT', 'Browser authorization changed; retry the connection command');
      if (!pending?.deviceCode || pending.origin !== device.origin || pending.repository !== repository || pending.repositoryId !== repositoryId || !grant && ['UNAUTHORIZED', 'FORBIDDEN'].includes(pending.status)) {
        const previousOutcome = pending?.lastFailure;
        pending = { origin: device.origin, repository, repositoryId, deviceCode: randomBytes(32).toString('base64url'), label: String(label).slice(0, 80),
          expiresAt: new Date(Date.now() + 600000).toISOString(), ...(previousOutcome ? { previousOutcome } : {}) };
        await atomicWrite(file, encode(pending));
      }
      if (pending.verificationUrl && !(pending.persistent === true && pending.expiresAt === null) &&
          (pending.persistent !== undefined && pending.persistent !== false || !Number.isFinite(Date.parse(pending.expiresAt)))) fail('UNAVAILABLE', 'Stored authorization has an invalid lifetime');
      if (!pending.verificationUrl || !grant && pending.persistent !== true && Date.parse(pending.expiresAt) <= Date.now()) {
        const identity = await device.identity();
        let data;
        try { ({ data } = await authorize('/api/auth/device/start', { repository, clientId: identity.clientId, deviceCode: pending.deviceCode, label: pending.label })); }
        catch (error) { await recordFailure(pending, error, 'start'); throw error; }
        const verification = new URL(data.verificationPath, device.origin);
        if (verification.origin !== device.origin || verification.pathname !== '/connect' || !/^[A-F0-9]{4}-[A-F0-9]{4}$/.test(data.userCode) || verification.searchParams.get('code') !== data.userCode) fail('UNAVAILABLE', 'Cloud returned an invalid authorization link');
        pending = { ...pending, verificationUrl: verification.href, userCode: data.userCode, ...lifetime(data) };
        await atomicWrite(file, encode(pending));
      }
      const safe = { connected: false, authorizationRequired: true, verificationUrl: pending.verificationUrl, userCode: pending.userCode,
        persistent: pending.persistent === true, expiresAt: pending.expiresAt };
      if (wait && !grant) {
        // Only an explicitly negotiated pending grant has no approval deadline.
        // Finite grants keep the original monotonic invocation budget.
        deadline = pending.persistent === true ? Infinity : Math.min(deadline, clock() + Math.max(0, Date.parse(pending.expiresAt) - Date.now()));
        grant = { ...pending };
      }
      checkDeadline();
      if (first) await onPending(safe);
      let result;
      try {
        result = await authorize('/api/auth/device/poll', { deviceCode: pending.deviceCode });
        if (result.data.status === 'pending') return safe;
        if (!result.credential || result.credential.length < 32 || !result.data.projectId || !result.data.capabilities?.includes('device-memory')) fail('UNAVAILABLE', 'Cloud did not issue a project device connection');
      }
      catch (error) {
        await recordFailure(pending, error, 'poll');
        throw error;
      }
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
