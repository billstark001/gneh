import { describe, expect, test } from 'vitest';
import { parseExpression, parseModule, parseStatements } from '../dist/index.js';

describe('@gneh/expression', () => {
  test('parses state and lexical identifiers into restricted ESTree', () => {
    const expression = parseExpression('$hp + bonus');
    expect(expression.ast).toMatchObject({
      type: 'BinaryExpression',
      operator: '+',
      left: { type: 'Identifier', name: '$hp' },
      right: { type: 'Identifier', name: 'bonus' },
    });
  });

  test('parses dialect operator aliases without rewriting strings', () => {
    expect(parseExpression('$a is 1 and "is and"').ast).toMatchObject({
      type: 'LogicalExpression',
      operator: '&&',
      left: { type: 'BinaryExpression', operator: '===' },
      right: { type: 'Literal', value: 'is and' },
    });
  });

  test('uses the same aliases inside effect control flow', () => {
    expect(parseStatements('if ($hp gt 0 and ready) { $hp to $hp - 1; }')).toMatchObject([
      {
        type: 'if',
        test: { type: 'LogicalExpression', operator: '&&' },
        yes: [{ type: 'expression', expression: { type: 'AssignmentExpression', operator: '=' } }],
      },
    ]);
  });

  test('extracts module bindings and exports', () => {
    expect(parseModule('export const answer = 42; export function helper() {}')).toMatchObject({
      exports: ['answer', 'helper'],
      bindings: ['answer', 'helper'],
      functions: ['helper'],
    });
  });
});
