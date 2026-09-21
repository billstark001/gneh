import type { Span } from '@gneh/core';
import { parseSugarExpression } from '@gneh/expression';
import { splitWikiLink, type MarkupParser } from '@gneh/syntax';

export function sugarExpression(source: string, span: Span) {
  return parseSugarExpression(source, span);
}

export function firstString(
  source: string,
  parser: MarkupParser,
  start: number,
): {
  value: string;
  rest: string;
} {
  const match = /^("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*/.exec(source);
  if (!match) parser.error('SUGARCAST_LITERAL', 'Expected a literal string argument.', start);
  const ast = parseSugarExpression(match[1]).ast;
  if (ast.type !== 'Literal' || typeof ast.value !== 'string')
    parser.error('SUGARCAST_LITERAL', 'Expected string', start);
  return { value: ast.value as string, rest: source.slice(match[0].length) };
}

export function wikiLink(source: string): { label: string; target: string; rest: string } | undefined {
  const match = /^\[\[([\s\S]*?)\]\]\s*/.exec(source);
  if (!match) return;
  const { label, target } = splitWikiLink(match[1], 'source-order');
  return { label, target, rest: source.slice(match[0].length) };
}
