import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJSON, atomicWrite } from './history.mjs';
import { Source } from './source.mjs';
import { codexMap } from './map.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const pin = await readJSON(path.join(here, 'pin.json'));
const source = await new Source({ root: path.resolve(here, '../codex-learning-source'), commit: pin.commit, map: codexMap(pin.commit) }).init();
const lineCounts = new Map();
for (const id of process.argv.slice(2)) {
  if (!/^\d+$/.test(id)) throw new Error('Expected a study ID');
  const directory = path.join(here, 'latency-studies', id);
  const summary = await readJSON(path.join(directory, 'summary.json'));
  const rows = [];
  for (const run of summary.runs) {
    const invalidLinks = [];
    for (const kind of ['primary', 'followup']) {
      for (const match of run[`${kind}Answers`].join('\n').matchAll(/\/experiment\/source\?[^\s)]+/g)) {
        const url = new URL(match[0], 'http://localhost');
        const file = url.searchParams.get('path'), line = url.searchParams.get('line');
        let reason = source.files.has(file) ? null : 'Missing source file';
        if (!reason && line !== null) {
          if (!/^[1-9]\d*$/.test(line)) reason = 'Line must be one positive integer';
          else {
            if (!lineCounts.has(file)) lineCounts.set(file, (await source.read(file, 1, 1)).totalLines);
            if (Number(line) > lineCounts.get(file)) reason = 'Line exceeds source file';
          }
        }
        if (reason) invalidLinks.push({ kind, url: match[0], reason });
      }
    }
    rows.push({ run: run.run, arm: run.arm, case: run.case,
      primaryCompleted: run.primaryStatus === 'completed', followupCompleted: run.followupStatus === 'completed',
      commitCorrect: run.correctCommitInFollowup,
      executionIsolated: run.arm === 'serial' ? null : !run.workerSawFollowup,
      followupCalls: run.followupCalls, invalidLinks,
      semanticReviewRequired: true });
  }
  await atomicWrite(path.join(directory, 'mechanical-audit.json'), JSON.stringify({
    limitation: 'Checks completion, isolation, commit, source path and URL line syntax; does not prove factual accuracy, coverage, or that citations support claims.', rows }, null, 2));
  console.log(JSON.stringify({ id, rows }, null, 2));
}
