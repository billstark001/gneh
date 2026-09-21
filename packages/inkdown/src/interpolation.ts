import { scanExpression } from '@gneh/expression';
import type { StoryNode } from '@gneh/core';
import type { MarkupParser, ReadResult } from '@gneh/syntax';

const writeOperators = new Set(['=', '+=', '-=', '*=', '/=', '%=', '**=', '&&=', '||=', '??=', '++', '--']);

export function hardBreak(index: number, width: number, base: number, parser: MarkupParser): ReadResult {
  const node: StoryNode = {
    type: 'content',
    kind: 'break',
    attrs: {},
    children: [],
    span: parser.span(base + index, base + index + width),
  };
  return { nodes: [node], end: index + width };
}

export function inlineExpression(
  source: string,
  index: number,
  base: number,
  parser: MarkupParser,
): ReadResult | undefined {
  const sigil = source[index];
  if (!['$', '_'].includes(sigil) || !/[A-Za-z_]/.test(source[index + 1] ?? '')) return;
  if (sigil === '_' && (source.startsWith('__', index) || /[\w$]/.test(source[index - 1] ?? ''))) return;
  const scanned = scanExpression(source, index, parser.span(base + index, base + source.length), {
    profile: 'interpolation',
    incomplete: 'rollback',
    boundary: ({ token, depth }) =>
      depth === 0 &&
      (writeOperators.has(token.value) || (token.kind === 'op' && /\s/.test(source[token.start - 1] ?? ''))),
  });
  const expression = source.slice(index, scanned.end);
  return {
    nodes: [
      {
        type: 'value',
        expression: parser.expr(expression, base + index),
        span: parser.span(base + index, base + scanned.end),
      },
    ],
    end: scanned.end,
  };
}
