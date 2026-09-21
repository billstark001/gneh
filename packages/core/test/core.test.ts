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
    expect(() => assertJson(Array(1))).toThrow(/dense/);
    const arrayWithProperty = [] as unknown[] & { label?: string };
    arrayWithProperty.label = 'not serialized by JSON';
    expect(() => assertJson(arrayWithProperty)).toThrow(/named properties/);
    let nested: Record<string, unknown> = {};
    for (let depth = 0; depth < 1_000; depth++) nested = { nested };
    expect(() => assertJson(nested)).toThrow(/depth limit/);
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
