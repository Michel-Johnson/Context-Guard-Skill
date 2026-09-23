import { lexer } from './vendor/marked.mjs';

// Ready-style reveal: wait for a complete Markdown block before painting it.
// The returned offset follows a paragraph, heading, list item, or fence boundary.
export function nextRevealSegmentEnd(source, shown, done = false) {
  const text = String(source || '');
  if (shown >= text.length) return shown;
  const openFence = (text.slice(0, shown).match(/```/g) || []).length % 2;
  if (openFence) return shown;
  let start = shown;
  while (text[start] === '\n') start++;
  if (start >= text.length) return done ? text.length : shown;
  const firstNewline = text.indexOf('\n', start);
  const firstLine = text.slice(start, firstNewline < 0 ? undefined : firstNewline);
  const nextLineEnd = from => text.indexOf('\n', from);
  if (/^\s*```/.test(firstLine)) {
    const close = text.indexOf('```', start + firstLine.indexOf('```') + 3);
    if (close < 0) return done ? text.length : shown;
    const end = close + 3;
    return text[end] === '\n' ? end + 1 : done ? end : shown;
  }
  if (/^#{1,6}\s/.test(firstLine)) return firstNewline < 0 ? done ? text.length : shown : firstNewline + 1;
  const listIndent = line => {
    const match = /^( *)(?:[-*+]|\d+[.)])\s/.exec(line);
    return match && match[1].length < 4 ? match[1].length : null;
  };
  const indent = listIndent(firstLine);
  if (indent !== null) {
    if (firstNewline < 0) return done ? text.length : shown;
    let cursor = firstNewline + 1;
    while (cursor < text.length) {
      const newline = nextLineEnd(cursor);
      const line = text.slice(cursor, newline < 0 ? undefined : newline);
      if (!line.trim()) return newline < 0 ? done ? text.length : shown : newline + 1;
      const nextIndent = listIndent(line);
      if ((nextIndent !== null && nextIndent <= indent) || /^#{1,6}\s|^\s*```/.test(line)) return cursor;
      if (newline < 0) return done ? text.length : shown;
      cursor = newline + 1;
    }
    return done ? text.length : shown;
  }
  let cursor = start;
  while (cursor < text.length) {
    const newline = nextLineEnd(cursor);
    if (newline < 0) return done ? text.length : shown;
    const after = newline + 1;
    if (text[after] === '\n') return after + 1;
    if (after >= text.length) return done ? text.length : shown;
    const nextNewline = nextLineEnd(after);
    const nextLine = text.slice(after, nextNewline < 0 ? undefined : nextNewline);
    if (/^#{1,6}\s|^\s*```/.test(nextLine) || listIndent(nextLine) !== null) return after;
    cursor = after;
  }
  return done ? text.length : shown;
}

// Keep long plain-language replies readable even when the model returns one
// giant paragraph.  Split at sentence punctuation (or a bounded fallback),
// while leaving Markdown blocks and fenced code untouched.
function paragraphize(source, limit = 60) {
  const lines = String(source || '').replace(/\r\n?/g, '\n').split('\n');
  const output = [];
  let fence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) { fence = !fence; output.push(line); continue; }
    // Inline code is semantic Markdown, not plain prose. A synthetic paragraph
    // boundary inside a backtick span turns the remaining delimiters into
    // visible text, so preserve the model-authored paragraph and let CSS wrap it.
    if (fence || line.length <= limit || line.includes('`') || /^\s*(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s|\|)/.test(line)) { output.push(line); continue; }
    let rest = line;
    while (rest.length > limit) {
      const boundary = Math.min(rest.length - 1, limit + 20);
      let cut = -1;
      for (let i = boundary; i >= Math.max(0, limit - 20); i--) {
        if (/[。！？；.!?;:：]/.test(rest[i])) { cut = i + 1; break; }
      }
      if (cut < 1) cut = limit;
      output.push(rest.slice(0, cut)); output.push(''); rest = rest.slice(cut).trimStart();
    }
    output.push(rest);
  }
  return output.join('\n');
}

// Older Coordinator turns sometimes wrote a confirmation heading followed by
// a numbered list instead of calling ask_user. Keep those turns actionable by
// recognizing only an explicit question/confirmation list; ordinary numbered
// Markdown lists remain unchanged.
export function legacyQuestionList(source) {
  const text = String(source || '').replace(/\r\n?/g, '\n');
  const heading = text.match(/(^|\n)([^\n]*(?:问题|确认)[^\n]*(?:如下|分别|需要)[^\n]*：?)[ \t]*\n[ \t]*\n/m);
  if (!heading) return null;
  const start = heading.index + heading[0].lastIndexOf('\n') + 1;
  const list = text.slice(start);
  const matches = [...list.matchAll(/^\s*\d+[.)、]\s+(.+?)(?=\n\s*\d+[.)、]\s+|\n\s*\n|$)/gms)];
  if (matches.length < 2) return null;
  const first = start + matches[0].index;
  const last = start + matches.at(-1).index + matches.at(-1)[0].length;
  const before = text.slice(0, first).trim();
  const after = text.slice(last).trim();
  return { before, after, items: matches.map((match, index) => ({ id: `legacy-question-${index + 1}`, text: match[1].trim() })) };
}

