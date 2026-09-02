import { copy, diffTrees, entries, same } from './map-model.mjs';
const labels = { loading: '连接中', readonly: '只读预览 · 请启动本地 Node 工作台', playground: '本页可改 · 不会写回仓库', draft: '有未保存草稿', saving: '保存中', persisted: '已落盘 · 等待页面核对', synced: '已同步', conflict: '冲突 · 草稿已保留', offline: '连接中断 · 草稿已保留', error: '保存失败 · 草稿已保留' };
function stored(key) { try { const raw = localStorage.getItem(key); if (!raw) return null; try { return JSON.parse(raw); } catch { return { invalidJSON: true, raw }; } } catch { return null; } }
export class WorkbenchSync {
  constructor(adapter) {
    this.a = adapter; this.config = window.__CG_SERVER;
    this.id = crypto.randomUUID();
    try { this.id = sessionStorage.getItem('cg-sync-client') || this.id; sessionStorage.setItem('cg-sync-client', this.id); } catch {}
    this.status = 'loading'; this.ready = false; this.inflight = null; this.pendingRequest = null;
    this.revision = 0; this.cachedDiff = null;
    this.composing = false; this.inputDraft = null; this.activeSession = null; this.captureKey = null;
    this.panel = document.createElement('details'); this.panel.id = 'cg-sync'; this.panel.className = 'set-block sync-settings';
    this.panel.innerHTML = '<summary>同步与恢复</summary><p id="cg-sync-status"></p><span id="cg-sync-version" hidden></span><div class="sync-actions"><button id="cg-sync-retry">重试</button><button id="cg-sync-export">导出草稿/旧缓存</button><button id="cg-sync-import">导入并比较</button><button id="cg-sync-reload">保留草稿后读取磁盘</button></div><label>Agent 会话<select id="cg-sync-session"></select></label><input id="cg-sync-file" type="file" accept="application/json" hidden>';
    document.getElementById('settings-menu').append(this.panel);
    this.notice = document.createElement('span'); this.notice.className = 'sync-notice'; this.notice.setAttribute('role', 'status'); this.notice.hidden = true;
    document.getElementById('btn-settings').after(this.notice);
    this.panel.querySelector('#cg-sync-retry').onclick = () => this.retry();
    this.panel.querySelector('#cg-sync-export').onclick = () => this.export();
    this.panel.querySelector('#cg-sync-import').onclick = () => this.panel.querySelector('#cg-sync-file').click();
    this.panel.querySelector('#cg-sync-file').onchange = async e => { try { await this.preview(JSON.parse(await e.target.files[0].text())); } catch (err) { this.setStatus(this.status, '导入失败：' + err.message); } e.target.value = ''; };
    this.panel.querySelector('#cg-sync-reload').onclick = () => this.reload();
    this.panel.querySelector('#cg-sync-session').onchange = e => { this.activeSession = e.target.value; this.refreshAccess(); };
    window.addEventListener('beforeunload', e => { if (this.dirty()) { this.saveDraft(); e.preventDefault(); e.returnValue = ''; } });
    window.addEventListener('pagehide', () => {
      if (!this.config || this.dirty()) return;
      fetch('/api/presence', { method: 'POST', headers: { Authorization: `Bearer ${this.config.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: this.id, version: this.version, dirty: false, closing: true }), keepalive: true }).catch(() => {});
    });
    this.setStatus(this.config ? 'loading' : 'playground');
  }
  async call(route, body, method = body === undefined ? 'GET' : 'POST') {
    const response = await fetch(route, { method, headers: { Authorization: `Bearer ${this.config.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', signal: AbortSignal.timeout(10000) });
    const result = await response.json();
    if (!response.ok) { const e = new Error(result.error?.message || 'Request failed'); Object.assign(e, result.error); throw e; }
    return result;
  }
  operations() {
    if (!this.ready) return [];
    if (!this.cachedDiff || this.cachedDiff.revision !== this.revision) {
      const current = this.a.getRoot(), operations = diffTrees(this.baseTree, current);
      if (!same(this.baseTree.flows || [], current.flows || [])) operations.push({ type: 'document', fields: { flows: copy(current.flows || []) } });
      this.cachedDiff = { revision: this.revision, operations };
    }
    return this.cachedDiff.operations;
  }
  dirty() { return !!this.inputDraft || this.composing || !!this.inflight || !!this.pendingRequest || this.operations().length > 0; }
  setStatus(status, message = '') {
    this.status = status; this.panel.dataset.status = status;
    this.panel.querySelector('#cg-sync-status').textContent = labels[status] + (message ? ` · ${message}` : '');
    this.panel.querySelector('#cg-sync-version').textContent = this.version ? this.version.slice(0, 10) : '';
    this.panel.querySelector('#cg-sync-version').dataset.version = this.version || '';
    const attention = { readonly: '只读', conflict: '同步冲突', offline: '连接中断', error: '保存失败' }[status];
    this.notice.hidden = !attention;
    this.notice.textContent = attention || '';
    this.notice.title = attention ? this.panel.querySelector('#cg-sync-status').textContent + '；请打开设置中的同步与恢复' : '';
  }
  saveDraft() {
    if (!this.captureKey) return;
    try {
      const draft = { project: this.doc.project, baseVersion: this.version, baseTree: this.baseTree, doc: { ...this.doc, root: copy(this.a.getRoot()) }, inputDraft: this.inputDraft, pendingRequest: this.pendingRequest };
      localStorage.setItem(this.captureKey, JSON.stringify(draft));
    } catch { this.setStatus('error', '浏览器无法保存恢复副本，请立即导出'); }
  }
  changed() {
    if (!this.ready || !this.config) return;
    this.revision++;
    if (!this.dirty()) return;
    this.saveDraft(); this.presence();
    if (['conflict', 'offline', 'error'].includes(this.status)) return;
    this.setStatus(this.inflight ? 'saving' : 'draft');
    clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(), 100);
  }
  async presence(checkpoint) {
    if (!this.config) return;
    try { return await this.call('/api/presence', { clientId: this.id, dirty: this.dirty(), version: this.version, checkpoint }); } catch { this.setStatus('offline'); }
  }
  setInputDraft(input) { this.inputDraft = input; if (input) { this.saveDraft(); if (!['conflict', 'offline', 'error'].includes(this.status)) this.setStatus('draft'); } this.presence(); }
  async start() {
    if (!this.config) return false;
    try {
      const state = await this.call('/api/state');
      if (!state.doc?.root || state.error) throw new Error(state.error?.message || '旧空图需要通过 map initialize 操作建立根节点');
      this.doc = state.doc; this.version = state.version; this.captureKey = 'cg-sync-draft:' + this.config.root;
      this.a.apply(state.doc); this.baseTree = copy(this.a.getRoot()); this.ready = true;
      const restored = stored(this.captureKey), legacy = stored('cg-workbench-maps-v16');
      this.recovery = restored; this.legacy = legacy;
      this.connect(); await this.refreshAccess();
      this.setStatus('synced', restored || legacy ? '发现草稿/旧缓存，请导出或导入比较；未自动回写' : '');
      return true;
    } catch (e) { this.setStatus('error', e.message); return false; }
  }
  connect() {
    this.events?.close();
    this.events = new EventSource(`/api/events?token=${encodeURIComponent(this.config.token)}&clientId=${this.id}`);
    this.events.addEventListener('state', e => this.receive(JSON.parse(e.data)).catch(err => this.setStatus('error', err.message)));
    this.events.addEventListener('access', () => this.refreshAccess());
    this.events.addEventListener('checkpoint', async e => {
      const { checkpoint } = JSON.parse(e.data);
      if (!this.composing && document.activeElement?.isContentEditable) document.activeElement.blur();
      if (!['conflict', 'offline', 'error'].includes(this.status)) await this.flush();
      await this.presence(checkpoint);
    });
    this.events.onerror = async () => {
      if (this.dirty()) this.saveDraft(); this.setStatus('offline');
      try { const response = await fetch('/__context_guard/bootstrap', { cache: 'no-store' }); const config = await response.json(); if (config.token !== this.config.token) { this.config = config; this.connect(); } } catch {}
    };
    this.events.onopen = async () => { if (this.status === 'offline') await this.retry(); else await this.presence(); };
  }
  async receive(state) {
    const generation = this.loadGeneration = (this.loadGeneration || 0) + 1;
    if (state.error || state.recovery) { this.setStatus('error', state.error?.message || '服务需要恢复'); return; }
    if (state.version === this.version) {
      if (!this.dirty()) this.setStatus('synced', state.projection?.status === 'failed' ? '索引失败；Agent须读当前节点' : state.projection?.status === 'pending' ? '索引更新中' : '');
      return;
    }
    if (this.inflight) { this.deferredState = state; return; }
    if (this.dirty()) { this.saveDraft(); this.setStatus('conflict'); return; }
    const current = await this.call('/api/state');
    if (generation !== this.loadGeneration) return;
    if (current.error || current.recovery || !current.doc) { this.setStatus('error', current.error?.message || '服务需要恢复'); return; }
    if (this.dirty()) { this.setStatus('conflict'); return; }
    this.doc = current.doc; this.version = current.version; this.a.apply(this.doc); this.baseTree = copy(this.a.getRoot()); this.revision++;
    await this.presence(); this.setStatus('synced');
  }
  async flush() {
    clearTimeout(this.timer);
    if (!this.ready || this.composing || ['conflict', 'offline', 'error'].includes(this.status)) return;
    if (this.inflight) { await this.inflight; if (!this.inflight && !['conflict', 'offline', 'error'].includes(this.status) && this.operations().length) return this.flush(); return; }
    const operations = this.operations(); if (!operations.length) { await this.presence(); return; }
    const sentTree = copy(this.a.getRoot());
    this.pendingRequest ||= { baseVersion: this.version, operationId: crypto.randomUUID(), operations };
    const request = this.pendingRequest; this.saveDraft(); this.setStatus('saving');
    this.inflight = (async () => {
      try {
        const result = await this.call('/api/commit', request);
        if (!result.committed) throw new Error('操作未提交，请保留草稿并读取磁盘');
        this.version = result.version; this.baseTree = sentTree; this.revision++;
        this.doc = { ...this.doc, root: copy(sentTree) }; this.pendingRequest = null;
        this.setStatus('persisted');
      } catch (e) { this.saveDraft(); this.setStatus(e.code === 'VERSION_CONFLICT' ? 'conflict' : e.code ? 'error' : 'offline', e.message); }
    })();
    await this.inflight; this.inflight = null;
    if (['conflict', 'offline', 'error'].includes(this.status)) return;
    if (this.operations().length) { this.saveDraft(); return this.flush(); }
    if (this.deferredState) { const deferred = this.deferredState; this.deferredState = null; await this.receive(deferred); }
    const acknowledgement = await this.presence();
    if (acknowledgement?.error || acknowledgement?.recovery) { this.setStatus('error', acknowledgement.error?.message || '服务需要恢复'); return; }
    if (!this.dirty() && acknowledgement?.synchronized) { localStorage.removeItem(this.captureKey); this.setStatus('synced'); }
    else this.setStatus('draft');
  }
  async retry() {
    if (!this.config) return;
    if (!this.ready) { await this.start(); return; }
    try {
      // Reuse precisely the same payload and operationId after uncertain delivery.
      if (this.pendingRequest) {
        const result = await this.call('/api/commit', this.pendingRequest);
        if (!result.committed) throw new Error('操作未提交；请保留草稿后读取磁盘');
        const current = await this.call('/api/state');
        this.version = result.version;
        // The request may predate later local typing. Never mark that later draft saved.
        const { applyOperations } = await import('./map-model.mjs');
        this.baseTree = applyOperations({ root: this.baseTree }, this.pendingRequest.operations, { kind: 'human', sessionId: 'workbench' }).doc.root;
        this.pendingRequest = null; this.revision++;
        if (current.version !== result.version) { this.setStatus('conflict'); return; }
      } else {
        const current = await this.call('/api/state');
        if (current.error || current.recovery) throw new Error(current.error?.message || '服务需要恢复');
        if (current.version !== this.version && this.dirty()) { this.setStatus('conflict'); return; }
        if (current.version !== this.version) { await this.receive(current); return; }
      }
      this.setStatus('draft'); await this.flush(); if (!this.dirty()) this.setStatus('synced');
    } catch (e) { this.setStatus(e.code === 'VERSION_CONFLICT' ? 'conflict' : 'error', e.message); }
  }
  download(value, name) { const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  export() {
    this.download({ project: this.doc?.project, current: this.ready ? { ...this.doc, root: copy(this.a.getRoot()) } : null, draft: this.captureKey ? stored(this.captureKey) : null, legacy: stored('cg-workbench-maps-v16'), inputDraft: this.inputDraft }, 'context-guard-recovery.json');
  }
  async reload() {
    if (!this.config) return;
    if (this.dirty()) { this.saveDraft(); this.export(); }
    const current = await this.call('/api/state'); if (current.error || !current.doc?.root) { this.setStatus('error', current.error?.message || '地图根节点尚未初始化'); return; }
    this.pendingRequest = null; this.inputDraft = null; this.doc = current.doc; this.version = current.version;
    this.a.apply(current.doc); this.baseTree = copy(this.a.getRoot()); this.revision++; this.ready = true;
    this.captureKey ||= 'cg-sync-draft:' + this.config.root;
    if (!this.events) { this.connect(); await this.refreshAccess(); }
    await this.presence(); this.setStatus('synced', '旧草稿副本仍保留');
  }
  async preview(input) {
    if (!this.config) throw new Error('请在本地 Node 工作台导入');
    let doc = input.draft?.doc || input.current || input.doc || input;
    const legacy = input.legacy || input;
    if (!doc.root && legacy.repos) { const saved = legacy.repos[this.doc.project]; if (saved?.live) doc = { ...this.doc, root: saved.live, project: this.doc.project }; }
    const preview = await this.call('/api/migration-preview', { doc });
    const dialog = document.createElement('dialog'); dialog.style.cssText = 'max-width:85vw;max-height:80vh;overflow:auto';
    const title = document.createElement('h3'); title.textContent = '逐项选择需要导入的差异（默认均不选）'; dialog.append(title);
    const note = document.createElement('p'); note.textContent = `磁盘与导入副本已备份。共 ${preview.operations.length} 项。未知字段不会被删除。`; dialog.append(note);
    const selected = [];
    const choices = preview.operations.flatMap(op => op.type === 'update' ? Object.entries(op.fields).map(([key, value]) => ({ ...op, fields: { [key]: value } })) : [op]);
    for (const op of choices) { const row = document.createElement('label'); row.style.display = 'block'; const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; row.append(checkbox, document.createTextNode(JSON.stringify(op))); dialog.append(row); selected.push({ op, checkbox }); }
    const apply = document.createElement('button'); apply.textContent = '提交已选差异';
    apply.onclick = async () => {
      const operations = selected.filter(x => x.checkbox.checked).map(x => x.op); if (!operations.length) return;
      apply.disabled = true;
      this.setStatus('saving');
      try { await this.call('/api/commit', { baseVersion: preview.baseVersion, operationId: crypto.randomUUID(), operations }); dialog.close(); dialog.remove(); await this.reload(); }
      catch (e) { note.textContent = e.message; apply.disabled = false; this.setStatus('error', e.message); }
    };
    const cancel = document.createElement('button'); cancel.textContent = '取消'; cancel.onclick = () => { dialog.close(); dialog.remove(); };
    dialog.append(apply, cancel); document.body.append(dialog); dialog.showModal();
  }
  async refreshAccess() {
    if (!this.config) return;
    const data = await this.call('/api/access'); const select = this.panel.querySelector('#cg-sync-session');
    select.replaceChildren(...data.sessions.map(id => { const option = document.createElement('option'); option.value = id; option.textContent = id; return option; }));
    if (!data.sessions.includes(this.activeSession)) this.activeSession = data.sessions.at(-1) || null;
    select.value = this.activeSession || ''; this.a.setAccess(data.grants[this.activeSession]?.nodes || [], this.activeSession);
  }
  async toggleAccess(ids) {
    if (!this.activeSession) { this.setStatus(this.status, '尚无真实 Agent 会话，请先启动会话'); return; }
    try { await this.call('/api/access', { sessionId: this.activeSession, nodes: ids }); await this.refreshAccess(); }
    catch (e) { this.setStatus(this.status, '授权失败：' + e.message); }
  }
}
