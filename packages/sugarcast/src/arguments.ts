import type { Span } from '@gneh/core';
import { parseSugarExpression } from '@gneh/expression';
import type { MarkupParser } from '@gneh/syntax';

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
  const inside = match[1];
  let label = inside.trim();
  let target = label;
  let separator = inside.indexOf('->');
  if (separator >= 0) {
    label = inside.slice(0, separator).trim();
    target = inside.slice(separator + 2).trim();
  } else if ((separator = inside.indexOf('<-')) >= 0) {
    target = inside.slice(0, separator).trim();
    label = inside.slice(separator + 2).trim();
  } else if ((separator = inside.indexOf('|')) >= 0) {
    label = inside.slice(0, separator).trim();
    target = inside.slice(separator + 1).trim();
  }
  return { label, target, rest: source.slice(match[0].length) };
}