// Build a restricted DOM from Markdown tokens. Never insert model-provided HTML,
// fetch remote images, or attach an unvalidated URL to an active element.
export function markdownFragment(text, doc = document) {
  const root = doc.createDocumentFragment();
  const append = (parent, tokens, depth = 0) => {
    for (const token of tokens || []) {
      const element = name => doc.createElement(name);
      let node;
      if (depth > 40) { parent.append(doc.createTextNode(token.raw || token.text || '')); continue; }
      switch (token.type) {
        case 'space': case 'def': continue;
        case 'paragraph': node = element('p'); break;
        case 'heading': node = element(`h${Math.min(6, Math.max(2, token.depth + 1))}`); break;
        case 'strong': node = element('strong'); break;
        case 'em': node = element('em'); break;
        case 'del': node = element('del'); break;
        case 'blockquote': node = element('blockquote'); break;
        case 'br': parent.append(element('br')); continue;
        case 'hr': parent.append(element('hr')); continue;
        case 'code': {
          node = element('pre'); const code = element('code'); code.textContent = token.text; node.append(code); parent.append(node); continue;
        }
        case 'codespan': node = element('code'); node.textContent = token.text; parent.append(node); continue;
        case 'link': {
          let url; try { url = new URL(token.href, doc.baseURI); } catch {}
          node = element(url && ['http:', 'https:', 'mailto:'].includes(url.protocol) ? 'a' : 'span');
          if (node.tagName === 'A') { node.href = url.href; node.rel = 'noopener noreferrer'; node.target = '_blank'; }
          break;
        }
        case 'list': {
          node = element(token.ordered ? 'ol' : 'ul');
          if (token.ordered && Number.isSafeInteger(token.start) && token.start > 0) node.start = token.start;
          for (const item of token.items) {
            const li = element('li');
            if (item.task) { const box = element('input'); box.type = 'checkbox'; box.disabled = true; box.checked = item.checked; li.append(box); }
            append(li, item.tokens, depth + 1); node.append(li);
          }
          parent.append(node); continue;
        }
        case 'table': {
          const wrap = element('div'); wrap.className = 'coordinator-table'; node = element('table');
          const head = element('thead'), body = element('tbody');
          const row = (cells, tag) => { const tr = element('tr'); for (const cell of cells) { const td = element(tag); append(td, cell.tokens, depth + 1); tr.append(td); } return tr; };
          head.append(row(token.header, 'th')); for (const cells of token.rows) body.append(row(cells, 'td'));
          node.append(head, body); wrap.append(node); parent.append(wrap); continue;
        }
        case 'text': if (token.tokens) { append(parent, token.tokens, depth + 1); continue; } // fall through
        default: parent.append(doc.createTextNode(token.text || token.raw || '')); continue;
      }
      append(node, token.tokens || [{ type: 'text', text: token.text || '' }], depth + 1); parent.append(node);
    }
  };
  const source = paragraphize(String(text || ''));
  try { if (source.length > 64000) throw new Error('Large response'); append(root, lexer(source, { gfm: true })); }
  catch { root.replaceChildren(doc.createTextNode(source)); }
  return root;
}

