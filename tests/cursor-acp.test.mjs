import test from 'node:test';
import assert from 'node:assert/strict';
import { CursorAcp } from '../scripts/workbench/cursor-acp.mjs';

// The native process is an isolated protocol peer, not a real Cursor/model.
// It verifies wire behavior; paid Cursor compatibility remains a separate gate.
const peer = `
const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin });
const native = 'cursor-native-session';
let permission, turns = 0;
const send = message => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\\n');
rl.on('line', line => {
  const request = JSON.parse(line);
  if (request.method === 'initialize') {
    if (request.params.clientCapabilities.fs.writeTextFile !== false) process.exit(12);
    send({ id: request.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true } } });
  } else if (request.method === 'authenticate') {
    if (request.params.methodId !== 'cursor_login') process.exit(13);
    send({ id: request.id, result: {} });
  } else if (request.method === 'session/new') send({ id: request.id, result: { sessionId: native } });
  else if (request.method === 'session/load') {
    send({ method: 'session/update', params: { sessionId: request.params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '历史' } } } });
    send({ id: request.id, result: {} });
  } else if (request.method === 'session/prompt') {
    const text = request.params.prompt[0].text;
    permission = request.id;
    if (request.params.sessionId !== native) process.exit(14);
    if (text === 'silent') return;
    if (text === 'exit') process.exit(3);
    if (text === 'malformed') { process.stdout.write('not json\\n'); return; }
    if (text === 'oversized') { process.stdout.write('x'.repeat(4096)); return; }
    if (text === 'rpc-error') { send({ id: request.id, error: { code: -32000, message: 'private-token-do-not-log' } }); return; }
    if (text === 'foreign') {
      send({ method: 'session/update', params: { sessionId: 'another-session', update: {} } }); return;
    }
    send({ id: 'permission', method: 'session/request_permission', params: { sessionId: native, options: [{ optionId: 'allow', kind: 'allow_once' }, { optionId: 'deny', kind: 'reject_once' }] } });
  } else if (request.id === 'permission') {
    const outcome = request.result.outcome;
    send({ method: 'session/update', params: { sessionId: native, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '第' + (++turns) + '轮:' + (outcome.optionId || outcome.outcome) } } } });
    send({ id: permission, result: { stopReason: 'end_turn' } });
  } else if (request.method === 'session/cancel') send({ id: permission, result: { stopReason: 'cancelled' } });
});
`;

function client(t, options = {}) {
  const instance = new CursorAcp({ command: process.execPath, cwd: process.cwd(), args: ['-e', peer, '--'], env: {}, ...options });
  t.after(() => instance.close());
  return instance;
}

test('ACP authenticates, streams Unicode and follows up in the same native Session', async t => {
  const chunks = [];
  const acp = client(t, { onUpdate: update => chunks.push(update.update.content.text), requestPermission: () => 'allow' });
  assert.equal((await acp.connect()).sessionId, 'cursor-native-session');
  assert.equal((await acp.prompt('first')).stopReason, 'end_turn');
  assert.equal((await acp.prompt('follow-up')).stopReason, 'end_turn');
  assert.deepEqual(chunks, ['第1轮:allow', '第2轮:allow']);
});

test('ACP load uses the exact existing native Session and retains replayed updates', async t => {
  const chunks = [];
  const acp = client(t, { onUpdate: update => chunks.push(update.update.content.text) });
  await acp.connect({ sessionId: 'cursor-native-session' });
  await acp.prompt('follow-up');
  assert.deepEqual(chunks, ['历史', '第1轮:cancelled']);
});

test('ACP rejects absent/invalid permission decisions instead of silently approving', async t => {
  const chunks = [];
  const acp = client(t, { requestPermission: () => 'invented-option', onUpdate: update => chunks.push(update.update.content.text) });
  await acp.connect(); await acp.prompt('first');
  assert.deepEqual(chunks, ['第1轮:cancelled']);
});

test('ACP rejects parallel turns and cancellation waits for the native result', async t => {
  const acp = client(t); await acp.connect();
  const turn = acp.prompt('silent', { timeoutMs: 2000 });
  await assert.rejects(acp.prompt('second'), { code: 'RUNTIME_BUSY' });
  acp.cancel();
  assert.equal((await turn).stopReason, 'cancelled');
});

for (const [prompt, code] of [['foreign', 'CURSOR_SESSION_MISMATCH'], ['malformed', 'CURSOR_PROTOCOL_ERROR'],
  ['oversized', 'CURSOR_OUTPUT_LIMIT'], ['exit', 'CURSOR_DISCONNECTED'], ['silent', 'CURSOR_TIMEOUT']]) {
  test('ACP fails safely for ' + prompt, async t => {
    const acp = client(t, { outputLimitBytes: 2048 }); await acp.connect();
    await assert.rejects(acp.prompt(prompt, { timeoutMs: 500 }), { code });
    await acp.closed;
    assert.equal(acp.pending.size, 0);
  });
}

test('ACP exposes a bounded RPC error code without private native error text', async t => {
  const acp = client(t); await acp.connect();
  await assert.rejects(acp.prompt('rpc-error'), cause => cause.code === 'CURSOR_RPC_ERROR' && !cause.message.includes('private-token'));
});

test('ACP rejects bad settings, missing binary and invalid prompts', async t => {
  assert.throws(() => new CursorAcp({ command: 'agent', cwd: process.cwd() }), { code: 'INVALID_RUNTIME' });
  const absent = new CursorAcp({ command: '/nonexistent/context-guard-cursor', cwd: process.cwd() });
  t.after(() => absent.close());
  await assert.rejects(absent.connect(), { code: 'CURSOR_START_FAILED' });
  const acp = client(t); await acp.connect();
  await assert.rejects(acp.prompt(''), { code: 'INVALID_PROMPT' });
  await assert.rejects(acp.prompt('x'.repeat(65537)), { code: 'INVALID_PROMPT' });
});
