import {
  literalNodes,
  readList,
  type LineEnd,
  type MarkupDialect,
  type MarkupParser,
  type ReadResult,
} from '@gneh/syntax';

function inline(source: string, index: number, base: number, parser: MarkupParser): ReadResult | undefined {
  const continuation = /^\\[^\S\r\n]*(?:\r\n|\r|\n)/.exec(source.slice(index));
  if (continuation) return { nodes: [], end: index + continuation[0].length };
  const character = source[index];
  if (character === '\n' || character === '\r') {
    const width = character === '\r' && source[index + 1] === '\n' ? 2 : 1;
    const joined = /^[^\S\r\n]*\\/.exec(source.slice(index + width));
    if (joined) return { nodes: [], end: index + width + joined[0].length };
    return {
      nodes: [
        {
          type: 'content',
          kind: 'break',
          attrs: {},
          children: [],
          span: parser.span(base + index, base + index + width),
        },
      ],
      end: index + width,
    };
  }
  if (source.startsWith('/*', index) || source.startsWith('/%', index)) {
    const opener = source.slice(index, index + 2);
    const closer = opener === '/*' ? '*/' : '%/';
    const end = source.indexOf(closer, index + 2);
    if (end < 0) parser.error('COMMENT', `Unclosed ${opener} comment`, base + index);
    return { nodes: [], end: end + 2 };
  }
  if (source.startsWith('"""', index)) {
    const end = source.indexOf('"""', index + 3);
    if (end >= 0)
      return {
        nodes: literalNodes(source.slice(index + 3, end), base, index + 3, parser),
        end: end + 3,
      };
  }
  if (source.startsWith('{{{', index)) {
    const end = source.indexOf('}}}', index + 3);
    if (end >= 0)
      return {
        nodes: [
          {
            type: 'content',
            kind: 'code',
            attrs: {},
            children: [
              {
                type: 'text',
                value: source.slice(index + 3, end),
                span: parser.span(base + index + 3, base + end),
              },
            ],
            span: parser.span(base + index, base + end + 3),
          },
        ],
        end: end + 3,
      };
  }
  if (character === '`') {
    let count = 1;
    while (source[index + count] === '`') count++;
    const end = source.indexOf('`'.repeat(count), index + count);
    if (end >= 0)
      return {
        nodes: [
          {
            type: 'content',
            kind: 'code',
            attrs: {},
            children: [
              {
                type: 'text',
                value: source.slice(index + count, end).replace(/\r?\n/g, ' '),
                span: parser.span(base + index + count, base + end),
              },
            ],
            span: parser.span(base + index, base + end + count),
          },
        ],
        end: end + count,
      };
  }
  if (
    character === '_' &&
    source[index + 1] !== '_' &&
    !/[\w$]/.test(source[index - 1] ?? '') &&
    /^[A-Za-z_]/.test(source[index + 1] ?? '')
  ) {
    const name = /^_[A-Za-z_]\w*/.exec(source.slice(index))![0];
    return {
      nodes: [
        {
          type: 'value',
          expression: parser.expr(name, base + index),
          span: parser.span(base + index, base + index + name.length),
        },
      ],
      end: index + name.length,
    };
  }
}

function codeBlock(
  source: string,
  index: number,
  base: number,
  lineEnd: LineEnd,
  parser: MarkupParser,
): ReadResult | undefined {
  let end = lineEnd(index);
  if (!/^\{\{\{\s*$/.test(source.slice(index, end).replace(/\r?\n$/, ''))) return;
  const bodyStart = end;
  let cursor = end;
  while (cursor < source.length) {
    const next = lineEnd(cursor);
    if (/^\}\}\}\s*$/.test(source.slice(cursor, next).replace(/\r?\n$/, ''))) {
      end = next;
      return {
        nodes: [
          {
            type: 'content',
            kind: 'code-block',
            attrs: {},
            children: [
              {
                type: 'text',
                value: source.slice(bodyStart, cursor).replace(/\r?\n$/, ''),
                span: parser.span(base + bodyStart, base + cursor),
              },
            ],
            span: parser.span(base + index, base + end),
          },
        ],
        end,
        block: true,
      };
    }
    cursor = next;
  }
  parser.error('CODE_FENCE', 'Unclosed SugarCube code block.', base + index);
}

function block(
  source: string,
  index: number,
  base: number,
  lineEnd: LineEnd,
  parser: MarkupParser,
): ReadResult | undefined {
  const code = codeBlock(source, index, base, lineEnd, parser);
  if (code) return code;
  return readList(source, index, base, lineEnd, parser, (raw) => {
    const match = /^(\*+|#+)\s+(.*)$/.exec(raw.replace(/\r?\n$/, ''));
    if (!match) return;
    return {
      depth: match[1].length,
      ordered: match[1].startsWith('#'),
      content: match[2],
    };
  });
}

export const sugarcastMarkup: MarkupDialect = {
  inline,
  inlineMarks: [
    ['//', 'emphasis'],
    ["''", 'strong'],
    ['__', 'underline'],
    ['==', 'strike'],
    ['^^', 'superscript'],
    ['~~', 'subscript'],
  ],
  block,
  isBlockStart: (line) => /^(?:!{1,6}|-{4,}\s*$|>+\s?|\{\{\{\s*$|(?:\*+|#+)\s+)/.test(line),
  heading: (line) => {
    const match = /^(!{1,6})(.*)$/.exec(line);
    return match
      ? { content: match[2], contentOffset: line.indexOf(match[2]), attrs: { level: match[1].length } }
      : undefined;
  },
  rule: (line) => /^-{4,}\s*$/.test(line),
  quote: (line) => {
    const match = /^(>+)\s?(.*)$/.exec(line);
    return match
      ? { content: match[2], contentOffset: line.indexOf(match[2]), attrs: { depth: match[1].length } }
      : undefined;
  },
  paragraphs: false,
  preserveBlankLines: true,
};
