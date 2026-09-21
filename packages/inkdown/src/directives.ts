import type { StoryNode } from '@gneh/core';
import { type BindingPattern, type ExpressionNode } from '@gneh/expression';
import {
  balanced,
  MacroLoweringRegistry,
  splitTopLevel,
  type MarkupParser,
  type ReadResult,
  type SpecialReader,
} from '@gneh/syntax';
import { parseEffects } from './effects.js';
import { balancedMarkup } from './delimiters.js';
import { paramsAt } from './directive-utils.js';
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
    const body = balancedMarkup(source, cursor);
    children = parser.children(body.content, base + body.start, inline);
    cursor = body.end;
  }
  return {
    nodes: [
      {
        type: 'call',
        call: {
          callee: { type: 'binding', name: token.name },
          args: args.args.map((ast) => ({ ast, source: '', span: parser.span(base + index, base + cursor) })),
        },
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
      `@${token.name} is not an Inkdown construct. Put JavaScript in an ESM file and link it from file YAML.`,
      base + token.start,
      base + token.headEnd,
    ),
  );
  registry.register(['action', 'view'], ({ node: token, parser, source, base, inline }) => {
    if (inline) parser.error('DECLARATION_POSITION', `@${token.name} is a block declaration.`, base + token.start);
    let cursor = token.argsStart;
    let name = '';
    let params: BindingPattern[] = [];
    {
      const identifier = /^[A-Za-z_][\w-]*/.exec(source.slice(cursor));
      if (identifier) {
        name = identifier[0];
        cursor = spaces(source, cursor + name.length);
      } else if (token.name === 'action') parser.error('DECLARATION_NAME', '@action requires a name.', base + cursor);
      else if (source[cursor] === '(' && parser.nesting === 1 && parser.contextName) name = parser.contextName;
      else parser.error('DECLARATION_NAME', '@view requires a name in this container.', base + cursor);
      const parsed = paramsAt(source, cursor, parser, base);
      params = parsed.params;
      cursor = spaces(source, parsed.end);
    }
    const bounded = source[cursor] === '{';
    const body = bounded
      ? token.name === 'view'
        ? balancedMarkup(source, cursor)
        : balanced(source, cursor)
      : {
          content: source.slice(source[cursor] === '\n' ? cursor + 1 : cursor),
          start: source[cursor] === '\n' ? cursor + 1 : cursor,
          end: source.length,
        };
    const span = parser.span(base + token.start, base + body.end);
    const callable =
      token.name === 'action'
        ? parser.callable(
            'effect',
            name,
            params,
            parseEffects(body.content, base + body.start, parser),
            body.content,
            span,
          )
        : parser.addView(name, params, parser.children(body.content, base + body.start, false), body.content, span);
    if (!bounded) callable.escape = parser.initializer ? 'export' : 'publish';
    return { nodes: [{ type: 'callable', callable, span }], end: body.end, block: true };
  });
  registry.register(['import', 'export', 'enter'], ({ node: token, parser, base }) =>
    parser.error(
      'REMOVED_DIRECTIVE',
      token.name === 'enter'
        ? '@enter was removed; use source-order @do, @let, or @const statements.'
        : `@${token.name} was removed; declare ESM linkage in the file YAML block.`,
      base + token.start,
      base + token.headEnd,
    ),
  );
  registry.register(['let', 'const', 'do'], ({ node: token, parser, source, base, inline }) => {
    if (inline) parser.error('DECLARATION_POSITION', `@${token.name} is a block statement.`, base + token.start);
    const line = readLine(source, token.argsStart);
    const statement = `@${token.name} ${line.text};`;
    return {
      nodes: [
        {
          type: 'effect',
          effects: parseEffects(statement, base + token.start, parser),
          span: parser.span(base + token.start, base + line.end),
        },
      ],
      end: line.end,
      block: true,
    };
  });
  registry.register('publish', ({ node: token, parser, source, base, inline }) => {
    if (inline) parser.error('DECLARATION_POSITION', '@publish is a block statement.', base + token.start);
    if (parser.initializer) parser.error('PRIMARY_PUBLISH', '@publish requires a Story.', base + token.start);
    const line = readLine(source, token.argsStart);
    const names =
      line.text === '*'
        ? '*'
        : (() => {
            const match = /^\{([\s\S]*)\}$/.exec(line.text);
            if (!match) parser.error('PUBLISH_SYNTAX', 'Use @publish { name } or @publish *.', base + token.argsStart);
            const values = splitTopLevel(match![1]).map((name) => name.trim());
            if (values.some((name) => !isHostBindingName(name)))
              parser.error('PUBLISH_BINDING', 'Published names must be lexical binding names.', base + token.argsStart);
            return values;
          })();
    return {
      nodes: [{ type: 'publish', names, span: parser.span(base + token.start, base + line.end) }],
      end: line.end,
      block: true,
    };
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
