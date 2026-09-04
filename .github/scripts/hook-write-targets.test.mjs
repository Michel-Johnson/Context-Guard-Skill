import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const hook = process.env.CONTEXT_GUARD_TEST_HOOK || path.join(repo, 'scripts/context_guard_hook.py');
const root = path.join(repo, 'temp', 'hook-targets-fixture');
const protectedMap = '.codex/context/map.json';
const patch = (headers, body = '+source text') => `*** Begin Patch\n${headers}\n${body}\n*** End Patch`;
const payload = (command, extra = {}) => ({ tool_name: 'apply_patch', tool_input: { command }, ...extra });
const cases = [
  ['source mentions map and TODO', payload(patch('*** Update File: scripts/example.py', `+map_path = "./${protectedMap}"\n+todo_path = "./TODO.md"`)), false],
  ['source mentions absolute map path', payload(patch('*** Update File: scripts/example.py', `+map_path = "${path.join(root, protectedMap)}"`)), false],
  ['CRLF source patch', payload(patch('*** Update File: code.py', `+path = "./${protectedMap}"`).replaceAll('\n', '\r\n')), false],
  ['CI todo is not human-owned TODO', payload(patch('*** Update File: CI_todo.md')), false],
  ['nested human TODO remains protected', payload(patch('*** Update File: docs/todo.md')), true],
  ['namespaced patch tool', payload(patch('*** Add File: notes.md', `+${protectedMap}`), { tool_name: 'functions.apply_patch' }), false],
  ['freeform patch input', { tool_name: 'apply_patch', tool_input: patch('*** Update File: code.py', `+${protectedMap}`) }, false],
  ['patch input field', { tool_name: 'apply_patch', tool_input: { input: patch('*** Update File: code.py', `+${protectedMap}`) } }, false],
  ['patch field', { tool_name: 'apply_patch', tool_input: { patch: patch('*** Update File: code.py', `+${protectedMap}`) } }, false],
  ['header text inside source hunk', payload(patch('*** Update File: code.py', `+*** Update File: ${protectedMap}`)), false],
  ...['Add', 'Update', 'Delete'].map(action => [`real map ${action}`, payload(patch(`*** ${action} File: ${protectedMap}`)), true]),
  ['map rename destination', payload(patch(`*** Update File: draft.json\n*** Move to: ${protectedMap}`)), true],
  ['map rename source', payload(patch(`*** Update File: ${protectedMap}\n*** Move to: draft.json`)), true],
  ['TODO rename destination', payload(patch('*** Update File: draft.md\n*** Move to: TODO.md')), true],
  ['absolute other worktree', payload(patch(`*** Update File: ${path.join(repo, 'temp', 'other', protectedMap)}`)), true],
  ['other worktree with dot segments', payload(patch(`*** Update File: ../other/.codex/context/sub/../map.json`)), true],
  ['Windows target', payload(patch('*** Update File: C:\\repo\\.codex\\context\\map.json')), true],
  ['multiple targets one protected', payload(patch(`*** Update File: code.py\n+ok\n*** Delete File: ${protectedMap}`, '')), true],
  ['structured write', { tool_name: 'Write', tool_input: { file_path: path.join(root, protectedMap), content: '{}' } }, true],
  ['structured normal source', { tool_name: 'Write', tool_input: { file_path: path.join(root, 'code.py'), content: protectedMap } }, false],
  ['raw protected patch', { tool_name: 'apply_patch', tool_input: patch(`*** Delete File: ${protectedMap}`) }, true],
  ['shell write still denied', { tool_name: 'Bash', tool_input: { command: 'cp replacement.json ./.codex/context/map.json' } }, true],
  ['shell cannot masquerade as patch', { tool_name: 'Bash', tool_input: { command: `cp replacement.json ./${protectedMap}\n${patch('*** Update File: code.py')}` } }, true],
  ['read-only tool remains allowed', { tool_name: 'Read', tool_input: { file_path: path.join(root, protectedMap) } }, false],
];

const code = `
import importlib.util, json, sys
from pathlib import Path
hook_path = Path(sys.argv[1])
sys.path.insert(0, str(hook_path.parent))
spec = importlib.util.spec_from_file_location("hook_under_test", hook_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
root = Path(sys.argv[2])
cases = json.load(sys.stdin)
print(json.dumps([{"denied": bool(module.forbidden_direct_write(item, root)), "paths": module.tool_paths(item, root)} for item in cases]))
`;
const result = spawnSync(process.platform === 'win32' ? 'python' : 'python3', ['-B', '-c', code, hook, root], {
  encoding: 'utf8', input: JSON.stringify(cases.map(item => item[1])), timeout: 15_000, windowsHide: true,
});
assert.equal(result.status, 0, result.stderr || String(result.error));
const observations = JSON.parse(result.stdout);
for (const [index, [name, , denied]] of cases.entries()) {
  test(`hook write targets: ${name}`, () => assert.equal(observations[index].denied, denied));
}
test('rename destination participates in node authorization', () => {
  assert.deepEqual(observations[cases.findIndex(item => item[0] === 'map rename destination')].paths,
    [protectedMap, 'draft.json']);
});
