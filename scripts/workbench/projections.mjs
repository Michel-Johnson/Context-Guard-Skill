import fs from 'node:fs/promises';
import path from 'node:path';
import { entries } from '../../prototype/map-model.mjs';
import { atomicWrite, encode, readJSON } from './io.mjs';
const start = '<!-- context-guard:generated:start -->', end = '<!-- context-guard:generated:end -->';
const fields = text => Object.fromEntries(text.split(/\r?\n/).filter(x => /^- [^:]+:/.test(x)).map(x => { const i = x.indexOf(':'); return [x.slice(2, i).trim(), x.slice(i + 1).trim()]; }));
async function markdownIndex(ctx, folder, make) {
  const result = {};
  for (const file of await fs.readdir(path.join(ctx, folder)).catch(e => e.code === 'ENOENT' ? [] : Promise.reject(e))) {
    if (!file.endsWith('.md')) continue;
    const text = await fs.readFile(path.join(ctx, folder, file), 'utf8');
    const id = file.slice(0, -3), f = fields(text);
    result[id] = make(id, f, text.split(/\r?\n/)[0].replace(/^#\s*/, '').replace(new RegExp(`^${id}\\s+`), ''));
  }
  return result;
}
export async function generateProjections(root, doc, version, isCurrent = () => true, { sessionId = '' } = {}) {
  if (!doc?.root) return false;
  const ctx = path.join(root, '.codex/context'), cards = path.join(ctx, 'cards');
  const statusFile = path.join(ctx, 'projection-status.json');
  await atomicWrite(statusFile, encode({ status: 'building', sourceVersion: version }));
  await fs.mkdir(cards, { recursive: true });
  const index = entries(doc.root), owns = [];
  let bugs = await markdownIndex(ctx, 'bugs', (id, f, title) => ({ title, keys: (f.keys || '').split(/[,，]/).map(x => x.trim()).filter(Boolean), status: f.status || 'open', bug: `.codex/context/bugs/${id}.md`, fix: `.codex/context/fixes/${id}.md`, card: f.card || (f.node ? `.codex/context/cards/${f.node}.md` : '') }));
  let tasks = await markdownIndex(ctx, 'tasks', (id, f, title) => ({ title, keys: (f.keys || '').split(/[,，]/).map(x => x.trim()).filter(Boolean), task: `.codex/context/tasks/${id}.md`, chain: (f.chain || '').split('>').map(x => x.trim()).filter(Boolean), card: f.card || '' }));
  if (sessionId) {
    const visibleBugs = new Set(), visibleTasks = new Set();
    for (const { node } of entries(doc.root).values()) {
      for (const item of node.bugs || []) visibleBugs.add(item.id);
      for (const item of node.todos || []) visibleTasks.add(item.id);
    }
    bugs = Object.fromEntries(Object.entries(bugs).filter(([id]) => visibleBugs.has(id)));
    tasks = Object.fromEntries(Object.entries(tasks).filter(([id]) => visibleTasks.has(id)));
  }
  for (const [id, { node, parent }] of index) {
    if (!isCurrent()) return false;
    if (node.proposal === 'cancelled') continue;
    const chain = [id]; let ancestor = parent;
    while (ancestor) { chain.unshift(ancestor.id); ancestor = index.get(ancestor.id).parent; }
    for (const owned of node.owns || []) owns.push({ path: owned, node: id, title: node.title, kind: node.kind, card: `.codex/context/cards/${id}.md`, chain });
    const memories = [], ideas = [], nodeTodos = [], nodeBugs = [];
    for (const { node: source } of index.values()) {
      if (source.proposal === 'cancelled') continue;
      const applies = item => source.id === id || (Array.isArray(item.also) ? item.also : String(item.also || '').split(/[,，]/).map(x => x.trim())).includes(id);
      for (const item of source.memories || []) if (applies(item)) memories.push(`- ${item.text || ''}${source.id === id ? '' : ` (from ${source.id})`}`);
      for (const item of source.todos || []) if (applies(item)) nodeTodos.push(`- ${item.id}: ${item.title || ''} [${item.status || 'pending'}]${source.id === id ? '' : ` (from ${source.id})`}`);
      for (const item of source.bugs || []) if (applies(item)) nodeBugs.push(`- ${item.id}: ${item.title || ''} [${item.status || 'open'}] → .codex/context/bugs/${item.id}.md`);
    }
    for (const item of node.ideas || []) ideas.push(`- ${item.text || ''}`);
    const body = `${start}\n# ${id} ${node.title}\n\n- sourceVersion: ${version}\n- kind: ${node.kind || ''}\n- state: ${node.state || ''}\n- proposal: ${node.proposal || ''}\n- origin: ${node.origin || ''}\n- parent: ${parent?.id || '(root)'}\n- chain: ${chain.join(' > ')}\n- purpose: ${node.purpose || ''}\n- owns: ${(node.owns || []).join(', ')}\n\n## 记忆\n${memories.join('\n')}\n\n## Idea\n${ideas.join('\n')}\n\n## TODO\n${nodeTodos.join('\n')}\n\n## Bug\n${nodeBugs.join('\n')}\n\n## 孩子\n${[...(node.children || []), ...(node._inbox || [])].filter(x => x.proposal !== 'cancelled').map(x => `- ${x.id} ${x.title}`).join('\n')}\n${end}`;
    const file = path.join(cards, id + '.md');
    const old = await fs.readFile(file, 'utf8').catch(e => e.code === 'ENOENT' ? '' : Promise.reject(e));
    const a = old.indexOf(start), b = old.indexOf(end);
    const content = a >= 0 && b > a ? old.slice(0, a) + body + old.slice(b + end.length) : body + '\n' + (old ? '\n## 保留的旧卡片／人工补充（非当前地图状态）\n\n' + old : '');
    await atomicWrite(file, content);
  }
  if (!isCurrent()) return false;
  await atomicWrite(path.join(ctx, 'owns-index.json'), encode({ sourceVersion: version, owns }));
  await atomicWrite(path.join(ctx, 'bugs-index.json'), encode(bugs));
  await atomicWrite(path.join(ctx, 'tasks-index.json'), encode(tasks));
  await atomicWrite(path.join(ctx, 'jump-index.json'), encode({ sourceVersion: version, owns, bugs, tasks }));
  if (isCurrent()) await atomicWrite(statusFile, encode({ status: 'ready', sourceVersion: version }));
  return isCurrent();
}
export async function projectionStatus(root, version) {
  const status = await readJSON(path.join(root, '.codex/context/projection-status.json'), {});
  return { ...status, current: status.status === 'ready' && status.sourceVersion === version };
}
