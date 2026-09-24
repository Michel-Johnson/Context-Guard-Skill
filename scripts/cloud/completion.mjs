import fs from 'node:fs/promises';
import path from 'node:path';
import { fail } from '../shared/protocol.mjs';

export const verifyTaskClose = (_identity, task, data) => {
  const proof = task.completion?.proof;
  if (!proof || data.controlId !== task.control?.id || data.closeReceiptId !== task.completion.closeReceiptId) return false;
  if (proof.verificationOnly) return proof.sourceSha === task.sourceSha && proof.ciRef === task.ci?.ref;
  return !!proof.mergeSha && proof.sourceSha === task.sourceSha;
};

export const taskSessionPublicationReady = (tasks, sourceCommit) => tasks.every(task =>
  ['closed', 'cancelled'].includes(task.stage) ||
  task.stage === 'accepted' && task.sourceSha === sourceCommit);

const completionBranch = project => {
  const ref = String(project?.ref || '');
  if (ref.startsWith('refs/heads/')) return ref.slice('refs/heads/'.length);
  const remote = /^refs\/remotes\/([^/]+)\/(.+)$/.exec(ref);
  return remote && (!project.remote || project.remote === remote[1]) ? remote[2] : '';
};

// Read-only GitHub verification. Repository, branch and check identities come
// from server configuration, never from model-provided URLs or success claims.
export async function verifyTaskCompletion({ project, repositoryId, memory, task, receipts, fetch: request = globalThis.fetch }) {
  const policy = project?.completion;
  if (task.stage !== 'accepted' || task.ci?.verdict !== 'passed' || task.acceptanceReview?.decision !== 'approved') return false;
  if (task.verificationOnly && receipts.gitReceiptRef === 'verification-only' && receipts.archiveReceiptRef === task.ci.ref) {
    return { verificationOnly: true, sourceSha: task.sourceSha, ciRef: task.ci.ref };
  }
  if (!policy) return false;
  const branch = completionBranch(project);
  const billingWaiver = policy.checksWaiver?.reason === 'github-actions-billing' &&
    Number.isFinite(Date.parse(policy.checksWaiver.expiresAt)) && Date.now() < Date.parse(policy.checksWaiver.expiresAt) &&
    Array.isArray(policy.requiredChecks) && policy.requiredChecks.length === 0;
  if (!/^[\w.-]+\/[\w.-]+$/.test(project.repository || '') || !branch ||
      !Array.isArray(policy.requiredChecks) || (!policy.requiredChecks.length && !billingWaiver) ||
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
        pr.base.ref !== branch || pr.head.sha !== task.sourceSha) return false;
    if (pr.merge_commit_sha !== archive.mainSha) {
      const comparison = await get(`compare/${pr.merge_commit_sha}...${archive.mainSha}`);
      if (!['ahead', 'identical'].includes(comparison.status) ||
          comparison.base_commit?.sha !== pr.merge_commit_sha || comparison.merge_base_commit?.sha !== pr.merge_commit_sha) return false;
    }
    if (!(Date.parse(task.acceptanceAt) <= Date.parse(pr.merged_at) && Date.parse(pr.merged_at) <= Date.parse(archive.publishedAt))) return false;
    const checks = await get(`commits/${task.sourceSha}/check-runs?filter=latest&per_page=100`);
    // A truncated page cannot prove all latest results; do not silently pass it.
    if (!Array.isArray(checks.check_runs) || checks.total_count !== checks.check_runs.length || checks.total_count > 100) return false;
    if (billingWaiver) {
      const contexts = await get(`commits/${task.sourceSha}/status`);
      if (!Array.isArray(contexts.statuses) || contexts.statuses.length > 100 ||
          contexts.statuses.some(item => item.state !== 'success')) return false;
      if (!checks.check_runs.length || !checks.check_runs.every(check => check.head_sha === task.sourceSha &&
        check.status === 'completed' && ['success', 'skipped', 'failure'].includes(check.conclusion) &&
        Date.parse(check.completed_at) <= Date.parse(pr.merged_at))) return false;
      for (const check of checks.check_runs.filter(item => item.conclusion === 'failure')) {
        if (!Number.isSafeInteger(check.id)) return false;
        const annotations = await get(`check-runs/${check.id}/annotations?per_page=100`);
        if (!Array.isArray(annotations) || !annotations.some(item =>
          typeof item.message === 'string' && item.message.includes('The job was not started because recent account payments have failed or your spending limit needs to be increased.'))) return false;
      }
    }
    if (!policy.requiredChecks.every(required => {
      const matching = checks.check_runs.filter(check => check.name === required.name && check.app?.id === required.appId);
      return matching.length > 0 && matching.every(check => check.head_sha === task.sourceSha && check.status === 'completed' && check.conclusion === 'success' &&
        Date.parse(check.completed_at) <= Date.parse(pr.merged_at));
    })) return false;
    return { repositoryId, sourceSha: task.sourceSha, mergeSha: pr.merge_commit_sha,
      ...(billingWaiver ? { githubChecksWaiver: { reason: policy.checksWaiver.reason, expiresAt: policy.checksWaiver.expiresAt } } : {}),
      pullRequest: Number(match[1]), archiveVersion: archive.sessionVersion, mainVersion: archive.mainVersion };
  } finally { clearTimeout(timer); }
}
