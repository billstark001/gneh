import { GnehError, type Expression, type Span } from '@gneh/core';
import {
  JSExpressionParser,
  JSLexer,
  parseBindingPattern as parsePureBindingPattern,
  parseExpression as parsePureExpression,
  parseIterationClause as parsePureIterationClause,
  scanBindingPattern as scanPureBindingPattern,
  scanExpression as scanPureExpression,
  type BindingPattern,
  type BindingPatternScanResult,
  type ExpressionScanResult,
  type ExpressionNode,
  type IterationClause,
  type JSLexerRule,
  type JSParserOptions,
} from 'pure-expr/expr';

export interface GnehExpressionOptions {
  writes?: boolean;
}

const parserOptions = (options: GnehExpressionOptions): JSParserOptions => ({
  allowAssignments: options.writes,
  allowMemberWrites: options.writes,
  allowAwait: false,
  allowRegexLiterals: false,
  allowTaggedTemplates: false,
});

function wrap<T>(span: Span | undefined, code: string, read: () => T): T {
  try {
    return read();
  } catch (error) {
    throw new GnehError(code, (error as Error).message, span);
  }
}

function validateBinding(pattern: BindingPattern, span?: Span, allowState = false): void {
  switch (pattern.type) {
    case 'Identifier':
      if (pattern.name.startsWith('$') && !allowState)
        throw new GnehError(
          'BINDING_STATE',
          'Persistent state identifiers cannot be declared as local bindings.',
          span,
        );
      return;
    case 'AssignmentPattern':
      validateBinding(pattern.left, span, allowState);
      return;
    case 'RestElement':
      validateBinding(pattern.argument, span, allowState);
      return;
    case 'ArrayPattern':
      for (const element of pattern.elements) if (element) validateBinding(element, span, allowState);
      return;
    case 'ObjectPattern':
      for (const property of pattern.properties)
        validateBinding(property.type === 'RestElement' ? property.argument : property.value, span, allowState);
  }
}

export function parseExpression(
  source: string,
  span: Span = { file: '<expression>', start: 0, end: source.length },
  options: GnehExpressionOptions = {},
): Expression {
  return {
    ast: wrap(span, 'EXPR_SYNTAX', () => parsePureExpression(source, parserOptions(options))),
    source,
    span,
  };
}

export function parseBindingPattern(source: string, span?: Span): BindingPattern {
  const pattern = wrap(span, 'BINDING_SYNTAX', () => parsePureBindingPattern(source, parserOptions({ writes: true })));
  validateBinding(pattern, span);
  return pattern;
}

/** Parse one formal parameter, including a top-level rest parameter. */
export function parseParameterPattern(source: string, span?: Span): BindingPattern {
  if (!source.trimStart().startsWith('...')) return parseBindingPattern(source, span);
  const list = parseBindingPattern(`[${source}]`, span);
  if (list.type !== 'ArrayPattern' || list.elements.length !== 1 || !list.elements[0])
    throw new GnehError('BINDING_SYNTAX', 'Invalid rest parameter.', span);
  return list.elements[0];
}

/** Scan a binding prefix embedded in a host construct such as `@let pattern = value`. */
export function scanBindingPattern(
  source: string,
  span?: Span,
  boundary: (token: { kind: string; value: string }, depth: number) => boolean = () => false,
  start = 0,
  options: { allowState?: boolean } = {},
): BindingPatternScanResult {
  const result = wrap(span, 'BINDING_SYNTAX', () =>
    scanPureBindingPattern(source, {
      ...parserOptions({ writes: true }),
      start,
      boundary: ({ token, depth }) => boundary(token, depth),
    }),
  );
  validateBinding(result.pattern, span, options.allowState);
  return result;
}

/** Scan one pure expression from a larger host-language buffer. */
export function scanExpression(
  source: string,
  start = 0,
  span: Span = { file: '<expression>', start, end: source.length },
  options: GnehExpressionOptions = {},
): ExpressionScanResult {
  return wrap(span, 'EXPR_SYNTAX', () => scanPureExpression(source, { ...parserOptions(options), start }));
}

export function parseIterationClause(source: string, span?: Span): IterationClause {
  const clause = wrap(span, 'ITERATION_SYNTAX', () =>
    parsePureIterationClause(source, parserOptions({ writes: false })),
  );
  validateBinding(clause.binding, span);
  return clause;
}

