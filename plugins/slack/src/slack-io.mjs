import { digest } from './store.mjs';
import { plainText } from './plain-text.mjs';

const fallbackText = text => plainText(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').slice(0, 39000);

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export const MAX_TOTAL_IMAGE_BYTES = 5 * 1024 * 1024;
export class UncertainDelivery extends Error { constructor(id) { super('Slack delivery is uncertain; reconciliation required'); this.code = 'DELIVERY_UNCERTAIN'; this.id = id; } }
export class SlackIO {
  constructor({ client, store, botUserId, now = Date.now, wait = sleep, fetchImpl = fetch, botToken }) {
    this.client = client; this.store = store; this.botUserId = botUserId; this.now = now; this.wait = wait; this.fetch = fetchImpl; this.botToken = botToken;
    this.channelTails = new Map(); this.lastWrite = new Map();
  }
  async call(method, arguments_) {
    for (let attempt = 0; ; attempt++) {
      try { return await this.client.apiCall(method, arguments_); }
      catch (error) {
        if (error.code !== 'slack_webapi_rate_limited_error' || attempt >= 2) throw error;
        const seconds = Number(error.retryAfter || error.data?.retry_after || 1);
        if (!Number.isFinite(seconds) || seconds > 60) throw error;
        await this.wait(Math.max(1, seconds) * 1000);
      }
    }
  }
  async write(channel, operation) {
    const prior = this.channelTails.get(channel) || Promise.resolve();
    const next = prior.catch(() => {}).then(async () => {
      const delay = 1000 - (this.now() - (this.lastWrite.get(channel) || 0));
      if (delay > 0) await this.wait(delay);
      try { return await operation(); } finally { this.lastWrite.set(channel, this.now()); }
    });
    this.channelTails.set(channel, next);
    try { return await next; } finally { if (this.channelTails.get(channel) === next) this.channelTails.delete(channel); }
  }
  async reconcile(record) {
    let cursor;
    for (let page = 0; page < 8; page++) {
      const result = await this.call(record.threadTs ? 'conversations.replies' : 'conversations.history', { channel: record.channel, ...(record.threadTs ? { ts: record.threadTs } : {}), limit: 100, ...(cursor ? { cursor } : {}), include_all_metadata: true });
      const found = (result.messages || []).find(message => message.user === this.botUserId && (record.kind === 'file' ? message.files?.some(file => record.fileId ? file.id === record.fileId : file.name === record.filename) : message.metadata?.event_type === 'context_guard' && message.metadata?.event_payload?.id === record.id));
      if (found) { await this.store.update(state => { state.outgoing[record.id].status = 'sent'; state.outgoing[record.id].ts = found.ts; delete state.outgoing[record.id].uploadUrl; }); return found.ts; }
      cursor = result.response_metadata?.next_cursor;
      if (!cursor) break;
    }
    // An absent result cannot prove a timed-out request did not commit later.
    throw new UncertainDelivery(record.id);
  }
  async post({ id, channel, threadTs, text, blocks }) {
    const previous = this.store.data.outgoing[id];
    if (previous?.status === 'sent') return previous.ts;
    if (previous?.status === 'sending' || previous?.status === 'unknown') return this.reconcile(previous);
    await this.store.update(state => { state.outgoing[id] = { id, channel, threadTs, status: 'sending', hash: digest({ text, blocks }), at: Date.now() }; });
    try {
      const result = await this.write(channel, () => this.call('chat.postMessage', { channel, thread_ts: threadTs, text: fallbackText(text), mrkdwn: false, parse: 'none', link_names: false, ...(blocks ? { blocks } : {}),
        metadata: { event_type: 'context_guard', event_payload: { id } }, unfurl_links: false, unfurl_media: false }));
      await this.store.update(state => { state.outgoing[id].status = 'sent'; state.outgoing[id].ts = result.ts; });
      return result.ts;
    } catch (error) {
      // A Slack platform rejection and a rejected 429 are known non-deliveries.
      const known = ['slack_webapi_platform_error', 'slack_webapi_rate_limited_error'].includes(error.code);
      await this.store.update(state => { state.outgoing[id].status = known ? 'failed' : 'unknown'; });
      if (!known) return this.reconcile(this.store.data.outgoing[id]);
      throw error;
    }
  }
  async update(channel, ts, text, blocks) { return this.write(channel, () => this.call('chat.update', { channel, ts, text: fallbackText(text), mrkdwn: false, parse: 'none', link_names: false, ...(blocks ? { blocks } : {}) })); }
  async uploadPrompt({ id, channel, threadTs, text, filename }) {
    let previous = this.store.data.outgoing[id];
    filename = `${digest(id).slice(0, 12)}-${String(filename || 'execution-prompt.md').split(/[\\/]/).at(-1)}`;
    const contentHash = digest(text);
    if (previous?.contentHash && (previous.contentHash !== contentHash || previous.channel !== channel || previous.threadTs !== threadTs)) throw Object.assign(new Error('Export operation ID is already used'), { code: 'ID_REUSED' });
    if (previous?.status === 'sent') return;
    if (previous?.status === 'sending' || previous?.status === 'unknown') return this.reconcile(previous);
    if (!previous) await this.store.update(state => { state.outgoing[id] = { id, channel, threadTs, status: 'pending', phase: 'allocate', kind: 'file', filename, contentHash }; });
    // filesUploadV2 hides allocation/upload/completion in one promise. Persist
    // the same official stages so a 429/restart never allocates a second file
    // after completion might already have published the first one.
    try {
      previous = this.store.data.outgoing[id];
      if (previous.phase === 'allocate' || !previous.fileId) {
        const allocated = await this.call('files.getUploadURLExternal', { filename, length: Buffer.byteLength(text, 'utf8') });
        const url = new URL(allocated.upload_url);
        if (url.protocol !== 'https:' || !(url.hostname === 'files.slack.com' || url.hostname.endsWith('.slack.com'))) throw Object.assign(new Error('Invalid Slack upload URL'), { code: 'UNTRUSTED_UPLOAD_URL' });
        await this.store.update(state => { Object.assign(state.outgoing[id], { status: 'pending', phase: 'upload', fileId: allocated.file_id, uploadUrl: url.href }); });
      }
      previous = this.store.data.outgoing[id];
      if (previous.phase === 'upload') {
        await this.uploadBytes(previous.uploadUrl, Buffer.from(text, 'utf8'));
        await this.store.update(state => { state.outgoing[id].phase = 'complete'; });
      }
      // Only this phase publishes a message. Persist uncertainty BEFORE the
      // request, then use the original file ID to reconcile after a crash.
      await this.store.update(state => { state.outgoing[id].status = 'sending'; state.outgoing[id].phase = 'complete'; });
      const record = this.store.data.outgoing[id];
      try {
        await this.write(channel, () => this.call('files.completeUploadExternal', { channel_id: channel, thread_ts: threadTs, files: [{ id: record.fileId, title: 'Context Guard 执行提示' }] }));
      } catch (error) {
        const known = ['slack_webapi_platform_error', 'slack_webapi_rate_limited_error'].includes(error.code);
        await this.store.update(state => { state.outgoing[id].status = known ? 'failed' : 'unknown'; });
        if (!known) return this.reconcile(this.store.data.outgoing[id]);
        throw error;
      }
      await this.store.update(state => { state.outgoing[id].status = 'sent'; delete state.outgoing[id].uploadUrl; });
    } catch (error) {
      const record = this.store.data.outgoing[id];
      // Before completion no shared message can exist. Retrying allocation or
      // the same upload URL cannot duplicate an outbound notification.
      if (!['sending', 'unknown', 'sent'].includes(record.status)) await this.store.update(state => { state.outgoing[id].status = 'failed'; });
      throw error;
    }
  }
  async uploadBytes(url, bytes) {
    for (let attempt = 0; ; attempt++) {
      const response = await this.fetch(url, { method: 'POST', body: bytes, headers: { 'content-type': 'application/octet-stream' }, redirect: 'error', signal: AbortSignal.timeout(15000) });
      if (response.status === 429) {
        const seconds = Number(response.headers.get('retry-after') || 1);
        if (attempt >= 2 || !Number.isFinite(seconds) || seconds < 0 || seconds > 60) throw Object.assign(new Error('Slack upload rate limited'), { code: 'slack_webapi_rate_limited_error', retryAfter: seconds });
        await this.wait(Math.max(1, seconds) * 1000); continue;
      }
      if (!response.ok) throw Object.assign(new Error('Slack upload rejected'), { code: response.status >= 500 ? 'SLACK_UPLOAD_UNAVAILABLE' : 'SLACK_UPLOAD_REJECTED' });
      await response.body?.cancel().catch(() => {}); return;
    }
  }
  async download(file) {
    const info = file.url_private_download || file.url_private ? file : (await this.call('files.info', { file: file.id })).file;
    const limit = info.mimetype?.startsWith('text/') || /\.(md|txt|json|csv|log)$/i.test(info.name || '') ? 256 * 1024 : 5 * 1024 * 1024;
    if (Number(info.size) > limit) throw Object.assign(new Error('附件太大：文本上限 256 KiB，图片上限 5 MiB'), { code: 'ATTACHMENT_TOO_LARGE' });
    let url = info.url_private_download || info.url_private, response;
    for (let redirects = 0; redirects < 4; redirects++) {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || !(parsed.hostname === 'files.slack.com' || parsed.hostname.endsWith('.slack.com') || parsed.hostname.endsWith('.slack-files.com'))) throw new Error('Untrusted Slack file URL');
      response = await this.fetch(url, { headers: { authorization: `Bearer ${this.botToken}` }, redirect: 'manual', signal: AbortSignal.timeout(15000) });
      if (response.status >= 300 && response.status < 400) { url = new URL(response.headers.get('location'), url).href; continue; }
      break;
    }
    if (!response?.ok) throw new Error('Slack 附件下载失败');
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.byteLength; if (size > limit) { await response.body.cancel?.().catch(() => {}); throw new Error('附件超过大小限制'); } chunks.push(Buffer.from(chunk)); }
    const bytes = Buffer.concat(chunks); let mimeType;
    if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) mimeType = 'image/png';
    else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) mimeType = 'image/jpeg';
    else if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') mimeType = 'image/webp';
    else if (limit === 256 * 1024) { const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); if (text.includes('\0')) throw new Error('不支持二进制附件'); mimeType = 'text/plain'; }
    else throw new Error('仅支持 UTF-8 文本和 PNG/JPEG/WebP 图片');
    return { filename: String(info.name || 'attachment').split(/[\\/]/).at(-1), mimeType, base64: bytes.toString('base64') };
  }
}
