import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { MapError } from '../../prototype/map-model.mjs';
const exec = promisify(execFile);

// Repository path/remote/branch are administrator configuration, never request
// supplied paths or URLs. Fetch failure cannot certify a stale cached main.
export async function verifyMainCommit(repository, commit, { remote = 'origin', branch = 'main' } = {}) {
  if (!repository || !/^[a-f0-9]{40}$/.test(commit || '') || !/^[\w.-]+$/.test(remote) || !/^[\w/.-]+$/.test(branch)) throw new MapError('MAIN_VERIFICATION_REQUIRED', 'Configure a repository and supply a full merged commit SHA', 409);
  const git = args => exec('git', ['-C', repository, ...args], { timeout: 30000, maxBuffer: 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  try {
    await git(['fetch', '--no-tags', remote, branch]);
    const head = (await git(['rev-parse', 'FETCH_HEAD'])).stdout.trim();
    await git(['merge-base', '--is-ancestor', commit, head]);
    return { branch, commit, mainHead: head, verifiedAt: new Date().toISOString() };
  } catch { throw new MapError('MAIN_NOT_VERIFIED', 'Could not verify this commit against freshly fetched main; no Map published', 409); }
}
