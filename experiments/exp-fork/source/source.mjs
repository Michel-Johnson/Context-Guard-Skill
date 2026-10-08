import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
export const fault = (code, message) => Object.assign(new Error(message), { code });
export const tool = (name, description, properties, required = Object.keys(properties)) => ({ name, description,
  input_schema: { type: 'object', properties, required, additionalProperties: false } });
const str = { type: 'string' }, int = { type: 'integer' };
export const sourceTools = [
  tool('read_map', 'Read the pinned repository architecture map. Optional nodeId narrows to a module and its children.', { nodeId: str }, []),
  tool('list_files', 'List tracked files or direct directories in the pinned source snapshot. Never reads the host filesystem.', { path: str, recursive: { type: 'boolean' } }, []),
  tool('search_code', 'Search literal text in pinned source. Narrow path for broad terms. Returns file paths and line numbers.', { query: str, path: str }, ['query']),
  tool('read_file', 'Read numbered lines of a pinned source file. Cite findings as Markdown source links with line numbers.', { path: str, start: int, limit: int }, ['path']),
];

export class Source {
  constructor({ root, commit, map }) { Object.assign(this, { root, commit, map }); }
  async git(args, maxBuffer = 2 * 1024 * 1024) {
    return (await exec('git', ['-c', 'core.longpaths=true', ...args], { cwd: this.root, encoding: 'utf8', maxBuffer, timeout: 15000, windowsHide: true })).stdout;
  }
  async init() {
    if (!/^[a-f0-9]{40}$/.test(this.commit)) throw fault('INVALID_COMMIT', 'Require an exact Git commit');
    const entries = (await this.git(['ls-tree', '-rz', this.commit])).split('\0').filter(Boolean);
    this.files = new Map(entries.map(row => { const [meta, file] = row.split('\t'); return [file, meta.split(' ')[0]]; }));
    return this;
  }
  safePath(value = '') {
    if (typeof value !== 'string' || value.length > 400 || value.includes('\\') || /[\x00-\x1f:*?\[\]]/.test(value) || value.startsWith('/') || value.split('/').some(p => p === '..' || p === '.git')) {
      throw fault('INVALID_PATH', 'Use a repository-relative tracked path');
    }
    return value.replace(/\/$/, '');
  }
  async read(file, start = 1, limit = 160) {
    file = this.safePath(file);
    if (!['100644', '100755'].includes(this.files.get(file))) throw fault('NOT_FOUND', 'Only regular tracked source files can be read');
    if (!Number.isInteger(start) || start < 1 || !Number.isInteger(limit) || limit < 1 || limit > 300) throw fault('INVALID_ARGUMENT', 'Read 1-300 lines starting at line 1 or later');
    let text;
    try { text = await this.git(['show', `${this.commit}:${file}`], 1024 * 1024); }
    catch { throw fault('FILE_TOO_LARGE', 'Source file exceeds the bounded reader'); }
    if (text.includes('\0')) throw fault('BINARY_FILE', 'Binary files cannot be read as text');
    const lines = text.split('\n');
    return { path: file, commit: this.commit, start, totalLines: lines.length,
      text: lines.slice(start - 1, start - 1 + limit).map((line, i) => `${start + i}: ${line.slice(0, 700)}`).join('\n'),
      url: `/experiment/source?path=${encodeURIComponent(file)}&line=${start}` };
  }
  async call(name, input = {}) {
    const spec = sourceTools.find(t => t.name === name);
    if (!spec || !input || Array.isArray(input) || typeof input !== 'object' || Object.keys(input).some(k => !Object.hasOwn(spec.input_schema.properties, k))) throw fault('INVALID_ARGUMENT', 'Invalid source tool');
    if (name === 'read_map') {
      let selected;
      const visit = node => { if (!input.nodeId || node.id === input.nodeId) selected ||= node; node.children.forEach(visit); };
      visit(this.map.root);
      if (!selected) throw fault('NOT_FOUND', 'Map node not found');
      return { commit: this.commit, node: selected };
    }
    if (name === 'read_file') return this.read(input.path, input.start, input.limit);
    const prefix = this.safePath(input.path || '');
    if (prefix && ![...this.files.keys()].some(p => p === prefix || p.startsWith(prefix + '/'))) throw fault('NOT_FOUND', 'Path not found in pinned snapshot');
    if (name === 'list_files') {
      const paths = [...this.files.keys()].filter(p => !prefix || p === prefix || p.startsWith(prefix + '/'));
      const values = input.recursive ? paths : [...new Set(paths.map(p => { if (p === prefix) return p; const rest = prefix ? p.slice(prefix.length + 1) : p; const first = rest.split('/')[0]; return (prefix ? prefix + '/' : '') + first + (rest.includes('/') ? '/' : ''); }))];
      return { paths: values.slice(0, 180), total: values.length, truncated: values.length > 180 };
    }
    if (typeof input.query !== 'string' || !input.query.trim() || input.query.length > 160) throw fault('INVALID_ARGUMENT', 'Provide a literal query of 1-160 characters');
    try {
      const text = await this.git(['grep', '-n', '-I', '-F', '-m', '8', '-e', input.query, this.commit, '--', ...(prefix ? [prefix] : [])], 1024 * 1024);
      const rows = text.trim().split('\n').map(line => line.slice(this.commit.length + 1));
      return { matches: rows.slice(0, 70).map(line => line.slice(0, 800)), truncated: rows.length > 70 };
    } catch (error) {
      if (error.code === 1) return { matches: [], truncated: false };
      throw fault('SEARCH_TOO_BROAD', 'Narrow the search path or query');
    }
  }
}
