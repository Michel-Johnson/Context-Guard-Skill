import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { atomicWrite, encode, hash, readJSON, withFileLock } from './io.mjs';
import { canonical, fail, payloadRules } from './protocol.mjs';

const CHUNK = 1024 * 1024;
// Authentication and binding checks belong to the caller, before any body is read.
export async function serveBlob(req, res, { blobs, principal, session, blobId }) {
  if (req.method === 'PUT') {
    const chunks = []; let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > CHUNK) fail('TOO_LARGE', 'Chunk exceeds 1 MiB');
      chunks.push(chunk);
    }
    const result = await blobs.put(principal, session, blobId, req.headers['content-range'], Buffer.concat(chunks));
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify(result));
  }
  if (req.method !== 'GET') fail('INVALID_ARGUMENT', 'Use PUT or GET');
  const data = await blobs.read(principal, session, blobId, req.headers.range);
  res.writeHead(req.headers.range ? 206 : 200, {
    'Content-Type': 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store',
    ETag: `"${data.sha256}"`, 'Accept-Ranges': 'bytes', 'Content-Length': data.bytes.length,
    ...(req.headers.range ? { 'Content-Range': `bytes ${data.start}-${data.end}/${data.size}` } : {}),
  });
  return res.end(data.bytes);
}
// Private, content-addressed chunks are immutable. Metadata advances only after
// each chunk is fsynced. A lost reply can safely resend the same byte range.
export class ProtocolBlobs {
  constructor(directory) { this.directory = path.resolve(directory); }
  owner(principal, session) { return hash(canonical([principal.repositoryId, session.id, session.generation])); }
  directoryFor(principal, session, blobId) {
    if (!/^[a-f0-9]{64}$/.test(blobId)) fail('INVALID_ARGUMENT', 'Invalid blob ID');
    return path.join(this.directory, this.owner(principal, session), blobId);
  }
  async register(principal, session, metadata) {
    payloadRules['blob.put'](metadata);
    const blobId = hash(canonical(metadata)), directory = this.directoryFor(principal, session, blobId);
    return withFileLock(path.join(directory, 'lock'), async () => {
      const file = path.join(directory, 'metadata.json');
      let record = await readJSON(file, null);
      if (!record) {
        if (metadata.size === 0 && metadata.sha256 !== hash(Buffer.alloc(0))) fail('INVALID_ARGUMENT', 'Empty file hash mismatch');
        record = { ...metadata, offset: 0, complete: metadata.size === 0, chunks: [] };
        await atomicWrite(file, encode(record));
      }
      return { blobId, uploadPath: `/api/v2/blobs/${blobId}`, offset: record.offset };
    });
  }
  async put(principal, session, blobId, range, bytes) {
    const directory = this.directoryFor(principal, session, blobId);
    const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range || '');
    if (!match || !Buffer.isBuffer(bytes) || bytes.length > CHUNK || bytes.length === 0) fail('INVALID_ARGUMENT', 'Expected a Content-Range and at most 1 MiB');
    const [start, end, total] = match.slice(1).map(Number);
    if (![start, end, total].every(Number.isSafeInteger) || end - start + 1 !== bytes.length || end >= total) fail('INVALID_ARGUMENT', 'Invalid byte range');
    return withFileLock(path.join(directory, 'lock'), async () => {
      const file = path.join(directory, 'metadata.json'), record = await readJSON(file, null);
      if (!record) fail('NOT_FOUND', 'Blob is not registered in this Session');
      if (total !== record.size) fail('CONFLICT', 'Blob length differs from registration');
      const digest = hash(bytes), previous = record.chunks.find(c => c.start === start);
      if (previous) {
        if (previous.end !== end || previous.digest !== digest) fail('CONFLICT', 'Repeated chunk differs');
        return { offset: record.offset, complete: record.complete };
      }
      if (start !== record.offset) fail('CONFLICT', 'Send the next contiguous range', { offset: record.offset });
      const chunkFile = path.join(directory, `${start}-${digest}.chunk`);
      if (end + 1 === record.size) {
        const full = createHash('sha256');
        for (const chunk of record.chunks) {
          const data = await fs.readFile(path.join(directory, `${chunk.start}-${chunk.digest}.chunk`));
          if (hash(data) !== chunk.digest) fail('UNAVAILABLE', 'Stored chunk is corrupt');
          full.update(data);
        }
        full.update(bytes);
        if (full.digest('hex') !== record.sha256) fail('CONFLICT', 'Completed file hash does not match registration');
        record.complete = true;
      }
      await atomicWrite(chunkFile, bytes);
      record.chunks.push({ start, end, digest }); record.offset = end + 1;
      await atomicWrite(file, encode(record));
      return { offset: record.offset, complete: record.complete };
    });
  }
  async metadata(principal, session, blobId) {
    const record = await readJSON(path.join(this.directoryFor(principal, session, blobId), 'metadata.json'), null);
    if (!record?.complete) fail('NOT_FOUND', 'Blob is missing or incomplete');
    return { downloadPath: `/api/v2/blobs/${blobId}`, size: record.size, sha256: record.sha256, mediaType: record.mediaType };
  }
  async read(principal, session, blobId, range) {
    const directory = this.directoryFor(principal, session, blobId);
    const metadata = await this.metadata(principal, session, blobId);
    let start = 0, end = metadata.size - 1;
    if (range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(range);
      if (!match) fail('INVALID_ARGUMENT', 'Use a single byte range');
      start = Number(match[1]); end = match[2] ? Number(match[2]) : end;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || end >= metadata.size) fail('INVALID_ARGUMENT', 'Range is outside the file');
    }
    const record = await readJSON(path.join(directory, 'metadata.json'));
    const chunks = [];
    for (const chunk of record.chunks) {
      if (chunk.end < start || chunk.start > end) continue;
      const bytes = await fs.readFile(path.join(directory, `${chunk.start}-${chunk.digest}.chunk`));
      if (hash(bytes) !== chunk.digest) fail('UNAVAILABLE', 'Stored chunk is corrupt');
      chunks.push(bytes.subarray(Math.max(0, start - chunk.start), Math.min(bytes.length, end - chunk.start + 1)));
    }
    return { bytes: Buffer.concat(chunks), start, end, ...metadata };
  }
}
