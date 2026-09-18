import { describe, expect, test } from 'vitest';
import { assertJson, cloneState, display, normalizeView, safeKey, v } from '../dist/index.js';

describe('@gneh/core', () => {
  test('validates and clones portable JSON without sharing nested objects', () => {
    const original = { player: { hp: 3 }, tags: ['ready'] };
    assertJson(original);
    const clone = cloneState(original);
    expect(clone).toEqual(original);
    expect(clone).not.toBe(original);
    expect(clone.player).not.toBe(original.player);
  });

  test('rejects unsafe keys and non-JSON values', () => {
    expect(() => safeKey('__proto__')).toThrow();
    expect(() => assertJson(new Date())).toThrow();
    expect(() => assertJson({ value: undefined })).toThrow();
  });

  test('normalizes renderer-neutral view input', () => {
    expect(normalizeView(v.group('hello', null, 4))).toEqual([
      {
        kind: 'group',
        children: [
          { kind: 'text', text: 'hello' },
          { kind: 'text', text: '4' },
        ],
      },
    ]);
    expect(display(true)).toBe('true');
  });
});
