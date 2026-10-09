// Copied into a newly owned CI profile. Node builtins only: no project/user
// modules, lifecycle hooks, provider credentials or Core writes are loaded.
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const tools = ['context_guard_context', 'context_guard_source', 'context_guard_test', 'context_guard_exchange'];
const encode = value => JSON.stringify(value, null, 2) + '\n';
const canonical = value => JSON.stringify(value, (_key, item) => object(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const safeDeny = { permission: 'deny', user_message: 'CI tool permission denied', agent_message: 'Use only the assigned CI MCP tools.' };
const bootstrap = 'const f=require("node:fs"),c=require("node:crypto");'
  + 'const [p,s,m,h]=process.argv.slice(1);'
  + 'try{const d=f.openSync(p,f.constants.O_RDONLY|(f.constants.O_NOFOLLOW||0)),a=f.fstatSync(d);'
  + 'if(!a.isFile()||a.nlink!==1||a.size<1||a.size>65536)process.exit(1);'
  + 'const b=f.readFileSync(d);f.closeSync(d);if(c.createHash("sha256").update(b).digest("hex")!==s)process.exit(1);'
  + 'import("data:text/javascript;base64,"+b.toString("base64")).then(x=>x.runCursorCiGuard({manifestFile:m,manifestSha256:h}))'
  + '.catch(()=>process.exit(1));}catch{process.exit(1)}';

function quote(value) {
  if (process.platform !== 'win32') return `'${value.replaceAll("'", "'\\''")}'`;
  if (/["%!&|<>^\r\n]/.test(value)) throw new Error('Unsupported private guard command path');
  return `"${value}"`;
}
export function cursorCiGuardHooks({ nodeCommand, scriptFile, scriptSha256, manifestFile, manifestSha256 }) {
  // cmd.exe metacharacters never occur in the fixed encoded bootstrap. Paths
  // still reject expansion/metacharacters rather than guessing shell escapes.
  const code = process.platform === 'win32'
    ? `eval(Buffer.from('${Buffer.from(bootstrap).toString('hex')}','hex').toString('utf8'))` : bootstrap;
  const command = [nodeCommand, '-e', code, scriptFile, scriptSha256, manifestFile, manifestSha256].map(quote).join(' ');
  const entry = { command, matcher: '.*', timeout: 5, failClosed: true, loop_limit: null };
  return { version: 1, hooks: { preToolUse: [{ ...entry }], subagentStart: [{ ...entry }], beforeMCPExecution: [{ ...entry }] } };
}

async function privateDirectory(directory) {
  if (!path.isAbsolute(directory || '') || await fs.realpath(directory) !== directory) throw new Error('Private path changed');
  for (let current = directory;; current = path.dirname(current)) {
    const info = await fs.lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Private parent changed');
    if (path.dirname(current) === current) break;
  }
  const parent = await fs.stat(directory);
  if (process.platform !== 'win32' && parent.mode & 0o077) throw new Error('Private parent changed');
}
// Official 2026.10.01 cursor-config Xq / workspace-paths r_: ACP's Hook
// workspace is the DATA/projects slot, not its actual native startup cwd.
export function cursorCiHookWorkspaceRoot(profileRoot, nativeCwd) {
  const slot = nativeCwd.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  return path.join(profileRoot, 'home', '.cursor', 'projects', slot);
}
export async function verifyCursorCiHookWorkspace(record) {
  if (typeof record.hookWorkspaceRoot !== 'string' || typeof record.nativeCwd !== 'string' ||
      record.hookWorkspaceRoot !== cursorCiHookWorkspaceRoot(record.profileRoot, record.nativeCwd)) throw new Error('Private Hook workspace changed');
  await privateDirectory(path.dirname(record.hookWorkspaceRoot));
  await privateDirectory(record.hookWorkspaceRoot);
  // Native transcript/store data is expected here; executable project
  // configuration is not. Preserve unexpected files, never repair them.
  for (const relative of ['.cursor/hooks.json', '.cursor/hooks', '.cursor/mcp.json', '.cursor/skills', '.cursor/commands',
    '.cursor/agents', '.cursor/plugins', '.cursor/rules', '.claude', '.agents', '.codex', '.grok', 'AGENTS.md', 'CLAUDE.md']) {
    const present = await fs.lstat(path.join(record.hookWorkspaceRoot, relative)).then(() => true, cause => {
      if (cause.code === 'ENOENT') return false; throw cause;
    });
    if (present) throw new Error('Private Hook workspace changed');
  }
}
async function privateBytes(file) {
  if (!path.isAbsolute(file) || await fs.realpath(file) !== file) throw new Error('Private path changed');
  await privateDirectory(path.dirname(file));
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size < 1 || before.size > 65536 ||
        process.platform !== 'win32' && (before.mode & 0o777) !== 0o600) throw new Error('Private file changed');
    const bytes = await handle.readFile(), after = await handle.stat(), named = await fs.lstat(file);
    if (bytes.length !== before.size || !named.isFile() || named.isSymbolicLink() || named.nlink !== 1 ||
        ['ino', 'dev', 'size', 'mtimeMs', 'ctimeMs', 'mode'].some(key => before[key] !== after[key] || before[key] !== named[key]) ||
        await fs.realpath(file) !== file) throw new Error('Private file changed');
    return bytes;
  } finally { await handle.close(); }
}
const json = bytes => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));

