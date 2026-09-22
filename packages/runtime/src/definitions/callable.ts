import { invariant, type CallablePhase, type RenderInput } from '@gneh/core';
import type { AuthoredCallable } from '../api-types.js';
import { authoredCallableBrand } from '../brands.js';

function defineCallable<P extends CallablePhase, Args extends unknown[]>(
  phase: P,
  invoke: (...args: Args) => unknown,
): AuthoredCallable<P> {
  invariant(typeof invoke === 'function', 'CALLABLE_DEFINITION', `define${phase} requires a function.`);
  return Object.freeze({
    kind: 'gneh.authored-callable' as const,
    phase,
    [authoredCallableBrand]: true as const,
    invoke: invoke as (...args: unknown[]) => unknown,
  });
}

export const defineView = <Args extends unknown[]>(invoke: (...args: Args) => RenderInput): AuthoredCallable<'view'> =>
  defineCallable('view', invoke);
export const defineAction = <Args extends unknown[]>(invoke: (...args: Args) => void): AuthoredCallable<'effect'> =>
  defineCallable('effect', invoke);
export const defineValue = <Args extends unknown[]>(invoke: (...args: Args) => unknown): AuthoredCallable<'value'> =>
  defineCallable('value', invoke);

export function isAuthoredCallable(value: unknown): value is AuthoredCallable {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as AuthoredCallable).kind === 'gneh.authored-callable' &&
    (value as AuthoredCallable)[authoredCallableBrand] === true
  );
}
