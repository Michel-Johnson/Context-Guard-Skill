import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { performance } from 'node:perf_hooks';

const execute = promisify(execFile);
const failure = (code, message) => Object.assign(new Error(message), { code });

// Operator-only initial readiness gate. It does not contact Slack, start a
// second Socket client, expose credentials, or claim ongoing network health.
export function initialSocketReady(unit, records) {
  if (unit.ActiveState !== 'active' || !/^[1-9]\d*$/.test(String(unit.MainPID || '')) ||
      !/^[1-9]\d*$/.test(String(unit.ExecMainStartTimestampMonotonic || ''))) return false;
  return records.some(record => record._PID === String(unit.MainPID) &&
    record.MESSAGE === 'Slack plugin started (Jerry Family)' &&
    /^\d+$/.test(String(record.__MONOTONIC_TIMESTAMP || '')) &&
    BigInt(record.__MONOTONIC_TIMESTAMP) >= BigInt(unit.ExecMainStartTimestampMonotonic));
}

export async function inspectInitialReadiness(unit, timeoutMs, { run = execute, now = () => performance.now() } = {}) {
  const deadline = now() + timeoutMs;
  const options = () => {
    const remaining = Math.ceil(deadline - now());
    if (remaining <= 0) throw failure('SLACK_NOT_READY', 'Initial readiness inspection exceeded its deadline');
    return { timeout: remaining, maxBuffer: 1024 * 1024, encoding: 'utf8' };
  };
  const fieldsOf = stdout => Object.fromEntries(stdout.trim().split('\n').map(line => {
    const equal = line.indexOf('='); return [line.slice(0, equal), line.slice(equal + 1)];
  }));
  const statusArgs = ['show', unit, '-p', 'ActiveState', '-p', 'MainPID', '-p', 'ExecMainStartTimestampMonotonic'];
  const fields = fieldsOf((await run('systemctl', statusArgs, options())).stdout);
  const journal = await run('journalctl', ['--unit', unit, '--boot=0', '--output=json', '--no-pager', '--lines=200'], options());
  // Do not print journal contents: optional SDK logs may contain private data.
  const records = journal.stdout.trim() ? journal.stdout.trim().split('\n').map(line => JSON.parse(line)) : [];
  // A restart can happen while reading journal. Recheck the generation before
  // trusting its log; changed generations remain not-ready and are retried.
  const latest = fieldsOf((await run('systemctl', statusArgs, options())).stdout);
  const stable = ['ActiveState', 'MainPID', 'ExecMainStartTimestampMonotonic'].every(key => fields[key] === latest[key]);
  return { ready: stable && now() <= deadline && initialSocketReady(latest, records), pid: latest.MainPID || null, active: latest.ActiveState === 'active' };
}

export async function waitForInitialReadiness({ unit = 'context-guard-slack.service', timeoutMs = 120000,
  observe = inspectInitialReadiness, now = Date.now, delay = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  if (!/^context-guard-slack(?:-candidate)?\.service$/.test(unit) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000) {
    throw failure('INVALID_ARGUMENT', 'Use an installed Slack unit and a bounded readiness deadline');
  }
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    let observation;
    try { observation = await observe(unit, Math.max(1, Math.min(3000, deadline - now()))); }
    catch { throw failure('READINESS_UNAVAILABLE', 'Cannot verify the current Slack process readiness; inspect private service diagnostics'); }
    if (observation.ready && observation.active && now() <= deadline) return { ready: true, pid: observation.pid, proof: 'initial-socket-start' };
    if (now() >= deadline) break;
    await delay(Math.min(500, deadline - now()));
  }
  throw failure('SLACK_NOT_READY', 'Slack has not confirmed initial Socket readiness within the deadline');
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  const args = process.argv.slice(2);
  const valid = args.length === 0 || args.length === 2 && args[0] === '--unit';
  (valid ? waitForInitialReadiness({ ...(args.length ? { unit: args[1] } : {}) }) : Promise.reject(failure('INVALID_ARGUMENT', 'Use --unit with an installed Slack service')))
    .then(result => console.log(JSON.stringify(result)), cause => { console.error(JSON.stringify({ ready: false, code: cause.code || 'READINESS_UNAVAILABLE' })); process.exitCode = 1; });
}
