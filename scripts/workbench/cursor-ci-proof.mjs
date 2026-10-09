import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { CursorCiDockerRunner } from './cursor-ci-runner.mjs';
import { cursorCiSourcePath } from './cursor-ci-source.mjs';
import { atomicWrite, encode, hash, withFileLock } from '../shared/io.mjs';
import { canonical, validateMessage } from '../shared/protocol.mjs';
import { scopedObjectKey } from '../shared/protocol-workflow.mjs';

const fail = code => { throw Object.assign(new Error('Host-observed CI proof is unavailable'), { code }); };
const digestOf = ({ digest, ...record }) => hash(canonical(record));

// Invoke in the original ProtocolStore.handle authorize callback, on the same
// locked state snapshot as ci.result. A pre-submit network read is not enough.
// Expectations come from the owning publisher's private callback, never JSON
// from the public model endpoint. This does not replace original role gates.
export function assertCursorCiHostEvidence(state, principal, message, expectations) {
  if (principal?.role !== 'ci' || message.type !== 'ci.result' || !Array.isArray(expectations) ||
      expectations.length !== message.payload.checks.length || expectations.length > 20 ||
      new Set(expectations.map(entry => entry.ref)).size !== expectations.length) fail('CI_EVIDENCE_CHANGED');
  for (const expected of expectations) {
    if (!message.payload.checks.some(check => check.evidenceRef === expected.ref) ||
        !expected.ref?.startsWith(`ci:${principal.agentId}:host:`) || typeof expected.version !== 'string' || !expected.version ||
        !/^[a-f0-9]{64}$/.test(expected.contentHash || '')) fail('CI_EVIDENCE_CHANGED');
    const record = state.objects[scopedObjectKey(principal, message.session, expected.ref)];
    const saved = record?.versions[expected.version];
    if (record?.latest !== expected.version || saved?.kind !== 'evidence' ||
        saved.content.taskId !== message.payload.taskId || saved.content.sourceSha !== message.payload.sourceSha ||
        hash(canonical(saved.content)) !== expected.contentHash) fail('CI_EVIDENCE_CHANGED');
  }
}

