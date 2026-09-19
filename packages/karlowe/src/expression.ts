import { GnehError, type Expression, type Span, type Statement } from '@gneh/core';
import { parseExpression, type ExpressionNode } from '@gneh/expression';
import { balanced, harloweMacroName, splitTopLevel } from '@gneh/syntax';
import { PrattParser, type OperatorConfig, type PrattToken, type PrattASTNode } from './pratt-parser.js';

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

const operators = Object.keys(config).sort((left, right) => right.length - left.length);
const identifier = (name: string): ExpressionNode => ({ type: 'Identifier', name });
const literal = (value: string | number | boolean | null): ExpressionNode => ({ type: 'Literal', value });
const call = (callee: ExpressionNode, args: ExpressionNode[]): ExpressionNode => ({
  type: 'CallExpression',
  callee,
  arguments: args,
  optional: false,
});

function lower(node: PrattASTNode<ExpressionNode>): ExpressionNode {
  if (node.type === 'leaf') return node.value;
  if (node.type === 'prefix') {
    if (node.operator === 'not')
      return { type: 'UnaryExpression', operator: '!', prefix: true, argument: lower(node.operand) };
    return {
      type: 'UnaryExpression',
      operator: node.operator as '+' | '-',
      prefix: true,
      argument: lower(node.operand),
    };
  }
  if (node.type === 'postfix') throw new GnehError('KARLOWE_OPERATOR', 'Postfix operators are unsupported.');
  const left = lower(node.left);
  const right = lower(node.right);
  const operator = node.operator;
  if (['contains', 'does not contain', 'is in', 'is not in'].includes(operator)) {
    const contains = call(
      identifier('contains'),
      ['is in', 'is not in'].includes(operator) ? [right, left] : [left, right],
    );
    return operator.startsWith('does') || operator === 'is not in'
      ? { type: 'UnaryExpression', operator: '!', prefix: true, argument: contains }
      : contains;
  }
  const mapped =
    (
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
    )[operator] ?? operator;
  if (mapped === '&&' || mapped === '||') return { type: 'LogicalExpression', operator: mapped, left, right };
  return {
    type: 'BinaryExpression',
    operator: mapped as Extract<
      ExpressionNode,
      {
        type: 'BinaryExpression';
      }
    >['operator'],
    left,
    right,
  };
}

