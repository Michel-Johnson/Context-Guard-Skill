import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Use the workflow API, not an arbitrary check with the same display name.
export async function requireReleaseCI({ repository, sha, ref, token, fetchImpl = fetch,
  attempts = 120, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  assert.match(repository || '', /^[\w.-]+\/[\w.-]+$/);
  assert.match(sha || '', /^[a-f0-9]{40}$/);
  assert.ok(ref && token, 'Release ref and read-only GitHub token are required');
  const deadline = Date.now() + 30 * 60 * 1000;
  async function get(route) {
    const remaining = deadline - Date.now();
    assert.ok(remaining > 0, 'Timed out waiting for same-commit CI; publication blocked');
    const response = await fetchImpl(`https://api.github.com/repos/${repository}/${route}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      redirect: 'error', signal: AbortSignal.timeout(Math.min(20_000, remaining))
    });
    assert.ok(response.ok, `CI API request failed (${response.status}); publication blocked`);
    return response.json();
  }
  async function list(route, key) {
    const values = [];
    for (let page = 1; page <= 10; page++) {
      const data = await get(`${route}${route.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      assert.ok(Array.isArray(data[key]), `Malformed CI ${key} response`);
      values.push(...data[key]);
      if (data[key].length < 100) return values;
    }
    throw new Error('CI pagination limit reached; publication blocked');
  }
  const workflow = await get('actions/workflows/ci.yml');
  assert.equal(workflow.path, '.github/workflows/ci.yml');
  assert.ok(Number.isSafeInteger(workflow.id));
  for (let attempt = 0; attempt < attempts; attempt++) {
    const runs = await list(`actions/workflows/${workflow.id}/runs?head_sha=${sha}&event=push`, 'workflow_runs');
    const candidates = runs.filter(run => run.head_sha === sha && run.event === 'push'
      && run.workflow_id === workflow.id && run.repository?.full_name === repository
      && ['main', ref].includes(run.head_branch));
    candidates.sort((a, b) => b.id - a.id);
    const run = candidates[0];
    if (run?.status === 'completed') {
      assert.equal(run.conclusion, 'success', `CI run ${run.id} did not succeed; publication blocked`);
      assert.ok(Number.isSafeInteger(run.id) && Number.isSafeInteger(run.run_attempt));
      const jobs = await list(`actions/runs/${run.id}/attempts/${run.run_attempt}/jobs`, 'jobs');
      const required = jobs.filter(job => job.name === 'Required');
      assert.equal(required.length, 1, 'Exactly one Required job must exist');
      assert.equal(required[0].head_sha, sha, 'Required belongs to another commit');
      assert.equal(required[0].status, 'completed');
      assert.equal(required[0].conclusion, 'success', 'Required must succeed, not skip');
      console.log(`Release CI verified: ${sha}, run ${run.id}, attempt ${run.run_attempt}, Required success`);
      return { runId: run.id, attempt: run.run_attempt, sha };
    }
    if (attempt + 1 < attempts) await sleep(Math.max(0, Math.min(15_000, deadline - Date.now())));
  }
  throw new Error('Timed out waiting for same-commit CI; publication blocked');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  requireReleaseCI({ repository: process.env.GITHUB_REPOSITORY, sha: process.env.RELEASE_SHA,
    ref: process.env.GITHUB_REF_NAME, token: process.env.GH_TOKEN })
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
