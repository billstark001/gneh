import { invariant } from './errors.js';

export type Scalar = string | number | boolean | null;

export type Json = Scalar | Json[] | { [key: string]: Json };

export type State = Record<string, Json>;

/** Keys rejected at every data boundary to avoid prototype traversal/pollution. */
export const dangerousKeys = new Set(['__proto__', 'prototype', 'constructor']);

const maxJsonDepth = 128;

export function safeKey(value: unknown): string {
  invariant(
    typeof value === 'string' || typeof value === 'number',
    'E_KEY',
    'A property key must be a string or number.',
  );
  const key = String(value);
  invariant(!dangerousKeys.has(key), 'E_KEY', `Forbidden property: ${key}`);
  return key;
}

/** Validate the portable state/metadata representation before it crosses the ABI. */
export function assertJson(value: unknown, path = '$', seen = new Set<unknown>()): asserts value is Json {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    invariant(Number.isFinite(value), 'E_STATE', `Non-finite number at ${path}`);
    return;
  }
  invariant(typeof value === 'object' && value !== null, 'E_STATE', `Non-serializable value at ${path}`);
  invariant(!seen.has(value), 'E_STATE', `Cyclic state at ${path}`);
  invariant(seen.size < maxJsonDepth, 'E_STATE', `JSON nesting exceeds the depth limit at ${path}`);
  invariant(
    Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null,
    'E_STATE',
    `State must contain only plain objects at ${path}`,
  );
  const entries = Object.entries(value);
  if (Array.isArray(value))
    invariant(
      entries.length === value.length && entries.every(([key], index) => key === String(index)),
      'E_STATE',
      `State arrays must be dense and contain no named properties at ${path}`,
    );
  seen.add(value);
  for (const [key, child] of entries) {
    safeKey(key);
    assertJson(child, `${path}.${key}`, seen);
  }
  seen.delete(value);
}

export function cloneState<T>(value: T): T {
  assertJson(value);
  // The host implementation is optimized for graph traversal and preserves
  // numeric edge cases such as -0 that a JSON stringify/parse clone would lose.
  return structuredClone(value);
}

export function display(value: unknown): string {
  invariant(
    value === null || ['string', 'number', 'boolean', 'undefined'].includes(typeof value),
    'E_DISPLAY',
    'Interpolation accepts scalars only; embed a fragment or format the object explicitly.',
  );
  return value == null ? '' : String(value);
}
