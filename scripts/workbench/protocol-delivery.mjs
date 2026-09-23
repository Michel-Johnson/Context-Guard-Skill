import path from 'node:path';
import fs from 'node:fs/promises';
import { atomicWrite, encode, hash, readJSON, withFileLock } from '../shared/io.mjs';
import { canonical, fail, validateMessage } from '../shared/protocol.mjs';

export const executionNotifications = new Set(['task.assign', 'task.rework', 'task.control', 'ci.request']);
const reviewedRetry = 'reviewed 任务不使用 map task start/finish。回复未知时保留原 operationId；收到明确 CONFLICT 后先核对状态，条件已恢复时用新的 operationId 提交 Plan，旧编号会重放旧拒绝。不得因报错跳过审核或报告完成。';
export async function executionPrompt(message, readObject) {
  validateMessage(message);
  const p = message.payload;
  if (message.type === 'ci.request') return ['Context Guard：执行独立 CI，只测试指定提交，不修改业务源码、不提交开发 Plan。',
    `任务：${p.taskId}`, `准确 SHA：${p.sourceSha}`, `CI TODO：${p.ciTodoRef}`, `开发证据：${p.unitTestRefs.join(', ')}`,
    '用 map ci context 读取当前授权，用 map ci exchange --input -（stdin，优先）或当前 Session 工作树内文件读取引用、上传证据并提交 ci.result；不要使用共享 /tmp 文件。',
    '如实报告失败和复现证据；没有执行的测试不得标为通过。'].join('\n');
  if (message.type === 'task.assign') {
    const brief = await readObject(p.briefRef, p.briefVersion);
    if (brief.kind !== 'brief' || brief.version !== p.briefVersion || brief.content?.taskId !== p.taskId || typeof brief.content.text !== 'string' || brief.content.text.length > 2000) fail('CONFLICT', 'Approved brief reference differs');
    if (p.mode === 'session') {
      return [brief.content.text,
        '通过已安装 Context Guard Skill 执行以下命令（当前 Session，遵守仓库规则）：',
        `开始：map task start ${message.id}`,
        `完成：map task finish ${message.id} --summary "实际结果、验证证据与可复用经验"`,
        '完成时一并提交总结，之后等待人类验收；不要等待勾选后再生成总结。',
        '失败或取消时加 --outcome failed/cancelled。重试使用同一编号；完成不代表发布 Main。'].join('\n');
    }
    return ['Context Guard：已确认的任务，请先读代码并提交 Plan，收到审核通过后再执行。',
      `任务：${p.taskId}`, `节点：${p.nodeIds.join(', ')}`, `Main 记忆版本（不是 Git SHA）：${p.mainVersion}`, brief.content.text,
      '优先使用 map task plan --input -（stdin），或 --input <JSON文件路径>（文件必须位于当前 Session 工作树内）提交 {operationId,content:{paths,steps}}；不要使用 /tmp/plan.json 等共享临时文件，可能被并行 Session 覆盖。不清楚时先读 map task plan --help。审核前只读，不启动开发 Plan。',
      '执行边界：Coordinator 已经创建并绑定本任务的独立执行 Session；不得手工创建、选择、分配或替换 Session，不得直接改写 Main、.codex/context/main/map.json 或任何服务器状态。若这是链路验证任务，只读核对任务、Session、回执和状态，不要把验证动作变成业务开发。map task plan 成功返回 awaiting-plan-review 后，立即结束本轮并等待 review.result；不要继续调用工具、修改文件、提交 handoff 或自行派发。',
      reviewedRetry,
      `交付编号：${message.id}；同一编号不得重复执行。`].join('\n');
  }
  if (message.type === 'review.result' && p.kind === 'plan') {
    const receipt = await readObject(p.receiptId, p.receiptId);
    if (receipt.kind !== 'reviewReceipt' || receipt.content?.ref !== p.ref || receipt.content?.version !== p.version || receipt.content?.decision !== p.decision) fail('CONFLICT', 'Plan review receipt differs');
    return `Context Guard：Plan ${p.ref}@${p.version} 审核${p.decision === 'approved' ? '通过，可继续执行' : '未通过，请修改 Plan'}。\n${p.reason}\n回执：${p.receiptId}\n` +
      (p.decision === 'approved' ? '用 map execution 读取当前审核身份，再按 Skill 的 plan-start 开发；提交代码后用 map task handoff --input -（stdin，优先）或 --input <JSON文件路径>（仅当前 Session 工作树内）交付 CI TODO、测试证据和经验。若原任务是链路验证或明确要求不修改业务文件，只做只读核对（Session、任务、回执、git status），不要改 Main/map.json 或业务文件；随后用只读证据提交 handoff，不要自行创建或分配 Session。' : '保持只读；用新的 operationId 和 map task plan 提交修订版，等待审核；使用 stdin 或当前工作树内文件，不要使用共享 /tmp 文件。');
  }
  if (message.type === 'task.rework') return `Context Guard：原任务 ${p.taskId} 返工，不创建新任务。\n${p.reason ? `返工原因：${p.reason}\n` : ''}代码：${p.sourceSha}\nCI：${p.ciResultRef}\n失败测试：${p.failedTestIds.join(', ')}\n交付编号：${message.id}`;
  if (message.type === 'task.control' && p.action === 'resume') return [
    `Context Guard：任务 ${p.taskId} 已收到恢复控制，原因：${p.data?.reason || '用户要求继续'}。`,
    '这是原任务的受控恢复，不是新任务；先用 map execution 读取当前授权 Plan、任务和已有证据，不重复已完成操作。',
    '如果原任务是链路验证或明确要求不修改业务文件：只读核对 Session、任务、回执和 git status；不得读取或改写 Main、map.json 或业务文件，也不得自行创建/分配 Session。回报 resumed 后，使用只读证据提交 map task handoff（--input - 通过 stdin），让流程进入 CI/验收；不要再次等待或触发自动恢复。',
    '确认可以继续后，用 map exchange --input -（stdin）回报 resumed；消息必须保留原控制编号：',
    JSON.stringify({ v: 2, id: hash(`resume:${message.id}`), type: 'task.report', session: message.session,
      payload: { taskId: p.taskId, stage: 'resumed', data: { controlId: message.id } } }),
    '回报后按已批准 Plan 继续；若 Plan 未批准或范围仍不清楚，保持只读并通过 ask_user 请求确认。',
    reviewedRetry,
  ].join('\n');
  if (message.type === 'task.control' && p.action === 'complete') return [
    `Context Guard：任务 ${p.taskId} 已通过服务端合并与归档校验。保留证据，结束该任务。`,
    '使用 map exchange --input <JSON文件> 回报关闭；不要重新执行开发或再次合并。',
    JSON.stringify({ v: 2, id: hash(`close:${message.id}`), type: 'task.report', session: message.session,
      payload: { taskId: p.taskId, stage: 'closed', data: { controlId: message.id, closeReceiptId: message.id } } }),
  ].join('\n');
  if (message.type === 'task.control') return `Context Guard：任务 ${p.taskId} 控制请求 ${p.action}。完成对应操作后，使用原控制编号回报；收到不等于完成，不得擅自删除记录。\n${JSON.stringify(p.data)}\n控制编号：${message.id}`;
  return null;
}

