import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isolatedEnvironment } from './client-protocol.mjs';

// Fixtures must not inspect personal host history/configuration. Keep tool
// discovery and npm's invocation metadata, but redirect every host home.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'context-guard-test-home-'));
const homeEnvironment = isolatedEnvironment(sandbox);
// Fixtures already use unique temporary directories. Nesting TMP beneath a
// second sandbox pushes Python transaction filenames over Windows MAX_PATH.
for (const key of ['TMP', 'TEMP', 'TMPDIR']) delete homeEnvironment[key];
Object.assign(process.env, homeEnvironment);
// CLAUDE_CONFIG_DIR takes precedence over CLAUDE_HOME; individual installation
// fixtures select CLAUDE_HOME, while the fallback HOME is already isolated.
delete process.env.CLAUDE_CONFIG_DIR;
process.env.CODEX_THREAD_ID = '';
process.env.GIT_CONFIG_GLOBAL = path.join(sandbox, 'empty-gitconfig');
process.on('exit', () => fs.rmSync(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

// Synthetic repositories use GitHub-looking SSH remotes for identity checks,
// never for real network access or the developer's personal SSH credentials.
process.env.GIT_SSH_COMMAND = 'exit 1';
process.env.GIT_TERMINAL_PROMPT = '0';

// Product tests must never add synthetic fixtures to the user's persistent
// global project catalog. Child CLIs inherit this isolated directory.
if (!process.env.CONTEXT_GUARD_NAMED_STATE_DIR) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'context-guard-test-registry-'));
  process.env.CONTEXT_GUARD_NAMED_STATE_DIR = directory;
  process.on('exit', () => fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
}
