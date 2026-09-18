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

  test('lowers portable macros into story IR', () => {
    const result = parseSugarcast('<<set $hp = 2>><<print $hp>>', 'story.sugarcast');
    expect(result.diagnostics).toEqual([]);
    expect(result.passages[0]?.body[0]).toMatchObject({ type: 'effect' });
  });
});