export async function evaluateCursorCiGuard({ manifestFile, manifestSha256, input, now = Date.now }) {
  let stage = 'input';
  const denied = () => ({ ...safeDeny, user_message: `CI tool permission denied (${stage})` });
  try {
    if (!/^[a-f0-9]{64}$/.test(manifestSha256 || '') || !object(input)) return denied();
    stage = 'manifest';
    const manifestBytes = await privateBytes(manifestFile);
    if (digest(manifestBytes) !== manifestSha256) return denied();
    const manifest = json(manifestBytes);
    if (!object(manifest) || manifest.format !== 1 || !object(manifest.record) ||
        Object.keys(manifest).sort().join(',') !== 'endpoint,format,nodeCommand,record,recordFile' ||
        manifest.record.format !== 3 || manifest.record.mode !== 'ci-mcp-only-v2' || manifest.record.state !== 'prepared' ||
        !uuid.test(manifest.record.sessionId || '') || !Number.isSafeInteger(manifest.record.expiresAt) || now() >= manifest.record.expiresAt ||
        !path.isAbsolute(manifest.nodeCommand || '') || !/^http:\/\/127\.0\.0\.1:\d+\/ci$/.test(manifest.endpoint || '')) return denied();
    stage = 'record';
    const record = json(await privateBytes(manifest.recordFile));
    if (!object(record) || !uuid.test(record.nativeSessionId || '') || record.guardPolicySha256 !== manifestSha256) return denied();
    const { nativeSessionId, guardPolicySha256, hooksSha256, ...immutable } = record;
    if (canonical(immutable) !== canonical(manifest.record)) return denied();
    stage = 'identity';
    if (input.conversation_id !== nativeSessionId || input.session_id !== nativeSessionId) return denied();
    stage = 'workspace';
    await verifyCursorCiHookWorkspace(record);
    if (canonical(input.workspace_roots) !== canonical([record.hookWorkspaceRoot]) ||
        Object.hasOwn(input, 'cwd') && input.cwd !== record.nativeCwd) return denied();
    stage = 'files';
    const host = path.join(record.profileRoot, 'guard'), home = path.join(record.profileRoot, 'home', '.cursor');
    if (manifestFile !== path.join(host, 'guard-policy.json') ||
        digest(await privateBytes(path.join(host, 'cursor-ci-guard.mjs'))) !== record.guardScriptSha256 ||
        digest(await privateBytes(path.join(home, 'mcp.json'))) !== record.mcpSha256) return denied();
    const expectedHooks = encode(cursorCiGuardHooks({ nodeCommand: manifest.nodeCommand,
      scriptFile: path.join(host, 'cursor-ci-guard.mjs'), scriptSha256: record.guardScriptSha256, manifestFile, manifestSha256 }));
    if (digest(expectedHooks) !== hooksSha256 || digest(await privateBytes(path.join(home, 'hooks.json'))) !== hooksSha256) return denied();
    // Every private read above can cross the original deadline. No file or
    // Hook timeout is permission to extend that deadline.
    stage = 'expiry';
    if (now() >= record.expiresAt) return denied();
    stage = 'tool';
    if (input.hook_event_name === 'preToolUse' && tools.some(tool => input.tool_name === `MCP:${tool}`) &&
        object(input.tool_input)) return { permission: 'allow' };
    if (input.hook_event_name === 'beforeMCPExecution' && tools.includes(input.tool_name) &&
        input.mcp_server_name === 'context-guard-ci' && input.url === manifest.endpoint && input.mcp_server_url === manifest.endpoint &&
        !Object.hasOwn(input, 'command') && typeof input.tool_input === 'string' && object(JSON.parse(input.tool_input))) return { permission: 'allow' };
    return denied();
  } catch { return denied(); }
}

export async function runCursorCiGuard(options) {
  let result = { ...safeDeny, user_message: 'CI tool permission denied (stdin)' };
  try {
    const chunks = []; let size = 0, excessive = false;
    for await (const chunk of process.stdin) {
      size += chunk.length;
      if (size > 65536) excessive = true;
      if (!excessive) chunks.push(chunk);
    }
    if (!excessive) result = await evaluateCursorCiGuard({ ...options, input: json(Buffer.concat(chunks)) });
  } catch { /* Only the fixed denial is returned; stdin and filesystem errors contain private data. */ }
  process.stdout.write(JSON.stringify(result) + '\n');
}
