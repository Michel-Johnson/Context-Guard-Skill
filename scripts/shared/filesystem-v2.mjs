import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';

import { entries } from './map-model.mjs';

const BUG_STATUS = {
  open: 'Open',
  handling: 'InProgress',
  inprogress: 'InProgress',
  pending: 'Pending',
  fixed: 'Pending',
  resolved: 'Resolved',
  recurred: 'InProgress',
  unfixable: 'Unfixable',
};
const DROP_BUG_STATUS = new Set(['wontfix']);
const END_LEGACY_BUG_STATUS = { deferred: 'Unfixable' };

const TODO_STATUS = { pending: 'Open', processing: 'InProgress', done: 'Done' };

function cleanSegment(value) {
  return String(value || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/[. ]+$/g, '')
    .trim() || 'unnamed';
}

function firstParagraph(value) {
  const text = String(value || '').trim();
  if (!text) return 'NULL';
  return text.split(/\r?\n\s*\r?\n/)[0].trim();
}

const textOrNull = value => String(value || '').trim() || 'NULL';
const linesOrNull = lines => lines.length ? lines.join('\n\n') : 'NULL';

function codeIndex(attempt) {
  return attempt.codeIndex?.length ? attempt.codeIndex.map(entry => `- \`${entry.path}\`\n  ${entry.summary}`).join('\n') : 'NULL';
}

function attemptEvent(attempt, number) {
  return attempt.event ? `- A${number} / ${attempt.eventSource || 'Agent'}：${attempt.event}` : null;
}

function attemptStatus(attempt) {
  return `Status: ${attempt.status}${attempt.status === 'Refuted' ? `\nRefutedBy: ${attempt.refutedBy}\nReason: ${attempt.reason}` : ''}`;
}

function extract(text, label) {
  return text.match(new RegExp(`^- ${label}:\\s*(.*)$`, 'm'))?.[1]?.trim() || '';
}

