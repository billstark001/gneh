import type { Metadata, StoryNode } from '@gneh/core';
import { balanced, readList, type LineEnd, type MarkupDialect, type MarkupParser, type ReadResult } from '@gneh/syntax';
import { hardBreak, inlineExpression } from './interpolation.js';

function inline(source: string, index: number, base: number, parser: MarkupParser): ReadResult | undefined {
  if (source[index] === '\\' && (source[index + 1] === '\n' || source[index + 1] === '\r')) {
    const width = source[index + 1] === '\r' && source[index + 2] === '\n' ? 3 : 2;
    return hardBreak(index, width, base, parser);
  }
  if (source[index] === '\n' || source[index] === '\r') {
    const width = source[index] === '\r' && source[index + 1] === '\n' ? 2 : 1;
    if (source.slice(0, index).match(/ {2,}$/)) return hardBreak(index, width, base, parser);
  }
  if (
    source[index] === '\\' &&
    index + 1 < source.length &&
    /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/.test(source[index + 1])
  )
    return {
      nodes: [
        {
          type: 'text',
          value: source[index + 1],
          span: parser.span(base + index, base + index + 2),
        },
      ],
      end: index + 2,
    };
  if (
    source[index] === '_' &&
    /[\p{L}\p{N}]/u.test(source[index - 1] ?? '') &&
    /[\p{L}\p{N}]/u.test(source[index + 1] ?? '')
  )
    return {
      nodes: [{ type: 'text', value: '_', span: parser.span(base + index, base + index + 1) }],
      end: index + 1,
    };
  if (source[index] === '`') {
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
                value: (() => {
                  let value = source.slice(index + count, end).replace(/\r?\n/g, ' ');
                  if (value.startsWith(' ') && value.endsWith(' ') && /[^ ]/.test(value)) value = value.slice(1, -1);
                  return value;
                })(),
                span: parser.span(base + index + count, base + end),
              },
            ],
            span: parser.span(base + index, base + end + count),
          },
        ],
        end: end + count,
      };
  }
  if (source.startsWith('{{', index)) {
    const group = balanced(source, index);
    if (source[group.end - 2] !== '}') parser.error('VALUE_CLOSE', 'Expected }}', base + index);
    const expression = group.content.slice(1, -1);
    return {
      nodes: [
        {
          type: 'value',
          expression: parser.expr(expression, base + index + 2),
          span: parser.span(base + index, base + group.end),
        },
      ],
      end: group.end,
    };
  }
  const expression = inlineExpression(source, index, base, parser);
  if (expression) return expression;
  if (source[index] !== '[' && !(source[index] === '!' && source[index + 1] === '[')) return;
  const image = source[index] === '!';
  const bracket = index + (image ? 1 : 0);
  let label;
  try {
    label = balanced(source, bracket, 'markup');
  } catch {
    return;
  }
  const next = source[label.end];
  if (next === '(') {
    const destination = balanced(source, label.end, 'markup');
    const url = destination.content.trim().replace(/^<|>$/g, '');
    return {
      nodes: [
        {
          type: 'content',
          kind: image ? 'image' : 'link',
          attrs: image ? { src: url, alt: label.content } : { href: url },
          children: image ? [] : parser.inline(label.content, base + label.start),
          span: parser.span(base + index, base + destination.end),
        },
      ],
      end: destination.end,
    };
  }
  if (next !== '{' || image) return;
  const attributes = balanced(source, label.end);
  const parsed = parser.attributes(attributes.content, base + attributes.start);
  if (Object.keys(parsed.bindings).length)
    parser.error('STYLE_BINDING', 'Dynamic attributes belong on extension containers.', base + index);
  return {
    nodes: [
      {
        type: 'content',
        kind: 'span',
        attrs: parsed.attrs,
        children: parser.inline(label.content, base + label.start),
        span: parser.span(base + index, base + attributes.end),
      },
    ],
    end: attributes.end,
  };
}

