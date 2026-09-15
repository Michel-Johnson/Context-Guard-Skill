import fs from 'node:fs';
import path from 'node:path';

import { buildFilesystemV2 } from '../shared/filesystem-v2.mjs';
import { migrateProjectMemoryToFilesystemV2 } from './memory-filesystem.mjs';

function usage() {
  throw new Error('Usage: node scripts/cloud/migrate-memory-filesystem.mjs <snapshot-dir|server-response.json> <output-dir> | --activate <data-dir> <project-id>');
}

const sourceArg = process.argv[2];
const outputArg = process.argv[3];
if (!sourceArg || !outputArg) usage();

if (sourceArg === '--activate') {
  const projectId = process.argv[4];
  if (!projectId) usage();
  const result = await migrateProjectMemoryToFilesystemV2(path.resolve(outputArg), projectId);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(0);
}

const source = path.resolve(sourceArg);
const output = path.resolve(outputArg);
if (source === output || fs.existsSync(output)) {
  throw new Error(`Output directory must not already exist: ${output}`);
}

const responseFile = fs.statSync(source).isDirectory() ? path.join(source, 'server-response.json') : source;
const response = JSON.parse(fs.readFileSync(responseFile, 'utf8'));
const snapshot = response.snapshot || response;
const { files, report } = buildFilesystemV2(snapshot);

for (const [name, content] of files) {
  const target = path.join(output, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
