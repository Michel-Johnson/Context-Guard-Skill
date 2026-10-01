import fs from 'node:fs/promises';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { atomicWrite, encode, hash, readJSON, withFileLock } from '../shared/io.mjs';
import { MapError } from '../shared/map-model.mjs';

const fail = (code, message, status = 400) => { throw new MapError(code, message, status); };
const scopeId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value);
const metadata = value => Object.fromEntries(['id', 'filename', 'mimeType', 'size', 'hash'].map(key => [key, value[key]]));
const supported = new Set(['text/plain', 'text/markdown', 'application/json', 'image/png', 'image/jpeg', 'image/webp']);

export function validateIntegrationAttachment({ filename, mimeType, base64 }, maxBytes = 8 * 1024 * 1024) {
  if (typeof filename !== 'string' || !filename.trim() || filename.length > 160 || filename === '.' || filename === '..' ||
      /[\x00-\x1f\x7f/\\]/.test(filename)) fail('INVALID_ATTACHMENT', 'Provide a filename, not a disk path');
  if (!supported.has(mimeType)) fail('UNSUPPORTED_ATTACHMENT', 'Use UTF-8 text, PNG, JPEG or WebP', 415);
  if (typeof base64 !== 'string' || !base64.length || base64.length > Math.ceil(maxBytes / 3) * 4) fail('ATTACHMENT_TOO_LARGE', 'Attachment exceeds the size limit', 413);
  if (base64.length % 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) fail('INVALID_ATTACHMENT', 'Attachment bytes must be canonical base64');
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length || bytes.length > maxBytes) fail('ATTACHMENT_TOO_LARGE', 'Attachment exceeds the size limit', 413);
  if (bytes.toString('base64') !== base64) fail('INVALID_ATTACHMENT', 'Attachment bytes must be canonical base64');
  if (mimeType === 'image/png') {
    if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
        bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') fail('INVALID_ATTACHMENT', 'PNG content does not match its MIME type');
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    if (!width || !height || width * height > 40_000_000) fail('ATTACHMENT_TOO_LARGE', 'Image dimensions exceed the limit', 413);
  } else if (mimeType === 'image/jpeg') {
    if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255 ||
        bytes.at(-2) !== 255 || bytes.at(-1) !== 217) fail('INVALID_ATTACHMENT', 'JPEG content does not match its MIME type');
  } else if (mimeType === 'image/webp') {
    if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP' ||
        bytes.readUInt32LE(4) + 8 !== bytes.length || !['VP8 ', 'VP8L', 'VP8X'].includes(bytes.toString('ascii', 12, 16))) fail('INVALID_ATTACHMENT', 'WebP content does not match its MIME type');
  } else {
    if (bytes.length > 256 * 1024) fail('ATTACHMENT_TOO_LARGE', 'Text attachments must be within 256 KiB', 413);
    let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { fail('INVALID_ATTACHMENT', 'Text attachments must be valid UTF-8'); }
    if (text.includes('\0')) fail('INVALID_ATTACHMENT', 'Binary content cannot be uploaded as text');
  }
  return { filename, mimeType, bytes, hash: hash(bytes), size: bytes.length };
}

// This store is private to the integration listener. No paths or credentials are
// returned to the plugin, and scope is checked again when bytes are resolved.
export class IntegrationAttachmentStore {
  constructor({ directory, maxBytes = 8 * 1024 * 1024, maxStoredBytes = 512 * 1024 * 1024 }) {
    if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new Error('Integration attachment directory must be absolute');
    Object.assign(this, { directory, maxBytes, maxStoredBytes });
    this.index = path.join(directory, 'index.json');
  }
  scope(teamId, projectId) {
    if (!scopeId(teamId) || !scopeId(projectId)) fail('INVALID_ARGUMENT', 'Provide a workspace and project');
  }
  file(id) {
    if (typeof id !== 'string' || !/^attachment-[a-f0-9]{64}$/.test(id)) fail('INVALID_ATTACHMENT', 'Invalid attachment reference');
    return path.join(this.directory, 'bytes', id);
  }
  async upload({ teamId, projectId, actor, filename, mimeType, base64 }) {
    this.scope(teamId, projectId);
    if (!actor || actor.teamId !== teamId || typeof actor.userId !== 'string' || !actor.userId) fail('FORBIDDEN', 'Verified attachment actor is required', 403);
    const value = validateIntegrationAttachment({ filename, mimeType, base64 }, this.maxBytes);
    const id = `attachment-${hash(JSON.stringify([teamId, projectId, filename, mimeType, value.hash]))}`;
    return withFileLock(this.index + '.lock', async () => {
      await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
      const records = await readJSON(this.index, { items: {} });
      if (records.items[id]) return metadata(records.items[id]);
      if (Object.keys(records.items).length >= 10000 || Object.values(records.items).reduce((sum, item) => sum + item.size, 0) + value.size > this.maxStoredBytes) fail('ATTACHMENT_STORAGE_FULL', 'Attachment storage quota exceeded', 507);
      const record = { id, teamId, projectId, ...metadata({ id, ...value }), actor: structuredClone(actor), createdAt: new Date().toISOString() };
      await atomicWrite(this.file(id), value.bytes);
      records.items[id] = record;
      await atomicWrite(this.index, encode(records));
      return metadata(record);
    });
  }
  async resolve({ teamId, projectId, id }) {
    this.scope(teamId, projectId);
    const file = this.file(id), record = (await readJSON(this.index, { items: {} })).items[id];
    if (!record || record.teamId !== teamId || record.projectId !== projectId) fail('NOT_FOUND', 'Attachment is unavailable in this project', 404);
    const bytes = await fs.readFile(file).catch(error => { if (error.code === 'ENOENT') fail('ATTACHMENT_UNAVAILABLE', 'Stored attachment bytes are missing', 503); throw error; });
    if (bytes.length !== record.size || hash(bytes) !== record.hash) fail('ATTACHMENT_CORRUPTED', 'Stored attachment integrity check failed', 503);
    return { ...metadata(record), base64: bytes.toString('base64') };
  }
  async read(input) { return this.resolve(input); }
}
