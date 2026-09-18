import { describe, expect, test } from 'vitest';
import { createInkdownLowerings, parseInkdown } from '../dist/index.js';

describe('@gneh/inkdown', () => {
  test('parses native directives into structural IR', () => {
    const result = parseInkdown('@if ($ready) {\nHello {{ $name }}\n}', 'story.inkdown');
    expect(result.diagnostics).toEqual([]);
    expect(result.passages[0]?.body.some((node) => node.type === 'if')).toBe(true);
  });

  test('provides an isolated, caller-owned lowering registry', () => {
    const first = createInkdownLowerings();
    const second = first.clone();
    second.register('custom', () => ({ nodes: [], end: 0 }));
    expect(first.has('custom')).toBe(false);
    expect(second.resolve('custom')?.handler).toBeTypeOf('function');
  });
});