// A host may accept a message just before the caller crashes. A durable intent
// prevents a second model invocation when acceptance cannot be established.
export class ProtocolDelivery {
  constructor(directory, adapters) { this.directory = directory; this.adapters = adapters; }
  async retryBusy(canRetry, limit = 4) {
    const names = await fs.readdir(this.directory).catch(error => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    const candidates = (await Promise.all(names.filter(value => value.endsWith('.json')).map(async name => ({
      name, mtimeMs: await fs.stat(path.join(this.directory, name)).then(stat => stat.mtimeMs, () => 0),
    })))).sort((a, b) => b.mtimeMs - a.mtimeMs);
    let attempted = 0;
    for (const { name, mtimeMs } of candidates) {
      if (attempted >= limit) break;
      if (!mtimeMs || Date.now() - mtimeMs > 24 * 60 * 60 * 1000) continue;
      const file = path.join(this.directory, name);
      const previous = await readJSON(file, null);
      if (previous?.state !== 'failed' || previous.errorCode !== 'RUNTIME_BUSY' || !previous.input) continue;
      if (!await canRetry(previous.input)) continue;
      attempted++;
      await this.deliver(previous.input).catch(error => {
        if (error.code !== 'UNAVAILABLE') throw error;
      });
    }
    return attempted;
  }
  async deliver(input) {
    const adapter = this.adapters[input.platform];
    const invoke = typeof adapter === 'function' ? adapter : adapter?.deliver;
    if (typeof invoke !== 'function') fail('INVALID_ARGUMENT', 'This host does not support task delivery');
    if (!input.id || !input.sessionId || typeof input.message !== 'string' || !input.message.trim()) fail('INVALID_ARGUMENT', 'Delivery identity and message are required');
    const file = path.join(this.directory, `${hash(input.id)}.json`), fingerprint = hash(canonical(input));
    return withFileLock(`${file}.lock`, async () => {
      const previous = await readJSON(file, null);
      if (previous && previous.fingerprint !== fingerprint) fail('ID_REUSED', 'Delivery ID differs from the saved intent');
      if (previous?.state === 'received') return previous.result;
      if (previous?.state === 'dispatching' || previous?.state === 'uncertain') {
        if (await adapter.received?.(input)) {
          const result = { deliveryId: input.id, state: 'received', sessionId: input.sessionId };
          await atomicWrite(file, encode({ fingerprint, state: 'received', input, result }));
          return result;
        }
        fail('UNAVAILABLE', 'Host acceptance is uncertain; do not dispatch again', { deliveryId: input.id, deliveryState: 'uncertain' });
      }
      await atomicWrite(file, encode({ fingerprint, state: 'dispatching', attempts: (previous?.attempts || 0) + 1, input }));
      try {
        await invoke.call(adapter, input);
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
