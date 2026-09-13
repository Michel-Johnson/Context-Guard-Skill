import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { MapError } from '../shared/map-model.mjs';

export function quarkShare(value) {
  const url = new URL(value?.share_url);
  if (url.origin !== 'https://pan.quark.cn' || !/^\/s\/[a-zA-Z0-9]+$/.test(url.pathname) || url.search || url.hash || url.username || url.password ||
      !/^[a-zA-Z0-9]{4,16}$/.test(value?.passcode || '')) throw new Error('Invalid protected Quark share');
  return { url: url.href, passcode: value.passcode };
}

// CLI/config are provisioned by the server administrator, never by an HTTP caller.
export async function createQuarkProvider({ cliPath, sha256, timeoutMs = 120000, backend = 'skill', cookieFile, workDir, spawnProcess = spawn, visibilityDelayMs = 2000 } = {}) {
  if (!['skill', 'kuake'].includes(backend)) throw new MapError('QUARK_CONFIG', 'Unsupported Quark backend', 503);
  if (!path.isAbsolute(cliPath || '') || !/^[a-f0-9]{64}$/.test(sha256 || '')) throw new MapError('QUARK_CONFIG', 'Configure an absolute pinned Quark CLI path and SHA-256', 503);
  const actual = createHash('sha256').update(await fs.readFile(cliPath)).digest('hex');
  if (actual !== sha256) throw new MapError('QUARK_CONFIG', 'Quark CLI checksum does not match the approved installation', 503);
  if (backend === 'kuake') {
    if (!path.isAbsolute(cookieFile || '') || !path.isAbsolute(workDir || '')) throw new MapError('QUARK_CONFIG', 'Configure private cookie and working directory paths', 503);
    await fs.mkdir(workDir, { recursive: true, mode: 0o700 });
  }
  const readCookie = async () => {
    try {
      const stat = await fs.lstat(cookieFile);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32768 || (process.platform !== 'win32' && (stat.mode & 0o007))) throw new Error('Unsafe cookie file');
      const value = (await fs.readFile(cookieFile, 'utf8')).trim();
      if (!value || /[\r\n\0]/.test(value) || !/(?:^|;\s*)__pu(?:s|us)=/.test(value)) throw new Error('Invalid cookie');
      return value;
    } catch { throw new MapError('QUARK_CONFIG', 'Private Quark cookie is missing or unsafe', 503); }
  };
  if (backend === 'kuake') await readCookie();
  const run = async (action, args) => {
    const cookie = backend === 'kuake' ? await readCookie() : null;
    return new Promise((resolve, reject) => {
    const systemVariables = new Set(['PATH', 'SYSTEMROOT', 'WINDIR', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'TZ']);
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => systemVariables.has(key.toUpperCase())));
    // Preserve real host markers, never fabricate an Agent identity or forward
    // its session ID. The vendor CLI rejects unsupported host environments.
    if (backend === 'skill') {
      for (const key of ['CODEX_ENV', 'CODEX_SHELL', 'CODEX_CI']) if (process.env[key] === '1') env[key] = '1';
    } else {
      env.KUAKE_COOKIE = cookie;
      env.KUAKE_LOAD_DOTENV = '0';
      env.HOME = workDir;
    }
    const child = spawnProcess(backend === 'kuake' ? cliPath : process.execPath, backend === 'kuake' ? [action, ...args] : [cliPath, action, ...args], {
      cwd: backend === 'kuake' ? workDir : path.dirname(cliPath), env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '', size = 0, failed = false;
    const stop = () => { failed = true; child.kill('SIGKILL'); };
    const timer = setTimeout(stop, timeoutMs);
    child.stdout.on('data', chunk => { size += chunk.length; if (size > 1024 * 1024) stop(); else output += chunk.toString(); });
    child.stderr.on('data', chunk => { size += chunk.length; if (size > 1024 * 1024) stop(); });
    child.on('error', () => { clearTimeout(timer); reject(new MapError('QUARK_UNAVAILABLE', 'Quark CLI could not start', 503)); });
    child.on('close', code => {
      clearTimeout(timer);
      // Never forward provider stdout/stderr: it can contain account information.
      if (failed) return reject(new MapError('QUARK_FAILED', 'Quark operation failed or timed out; check server authorization', 502));
      try {
        if (backend === 'kuake') {
          const result = JSON.parse(output);
          if (action === 'info' && result.code === 'FILE_NOT_FOUND') return reject(new MapError('QUARK_NOT_VISIBLE', 'Uploaded file is not visible yet', 502));
          if (code !== 0 || result.success !== true || result.code !== 'OK') throw new Error('No successful result');
          return resolve(result.data);
        }
        if (code !== 0) throw new Error('CLI failed');
        const records = output.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
        const result = records.filter(row => row.action === action && row.type === 'result').at(-1);
        if (result?.code !== 0) throw new Error('No successful result');
        resolve(result.data);
      } catch { reject(new MapError('QUARK_FAILED', 'Quark returned no valid success receipt', 502)); }
    });
    });
  };
  const info = async remotePath => {
    for (let attempt = 0; ; attempt++) {
      try { return await run('info', [remotePath]); }
      catch (error) {
        if (error.code !== 'QUARK_NOT_VISIBLE' || attempt === 3) throw error;
        await new Promise(resolve => setTimeout(resolve, visibilityDelayMs));
      }
    }
  };
  return {
    async upload(file) {
      if (backend === 'kuake') {
        const remotePath = `/cloud-${randomUUID()}${path.extname(file).replace(/[^a-zA-Z0-9.]/g, '').slice(0, 16)}`;
        await run('upload', [file, remotePath]);
        const receipt = await info(remotePath);
        if (!/^[a-zA-Z0-9_-]{1,128}$/.test(receipt?.fid || '')) throw new MapError('QUARK_FAILED', 'Invalid Quark file receipt', 502);
        return { fileId: receipt.fid, remotePath };
      }
      const result = await run('upload', [file]);
      if (result.successCount !== 1 || result.fids?.length !== 1 || !/^[a-zA-Z0-9_-]{1,128}$/.test(result.fids[0])) throw new Error('Invalid Quark upload receipt');
      return result.fids[0];
    },
    async share(fid, remotePath) {
      if (backend === 'kuake') {
        if (!/^\/cloud-[a-f0-9-]{36}(?:\.[a-zA-Z0-9.]{0,15})?$/.test(remotePath || '')) throw new MapError('QUARK_FAILED', 'Invalid Quark remote path', 502);
        if ((await info(remotePath))?.fid !== fid) throw new MapError('QUARK_FAILED', 'Quark file identity changed', 502);
        return quarkShare(await run('share', [remotePath, '0', 'true']));
      }
      return quarkShare(await run('share', [fid, '--url-type', '2', '--expired-type', '1']));
    },
  };
}