function codeFence(
  source: string,
  index: number,
  base: number,
  lineEnd: LineEnd,
  parser: MarkupParser,
): ReadResult | undefined {
  let end = lineEnd(index);
  const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(source.slice(index, end).replace(/\r?\n$/, ''));
  if (!fence) return;
  const marker = fence[1],
    bodyStart = end;
  let cursor = end;
  while (cursor < source.length) {
    const next = lineEnd(cursor);
    const line = source.slice(cursor, next).trim();
    if (line[0] === marker[0] && line.length >= marker.length && [...line].every((c) => c === marker[0])) {
      end = next;
      return {
        nodes: [
          {
            type: 'content',
            kind: 'code-block',
            attrs: { language: fence[2].trim() },
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
  parser.error('CODE_FENCE', 'Unclosed code fence.', base + index);
}

function container(
  source: string,
  index: number,
  base: number,
  lineEnd: LineEnd,
  parser: MarkupParser,
): ReadResult | undefined {
  let end = lineEnd(index);
  const line = source.slice(index, end).replace(/\r?\n$/, '');
  if (!line.trimStart().startsWith(':::')) return;
  const rest = line.trim().slice(3).trim();
  if (!rest) parser.error('CONTAINER_CLOSE', 'Unexpected container terminator.', base + index);
  let name = 'box',
    attr = rest;
  const match = /^([\w:-]+)\s*(.*)$/.exec(rest);
  if (match) {
    name = match[1];
    attr = match[2];
  }
  const marker = line.indexOf(':::');
  const parsed = parser.attributes(attr, base + index + marker + 3 + rest.indexOf(attr));
  let depth = 1,
    cursor = end,
    bodyEnd = end,
    codeMarker = '';
  while (cursor < source.length) {
    const next = lineEnd(cursor);
    const current = source.slice(cursor, next).trim();
    if (/^(`{3,}|~{3,})/.test(current)) {
      if (!codeMarker) codeMarker = current[0];
      else if (current[0] === codeMarker) codeMarker = '';
    }
    if (!codeMarker && current.startsWith(':::')) {
      if (current === ':::') depth--;
      else depth++;
      if (!depth) {
        bodyEnd = cursor;
        end = next;
        break;
      }
    }
    cursor = next;
  }
  if (depth) parser.error('CONTAINER_CLOSE', 'Unclosed ::: container.', base + index);
  const bodyStart = lineEnd(index);
  return {
    nodes: [
      {
        type: 'extension',
        name,
        attrs: parsed.attrs,
        bindings: parsed.bindings,
        children: parser.blocks(source.slice(bodyStart, bodyEnd), base + bodyStart),
        span: parser.span(base + index, base + end),
      },
    ],
    end,
    block: true,
  };
}

function block(
  source: string,
  index: number,
  base: number,
  lineEnd: LineEnd,
  parser: MarkupParser,
): ReadResult | undefined {
  const fenced = codeFence(source, index, base, lineEnd, parser);
  if (fenced) return fenced;
  const boxed = container(source, index, base, lineEnd, parser);
  if (boxed) return boxed;
  const listed = readList(source, index, base, lineEnd, parser, (raw) => {
    const match = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(raw.replace(/\r?\n$/, ''));
    if (!match) return;
    const indentation = match[1].replace(/\t/g, '    ').length;
    return { depth: Math.floor(indentation / 2) + 1, ordered: /\d/.test(match[2]), content: match[3] };
  });
  if (listed) return listed;
  const end = lineEnd(index);
  const line = source.slice(index, end).replace(/\r?\n$/, '');
  const heading = /^ {0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/.exec(line);
  if (!heading) return;
  let content = heading[2];
  let attrs: Metadata = { level: heading[1].length };
  const attribute = /\s+(\{[.#][^}]*\})$/.exec(content);
  if (attribute) {
    attrs = { ...attrs, ...parser.attributes(attribute[1], base + index + line.indexOf(attribute[1])).attrs };
    content = content.slice(0, attribute.index);
  }
  const contentOffset = line.indexOf(content);
  const node: StoryNode = {
    type: 'content',
    kind: 'heading',
    attrs,
    children: parser.inline(content, base + index + contentOffset),
    span: parser.span(base + index, base + end),
  };
  return { nodes: [node], end, block: true };
}

export const inkdownMarkup: MarkupDialect = {
  inline,
  inlineMarks: [
    ['**', 'strong'],
    ['__', 'strong'],
    ['~~', 'strike'],
    ['*', 'emphasis'],
    ['_', 'emphasis'],
  ],
  block,
  isBlockStart: (line) => /^\s*$|^ {0,3}(?:#{1,6}\s|>\s?|[-*+]\s|\d+\.\s|`{3,}|~{3,}|:::)/.test(line),
  rule: (line) => /^ {0,3}(?:---+|\*\*\*+|___+)\s*$/.test(line),
  quote: (line) => {
    const match = /^ {0,3}>\s?(.*)$/.exec(line);
    return match ? { content: match[1], contentOffset: line.indexOf(match[1]) } : undefined;
  },
  paragraphs: true,
  preserveBlankLines: false,
};
