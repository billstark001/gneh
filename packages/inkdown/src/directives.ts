import type { ImportIR, StoryNode } from '@gneh/core';
import { parseBindingPattern, type BindingPattern, type ExpressionNode } from '@gneh/expression';
import {
  balanced,
  MacroLoweringRegistry,
  splitTopLevel,
  type MarkupParser,
  type ReadResult,
  type SpecialReader,
} from '@gneh/syntax';
import { parseEffects } from './effects.js';
import { readConditional, readLoop, readRegion } from './structural.js';

export interface InkdownMacroToken {
  name: string;
  start: number;
  headEnd: number;
  argsStart: number;
}

export type InkdownLowerings = MacroLoweringRegistry<InkdownMacroToken>;

const spaces = (source: string, start: number) => {
  let index = start;
  while (/\s/.test(source[index] ?? '')) index++;
  return index;
};

function argumentsAt(
  source: string,
  start: number,
  parser: MarkupParser,
  base: number,
): {
  args: ExpressionNode[];
  end: number;
} {
  if (source[start] !== '(') return { args: [], end: start };
  const group = balanced(source, start);
  return {
    args: group.content.trim()
      ? splitTopLevel(group.content).map(
          (argument) => parser.expr(argument, base + group.start + group.content.indexOf(argument)).ast,
        )
      : [],
    end: group.end,
  };
}

function paramsAt(
  source: string,
  start: number,
  parser: MarkupParser,
  base: number,
): {
  params: BindingPattern[];
  end: number;
} {
  if (source[start] !== '(') return { params: [], end: start };
  const group = balanced(source, start);
  return {
    params: group.content.trim()
      ? splitTopLevel(group.content).map((parameter) =>
          parseBindingPattern(parameter, parser.span(base + group.start, base + group.end)),
        )
      : [],
    end: group.end,
  };
}

