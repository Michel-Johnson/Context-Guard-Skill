import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Product tests must never add synthetic fixtures to the user's persistent
// global project catalog. Child CLIs inherit this isolated directory.
if (!process.env.CONTEXT_GUARD_NAMED_STATE_DIR) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'context-guard-test-registry-'));
  process.env.CONTEXT_GUARD_NAMED_STATE_DIR = directory;
  process.on('exit', () => fs.rmSync(directory, { recursive: true, force: true }));
}
