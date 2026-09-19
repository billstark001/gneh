import { parse, tokenizer } from 'acorn';
import {
  JSExpressionParser,
  JSLexer,
  type ExpressionNode,
  type JSLexerRule,
  type JSParserOptions,
} from 'pure-expr/expr';
import { GnehError, type Expression, type Span, type Statement } from '@gneh/core';

const wordOperators = Object.freeze({
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

const operatorRules: readonly JSLexerRule[] = Object.entries(wordOperators)
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

export interface GnehExpressionOptions {
  writes?: boolean;
}

const structuralOperators: Readonly<Record<string, string>> = Object.freeze({
  isnot: '!==  ',
  is: '==',
  eq: '==',
  neq: '!= ',
  gt: '> ',
  gte: '>= ',
  lt: '< ',
  lte: '<= ',
  and: '&& ',
  or: '||',
  not: '!  ',
  to: '= ',
});

/** Give Acorn valid, offset-preserving operators while it discovers statement structure. */
function structuralSource(source: string): string {
  const replacements: { start: number; end: number; value: string }[] = [];
  const tokens = tokenizer(source, { ecmaVersion: 'latest', sourceType: 'module' });
  let previous = '';
  while (true) {
    const token = tokens.getToken();
    if (token.type.label === 'eof') break;
    const word = source.slice(token.start, token.end);
    const value = structuralOperators[word];
    if (value && previous !== '.' && previous !== '?.' && source.slice(token.end).trimStart()[0] !== ':')
      replacements.push({ start: token.start, end: token.end, value });
    previous = token.type.label;
  }
  if (!replacements.length) return source;
  const output = [...source];
  for (const replacement of replacements)
    output.splice(replacement.start, replacement.end - replacement.start, ...replacement.value);
  return output.join('');
}

function parseAst(source: string, options: GnehExpressionOptions = {}): ExpressionNode {
  const tokens = new JSLexer(source, {
    rules: operatorRules,
    numbers: { bigint: false },
  }).tokenize();
  const parserOptions: JSParserOptions = {
    allowAssignments: options.writes,
    allowMemberWrites: options.writes,
    allowAwait: false,
    allowRegexLiterals: false,
    allowTaggedTemplates: false,
  };
  return new JSExpressionParser(tokens, parserOptions, source).parse();
}

export function parseExpression(
  source: string,
  span: Span = { file: '<expression>', start: 0, end: source.length },
  options: GnehExpressionOptions = {},
): Expression {
  try {
    return { ast: parseAst(source, options), source, span };
  } catch (error) {
    throw new GnehError('EXPR_SYNTAX', (error as Error).message, span);
  }
}

// Acorn remains responsible only for statement and ESM structure. Every embedded
// expression is reparsed by pure-expr so all dialects share one expression grammar.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ESTree = any;

function statementSource(source: string, node: ESTree): string {
  return source.slice(node.start, node.end);
}

function expressionFrom(source: string, node: ESTree, span?: Span): ExpressionNode {
  const text = statementSource(source, node);
  const start = (span?.start ?? 0) + node.start;
  return parseExpression(text, span ? { ...span, start, end: start + text.length } : undefined, { writes: true }).ast;
}

function lowerStatement(source: string, node: ESTree, span?: Span): Statement[] {
  switch (node.type) {
    case 'EmptyStatement':
      return [];
    case 'BlockStatement':
      return node.body.flatMap((value: ESTree) => lowerStatement(source, value, span));
    case 'VariableDeclaration':
      return node.declarations.map((declaration: ESTree) => {
        if (declaration.id.type !== 'Identifier' || declaration.id.name.startsWith('$'))
          throw new GnehError('ACTION_UNSUPPORTED', 'Action declarations require a plain identifier.', span);
        return {
          type: 'declare' as const,
          name: declaration.id.name.replace(/^_/, ''),
          value: declaration.init
            ? expressionFrom(source, declaration.init, span)
            : parseExpression('undefined', span).ast,
        };
      });
    case 'ExpressionStatement':
      return [{ type: 'expression', expression: expressionFrom(source, node.expression, span) }];
    case 'IfStatement':
      return [
        {
          type: 'if',
          test: expressionFrom(source, node.test, span),
          yes: lowerStatement(source, node.consequent, span),
          no: node.alternate ? lowerStatement(source, node.alternate, span) : [],
        },
      ];
    case 'ForOfStatement': {
      const variable = node.left.type === 'VariableDeclaration' ? node.left.declarations[0]?.id : node.left;
      if (node.await || variable?.type !== 'Identifier' || variable.name.startsWith('$'))
        throw new GnehError('ACTION_UNSUPPORTED', 'Action loops require a plain local identifier.', span);
      return [
        {
          type: 'each',
          name: variable.name.replace(/^_/, ''),
          items: expressionFrom(source, node.right, span),
          body: lowerStatement(source, node.body, span),
        },
      ];
    }
    default:
      throw new GnehError('ACTION_UNSUPPORTED', `Unsupported action statement: ${node.type}`, span);
  }
}

export function parseStatements(source: string, span?: Span): Statement[] {
  try {
    try {
      return [{ type: 'expression', expression: parseAst(source, { writes: true }) }];
    } catch {
      // A complete action block needs the restricted statement grammar below.
    }
    const program = parse(structuralSource(source), { ecmaVersion: 'latest', sourceType: 'module' }) as ESTree;
    return program.body.flatMap((node: ESTree) => lowerStatement(source, node, span));
  } catch (error) {
    throw new GnehError(error instanceof GnehError ? error.code : 'ACTION_SYNTAX', (error as Error).message, span);
  }
}

export function parseModule(source: string): {
  imports: string[];
  exports: string[];
  bindings: string[];
  functions: string[];
} {
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }) as ESTree;
  const imports: string[] = [],
    exports: string[] = [],
    bindings = new Set<string>(),
    functions: string[] = [];
  const pattern = (node: ESTree): string[] =>
    !node
      ? []
      : node.type === 'Identifier'
        ? [node.name]
        : node.type === 'RestElement'
          ? pattern(node.argument)
          : node.type === 'AssignmentPattern'
            ? pattern(node.left)
            : node.type === 'ArrayPattern'
              ? node.elements.flatMap(pattern)
              : node.type === 'ObjectPattern'
                ? node.properties.flatMap((property: ESTree) => pattern(property.value ?? property.argument))
                : [];
  const declaration = (node: ESTree): string[] =>
    node?.type === 'VariableDeclaration'
      ? node.declarations.flatMap((value: ESTree) => pattern(value.id))
      : node?.id
        ? [node.id.name]
        : [];
  for (const node of ast.body) {
    if (node.type === 'ImportDeclaration') {
      const names = node.specifiers.map((specifier: ESTree) => specifier.local.name);
      imports.push(...names);
      names.forEach((name: string) => bindings.add(name));
    }
    if (node.type === 'ExportDefaultDeclaration')
      throw new GnehError('MODULE_DEFAULT', 'The document body owns the default export. Use named exports in @module.');
    const declared = node.type === 'ExportNamedDeclaration' ? node.declaration : node;
    for (const name of declaration(declared)) bindings.add(name);
    if (node.type === 'ExportNamedDeclaration') {
      exports.push(
        ...declaration(declared),
        ...node.specifiers.map((specifier: ESTree) => specifier.exported.name ?? specifier.exported.value),
      );
      if (declared?.type === 'FunctionDeclaration') functions.push(declared.id.name);
    }
  }
  return { imports, exports, bindings: [...bindings], functions };
}
