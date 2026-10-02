import { lexer } from 'marked';

const decode = value => String(value || '').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, entity) => {
  if (entity.startsWith('#')) {
    const code = entity[1].toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : match;
  }
  return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[entity.toLowerCase()] || match;
});
const safeLink = href => /^(?:javascript|data|vbscript):/i.test(decode(href).replace(/[\u0000-\u0020\u007f]/g, '')) ? '' : decode(href);

// Parse formatting instead of deleting punctuation indiscriminately: code,
// underscores in identifiers, URLs and ordinary arithmetic remain content.
export function plainText(source) {
  const input = String(source || ''), literals = [];
  let prefix = '\u0000cg-plain-literal:';
  while (input.includes(prefix)) prefix += ':';
  const literal = value => { const index = literals.push(value) - 1; return `${prefix}${index}\u0000`; };
  const slackLinks = value => value.replace(/<((?:https?:\/\/)[^>|\n]+)(?:\|([^>\n]+))?>/g,
    (_, href, label) => label ? `${label}（${href}）` : href);
  const render = (tokens, depth = 0) => (tokens || []).map(token => {
    const children = () => depth < 64 ? render(token.tokens, depth + 1) : decode(token.text);
    switch (token.type) {
      case 'space': return '\n\n';
      case 'heading': case 'paragraph': return `${children()}\n\n`;
      case 'blockquote': return children();
      case 'strong': case 'em': case 'del': return children();
      case 'text': return token.tokens ? children() : decode(token.text);
      case 'escape': return decode(token.text);
      case 'codespan': return literal(token.text);
      case 'code': return `${literal(token.text)}\n\n`;
      case 'br': return '\n';
      case 'hr': case 'def': return '';
      case 'link': case 'image': {
        const slack = /^<((?:https?:\/\/)[^>|\n]+)\|([^>\n]+)>$/.exec(token.raw || '');
        if (slack) return `${decode(slack[2])}（${decode(slack[1])}）`;
        const label = token.tokens ? children() : decode(token.text), href = safeLink(token.href);
        return href && href !== label ? `${label}（${href}）` : label || href;
      }
      case 'list': return token.items.map((item, index) => `${token.ordered ? `${Number(token.start || 1) + index}、` : '• '}${item.task ? item.checked ? '已完成：' : '待办：' : ''}${render(item.tokens, depth + 1).trim()}`).join('\n') + '\n\n';
      case 'table': {
        const headers = token.header.map(cell => render(cell.tokens, depth + 1));
        return token.rows.map(row => row.map((cell, index) => `${headers[index]}：${render(cell.tokens, depth + 1)}`).join('；')).join('\n') + '\n\n';
      }
      case 'html': return decode(token.text.replace(/<br\s*\/?\s*>/gi, '\n').replace(/<\/?[^>]+>/g, ''));
      default: return token.tokens ? children() : decode(token.text || token.raw);
    }
  }).join('');
  let output = slackLinks(render(lexer(input, { gfm: true }))).replace(/\n{3,}/g, '\n\n').trim();
  return output.replace(new RegExp(`${prefix}(\\d+)\u0000`, 'g'), (match, index) => literals[Number(index)] ?? match);
}
