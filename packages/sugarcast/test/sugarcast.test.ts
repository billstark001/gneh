import { describe, expect, test } from 'vitest';
import { parseSugarcast, parseSugarcastCST } from '../dist/index.js';

describe('@gneh/sugarcast', () => {
  test('keeps nested container macros structured', () => {
    const result = parseSugarcastCST('<<if $ready>><<print $name>><</if>>');
    expect(result.diagnostics).toEqual([]);
    expect(result.children[0]).toMatchObject({
      type: 'macro',
      name: 'if',
      closing: expect.anything(),
    });
  });

  test('bounds adversarial CST nesting without overflowing the JavaScript stack', () => {
    const depth = 5_000;
    const result = parseSugarcastCST('<<box>>'.repeat(depth) + '<</box>>'.repeat(depth));
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'SUGARCAST_CST_DEPTH' }));
  });

  test('bounds adversarial list nesting without overflowing the JavaScript stack', () => {
    const body = Array.from({ length: 200 }, (_, index) => `${'*'.repeat(index + 1)} item`).join('\n');
    expect(parseSugarcast(`:: Start\n${body}`).diagnostics[0]?.code).toBe('LIST_DEPTH');
  });

  test('lowers portable macros into story IR', () => {
    const result = parseSugarcast(':: Start [start]\n<<set $hp = 2>><<print $hp>>', 'story.sugarcast');
    expect(result.diagnostics).toEqual([]);
    expect(result.passages[0]?.body[0]).toMatchObject({ type: 'effect' });
  });
});
