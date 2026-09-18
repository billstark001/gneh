import {
  GnehError,
  type BinaryOp,
  type Expr,
  type Expression,
  type ReferenceNamespace,
  type Span,
  type Statement,
} from '@gneh/core';
import { parseExpression } from '@gneh/expression';
import { balanced, harloweMacroName, splitTopLevel } from '@gneh/syntax';
import { PrattParser, type OperatorConfig, type PrattToken, type PrattASTNode } from './pratt-parser.js';

// Supported precedence subset adapted from upstream markup/expression.ts; unsupported
// type/lambda/changer operators are rejected instead of inheriting undocumented behavior.
const config: Record<string, OperatorConfig> = {
  or: { precedence: 8, infix: true },
  and: { precedence: 9, infix: true },
  not: { precedence: 10, prefix: true },
};

for (const op of ['is', 'is not', 'is >', 'is <', 'is >=', 'is <=', '>', '<', '>=', '<=', '!='])
  config[op] = { precedence: 11, infix: true };

for (const op of ['contains', 'does not contain', 'is in', 'is not in']) config[op] = { precedence: 12, infix: true };

for (const op of ['+', '-']) config[op] = { precedence: 13, infix: true, prefix: true };

for (const op of ['*', '/', '%']) config[op] = { precedence: 14, infix: true };

const operators = Object.keys(config).sort((a, b) => b.length - a.length);

function ref(namespace: ReferenceNamespace, name: string, origin?: Span): Expr {
  return { type: 'reference', namespace, name, origin };
}

function lower(node: PrattASTNode<Expr>): Expr {
  if (node.type === 'leaf') return node.value;
  if (node.type === 'prefix')
    return {
      type: 'unary',
      op: node.operator === 'not' ? '!' : (node.operator as '+' | '-'),
      value: lower(node.operand),
    };
  if (node.type === 'postfix') throw new GnehError('KARLOWE_OPERATOR', 'Postfix operators are unsupported.');
  const left = lower(node.left),
    right = lower(node.right),
    op = node.operator;
  if (['contains', 'does not contain', 'is in', 'is not in'].includes(op)) {
    const x: Expr = {
      type: 'call',
      callee: ref('intrinsic', 'contains'),
      args: ['is in', 'is not in'].includes(op) ? [right, left] : [left, right],
      optional: false,
    };
    return op.startsWith('does') || op === 'is not in' ? { type: 'unary', op: '!', value: x } : x;
  }
  return {
    type: 'binary',
    op: ((
      {
        is: '===',
        'is not': '!==',
        'is >': '>',
        'is <': '<',
        'is >=': '>=',
        'is <=': '<=',
        and: '&&',
        or: '||',
      } as Record<string, string>
    )[op] ?? op) as BinaryOp,
    left,
    right,
  };
}

