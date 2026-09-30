import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { atomicWrite, encode, hash, readJSON, withFileLock } from '../shared/io.mjs';
import { fail } from '../shared/protocol.mjs';
import { repositorySlug } from './protocol-auth.mjs';

const secretPattern = /^[A-Za-z0-9_-]{43}$/;
const codePattern = /^[A-F0-9]{4}-[A-F0-9]{4}$/;
const equal = (a, b) => secretPattern.test(a || '') && secretPattern.test(b || '') && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// Short-lived grants survive a restart. Secrets are hashed; credentials are
// issued only after browser approval and are never retained in this ledger.
export class DeviceAuthorization {
  constructor({ directory, authorizeRepository, issueDevice, now = Date.now, lifetimeMs = 600000 }) {
    this.file = path.join(directory, 'device-authorizations.json');
    this.authorizeRepository = authorizeRepository; this.issueDevice = issueDevice;
    this.now = now; this.lifetimeMs = lifetimeMs; this.attempts = new Map();
  }
  limit(address) {
    const time = this.now(), prior = this.attempts.get(address);
    for (const [key, value] of this.attempts) if (value.until <= time) this.attempts.delete(key);
    if (prior?.until > time && prior.count >= 20 || !prior && this.attempts.size >= 10000) fail('FORBIDDEN', 'Authorization attempts temporarily rate limited');
    this.attempts.set(address, { count: prior?.until > time ? prior.count + 1 : 1, until: prior?.until > time ? prior.until : time + 60000 });
  }
  async transaction(action) {
    return withFileLock(this.file + '.lock', async () => {
      const state = await readJSON(this.file, { grants: {} });
      const result = await action(state);
      await atomicWrite(this.file, encode(state));
      return result;
    });
  }
  async start(input, address) {
    this.limit(address);
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['repository', 'clientId', 'deviceCode', 'label'].includes(k)) ||
        typeof input.clientId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(input.clientId) || !secretPattern.test(input.deviceCode) ||
        typeof input.label !== 'string' || !input.label.trim() || input.label.length > 80 || /[\x00-\x1f]/.test(input.label)) fail('INVALID_ARGUMENT', 'Invalid device authorization request');
    const slug = repositorySlug(input.repository), repositoryId = await this.authorizeRepository(slug);
    if (!repositoryId) fail('FORBIDDEN', 'Repository is not authorized');
    return this.transaction(state => {
      const key = hash(input.deviceCode), time = this.now();
      for (const [id, grant] of Object.entries(state.grants)) if (grant.expiresAt <= time) delete state.grants[id];
      let grant = state.grants[key];
      if (grant && (grant.repository !== slug || grant.clientId !== input.clientId || grant.label !== input.label)) fail('ID_REUSED', 'Authorization request identity changed');
      if (grant?.claimed) fail('UNAUTHORIZED', 'Authorization was already claimed; start a new request');
      if (!grant) {
        if (Object.keys(state.grants).length >= 1000) fail('UNAVAILABLE', 'Too many pending authorizations');
        let userCode;
        do {
          const bytes = randomBytes(4).toString('hex').toUpperCase(); userCode = bytes.slice(0, 4) + '-' + bytes.slice(4);
        } while (Object.values(state.grants).some(value => value.userCode === userCode));
        grant = state.grants[key] = { repository: slug, repositoryId, clientId: input.clientId, label: input.label,
          userCode, csrf: randomBytes(32).toString('base64url'), expiresAt: time + this.lifetimeMs, status: 'pending' };
      }
      return { userCode: grant.userCode, expiresAt: new Date(grant.expiresAt).toISOString(), expiresIn: Math.ceil((grant.expiresAt - time) / 1000), interval: 5 };
    });
  }
  async view(code, address) {
    this.limit(address);
    if (!codePattern.test(code || '')) fail('INVALID_ARGUMENT', 'Invalid authorization code');
    const state = await readJSON(this.file, { grants: {} });
    const grant = Object.values(state.grants).find(value => value.userCode === code && value.expiresAt > this.now());
    if (!grant) fail('NOT_FOUND', 'Authorization expired or was not found');
    return grant;
  }
  async decide({ userCode, csrf, decision }, address) {
    this.limit(address);
    if (!codePattern.test(userCode || '') || !['approve', 'deny'].includes(decision)) fail('INVALID_ARGUMENT', 'Invalid authorization decision');
    return this.transaction(async state => {
      const grant = Object.values(state.grants).find(value => value.userCode === userCode && value.expiresAt > this.now());
      if (!grant || !equal(csrf, grant.csrf)) fail('FORBIDDEN', 'Authorization form expired; reload it');
      if (grant.claimed || grant.status !== 'pending') fail('CONFLICT', 'Authorization already decided');
      if (await this.authorizeRepository(grant.repository) !== grant.repositoryId) fail('FORBIDDEN', 'Repository access revoked');
      grant.status = decision === 'approve' ? 'approved' : 'denied';
      return { status: grant.status };
    });
  }
  async poll(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => k !== 'deviceCode') || !secretPattern.test(input.deviceCode)) fail('INVALID_ARGUMENT', 'Invalid authorization claim');
    return this.transaction(async state => {
      const grant = state.grants[hash(input.deviceCode)];
      if (!grant || grant.expiresAt <= this.now()) fail('UNAUTHORIZED', 'Authorization expired; start a new request');
      if (grant.claimed) fail('UNAUTHORIZED', 'Authorization already claimed; if its reply was lost, start a new request');
      if (grant.status === 'denied') fail('FORBIDDEN', 'Device authorization was declined');
      if (grant.status === 'pending') return { data: { status: 'pending', interval: 5 } };
      if (await this.authorizeRepository(grant.repository) !== grant.repositoryId) fail('FORBIDDEN', 'Repository access revoked');
      // Persist consumption before issuing. A crash cannot make the same grant
      // issue twice; an uncertain claim requires a new browser authorization.
      grant.claimed = true;
      await atomicWrite(this.file, encode(state));
      return this.issueDevice(`https://github.com/${grant.repository}`, grant.clientId);
    });
  }
}
