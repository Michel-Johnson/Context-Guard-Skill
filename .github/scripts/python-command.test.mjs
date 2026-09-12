import test from 'node:test';
import assert from 'node:assert/strict';
import { pythonCommand } from './python-command.mjs';

test('test Python launcher rejects aliases, failures and Python 2 with bounded probes', () => {
  const calls = [];
  assert.equal(pythonCommand({ platform: 'win32', probe(command, args, options) {
    calls.push(command); assert.equal(options.timeout, 5000); assert.equal(options.windowsHide, true);
    return command === 'python' ? { status: 0, stdout: 'Windows Store' } : { status: 0, stderr: 'Python 3.13.7' };
  } }), 'python3');
  assert.deepEqual(calls, ['python', 'python3']);
  for (const result of [{ status: 0, stdout: 'Python 2.7' }, { status: 1, stdout: 'Python 3.13' }, { error: new Error('timeout') }]) {
    assert.throws(() => pythonCommand({ probe: () => result }), /No working Python 3/);
  }
});

test('test Python launcher prefers Python on Windows and python3 on Unix', () => {
  const probe = () => ({ status: 0, stdout: 'Python 3.13.7' });
  assert.equal(pythonCommand({ platform: 'win32', probe }), 'python');
  assert.equal(pythonCommand({ platform: 'linux', probe }), 'python3');
});
