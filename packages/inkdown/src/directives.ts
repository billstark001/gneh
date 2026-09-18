import type { StoryNode } from '@gneh/core';
import { parseModule, parseStatements } from '@gneh/expression';
import {
  balanced,
  MacroLoweringRegistry,
  splitTopLevel,
  type MarkupParser,
  type ReadResult,
  type SpecialReader,
} from '@gneh/syntax';

export interface InkdownMacroToken {
  name: string;
  start: number;
  headEnd: number;
  argsStart: number;
}

export type InkdownLowerings = MacroLoweringRegistry<InkdownMacroToken>;

/**
 * Parse Inkdown's semantic directives.
 *
 * The shared syntax package deliberately knows nothing about these directives.
 * Karlowe and Sugarcast may explicitly compose this reader when they want to
 * expose gneh-native escape hatches alongside their compatibility syntax.
 */
function readInkdownDirectiveWith(
  registry: InkdownLowerings,
  source: string,
  index: number,
  base: number,
  parser: MarkupParser,
  inline: boolean,
): ReadResult | undefined {
  if (source[index] !== '@') return;
  const head = /^@([A-Za-z_][\w-]*)\b/.exec(source.slice(index));
  if (!head) return;
  const name = head[1];
  let i = index + head[0].length;
  while (/\s/.test(source[i] ?? '') && i < source.length) i++;
  const token = { name, start: index, headEnd: index + head[0].length, argsStart: i };
  const registered = registry.lower(name, { source, index, base, parser, inline, node: token });
  if (registered) return registered;
  if (source[i] === '(') {
    const args = balanced(source, i);
    return {
      nodes: [
        {
          type: 'include',
          target: name,
          props: args.content.trim() ? parser.expr(args.content, base + args.start) : undefined,
          span: parser.span(base + index, base + args.end),
        },
      ],
      end: args.end,
      block: true,
    };
  }
}

export function createInkdownLowerings(): InkdownLowerings {
  const registry = new MacroLoweringRegistry<InkdownMacroToken>();
  registry.register(['module', 'enter', 'action'], ({ node: token, parser, source, base, inline }) => {
    assertDeclarationPosition(parser, token.start, base, inline, token.name);
    const blockStart = findDeclarationBlock(parser, source, token.argsStart, token.name, base);
    const block = balanced(source, blockStart, 'js');
    applyDeclaration(parser, token.name, source, token.start, base, blockStart, block);
    return { nodes: [], end: block.end, block: true };
  });
  registry.register('if', ({ node: token, parser, source, base, inline, lowerings: owner }) =>
    readConditional(parser, source, token.start, base, inline, token.argsStart, owner),
  );
  registry.register(['for', 'each'], ({ node: token, parser, source, base, inline }) =>
    readLoop(parser, source, token.start, base, inline, token.argsStart),
  );
  registry.register(['slot', 'region'], ({ node: token, parser, source, base, inline }) =>
    readRegion(parser, source, token.start, base, inline, token.argsStart),
  );
  return registry;
}

export function createInkdownDirectiveReader(registry: InkdownLowerings = createInkdownLowerings()): SpecialReader {
  return (source, index, base, parser, inline) =>
    readInkdownDirectiveWith(registry, source, index, base, parser, inline);
}

export const readInkdownDirective: SpecialReader = createInkdownDirectiveReader();

function assertDeclarationPosition(
  parser: MarkupParser,
  index: number,
  base: number,
  inline: boolean,
  name: string,
): void {
  if (parser.nesting > 1)
    parser.error(
      'DECLARATION_NESTED',
      `@${name} is a module/instance declaration, not a conditional render effect.`,
      base + index,
    );
  if (inline) parser.error('DECLARATION_INLINE', `@${name} must start a block.`, base + index);
}

function findDeclarationBlock(
  parser: MarkupParser,
  source: string,
  cursor: number,
  name: string,
  base: number,
): number {
  let i = cursor;
  if (name === 'action') {
    const actionName = /^[\w-]+/.exec(source.slice(i));
    if (!actionName) parser.error('ACTION_NAME', 'Expected action name', base + i);
    i += actionName[0].length;
    while (/\s/.test(source[i] ?? '') && i < source.length) i++;
  }
  if (source[i] !== '{') parser.error('DIRECTIVE_BLOCK', `@${name} requires { ... }`, base + i);
  return i;
}