export function parseKarloweExpression(
  source: string,
  span: Span = { file: '<karlowe>', start: 0, end: source.length },
): Expression {
  const tokens: PrattToken<ExpressionNode>[] = [];
  let index = 0;
  const recurse = (text: string, start: number) =>
    parseKarloweExpression(text, {
      ...span,
      start: span.start + start,
      end: span.start + start + text.length,
    }).ast;
  const native = (text: string, start: number) =>
    parseExpression(text, {
      ...span,
      start: span.start + start,
      end: span.start + start + text.length,
    }).ast;
  try {
    while (index < source.length) {
      if (/\s/.test(source[index])) {
        index++;
        continue;
      }
      const operator = operators.find(
        (candidate) =>
          source.startsWith(candidate, index) &&
          (!/[a-z]$/.test(candidate) || !/[\w$]/.test(source[index + candidate.length] ?? '')),
      );
      if (operator) {
        tokens.push({
          type: 'opr',
          value: operator,
          start: span.start + index,
          end: span.start + index + operator.length,
        });
        index += operator.length;
        continue;
      }
      const start = index;
      let atom: ExpressionNode;
      if (source[index] === '(') {
        const group = balanced(source, index, 'karlowe');
        const macro = /^\s*([\w-]+)\s*:\s*/.exec(group.content);
        if (macro) {
          const name = harloweMacroName(macro[1]);
          const known: Record<string, string> = {
            a: 'array',
            array: 'array',
            dm: 'datamap',
            datamap: 'datamap',
            either: 'either',
            random: 'random',
            str: 'String',
            num: 'Number',
          };
          const hostOperations: Record<string, string> = {
            prompt: 'prompt',
            savegame: 'save',
            loadgame: 'load',
            savedgames: 'saved-games',
            history: 'history',
          };
          if (!known[name] && !hostOperations[name])
            throw new GnehError('KARLOWE_EXPR_MACRO', `Unsupported expression macro (${name}:)`);
          const argSource = group.content.slice(macro[0].length);
          const args = argSource.trim()
            ? splitTopLevel(argSource).map((part) =>
                recurse(part, group.start + macro[0].length + argSource.indexOf(part)),
              )
            : [];
          atom = hostOperations[name]
            ? call(identifier('host'), [literal(hostOperations[name]), ...args])
            : call(identifier(known[name]), args);
        } else atom = recurse(group.content, group.start);
        index = group.end;
      } else if (source[index] === '[' || source[index] === '{') {
        const group = balanced(source, index);
        atom = native(source.slice(index, group.end), index);
        index = group.end;
      } else if (source[index] === '"' || source[index] === "'") {
        const quote = source[index++];
        while (index < source.length) {
          if (source[index] === '\\') {
            index += 2;
            continue;
          }
          if (source[index++] === quote) break;
        }
        atom = native(source.slice(start, index), start);
      } else {
        const match = /^(?:\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\.[0-9]+|[$A-Za-z_][\w$]*)/.exec(source.slice(index));
        if (!match) throw new GnehError('KARLOWE_EXPRESSION', `Unexpected expression text: ${source.slice(index, 25)}`);
        atom = native(match[0], index);
        index += match[0].length;
      }
      let callable = false;
      while (index < source.length) {
        const tail = source.slice(index);
        const property = /^\s*'s\s+([\w-]+)|^\.([A-Za-z_]\w*)/.exec(tail);
        if (property) {
          const name = property[1] ?? property[2];
          const ordinal = /^(\d+)(?:st|nd|rd|th)$/.exec(name);
          atom = {
            type: 'MemberExpression',
            object: atom,
            property: literal(ordinal ? Number(ordinal[1]) - 1 : name),
            computed: true,
            optional: false,
          };
          index += property[0].length;
          callable = true;
        } else if (source[index] === '[') {
          const group = balanced(source, index);
          atom = {
            type: 'MemberExpression',
            object: atom,
            property: recurse(group.content, group.start),
            computed: true,
            optional: false,
          };
          index = group.end;
          callable = true;
        } else if (callable && /^\s*\(/.test(tail)) {
          const whitespace = /^\s*/.exec(tail)?.[0].length ?? 0;
          const group = balanced(source, index + whitespace, 'karlowe');
          const args = group.content.trim()
            ? splitTopLevel(group.content).map((part) => recurse(part, group.start + group.content.indexOf(part)))
            : [];
          atom = call(atom, args);
          index = group.end;
          callable = false;
        } else break;
      }
      tokens.push({ type: 'expr', value: atom, start: span.start + start, end: span.start + index });
    }
    const ast = new PrattParser<ExpressionNode>({ operators: config }).parse(tokens);
    if (!ast) throw new GnehError('KARLOWE_EXPRESSION', 'Empty expression');
    return { ast: lower(ast), source, span };
  } catch (error) {
    throw new GnehError(error instanceof GnehError ? error.code : 'KARLOWE_EXPRESSION', (error as Error).message, span);
  }
}

function replaceIt(value: ExpressionNode, target: ExpressionNode): ExpressionNode {
  const walk = (item: unknown, key?: string, parent?: Record<string, unknown>): unknown => {
    if (
      item &&
      typeof item === 'object' &&
      (item as { type?: string }).type === 'Identifier' &&
      (item as { name?: string }).name === 'it' &&
      !(key === 'property' && parent?.computed === false) &&
      !(key === 'key' && parent?.computed === false)
    )
      return target;
    if (Array.isArray(item)) return item.map((child) => walk(child));
    if (item && typeof item === 'object')
      return Object.fromEntries(
        Object.entries(item).map(([childKey, child]) => [
          childKey,
          walk(child, childKey, item as Record<string, unknown>),
        ]),
      );
    return item;
  };
  return walk(value) as ExpressionNode;
}

export function karloweAssignments(source: string, span: Span, put = false): Statement[] {
  return splitTopLevel(source).map((part) => {
    const word = put ? ' into ' : ' to ';
    const pieces = splitTopLevel(part, word);
    if (pieces.length !== 2)
      throw new GnehError('KARLOWE_ASSIGN', `Expected ${put ? 'value into $variable' : '$variable to value'}`, span);
    const left = put ? pieces[1] : pieces[0];
    const right = put ? pieces[0] : pieces[1];
    const target = parseKarloweExpression(left, span).ast;
    if (target.type !== 'Identifier' && target.type !== 'MemberExpression')
      throw new GnehError('KARLOWE_ASSIGN', 'Assignment target must be a variable or property.', span);
    return {
      type: 'expression',
      expression: {
        type: 'AssignmentExpression',
        operator: '=',
        left: target,
        right: replaceIt(parseKarloweExpression(right, span).ast, target),
      },
    };
  });
}
