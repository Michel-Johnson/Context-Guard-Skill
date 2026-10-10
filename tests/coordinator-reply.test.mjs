import '../.github/scripts/test-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { coordinatorReplyIssue, coordinatorTurnReplyIssue, coordinatorToolReplyTexts, coordinatorPresentationKey, coordinatorReplyProfile, visibleCharacters } from '../scripts/shared/coordinator-reply.mjs';

test('普通回复段落最多60个可见字符，不裁切原文或强凑最小长度', () => {
  assert.equal(coordinatorReplyIssue('好。'), null);
  assert.equal(coordinatorReplyIssue('中'.repeat(60)), null);
  assert.equal(coordinatorReplyIssue('中'.repeat(61)), 'REPLY_PARAGRAPH_LONG');
  assert.equal(visibleCharacters('👨‍👩‍👧‍👦'), 1);
  assert.equal(coordinatorReplyIssue('甲\n\n乙\n\n丙'), 'REPLY_TOO_MANY_PARAGRAPHS');
  assert.equal(coordinatorReplyIssue('甲\n\n乙\n\n丙', { detailed: true }), null);
  assert.equal(coordinatorReplyIssue('甲'.repeat(61), { detailed: true }), 'REPLY_PARAGRAPH_LONG');
  assert.equal(coordinatorReplyIssue('形态是什么？预算多少？'), 'MULTIPLE_QUESTIONS');
});
test('已知内部身份及测试标签不得进入普通正文，业务数字和URL不误删', () => {
  assert.equal(coordinatorReplyIssue('挂在 TD-c1daa5816d4bbac5。', { internalIds: ['TD-c1daa5816d4bbac5'] }), 'REPLY_INTERNAL_ID');
  assert.equal(coordinatorReplyIssue('```text\nTD-c1daa5816d4bbac5\n```', { internalIds: ['TD-c1daa5816d4bbac5'] }), 'REPLY_INTERNAL_ID');
  assert.equal(coordinatorReplyIssue('还有 E2E Repeat Bug 20260920-602422。'), 'REPLY_INTERNAL_ID');
  assert.equal(coordinatorReplyIssue('v2.1 在2026年发布，端口8000。'), null);
  assert.equal(coordinatorReplyIssue('已绑定 T0。', { internalIds: ['T0'] }), 'REPLY_INTERNAL_ID');
  assert.equal(coordinatorReplyIssue('使用 T01 端口8000。', { internalIds: ['T0', '8000'] }), null);
  const text = '[打开节点](https://example.test/TD-c1daa5816d4bbac5)';
  assert.equal(coordinatorReplyIssue(text, { internalIds: ['TD-c1daa5816d4bbac5'] }), null);
  assert.equal(coordinatorReplyIssue('```sh\n' + 'x'.repeat(100) + '\n```', { technical: true }), null);
});
test('详情和表情例外只来自本轮明确输入，不由模型声明', () => {
  assert.equal(coordinatorReplyProfile('不要详细展开').detailed, false);
  assert.equal(coordinatorReplyProfile('请展开完整清单').detailed, true);
  assert.equal(coordinatorReplyProfile('你好').reactionOnly, false);
  assert.equal(coordinatorReplyProfile('只回复一个表情').reactionOnly, true);
  assert.equal(coordinatorReplyProfile('谢谢，仅用一个表情回应即可。').reactionOnly, true);
  assert.equal(coordinatorReplyProfile('不要输出代码').technical, false);
  assert.equal(coordinatorReplyProfile('请给我代码').technical, true);
});

test('节点卡片与正文同样检查内部身份和60字上限，完整brief字段不裁切', () => {
  const card = message => [{ name: 'show_nodes', input: { message, nodeIds: ['node-private'] } }];
  assert.equal(coordinatorTurnReplyIssue('请看节点。', card('归属 node-private'), { internalIds: ['node-private'] }).issue, 'REPLY_INTERNAL_ID');
  assert.equal(coordinatorTurnReplyIssue('', card('中'.repeat(61))).issue, 'REPLY_PARAGRAPH_LONG');
  assert.equal(coordinatorTurnReplyIssue('', card('中'.repeat(60))), null);
  assert.equal(coordinatorTurnReplyIssue('', card('甲\n\n乙')), null);
  assert.equal(coordinatorTurnReplyIssue('', card('甲\n\n乙\n\n丙'), { detailed: true }).issue, 'REPLY_TOO_MANY_PARAGRAPHS');
  const brief = { name: 'prepare_task', input: { text: '中'.repeat(800), acceptance: '验收'.repeat(200) } };
  assert.deepEqual(coordinatorToolReplyTexts(brief.name, brief.input), []);
  assert.equal(coordinatorTurnReplyIssue('', [brief]), null);
});

test('问题集中到问答入口，整轮正文与卡片不能藏入额外问句', () => {
  const question = { name: 'ask_user', input: { question: '选择哪个范围？', options: ['公开文章', '当前文章'] } };
  assert.equal(coordinatorTurnReplyIssue('', [question]), null);
  assert.equal(coordinatorTurnReplyIssue('选择哪个范围？', [question]).issue, 'MULTIPLE_QUESTIONS');
  assert.equal(coordinatorTurnReplyIssue('', [question], { previousQuestions: 1 }).issue, 'MULTIPLE_QUESTIONS');
  assert.equal(coordinatorTurnReplyIssue('', [question], { previousTexts: ['[查看资料](https://example.test/?q=1)'] }), null);
  assert.equal(coordinatorTurnReplyIssue('', [question, question], { detailed: true }).issue, 'MULTIPLE_QUESTIONS');
  assert.equal(coordinatorTurnReplyIssue('', [{ name: 'show_nodes', input: { message: '你想核对哪部分？' } }]).issue, 'MULTIPLE_QUESTIONS');
  assert.equal(coordinatorTurnReplyIssue('', [{ name: 'show_nodes', input: { message: '请查看 https://example.test/?q=1' } }]), null);
  assert.equal(coordinatorTurnReplyIssue('', [{ name: 'mount_conversation', input: { description: 'node-private' } }], { internalIds: ['node-private'] }).issue, 'REPLY_INTERNAL_ID');
});

test('展示去重键不混同变化后的正文或节点数据，不改业务回执', () => {
  const action = { kind: 'node-references', message: '原事项已读。', nodes: [{ id: 'A', title: '测试' }] };
  const before = JSON.stringify(action);
  assert.equal(coordinatorPresentationKey(action), coordinatorPresentationKey(structuredClone(action)));
  assert.notEqual(coordinatorPresentationKey(action), coordinatorPresentationKey({ ...action, message: '原事项已更新。' }));
  assert.notEqual(coordinatorPresentationKey(action), coordinatorPresentationKey({ ...action, nodes: [{ id: 'A', title: '新名称' }] }));
  assert.equal(coordinatorPresentationKey({ kind: 'map-action', actionId: 'same' }), null);
  assert.equal(JSON.stringify(action), before);
});
