import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWrite, readJSON, withFileLock, hash, encode } from '../shared/io.mjs';
import { MapError, entries } from '../shared/map-model.mjs';
import { quarkShare } from './quark-provider.mjs';

const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const fail = (code, message, status = 400) => { throw new MapError(code, message, status); };
export function attachmentInput(input) {
  if (!input || Object.keys(input).some(key => !['uploadId', 'target', 'name', 'base64'].includes(key)) || !validId(input.uploadId)) fail('INVALID_ATTACHMENT', 'Invalid attachment request');
  const t = input.target;
  if (!t || Object.keys(t).some(key => !['nodeId', 'kind', 'ownerId'].includes(key)) || !validId(t.nodeId) || !validId(t.ownerId) || !['node', 'bug', 'mem', 'idea', 'dorm'].includes(t.kind)) fail('INVALID_ATTACHMENT', 'Select a stable attachment owner');
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 160 || /[\x00-\x1f<>:"/\\|?*]/.test(input.name) || /[. ]$/.test(input.name) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(input.name)) fail('INVALID_ATTACHMENT', 'Invalid file name');
  if (typeof input.base64 !== 'string' || input.base64.length > 11184812) fail('INVALID_ATTACHMENT', 'Invalid or oversized file');
  const bytes = Buffer.from(input.base64, 'base64');
  if (!bytes.length || bytes.length > 8 * 1024 * 1024 || bytes.toString('base64') !== input.base64) fail('INVALID_ATTACHMENT', 'File must contain 1 byte to 8 MiB');
  return { uploadId: input.uploadId, target: { ...t }, name: input.name, bytes };
}

export function attachmentPatch(document, job, file, { create = false } = {}) {
  const node = entries(document.root).get(job.target.nodeId)?.node;
  if (!node) fail('ATTACHMENT_OWNER_GONE', 'Attachment node no longer exists', 409);
  const field = { bug: 'bugs', mem: 'memories', idea: 'ideas', dorm: 'dormant' }[job.target.kind];
  const copy = structuredClone(node);
  const matches = job.target.kind === 'node' ? (copy.id === job.target.ownerId ? [copy] : [])
    : (copy[field] || []).filter(item => (job.target.kind === 'bug' ? item.id : item._attachmentId) === job.target.ownerId);
  if (matches.length !== 1) fail('ATTACHMENT_OWNER_GONE', 'Attachment owner no longer exists or is ambiguous', 409);
  const owner = matches[0]; owner.files ||= [];
  const index = owner.files.findIndex(item => item?.attachmentId === job.id);
  if (index < 0 && !create) fail('ATTACHMENT_REMOVED', 'Attachment was removed; do not restore it automatically', 409);
  if (index >= 0) owner.files[index] = file; else owner.files.push(file);
  return [{ type: 'update', id: node.id, fields: job.target.kind === 'node' ? { files: owner.files } : { [field]: copy[field] } }];
}

export class CloudAttachments {
  constructor({ directory, provider, publish, maxStagedBytes = 512 * 1024 * 1024 }) {
    this.directory = directory; this.provider = provider; this.publish = publish; this.maxStagedBytes = maxStagedBytes;
    this.pending = new Set(); this.closed = false; this.running = null;
  }
  file(id) { if (!/^[a-f0-9]{64}$/.test(id)) fail('INVALID_ATTACHMENT', 'Invalid attachment ID'); return path.join(this.directory, `${id}.json`); }
  stageFile(job) { return path.join(this.directory, 'staged', job.id, job.name); }
  async save(job) { await atomicWrite(this.file(job.id), encode(job)); }
  async all() {
    const names = await fs.readdir(this.directory).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
    const result = [];
    for (const name of names.filter(name => /^[a-f0-9]{64}\.json$/.test(name))) result.push(await readJSON(path.join(this.directory, name)));
    return result;
  }
  public(job) {
    return { id: job.id, status: job.status, name: job.name, target: job.target, error: job.error || '', retryable: job.status === 'error' && !job.uncertain, file: this.card(job) };
  }
  card(job) {
    return { attachmentId: job.id, provider: 'quark', name: job.name, path: job.share?.url || `quark-job:${job.id}`,
      status: job.status, ...(job.share ? { passcode: job.share.passcode, fileId: job.fid } : {}),
      ...(job.error ? { error: job.error, retryable: !job.uncertain } : {}) };
  }
  async get(projectId, viewId, id) {
    const job = await readJSON(this.file(id), null);
    if (!job || job.projectId !== projectId || job.viewId !== viewId) fail('NOT_FOUND', 'Attachment not found', 404);
    return job;
  }
  async start() {
    for (const job of await this.all()) {
      if (job.status === 'uploading') {
        job.status = 'error'; job.uncertain = true; job.error = '上传结果不确定，需管理员核对夸克文件；暂存文件已保留'; await this.save(job);
        await this.publish(job, this.card(job)).catch(() => {});
      } else if (!['ready', 'error', 'staged'].includes(job.status)) this.pending.add(job.id);
    }
    this.kick();
  }
  async stage(projectId, viewId, input, generation = null) {
    if (this.closed) fail('STOPPING', 'Server is stopping', 503);
    const value = attachmentInput(input), id = hash(JSON.stringify([projectId, viewId, generation, value.uploadId]));
    const fingerprint = hash(JSON.stringify([value.target, value.name, hash(value.bytes)]));
    const job = await withFileLock(path.join(this.directory, 'stage.lock'), async () => {
      const previous = await readJSON(this.file(id), null);
      if (previous) { if (previous.fingerprint !== fingerprint) fail('ID_REUSED', 'Upload ID belongs to another file or owner', 409); return previous; }
      const jobs = await this.all();
      if (jobs.length >= 10000 || jobs.filter(item => item.status !== 'ready').reduce((sum, item) => sum + item.size, 0) + value.bytes.length > this.maxStagedBytes) fail('STAGING_FULL', 'Attachment staging quota exceeded; resolve pending jobs', 507);
      const next = { id, fingerprint, projectId, viewId, generation, target: value.target, name: value.name, size: value.bytes.length, status: 'staged', createdAt: new Date().toISOString() };
      await atomicWrite(this.stageFile(next), value.bytes); await this.save(next); return next;
    });
    await withFileLock(`${this.file(job.id)}.lock`, async () => {
      const current = await readJSON(this.file(job.id));
      if (current.status === 'staged') {
        await this.publish(current, this.card(current), { create: true });
        current.status = 'queued'; await this.save(current);
      }
    });
    this.pending.add(job.id); this.kick(); return this.public(await this.get(projectId, viewId, job.id));
  }
  async retry(projectId, viewId, id) {
    if (this.closed) fail('STOPPING', 'Server is stopping', 503);
    const result = await withFileLock(`${this.file(id)}.lock`, async () => {
      const job = await this.get(projectId, viewId, id);
      if (job.uncertain) fail('UPLOAD_UNCERTAIN', 'Verify the remote upload before retrying; local file is preserved', 409);
      if (job.status === 'error') {
        // Retry never recreates an attachment the human has removed.
        await this.publish(job, { ...this.card(job), status: 'queued', error: '', retryable: false });
        job.status = job.share ? 'linked' : job.fid ? 'uploaded' : 'queued'; delete job.error; await this.save(job);
      }
      return this.public(job);
    });
    this.pending.add(id); this.kick(); return result;
  }
  kick() {
    if (this.running || this.closed) return;
    this.running = (async () => {
      while (this.pending.size && !this.closed) {
        const id = this.pending.values().next().value; this.pending.delete(id);
        await withFileLock(`${this.file(id)}.lock`, () => this.process(id)).catch(() => {
          console.error(`[context-guard] attachment ${id} could not persist progress; inspect private storage before retrying`);
        });
      }
    })().finally(() => { this.running = null; if (this.pending.size && !this.closed) this.kick(); });
  }
  async process(id) {
    const job = await readJSON(this.file(id));
    if (['ready', 'error'].includes(job.status)) return;
    try {
      if (job.status === 'staged') {
        await this.publish(job, this.card(job), { create: true });
        job.status = 'queued'; await this.save(job);
      }
      // Check the current owner before any external disclosure or retry.
      await this.publish(job, this.card(job));
      if (!job.fid) {
        job.status = 'uploading'; await this.save(job);
        const uploaded = await this.provider.upload(this.stageFile(job));
        job.fid = typeof uploaded === 'string' ? uploaded : uploaded.fileId;
        if (typeof uploaded !== 'string') job.remotePath = uploaded.remotePath;
        job.status = 'uploaded'; await this.save(job);
      }
      if (!job.share) {
        const received = await this.provider.share(job.fid, job.remotePath);
        job.share = quarkShare({ share_url: received.url, passcode: received.passcode });
        job.status = 'linked'; await this.save(job);
      }
      // Map persistence is the cleanup boundary, not provider success alone.
      await this.publish(job, { ...this.card(job), status: 'ready' });
      await fs.unlink(this.stageFile(job)).catch(error => { if (error.code !== 'ENOENT') throw error; });
      job.status = 'ready'; delete job.error; await this.save(job);
    } catch (error) {
      job.uncertain = job.status === 'uploading' && !job.fid;
      job.status = 'error';
      job.error = job.uncertain ? '上传结果不确定，需管理员核对夸克文件；暂存文件已保留'
        : ['ATTACHMENT_OWNER_GONE', 'ATTACHMENT_REMOVED'].includes(error.code) ? '原附件或节点已删除；已停止转存并保留记录'
          : '转存未完成；暂存文件及已取得的网盘引用已保留，可重试';
      await this.save(job); await this.publish(job, this.card(job)).catch(() => {});
    }
  }
  async close() { this.closed = true; await this.running; }
}
