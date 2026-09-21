import { describe, expect, test } from 'vitest';
import { lexKarlowe, parseKarlowe, parseKarloweCST } from '../dist/index.js';

describe('@gneh/karlowe', () => {
  test('lexes macro arguments losslessly', () => {
    expect(lexKarlowe('(print: 8 / 2 % 3)')).toEqual([
      { type: 'macro', name: 'print', args: '8 / 2 % 3', start: 0, argsStart: 8, end: 18 },
    ]);
  });

  test('preserves unknown macros in the CST and lowers them as runtime extensions', () => {
    expect(parseKarloweCST('(mystery: $hp)').children[0]).toMatchObject({
      type: 'macro',
      name: 'mystery',
    });
    const lowered = parseKarlowe(':: Start [start]\n(mystery: $hp)', 'story.karlowe');
    expect(lowered.diagnostics).toEqual([]);
    expect(lowered.passages[0]?.capabilities).toContain('runtime-extension:karlowe/mystery');
  });

  test('bounds adversarial CST nesting without overflowing the JavaScript stack', () => {
    const depth = 5_000;
    expect(() => parseKarloweCST('['.repeat(depth) + 'x' + ']'.repeat(depth))).toThrow(/CST nesting/);
  });

  test('bounds adversarial list nesting without overflowing the JavaScript stack', () => {
    const body = Array.from({ length: 200 }, (_, index) => `${'*'.repeat(index + 1)} item`).join('\n');
    expect(parseKarlowe(`:: Start\n${body}`).diagnostics[0]?.code).toBe('LIST_DEPTH');
  });
});
