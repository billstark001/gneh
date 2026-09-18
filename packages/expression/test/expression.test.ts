import { describe, expect, test } from 'vitest';
import { emitExpression, parseExpression, parseModule, sugarExpression } from '../dist/index.js';

describe('@gneh/expression', () => {
  test('parses state and lexical references into the portable expression AST', () => {
    const expression = parseExpression('$hp + bonus');
    expect(expression.ast.type).toBe('binary');
    expect(emitExpression(expression.ast)).toContain('resolveReference(c,s,"state","hp")');
  });

  test('rewrites compatibility operators without touching strings', () => {
    expect(sugarExpression('$a is 1 and "is and"')).toBe('$a === 1 && "is and"');
  });

  test('extracts module bindings and exports', () => {
    expect(parseModule('export const answer = 42; export function helper() {}')).toMatchObject({
      exports: ['answer', 'helper'],
      bindings: ['answer', 'helper'],
      functions: ['helper'],
    });
  });
});
