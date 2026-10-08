import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { marked } from 'marked';
import { History } from './history.mjs';

const runtime = JSON.parse(await fs.readFile(new URL('./calibration-runtime.json', import.meta.url)));
assert.ok(runtime.dataDir.endsWith('web-search-calibration'));
const credentials = JSON.parse(await fs.readFile(new URL('../local-coordinator-data/local-config.json', import.meta.url)));
const api = async (route, body) => {
  const response = await fetch(runtime.baseUrl + '/experiment/' + route, {
    method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${credentials.browserToken}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000),
  });
  assert.ok(response.ok, 'local API returned ' + response.status); return response.json();
};
const task = process.argv[2] ? { id: process.argv[2] } : await api('tasks', { id: randomUUID() });
if (!process.argv[2]) await api('tasks/' + task.id + '/messages', { requestId: randomUUID(), text: '请使用 web search 联网搜索 OpenAI Codex 的官方文档。简短回答并附搜索返回的来源链接，不要读本地源码。' });
let state;
for (let i = 0; i < 150; i++) {
  state = await api('tasks/' + task.id);
  if (state.requests.length && !state.processing) break;
  await new Promise(resolve => setTimeout(resolve, 1000));
}
if (state.processing) await api('tasks/' + task.id + '/cancel', {});
assert.equal(state.processing, false, 'Coordinator timed out');
const events = (await fs.readFile(path.join(runtime.dataDir, 'calibration/events.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
const searches = events.filter(event => event.trial === task.id && event.name === 'web_search');
assert.ok(searches.some(event => !event.error), 'no successful search tool call');
const answer = state.messages.filter(message => message.role === 'assistant').map(message => message.text).join('\n');
const links = [];
marked.walkTokens(marked.lexer(answer), token => { if (token.type === 'link') links.push(token.href); });
assert.ok(links.some(url => url.startsWith('https://')), 'answer must render a clickable web source');
const db = JSON.parse(await fs.readFile(path.join(runtime.dataDir, 'calibration/experiment.json')));
const history = await new History(path.join(runtime.dataDir, 'calibration/sessions')).messages(db.trials[task.id].session);
const sourceUrls = new Set(history.flatMap(message => Array.isArray(message.content) ? message.content : []).filter(block => block.type === 'tool_result').flatMap(block => JSON.parse(block.content).results || []).map(result => result.url));
assert.ok(links.every(url => sourceUrls.has(url)), 'answer URLs must come from actual results');
console.log(JSON.stringify({ task: task.id, searches: searches.map(event => ({ durationMs: event.durationMs, error: event.error })), answer }));
