import path from 'node:path';
import { fault, sourceTools } from './source.mjs';

export class EvidenceSource {
  constructor(base) { this.base = base; this.commit = base.commit; this.map = base.map; this.files = base.files; this.observations = []; }
  async call(name, input = {}) {
    const started = Date.now();
    try {
      let result;
      try {
        result = await this.base.call(name, name === 'read_file' && input.limit === undefined ? { ...input, limit: 300 } : input);
      } catch (error) {
        if (error.code !== 'NOT_FOUND' || !input.path) throw error;
        let parent = this.base.safePath(input.path);
        while (parent && ![...this.files.keys()].some(f => f.startsWith(parent + '/'))) parent = parent.includes('/') ? parent.slice(0, parent.lastIndexOf('/')) : '';
        const candidates = await this.base.call('list_files', { path: parent });
        throw fault('NOT_FOUND', `${error.message}. Verified nearest directory: ${parent || '/'}. Entries: ${JSON.stringify(candidates.paths.slice(0, 24))}`);
      }
      if (name === 'read_file') {
        const mentions = [...result.text.matchAll(/`(codex-rs\/[A-Za-z0-9_./-]+)`/g)].map(m => m[1].replace(/\/$/, ''));
        result.referencedPathChecks = [...new Set(mentions)].slice(0, 16).map(file => ({ path: file,
          exists: this.files.has(file) || [...this.files.keys()].some(f => f.startsWith(file + '/')) }));
      }
      if (name === 'search_code') {
        const seen = new Set(), excerpts = [];
        for (const match of result.matches) {
          const m = /^(.+?):(\d+):/.exec(match);
          if (!m || seen.has(m[1])) continue;
          seen.add(m[1]);
          try { excerpts.push(await this.base.read(m[1], Math.max(1, Number(m[2]) - 8), 55)); }
          catch (error) { excerpts.push({ path: m[1], error: error.code }); }
          if (excerpts.length === 3) break;
        }
        result = { ...result, excerpts, excerptScope: 'First match window from up to three files; not exhaustive. Read further if needed.' };
      }
      if (name === 'list_files') {
        const readme = (input.path ? input.path.replace(/\/$/, '') + '/' : '') + 'README.md';
        if (this.files.has(readme)) result.overview = await this.base.read(readme, 1, 90);
      }
      return result;
    } finally { this.observations.push({ name, input, start: started, end: Date.now() }); }
  }
}

export const evidenceDefinitions = () => sourceTools.map(t => {
  const result = structuredClone(t);
  if (t.name === 'read_file') {
    result.description += ' Default read is up to 300 lines; includes existence checks for referenced repository paths. Documentation paths may be stale.';
    result.input_schema.properties.start = { type: 'integer', minimum: 1 };
    result.input_schema.properties.limit = { type: 'integer', minimum: 1, maximum: 300 };
  }
  if (t.name === 'search_code') result.description += ' Also returns bounded source excerpts around the first match in up to three files; use these as evidence, request more only when insufficient.';
  if (t.name === 'list_files') result.description += ' Includes README overview when present; paths are checked against the pinned commit.';
  return result;
});

// Ranking uses only existing Map titles and the current query, not benchmark answers.
export async function prefetchEvidence(source, query, maxBytes = 32000) {
  const nodes = [], q = query.toLowerCase();
  const visit = n => {
    const english = (n.title.toLowerCase().match(/[a-z][a-z-]+/g) || []).filter(t => t.length > 2);
    const chinese = n.title.match(/[\u4e00-\u9fff]+/g) || [];
    const pairs = chinese.flatMap(s => [...s].slice(0, -1).map((c, i) => c + s[i + 1]));
    const terms = [...new Set([...english, ...pairs])].filter(t => q.includes(t));
    if (terms.length) nodes.push({ node: n, terms });
    n.children.forEach(visit);
  };
  visit(source.map.root);
  const frequency = new Map();
  for (const n of nodes) for (const term of n.terms) frequency.set(term, (frequency.get(term) || 0) + 1);
  for (const n of nodes) n.score = n.terms.reduce((s, t) => s + (/^[a-z]/.test(t) ? 3 : 1) / frequency.get(t), 0);
  nodes.sort((a, b) => b.score - a.score || a.node.children.length - b.node.children.length);
  const selected = nodes.slice(0, 2), files = [...new Set(selected.flatMap(n => n.node.files))].slice(0, 4);
  const packet = { commit: source.commit, selectedNodes: selected.map(n => n.node.id), evidence: [], directories: [], scope: 'Bounded navigation evidence; not an answer. Verify implementation beyond documentation when required.' };
  for (const file of files) {
    try {
      const result = await source.call('read_file', { path: file, limit: 220 });
      if (Buffer.byteLength(JSON.stringify({ ...packet, evidence: [...packet.evidence, result] })) > maxBytes) break;
      packet.evidence.push(result);
      const directory = path.posix.dirname(file);
      if (!packet.directories.some(d => d.path === directory)) {
        const listing = await source.base.call('list_files', { path: directory, recursive: true });
        const item = { path: directory, ...listing, paths: listing.paths.slice(0, 90) };
        if (Buffer.byteLength(JSON.stringify({ ...packet, directories: [...packet.directories, item] })) <= maxBytes) packet.directories.push(item);
      }
    } catch (error) { packet.evidence.push({ path: file, error: error.code }); }
  }
  return packet;
}

