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

function validateBinding(pattern: BindingPattern, span?: Span): void {
  switch (pattern.type) {
    case 'Identifier':
      if (pattern.name.startsWith('$'))
        throw new GnehError(
          'BINDING_STATE',
          'Persistent state identifiers cannot be declared as local bindings.',
          span,
        );
      return;
    case 'AssignmentPattern':
      validateBinding(pattern.left, span);
      return;
    case 'RestElement':
      validateBinding(pattern.argument, span);
      return;
    case 'ArrayPattern':
      for (const element of pattern.elements) if (element) validateBinding(element, span);
      return;
    case 'ObjectPattern':
      for (const property of pattern.properties)
        validateBinding(property.type === 'RestElement' ? property.argument : property.value, span);
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

/** Scan a binding prefix embedded in a host construct such as `@let pattern = value`. */
export function scanBindingPattern(
  source: string,
  span?: Span,
  boundary: (token: { kind: string; value: string }, depth: number) => boolean = () => false,
  start = 0,
): BindingPatternScanResult {
  const result = wrap(span, 'BINDING_SYNTAX', () =>
    scanPureBindingPattern(source, {
      ...parserOptions({ writes: true }),
      start,
      boundary: ({ token, depth }) => boundary(token, depth),
    }),
  );
  validateBinding(result.pattern, span);
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
  eq: '===',
  neq: '!==',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  and: '&&',
  or: '||',
  not: '!',
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
      return { kind: 'op', value: operator, start: position, end: position + word.length };
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
    return new JSExpressionParser(tokens, parserOptions(options), source).parse();
  });
  return { ast, source, span };
}

export function expressionEffect(expression: ExpressionNode): import('@gneh/core').EffectNode {
  return { type: 'expression', expression };
}