function applyDeclaration(
  parser: MarkupParser,
  name: string,
  source: string,
  index: number,
  base: number,
  blockStart: number,
  block: ReturnType<typeof balanced>,
): void {
  if (name === 'module') {
    if (parser.module)
      parser.error('MODULE_DUPLICATE', 'Only one @module block is permitted per passage.', base + index);
    const info = parseModule(block.content);
    parser.module = block.content;
    parser.imports = info.bindings;
    return;
  }
  const span = parser.span(base + block.start, base + block.end - 1);
  if (name === 'enter') {
    parser.addEnter(parseStatements(block.content, span));
    return;
  }
  const declaration = source.slice(index, blockStart);
  const actionName = /^@action\s+([\w-]+)/.exec(declaration)?.[1];
  parser.addAction(parseStatements(block.content, span), block.content, span, actionName);
}

function readConditional(
  parser: MarkupParser,
  source: string,
  index: number,
  base: number,
  inline: boolean,
  cursor: number,
  registry: InkdownLowerings,
): ReadResult {
  if (source[cursor] !== '(') parser.error('IF_TEST', '@if requires a parenthesized expression', base + cursor);
  const test = balanced(source, cursor);
  let i = test.end;
  while (/\s/.test(source[i] ?? '') && i < source.length) i++;
  if (source[i] !== '{') parser.error('IF_BODY', '@if requires a { ... } body', base + i);
  const yes = balanced(source, i, 'markup');
  i = yes.end;
  let no: StoryNode[] = [];
  const tail = /^\s*@else\s*/.exec(source.slice(i));
  if (tail) {
    const next = i + tail[0].length;
    if (source.startsWith('if', next)) {
      const rest = '@' + source.slice(next);
      const result = readInkdownDirectiveWith(registry, rest, 0, base + next - 1, parser, inline)!;
      no = result.nodes;
      i = next - 1 + result.end;
    } else {
      if (source[next] !== '{') parser.error('ELSE_BODY', '@else requires a body', base + next);
      const body = balanced(source, next, 'markup');
      no = parser.children(body.content, base + body.start, inline);
      i = body.end;
    }
  }
  return {
    nodes: [
      {
        type: 'if',
        test: parser.expr(test.content, base + test.start),
        yes: parser.children(yes.content, base + yes.start, inline),
        no,
        span: parser.span(base + index, base + i),
      },
    ],
    end: i,
    block: true,
  };
}

function readLoop(
  parser: MarkupParser,
  source: string,
  index: number,
  base: number,
  inline: boolean,
  cursor: number,
): ReadResult {
  if (source[cursor] !== '(')
    parser.error('FOR_TEST', '@for requires (const item of expression; key expression)', base + cursor);
  const argument = balanced(source, cursor);
  const pieces = splitTopLevel(argument.content, ';');
  const match = /^(?:const\s+|let\s+)?([A-Za-z_]\w*)\s+of\s+([\s\S]+)$/.exec(pieces[0]);
  if (!match) parser.error('FOR_SYNTAX', 'Expected const item of expression', base + argument.start);
  let i = argument.end;
  while (/\s/.test(source[i] ?? '') && i < source.length) i++;
  if (source[i] !== '{') parser.error('FOR_BODY', '@for requires a body', base + i);
  const body = balanced(source, i, 'markup');
  const itemSource = match[2];
  const keySource = pieces[1]?.replace(/^key\s+/, '');
  return {
    nodes: [
      {
        type: 'each',
        name: match[1].replace(/^_/, ''),
        items: parser.expr(itemSource, base + argument.start + argument.content.indexOf(itemSource)),
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

function readRegion(
  parser: MarkupParser,
  source: string,
  index: number,
  base: number,
  inline: boolean,
  cursor: number,
): ReadResult {
  const regionName = /^[A-Za-z_][\w-]*/.exec(source.slice(cursor));
  if (!regionName) parser.error('REGION_NAME', 'Expected a region name', base + cursor);
  let i = cursor + regionName[0].length;
  while (/\s/.test(source[i] ?? '') && i < source.length) i++;
  if (source[i] !== '{') parser.error('REGION_BODY', 'A region requires a default body', base + i);
  const body = balanced(source, i, 'markup');
  return {
    nodes: [
      {
        type: 'region',
        name: regionName[0],
        children: parser.children(body.content, base + body.start, inline),
        span: parser.span(base + index, base + body.end),
      },
    ],
    end: body.end,
    block: true,
  };
}