export async function boundedReadBatch(calls, execute, concurrency = 2) {
  const safe = new Set(['list_files', 'read_file', 'search_code', 'read_map', 'web_search']);
  const results = new Array(calls.length);
  let begin = 0;
  while (begin < calls.length) {
    if (!safe.has(calls[begin].name)) { results[begin] = await execute(calls[begin]); begin++; continue; }
    let end = begin;
    while (end < calls.length && safe.has(calls[end].name)) end++;
    let cursor = begin, failure;
    await Promise.all(Array.from({ length: Math.min(concurrency, end - begin) }, async () => {
      while (cursor < end && !failure) {
        const index = cursor++;
        try { results[index] = await execute(calls[index]); }
        catch (error) { failure ||= error; }
      }
    }));
    if (failure) throw failure;
    begin = end;
  }
  return results;
}

export class SearchCircuit {
  constructor(search, threshold = 2) { this.search = search; this.threshold = threshold; this.failures = 0; this.open = false; }
  async call(input, options) {
    if (this.open) throw fault('SEARCH_CIRCUIT_OPEN', 'Search provider is unavailable for this request; stop search retries and report missing evidence.');
    try { const result = await this.search.call(input, options); this.failures = 0; return result; }
    catch (error) {
      if (['SEARCH_PROVIDER_ERROR', 'SEARCH_AUTH', 'SEARCH_RATE_LIMIT', 'SEARCH_UNAVAILABLE'].includes(error.code)) {
        this.failures++;
        if (error.code === 'SEARCH_AUTH' || this.failures >= this.threshold) this.open = true;
      }
      throw error;
    }
  }
}

export async function groundedInventory(source, query) {
  const packet = await prefetchEvidence(source, query, 24000);
  const nodes = [];
  const visit = n => { if (packet.selectedNodes.includes(n.id) && n !== source.map.root) nodes.push(n); n.children.forEach(visit); };
  visit(source.map.root);
  const directories = [...new Set(nodes.flatMap(n => n.files.map(f => path.posix.dirname(f))))];
  const files = [...source.files.keys()].filter(f => directories.some(d => f.startsWith(d + '/')) && f.endsWith('.rs') && !/(^|\/)(tests?|benches)\//.test(f) && !/tests?\.rs$/.test(f)).slice(0, 32);
  const outlines = await boundedReadBatch(files.map(file => ({ name: 'read_file', file })), async c => {
    const read = await source.base.read(c.file, 1, 300);
    const numbered = read.text.split('\n'), lines = [];
    for (let i = 0; i < numbered.length; i++) {
      if (!/^\d+: (?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|trait|type|const)\s/.test(numbered[i])) continue;
      let start = i;
      while (start > 0 && i - start < 3 && /^\d+: \/\/\//.test(numbered[start - 1])) start--;
      lines.push(...numbered.slice(start, Math.min(numbered.length, i + 3)));
      if (lines.length >= 32) break;
    }
    return { path: c.file, url: read.url, commit: read.commit, excerpt: lines.join('\n'), scope: 'Only declarations/doc comments within first 300 lines; not exhaustive. Read implementation to verify complex behavior.' };
  }, 2);
  packet.codeInventory = [];
  for (const outline of outlines) {
    if (Buffer.byteLength(JSON.stringify({ ...packet, codeInventory: [...packet.codeInventory, outline] })) > 48000) break;
    packet.codeInventory.push(outline);
  }
  packet.scope = 'Pinned file inventory plus direct code declarations, not agent-authored memories. Do not infer file responsibilities from names or stale prior replies. Missing code evidence means uncertainty, not permission to guess.';
  return packet;
}
