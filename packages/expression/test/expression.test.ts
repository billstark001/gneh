import { describe, expect, test } from 'vitest';
import {
  parseBindingPattern,
  parseExpression,
  parseIterationClause,
  parseSugarExpression,
  scanBindingPattern,
} from '../dist/index.js';

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
    expect(parseSugarExpression('$a is 1 and "is and"').ast).toMatchObject({
      type: 'LogicalExpression',
      operator: '&&',
      left: { type: 'BinaryExpression', operator: '===' },
      right: { type: 'Literal', value: 'is and' },
    });
  });

  test('parses binding patterns for Inkdown declarations', () => {
    expect(parseBindingPattern('{ hp, inventory: [first, ...rest] }')).toMatchObject({
      type: 'ObjectPattern',
      properties: [{ value: { type: 'Identifier', name: 'hp' } }, { value: { type: 'ArrayPattern' } }],
    });
    expect(() => parseBindingPattern('$hp')).toThrow(/Persistent state/);
  });

  test('parses DSL iteration clauses without a JavaScript Program parser', () => {
    expect(parseIterationClause('[head, ...tail] of $items')).toMatchObject({
      binding: { type: 'ArrayPattern' },
      iterable: { type: 'Identifier', name: '$items' },
    });
  });

  test('streams a binding pattern up to a host-language delimiter', () => {
    const source = '{ value = 1, ...rest } = input';
    const result = scanBindingPattern(
      source,
      undefined,
      (token, depth) => depth === 0 && token.kind === 'op' && token.value === '=',
    );
    expect(result.pattern).toMatchObject({ type: 'ObjectPattern' });
    expect(source.slice(result.next).trimStart()).toBe('= input');
  });
});
