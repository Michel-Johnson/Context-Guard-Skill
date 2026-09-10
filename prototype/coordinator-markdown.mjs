import { lexer } from './vendor/marked.mjs';

// Keep long plain-language replies readable even when the model returns one
// giant paragraph.  Split at sentence punctuation (or a bounded fallback),
// while leaving Markdown blocks and fenced code untouched.
function paragraphize(source, limit = 60) {
  const lines = String(source || '').replace(/\r\n?/g, '\n').split('\n');
  const output = [];
  let fence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) { fence = !fence; output.push(line); continue; }
    if (fence || line.length <= limit || /^\s*(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s|\|)/.test(line)) { output.push(line); continue; }
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

// Only exact, unique titles from the server's Main navigation become buttons.
// Unknown/ambiguous text stays text; code and external links are never rewritten.
function linkMapNodes(root, nodes, onNode, doc) {
  if (!onNode) return;
  const unique = new Map();
  for (const node of nodes) {
    if (typeof node.id !== 'string' || typeof node.title !== 'string' || !node.title.trim()) continue;
    unique.set(node.title, unique.has(node.title) ? null : node);
  }
  const candidates = [...unique.values()].filter(Boolean).sort((a, b) => b.title.length - a.title.length);
  const walker = doc.createTreeWalker(root, 4), texts = [];
  while (walker.nextNode()) if (!walker.currentNode.parentElement?.closest('a,code,pre,button')) texts.push(walker.currentNode);
  for (const text of texts) {
    let remaining = text.textContent; const fragment = doc.createDocumentFragment(); let changed = false;
    while (remaining) {
      let match = null, offset = remaining.length;
      for (const node of candidates) {
        const at = remaining.indexOf(node.title);
        if (at >= 0 && at < offset) { match = node; offset = at; }
      }
      if (!match) { fragment.append(doc.createTextNode(remaining)); break; }
      fragment.append(doc.createTextNode(remaining.slice(0, offset)));
      const button = doc.createElement('button'); button.type = 'button'; button.className = 'coordinator-node-link';
      button.textContent = match.title; button.title = '在地图中查看此节点'; button.dataset.nodeId = match.id;
      button.addEventListener('click', () => onNode(match.id)); fragment.append(button);
      remaining = remaining.slice(offset + match.title.length); changed = true;
    }
    if (changed) text.replaceWith(fragment);
  }
}

export function conversationFragments(messages, doc = document, { nodes = [], onNode, onAnswer, questionDrafts = new Map(), canAnswer = false, activeTurnId, running = false } = {}) {
  const body = doc.createDocumentFragment();
  for (const message of messages) {
    const workflow = message.role === 'user' && (message.text || '').startsWith('[服务器工作流事件，不是新的用户授权]\n');
    if (workflow || message.answerTo || !message.text) continue;
    const row = doc.createElement('article'); row.className = `coordinator-message ${message.role === 'assistant' ? 'assistant' : 'user'}`;
    const content = doc.createElement('div'); content.className = 'coordinator-markdown';
    if (!message.questions?.length) content.append(markdownFragment(message.text.replace(/^\[实验：模拟人工输入\]\n/, ''), doc));
    for (const question of message.questions || []) {
      const card = doc.createElement('section'); card.className = 'coordinator-question'; card.dataset.questionId = question.id;
      const title = doc.createElement('div'); title.append(markdownFragment(question.text, doc)); card.append(title);
      const activity = doc.createElement('p'); activity.className = 'coordinator-question-status'; activity.setAttribute('role', 'status');
      activity.textContent = '正在回复…'; activity.hidden = !(running && question.answer?.requestId === activeTurnId);
      if (question.answer) {
        const answer = doc.createElement('p'); answer.className = 'coordinator-answer'; answer.textContent = '你的回答：' + question.answer.text; card.append(answer);
      } else {
        const draft = questionDrafts.get(question.id) || { option: '', text: '' }; questionDrafts.set(question.id, draft);
        const choices = doc.createElement('div'); choices.className = 'coordinator-choices';
        const optionButtons = [];
        for (const option of question.options || []) {
          const button = doc.createElement('button'); button.type = 'button'; button.textContent = option; button.disabled = !canAnswer;
          button.setAttribute('aria-pressed', String(draft.option === option)); optionButtons.push(button);
          button.addEventListener('click', () => {
            draft.option = draft.option === option ? '' : option;
            for (const item of optionButtons) item.setAttribute('aria-pressed', String(item.textContent === draft.option));
            update();
          }); choices.append(button);
        }
        const input = doc.createElement('textarea'); input.rows = 2; input.maxLength = 6000;
        input.placeholder = '在此回答，或补充说明…'; input.setAttribute('aria-label', '回答：' + question.text); input.value = draft.text;
        const send = doc.createElement('button'); send.type = 'button'; send.textContent = '提交回答';
        const update = () => { send.disabled = !canAnswer || !(draft.option || draft.text.trim()); };
        input.addEventListener('input', () => { draft.text = input.value; update(); });
        send.addEventListener('click', () => onAnswer?.(question, [draft.option, draft.text.trim()].filter(Boolean).join('\n\n')));
        update(); card.append(choices, input, send);
      }
      card.append(activity); content.append(card);
    }
    if (message.role === 'assistant') linkMapNodes(content, nodes, onNode, doc);
    row.append(content); body.append(row);
  }
  return { body };
}
