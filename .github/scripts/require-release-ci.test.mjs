import assert from 'node:assert/strict';
import test from 'node:test';
import { requireReleaseCI } from './require-release-ci.mjs';

const sha = 'a'.repeat(40);
const run = { id: 12, workflow_id: 5, repository: { full_name: 'owner/repo' }, head_sha: sha,
  event: 'push', head_branch: 'main', status: 'completed', conclusion: 'success', run_attempt: 2 };
const job = { name: 'Required', head_sha: sha, status: 'completed', conclusion: 'success' };
function options(runs = [run], jobs = [job]) {
  return { repository: 'owner/repo', sha, ref: 'v1.0.0', token: 'fixture', attempts: 2, sleep: async () => {},
    fetchImpl: async url => {
      assert.ok(url.startsWith('https://api.github.com/repos/owner/repo/'));
      if (url.endsWith('/ci.yml')) return Response.json({ id: 5, path: '.github/workflows/ci.yml' });
      if (url.includes('/jobs?')) {
        assert.ok(url.includes('/12/attempts/2/jobs?'));
        return Response.json({ jobs });
      }
      return Response.json({ workflow_runs: runs });
    } };
}
test('release gate accepts exact workflow, commit and successful Required attempt', async () => {
  assert.deepEqual(await requireReleaseCI(options()), { runId: 12, attempt: 2, sha });
});
for (const change of [
  { head_sha: 'b'.repeat(40) }, { workflow_id: 9 }, { repository: { full_name: 'fork/repo' } },
  { event: 'pull_request' }, { head_branch: 'feature' }
]) test(`release gate rejects unrelated run ${JSON.stringify(change)}`, async () => {
  await assert.rejects(requireReleaseCI(options([{ ...run, ...change }])), /Timed out/);
});
for (const conclusion of ['failure', 'cancelled', 'skipped', 'neutral', 'timed_out']) {
  test(`release gate blocks ${conclusion}, even with an older green run`, async () => {
    await assert.rejects(requireReleaseCI(options([{ ...run, id: 13, conclusion }, run])), /did not succeed/);
  });
}
test('release gate waits for the newest in-progress run instead of accepting an older success', async () => {
  await assert.rejects(requireReleaseCI(options([run, { ...run, id: 13, status: 'in_progress' }])), /Timed out/);
});
for (const jobs of [[], [job, job], [{ ...job, conclusion: 'skipped' }], [{ ...job, head_sha: 'b'.repeat(40) }]]) {
  test(`release gate rejects missing, duplicate or invalid Required ${JSON.stringify(jobs)}`, async () => {
    await assert.rejects(requireReleaseCI(options([run], jobs)));
  });
}
test('release gate retries pending CI and then accepts the completed run', async () => {
  const config = options();
  const fetchImpl = config.fetchImpl;
  let pending = true;
  config.fetchImpl = async url => pending && url.includes('/runs?')
    ? Response.json({ workflow_runs: [{ ...run, status: 'queued' }] }) : fetchImpl(url);
  config.sleep = async () => { pending = false; };
  await requireReleaseCI(config);
});
test('release gate fails closed on API authorization and malformed responses', async () => {
  for (const response of [new Response('', { status: 403 }), Response.json({})]) {
    await assert.rejects(requireReleaseCI({ ...options(), fetchImpl: async () => response }));
  }
});
test('release gate follows pagination before choosing the newest run', async () => {
  const config = options(); const original = config.fetchImpl;
  config.fetchImpl = async url => url.includes('/runs?')
    ? Response.json({ workflow_runs: url.includes('page=2') ? [run] : Array.from({ length: 100 }, () => ({ ...run, head_sha: 'b'.repeat(40) })) })
    : original(url);
  await requireReleaseCI(config);
});
