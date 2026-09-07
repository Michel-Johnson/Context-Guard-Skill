import path from 'node:path';
import { atomicWrite, encode, hash, readJSON, withFileLock } from './io.mjs';
import { canonical, fail, validateMessage } from './protocol.mjs';

export const executionNotifications = new Set(['task.assign', 'task.rework', 'task.control']);
export async function executionPrompt(message, readObject) {
  validateMessage(message);
  const p = message.payload;
  if (message.type === 'task.assign') {
    const brief = await readObject(p.briefRef, p.briefVersion);
    if (brief.kind !== 'brief' || brief.version !== p.briefVersion || brief.content?.taskId !== p.taskId || typeof brief.content.text !== 'string' || brief.content.text.length > 2000) fail('CONFLICT', 'Approved brief reference differs');
    if (p.mode === 'session') {
      const report = (stage, data) => JSON.stringify({ v: 2, id: `${message.id}:${stage}`, type: 'task.report', session: message.session,
        payload: { taskId: p.taskId, stage, data: { deliveryId: message.id, ...data } } });
      return ['Context Guard：用户已在 Cloud 确认分配，请在当前 Session 执行以下任务。遵守仓库的代码、测试、提交规则；执行回报不代表代码已合入 Main。',
        `任务：${p.taskId}`, `节点：${p.nodeIds.join(', ')}`, `Main：${p.mainVersion}`, brief.content.text,
        `交付编号：${message.id}；同一编号不得重复执行。`,
        `开始前和完成后，通过已安装 Context Guard CLI 的 map exchange --root . --session ${message.session.id} --input - 分别提交以下 JSON。不要索取 token，不要改用其他 Session。`,
        report('started', {}), report('finished', { outcome: 'success', summary: '替换为实际执行结果' }),
        '只有实际完成才回报 success；失败或取消时分别回报 failed/cancelled，并写明原因。发送不确定时重试相同 JSON 和 id，不伪造完成。'].join('\n');
    }
    return ['Context Guard：已确认的任务，请先读代码并提交 Plan，收到审核通过后再执行。',
      `任务：${p.taskId}`, `节点：${p.nodeIds.join(', ')}`, `Main：${p.mainVersion}`, brief.content.text,
      `交付编号：${message.id}；同一编号不得重复执行。`].join('\n');
  }
  if (message.type === 'review.result' && p.kind === 'plan') {
    const receipt = await readObject(p.receiptId, p.receiptId);
    if (receipt.kind !== 'reviewReceipt' || receipt.content?.ref !== p.ref || receipt.content?.version !== p.version || receipt.content?.decision !== p.decision) fail('CONFLICT', 'Plan review receipt differs');
    return `Context Guard：Plan ${p.ref}@${p.version} 审核${p.decision === 'approved' ? '通过，可继续执行' : '未通过，请修改 Plan'}。\n${p.reason}\n回执：${p.receiptId}`;
  }
  if (message.type === 'task.rework') return `Context Guard：原任务 ${p.taskId} 返工，不创建新任务。\n代码：${p.sourceSha}\nCI：${p.ciResultRef}\n失败测试：${p.failedTestIds.join(', ')}\n交付编号：${message.id}`;
  if (message.type === 'task.control') return `Context Guard：任务 ${p.taskId} 控制请求 ${p.action}。完成对应操作后，使用原控制编号回报；收到不等于完成，不得擅自删除记录。\n${JSON.stringify(p.data)}\n控制编号：${message.id}`;
  return null;
}

// A host may accept a message just before the caller crashes. A durable intent
// prevents a second model invocation when acceptance cannot be established.
export class ProtocolDelivery {
  constructor(directory, adapters) { this.directory = directory; this.adapters = adapters; }
  async deliver(input) {
    const adapter = this.adapters[input.platform];
    if (typeof adapter !== 'function') fail('INVALID_ARGUMENT', 'This host does not support task delivery');
    if (!input.id || !input.sessionId || typeof input.message !== 'string' || !input.message.trim()) fail('INVALID_ARGUMENT', 'Delivery identity and message are required');
    const file = path.join(this.directory, `${hash(input.id)}.json`), fingerprint = hash(canonical(input));
    return withFileLock(`${file}.lock`, async () => {
      const previous = await readJSON(file, null);
      if (previous && previous.fingerprint !== fingerprint) fail('ID_REUSED', 'Delivery ID differs from the saved intent');
      if (previous?.state === 'received') return previous.result;
      if (previous?.state === 'dispatching' || previous?.state === 'uncertain') fail('UNAVAILABLE', 'Host acceptance is uncertain; do not dispatch again', { deliveryId: input.id, deliveryState: 'uncertain' });
      await atomicWrite(file, encode({ fingerprint, state: 'dispatching', attempts: (previous?.attempts || 0) + 1, input }));
      try {
        await adapter(input);
        const result = { deliveryId: input.id, state: 'received', sessionId: input.sessionId };
        await atomicWrite(file, encode({ fingerprint, state: 'received', input, result }));
        return result;
      } catch (error) {
        const uncertain = error?.deliveryUncertain === true || error?.killed === true || error?.code === 'ETIMEDOUT';
        await atomicWrite(file, encode({ fingerprint, state: uncertain ? 'uncertain' : 'failed', attempts: (previous?.attempts || 0) + 1, input, errorCode: String(error?.code || 'DELIVERY_FAILED').slice(0, 128) }));
        fail('UNAVAILABLE', uncertain ? 'Host acceptance is uncertain; do not dispatch again' : 'Host rejected delivery; it will be retried', { deliveryId: input.id, deliveryState: uncertain ? 'uncertain' : 'failed' });
      }
    });
  }
}
