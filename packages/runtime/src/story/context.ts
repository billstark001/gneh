/* oxlint-disable max-lines -- the complete FragmentContext contract stays in one implementation. */
import {
  assertJson,
  cloneState,
  invariant,
  normalizeView,
  safeKey,
  type AnyFragment,
  type FragmentContext,
  type FragmentProps,
  type Fragment,
  type Json,
  type RegionHandle,
  type RenderInput,
  type ResumeCondition,
  type RuntimeExtension,
  type State,
  type View,
  type ViewInput,
  type Dialect,
  type InvocationPhase,
  type EvaluationPhase,
} from '@gneh/core';
import type { Frame } from './frames.js';
import { evaluateRenderInput } from './render.js';

export interface ContextRuntimeHooks {
  readonly live: boolean;
  readonly projection: 'revealed' | 'current' | 'all' | undefined;
  readonly wikify: ((source: string, dialect?: Dialect) => Fragment) | undefined;
  state(phase: EvaluationPhase): State;
  restoring(): boolean;
  suspended(): boolean;
  bindings(): Record<string, unknown>;
  step(): void;
  random(min: number, max: number): number;
  navigate(target: string | AnyFragment, props: FragmentProps, frame: Frame, phase: EvaluationPhase): void;
  mutate(fn: (state: State) => void): void;
  installSuspension(
    frame: Frame,
    key: string,
    resume: ResumeCondition,
    accept?: (value: Json | undefined, context: FragmentContext) => void,
  ): boolean;
  dispatch(action: () => void): void;
  include(target: string | AnyFragment, props: object, frame: Frame, key: string): View[];
  updateRegion(frame: Frame, name: string, update: () => void): void;
  publish(name: string, value: unknown): void;
  host: ((operation: string, args: readonly unknown[]) => unknown) | undefined;
  runtimeExtension(id: string): RuntimeExtension | undefined;
}

class FragmentContextImpl implements FragmentContext {
  readonly #hooks: ContextRuntimeHooks;
  readonly #frame: Frame;
  readonly #phase: EvaluationPhase;
  readonly #state: State;
  readonly #restoring: boolean;
  #includes = 0;

  constructor(hooks: ContextRuntimeHooks, frame: Frame, phase: EvaluationPhase) {
    this.#hooks = hooks;
    this.#frame = frame;
    this.#phase = phase;
    this.#state = hooks.state(phase);
    this.#restoring = hooks.restoring();
  }

  get live(): boolean {
    return this.#hooks.live;
  }

  get instanceId(): string {
    return this.#frame.id;
  }

  get mountKey(): string {
    return this.#frame.key;
  }

  get restoring(): boolean {
    return this.#restoring;
  }

  get phase(): EvaluationPhase {
    return this.#phase;
  }

  get wikify() {
    return this.#hooks.wikify;
  }

  #derive(phase: EvaluationPhase): FragmentContext {
    return new FragmentContextImpl(this.#hooks, this.#frame, phase);
  }

  #alive(): void {
    invariant(this.#frame.alive, 'INSTANCE_DISPOSED', 'This fragment instance has been disposed.');
  }

  get state(): State {
    // Render is pure by contract. Enter/actions receive the transaction's
    // private mutable copy, which is validated before it becomes observable.
    return this.#state;
  }

  get bindings() {
    const linked: Record<string, unknown> = {};
    const chain: Readonly<Record<string, unknown>>[] = [];
    for (
      let current = this.#frame.fragment.bindings;
      current && current !== Object.prototype;
      current = Object.getPrototypeOf(current) as Readonly<Record<string, unknown>> | undefined
    )
      chain.push(current);
    for (let index = chain.length - 1; index >= 0; index--)
      for (const key of Object.keys(chain[index])) linked[key] = chain[index][key];
    return {
      ...linked,
      ...this.#hooks.bindings(),
      navigate: (id: string, props?: FragmentProps) => this.navigate(id, props),
      host: (operation: string, ...args: unknown[]) => this.host(operation, args),
    };
  }

  get suspended(): boolean {
    return this.#hooks.suspended();
  }

  step(): void {
    this.#hooks.step();
  }