export function parseKarloweExpression(
  source: string,
  span: Span = { file: '<karlowe>', start: 0, end: source.length },
): Expression {
  const tokens: PrattToken<Expr>[] = [];
  let i = 0;
  function recurse(text: string, start: number): Expr {
    return parseKarloweExpression(text, {
      ...span,
      start: span.start + start,
      end: span.start + start + text.length,
    }).ast;
  }
  function native(text: string, start: number): Expr {
    return parseExpression(text, {
      ...span,
      start: span.start + start,
      end: span.start + start + text.length,
    }).ast;
  }
  try {
    while (i < source.length) {
      if (/\s/.test(source[i])) {
        i++;
        continue;
      }
      const operator = operators.find(
        (op) => source.startsWith(op, i) && (!/[a-z]$/.test(op) || !/[\w$]/.test(source[i + op.length] ?? '')),
      );
      if (operator) {
        tokens.push({
          type: 'opr',
          value: operator,
          start: span.start + i,
          end: span.start + i + operator.length,
        });
        i += operator.length;
        continue;
      }
      const start = i;
      let atom: Expr;
      if (source[i] === '(') {
        const b = balanced(source, i, 'karlowe');
        const macro = /^\s*([\w-]+)\s*:\s*/.exec(b.content);
        if (macro) {
          const name = harloweMacroName(macro[1]);
          const known: Record<string, readonly [ReferenceNamespace, string]> = {
            a: ['intrinsic', 'array'],
            array: ['intrinsic', 'array'],
            dm: ['intrinsic', 'datamap'],
            datamap: ['intrinsic', 'datamap'],
            either: ['intrinsic', 'either'],
            random: ['intrinsic', 'random'],
            str: ['intrinsic', 'string'],
            num: ['intrinsic', 'number'],
            prompt: ['binding', 'prompt'],
            savegame: ['binding', 'saveGame'],
            loadgame: ['binding', 'loadGame'],
            savedgames: ['binding', 'savedGames'],
            history: ['binding', 'history'],
          };
          if (!known[name]) throw new GnehError('KARLOWE_EXPR_MACRO', `Unsupported expression macro (${name}:)`);
          const argSource = b.content.slice(macro[0].length);
          const args = argSource.trim()
            ? splitTopLevel(argSource).map((s) => recurse(s, b.start + macro[0].length + argSource.indexOf(s)))
            : [];
          atom = {
            type: 'call',
            callee: ref(known[name][0], known[name][1]),
            args,
            optional: false,
          };
        } else atom = recurse(b.content, b.start);
        i = b.end;
      } else if (source[i] === '[' || source[i] === '{') {
        const b = balanced(source, i);
        atom = native(source.slice(i, b.end), i);
        i = b.end;
      } else if (source[i] === '"' || source[i] === "'") {
        const q = source[i++];
        while (i < source.length) {
          if (source[i] === '\\') {
            i += 2;
            continue;
          }
          if (source[i++] === q) break;
        }
        atom = native(source.slice(start, i), start);
      } else {
        const match = /^(?:\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\.[0-9]+|[$A-Za-z_][\w$]*)/.exec(source.slice(i));
        if (!match) throw new GnehError('KARLOWE_EXPRESSION', `Unexpected expression text: ${source.slice(i, 25)}`);
        atom = native(match[0], i);
        i += match[0].length;
      }
      // Explicit, local property access. Hook queries and dynamic changers never enter the IR.
      let callable = false;
      while (i < source.length) {
        const tail = source.slice(i);
        const property = /^\s*'s\s+([\w-]+)|^\.([A-Za-z_]\w*)/.exec(tail);
        if (property) {
          const name = property[1] ?? property[2];
          const ordinal = /^(\d+)(?:st|nd|rd|th)$/.exec(name);
          atom = {
            type: 'get',
            object: atom,
            key: { type: 'literal', value: ordinal ? Number(ordinal[1]) - 1 : name },
            optional: false,
          };
          i += property[0].length;
          callable = true;
        } else if (source[i] === '[') {
          const b = balanced(source, i);
          atom = { type: 'get', object: atom, key: recurse(b.content, b.start), optional: false };
          i = b.end;
          callable = true;
        } else if (callable && /^\s*\(/.test(tail)) {
          const whitespace = /^\s*/.exec(tail)?.[0].length ?? 0;
          const callStart = i + whitespace;
          const b = balanced(source, callStart, 'karlowe');
          const args = b.content.trim()
            ? splitTopLevel(b.content).map((argument) => recurse(argument, b.start + b.content.indexOf(argument)))
            : [];
          atom = { type: 'call', callee: atom, args, optional: false };
          i = b.end;
          callable = false;
        } else break;
      }
      tokens.push({ type: 'expr', value: atom, start: span.start + start, end: span.start + i });
    }
    const ast = new PrattParser<Expr>({ operators: config }).parse(tokens);
    if (!ast) throw new GnehError('KARLOWE_EXPRESSION', 'Empty expression');
    return { ast: lower(ast), source, span };
  } catch (error) {
    throw new GnehError(error instanceof GnehError ? error.code : 'KARLOWE_EXPRESSION', (error as Error).message, span);
  }
}

function replaceIt(value: Expr, target: Expr): Expr {
  if (value.type === 'reference' && value.namespace === 'lexical' && value.name === 'it') return target;
  // Closed IR has only arrays/plain objects, so a structural walk is deterministic.
  const walk = (x: unknown): unknown =>
    Array.isArray(x)
      ? x.map(walk)
      : x && typeof x === 'object'
        ? (x as Expr).type === 'reference' &&
          (x as Extract<Expr, { type: 'reference' }>).namespace === 'lexical' &&
          (
            x as {
              name?: string;
            }
          ).name === 'it'
          ? target
          : Object.fromEntries(Object.entries(x).map(([k, v]) => [k, walk(v)]))
        : x;
  return walk(value) as Expr;
}

export function karloweAssignments(source: string, span: Span, put = false): Statement[] {
  return splitTopLevel(source).map((part) => {
    const word = put ? ' into ' : ' to ';
    const pieces = splitTopLevel(part, word);
    if (pieces.length !== 2)
      throw new GnehError('KARLOWE_ASSIGN', `Expected ${put ? 'value into $variable' : '$variable to value'}`, span);
    const lhs = put ? pieces[1] : pieces[0],
      rhs = put ? pieces[0] : pieces[1];
    const target = parseKarloweExpression(lhs, span).ast;
    return {
      type: 'assign',
      target,
      op: '=',
      value: replaceIt(parseKarloweExpression(rhs, span).ast, target),
    };
  });
}