function section(text, title) {
  return text.match(new RegExp(`^## ${title}\\r?\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm'))?.[1]?.trim() || '';
}

function isMeaningful(value) {
  const text = String(value || '').trim();
  return text && text !== 'NULL' && !/^(待定位|待补充|未修|未知)(?:[；;，,。.]|$)/.test(text);
}

function relative(from, to) {
  const target = path.posix.relative(path.posix.dirname(from), to) || path.posix.basename(to);
  return target.split('/').map((part) => ['.', '..'].includes(part) ? part : encodeURIComponent(part)
    .replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)).join('/');
}

function groupBy(items, keyOf) {
  const groups = new Map();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key) || [];
    group.push(item);
    groups.set(key, group);
  }
  return groups;
}

export function validateGeneratedLinks(files, links) {
  for (const { from, to } of links) assert(files.has(to), `${from}: missing linked file ${to}`);
}

export function buildFilesystemV2(snapshot) {
  assert(snapshot?.memory?.map?.root, 'Snapshot is missing memory.map.root');
  const document = snapshot.memory.map;
  const records = snapshot.memory.records || {};
  const nodeEntries = [...entries(document.root).values()];
  const byId = new Map(nodeEntries.map((entry) => [entry.node.id, entry]));
  const warnings = [];
  const files = new Map();
  const generatedLinks = [];
  const link = (from, to) => { generatedLinks.push({ from, to }); return relative(from, to); };
  const put = (name, content) => {
    assert(!files.has(name), `Duplicate generated path: ${name}`);
    files.set(name, `${content.trim()}\n`);
  };

  const siblings = new Map();
  for (const { node, parent } of nodeEntries) {
    const key = parent?.id || '__root__';
    const list = siblings.get(key) || [];
    list.push({
      id: node.id,
      stem: `${cleanSegment(node.title)}-${node.kind === 'module' ? 'module' : 'node'}`,
    });
    siblings.set(key, list);
  }

  const segment = new Map();
  for (const list of siblings.values()) {
    for (const group of groupBy(list, (item) => item.stem.toLowerCase()).values()) {
      for (const item of group) {
        segment.set(item.id, group.length === 1 ? item.stem : `${item.stem}--${item.id}`);
      }
    }
  }

  const nodeDir = new Map();
  function assign(entry, parentDir = 'nodes') {
    assert(entry, 'Map root or child is missing from the flattened node index');
    const current = `${parentDir}/${segment.get(entry.node.id)}`;
    nodeDir.set(entry.node.id, current);
    for (const child of [...(entry.node.children || []), ...(entry.node._inbox || [])]) {
      assign(byId.get(child.id), current);
    }
  }
  assign(byId.get(document.root.id));

  const related = new Map(nodeEntries.map(({ node }) => [node.id, new Set()]));
  for (const flow of [...(document.flows || []), ...(document.root.flows || [])]) {
    if (!byId.has(flow.from) || !byId.has(flow.to)) {
      warnings.push({ code: 'BROKEN_FLOW', from: flow.from, to: flow.to });
      continue;
    }
    related.get(flow.from).add(flow.to);
    related.get(flow.to).add(flow.from);
  }

  const bugsByNode = new Map();
  const unassignedBugs = [];
  const bugRecords = Object.entries(records).filter(([name]) => /^bugs\/[^/]+\.md$/.test(name));
  const mapBugs = new Map();
  for (const { node } of nodeEntries) for (const item of node.bugs || []) {
    if (!item.id) continue;
    if (mapBugs.has(item.id)) warnings.push({ code: 'DUPLICATE_BUG_ID', id: item.id });
    else mapBugs.set(item.id, { item, nodeId: node.id });
  }
  for (const item of document.unassigned_bugs || []) {
    if (!item.id) continue;
    if (mapBugs.has(item.id)) warnings.push({ code: 'DUPLICATE_BUG_ID', id: item.id });
    else mapBugs.set(item.id, { item, nodeId: '' });
  }
  const legacyBugs = new Map(bugRecords.map(([name, raw]) => [path.posix.basename(name, '.md'), raw]));
  for (const id of new Set([...legacyBugs.keys(), ...mapBugs.keys()])) {
    const raw = legacyBugs.get(id) || '';
    const mapped = mapBugs.get(id), item = mapped?.item;
    const title = textOrNull(item?.title || raw.match(/^#\s+(.+)$/m)?.[1] || id);
    const heading = title === id || title.startsWith(`${id} `) ? title : `${id} ${title}`;
    const nodeId = mapped ? mapped.nodeId : extract(raw, 'node');
    const phenomenon = textOrNull(item?.phenomenon || item?.description || item?.desc || extract(raw, '现象'));
    const rawStatus = String(item?.status || extract(raw, 'status')).toLowerCase();
    if (DROP_BUG_STATUS.has(rawStatus)) {
      warnings.push({ code: 'DROPPED_WONTFIX', id, nodeId });
      continue;
    }
    const status = BUG_STATUS[rawStatus] || END_LEGACY_BUG_STATUS[rawStatus];
    if (!status) {
      warnings.push({ code: 'UNKNOWN_BUG_STATUS', id, nodeId, status: rawStatus || null });
    }
    const fileStatus = status || 'Open';
    if (END_LEGACY_BUG_STATUS[rawStatus]) {
      warnings.push({ code: 'HISTORICAL_DEFERRED', id, nodeId, projected: fileStatus });
    }
    const assigned = byId.has(nodeId);
    if (!assigned) warnings.push({ code: 'ORPHAN_BUG', id, nodeId });

    const fixRaw = records[`fixes/${id}.md`] || '';
    const cause = section(fixRaw, '根因') || 'NULL';
    const method = section(fixRaw, '怎么修') || 'NULL';
    const trigger = section(fixRaw, '触发') || 'NULL';
    const code = section(fixRaw, '代码') || 'NULL';
    const evidence = section(fixRaw, '证据') || 'NULL';
    const dir = assigned ? nodeDir.get(nodeId) : 'unassigned';
    const file = `${dir}/bugs/${id}.md`;
    const sessions = extract(raw, 'sessions').split(/[,，]\s*/).filter(Boolean);
    const attempts = Array.isArray(item?.attempts) && item.attempts.length ? item.attempts : null;
    const attributionBlock = attempts ? attempts.map((attempt, index) => `### A${index + 1}
${attemptStatus(attempt)}

原因：${textOrNull(attempt.cause)}

#### code index
${codeIndex(attempt)}`).join('\n\n') : isMeaningful(cause) ? `### A1
Status: Confirmed

原因：${cause}

#### code index
${code}` : 'NULL';
    const rounds = attempts || [{ reproduction: trigger, test: { summary: evidence, content: evidence }, sessionIds: sessions }];
    for (const [index, attempt] of rounds.entries()) {
      const round = `A${index + 1}`;
      put(`${dir}/bugs/tests/${id}-${round}.md`, `# ${id} ${round}\n\n${textOrNull(attempt.test?.content)}`);
      put(`${dir}/bugs/traces/${id}-${round}.md`, `# ${id} ${round}\n\n${attempt.sessionIds?.length ? attempt.sessionIds.map(value => `- sessions/${value}.md`).join('\n') : 'NULL'}`);
    }
    const effective = attempts ? attempts.filter(attempt => attempt.status === 'Confirmed').at(-1) : null;
    put(file, `# ${heading}

Reporter: ${['Human', 'Agent'].includes(item?.reporter) ? item.reporter : 'NULL'}
Status: ${fileStatus}
CurrentAttempt: A${rounds.length}

## 1. 现象

${phenomenon}

## 2. 后续纠正事件

${attempts ? linesOrNull(attempts.map((attempt, index) => attemptEvent(attempt, index + 1)).filter(Boolean)) : 'NULL'}

## 3. 复现

${rounds.map((attempt, index) => `### A${index + 1}\n${textOrNull(attempt.reproduction)}`).join('\n\n')}

## 4. 原因与代码改动

### 当前有效结论
${attempts ? textOrNull(effective?.resolution || effective?.cause) : method}

${attributionBlock}

## 5. 测试

${rounds.map((attempt, index) => `- [A${index + 1}](${link(file, `${dir}/bugs/tests/${id}-A${index + 1}.md`)})：${textOrNull(attempt.test?.summary)}`).join('\n')}

## 6. 修复 Session 索引

${rounds.map((_, index) => `- [A${index + 1}](${link(file, `${dir}/bugs/traces/${id}-A${index + 1}.md`)})`).join('\n')}`);

    const projected = { id, title: heading, phenomenon, status: fileStatus, file, legacyNode: nodeId };
    if (assigned) {
      const list = bugsByNode.get(nodeId) || [];
      list.push(projected);
      bugsByNode.set(nodeId, list);
    } else {
      unassignedBugs.push(projected);
    }
  }

  if (unassignedBugs.length) {
    put('unassigned/index.md', `# Unassigned migration records

${unassignedBugs.map((bug) => `### [${bug.title}](${link('unassigned/index.md', bug.file)})
${bug.phenomenon}

Status: ${bug.status}
LegacyNode: ${bug.legacyNode || 'NULL'}`).join('\n\n')}`);
  }

  const todosByNode = new Map();
  const ideasByNode = new Map();
  for (const { node } of nodeEntries) {
    let index = 0;
    for (const todo of node.todos || []) {
      index += 1;
      const id = todo.id || `T-${node.id}-${index}`;
      const title = String(todo.title || todo.desc || todo.description || id).trim() || id;
      const description = String(todo.description || todo.desc || todo.title || '').trim() || 'NULL';
      const status = TODO_STATUS[todo.status] || 'Open';
      const file = `${nodeDir.get(node.id)}/todos/${id}.md`;
      const attempts = Array.isArray(todo.attempts) && todo.attempts.length ? todo.attempts : null;
      const rounds = attempts || [{ acceptance: 'NULL', solution: 'NULL', test: { summary: 'NULL', content: 'NULL' } }];
      if (!attempts) warnings.push({ code: 'TODO_ATTEMPT_UNCLASSIFIED', id, nodeId: node.id });
      for (const [roundIndex, attempt] of rounds.entries()) {
        const round = `A${roundIndex + 1}`;
        put(`${nodeDir.get(node.id)}/todos/tests/${id}-${round}.md`, `# ${id} ${round}\n\n${textOrNull(attempt.test?.content)}`);
        put(`${nodeDir.get(node.id)}/todos/traces/${id}-${round}.md`, `# ${id} ${round}\n\n${attempt.sessionIds?.length ? attempt.sessionIds.map(value => `- sessions/${value}.md`).join('\n') : 'NULL'}`);
      }
      const effective = attempts?.filter(attempt => attempt.status === 'Confirmed').at(-1);
      put(file, `# ${id} ${title}

Reporter: ${['Human', 'Agent'].includes(todo.reporter) ? todo.reporter : 'NULL'}
Status: ${status}
CurrentAttempt: A${rounds.length}

## 1. 需求

${description}

## 2. 后续调整事件

${attempts ? linesOrNull(attempts.map((attempt, roundIndex) => attemptEvent(attempt, roundIndex + 1)).filter(Boolean)) : 'NULL'}

## 3. 验收标准

${rounds.map((attempt, roundIndex) => `### A${roundIndex + 1}\n${textOrNull(attempt.acceptance)}`).join('\n\n')}

## 4. 方案与代码改动

### 当前有效方案
${attempts ? textOrNull(effective?.solution) : 'NULL'}

${rounds.map((attempt, roundIndex) => `### A${roundIndex + 1}\n${attempts ? `${attemptStatus(attempt)}\n` : ''}\n方案：${textOrNull(attempt.solution)}\n\n#### code index\n${codeIndex(attempt)}`).join('\n\n')}

## 5. 测试

${rounds.map((attempt, roundIndex) => `- [A${roundIndex + 1}](${link(file, `${nodeDir.get(node.id)}/todos/tests/${id}-A${roundIndex + 1}.md`)})：${textOrNull(attempt.test?.summary)}`).join('\n')}

## 6. 实现 Session 索引

- ${rounds.map((_, roundIndex) => `[A${roundIndex + 1}](${link(file, `${nodeDir.get(node.id)}/todos/traces/${id}-A${roundIndex + 1}.md`)})`).join('\n- ')}`);
      const list = todosByNode.get(node.id) || [];
      list.push({ id, title, description, status, file });
      todosByNode.set(node.id, list);
    }

    index = 0;
    for (const idea of node.ideas || []) {
      index += 1;
      const id = idea.id || `I-${node.id}-${index}`;
      const text = String(idea.text || '').trim() || 'NULL';
      const title = text === 'NULL' ? id : text.split(/\r?\n/)[0].trim();
      const status = idea.state === 'success' ? 'Accepted' : 'Proposed';
      const file = `${nodeDir.get(node.id)}/ideas/${id}.md`;
      put(file, `# ${id} ${title}\nStatus: ${status}\n\n## 1. 想法\n\n${text}\n\n## 2. 讨论与结论\n\nNULL`);
      const list = ideasByNode.get(node.id) || [];
      list.push({ id, title, text, status, file });
      ideasByNode.set(node.id, list);
    }
  }

  const linkBlock = (from, ids) => ids.length ? ids.map((id) => {
    const targetNode = byId.get(id).node;
    return `#### [${targetNode.title}](${link(from, `${nodeDir.get(id)}/index.md`)})\n${firstParagraph(targetNode.purpose)}`;
  }).join('\n\n') : 'NULL';

  for (const { node } of nodeEntries) {
    const file = `${nodeDir.get(node.id)}/index.md`;
    const children = [...(node.children || []), ...(node._inbox || [])].map((child) => child.id);
    const bugs = bugsByNode.get(node.id) || [];
    const todos = todosByNode.get(node.id) || [];
    const ideas = ideasByNode.get(node.id) || [];
    const bugBlock = bugs.length ? bugs.map((bug) => `### [${bug.title}](${link(file, bug.file)})\n${firstParagraph(bug.phenomenon)}\n\nStatus: ${bug.status}`).join('\n\n') : 'NULL';
    const todoBlock = todos.length ? todos.map((todo) => `### [${todo.title}](${link(file, todo.file)})\n${firstParagraph(todo.description)}\n\nStatus: ${todo.status}`).join('\n\n') : 'NULL';
    const ideaBlock = ideas.length ? ideas.map((idea) => `### [${idea.title}](${link(file, idea.file)})\n${firstParagraph(idea.text)}\n\nStatus: ${idea.status}`).join('\n\n') : 'NULL';
    put(file, `# ${node.title}

${firstParagraph(node.purpose)}

## 关联模块与节点

### Related

${linkBlock(file, [...related.get(node.id)])}

### Sub

${linkBlock(file, children)}

## Bug

${bugBlock}

## Todo

${todoBlock}

## Idea

${ideaBlock}`);
  }

  const map = {
    schema_version: 1,
    generated_from: snapshot.version,
    root: document.root.id,
    nodes: nodeEntries.map(({ node, parent }) => ({
      id: node.id,
      type: node.kind === 'module' ? 'module' : 'node',
      parent: parent?.id || null,
      path: `${nodeDir.get(node.id)}/index.md`,
      related: [...related.get(node.id)],
    })),
  };
  put('map.json', JSON.stringify(map, null, 2));

  const report = {
    sourceVersion: snapshot.version,
    sourceMainSha: snapshot.mainSha,
    sourcePublishedAt: snapshot.publishedAt,
    nodes: nodeEntries.length,
    files: files.size + 2,
    bugs: {
      source: bugRecords.length,
      migrated: [...bugsByNode.values()].flat().length + unassignedBugs.length,
      unassigned: unassignedBugs.length,
    },
    todos: [...todosByNode.values()].flat().length,
    ideas: [...ideasByNode.values()].flat().length,
    deferred: {
      memories: nodeEntries.reduce((count, { node }) => count + (node.memories?.length || 0), 0),
      sessions: Object.keys(records).filter((name) => name.startsWith('sessions/')).length,
      legacyRecords: Object.keys(records).length,
    },
    lossy: {
      briefsTruncated: 0,
      briefsMissing: nodeEntries.filter(({ node }) => !String(node.purpose || '').trim()).length,
      reporterUnknown: bugRecords.length + [...todosByNode.values()].flat().length,
    },
    warnings,
  };
  put('migration-report.json', JSON.stringify(report, null, 2));
  validateGeneratedLinks(files, generatedLinks);

  const hashes = [...files].map(([name, content]) => ({
    path: name,
    sha256: crypto.createHash('sha256').update(content).digest('hex'),
  }));
  put('manifest.json', JSON.stringify({ sourceVersion: snapshot.version, files: hashes }, null, 2));
  return { files, report };
}