// This is a narrow Node TAP policy, not an arbitrary output-to-verdict parser.
// Only the host-fixed Node entrypoint/reporter and approved test paths may use it.
export function cursorCiNodeTapPassed(observation) {
  if (observation?.exitCode !== 0 || typeof observation.stdout !== 'string' || observation.stderr !== '') return false;
  const lines = observation.stdout.trimEnd().split(/\r?\n/);
  if (lines.shift() !== 'TAP version 13') return false;
  const summary = {}, top = []; let plan;
  for (const line of lines) {
    if (/^\s*(?:not ok \d+|Bail out!)|^\s*(?:ok \d+.*|1\.\.\d+)\s+#\s*(?:SKIP|TODO)\b/i.test(line)) return false;
    const count = /^# (tests|suites|pass|fail|cancelled|skipped|todo) (\d+)$/.exec(line);
    if (count) {
      if (Object.hasOwn(summary, count[1])) return false;
      summary[count[1]] = Number(count[2]); continue;
    }
    const end = /^1\.\.(\d+)$/.exec(line);
    if (end) { if (plan !== undefined) return false; plan = Number(end[1]); continue; }
    const ok = /^ok (\d+) - .+$/.exec(line);
    if (ok) { if (plan !== undefined) return false; top.push(Number(ok[1])); continue; }
    if (/^\s*#/.test(line) || /^(?: {2})+(?:ok \d+ - .+|1\.\.\d+|---|\.\.\.|[a-zA-Z_]+:.*)$/.test(line) || !line) continue;
    return false;
  }
  return Number.isSafeInteger(summary.tests) && summary.tests > 0 && summary.pass === summary.tests &&
    ['fail', 'cancelled', 'skipped', 'todo'].every(name => summary[name] === 0) &&
    Number.isSafeInteger(summary.suites) && summary.suites >= 0 && Number.isSafeInteger(plan) && plan > 0 &&
    top.length === plan && top.every((number, index) => number === index + 1);
}

// Construct only inside the owning host/worker. No MCP argument supplies a
// runner, Plan, observation, ledger path or commit callback. The callback must
// use the original authenticated Core channel, not the model exchange channel.
export function createCursorCiHostProof({ runner, approvedPlan, ciTodo, commit } = {}) {
  if (!(runner instanceof CursorCiDockerRunner) || typeof commit !== 'function' ||
      !approvedPlan?.ref || !approvedPlan.version || !approvedPlan.approvalReceiptId ||
      !/^[a-f0-9]{40}$/.test(approvedPlan.sourceSha || '') || !Array.isArray(approvedPlan.paths) ||
      !approvedPlan.paths.length || approvedPlan.paths.length > 128 || !approvedPlan.paths.every(cursorCiSourcePath) ||
      new Set(approvedPlan.paths).size !== approvedPlan.paths.length ||
      Object.keys(runner.source.manifest.files).some(file => !approvedPlan.paths.some(scope => file === scope || file.startsWith(scope + '/'))) ||
      approvedPlan.paths.some(scope => !Object.keys(runner.source.manifest.files).some(file => file === scope || file.startsWith(scope + '/'))) ||
      ciTodo?.ref !== runner.context.ciTodoRef || ciTodo?.kind !== 'ciTodo' || ciTodo?.version !== runner.context.references[ciTodo.ref] ||
      !Array.isArray(ciTodo.content?.items) || !ciTodo.content.items.length ||
      ciTodo.content.items.some(item => typeof item?.id !== 'string' || !item.id || item.id.length > 128) ||
      new Set(ciTodo.content.items.map(item => item.id)).size !== ciTodo.content.items.length ||
      ciTodo.content.items.some(item => !runner.policy.tests.some(test => test.todoId === item.id)) ||
      runner.policy.tests.some(test => test.argv[0] !== '--test' || test.argv[1] !== '--test-reporter=tap' || test.argv.length < 3 ||
        test.argv.slice(2).some(file => !file.startsWith('/source/') || !Object.hasOwn(runner.source.manifest.files, file.slice(8))))) fail('CI_PROOF_CONFIG_INVALID');
  const scope = runner.scope, plan = { ref: approvedPlan.ref, version: approvedPlan.version,
    approvalReceiptId: approvedPlan.approvalReceiptId, sourceSha: approvedPlan.sourceSha, paths: [...approvedPlan.paths] };
  const tester = runner.context.tester.sessionId;
  const fingerprint = hash(canonical({ scope, plan, policyHash: runner.policyHash, manifestSha256: runner.source.manifestSha256 }));
  const file = path.join(runner.directory, 'host-proof.json');
  const save = record => atomicWrite(file, encode(record));
  async function read() {
    let handle;
    try {
      handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      const info = await handle.stat();
      if (!info.isFile() || info.nlink !== 1 || info.size > 32 * 1024 * 1024 || process.platform !== 'win32' && info.mode & 0o077) fail('CI_PROOF_RECORD_INVALID');
      const record = JSON.parse(await handle.readFile('utf8'));
      if (record?.format !== 1 || record.fingerprint !== fingerprint || !record.tests || typeof record.tests !== 'object' ||
          Array.isArray(record.tests) || Object.keys(record.tests).length > 20 || record.digest !== digestOf(record)) fail('CI_PROOF_RECORD_INVALID');
      return record;
    } catch (cause) {
      if (cause.code === 'ENOENT') return { format: 1, fingerprint, tests: {} };
      throw cause;
    } finally { await handle?.close(); }
  }
  const persist = record => { record.digest = digestOf(record); return save(record); };
  const locked = action => withFileLock(file + '.lock', action);
  const runTest = (input, options) => locked(async () => {
    await runner.check();
    const record = await read(), key = hash(input?.id || '');
    if (record.result) fail('CI_RESULT_ALREADY_PENDING');
    const existing = record.tests[key];
    if (existing && canonical(existing.input) !== canonical(input)) fail('ID_REUSED');
    const observation = await runner.run(input, options);
    // The observation comes only from this actual runner invocation/replay.
    if (existing && canonical(existing.observation) !== canonical(observation)) fail('CI_TEST_PROOF_INVALID');
    const test = runner.policy.tests.find(test => test.id === input.testId);
    const status = cursorCiNodeTapPassed(observation) ? 'passed' : observation.exitCode !== 0 ? 'failed' : 'incomplete';
    const identity = hash(canonical({ fingerprint, input }));
    const ref = `ci:${tester}:host:${identity}`;
    const message = { v: 2, id: `host-evidence-${identity}`, type: 'object.put', session: runner.context.session,
      payload: { ref, baseVersion: '', kind: 'evidence', content: { format: 1, taskId: runner.context.taskId,
        sourceSha: runner.context.sourceSha, approvedPlan: plan, testId: test.id, todoId: test.todoId,
        argv: test.argv, status, observation } } };
    const entry = existing || { input: structuredClone(input), observation, message, status };
    if (canonical(entry.message) !== canonical(message) || entry.status !== status) fail('CI_TEST_PROOF_INVALID');
    validateMessage(message);
    record.tests[key] = entry; await persist(record); // Intent before any original Core write.
    if (!entry.receipt) {
      await runner.check();
      const receipt = await commit(structuredClone(message));
      if (receipt?.ref !== ref || typeof receipt.version !== 'string' || !receipt.version) fail('CI_RECEIPT_INVALID');
      await runner.check(); entry.receipt = structuredClone(receipt); await persist(record);
    }
    await runner.check();
    return { testId: test.id, todoId: test.todoId, status, evidenceRef: ref, evidenceVersion: entry.receipt.version,
      ...(status === 'failed' ? { reproductionRef: ref } : {}) };
  });
  async function verify(message, record) {
    validateMessage(message);
    if (message.type !== 'ci.result' || canonical(message.session) !== canonical(runner.context.session) ||
        message.payload.taskId !== runner.context.taskId || message.payload.sourceSha !== runner.context.sourceSha) fail('CI_TEST_PROOF_INVALID');
    if (record.result) {
      if (record.result.message.id !== message.id) fail('CI_RESULT_ALREADY_PENDING');
      if (canonical(record.result.message) !== canonical(message)) fail('ID_REUSED');
      return;
    }
    const { checks, verdict } = message.payload;
    if (new Set(checks.map(check => check.testId)).size !== checks.length) fail('CI_TEST_PROOF_INVALID');
    for (const check of checks) {
      const entry = Object.values(record.tests).find(entry => entry.receipt?.ref === check.evidenceRef);
      const test = runner.policy.tests.find(test => test.id === check.testId);
      if (!entry || !test || test.todoId !== check.todoId || entry.input.testId !== check.testId || entry.status !== check.status ||
          check.status === 'failed' && check.reproductionRef !== check.evidenceRef ||
          check.status !== 'failed' && check.reproductionRef !== undefined) fail('CI_TEST_PROOF_INVALID');
    }
    const expected = checks.some(check => check.status === 'failed') ? 'failed' : checks.some(check => check.status === 'incomplete') ? 'incomplete' : 'passed';
    if (verdict !== expected || verdict === 'passed' && runner.policy.tests.some(test => !checks.some(check => check.testId === test.id))) fail('CI_TEST_PROOF_INVALID');
  }
  const verifyResult = message => {
    validateMessage(message); const fixed = structuredClone(message);
    return locked(async () => { await runner.check({ ciResult: true }); await verify(fixed, await read()); });
  };
  const submitVerifiedResult = input => {
    validateMessage(input); const message = structuredClone(input);
    return locked(async () => {
    await runner.check({ ciResult: true });
    const record = await read(); await verify(message, record);
    if (!record.result) {
      const expectations = message.payload.checks.map(check => {
        const entry = Object.values(record.tests).find(entry => entry.receipt?.ref === check.evidenceRef);
        return { ref: entry.receipt.ref, version: entry.receipt.version, contentHash: hash(canonical(entry.message.payload.content)) };
      });
      record.result = { message: structuredClone(message), expectations };
    }
    await persist(record); // Preserve exact proposal before send, including unknown ACK.
    if (!record.result.receipt) {
      await runner.check({ ciResult: true });
      record.result.receipt = await commit(structuredClone(record.result.message),
        { expectedEvidence: structuredClone(record.result.expectations) });
      if (record.result.receipt?.taskId !== runner.context.taskId || record.result.receipt.verdict !== message.payload.verdict ||
          record.result.receipt.stage !== (message.payload.verdict === 'passed' ? 'awaiting-merge' : 'ci-failed') ||
          typeof record.result.receipt.ref !== 'string' || !record.result.receipt.ref ||
          typeof record.result.receipt.version !== 'string' || !record.result.receipt.version) fail('CI_RECEIPT_INVALID');
      await persist(record); // Store terminal Core receipt before the caller clears its job.
    }
    return structuredClone(record.result.receipt); // No old testing read after terminal ACK.
    });
  };
  return { runTest, verifyResult, submitVerifiedResult };
}
