import { GnehError } from '@gneh/core';

/**
 * Lazily expose a graph as read-only while preserving object identity within one view.
 * Copying on every property access would make render code safe but would also break
 * equality checks and become quadratic for large story state objects.
 */
export function deepReadonly<T>(value: T, cache = new WeakMap<object, unknown>()): T {
  if (!value || typeof value !== 'object') return value;
  const found = cache.get(value);
  if (found) return found as T;
  const proxy = new Proxy(value as object, {
    get: (object, key) => deepReadonly(Reflect.get(object, key), cache),
    set() {
      throw new GnehError('READ_ONLY', 'Use an action or ctx.mutate() to change state.');
    },
    deleteProperty() {
      throw new GnehError('READ_ONLY', 'Render state is read-only.');
    },
    defineProperty() {
      throw new GnehError('READ_ONLY', 'Render state is read-only.');
    },
  });
  cache.set(value, proxy);
  return proxy as T;
}
