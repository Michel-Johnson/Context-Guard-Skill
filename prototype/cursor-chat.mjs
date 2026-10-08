export function splitCursorParagraphs(text) {
  return String(text || '').split(/\n\s*\n/).flatMap(block => {
    const characters = Array.from(block), paragraphs = [];
    while (characters.length) {
      let count = Math.min(60, characters.length);
      if (characters.length > 60) {
        for (let i = count - 1; i >= 30; i--) if (/[。！？；.!?;\n]/.test(characters[i])) { count = i + 1; break; }
      }
      paragraphs.push(characters.splice(0, count).join(''));
    }
    return paragraphs;
  });
}

// Same component for local, paired-device and Cursor Cloud conversations.
// It displays provider output, never turns a native end_turn into acceptance.
export function installCursorChat(sync, { button = document.getElementById('btn-cursor'), language = 'zh' } = {}) {
  if (!button || !sync.config) return;
  const english = language === 'en';
  const labels = english ? {
    title: 'Cursor conversation', close: 'Close Cursor conversation', session: 'Cursor Session', input: 'Task or follow-up', send: 'Send',
    refresh: 'Refresh', pause: 'Pause updates', resume: 'Resume updates', create: 'Run in Cursor Cloud',
    empty: 'No Cursor Session yet. Create one with the local CLI, or run a task in Cursor Cloud.',
    waiting: 'Waiting for Cursor…', active: 'Cursor is replying…', stopped: 'Turn ended', unknown: 'Checking native execution…',
    failed: 'Turn did not complete. Check the connection and native Session.', error: 'Unable to confirm. Refresh before resending.',
    required: 'Enter a task or follow-up.', ready: 'Connected. You can send a task or follow-up.',
  } : {
    title: 'Cursor 对话', close: '关闭 Cursor 对话', session: 'Cursor 会话', input: '任务或追问', send: '发送',
    refresh: '刷新', pause: '暂停更新', resume: '继续更新', create: '在 Cursor Cloud 执行',
    empty: '尚无 Cursor 会话。先用本机 CLI 创建，或在 Cursor Cloud 执行任务。',
    waiting: '等待 Cursor 回复…', active: 'Cursor 正在回复…', stopped: '本轮输出结束', unknown: '正在核对原生执行状态…',
    failed: '本轮未完成，请检查连接和原生会话。', error: '尚未确认结果。先刷新核对，再决定是否重发。',
    required: '输入任务或追问。', ready: '已连接，可以发送任务或继续追问。',
  };
  const dialog = document.createElement('dialog'); dialog.className = 'cursor-chat'; dialog.setAttribute('aria-labelledby', 'cursor-chat-title');
  const title = document.createElement('h2'); title.id = 'cursor-chat-title'; title.textContent = labels.title;
  const close = document.createElement('button'); close.type = 'button'; close.textContent = labels.close;
  const header = document.createElement('div'); header.className = 'cursor-chat-head'; header.append(title, close);
  const selectLabel = document.createElement('label'); selectLabel.textContent = labels.session;
  const select = document.createElement('select'); select.name = 'cursorSession'; selectLabel.append(select);
  const messages = document.createElement('div'); messages.className = 'cursor-chat-messages'; messages.setAttribute('role', 'log'); messages.setAttribute('aria-live', 'off');
  const status = document.createElement('p'); status.id = 'cursor-chat-status'; status.setAttribute('role', 'status');
  const form = document.createElement('form');
  const inputLabel = document.createElement('label'); inputLabel.textContent = labels.input;
  const input = document.createElement('textarea'); input.name = 'cursorPrompt'; input.rows = 3; input.maxLength = 16000; input.setAttribute('aria-describedby', status.id); inputLabel.append(input);
  const send = document.createElement('button'); send.type = 'submit'; send.textContent = labels.send;
  const create = document.createElement('button'); create.type = 'button'; create.textContent = labels.create; create.hidden = true;
  const refreshButton = document.createElement('button'); refreshButton.type = 'button'; refreshButton.textContent = labels.refresh;
  const pause = document.createElement('button'); pause.type = 'button'; pause.textContent = labels.pause;
  const actions = document.createElement('div'); actions.className = 'cursor-chat-actions'; actions.append(send, create, refreshButton, pause);
  form.append(inputLabel, actions); dialog.append(header, selectLabel, messages, status, form); document.body.append(dialog);
  let timer, disposed = false, paused = false, loadingEpoch = null, sending = false, pendingRequest = null, currentKey = '', epoch = 0, busy = true;
  const stop = () => { clearTimeout(timer); timer = null; };
  const controls = () => { send.disabled = sending || busy || !select.value; create.disabled = sending; select.disabled = sending; input.readOnly = sending; };
  const render = state => {
    const key = JSON.stringify(state.messages || []);
    if (key !== currentKey) {
      currentKey = key; messages.replaceChildren();
      for (const message of state.messages || []) {
        const article = document.createElement('article'); article.className = 'cursor-chat-message ' + (message.role === 'user' ? 'user' : 'assistant');
        for (const paragraph of splitCursorParagraphs(message.text)) { const p = document.createElement('p'); p.textContent = paragraph; article.append(p); }
        if (message.truncated) { const p = document.createElement('p'); p.textContent = english ? 'Output preview is partial.' : '此处为部分输出。'; article.append(p); }
        messages.append(article);
      }
      messages.scrollTop = messages.scrollHeight;
    }
    busy = state.pending === true || state.status === 'active' || state.status === 'unknown';
    status.textContent = state.status === 'active' ? labels.active : state.pending ? labels.waiting
      : state.status === 'unknown' ? labels.unknown : ['failed', 'interrupted'].includes(state.status) ? labels.failed : labels.stopped;
    controls();
  };
  const refresh = async () => {
    const currentEpoch = epoch, sessionId = select.value;
    if (loadingEpoch === currentEpoch || disposed || !dialog.open) return;
    stop(); loadingEpoch = currentEpoch;
    try {
      if (sessionId) {
        const state = await sync.call('/api/cursor-chat?session=' + encodeURIComponent(sessionId));
        if (currentEpoch === epoch && dialog.open && sessionId === select.value) render(state);
      } else { status.textContent = labels.empty; busy = true; controls(); }
    } catch { if (currentEpoch === epoch && dialog.open) { status.textContent = labels.error; busy = true; controls(); } }
    finally {
      if (loadingEpoch === currentEpoch) loadingEpoch = null;
      if (currentEpoch === epoch && !disposed && dialog.open && !paused) timer = setTimeout(refresh, 1000);
    }
  };
  const sessions = async preferred => {
    const currentEpoch = epoch;
    const data = await sync.call('/api/cursor-chat'), selected = preferred || select.value;
    if (currentEpoch !== epoch || !dialog.open) return;
    select.replaceChildren();
    for (const session of data.sessions || []) {
      const option = document.createElement('option'); option.value = session.id; option.textContent = session.name || session.id; select.append(option);
    }
    if (selected && [...select.options].some(option => option.value === selected)) select.value = selected;
    create.hidden = data.canCreateCloud !== true;
    status.textContent = select.value ? labels.ready : labels.empty;
    busy = true; controls();
  };
  button.hidden = false;
  button.onclick = async () => {
    if (dialog.open) return;
    epoch++; busy = true; controls(); dialog.showModal(); input.focus(); button.setAttribute('aria-expanded', 'true'); status.textContent = labels.waiting;
    try { await sessions(); await refresh(); } catch { status.textContent = labels.error; send.disabled = true; }
  };
  close.onclick = () => dialog.close();
  dialog.addEventListener('close', () => { epoch++; stop(); button.setAttribute('aria-expanded', 'false'); button.focus(); });
  select.onchange = () => { epoch++; stop(); busy = true; controls(); currentKey = ''; messages.replaceChildren(); void refresh(); };
  refreshButton.onclick = async () => { stop(); try { await sessions(); await refresh(); } catch { status.textContent = labels.error; } };
  pause.onclick = () => { paused = !paused; pause.textContent = paused ? labels.resume : labels.pause; stop(); if (!paused) void refresh(); };
  const submit = async cloud => {
    if (sending || !cloud && busy) return;
    if (!input.value.trim()) { input.setAttribute('aria-invalid', 'true'); status.textContent = labels.required; input.focus(); return; }
    input.removeAttribute('aria-invalid');
    if (!cloud && !select.value) { status.textContent = labels.empty; return; }
    if (pendingRequest && (pendingRequest.text !== input.value || pendingRequest.sessionId !== select.value || pendingRequest.cloud !== cloud)) { status.textContent = labels.error; return; }
    pendingRequest ||= { id: crypto.randomUUID(), text: input.value, sessionId: select.value, cloud };
    sending = true; controls(); status.textContent = labels.waiting;
    try {
      const result = await sync.call('/api/cursor-chat', cloud ? { action: 'create', id: pendingRequest.id, text: pendingRequest.text }
        : { id: pendingRequest.id, sessionId: pendingRequest.sessionId, text: pendingRequest.text });
      input.value = ''; pendingRequest = null;
      if (cloud) await sessions(result.sessionId);
      epoch++; stop(); await refresh();
    } catch (cause) { if (cause.serverResponse && cause.code !== 'UNAVAILABLE') pendingRequest = null; status.textContent = labels.error; }
    finally { sending = false; controls(); }
  };
  form.onsubmit = event => { event.preventDefault(); void submit(false); };
  create.onclick = () => void submit(true);
  input.onkeydown = event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); form.requestSubmit(); } };
  window.addEventListener('pagehide', () => { disposed = true; stop(); });
  return { dialog, refresh };
}
