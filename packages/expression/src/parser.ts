import { parse, parseExpressionAt } from 'acorn';
import {
  GnehError,
  intrinsicByName,
  safeKey,
  type AssignmentOp,
  type BinaryOp,
  type Expr,
  type Expression,
  type Span,
  type Statement,
} from '@gneh/core';

// The untrusted ESTree adapter is intentionally the only loose boundary; the public IR is closed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ESTree = any;

const binaryOps = new Set<BinaryOp>([
  '+',
  '-',
  '*',
  '/',
  '%',
  '**',
  '===',
  '!==',
  '==',
  '!=',
  '<',
  '<=',
  '>',
  '>=',
  '&&',
  '||',
  '??',
]);

function unsupported(node: ESTree): never {
  throw new GnehError('EXPR_UNSUPPORTED', `Unsupported portable expression: ${node.type}`);
}

function reference(name: string, origin?: Span): Expr {
  if (name === 'state') return { type: 'reference', namespace: 'state', name: '*', origin };
  safeKey(name.replace(/^[$_]/, ''));
  if (name.startsWith('$')) return { type: 'reference', namespace: 'state', name: name.slice(1), origin };
  if (name.startsWith('_')) return { type: 'reference', namespace: 'temporary', name: name.slice(1), origin };
  if (name === 'props') return { type: 'reference', namespace: 'props', name, origin };
  const intrinsic = intrinsicByName(name);
  if (intrinsic) return { type: 'reference', namespace: 'intrinsic', name: intrinsic.id, origin };
  return { type: 'reference', namespace: 'lexical', name, origin };
}

export function fromESTree(node: ESTree, sourceSpan?: Span, sourceStart = sourceSpan?.start ?? 0): Expr {
  const origin =
    sourceSpan && typeof node.start === 'number' && typeof node.end === 'number'
      ? { ...sourceSpan, start: sourceStart + node.start, end: sourceStart + node.end }
      : undefined;
  const child = (value: ESTree) => fromESTree(value, sourceSpan, sourceStart);
  switch (node.type) {
    case 'Literal':
      if (node.regex || node.bigint) unsupported(node);
      return { type: 'literal', value: node.value, origin };
    case 'Identifier':
      return reference(node.name, origin);
    case 'ArrayExpression':
      return {
        type: 'array',
        items: node.elements.map((n: ESTree) => (n ? child(n) : { type: 'literal', value: null })),
        origin,
      };
    case 'ObjectExpression':
      return {
        type: 'object',
        entries: node.properties.map((p: ESTree) => {
          if (p.type !== 'Property' || p.kind !== 'init' || p.method || (p.computed && p.key.type !== 'Literal'))
            unsupported(p);
          return [safeKey(p.key.name ?? p.key.value), child(p.value)];
        }),
        origin,
      };
    case 'UnaryExpression':
      if (!['!', '+', '-', 'typeof'].includes(node.operator)) unsupported(node);
      return { type: 'unary', op: node.operator, value: child(node.argument), origin };
    case 'BinaryExpression':
    case 'LogicalExpression':
      if (!binaryOps.has(node.operator)) unsupported(node);
      return {
        type: 'binary',
        op: node.operator as BinaryOp,
        left: child(node.left),
        right: child(node.right),
        origin,
      };
    case 'ConditionalExpression':
      return {
        type: 'conditional',
        test: child(node.test),
        yes: child(node.consequent),
        no: child(node.alternate),
        origin,
      };
    case 'MemberExpression':
      return {
        type: 'get',
        object: child(node.object),
        key: node.computed ? child(node.property) : { type: 'literal', value: safeKey(node.property.name) },
        optional: !!node.optional,
        origin,
      };
    case 'CallExpression':
      return {
        type: 'call',
        callee: child(node.callee),
        args: node.arguments.map(child),
        optional: !!node.optional,
        origin,
      };
    case 'ChainExpression':
      return { type: 'chain', value: child(node.expression), origin };
    case 'ParenthesizedExpression':
      return child(node.expression);
    case 'ArrowFunctionExpression':
      if (
        node.async ||
        node.body.type === 'BlockStatement' ||
        node.params.some((p: ESTree) => p.type !== 'Identifier' || p.name.startsWith('$'))
      )
        unsupported(node);
      return {
        type: 'arrow',
        params: node.params.map((p: ESTree) => safeKey(p.name)),
        body: child(node.body),
        origin,
      };
    case 'TemplateLiteral':
      return {
        type: 'template',
        parts: node.quasis.flatMap((q: ESTree, i: number) =>
          i < node.expressions.length ? [q.value.cooked, child(node.expressions[i])] : [q.value.cooked],
        ),
        origin,
      };
    default:
      return unsupported(node);
  }
}

export function parseExpression(
  source: string,
  span: Span = { file: '<expression>', start: 0, end: source.length },
): Expression {
  try {
    const ast = parseExpressionAt(source, 0, {
      ecmaVersion: 'latest',
      preserveParens: true,
    }) as ESTree;
    if (
      source
        .slice(ast.end)
        .replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')
        .trim()
    )
      throw new GnehError('EXPR_TRAILING', 'Unexpected text after expression.');
    return { ast: fromESTree(ast, span, span.start), source, span };
  } catch (error) {
    if (error instanceof GnehError) throw new GnehError(error.code, error.message, span);
    throw new GnehError('EXPR_SYNTAX', (error as Error).message, span);
  }
}

