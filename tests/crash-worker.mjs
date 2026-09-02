import fs from 'node:fs/promises';
import { MapStore } from '../scripts/workbench/store.mjs';
const [root, point, input] = process.argv.slice(2);
const store = await new MapStore(root, { fault: async p => { if (p === point) process.exit(71); } }).init();
await store.commit(JSON.parse(await fs.readFile(input, 'utf8')), { kind: 'human', sessionId: 'workbench' });
await store.close();