  random(min: number, max: number): number {
    invariant(this.#phase !== 'render', 'E_PURITY', 'Randomness must be stored during enter/actions.');
    invariant(
      Number.isSafeInteger(min) && Number.isSafeInteger(max) && max >= min && Number.isSafeInteger(max - min + 1),
      'E_RANDOM',
      'Invalid random range.',
    );
    return this.#hooks.random(min, max);
  }

  navigate(target: string | AnyFragment, props: FragmentProps = {}): void {
    this.#alive();
    this.#hooks.navigate(target, props, this.#frame, this.#phase);
  }

  mutate(fn: (state: State) => void): void {
    this.#alive();
    this.#hooks.mutate(fn);
  }

  local<T>(key: string, initialize: (context: FragmentContext) => T): T {
    this.#alive();
    if (this.#frame.locals.has(key)) return this.#frame.locals.get(key) as T;
    const value = initialize(this.#derive('enter'));
    const restored = this.#frame.restoredScopes.get(key);
    if (restored && value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(value as object, cloneState(restored));
      this.#frame.restoredScopes.delete(key);
    }
    this.#frame.locals.set(key, value);
    return value;
  }

  setLocal<T>(key: string, value: T): void {
    this.#alive();
    this.#frame.locals.set(key, value);
  }

  continuation<T extends Json>(key: string, initialize: (context: FragmentContext) => T): T {
    this.#alive();
    safeKey(key);
    const storageKey = `continuation:${key}`;
    if (this.#frame.locals.has(storageKey)) return this.#frame.locals.get(storageKey) as T;
    const value = initialize(this.#derive('enter'));
    assertJson(value);
    const cloned = cloneState(value);
    this.#frame.locals.set(storageKey, cloned);
    return cloned;
  }

  setContinuation<T extends Json>(key: string, value: T): void {
    this.#alive();
    safeKey(key);
    assertJson(value);
    this.#frame.locals.set(`continuation:${key}`, cloneState(value));
  }

  deleteContinuation(key: string): void {
    this.#alive();
    safeKey(key);
    this.#frame.locals.delete(`continuation:${key}`);
  }

  evaluate(input: RenderInput, key = 'nested') {
    this.#alive();
    return evaluateRenderInput(this, input, `${this.#frame.key}/${key}`, this.#hooks.projection);
  }

  suspend(
    key: string,
    resume: ResumeCondition = { type: 'manual' },
    accept?: (value: Json | undefined, context: FragmentContext) => void,
  ): boolean {
    this.#alive();
    return this.#hooks.installSuspension(this.#frame, key, resume, accept);
  }

  effect(key: string, action: (context: FragmentContext) => void): void {
    this.#alive();
    if (this.#frame.locals.has('effect:' + key)) return;
    this.#frame.locals.set('effect:' + key, true);
    if (!this.#hooks.restoring()) action(this.#derive('enter'));
  }

  host(operation: string, args: unknown[] = []): unknown {
    this.#alive();
    invariant(this.#hooks.host, 'HOST_CAPABILITY', `Host operation is unavailable: ${operation}`);
    return this.#hooks.host(operation, args);
  }

  invokeExtension(
    id: string,
    extensionPhase: InvocationPhase,
    args: readonly unknown[],
    children: () => View[],
  ): View[] {
    this.#alive();
    invariant(
      (extensionPhase === 'view' && this.#phase === 'render') ||
        (extensionPhase === 'effect' && this.#phase === 'enter'),
      'RUNTIME_EXTENSION_PHASE',
      `Runtime extension ${id} cannot run during ${this.#phase}.`,
    );
    const extension = this.#hooks.runtimeExtension(id);
    invariant(extension, 'RUNTIME_EXTENSION_MISSING', `Runtime extension is unavailable: ${id}`);
    invariant(
      extension.phases.includes(extensionPhase),
      'RUNTIME_EXTENSION_PHASE',
      `Runtime extension ${id} does not support ${extensionPhase}.`,
    );
    return normalizeView(extension.invoke({ id, phase: extensionPhase, args, context: this, children }) ?? undefined);
  }

  dispatch(action: (context: FragmentContext) => void): void {
    this.#alive();
    invariant(this.#hooks.live, 'CAPABILITY_LIVE', 'This context does not allow live actions.');
    this.#hooks.dispatch(() => action(this.#derive('action')));
  }

  include(target: string | AnyFragment, props: object = {}, key?: string): View[] {
    this.#alive();
    key ??= `call${this.#includes++}`;
    return this.#hooks.include(target, props, this.#frame, key);
  }

  region(name: string): RegionHandle {
    this.#alive();
    invariant(this.#hooks.live, 'CAPABILITY_LIVE', 'This context has no mutable regions.');
    invariant(
      this.#frame.declaredRegions.has(name),
      'REGION_MISSING',
      `No mounted region named ${name} in ${this.#frame.fragment.id}.`,
    );
    const update = (change: () => void) => this.#hooks.updateRegion(this.#frame, name, change);
    return {
      set: (content) => update(() => this.#frame.regions.set(name, { replace: true, before: [], after: [content] })),
      append: (content) =>
        update(() => {
          const existing = this.#frame.regions.get(name) ?? { replace: false, before: [], after: [] };
          existing.after.push(content);
          this.#frame.regions.set(name, existing);
        }),
      prepend: (content) =>
        update(() => {
          const existing = this.#frame.regions.get(name) ?? { replace: false, before: [], after: [] };
          existing.before.unshift(content);
          this.#frame.regions.set(name, existing);
        }),
      clear: () => update(() => this.#frame.regions.set(name, { replace: true, before: [], after: [] })),
      reset: () => update(() => this.#frame.regions.delete(name)),
    } satisfies RegionHandle;
  }

  regionView(name: string, fallback: () => View[]): View {
    safeKey(name);
    this.#frame.declaredRegions.add(name);
    const override = this.#frame.regions.get(name);
    let children = override?.replace ? [] : fallback();
    const renderItems = (items: (ViewInput | AnyFragment)[], side: string) =>
      items.flatMap((content, index) =>
        typeof content === 'object' &&
        content !== null &&
        !Array.isArray(content) &&
        'kind' in content &&
        content.kind === 'gneh.fragment'
          ? this.include(content as AnyFragment, {}, `region:${name}:${side}:${index}`)
          : normalizeView(content as ViewInput),
      );
    if (override)
      children = renderItems(override.before, 'before').concat(children, renderItems(override.after, 'after'));
    return { kind: 'region', key: `${this.#frame.id}/region:${name}`, attrs: { name }, children };
  }

  publish(name: string, value: unknown): void {
    this.#alive();
    this.#hooks.publish(name, value);
  }

  onDispose(cleanup: () => void): void {
    invariant(this.#phase === 'enter', 'LIFECYCLE_PHASE', 'Register disposal during enter(), not during render().');
    this.#frame.cleanups.add(cleanup);
  }
}

export function createFragmentContext(
  hooks: ContextRuntimeHooks,
  frame: Frame,
  phase: EvaluationPhase,
): FragmentContext {
  return new FragmentContextImpl(hooks, frame, phase);
}
