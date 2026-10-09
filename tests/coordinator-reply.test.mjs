import '../.github/scripts/test-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { coordinatorReplyIssue, coordinatorReplyProfile, visibleCharacters } from '../scripts/shared/coordinator-reply.mjs';

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