function topLevelEquals(source: string): number {
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

function declarationPosition(parser: MarkupParser, token: InkdownMacroToken, base: number, inline: boolean): void {
  if (parser.nesting > 1 || inline)
    parser.error('DECLARATION_POSITION', `@${token.name} is a top-level declaration.`, base + token.start);
}

const reservedBindings = new Set([
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'let',
  'new',
  'null',
  'return',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
]);

const isHostBindingName = (name: string) => /^[A-Za-z][\w$]*$/.test(name) && !reservedBindings.has(name);

function parseImport(text: string, parser: MarkupParser, start: number): ImportIR[] {
  const match = /^\{([\s\S]*)\}\s+from\s+(["'])([^"']+)\2\s*$/.exec(text);
  if (!match) parser.error('IMPORT_SYNTAX', 'Use @import { name as local } from "module".', start);
  return splitTopLevel(match[1]).map((specifier) => {
    const names = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(specifier.trim());
    if (!names) parser.error('IMPORT_SYNTAX', `Invalid import specifier: ${specifier}`, start);
    const local = names[2] ?? names[1];
    if (!isHostBindingName(local)) parser.error('IMPORT_BINDING', `Invalid local import name: ${local}`, start);
    return { source: match[3], imported: names[1], local };
  });
}

function readLine(source: string, start: number): { text: string; end: number } {
  const newline = source.indexOf('\n', start);
  const end = newline < 0 ? source.length : newline;
  return { text: source.slice(start, end).trim().replace(/;$/, ''), end };
}

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
  const token = {
    name: head[1],
    start: index,
    headEnd: index + head[0].length,
    argsStart: spaces(source, index + head[0].length),
  };
  const registered = registry.lower(token.name, { source, index, base, parser, inline, node: token });
  if (registered) return registered;
  let cursor = token.argsStart;
  const args = argumentsAt(source, cursor, parser, base);
  cursor = spaces(source, args.end);
  let children: StoryNode[] = [];
  let hasBody = false;
  if (source[cursor] === '{') {
    hasBody = true;
    const body = balanced(source, cursor, 'markup');
    children = parser.children(body.content, base + body.start, inline);
    cursor = body.end;
  }
  return {
    nodes: [
      {
        type: 'view-call',
        name: token.name,
        args: args.args.map((ast) => ({ ast, source: '', span: parser.span(base + index, base + cursor) })),
        children,
        span: parser.span(base + index, base + cursor),
      },
    ],
    end: cursor,
    block: hasBody,
  };
}

export function createInkdownLowerings(): InkdownLowerings {
  const registry = new MacroLoweringRegistry<InkdownMacroToken>();
  registry.register(['module', 'script'], ({ node: token, parser, base }) =>
    parser.error(
      'REMOVED_DIRECTIVE',
      `@${token.name} is not an Inkdown construct. Put JavaScript in an ESM file and use @import.`,
      base + token.start,
      base + token.headEnd,
    ),
  );
  registry.register(['enter', 'action', 'view'], ({ node: token, parser, source, base, inline }) => {
    declarationPosition(parser, token, base, inline);
    let cursor = token.argsStart;
    let name = '';
    let params: BindingPattern[] = [];
    if (token.name !== 'enter') {
      const identifier = /^[A-Za-z_][\w-]*/.exec(source.slice(cursor));
      if (!identifier) parser.error('DECLARATION_NAME', `@${token.name} requires a name.`, base + cursor);
      name = identifier![0];
      cursor = spaces(source, cursor + name.length);
      const parsed = paramsAt(source, cursor, parser, base);
      params = parsed.params;
      cursor = spaces(source, parsed.end);
    }
    if (source[cursor] !== '{') parser.error('DECLARATION_BODY', `@${token.name} requires a body.`, base + cursor);
    const body = balanced(source, cursor, token.name === 'view' ? 'markup' : 'js');
    const span = parser.span(base + token.start, base + body.end);
    if (token.name === 'enter') parser.addEnter(parseEffects(body.content, base + body.start, parser));
    else if (token.name === 'action')
      parser.addAction(parseEffects(body.content, base + body.start, parser), body.content, span, name, params);
    else parser.addView(name, params, parser.children(body.content, base + body.start, false), body.content, span);
    return { nodes: [], end: body.end, block: true };
  });
  registry.register(['import', 'export', 'const'], ({ node: token, parser, source, base, inline }) => {
    declarationPosition(parser, token, base, inline);
    const line = readLine(source, token.argsStart);
    if (token.name === 'import') parser.imports.push(...parseImport(line.text, parser, base + token.argsStart));
    else if (token.name === 'export') {
      const match = /^\{([\s\S]*)\}$/.exec(line.text);
      if (!match) parser.error('EXPORT_SYNTAX', 'Use @export { name, otherName }.', base + token.argsStart);
      const names = splitTopLevel(match![1]).map((name) => name.trim());
      if (names.some((name) => !isHostBindingName(name)))
        parser.error('EXPORT_BINDING', 'Export names must be local ESM binding names.', base + token.argsStart);
      parser.exports.push(...names);
    } else {
      const equals = topLevelEquals(line.text);
      const name = line.text.slice(0, equals).trim();
      if (equals < 0 || !isHostBindingName(name))
        parser.error('CONST_SYNTAX', 'Use @const name = expression.', base + token.argsStart);
      parser.constants[name] = parser.expr(line.text.slice(equals + 1).trim(), base + token.argsStart + equals + 1);
    }
    return { nodes: [], end: line.end, block: true };
  });
  registry.register('effect', ({ node: token, parser, source, base, inline }) => {
    parser.evaluation = 'materialized';
    let cursor = token.argsStart;
    if (source[cursor] !== '{') parser.error('EFFECT_BODY', '@effect requires a body.', base + cursor);
    const body = balanced(source, cursor, 'js');
    return {
      nodes: [
        {
          type: 'effect',
          effects: parseEffects(body.content, base + body.start, parser),
          span: parser.span(base + token.start, base + body.end),
        },
      ],
      end: body.end,
      block: !inline,
    };
  });
  registry.register('children', ({ node: token, parser, base }) => ({
    nodes: [{ type: 'children', span: parser.span(base + token.start, base + token.headEnd) }],
    end: token.headEnd,
  }));
  registry.register('if', ({ node: token, parser, source, base, inline, lowerings }) =>
    readConditional(
      parser,
      source,
      token.start,
      base,
      inline,
      token.argsStart,
      createInkdownDirectiveReader(lowerings),
    ),
  );
  registry.register('each', ({ node: token, parser, source, base, inline }) =>
    readLoop(parser, source, token.start, base, inline, token.argsStart),
  );
  registry.register('region', ({ node: token, parser, source, base, inline }) =>
    readRegion(parser, source, token.start, base, inline, token.argsStart),
  );
  return registry;
}

export function createInkdownDirectiveReader(registry: InkdownLowerings = createInkdownLowerings()): SpecialReader {
  return (source, index, base, parser, inline) =>
    readInkdownDirectiveWith(registry, source, index, base, parser, inline);
}

export const readInkdownDirective: SpecialReader = createInkdownDirectiveReader();
