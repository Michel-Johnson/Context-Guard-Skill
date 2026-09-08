import { fail } from '../shared/protocol.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function keychainToken() {
  try {
    const { stdout } = await execFileAsync('gh', ['auth', 'token'], {
      encoding: 'utf8', windowsHide: true, timeout: 5000, maxBuffer: 64 * 1024,
    });
    const token = stdout.trim();
    return token && token.length <= 4096 ? token : '';
  } catch { return ''; }
}

// GitHub's repository ID survives a repository/branch rename. Branch heads are
// commits, not repository identities: https://docs.github.com/en/rest/repos/repos
export async function lookupRepository(slug, {
  fetcher = fetch,
  token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN,
  tokenProvider = keychainToken,
} = {}) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(slug) || slug.split('/').some(part => ['.', '..'].includes(part))) fail('INVALID_ARGUMENT', 'Invalid GitHub repository');
  let url = new URL(`https://api.github.com/repos/${slug}`);
  let authorization = token || '', keychainChecked = !!authorization;
  for (let attempt = 0; attempt < 4; attempt++) {
    let response;
    try { response = await fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(10000),
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Context-Guard', ...(authorization ? { Authorization: `Bearer ${authorization}` } : {}) } }); }
    catch { fail('UNAVAILABLE', 'GitHub repository identity could not be verified'); }
    if ([301, 302, 307, 308].includes(response.status)) {
      const location = response.headers.get('location'); await response.body?.cancel();
      if (!location) fail('UNAVAILABLE', 'GitHub redirect is missing');
      const next = new URL(location, url);
      if (next.origin !== 'https://api.github.com' || next.username || next.password || !/^\/(repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+|repositories\/\d+)$/.test(next.pathname)) fail('FORBIDDEN', 'GitHub redirected outside the repository API');
      url = next; continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (!authorization && !keychainChecked && [401, 403, 404].includes(response.status)) {
        keychainChecked = true;
        authorization = await tokenProvider();
        if (authorization) { attempt -= 1; continue; }
      }
      fail(response.status === 404 ? 'NOT_FOUND' : [401, 403].includes(response.status) ? 'FORBIDDEN' : 'UNAVAILABLE', 'GitHub repository is unavailable to this backend');
    }
    let value;
    try {
      const chunks = []; let size = 0;
      for await (const chunk of response.body) { size += chunk.length; if (size > 1024 * 1024) fail('TOO_LARGE', 'GitHub response exceeds limit'); chunks.push(chunk); }
      value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch { fail('UNAVAILABLE', 'GitHub returned an invalid repository identity'); }
    if (!Number.isSafeInteger(value.id) || value.id <= 0 || typeof value.full_name !== 'string') fail('UNAVAILABLE', 'GitHub returned an invalid repository identity');
    return { repositoryId: String(value.id), slug: value.full_name };
  }
  fail('UNAVAILABLE', 'Too many GitHub repository redirects');
}
