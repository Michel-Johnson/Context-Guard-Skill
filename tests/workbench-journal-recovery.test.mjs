import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { MapStore } from '../scripts/workbench/store.mjs';
import { startServer } from '../scripts/workbench/server.mjs';
import { request } from '../scripts/workbench/cli.mjs';
import { encode, hash } from '../scripts/workbench/io.mjs';

const human = { kind: 'human', sessionId: 'workbench' };

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-journal-recovery-'));
  const context = path.join(root, '.codex/context');
  await fs.mkdir(context, { recursive: true });
  await fs.writeFile(path.join(context, 'map.json'), encode({ v: 1, project: 'journal-test', root: { id: 'T0', title: 'Test', children: [{ id: 'N1', title: 'One', children: [] }] } }));
  await fs.writeFile(path.join(context, 'sessions.jsonl'), `${JSON.stringify({ session_id: 'journal-agent' })}\n`);
  return root;
}

const edit = (store, title = 'Saved change') => ({ operationId: randomUUID(), baseVersion: store.version, operations: [{ type: 'update', id: 'N1', fields: { title } }] });

test('an interrupted final journal record is backed up and reconciled without replay', async t => {
  const root = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let failed = false;
  const store = await new MapStore(root, { fault: async point => { if (!failed && point === 'after-map') { failed = true; throw new Error('simulated exit'); } } }).init();
  const input = edit(store);
  await assert.rejects(store.commit(input, human), { code: 'RECOVERY_REQUIRED' });
  const mapHash = hash(await fs.readFile(store.file));
  await store.close();
  const truncated = Buffer.from('{"operationId":"unfinished');
  await fs.writeFile(store.eventsFile, truncated);

  const recovered = await new MapStore(root).init();
  t.after(() => recovered.close());
  assert.equal(recovered.blocked, null);
  assert.equal(hash(await fs.readFile(recovered.file)), mapHash);
  const result = await recovered.commit(input, human);
  assert.equal(result.duplicate, true);
  assert.equal(result.committed, true);
  assert.equal(recovered.events.filter(event => event.operationId === input.operationId).length, 1);
  assert.equal(recovered.changes().journalGap, true);
  assert.deepEqual(await fs.readFile(recovered.journal.backup), truncated);
});

test('a valid final record without a newline is preserved before the next append', async t => {
  const root = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = await new MapStore(root).init();
  await store.commit(edit(store, 'First'), human);
  await store.close();
  await fs.writeFile(store.eventsFile, (await fs.readFile(store.eventsFile, 'utf8')).trimEnd());
  const recovered = await new MapStore(root).init();
  t.after(() => recovered.close());
  assert.equal(recovered.events.length, 1);
  assert.equal(recovered.blocked, null);
  await recovered.commit(edit(recovered, 'Second'), human);
  assert.equal((await fs.readFile(recovered.eventsFile, 'utf8')).trim().split('\n').length, 2);
});

test('interior corruption is read-only until a human accepts the journal gap', async t => {
  const root = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = await new MapStore(root).init();
  await store.commit(edit(store, 'First'), human);
  const first = await fs.readFile(store.eventsFile, 'utf8');
  await store.commit(edit(store, 'Second'), human);
  await store.close();
  const raw = first + '{broken}\n' + (await fs.readFile(store.eventsFile, 'utf8')).slice(first.length);
  await fs.writeFile(store.eventsFile, raw);
  const mapHash = hash(await fs.readFile(store.file));

  const blocked = await new MapStore(root).init();
  t.after(() => blocked.close());
  assert.equal(blocked.state().readOnly, true);
  assert.equal(blocked.doc.root.children[0].title, 'Second');
  assert.equal(await fs.readFile(blocked.eventsFile, 'utf8'), raw);
  await assert.rejects(blocked.commit(edit(blocked, 'Must not write'), human), { code: 'RECOVERY_REQUIRED' });
  await assert.rejects(blocked.repair({ baseVersion: blocked.version }), { code: 'CONFIRM_JOURNAL_GAP' });
  const result = await blocked.repair({ baseVersion: blocked.version, acceptJournalGap: true });
  assert.equal(result.readOnly, false);
  assert.equal(hash(await fs.readFile(blocked.file)), mapHash);
  assert.equal(await fs.readFile(result.journal.backup, 'utf8'), raw);
  assert.equal(blocked.changes().journalGap, true);
});

test('damaged pending metadata preserves the map and starts read-only', async t => {
  const root = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = await new MapStore(root).init();
  await store.close();
  await fs.writeFile(store.pendingFile, '{');
  const blocked = await new MapStore(root).init();
  t.after(() => blocked.close());
  assert.equal(blocked.state().readOnly, true);
  assert.ok(blocked.doc.root);
  await assert.rejects(blocked.commit(edit(blocked), human), { code: 'RECOVERY_REQUIRED' });
  assert.equal(await fs.readFile(blocked.pendingFile, 'utf8'), '{');
});

test('only the human workbench can confirm journal recovery through the server', async t => {
  const root = await fixture();
  const seed = await new MapStore(root).init();
  await seed.commit(edit(seed, 'Before corruption'), human);
  await seed.close();
  await fs.appendFile(seed.eventsFile, '{broken}\n');
  const server = await startServer({ root, port: 0 });
  t.after(async () => { await server.close(); await fs.rm(root, { recursive: true, force: true }); });
  const agent = await request(server.state, '/api/session', { method: 'POST', body: { sessionId: 'journal-agent' } });
  await assert.rejects(request(server.state, '/api/recover', { token: agent.token, method: 'POST', body: { baseVersion: server.store.version, acceptJournalGap: true } }), { code: 'FORBIDDEN' });
  const recovered = await request(server.state, '/api/recover', { token: server.humanToken, method: 'POST', body: { baseVersion: server.store.version, acceptJournalGap: true } });
  assert.equal(recovered.readOnly, false);
  assert.equal(recovered.journal.pending, false);
});
