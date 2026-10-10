// 只验证展示内容，不修改定位参数，也不裁切模型回复。
export const COORDINATOR_REPLY_POLICY = '\n[普通回复规范]\n用中文回复。默认一至两段，每段最多60个可见字符，不强凑40字。先答当前问题，最多两个重点，不倾倒事项清单。只问一个核心问题，选择题用ask_user.options。普通正文不展示内部ID、哈希或测试编号；名称不明确时读取描述，不猜。读取资料时可直接调用工具，不必先写进度文字；挂载、提问及brief由宿主卡片完整展示，不在正文重复。完整brief、代码、命令和执行提示通过对应详情入口完整提供。用户明确索要完整清单或展开详情时可增加段落。';
const segmenter = new Intl.Segmenter('zh', { granularity: 'grapheme' });
export const visibleCharacters = text => [...segmenter.segment(String(text))].length;
export function coordinatorReplyProfile(text = '') {
  const request = text.trim().replace(/^(?:谢谢|你好|好的|好)[，,：:。\s]*/u, '');
  const technicalTerms = ['代码', '命令', '执行提示', '技术编号', '内部编号', '事项编号', '节点编号', '原始ID'];
  return {
    detailed: /(?:详细|完整|全部|逐项|展开)/u.test(text) && !/(?:不要|不用|不必|别)(?:详细|展开|逐项)/u.test(text),
    technical: technicalTerms.some(term => new RegExp(term, 'iu').test(text) &&
      !new RegExp('(?:不要|不用|不必|别|禁止|不准)(?:输出|显示|提供|写|生成|给)?' + term, 'iu').test(text)),
    reactionOnly: /^(?:请)?(?:只|仅|就)(?:用|回|回复|发|给).{0,24}(?:表情|emoji).{0,12}[。！!]?$/iu.test(request),
  };
}
function readable(text, { technical = false } = {}) {
  return String(text).replace(/```[^\n]*\n[\s\S]*?(?:```|$)/gu, technical ? '' : '[代码]')
    .replace(/\[([^\]]+)\]\([^\s)]+\)/gu, '$1')
    .replace(/https?:\/\/[^\s<>]+/gu, '[链接]')
    .replace(/^[ \t]*(?:[-*+] |\d+[.)] |#{1,6} )/gmu, '')
    .replace(/[*_`]/gu, '').trim();
}
export function coordinatorReplyIssue(text, { internalIds = [], detailed = false, technical = false } = {}) {
  const body = readable(text, { technical });
  const identityText = technical ? body : String(text).replace(/\[([^\]]+)\]\([^\s)]+\)/gu, '$1').replace(/https?:\/\/[^\s<>]+/gu, '[链接]');
  const paragraphs = body.split(/\n\s*\n/u).filter(Boolean);
  if (internalIds.some(id => {
    if (typeof id !== 'string' || !id || /^\d+$/u.test(id)) return false;
    if (id.length >= 8) return identityText.includes(id);
    const literal = id.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    return new RegExp('(?<![A-Za-z0-9_-])' + literal + '(?![A-Za-z0-9_-])', 'u').test(identityText);
  }) ||
      /\bE2E[ -]Repeat(?:[ -](?:Bug|TODO))?(?:[ -]\d[\d-]*)?/iu.test(body)) return 'REPLY_INTERNAL_ID';
  if (paragraphs.some(paragraph => visibleCharacters(paragraph) > 60)) return 'REPLY_PARAGRAPH_LONG';
  if (!detailed && (body.match(/[?？]/gu) || []).length > 1) return 'MULTIPLE_QUESTIONS';
  if (!detailed && paragraphs.length > 2) return 'REPLY_TOO_MANY_PARAGRAPHS';
  return null;
}
// 普通工具文案与正文共用校验；完整 brief/代码仍由专用详情入口提供。
export function coordinatorToolReplyTexts(name, input = {}) {
  const fields = name === 'ask_user' ? [input.question, ...(Array.isArray(input.options) ? input.options : [])]
    : name === 'mount_conversation' ? [input.title, input.description]
    : name === 'show_nodes' ? [input.message] : [];
  return fields.filter(value => typeof value === 'string' && value);
}
export function coordinatorTurnReplyIssue(text, calls, options = {}) {
  const bodyIssue = coordinatorReplyIssue(text, options);
  if (bodyIssue) return { issue: bodyIssue, text };
  for (const call of calls) {
    for (const value of coordinatorToolReplyTexts(call.name, call.input)) {
      const issue = coordinatorReplyIssue(value, { ...options, technical: false, detailed: false });
      if (issue) return { issue, text: value };
      if (call.name === 'show_nodes' && /[?？]/u.test(value)) return { issue: 'MULTIPLE_QUESTIONS', text: value };
    }
  }
  const questions = calls.filter(call => call.name === 'ask_user').length;
  const proseQuestions = (readable(text, options).match(/[?？]/gu) || []).length;
  const previousQuestions = options.previousQuestions ?? (options.previousTexts || [])
    .reduce((count, value) => count + (readable(value, options).match(/[?？]/gu) || []).length, 0);
  if (questions > 1 || !options.detailed && questions + proseQuestions + previousQuestions > 1) {
    return { issue: 'MULTIPLE_QUESTIONS', text };
  }
  return null;
}
export function coordinatorPresentationKey(action) {
  if (action?.kind !== 'node-references') return null;
  return JSON.stringify([action.kind, action.message || '', action.nodes || []]);
}
export const replyRepairInstruction = (code, { detailed = false } = {}) => (detailed ? '' : '用中文重新表达。纠正时同时满足全部普通回复规则：仅一至两段、每段最多60字；不加标题、列表、复述或结尾追问，不泄露内部编号。必须保留当前问题所需事实，相关约束合并表达；若只是工具调用前的进度文字，可省略文字直接调用工具。\n') + ({
  REPLY_INTERNAL_ID: '重新表达：用节点或事项的中文短名称，不输出内部编号、哈希及测试标签。保留业务事实。',
  REPLY_PARAGRAPH_LONG: '重新表达：每段最多60个可见字符，只保留当前问题所需事实，不截断句子。',
  REPLY_TOO_MANY_PARAGRAPHS: '上一份正文段落过多，尚未展示。重新回答：不要标题、列表、开场复述或结尾追问，合并相关约束，最多两段、每段最多60字。例如：保留用户名，错误提示用中文，且不能泄露凭据。不要复述本示例，依据当前资料回答。',
  MULTIPLE_QUESTIONS: '整个用户轮次最多一个核心问题，需要澄清才用ask_user；不需要提问可直接简短回复。节点卡片message只写说明，不带问句；正文和卡片不重复提问，不重复展示同一卡片。',
  REACTION_REQUIRES_TEXT: '用户没有要求只用表情。请给有用的短文字回复，不用表情代替。',
}[code] || '本轮输出格式不完整，请遵守接话标识和工具格式后重新回答。');
