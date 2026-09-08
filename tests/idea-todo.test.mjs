import '../.github/scripts/test-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { applyOperations, workItemAssignedTo } from '../prototype/map-model.mjs';
import { MapStore } from '../scripts/workbench/store.mjs';
import { generateProjections } from '../scripts/workbench/projections.mjs';
import { readJSON } from '../scripts/workbench/io.mjs';

const agent = { kind: 'agent', sessionId: 'session-eval-1' };
const human = { kind: 'human', sessionId: 'workbench' };

function issueMap() {
  return {
    v: 1,
    project: 'user-eval-app',
    bootstrap: 'proposed',
    root: {
      id: 'T0',
      title: 'Main',
      kind: 'module',
      proposal: 'accepted',
      children: [{
        id: 'N1',
        title: 'HTTP 服务与路由',
        kind: 'work',
        proposal: 'proposed',
        state: 'dirty',
        purpose: '',
        memories: [],
        ideas: [],
        todos: [],
        bugs: [],
        dormant: [],
        files: [],
        owns: [],
        children: [],
      }],
    },
  };
}

test('issue #50: agent node idea becomes executable todo without task playbook files', async () => {
  const doc = issueMap();
  const idea = { text: '支持导出 markdown：GET /export.md …', state: 'dirty', files: [] };
  const { doc: saved } = applyOperations(doc, [{ type: 'update', id: 'N1', fields: { ideas: [idea] } }], agent, ['N1']);
  const node = saved.root.children[0];

  assert.equal(node.ideas.length, 1);
  assert.equal(node.todos.length, 1, 'idea must materialize into node.todos[]');
  assert.match(node.todos[0].title, /支持导出 markdown/);
  assert.equal(node.todos[0].desc, idea.text);
  assert.equal(node.todos[0].status, 'pending');
  assert.equal(node.todos[0].source_idea, node.ideas[0].id);
  assert.ok(workItemAssignedTo(node.todos[0], agent.sessionId));

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-idea-todo-'));
  const ctx = path.join(root, '.codex/context');
  await fs.mkdir(path.join(ctx, 'tasks'), { recursive: true });
  await generateProjections(root, saved, 'issue-50');
  const tasksIndex = await readJSON(path.join(ctx, 'tasks-index.json'), {});
  assert.deepEqual(tasksIndex, {});
  assert.equal((await fs.readdir(path.join(ctx, 'tasks'))).length, 0);

  const card = await fs.readFile(path.join(ctx, 'cards/N1.md'), 'utf8');
  assert.match(card, /## Idea/);
  assert.match(card, /支持导出 markdown/);
  assert.match(card, /## TODO/);
  assert.match(card, /TD1: 支持导出 markdown.*\[pending\]/);
});

test('issue #50: idea todo materialization is idempotent and skips human edits', () => {
  const doc = issueMap();
  const idea = { text: '支持导出 markdown：GET /export.md …', state: 'dirty', files: [] };
  const first = applyOperations(doc, [{ type: 'update', id: 'N1', fields: { ideas: [idea] } }], agent, ['N1']).doc;
  const second = applyOperations(first, [{ type: 'update', id: 'N1', fields: { ideas: first.root.children[0].ideas } }], agent, ['N1']).doc;
  assert.equal(second.root.children[0].todos.length, 1);

  const humanEdit = applyOperations(second, [{ type: 'update', id: 'N1', fields: { ideas: [...second.root.children[0].ideas, { text: '人工 brainstorm', state: 'dirty', files: [] }] } }], human).doc;
  assert.equal(humanEdit.root.children[0].ideas.length, 2);
  assert.equal(humanEdit.root.children[0].todos.length, 1, 'human idea edits must not auto-create todos');
});

test('issue #50: MapStore commit persists materialized todos from agent ideas', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-idea-store-'));
  const file = path.join(root, '.codex/context/map.json');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(issueMap()));
  const store = await new MapStore(root, { project: async () => true }).init();
  t.after(async () => { await store.close(); await fs.rm(root, { recursive: true, force: true }); });

  await store.commit({
    operationId: 'issue-50-agent-idea',
    baseVersion: store.version,
    operations: [{ type: 'update', id: 'N1', fields: { ideas: [{ text: '支持导出 markdown：GET /export.md …', state: 'dirty', files: [] }] } }],
  }, agent, ['N1']);

  const node = store.doc.root.children[0];
  assert.equal(node.todos.length, 1);
  const disk = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(disk.root.children[0].todos.length, 1);
});
