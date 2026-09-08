import fs from 'node:fs/promises';
import path from 'node:path';
import { fail } from '../shared/protocol.mjs';

export const verifyTaskClose = (_identity, task, data) => !!task.completion?.proof?.mergeSha &&
  task.completion.proof.sourceSha === task.sourceSha && data.controlId === task.control?.id &&
  data.closeReceiptId === task.completion.closeReceiptId;

// Read-only GitHub verification. Repository, branch and check identities come
// from server configuration, never from model-provided URLs or success claims.
export async function verifyTaskCompletion({ project, repositoryId, memory, task, receipts, fetch: request = globalThis.fetch }) {
  const policy = project?.completion;
  if (!policy || task.stage !== 'accepted' || task.ci?.verdict !== 'passed' || task.acceptanceReview?.decision !== 'approved') return false;
  if (!/^[\w.-]+\/[\w.-]+$/.test(project.repository || '') || !/^refs\/heads\/.+/.test(project.ref || '') ||
      !Array.isArray(policy.requiredChecks) || !policy.requiredChecks.length ||
      policy.requiredChecks.some(check => !check.name || !Number.isSafeInteger(check.appId))) return false;
  const match = /^github-pr:([1-9]\d{0,9})$/.exec(receipts.gitReceiptRef || '');
  if (!match) return false;
  const closed = memory.closedSessions?.[task.session.id];
  const archive = (closed?.publications || (closed ? [closed] : [])).find(item =>
    item.sessionVersion === receipts.archiveReceiptRef && item.sourceCommit === task.sourceSha);
  if (!archive?.mainSha || !archive.mainVersion) return false;
  let token = '';
  if (policy.tokenFile) {
    if (!path.isAbsolute(policy.tokenFile)) return false;
    const info = await fs.stat(policy.tokenFile);
    if (!info.isFile() || info.mode & 0o077) fail('UNAVAILABLE', 'GitHub credential file must be private');
    token = (await fs.readFile(policy.tokenFile, 'utf8')).trim();
    if (!token) fail('UNAVAILABLE', 'GitHub verification credential is empty');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  const get = async route => {
    try {
      const response = await request(`https://api.github.com/repos/${project.repository}/${route}`, {
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
          ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        redirect: 'error', signal: controller.signal,
      });
      if (!response.ok) fail('UNAVAILABLE', `GitHub verification returned HTTP ${response.status}`);
      const reader = response.body.getReader(); const chunks = []; let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          size += value.byteLength;
          if (size > 2 * 1024 * 1024) { await reader.cancel(); fail('UNAVAILABLE', 'GitHub verification response exceeds limit'); }
          chunks.push(Buffer.from(value));
        }
      } finally { reader.releaseLock(); }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (error) {
      if (error.code === 'UNAVAILABLE') throw error;
      fail('UNAVAILABLE', controller.signal.aborted ? 'GitHub verification timed out' : 'GitHub verification failed');
    }
  };
  try {
    const pr = await get(`pulls/${match[1]}`);
    if (!pr.merged || !pr.merged_at || String(pr.base?.repo?.id) !== repositoryId || String(pr.head?.repo?.id) !== repositoryId ||
        pr.base.ref !== project.ref.slice('refs/heads/'.length) || pr.head.sha !== task.sourceSha || pr.merge_commit_sha !== archive.mainSha) return false;
    if (!(Date.parse(task.acceptanceAt) <= Date.parse(pr.merged_at) && Date.parse(pr.merged_at) <= Date.parse(archive.publishedAt))) return false;
    const checks = await get(`commits/${task.sourceSha}/check-runs?filter=latest&per_page=100`);
    // A truncated page cannot prove all latest results; do not silently pass it.
    if (!Array.isArray(checks.check_runs) || checks.total_count !== checks.check_runs.length || checks.total_count > 100) return false;
    if (!policy.requiredChecks.every(required => {
      const matching = checks.check_runs.filter(check => check.name === required.name && check.app?.id === required.appId);
      return matching.length > 0 && matching.every(check => check.head_sha === task.sourceSha && check.status === 'completed' && check.conclusion === 'success' &&
        Date.parse(check.completed_at) <= Date.parse(pr.merged_at));
    })) return false;
    return { repositoryId, sourceSha: task.sourceSha, mergeSha: pr.merge_commit_sha,
      pullRequest: Number(match[1]), archiveVersion: archive.sessionVersion, mainVersion: archive.mainVersion };
  } finally { clearTimeout(timer); }
}
