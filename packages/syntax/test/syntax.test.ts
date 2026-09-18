import { describe, expect, test } from 'vitest';
import { balanced, splitTopLevel } from '../dist/index.js';

describe('@gneh/syntax', () => {
  test('balances JavaScript delimiters through strings and nested expressions', () => {
    const source = '{ value: "}", nested: call({ ok: true }) } trailing';
    const result = balanced(source, 0, 'js');
    expect(result.content).toBe(' value: "}", nested: call({ ok: true }) ');
    expect(source.slice(result.end)).toBe(' trailing');
  });

  test('splits only top-level separators', () => {
    expect(splitTopLevel('one, fn(two, three), "four,five"')).toEqual(['one', 'fn(two, three)', '"four,five"']);
  });
});
