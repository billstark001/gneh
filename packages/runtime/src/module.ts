import {
  GnehError,
  invariant,
  lexicalScope,
  safeKey,
  type FragmentContext,
  type PassageIR,
  type Scope,
  type State,
  type View,
} from '@gneh/core';
import { defineIRFragment } from './fragment.js';
import type { ModuleBindingCell } from './api-types.js';

const unavailable = (facility: string): never => {
  throw new GnehError('PRIMARY_CONTEXT', `${facility} is unavailable in the primary initializer.`);
};

/** Evaluate a source module's headerless primary region exactly once per ESM instance. */
export function initializeModule(
  initializer: PassageIR | undefined,
  bindings: Readonly<Record<string, unknown>> = {},
  cells: Readonly<Record<string, ModuleBindingCell>> = {},
): Scope {
  const scope = lexicalScope(bindings as Scope);
  if (!initializer) {
    invariant(!Object.keys(cells).length, 'EXPORT_UNKNOWN', 'Cannot export a binding without a primary initializer.');
    return scope;
  }
  const locals = new Map<string, unknown>();
  let steps = 0;
  const state = new Proxy(Object.create(null) as State, {
    get: () => unavailable('Story state'),
    set: () => unavailable('Story state'),
    deleteProperty: () => unavailable('Story state'),
  });
  const context: FragmentContext = {
    state,
    bindings,
    phase: 'enter',
    live: false,
    instanceId: 'primary',
    mountKey: 'primary',
    restoring: false,
    suspended: false,
    step() {
      invariant(++steps <= 100_000, 'STEP_LIMIT', 'Module initialization budget exhausted.');
    },
    random: () => unavailable('Randomness'),
    navigate: () => unavailable('Navigation'),
    mutate: () => unavailable('Story mutation'),
    dispatch: () => unavailable('Actions'),
    include: () => unavailable('Passage inclusion'),
    region: () => unavailable('Regions'),
    regionView: () => unavailable('Regions'),
    host: () => unavailable('Host operations'),
    invokeExtension: () => unavailable('Runtime extensions'),
    local<T>(key: string, initialize: (ctx: FragmentContext) => T): T {
      if (!locals.has(key)) locals.set(key, initialize(context));
      return locals.get(key) as T;
    },
    setLocal(key, value) {
      locals.set(key, value);
    },
    continuation: () => unavailable('Continuations'),
    setContinuation: () => unavailable('Continuations'),
    deleteContinuation: () => unavailable('Continuations'),
    evaluate: () => unavailable('Declarative flows'),
    suspend: () => unavailable('Suspension'),
    effect(key, action) {
      if (locals.has('effect:' + key)) return;
      locals.set('effect:' + key, true);
      action(context);
    },
    onDispose: () => unavailable('Mount cleanup'),
    publish: () => unavailable('Story-global publication'),
  };
  // Keep imported ESM bindings lazy. Generated source modules expose imports as
  // getters so a native fragment can refer back to the compiled PassageSet
  // without forcing an uninitialized binding during cyclic module evaluation.
  const fragment = defineIRFragment(initializer, { bindings, rootScope: scope });
  const output = fragment.render(context, {});
  const views = Array.isArray(output) ? output : output == null ? [] : [output];
  invariant(
    views.every((view) => typeof view === 'object' && (view as View).kind === 'text' && !(view as View).text),
    'PRIMARY_OUTPUT',
    'Bare render output is not allowed in the primary initializer.',
  );
  for (const [name, cell] of Object.entries(cells)) {
    const key = safeKey(name);
    invariant(Object.hasOwn(scope, key), 'EXPORT_UNKNOWN', `Primary binding is not definitely assigned: ${name}`);
    const descriptor = Object.getOwnPropertyDescriptor(scope, key)!;
    cell.set(scope[key]);
    Object.defineProperty(scope, key, {
      enumerable: true,
      configurable: false,
      get: cell.get,
      set: descriptor.writable
        ? cell.set
        : () => {
            throw new GnehError('E_ASSIGN', `Cannot assign to constant binding: ${name}`);
          },
    });
  }
  return scope;
}