function statement(node: ESTree, span?: Span): Statement[] {
  const expression = (value: ESTree) => fromESTree(value, span, span?.start ?? 0);
  switch (node.type) {
    case 'EmptyStatement':
      return [];
    case 'BlockStatement':
      return node.body.flatMap((value: ESTree) => statement(value, span));
    case 'VariableDeclaration':
      return node.declarations.map((d: ESTree) => {
        if (d.id.type !== 'Identifier' || d.id.name.startsWith('$')) unsupported(d);
        return {
          type: 'declare',
          name: safeKey(d.id.name.replace(/^_/, '')),
          value: d.init ? expression(d.init) : { type: 'literal', value: null },
        };
      });
    case 'ExpressionStatement': {
      const e = node.expression;
      if (e.type === 'AssignmentExpression') {
        if (!['=', '+=', '-=', '*=', '/=', '%=', '**='].includes(e.operator)) unsupported(e);
        return [
          {
            type: 'assign',
            target: expression(e.left),
            op: e.operator as AssignmentOp,
            value: expression(e.right),
          },
        ];
      }
      if (e.type === 'UpdateExpression')
        return [
          {
            type: 'assign',
            target: expression(e.argument),
            op: e.operator === '++' ? '+=' : '-=',
            value: { type: 'literal', value: 1 },
          },
        ];
      if (e.type === 'CallExpression') return [{ type: 'call', expression: expression(e) }];
      return unsupported(e);
    }
    case 'IfStatement':
      return [
        {
          type: 'if',
          test: expression(node.test),
          yes: statement(node.consequent, span),
          no: node.alternate ? statement(node.alternate, span) : [],
        },
      ];
    case 'ForOfStatement': {
      const variable = node.left.type === 'VariableDeclaration' ? node.left.declarations[0]?.id : node.left;
      if (node.await || variable?.type !== 'Identifier' || variable.name.startsWith('$')) unsupported(node);
      return [
        {
          type: 'each',
          name: safeKey(variable.name.replace(/^_/, '')),
          items: expression(node.right),
          body: statement(node.body, span),
        },
      ];
    }
    default:
      return unsupported(node);
  }
}

export function parseStatements(source: string, span?: Span): Statement[] {
  try {
    return (parse(source, { ecmaVersion: 'latest', sourceType: 'module' }) as ESTree).body.flatMap((node: ESTree) =>
      statement(node, span),
    );
  } catch (e) {
    throw new GnehError(e instanceof GnehError ? e.code : 'ACTION_SYNTAX', (e as Error).message, span);
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
                ? node.properties.flatMap((p: ESTree) => pattern(p.value ?? p.argument))
                : [];
  const declaration = (node: ESTree): string[] =>
    node?.type === 'VariableDeclaration'
      ? node.declarations.flatMap((d: ESTree) => pattern(d.id))
      : node?.id
        ? [node.id.name]
        : [];
  for (const node of ast.body) {
    if (node.type === 'ImportDeclaration') {
      const names = node.specifiers.map((s: ESTree) => s.local.name);
      imports.push(...names);
      names.forEach((n: string) => bindings.add(n));
    }
    if (node.type === 'ExportDefaultDeclaration')
      throw new GnehError('MODULE_DEFAULT', 'The document body owns the default export. Use named exports in @module.');
    const decl = node.type === 'ExportNamedDeclaration' ? node.declaration : node;
    for (const name of declaration(decl)) bindings.add(name);
    if (node.type === 'ExportNamedDeclaration') {
      exports.push(
        ...declaration(decl),
        ...node.specifiers.map((spec: ESTree) => spec.exported.name ?? spec.exported.value),
      );
      if (decl?.type === 'FunctionDeclaration') functions.push(decl.id.name);
    }
  }
  return { imports, exports, bindings: [...bindings], functions };
}

/** Token-aware aliases, never replacements inside strings, comments or member names. */
export function sugarExpression(source: string): string {
  const aliases: Record<string, string> = {
    is: '===',
    isnot: '!==',
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
  };
  let out = '',
    i = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      let end = i + 1;
      while (end < source.length) {
        if (source[end] === '\\') {
          end += 2;
          continue;
        }
        if (source[end++] === q) break;
      }
      out += source.slice(i, end);
      i = end;
      continue;
    }
    if (source.startsWith('//', i)) {
      const end = source.indexOf('\n', i);
      if (end < 0) {
        out += source.slice(i);
        break;
      }
      out += source.slice(i, end);
      i = end;
      continue;
    }
    if (source.startsWith('/*', i)) {
      const e = source.indexOf('*/', i + 2);
      if (e < 0) throw new GnehError('EXPR_SYNTAX', 'Unclosed comment');
      out += source.slice(i, e + 2);
      i = e + 2;
      continue;
    }
    const word = /^[A-Za-z_$][\w$]*/.exec(source.slice(i));
    if (word) {
      const w = word[0],
        previous = out.trimEnd().slice(-1),
        after = source.slice(i + w.length).trimStart();
      out += previous === '.' || after.startsWith(':') ? w : (aliases[w] ?? w);
      i += w.length;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}
