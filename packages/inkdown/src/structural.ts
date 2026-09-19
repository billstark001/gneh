import type { StoryNode } from '@gneh/core';
import { parseIterationClause } from '@gneh/expression';
import { balanced, splitTopLevel, type MarkupParser, type ReadResult, type SpecialReader } from '@gneh/syntax';

const spaces = (source: string, start: number) => {
  while (/\s/.test(source[start] ?? '')) start++;
  return start;
};

export function readConditional(
  parser: MarkupParser,
  source: string,
  index: number,
  base: number,
  inline: boolean,
  cursor: number,
  readDirective: SpecialReader,
): ReadResult {
  if (source[cursor] !== '(') parser.error('IF_TEST', '@if requires a parenthesized expression', base + cursor);
  const test = balanced(source, cursor);
  let end = spaces(source, test.end);
  if (source[end] !== '{') parser.error('IF_BODY', '@if requires a body', base + end);
  const yes = balanced(source, end, 'markup');
  end = yes.end;
  let no: StoryNode[] = [];
  const tail = /^\s*@else\s*/.exec(source.slice(end));
  if (tail) {
    const next = end + tail[0].length;
    if (source.startsWith('if', next)) {
      const result = readDirective('@' + source.slice(next), 0, base + next - 1, parser, inline)!;
      no = result.nodes;
      end = next - 1 + result.end;
    } else {
      if (source[next] !== '{') parser.error('ELSE_BODY', '@else requires a body', base + next);
      const body = balanced(source, next, 'markup');
      no = parser.children(body.content, base + body.start, inline);
      end = body.end;
    }
  }
  return {
    nodes: [
      {
        type: 'if',
        test: parser.expr(test.content, base + test.start),
        yes: parser.children(yes.content, base + yes.start, inline),
        no,
        span: parser.span(base + index, base + end),
      },
    ],
    end,
    block: true,
  };
}

export function readLoop(
  parser: MarkupParser,
  source: string,
  index: number,
  base: number,
  inline: boolean,
  cursor: number,
): ReadResult {
  if (source[cursor] !== '(') parser.error('FOR_TEST', '@each requires (binding of expression)', base + cursor);
  const argument = balanced(source, cursor);
  const pieces = splitTopLevel(argument.content, ';');
  const clause = parseIterationClause(pieces[0], parser.span(base + argument.start, base + argument.end));
  const start = spaces(source, argument.end);
  if (source[start] !== '{') parser.error('FOR_BODY', '@each requires a body', base + start);
  const body = balanced(source, start, 'markup');
  const identifier = clause.binding.type === 'Identifier' ? clause.binding.name.replace(/^_/, '') : undefined;
  if (!identifier)
    parser.error('VIEW_BINDING', 'View loops currently require an identifier binding.', base + argument.start);
  const keySource = pieces[1]?.replace(/^key\s+/, '');
  return {
    nodes: [
      {
        type: 'each',
        name: identifier,
        items: {
          ast: clause.iterable,
          source: pieces[0],
          span: parser.span(base + argument.start, base + argument.end),
        },
        key: keySource
          ? parser.expr(keySource, base + argument.start + argument.content.lastIndexOf(keySource))
          : undefined,
        children: parser.children(body.content, base + body.start, inline),
        span: parser.span(base + index, base + body.end),
      },
    ],
    end: body.end,
    block: true,
  };
}

export function readRegion(
  parser: MarkupParser,
  source: string,
  index: number,
  base: number,
  inline: boolean,
  cursor: number,
): ReadResult {
  const region = /^[A-Za-z_][\w-]*/.exec(source.slice(cursor));
  if (!region) parser.error('REGION_NAME', 'Expected a region name', base + cursor);
  const start = spaces(source, cursor + region[0].length);
  if (source[start] !== '{') parser.error('REGION_BODY', 'A region requires a body', base + start);
  const body = balanced(source, start, 'markup');
  return {
    nodes: [
      {
        type: 'region',
        name: region[0],
        children: parser.children(body.content, base + body.start, inline),
        span: parser.span(base + index, base + body.end),
      },
    ],
    end: body.end,
    block: true,
  };
}
