import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export function summarizeHooks(result, target) {
  const expected = path.join(target, 'scripts/context_guard_hook.py').replaceAll('\\', '/');
  const hooks = (result.data || []).flatMap(item => item.hooks || []).filter(item => String(item.command || '').replaceAll('\\', '/').includes(expected));
  const events = new Set(hooks.filter(item => item.enabled && item.trustStatus === 'trusted').map(item => item.eventName));
  const required = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'PreCompact', 'PostCompact', 'SubagentStart', 'SubagentStop', 'Stop', 'Interrupt'];
  return { trusted: required.every(event => events.has(event)), hooks: hooks.map(({ eventName, enabled, trustStatus }) => ({ eventName, enabled, trustStatus })), missing: required.filter(event => !events.has(event)) };
}
export function inspectHooks(root, target, command = 'codex') {
  return new Promise(resolve => {
    const child = spawn(command, ['app-server', '--stdio'], { cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    let buffer = '', settled = false;
    const finish = value => { if (settled) return; settled = true; clearTimeout(timer); child.stdin.end(); child.kill(); resolve(value); };
    const timer = setTimeout(() => finish({ trusted: false, unavailable: true }), 5000);
    const send = value => child.stdin.write(JSON.stringify(value) + '\n');
    child.on('error', () => finish({ trusted: false, unavailable: true }));
    child.stdin.on('error', () => {});
    child.on('exit', () => finish({ trusted: false, unavailable: true }));
    child.stdout.on('data', chunk => {
      buffer += chunk; if (buffer.length > 4 * 1024 * 1024) return finish({ trusted: false, unavailable: true });
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        let value; try { value = JSON.parse(line); } catch { continue; }
        if (value.error) return finish({ trusted: false, unavailable: true });
        if (value.id === 1) { send({ method: 'initialized' }); send({ id: 2, method: 'hooks/list', params: { cwds: [root] } }); }
        if (value.id === 2) return finish(summarizeHooks(value.result || {}, target));
      }
    });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'context_guard_doctor', version: '1.0' }, capabilities: { experimentalApi: true } } });
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await inspectHooks(process.argv[2], process.argv[3])));
