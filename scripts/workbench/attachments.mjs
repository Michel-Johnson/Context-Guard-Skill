import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { MapError, entries } from '../../prototype/map-model.mjs';
import { hash, atomicWrite, encode, readJSON } from './io.mjs';

const limit = 8 * 1024 * 1024;
const inside = (root, file) => file.startsWith(root + path.sep);

export class Attachments {
  constructor(root) { this.root = root; this.tail = Promise.resolve(); }

  save(input, doc) {
    const next = this.tail.then(() => this.write(input, doc));
    this.tail = next.catch(() => {});
    return next;
  }

  async write({ uploadId, nodeId, name, base64 }, doc) {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(uploadId || '') || typeof name !== 'string' || !name || name.length > 255 || typeof base64 !== 'string') {
      throw new MapError('INVALID_ATTACHMENT', 'Invalid upload ID, filename or base64');
    }
    if (base64.length > Math.ceil(limit / 3) * 4) throw new MapError('ATTACHMENT_TOO_LARGE', '附件最大为 8 MiB', 413);
    if (base64.length % 4 || /[^A-Za-z0-9+/=]/.test(base64)) throw new MapError('INVALID_ATTACHMENT', 'Invalid base64');
    if (!doc?.root || !entries(doc.root).has(nodeId)) throw new MapError('NOT_FOUND', 'Attachment node no longer exists', 404);
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.toString('base64') !== base64) throw new MapError('INVALID_ATTACHMENT', 'Invalid base64');
    if (bytes.length > limit) throw new MapError('ATTACHMENT_TOO_LARGE', '附件最大为 8 MiB', 413);

    const cleanName = path.basename(name.replace(/\\/g, '/')).replace(/[^a-zA-Z0-9._-]/g, '-').slice(-90) || 'attachment.bin';
    const dir = path.join(this.root, 'docs/shots');
    for (const rel of ['docs', 'docs/shots']) {
      const target = path.join(this.root, rel);
      try {
        if (!inside(this.root, await fs.realpath(target))) throw new MapError('INVALID_PATH', 'Attachment directory escapes project', 403);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        await fs.mkdir(target);
      }
    }

    uploadId = uploadId.toLowerCase();
    const rel = `docs/shots/${uploadId}-${cleanName}`;
    const dest = path.join(this.root, rel);
    const receiptFile = path.join(this.root, '.codex/context/private/sync/uploads', `${uploadId}.json`);
    const identity = { uploadId, nodeId, name, path: rel, digest: hash(bytes) };
    const previous = await readJSON(receiptFile, null);
    if (previous && JSON.stringify(previous) !== JSON.stringify(identity)) {
      throw new MapError('UPLOAD_ID_REUSED', 'Upload ID belongs to a different attachment; existing file preserved', 409);
    }
    if (!previous) await atomicWrite(receiptFile, encode(identity));

    const temp = path.join(dir, `.${uploadId}-${randomUUID()}.tmp`);
    let handle;
    try {
      handle = await fs.open(temp, 'wx', 0o600);
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close();
      handle = null;
      try {
        await fs.link(temp, dest);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (!inside(this.root, await fs.realpath(dest)) || hash(await fs.readFile(dest)) !== hash(bytes)) {
          throw new MapError('UPLOAD_ID_REUSED', 'Upload ID already has different content; existing file preserved', 409);
        }
        return { saved: true, duplicate: true, path: rel, name, uploadId };
      }
      return { saved: true, path: rel, name, uploadId };
    } finally {
      if (handle) await handle.close();
      await fs.unlink(temp).catch(() => {});
    }
  }

  async read(rel, doc) {
    if (typeof rel !== 'string' || !rel || rel.includes('\\') || rel.includes(':') || path.isAbsolute(rel) || rel.split('/').some(part => !part || part === '.' || part === '..')) {
      throw new MapError('INVALID_PATH', 'Use a project-relative attachment path', 403);
    }
    const referenced = doc?.root && [...entries(doc.root).values()].some(({ node }) =>
      [node, ...(node.memories || []), ...(node.ideas || []), ...(node.bugs || []), ...(node.dormant || [])]
        .some(owner => (owner.files || []).some(file => (typeof file === 'string' ? file : file.path) === rel))
    );
    if (!referenced) throw new MapError('NOT_FOUND', 'File is not referenced by the current map', 404);
    const target = await fs.realpath(path.join(this.root, rel));
    if (!inside(this.root, target)) throw new MapError('INVALID_PATH', 'Attachment escapes project', 403);
    const stat = await fs.stat(target);
    if (!stat.isFile() || stat.size > limit) throw new MapError('ATTACHMENT_TOO_LARGE', '附件预览最大为 8 MiB', 413);
    return fs.readFile(target);
  }
}
