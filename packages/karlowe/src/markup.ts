import type { Span, StoryNode } from '@gneh/core';
import {
  balanced,
  literalNodes,
  readList,
  type LineEnd,
  type MarkupDialect,
  type MarkupParser,
  type ReadResult,
} from '@gneh/syntax';

function collapseNodes(nodes: StoryNode[]): StoryNode[] {
  const output: StoryNode[] = [];
  let pending = '';
  let pendingSpan: Span | undefined;
  const flush = () => {
    if (pendingSpan) output.push({ type: 'text', value: pending.replace(/\s+/g, ' '), span: pendingSpan });
    pending = '';
    pendingSpan = undefined;
  };
  for (const node of nodes) {
    if (node.type === 'text' || (node.type === 'content' && node.kind === 'break')) {
      pendingSpan ??= node.span;
      pending += node.type === 'text' ? node.value : ' ';
      continue;
    }
    flush();
    if ('children' in node && !(node.type === 'content' && node.attrs.verbatim))
      output.push({ ...node, children: collapseNodes(node.children) });
    else output.push(node);
  }
  flush();
  return output;
}

function collapsed(source: string, index: number, base: number, parser: MarkupParser): ReadResult | undefined {
  if (source[index] !== '{') return;
  let contentStart = index + 1,
    contentEnd: number,
    syntaxEnd: number;
  try {
    const group = balanced(source, index);
    contentEnd = group.end - 1;
    syntaxEnd = group.end;
  } catch {
    const unclosed = /^\{=+/.exec(source.slice(index));
    if (!unclosed) return;
    contentStart = index + unclosed[0].length;
    contentEnd = source.length;
    syntaxEnd = source.length;
  }
  return {
    nodes: [
      {
        type: 'content',
        kind: 'span',
        attrs: { collapse: true },
        children: collapseNodes(parser.inline(source.slice(contentStart, contentEnd), base + contentStart)),
        span: parser.span(base + index, base + syntaxEnd),
      },
    ],
    end: syntaxEnd,
  };
}

function inline(source: string, index: number, base: number, parser: MarkupParser): ReadResult | undefined {
  const continuation = /^\\(?:\r\n|\r|\n)/.exec(source.slice(index));
  if (continuation) return { nodes: [], end: index + continuation[0].length };
  const character = source[index];
  if (character === '\n' || character === '\r') {
    const width = character === '\r' && source[index + 1] === '\n' ? 2 : 1;
    if (source[index + width] === '\\') return { nodes: [], end: index + width + 1 };
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
  const collapse = collapsed(source, index, base, parser);
  if (collapse) return collapse;
  if (source.startsWith('***', index)) {
    const end = source.indexOf('***', index + 3);
    if (end >= index + 3) {
      const children = parser.inline(source.slice(index + 3, end), base + index + 3);
      return {
        nodes: [
          {
            type: 'content',
            kind: 'strong',
            attrs: {},
            children: [
              {
                type: 'content',
                kind: 'emphasis',
                attrs: {},
                children,
                span: parser.span(base + index + 1, base + end + 2),
              },
            ],
            span: parser.span(base + index, base + end + 3),
          },
        ],
        end: end + 3,
      };
    }
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
            kind: 'span',
            attrs: { verbatim: true },
            children: literalNodes(source.slice(index + count, end), base, index + count, parser),
            span: parser.span(base + index, base + end + count),
          },
        ],
        end: end + count,
      };
  }
  if (character === '_' && !/[\w$]/.test(source[index - 1] ?? '') && /^[A-Za-z_]/.test(source[index + 1] ?? '')) {
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

function block(
  source: string,
  index: number,
  base: number,
  lineEnd: LineEnd,
  parser: MarkupParser,
): ReadResult | undefined {
  const firstEnd = lineEnd(index);
  const marker = readAligner(source.slice(index, firstEnd).replace(/\r?\n$/, ''));
  if (marker) {
    let cursor = firstEnd;
    while (cursor < source.length) {
      const end = lineEnd(cursor);
      if (readAligner(source.slice(cursor, end).replace(/\r?\n$/, ''))) break;
      cursor = end;
    }
    const children = parser.blocks(source.slice(firstEnd, cursor), base + firstEnd);
    return {
      nodes:
        marker.alignment === 'left'
          ? children
          : [
              {
                type: 'content',
                kind: 'group',
                attrs: marker,
                children,
                span: parser.span(base + index, base + cursor),
              },
            ],
      end: cursor,
      block: true,
    };
  }
  return readList(source, index, base, lineEnd, parser, (raw) => {
    const match = /^\s*(\*+|(0\.)+)\s+(.*)$/.exec(raw.replace(/\r?\n$/, ''));
    if (!match) return;
    const marker = match[1];
    return {
      depth: marker.startsWith('0') ? marker.length / 2 : marker.length,
      ordered: marker.startsWith('0'),
      content: match[3],
    };
  });
}

function readAligner(
  line: string,
): { alignment: 'left' | 'right' | 'center' | 'justify'; marginLeft?: number; marginRight?: number } | undefined {
  const token = line.trim();
  if (/^={2,}>$/.test(token)) return { alignment: 'right' };
  if (/^<={2,}$/.test(token)) return { alignment: 'left' };
  if (/^<={2,}>$/.test(token)) return { alignment: 'justify' };
  const mixed = /^(=+)><(=+)$/.exec(token);
  if (!mixed) return;
  const left = mixed[1].length;
  const right = mixed[2].length;
  const total = left + right;
  const width = (2 * Math.min(left, right) * 100) / total;
  const point = (left * 100) / total;
  return {
    alignment: 'center',
    marginLeft: point - width / 2,
    marginRight: 100 - point - width / 2,
  };
}

export const karloweMarkup: MarkupDialect = {
  inline,
  inlineMarks: [
    ['**', 'strong'],
    ["''", 'bold'],
    ['//', 'italic'],
    ['~~', 'strike'],
    ['^^', 'superscript'],
    ['*', 'emphasis'],
  ],
  block,
  isBlockStart: (line) =>
    /^\s*(?:#{1,6}|-{3,}\s*$|(?:\*+|(0\.)+)\s+)/.test(line) || !!readAligner(line.replace(/\r?\n$/, '')),
  heading: (line) => {
    const match = /^\s*(#{1,6})\s*(.*)$/.exec(line);
    return match
      ? { content: match[2], contentOffset: line.indexOf(match[2]), attrs: { level: match[1].length } }
      : undefined;
  },
  rule: (line) => /^\s*-{3,}\s*$/.test(line),
  paragraphs: false,
  preserveBlankLines: true,
};
