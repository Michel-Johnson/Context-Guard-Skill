import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { atomicWrite, encode, hash, withFileLock } from '../shared/io.mjs';
import { canonical, MAX_MESSAGE_BYTES, validateMessage } from '../shared/protocol.mjs';
import { DeviceConnection } from './protocol-device.mjs';
import { encodeCiHostEvidence, encodeCiTaskExpectation } from './protocol-client.mjs';

const only = (value, fields) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => fields.includes(key));
const fail = code => { throw Object.assign(new Error('The original host CI commit is unavailable'), { code }); };

// Durable header metadata for this existing task connection, not a credential,
// task queue or native proof. The owning publisher supplies its saved proof.
export async function createCursorCiHostCommit({ connection, context, taskExpectation, readBinding } = {}) {
  if (!(connection instanceof DeviceConnection) || !connection.revalidateOutcomes || typeof readBinding !== 'function' ||
      !path.isAbsolute(connection.directory || '') || path.resolve(connection.directory) !== connection.directory ||
      context?.mode !== 'ci' || typeof context.tester?.sessionId !== 'string' ||
      !Number.isSafeInteger(context.tester.workerPid) || context.tester.workerPid <= 0 ||
      context.taskId !== taskExpectation?.taskId || context.sourceSha !== taskExpectation.sourceSha ||
      context.ciTodoRef !== taskExpectation.ciTodoRef || context.references?.[context.ciTodoRef] !== taskExpectation.ciTodoVersion) fail('CI_HOST_COMMIT_CONFIG_INVALID');
  const fixedContext = structuredClone(context), tuple = structuredClone(taskExpectation);
  const taskHeader = encodeCiTaskExpectation(tuple), tester = fixedContext.tester.sessionId;
  const binding = canonical(await readBinding());
  const scopeHash = hash(canonical({ context: fixedContext, tuple, binding, origin: connection.origin }));
  const directory = path.join(connection.directory, 'host-results');
  const check = async () => { if (canonical(await readBinding()) !== binding) fail('CI_TASK_CHANGED'); };
  const fileFor = message => path.join(directory, hash(message.id) + '.json');
  const digest = ({ digest: ignored, ...record }) => hash(canonical(record));
  const validateResult = (message, expectations) => {
    if (message.type !== 'ci.result' || canonical(message.session) !== canonical(fixedContext.session) ||
        message.payload.taskId !== tuple.taskId || message.payload.sourceSha !== tuple.sourceSha) fail('CI_MESSAGE_FORBIDDEN');
    const header = encodeCiHostEvidence(expectations, message, tester);
    if (header.length + taskHeader.length > 12288) fail('CI_ARGUMENT_INVALID');
  };
  const checkDirectory = async () => {
    if (await fs.realpath(connection.directory) !== connection.directory || await fs.realpath(directory) !== directory ||
        !(await fs.lstat(directory)).isDirectory() || process.platform !== 'win32' && (await fs.stat(directory)).mode & 0o077) fail('CI_HOST_COMMIT_RECORD_INVALID');
  };
  const read = async message => {
    let handle;
    try {
      await check(); await checkDirectory();
      const original = await fs.lstat(fileFor(message));
      if (!original.isFile() || original.isSymbolicLink()) fail('CI_HOST_COMMIT_RECORD_INVALID');
      handle = await fs.open(fileFor(message), constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      const info = await handle.stat();
      if (!info.isFile() || info.ino !== original.ino || info.dev !== original.dev || info.nlink !== 1 || info.size > MAX_MESSAGE_BYTES ||
          process.platform !== 'win32' && info.mode & 0o077) fail('CI_HOST_COMMIT_RECORD_INVALID');
      const record = JSON.parse(await handle.readFile('utf8'));
      if (!only(record, ['format', 'scopeHash', 'messageHash', 'expectedEvidence', 'digest']) || Object.keys(record).length !== 5 ||
          record.format !== 1 || record.scopeHash !== scopeHash || record.digest !== digest(record)) fail('CI_HOST_COMMIT_RECORD_INVALID');
      if (record.messageHash !== hash(canonical(message))) fail('ID_REUSED');
      validateResult(message, record.expectedEvidence); await check();
      return record;
    } catch (cause) {
      if (['ENOENT', 'ID_REUSED', 'CI_TASK_CHANGED'].includes(cause.code)) throw cause;
      fail('CI_HOST_COMMIT_RECORD_INVALID');
    } finally { await handle?.close(); }
  };
  const originalTransport = connection.transport;
  connection.transport = async (origin, credential, message, options) => {
    if (message.type !== 'ci.result') return originalTransport(origin, credential, message, options);
    let record;
    try { record = await read(message); } catch (cause) { if (cause.code === 'ENOENT') fail('CI_HOST_COMMIT_RECORD_INVALID'); throw cause; }
    // Always load the same saved proof, including DeviceConnection cache replay.
    return originalTransport(origin, credential, message, { ...options, ciHostEvidence: structuredClone(record.expectedEvidence) });
  };
  return async (input, options = {}) => {
    if (!only(options, ['expectedEvidence'])) fail('CI_ARGUMENT_INVALID');
    const message = structuredClone(validateMessage(input)), expectations = structuredClone(options.expectedEvidence);
    await check();
    if (message.type === 'object.put') {
      if (expectations !== undefined || canonical(message.session) !== canonical(fixedContext.session) || message.payload.kind !== 'evidence' ||
          !message.payload.ref.startsWith(`ci:${tester}:host:`) || message.payload.content?.taskId !== tuple.taskId ||
          message.payload.content.sourceSha !== tuple.sourceSha) fail('CI_MESSAGE_FORBIDDEN');
    } else {
      validateResult(message, expectations);
      await fs.mkdir(directory, { recursive: true, mode: 0o700 }); await check(); await checkDirectory();
      // Release this record lock before send: transport rereads the record.
      await withFileLock(fileFor(message) + '.lock', async () => {
        let record;
        try { record = await read(message); } catch (cause) { if (cause.code !== 'ENOENT') throw cause; }
        if (record) {
          if (canonical(record.expectedEvidence) !== canonical(expectations)) fail('ID_REUSED');
          return;
        }
        for (const file of [path.join(connection.outbox, hash(message.id) + '.json'), path.join(connection.directory, 'outcomes', hash(message.id) + '.json')]) {
          const exists = await fs.lstat(file).then(() => true, cause => { if (cause.code === 'ENOENT') return false; throw cause; });
          if (exists) fail('CI_HOST_COMMIT_RECORD_INVALID'); // Never retrofit proof to an older durable wire/receipt.
        }
        await check();
        record = { format: 1, scopeHash, messageHash: hash(canonical(message)), expectedEvidence: expectations };
        record.digest = digest(record); await atomicWrite(fileFor(message), encode(record)); await check();
      });
    }
    await check(); return connection.send(message);
  };
}
