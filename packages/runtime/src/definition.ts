import {
  invariant,
  type Fragment,
  type FragmentContext,
  type FragmentProps,
  type Metadata,
  type PassageIR,
  type CallablePhase,
  type RenderInput,
} from '@gneh/core';

export const passageSetSetup: unique symbol = Symbol('gneh.passage-set.setup');

const passageBrand: unique symbol = Symbol('gneh.passage');
const callableBrand: unique symbol = Symbol('gneh.authored-callable');

export interface FragmentDefinition<P extends object> {
  id: string;
  metadata?: Metadata;
  capabilities?: string[];
  bindings?: Readonly<Record<string, unknown>>;
  ir?: PassageIR;
  enter?: (ctx: FragmentContext, props: P) => void;
  render: (ctx: FragmentContext, props: P) => RenderInput;
}

export interface PassageDefinition<P extends object> extends FragmentDefinition<P> {
  name?: string;
}

export interface Passage<P extends object = FragmentProps> extends Fragment<P> {
  readonly [passageBrand]: true;
}

export type PassageRecord = Readonly<Record<string, Passage>>;

export type PassageSet = PassageRecord & { readonly [passageSetSetup]: readonly Passage[] };

export type PassageInput = Passage | PassageSet | PassageRecord;

export interface PassageSetDefinition {
  passages: PassageInput | readonly PassageInput[];
  setup?: readonly (Passage | string)[];
}

export interface AuthoredCallable<P extends CallablePhase = CallablePhase> {
  readonly kind: 'gneh.authored-callable';
  readonly phase: P;
  readonly [callableBrand]: true;
  readonly invoke: (...args: unknown[]) => unknown;
}

function defineCallable<P extends CallablePhase, Args extends unknown[]>(
  phase: P,
  invoke: (...args: Args) => unknown,
): AuthoredCallable<P> {
  invariant(typeof invoke === 'function', 'CALLABLE_DEFINITION', `define${phase} requires a function.`);
  return Object.freeze({
    kind: 'gneh.authored-callable' as const,
    phase,
    [callableBrand]: true as const,
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
  return !!value && typeof value === 'object' && (value as AuthoredCallable).kind === 'gneh.authored-callable';
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
  return Object.freeze({ ...fragment, [passageBrand]: true as const }) as Passage<P>;
}

export function isPassage(value: unknown): value is Passage {
  return !!value && typeof value === 'object' && (value as Passage)[passageBrand] === true;
}

export function isPassageSet(value: unknown): value is PassageSet {
  return !!value && typeof value === 'object' && passageSetSetup in value;
}

function inputs(value: PassageInput | readonly PassageInput[]): readonly PassageInput[] {
  return Array.isArray(value) ? (value as readonly PassageInput[]) : [value as PassageInput];
}

export function definePassages(...values: [PassageSetDefinition] | PassageInput[]): PassageSet {
  const objectForm =
    values.length === 1 &&
    !!values[0] &&
    typeof values[0] === 'object' &&
    !isPassage(values[0]) &&
    !isPassageSet(values[0]) &&
    Object.hasOwn(values[0], 'passages');
  const definition = objectForm ? (values[0] as PassageSetDefinition) : undefined;
  const source = definition ? inputs(definition.passages) : (values as PassageInput[]);
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
  for (const reference of definition?.setup ?? []) {
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
  Object.defineProperty(result, passageSetSetup, { value: Object.freeze(setup), enumerable: false });
  return Object.freeze(result) as PassageSet;
}
