import { parseParameterPattern } from '@gneh/expression';
import { balanced, splitTopLevel, type MarkupParser } from '@gneh/syntax';
import type { InkdownMacroToken } from './directives.js';

export function paramsAt(source: string, start: number, parser: MarkupParser, base: number) {
  if (source[start] !== '(') return { params: [], end: start };
  const group = balanced(source, start);
  const parameters = group.content.trim() ? splitTopLevel(group.content) : [];
  const params = parameters.map((parameter) =>
    parseParameterPattern(parameter, parser.span(base + group.start, base + group.end)),
  );
  const rest = params.findIndex((parameter) => parameter.type === 'RestElement');
  if (rest >= 0 && rest !== params.length - 1)
    parser.error('BINDING_REST', 'A rest parameter must be the last parameter.', base + group.start, base + group.end);
  return { params, end: group.end };
}

export function topLevelEquals(source: string): number {
  let quote = '';
  let depth = 0;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quote) {
      if (char === '\\') index++;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') quote = char;
    else if ('([{'.includes(char)) depth++;
    else if (')]}'.includes(char)) depth--;
    else if (char === '=' && depth === 0 && source[index + 1] !== '>' && source[index + 1] !== '=') return index;
  }
  return -1;
}

export function declarationPosition(
  parser: MarkupParser,
  token: InkdownMacroToken,
  base: number,
  inline: boolean,
): void {
  if (parser.nesting > 1 || inline)
    parser.error('DECLARATION_POSITION', `@${token.name} is a top-level declaration.`, base + token.start);
}