export function conversationFragments(messages, doc = document, { nodes = [], onNode, onConversation, onAnswer, questionDrafts = new Map(), canAnswer = false, activeTurnId, running = false } = {}) {
  const body = doc.createDocumentFragment();
  const answerComposer = (question, draft, answerValue) => {
    const compose = doc.createElement('div'); compose.className = 'coordinator-answer-compose';
    const input = doc.createElement('textarea'); input.rows = 2; input.maxLength = 6000;
    input.placeholder = '在此回答，或补充说明…'; input.setAttribute('aria-label', '回答：' + question.text); input.value = draft.text;
    const send = doc.createElement('button'); send.type = 'button'; send.textContent = '发送'; send.setAttribute('aria-label', '发送“' + question.text + '”');
    const update = () => { send.disabled = !canAnswer || !answerValue(); };
    const commit = () => { const answer = answerValue(); if (canAnswer && answer) onAnswer?.(question, answer); };
    input.addEventListener('input', () => { draft.text = input.value; update(); });
    input.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
      event.preventDefault(); if (!send.disabled) commit();
    });
    send.addEventListener('click', commit); update(); compose.append(input, send);
    return { compose, update, commit };
  };
  for (const message of messages) {
    const workflow = message.role === 'user' && (message.text || '').startsWith('[服务器工作流事件，不是新的用户授权]\n');
    if (workflow || !message.text) continue;
    const row = doc.createElement('article'); row.className = `coordinator-message ${message.role === 'assistant' ? 'assistant' : 'user'}`;
    const content = doc.createElement('div'); content.className = 'coordinator-markdown';
    const cleanText = message.text.replace(/^\[实验：模拟人工输入\]\n/, '');
    const legacy = !message.questions?.length && message.role === 'assistant' ? legacyQuestionList(cleanText) : null;
    const lead = message.questionOnly ? '' : cleanText;
    if (lead && !legacy) content.append(markdownFragment(lead, doc));
    if (legacy?.before) content.append(markdownFragment(legacy.before, doc));
    for (const question of legacy?.items || []) {
      const card = doc.createElement('section'); card.className = 'coordinator-question coordinator-legacy-question'; card.dataset.questionId = question.id;
      const title = doc.createElement('div'); title.append(markdownFragment(question.text, doc)); card.append(title);
      const draft = questionDrafts.get(question.id) || { option: '', text: '' }; questionDrafts.set(question.id, draft);
      const answerQuestion = { ...question, legacy: true };
      card.append(answerComposer(answerQuestion, draft, () => draft.text.trim()).compose); content.append(card);
    }
    if (legacy?.after) content.append(markdownFragment(legacy.after, doc));
    for (const question of message.questions || []) {
      const card = doc.createElement('section'); card.className = 'coordinator-question'; card.dataset.questionId = question.id;
      const prompt = String(question.text || '').trim();
      if (!prompt || !lead.trimEnd().endsWith(prompt)) {
        const title = doc.createElement('div'); title.append(markdownFragment(question.text, doc)); card.append(title);
      }
      const activity = doc.createElement('p'); activity.className = 'coordinator-question-status'; activity.setAttribute('role', 'status');
      activity.textContent = '正在回复…'; activity.hidden = !(running && question.answer?.requestId === activeTurnId);
      if (question.answer) {
        const answer = doc.createElement('p'); answer.className = 'coordinator-answer'; answer.textContent = '你的回答：' + question.answer.text; card.append(answer);
      } else {
        const draft = questionDrafts.get(question.id) || { option: '', text: '' }; questionDrafts.set(question.id, draft);
        const choices = doc.createElement('div'); choices.className = 'coordinator-choices';
        const optionButtons = [];
        const choiceItems = [
          ...(question.nodes || []).slice(0, 3).map(node => ({ label: node.title, nodeId: node.id })),
          ...(question.options || []).map(label => ({ label })),
        ];
        const answerValue = () => [draft.option, draft.text.trim()].filter(Boolean).join('\n\n');
        const composer = answerComposer(question, draft, answerValue);
        for (const option of choiceItems) {
          const button = doc.createElement('button'); button.type = 'button'; button.textContent = option.label; button.disabled = !canAnswer;
          if (option.nodeId) { button.classList.add('coordinator-node-link'); button.dataset.nodeId = option.nodeId; }
          button.setAttribute('aria-pressed', String(draft.option === option.label)); optionButtons.push(button);
          button.addEventListener('click', () => {
            if (draft.option === option.label) { composer.commit(); return; }
            draft.option = option.label;
            for (const item of optionButtons) item.setAttribute('aria-pressed', String(item.textContent === draft.option));
            composer.update();
          }); choices.append(button);
        }
        card.append(choices, composer.compose);
      }
      card.append(activity); content.append(card);
    }
    for (const action of message.actions || []) {
      if (action.kind === 'node-navigation' || action.kind === 'node-tour' || action.kind === 'node-read') continue;
      const actions = doc.createElement('div'); actions.className = 'coordinator-actions';
      if (action.message && action.message !== cleanText) { const label = doc.createElement('p'); label.textContent = action.message; actions.append(label); }
      for (const node of (action.nodes || (action.node ? [action.node] : [])).slice(0, 3)) {
        const button = doc.createElement('button'); button.type = 'button'; button.className = 'coordinator-node-link';
        button.textContent = node.title; button.dataset.nodeId = node.id; button.addEventListener('click', () => onNode?.(node.id)); actions.append(button);
      }
      if (action.kind === 'conversation-mounted' && action.conversationId) {
        const button = doc.createElement('button'); button.type = 'button'; button.textContent = '继续这个事项';
        button.addEventListener('click', () => onConversation?.(action.conversationId)); actions.append(button);
      }
      content.append(actions);
    }
    row.append(content); body.append(row);
  }
  return { body };
}
