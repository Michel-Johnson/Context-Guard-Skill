import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';

import { entries } from './map-model.mjs';

const BUG_STATUS = {
  open: 'Open',
  handling: 'InProgress',
  fixed: 'Pending',
  resolved: 'Resolved',
  recurred: 'InProgress',
};

const TODO_STATUS = { pending: 'Open', processing: 'InProgress', done: 'Done' };

function cleanSegment(value) {
  return String(value || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/[. ]+$/g, '')
    .trim() || 'unnamed';
}

function brief(value) {
  const text = String(value || '').trim();
  if (!text) return 'NULL';
  return [...text].slice(0, 20).join('');
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
  return path.posix.relative(path.posix.dirname(from), to) || path.posix.basename(to);
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

export function validateGeneratedLinks(files) {
  for (const [name, content] of files) {
    for (const match of content.matchAll(/\]\(([^)]+)\)/g)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(name), match[1]));
      assert(files.has(target), `${name}: missing linked file ${match[1]}`);
    }
  }
}

export function buildFilesystemV2(snapshot) {
  assert(snapshot?.memory?.map?.root, 'Snapshot is missing memory.map.root');
  const document = snapshot.memory.map;
  const records = snapshot.memory.records || {};
  const nodeEntries = [...entries(document.root).values()];
  const byId = new Map(nodeEntries.map((entry) => [entry.node.id, entry]));
  const warnings = [];
  const files = new Map();
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
  for (const [name, raw] of bugRecords) {
    const id = path.posix.basename(name, '.md');
    const title = raw.match(/^#\s+(.+)$/m)?.[1] || id;
    const nodeId = extract(raw, 'node');
    const phenomenon = extract(raw, '现象') || 'NULL';
    const status = BUG_STATUS[extract(raw, 'status')] || 'Open';
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
    const testFile = `${dir}/bugs/tests/${id}-A1.md`;
    const traceFile = `${dir}/bugs/traces/${id}-A1.md`;
    const sessions = extract(raw, 'sessions').split(/[,，]\s*/).filter(Boolean);
    const attributionBlock = isMeaningful(cause) ? `### A1
Status: Confirmed

原因：${cause}

#### code index
${code}` : 'NULL';

    put(testFile, `# ${id} A1\n\n${evidence}`);
    put(traceFile, `# ${id} A1\n\n${sessions.length ? sessions.map((value) => `- sessions/${value}.md`).join('\n') : 'NULL'}`);
    put(file, `# ${title}

Reporter: NULL
Status: ${status}
CurrentAttempt: A1

## 1. 现象

${phenomenon}

## 2. 后续纠正事件

NULL

## 3. 复现

### A1
${trigger}

## 4. 原因与代码改动

### 当前有效结论
${method}

${attributionBlock}

## 5. 测试

- [A1](${relative(file, testFile)})：${evidence}

## 6. 修复 Session 索引

- [A1](${relative(file, traceFile)})`);

    const item = { id, title, phenomenon, status, file, legacyNode: nodeId };
    if (assigned) {
      const list = bugsByNode.get(nodeId) || [];
      list.push(item);
      bugsByNode.set(nodeId, list);
    } else {
      unassignedBugs.push(item);
    }
  }

  if (unassignedBugs.length) {
    put('unassigned/index.md', `# Unassigned migration records

${unassignedBugs.map((bug) => `### [${bug.title}](${relative('unassigned/index.md', bug.file)})
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
      const testFile = `${nodeDir.get(node.id)}/todos/tests/${id}-A1.md`;
      const traceFile = `${nodeDir.get(node.id)}/todos/traces/${id}-A1.md`;
      put(testFile, `# ${id} A1\n\nNULL`);
      put(traceFile, `# ${id} A1\n\nNULL`);
      put(file, `# ${id} ${title}

Reporter: NULL
Status: ${status}
CurrentAttempt: A1

## 1. 需求

${description}

## 2. 后续调整事件

NULL

## 3. 验收标准

### A1
NULL

## 4. 方案与代码改动

### 当前有效方案
NULL

### A1
方案：NULL

#### code index
NULL

## 5. 测试

- [A1](${relative(file, testFile)})：NULL

## 6. 实现 Session 索引

- [A1](${relative(file, traceFile)})`);
      const list = todosByNode.get(node.id) || [];
      list.push({ id, title, description, status, file });
      todosByNode.set(node.id, list);
    }

    index = 0;
    for (const idea of node.ideas || []) {
      index += 1;
      const id = idea.id || `I-${node.id}-${index}`;
      const text = String(idea.text || '').trim() || 'NULL';
      const title = text === 'NULL' ? id : brief(text);
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
    return `#### [${targetNode.title}](${relative(from, `${nodeDir.get(id)}/index.md`)})\n${brief(targetNode.purpose)}`;
  }).join('\n\n') : 'NULL';

  for (const { node } of nodeEntries) {
    const file = `${nodeDir.get(node.id)}/index.md`;
    const children = [...(node.children || []), ...(node._inbox || [])].map((child) => child.id);
    const bugs = bugsByNode.get(node.id) || [];
    const todos = todosByNode.get(node.id) || [];
    const ideas = ideasByNode.get(node.id) || [];
    const bugBlock = bugs.length ? bugs.map((bug) => `### [${bug.title}](${relative(file, bug.file)})\n${bug.phenomenon}\n\nStatus: ${bug.status}`).join('\n\n') : 'NULL';
    const todoBlock = todos.length ? todos.map((todo) => `### [${todo.title}](${relative(file, todo.file)})\n${brief(todo.description)}\n\nStatus: ${todo.status}`).join('\n\n') : 'NULL';
    const ideaBlock = ideas.length ? ideas.map((idea) => `### [${idea.title}](${relative(file, idea.file)})\n${brief(idea.text)}\n\nStatus: ${idea.status}`).join('\n\n') : 'NULL';
    put(file, `# ${node.title}

${brief(node.purpose)}

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
      briefsTruncated: nodeEntries.filter(({ node }) => [...String(node.purpose || '').trim()].length > 20).length,
      briefsMissing: nodeEntries.filter(({ node }) => !String(node.purpose || '').trim()).length,
      reporterUnknown: bugRecords.length + [...todosByNode.values()].flat().length,
    },
    warnings,
  };
  put('migration-report.json', JSON.stringify(report, null, 2));
  validateGeneratedLinks(files);

  const hashes = [...files].map(([name, content]) => ({
    path: name,
    sha256: crypto.createHash('sha256').update(content).digest('hex'),
  }));
  put('manifest.json', JSON.stringify({ sourceVersion: snapshot.version, files: hashes }, null, 2));
  return { files, report };
}