const sugarOperators = Object.freeze({
  isnot: '!==',
  is: '===',
  eq: '==',
  neq: '!=',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  and: '&&',
  or: '||',
  not: '!',
  def: 'typeof',
  ndef: 'void',
  to: '=',
});

const sugarRules: readonly JSLexerRule[] = Object.entries(sugarOperators)
  .sort(([left], [right]) => right.length - left.length)
  .map(([word, operator]) => ({
    match(source, position, previous) {
      if (!source.startsWith(word, position)) return false;
      if (/[A-Za-z0-9_$]/.test(source[position - 1] ?? '')) return false;
      if (/[A-Za-z0-9_$]/.test(source[position + word.length] ?? '')) return false;
      if (previous.at(-1)?.value === '.' || previous.at(-1)?.value === '?.') return false;
      return source.slice(position + word.length).trimStart()[0] !== ':';
    },
    advance(_source, position) {
      return {
        kind: word === 'def' || word === 'ndef' ? 'identifier' : 'op',
        value: operator,
        start: position,
        end: position + word.length,
      };
    },
  }));

/** SugarCube-compatible word operators, implemented as lexer rules rather than source rewriting. */
export function parseSugarExpression(
  source: string,
  span: Span = { file: '<sugarcast>', start: 0, end: source.length },
  options: GnehExpressionOptions = {},
): Expression {
  const ast = wrap(span, 'EXPR_SYNTAX', () => {
    const tokens = new JSLexer(source, { rules: sugarRules, numbers: { bigint: false } }).tokenize();
    const unaryOrigins = (operator: string, alias: string) =>
      tokens.flatMap((token, index) =>
        token.kind === 'identifier' &&
        token.value === operator &&
        !['.', '?.'].includes(tokens[index - 1]?.value ?? '') &&
        tokens[index + 1]?.value !== ':'
          ? [source.slice(token.start, token.end) === alias]
          : [],
      );
    const defined = unaryOrigins('typeof', 'def');
    const undefined_ = unaryOrigins('void', 'ndef');
    return lowerSugarDefinitionOperators(
      new JSExpressionParser(tokens, parserOptions(options), source).parse(),
      defined,
      undefined_,
    );
  });
  return { ast, source, span };
}

function lowerSugarDefinitionOperators(ast: ExpressionNode, defined: boolean[], undefined_: boolean[]): ExpressionNode {
  const walk = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(walk);
    if (!item || typeof item !== 'object') return item;
    const node = item as Record<string, unknown> & { type?: string; operator?: string; argument?: ExpressionNode };
    if (node.type === 'UnaryExpression' && (node.operator === 'typeof' || node.operator === 'void')) {
      const twineOperator = (node.operator === 'typeof' ? defined : undefined_).shift();
      const argument = walk(node.argument) as ExpressionNode;
      if (twineOperator)
        return {
          type: 'BinaryExpression',
          operator: node.operator === 'typeof' ? '!==' : '===',
          left: { type: 'UnaryExpression', operator: 'typeof', prefix: true, argument },
          right: { type: 'Literal', value: 'undefined' },
        } satisfies ExpressionNode;
      return { ...node, argument };
    }
    return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, walk(value)]));
  };
  return walk(ast) as ExpressionNode;
}

/** Parse SugarCube's whitespace-or-comma separated macro argument list. */
export function parseSugarArguments(
  source: string,
  span: Span = { file: '<sugarcast>', start: 0, end: source.length },
): Expression[] {
  return wrap(span, 'EXPR_SYNTAX', () => {
    const tokens = new JSLexer(source, { rules: sugarRules, numbers: { bigint: false } }).tokenize();
    const expressions: Expression[] = [];
    let tokenIndex = 0;
    while (tokenIndex < tokens.length) {
      const parsed = new JSExpressionParser(tokens.slice(tokenIndex), parserOptions({}), source).parsePrefix('error');
      const nodes =
        parsed.expression.type === 'SequenceExpression' ? parsed.expression.expressions : [parsed.expression];
      for (const ast of nodes)
        expressions.push({ ast, source: source.slice(tokens[tokenIndex].start, parsed.end), span });
      if (!parsed.nextToken) break;
      const next = tokens.indexOf(parsed.nextToken);
      if (next <= tokenIndex) throw new Error('Sugarcast argument scanner made no progress.');
      tokenIndex = next;
    }
    return expressions;
  });
}

export function expressionEffect(expression: ExpressionNode): import('@gneh/core').EffectNode {
  return { type: 'expression', expression };
}
