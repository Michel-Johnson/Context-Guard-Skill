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
      if (previous) fail('UNAVAILABLE', 'Host acceptance is uncertain; do not dispatch again', { deliveryId: input.id, deliveryState: 'uncertain' });
      await atomicWrite(file, encode({ fingerprint, state: 'dispatching', input }));
      try {
        await adapter(input);
        const result = { deliveryId: input.id, state: 'received', sessionId: input.sessionId };
        await atomicWrite(file, encode({ fingerprint, state: 'received', input, result }));
        return result;
      } catch {
        // Even a failed response may follow successful acceptance. Preserve the
        // intent without saving potentially sensitive adapter stdout/stderr.
        fail('UNAVAILABLE', 'Host acceptance is uncertain; do not dispatch again', { deliveryId: input.id, deliveryState: 'uncertain' });
      }
    });
  }
}
