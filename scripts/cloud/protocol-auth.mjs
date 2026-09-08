import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { atomicWrite, encode, hash, readJSON, withFileLock } from '../shared/io.mjs';
import { fail, validateMessage } from '../shared/protocol.mjs';

export function repositorySlug(value) {
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(value || '');
  if (!match || match.slice(1).some(p => p === '.' || p === '..')) fail('INVALID_ARGUMENT', 'Expected a GitHub repository remote');
  return `${match[1]}/${match[2]}`.toLowerCase();
}

// The trusted host supplies password verification, repository authorization and
// pre-registered client identities. No body field can select a privileged role.
export class ProtocolAuth {
  constructor({ directory, verifyPassword, resolveIdentity, authorizeRepository, now = Date.now,
    lifetimeMs = 60 * 60 * 1000, renewWindowMs = Math.min(lifetimeMs / 4, 5 * 60 * 1000), recoveryMs = 7 * 24 * 60 * 60 * 1000 }) {
    this.file = path.join(directory, 'connections.json');
    this.verifyPassword = verifyPassword; this.resolveIdentity = resolveIdentity; this.now = now; this.lifetimeMs = lifetimeMs;
    this.renewWindowMs = renewWindowMs; this.recoveryMs = recoveryMs;
    this.authorizeRepository = authorizeRepository;
    this.failures = new Map();
  }
  async open(input, remoteAddress) {
    validateMessage(input);
    if (input.type !== 'auth.open') fail('INVALID_ARGUMENT', 'Expected auth.open');
    const time = this.now(), recent = this.failures.get(remoteAddress);
    if (recent && recent.until > time && recent.count >= 5) fail('FORBIDDEN', 'Login temporarily rate limited');
    const slug = repositorySlug(input.payload.repository);
    if (!await this.verifyPassword(input.payload.password)) {
      this.failures.set(remoteAddress, { count: recent && recent.until > time ? recent.count + 1 : 1, until: time + 300000 });
      fail('UNAUTHORIZED', 'Login failed');
    }
    let principal = await this.resolveIdentity(slug, input.payload.clientId);
    const repositoryId = !principal && await this.authorizeRepository?.(slug);
    if (!principal && !repositoryId) fail('FORBIDDEN', 'Repository is not authorized');
    const credential = randomBytes(32).toString('base64url'), connectionId = randomUUID(), expiresAt = time + this.lifetimeMs;
    await withFileLock(`${this.file}.lock`, async () => {
      const state = await readJSON(this.file, { connections: {} });
      if (!principal) {
        state.devices ||= {};
        const deviceKey = hash(`${repositoryId}\0${input.payload.clientId}`);
        state.devices[deviceKey] ||= randomUUID();
        const deviceId = state.devices[deviceKey];
        principal = { repositoryId, deviceId, agentId: `device:${deviceId}`, role: 'device' };
      }
      if (['repositoryId', 'deviceId', 'agentId'].some(k => typeof principal[k] !== 'string' || !principal[k])) fail('FORBIDDEN', 'Invalid registered identity');
      // Only runtime credentials expire; no development memory is pruned.
      for (const [key, entry] of Object.entries(state.connections)) if (entry.expiresAt + this.recoveryMs <= time) delete state.connections[key];
      state.connections[hash(credential)] = { connectionId, expiresAt, principal: { ...principal, repositorySlug: slug, clientId: input.payload.clientId } };
      await atomicWrite(this.file, encode(state));
    });
    this.failures.delete(remoteAddress);
    return { credential, data: { connectionId, repositoryId: principal.repositoryId, expiresAt: new Date(expiresAt).toISOString() } };
  }
  async authenticate(credential) {
    if (typeof credential !== 'string' || !credential) fail('UNAUTHORIZED', 'Connection credential required');
    const time = this.now(), credentialHash = hash(credential);
    const state = await readJSON(this.file, { connections: {} }), entry = state.connections[credentialHash];
    if (!entry || entry.expiresAt + this.recoveryMs <= time) fail('UNAUTHORIZED', 'Connection expired or was revoked');
    let principal;
    if (entry.principal.role === 'device') {
      if (await this.authorizeRepository?.(entry.principal.repositorySlug) !== entry.principal.repositoryId) fail('FORBIDDEN', 'Repository access revoked');
      principal = entry.principal;
    } else {
      const current = await this.resolveIdentity(entry.principal.repositorySlug, entry.principal.clientId);
      if (!current || current.repositoryId !== entry.principal.repositoryId || current.deviceId !== entry.principal.deviceId || current.agentId !== entry.principal.agentId) fail('FORBIDDEN', 'Client registration was revoked or changed');
      principal = current;
    }
    if (entry.expiresAt - time <= this.renewWindowMs) {
      await withFileLock(`${this.file}.lock`, async () => {
        const latest = await readJSON(this.file, { connections: {} }), current = latest.connections[credentialHash];
        if (!current || current.expiresAt + this.recoveryMs <= time) fail('UNAUTHORIZED', 'Connection expired or was revoked');
        if (current.expiresAt - time <= this.renewWindowMs) {
          current.expiresAt = time + this.lifetimeMs;
          await atomicWrite(this.file, encode(latest));
        }
      });
    }
    return principal;
  }
  async close(credential) {
    if (typeof credential !== 'string' || !credential) fail('UNAUTHORIZED', 'Connection credential required');
    await withFileLock(`${this.file}.lock`, async () => {
      const state = await readJSON(this.file, { connections: {} });
      delete state.connections[hash(credential)];
      await atomicWrite(this.file, encode(state));
    });
    return {};
  }
}
