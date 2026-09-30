import { fileURLToPath } from 'node:url';
import { run } from '../.github/scripts/client-protocol.mjs';

// Keep Chromium acceptance in the browser job, outside the default Node suite.
await run(process.execPath, ['--test', '--test-name-pattern=BDA-012', fileURLToPath(new URL('./browser-device-login.test.mjs', import.meta.url))], {
  env: { ...process.env, CONTEXT_GUARD_AUTH_BROWSER: '1' }, timeout: 90000, inheritOutput: true,
});
