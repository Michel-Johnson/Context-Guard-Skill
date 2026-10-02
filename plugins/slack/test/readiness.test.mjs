import test from 'node:test';
import assert from 'node:assert/strict';
import { initialSocketReady, inspectInitialReadiness, waitForInitialReadiness } from '../scripts/wait-ready.mjs';

const unit = { ActiveState: 'active', MainPID: '42', ExecMainStartTimestampMonotonic: '10000' };
const record = { _PID: '42', MESSAGE: 'Slack plugin started (Jerry Family)', __MONOTONIC_TIMESTAMP: '10001' };
test('Service active alone is not Slack readiness and old PID or generation logs cannot satisfy it', () => {
  assert.equal(initialSocketReady(unit, []), false);
  assert.equal(initialSocketReady(unit, [{ ...record, _PID: '41' }]), false);
  assert.equal(initialSocketReady(unit, [{ ...record, __MONOTONIC_TIMESTAMP: '9999' }]), false);
  assert.equal(initialSocketReady(unit, [{ ...record, MESSAGE: 'Slack SDK warning' }]), false);
  assert.equal(initialSocketReady({ ...unit, ActiveState: 'inactive' }, [record]), false);
  assert.equal(initialSocketReady({ ...unit, MainPID: '0' }, [record]), false);
  assert.equal(initialSocketReady({ ...unit, ExecMainStartTimestampMonotonic: 'bad' }, [record]), false);
  assert.equal(initialSocketReady(unit, [record]), true);
});
test('Readiness waits for the actual condition and does not pass process activity', async () => {
  let elapsed = 0, calls = 0;
  const result = await waitForInitialReadiness({ now: () => elapsed, delay: async ms => { elapsed += ms; },
    observe: async () => ({ ready: ++calls === 3, pid: '42', active: true }), timeoutMs: 2000 });
  assert.deepEqual(result, { ready: true, pid: '42', proof: 'initial-socket-start' }); assert.equal(calls, 3);
});
test('Not-ready and late observations fail the deadline instead of reporting usable', async () => {
  let elapsed = 0;
  await assert.rejects(waitForInitialReadiness({ now: () => elapsed, delay: async ms => { elapsed += ms; },
    observe: async () => ({ ready: false, active: true }), timeoutMs: 1000 }), { code: 'SLACK_NOT_READY' });
  elapsed = 0;
  await assert.rejects(waitForInitialReadiness({ now: () => elapsed, observe: async () => { elapsed = 1001; return { ready: true, active: true }; }, timeoutMs: 1000 }), { code: 'SLACK_NOT_READY' });
});
test('Inspection failures are sanitized and invalid unit arguments never run a command', async () => {
  await assert.rejects(waitForInitialReadiness({ observe: async () => { throw new Error('synthetic private provider details'); } }),
    cause => cause.code === 'READINESS_UNAVAILABLE' && !cause.message.includes('private provider'));
  for (const options of [{ unit: 'other.service' }, { timeoutMs: 0 }, { timeoutMs: 300001 }]) {
    await assert.rejects(waitForInitialReadiness({ ...options, observe: () => assert.fail('Invalid arguments cannot query a service') }), { code: 'INVALID_ARGUMENT' });
  }
});

test('Actual readiness inspector rejects a restart between systemctl and journal reads', async () => {
  let statusReads = 0;
  const result = await inspectInitialReadiness('context-guard-slack-candidate.service', 1000, { run: async name => {
    if (name === 'journalctl') return { stdout: JSON.stringify(record) + '\n' };
    const current = ++statusReads === 1 ? unit : { ...unit, MainPID: '43', ExecMainStartTimestampMonotonic: '20000' };
    return { stdout: Object.entries(current).map(([key, value]) => `${key}=${value}`).join('\n') };
  } });
  assert.equal(result.ready, false, 'The old process log cannot confirm the new generation');
  assert.equal(result.pid, '43');
});

test('Actual readiness commands share the remaining deadline and verify a stable generation', async () => {
  let elapsed = 0; const commands = [], budgets = [];
  const result = await inspectInitialReadiness('context-guard-slack.service', 1000, { now: () => elapsed, run: async (name, args, options) => {
    commands.push(name); budgets.push(options.timeout);
    if (name === 'journalctl') { assert.ok(args.includes('--boot=0')); elapsed += 400; return { stdout: JSON.stringify(record) + '\n' }; }
    elapsed += 100; return { stdout: Object.entries(unit).map(([key, value]) => `${key}=${value}`).join('\n') };
  } });
  assert.equal(result.ready, true);
  assert.deepEqual(commands, ['systemctl', 'journalctl', 'systemctl']);
  assert.deepEqual(budgets, [1000, 900, 500]);
});
