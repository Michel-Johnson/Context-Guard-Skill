import { fail } from './protocol.mjs';

// GitHub's repository ID survives a repository/branch rename. Branch heads are
// commits, not repository identities: https://docs.github.com/en/rest/repos/repos
export async function lookupRepository(slug, { fetcher = fetch, token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN } = {}) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(slug) || slug.split('/').some(part => ['.', '..'].includes(part))) fail('INVALID_ARGUMENT', 'Invalid GitHub repository');
  let url = new URL(`https://api.github.com/repos/${slug}`);
  for (let attempt = 0; attempt < 4; attempt++) {
    let response;
    try { response = await fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(10000),
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Context-Guard', ...(token ? { Authorization: `Bearer ${token}` } : {}) } }); }
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
