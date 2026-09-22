import { invariant, type FragmentProps, type CallablePhase, type Fragment, type RenderInput } from '@gneh/core';
import type {
  AuthoredCallable,
  FragmentDefinition,
  Passage,
  PassageDefinition,
  PassageInput,
  PassageSet,
  PassageSetDefinition,
} from './api-types.js';
import { authoredCallableBrand, passageBrand, passageSetBrand, passageSetSetup } from './brands.js';

type RuntimePassageSet = PassageSet & { readonly [passageSetSetup]: readonly Passage[] };

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

export function defineFragment<P extends object = FragmentProps>(definition: FragmentDefinition<P>): Fragment<P> {
  invariant(!!definition.id, 'FRAGMENT_ID', 'A fragment requires a stable id.');
  return Object.freeze({
    kind: 'gneh.fragment' as const,
    id: definition.id,
    metadata: Object.freeze({ ...definition.metadata }),
    capabilities: Object.freeze([...(definition.capabilities ?? [])]),
    bindings: definition.bindings,
    ir: definition.ir,
    enter: definition.enter,
    render: definition.render,
  });
}

export function definePassage<P extends object = FragmentProps>(definition: PassageDefinition<P>): Passage<P> {
  const fragment = defineFragment({
    ...definition,
    metadata: { ...definition.metadata, name: definition.name ?? definition.metadata?.name ?? definition.id },
  });
  return Object.freeze({ ...fragment, [passageBrand]: true as const });
}

export function isPassage(value: unknown): value is Passage {
  return !!value && typeof value === 'object' && (value as Passage)[passageBrand] === true;
}

export function isPassageSet(value: unknown): value is RuntimePassageSet {
  return !!value && typeof value === 'object' && (value as PassageSet)[passageSetBrand] === true;
}

function inputs(value: PassageInput | readonly PassageInput[]): readonly PassageInput[] {
  return Array.isArray(value) ? (value as readonly PassageInput[]) : [value as PassageInput];
}

function createPassageSet(source: readonly PassageInput[], setupReferences: readonly (Passage | string)[]): PassageSet {
  const result: Record<string, Passage> = Object.create(null);
  const setup: Passage[] = [];
  const addPassage = (key: string, passage: Passage) => {
    invariant(isPassage(passage), 'PASSAGE_DEFINITION', `Expected a branded Passage at ${key}.`);
    invariant(key === passage.id, 'PASSAGE_KEY', `Passage key ${key} does not match canonical id ${passage.id}.`);
    invariant(!Object.hasOwn(result, key), 'DUPLICATE_ID', `Duplicate passage id: ${key}`);
    result[key] = passage;
  };
  for (const input of source) {
    if (isPassage(input)) addPassage(input.id, input);
    else {
      for (const [key, passage] of Object.entries(input)) addPassage(key, passage);
      if (isPassageSet(input)) setup.push(...input[passageSetSetup]);
    }
  }
  for (const reference of setupReferences) {
    const passage = typeof reference === 'string' ? result[reference] : reference;
    invariant(
      passage && result[passage.id] === passage,
      'SETUP_MISSING',
      `Unknown setup passage: ${String(reference)}`,
    );
    setup.push(passage);
  }
  const seen = new Set<string>();
  for (const passage of setup) {
    invariant(!seen.has(passage.id), 'DUPLICATE_SETUP', `Duplicate setup passage: ${passage.id}`);
    seen.add(passage.id);
  }
  Object.defineProperties(result, {
    [passageSetBrand]: { value: true, enumerable: false },
    [passageSetSetup]: { value: Object.freeze(setup), enumerable: false },
  });
  return Object.freeze(result) as PassageSet;
}

export function definePassages(...values: PassageInput[]): PassageSet {
  return createPassageSet(values, []);
}

export function definePassageSet(definition: PassageSetDefinition): PassageSet {
  return createPassageSet(inputs(definition.passages), definition.setup ?? []);
}
