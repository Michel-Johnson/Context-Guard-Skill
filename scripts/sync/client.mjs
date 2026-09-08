#!/usr/bin/env node
// Compatibility entry only; normal workbench code does not load the legacy client.
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { main } from '../legacy/map-sync.mjs';
export * from '../legacy/map-sync.mjs';
const entry = value => process.platform === 'win32' ? value.toLowerCase() : value;
if (process.argv[1] && entry(await fs.realpath(process.argv[1]).catch(() => '')) === entry(await fs.realpath(fileURLToPath(import.meta.url)))) {
  try { const result = await main(process.argv.slice(2)); if(result !== undefined) process.stdout.write(JSON.stringify(result)+'\n'); }
  catch(error) { process.stdout.write(JSON.stringify({error:{code:error.code||'ERROR',message:error.message,...(error.details||{})}})+'\n'); process.exitCode=1; }
}
