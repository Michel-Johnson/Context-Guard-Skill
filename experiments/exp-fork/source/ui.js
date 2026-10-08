/* Local study adapter; routing and measurements remain on the server. */
window.installLearningCoordinator = async function (sync, mapBridge) {
  const { markdownFragment, nextRevealSegmentEnd } = await import('/projects/coordinator-markdown.mjs');
  const { createCoordinatorWorkingBlot } = await import('/projects/coordinator-working-blot.mjs');
  const launcher = document.getElementById('btn-coordinator');
  const detail = document.getElementById('detail');
  if (!launcher || !detail || document.getElementById('coordinator-panel')) return;
  document.body.classList.add('learning-readonly');
  const topHeight = () => document.documentElement.style.setProperty('--learning-top', Math.ceil(document.querySelector('header.top')?.getBoundingClientRect().bottom || 60) + 'px');
  new ResizeObserver(topHeight).observe(document.querySelector('header.top')); topHeight();
  const sourceView = document.createElement('dialog'); sourceView.className = 'learning-source';
  sourceView.innerHTML = '<header><strong>Source</strong><button type="button" aria-label="关闭源码" title="关闭源码">×</button></header><iframe title="固定版本源码" sandbox=""></iframe>';
  sourceView.querySelector('button').onclick = () => sourceView.close(); document.body.append(sourceView);
  const openSource = url => { sourceView.querySelector('iframe').src = url; sourceView.showModal(); };
  document.addEventListener('click', event => {
    const file = event.target.closest('[data-open-file]');
    const link = event.target.closest('a[href]');
    if (file || link && new URL(link.href).origin === location.origin && new URL(link.href).pathname === '/experiment/source') {
      event.preventDefault(); event.stopImmediatePropagation(); openSource(file ? '/experiment/source?path=' + encodeURIComponent(file.dataset.openFile) : link.href); return;
    }
    if (event.target.closest('#detail .ed, #detail [data-act]:not([data-act="enter"]), .add-child, [data-add]')) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  const panel = document.createElement('section');
  panel.id = 'coordinator-panel'; panel.className = 'learning-coordinator';
  panel.innerHTML = `<div class="coordinator-toolbar">
    <button type="button" id="learning-close" class="coordinator-heading" aria-label="返回节点详情">← Coordinator</button>
    <button type="button" id="learning-history-toggle" class="coordinator-toolbar-action" title="历史 Session" aria-label="历史 Session" aria-expanded="false" aria-controls="learning-history">◷</button>
    <button type="button" id="learning-new" class="coordinator-toolbar-action" title="新任务" aria-label="新任务">＋</button>
    <button type="button" id="learning-feedback-toggle" class="coordinator-toolbar-action" title="结束任务并反馈" aria-label="结束任务并反馈" aria-expanded="false" aria-controls="learning-feedback" hidden>✓</button>
    <button id="learning-stop" class="coordinator-toolbar-action" type="button" title="停止本任务" aria-label="停止本任务" hidden>■</button>
    <span id="learning-activity" class="coordinator-typing" role="status" aria-hidden="true"></span>
    </div>
    <section id="learning-history" class="coordinator-history" hidden><h3>历史 Session</h3><div id="learning-task" class="coordinator-history-list"></div></section>
    <section id="learning-feedback" class="coordinator-history" hidden><h3>本次任务结果</h3><div class="learning-feedback-options"><button type="button" data-quality="solved">已解决</button><button type="button" data-quality="partial">部分解决</button><button type="button" data-quality="unsolved">未解决</button></div></section>
    <div id="learning-messages" class="coordinator-messages" aria-live="polite"></div>
    <p id="learning-status" role="status"></p>
    <form id="learning-compose" class="coordinator-compose"><div class="coordinator-input-shell"><textarea id="learning-input" aria-label="发送给 Coordinator" placeholder="描述需求，或补充你的反馈…" maxlength="8000" rows="1"></textarea><button id="learning-send" class="coordinator-send" type="submit" title="发送" aria-label="发送"><span class="learning-send-arrow" aria-hidden="true">↑</span></button></div></form>`;
  document.body.append(panel);
  const el = id => panel.querySelector('#learning-' + id);
  const working = createCoordinatorWorkingBlot(document);
  el('send').append(working.canvas);
  let showingWorking = false, stopWorkingTimer = 0, inkReady = false;
  const syncWorking = visible => {
    if (visible === showingWorking) return;
    showingWorking = visible;
    clearTimeout(stopWorkingTimer);
    el('send').classList.toggle('is-working', visible);
    if (visible) {
      if (inkReady) el('send').classList.add('is-working-ready');
      working.start(() => { inkReady = true; if (showingWorking) el('send').classList.add('is-working-ready'); });
    } else { el('send').classList.remove('is-working-ready'); stopWorkingTimer = setTimeout(() => { working.stop(); inkReady = false; }, 1000); }
  };
  const setHistory = open => { el('history').hidden = !open; el('history-toggle').setAttribute('aria-expanded', String(open)); };
  const setFeedback = open => { el('feedback').hidden = !open; el('feedback-toggle').setAttribute('aria-expanded', String(open)); };
  const sizeInput = () => { el('input').style.height = '48px'; el('input').style.height = Math.min(140, Math.max(48, el('input').scrollHeight + 2)) + 'px'; };
  let selected = sessionStorage.getItem('codex-learning-task') || '', state, busySend = false, pollBusy = false, messageError = '';
  const rows = new Map(), revealing = new Map();
  const planning = document.createElement('p'); planning.className = 'coordinator-planning';
  planning.innerHTML = '<span class="coordinator-typing-phase">Planning next moves</span><span class="learning-fork-status" role="status"></span>';
  const tail = document.createElement('div'); tail.className = 'coordinator-messages-tail';
  let firstRender = true, pinnedRow = null;
  const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pinTop = () => {
    if (!pinnedRow?.isConnected) return null;
    const pane = el('messages'); return Math.max(0, pane.scrollTop + pinnedRow.getBoundingClientRect().top - pane.getBoundingClientRect().top - (pane.clientHeight * .5 - pinnedRow.offsetHeight - 12));
  };
  const pinTurn = () => { const top = pinTop(); if (top !== null) el('messages').scrollTop = top; };
  el('messages').addEventListener('scroll', () => { const top = pinTop(); if (top !== null && Math.abs(el('messages').scrollTop - top) > 80) pinnedRow = null; });
  const stopReveals = () => { for (const value of revealing.values()) clearTimeout(value.timer); revealing.clear(); };
  const displays = new Set(), sent = new Map();
  const api = async (url, input) => {
    const r = await fetch('/experiment/' + url, { credentials: 'same-origin', ...(input === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }) });
    const data = await r.json(); if (!r.ok) throw new Error(data.message || data.error || '请求失败'); return data;
  };
  const base = () => 'tasks/' + selected;
  const note = error => { messageError = error?.message || ''; el('status').textContent = messageError; };
  const handledActions = new Set();
  let actionQueue = Promise.resolve();
  const consumeActions = () => {
    const task = selected;
    for (const action of state.actions || []) {
      if (action.kind === 'node-references') continue;
      const key = 'learning-map-action:' + action.actionId;
      if (handledActions.has(key) || sessionStorage.getItem(key)) continue;
      handledActions.add(key);
      actionQueue = actionQueue.then(async () => {
        if (selected !== task) { handledActions.delete(key); return; }
        if (action.kind === 'map-action') await mapBridge.reload();
        else if (action.kind === 'node-navigation') await mapBridge.openNode(action.node.id);
        else if (action.kind === 'node-tour') {
          for (const node of action.nodes) { if (selected !== task) break; await mapBridge.openNode(node.id); }
        }
        sessionStorage.setItem(key, '1');
      }).catch(note);
    }
  };
  const remember = () => { if (selected && state) sessionStorage.setItem('codex-draft-' + selected, el('input').value); };
  const select = async id => {
    remember(); stopReveals(); syncWorking(false); rows.clear(); tail.style.height = '0px'; firstRender = true; pinnedRow = null; selected = id; state = null; messageError = '';
    sessionStorage.setItem('codex-learning-task', id); el('input').value = sessionStorage.getItem('codex-draft-' + id) || '';
    setHistory(false); setFeedback(false); sizeInput(); el('messages').replaceChildren(); await refresh();
  };
  const acknowledge = message => {
    const key = selected + ':' + message.id;
    if (message.displayedAt || displays.has(key) || revealing.has(message.id) || !panel.open || document.visibilityState !== 'visible') return;
    displays.add(key); const task = selected;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!panel.open || selected !== task || document.visibilityState !== 'visible') { displays.delete(key); return; }
      const origin = sent.get(message.requestId);
      api('tasks/' + task + '/displayed', { output: message.id, clientElapsedMs: origin === undefined ? null : performance.now() - origin }).catch(() => displays.delete(key));
    }));
  };
  const revealAnswer = (message, content, feedback) => {
    const job = { timer: 0, offset: 0, task: selected }; revealing.set(message.id, job); feedback.hidden = true;
    const step = () => {
      if (job.task !== selected || !content.isConnected) { revealing.delete(message.id); return; }
      if (!panel.open || document.visibilityState !== 'visible') { job.timer = setTimeout(step, 100); return; }
      const end = reducedMotion() ? message.text.length : nextRevealSegmentEnd(message.text, job.offset, true);
      const next = end > job.offset ? end : message.text.length;
      const piece = message.text.slice(job.offset, next).trim(); job.offset = next;
      if (piece) {
        const pane = el('messages'), follow = Boolean(pinnedRow) || pane.scrollHeight - pane.scrollTop - pane.clientHeight < 100;
        const rise = document.createElement('div'), body = document.createElement('div');
        rise.className = 'coordinator-rise' + (reducedMotion() ? '' : ' is-entering'); body.className = 'coordinator-rise-body';
        body.append(markdownFragment(piece)); rise.append(body); content.append(rise); pinnedRow = null;
        if (follow) {
          const rect = rise.getBoundingClientRect(), bottom = pane.getBoundingClientRect().bottom - 36;
          const edge = rect.height < pane.clientHeight * .8 ? rect.bottom : rect.top + Math.min(rect.height, Math.max(64, pane.clientHeight * .12));
          if (edge > bottom) pane.scrollTop += edge - bottom;
        }
      }
      if (job.offset < message.text.length) job.timer = setTimeout(step, 80);
      else { revealing.delete(message.id); feedback.hidden = false; acknowledge(message); render(); }
    };
    job.timer = setTimeout(step, 0);
  };
  const render = () => {
    if (!state) return;
    const pane = el('messages');
    for (const message of state.messages) {
      let entry = rows.get(message.id);
      if (!entry) {
        const row = document.createElement('article'); row.className = 'coordinator-message ' + message.role;
        const content = document.createElement('div'); content.className = 'coordinator-markdown';
        if (message.role !== 'assistant') content.textContent = message.text;
        row.append(content);
        const feedback = document.createElement('div');
        if (message.role === 'assistant') {
          feedback.className = 'learning-answer-feedback';
          for (const [value, caption] of [[true, '有帮助'], [false, '没帮助']]) {
            const button = document.createElement('button'); button.type = 'button'; button.textContent = caption; button.setAttribute('aria-pressed', String(message.helpful === value));
            button.dataset.helpful = String(value); button.onclick = async () => { try { await api(base() + '/feedback', { output: message.id, helpful: value }); await refresh(); } catch (e) { note(e); } }; feedback.append(button);
          }
          row.append(feedback);
        }
        pane.append(row); entry = { row, content, feedback }; rows.set(message.id, entry);
        if (message.role === 'assistant') {
          if (firstRender) content.append(markdownFragment(message.text)); else revealAnswer(message, content, feedback);
        } else if (message.role === 'user' && !firstRender) {
          pinnedRow = row; tail.style.height = Math.round(pane.clientHeight * .58) + 'px';
        }
      }
      entry.feedback.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(String(message.helpful) === button.dataset.helpful)));
    }
    for (const action of state.actions || []) {
      if (action.kind !== 'node-references' || rows.has(action.actionId)) continue;
      const host = document.createElement('div'); host.className = 'learning-node-links';
      for (const node of action.nodes) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = node.title;
        button.onclick = () => mapBridge.openNode(node.id).catch(note); host.append(button);
      }
      const message = state.messages.findLast(m => m.requestId === action.requestId);
      const anchor = message && rows.get(message.id)?.row;
      if (anchor) anchor.after(host); else pane.append(host);
      rows.set(action.actionId, { row: host });
    }
    const last = state.messages.at(-1);
    const pending = state.requests.some(r => r.status === 'processing');
    const fork = state.fork;
    planning.querySelector('.coordinator-typing-phase').hidden = !pending || Boolean(revealing.size);
    planning.querySelector('.learning-fork-status').textContent = !fork?.assigned ? '分身：待分配'
      : !fork.enabled ? '分身：未启用'
      : fork.running || fork.queued ? `分身：运行 ${fork.running} · 等待 ${fork.queued}`
      : fork.failed ? `分身：已启用 · ${fork.failed} 个异常`
      : fork.completed ? `分身：已启用 · 已完成 ${fork.completed}` : '分身：已启用 · 未启动';
    if (pending && last?.role === 'user' && !revealing.size) rows.get(last.id)?.row.after(planning); else pane.append(planning);
    pane.append(tail); pinTurn();
    if (firstRender) { pane.scrollTop = pane.scrollHeight; firstRender = false; }
    for (const message of state.messages) if (message.role === 'assistant') acknowledge(message);
    const taskOptions = state.tasks.map(t => [t.id, (t.quality ? '✓ ' : '') + t.title]);
    const optionKey = JSON.stringify([selected, taskOptions]);
    if (el('task').dataset.key !== optionKey) {
      el('task').replaceChildren(...taskOptions.map(([id, title]) => {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = title; button.setAttribute('aria-current', String(selected === id));
        button.onclick = () => select(id).catch(note); return button;
      })); el('task').dataset.key = optionKey;
    }
    const interrupted = state.requests.some(r => ['cancelled', 'interrupted'].includes(r.status));
    el('status').textContent = messageError || (interrupted && !state.quality ? '处理已中断，记录已保留，请新建任务。' : '');
    el('activity').textContent = state.processing ? '正在处理' : ''; el('activity').setAttribute('aria-hidden', String(!state.processing));
    el('input').placeholder = state.quality ? '本任务已结束' : '描述需求，或补充你的反馈…';
    el('input').disabled = !state.canSubmit; el('send').disabled = busySend || !state.canSubmit || !el('input').value.trim();
    el('stop').hidden = !state.processing;
    el('feedback-toggle').hidden = !state.requests.length || Boolean(state.quality) || state.processing;
    syncWorking(panel.open && (busySend || (state.processing || revealing.size > 0) && !el('input').value.trim()));
    panel.querySelectorAll('[data-quality]').forEach(b => { b.disabled = state.processing || !state.requests.length || Boolean(state.quality); b.setAttribute('aria-pressed', String(b.dataset.quality === state.quality)); });
  };
  async function refresh() {
    if (!selected || pollBusy) return;
    pollBusy = true; const id = selected;
    try { const next = await api('tasks/' + id); if (selected === id) { state = next; render(); consumeActions(); } }
    catch (e) { note(e); } finally { pollBusy = false; }
  }
  panel.setOpen = open => {
    panel.open = open; panel.toggleAttribute('open', open); launcher.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('learning-chat-open', open);
    detail.classList.toggle('coordinator-open', open);
    if (open) { detail.append(panel); sizeInput(); refresh(); } else { syncWorking(false); setHistory(false); setFeedback(false); document.body.append(panel); window.renderDetail?.(); }
  };
  launcher.hidden = false; launcher.style.display = ''; launcher.onclick = () => panel.setOpen(!panel.open);
  el('close').onclick = () => panel.setOpen(false);
  el('history-toggle').onclick = () => { setFeedback(false); setHistory(el('history').hidden); };
  el('feedback-toggle').onclick = () => { setHistory(false); setFeedback(el('feedback').hidden); };
  el('new').onclick = async () => { try { const next = await api('tasks', { id: crypto.randomUUID() }); await select(next.id); el('input').focus(); } catch (e) { note(e); } };
  el('input').oninput = () => { remember(); sizeInput(); render(); };
  el('input').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); el('compose').requestSubmit(); } };
  el('compose').onsubmit = async e => {
    e.preventDefault(); const text = el('input').value.trim(); if (!text || busySend || !state?.canSubmit) return;
    const task = selected, pendingKey = 'codex-pending-' + task;
    let pending; try { pending = JSON.parse(sessionStorage.getItem(pendingKey)); } catch {}
    if (!pending || pending.text !== text) pending = { requestId: crypto.randomUUID(), text, clientSentAt: Date.now() };
    sessionStorage.setItem(pendingKey, JSON.stringify(pending));
    if (!sent.has(pending.requestId)) sent.set(pending.requestId, performance.now());
    busySend = true; messageError = ''; render();
    try {
      await api('tasks/' + task + '/messages', pending); sessionStorage.removeItem(pendingKey); sessionStorage.removeItem('codex-draft-' + task);
      if (selected === task) { el('input').value = ''; sizeInput(); } await refresh();
    } catch (error) { note(error); }
    finally { busySend = false; render(); }
  };
  el('stop').onclick = async () => { try { await api(base() + '/cancel', {}); await refresh(); } catch (e) { note(e); } };
  panel.querySelectorAll('[data-quality]').forEach(b => b.onclick = async () => { try { await api(base() + '/feedback', { quality: b.dataset.quality }); setFeedback(false); await refresh(); } catch (e) { note(e); } });
  try {
    const meta = await api('meta');
    if (!meta.tasks.some(t => t.id === selected)) selected = meta.tasks.findLast(t => !t.quality)?.id || '';
    if (!selected) selected = (await api('tasks', { id: crypto.randomUUID() })).id;
    await select(selected); panel.setOpen(true);
  } catch (e) { note(e); panel.setOpen(true); }
  setInterval(() => { if (panel.open && document.visibilityState === 'visible') refresh(); }, 700);
};
