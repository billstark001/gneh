import { safeKey } from './json.js';
import type { Scope } from './view.js';

/** A lexical environment has only an outward edge, so unreachable call frames
 * and their closures are collectible as one graph. */
export function lexicalScope(parent?: Scope, values: Scope = {}): Scope {
  const scope = Object.create(parent ?? null) as Scope;
  for (const [name, value] of Object.entries(values)) scope[safeKey(name)] = value;
  return scope;
}

export function hasBinding(scope: Scope, name: string): boolean {
  safeKey(name);
  let current: Scope | null = scope;
  while (current) {
    if (Object.hasOwn(current, name)) return true;
    current = Object.getPrototypeOf(current) as Scope | null;
  }
  return false;
}

export function bindingOwner(scope: Scope, name: string): Scope | undefined {
  safeKey(name);
  let current: Scope | null = scope;
  while (current) {
    if (Object.hasOwn(current, name)) return current;
    current = Object.getPrototypeOf(current) as Scope | null;
  }
}

export function flattenScope(scope: Scope): Scope {
  const chain: Scope[] = [];
  for (let current: Scope | null = scope; current; current = Object.getPrototypeOf(current) as Scope | null)
    chain.push(current);
  return Object.assign(Object.create(null), ...chain.reverse()) as Scope;
}
