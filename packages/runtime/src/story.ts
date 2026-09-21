/** Renderer-neutral story kernel, lifecycle, history and regions. */
import {
  ABI_VERSION,
  GnehError,
  assertJson,
  cloneState,
  invariant,
  normalizeView,
  safeKey,
  type AnyFragment,
  type FragmentContext,
  type FragmentProps,
  type Json,
  type RegionHandle,
  type State,
  type StoryIR,
  type View,
  type ViewInput,
} from '@gneh/core';
import { deepReadonly } from './readonly.js';
import { type Passage, type PassageSet, isPassage } from './definition.js';
import * as storySupport from './story-support.js';
import type { Frame, SaveData, Snapshot, StoryOptions, TraceEvent } from './story-types.js';

const maxFragmentDepth = 128;

export type { SaveData, Snapshot, StoryOptions, TraceEvent } from './story-types.js';

/** Renderer-neutral story kernel. Re-evaluation is batched per transaction (not signal-level). */
export class Story {
  readonly live: boolean;
  private readonly passageRegistry = new Map<string, AnyFragment>();
  private readonly setup: readonly Passage[];
  private readonly initialState: State;
  private readonly initialRoute: string;
  private values: State;
  private seed: number;
  private readonly options: StoryOptions;
  private route: string;
  private props: Record<string, Json> = {};
  private frames = new Map<string, Frame>();
  private setupFrames = new Map<string, Frame>();
  private registry = new Map<string, unknown>();
  private visited = new Set<string>();
  private listeners = new Set<(view: View[]) => void>();
  private currentView: View[] = [];
  private steps = 0;
  private frameSerial = 0;
  private past: Snapshot[] = [];
  private future: Snapshot[] = [];
  private transactionDepth = 0;
  private rendering = false;
  private started = false;
  private skipEnter = false;
  private newFrames = false;
  private pendingRoute:
    | {
        id: string;
        props: Record<string, Json>;
      }
    | undefined;
  private readonly identity: string;
  private renderDepth = 0;
  private settingUp = false;
  constructor(input: StoryIR | PassageSet, options: StoryOptions = {}) {
    this.options = { ...options };
    this.live = this.options.live ?? true;
    const initialized = storySupport.initializeStoryInput(input, this.options, (passage) => this.register(passage));
    this.route = initialized.route;
    this.values = initialized.values;
    this.setup = initialized.setup;
    this.identity = [...this.passageRegistry.keys()].sort().join('|');
    this.seed = (options.seed ?? 123456789) >>> 0;
    this.resolve(this.route);
    this.initialState = cloneState(this.values);
    this.initialRoute = this.route;
  }
  get state(): Readonly<State> {
    return deepReadonly(this.values);
  }
  get current(): string {
    return this.route;
  }
  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }
  get view(): View[] {
    if (!this.started) this.start();
    return this.currentView;
  }
  get passages(): ReadonlyMap<string, AnyFragment> {
    return new Map(this.passageRegistry);
  }
  register(fragment: AnyFragment): void {
    invariant(isPassage(fragment), 'FRAGMENT_ABI', 'Expected a branded gneh Passage.');
    const existing = this.passageRegistry.get(fragment.id);
    if (existing === fragment) return;
    invariant(!existing, 'DUPLICATE_ID', `Duplicate passage id: ${fragment.id}`);
    invariant(
      this.live || !fragment.capabilities.includes('live'),
      'CAPABILITY_LIVE',
      `${fragment.id} requires the live context.`,
    );
    this.passageRegistry.set(fragment.id, fragment);
  }
  private resolve(target: string | AnyFragment, frame?: Frame): AnyFragment {
    if (typeof target !== 'string') return target;
    const binding = frame?.fragment.bindings?.[target] ?? this.options.bindings?.[target];
    if (binding && typeof binding === 'object' && (binding as AnyFragment).kind === 'gneh.fragment')
      return binding as AnyFragment;
    const fragment = this.passageRegistry.get(target);
    invariant(fragment, 'PASSAGE_MISSING', `Unknown passage: ${target}`);
    return fragment;
  }
  start(): this {
    if (!this.started) {
      const before = this.snapshot();
      this.started = true;
      try {
        this.registry.clear();
        this.runSetup();
        this.refresh();
      } catch (error) {
        this.resetFrames();
        this.route = before.current;
        this.props = cloneState(before.props);
        this.values = before.state;
        this.seed = before.seed;
        this.pendingRoute = undefined;
        this.renderDepth = 0;
        this.started = false;
        this.registry.clear();
        this.resetSetupFrames();
        throw error;
      }
    }
    return this;
  }
  subscribe(listener: (view: View[]) => void): () => void {
    this.listeners.add(listener);
    listener(this.view);
    return () => this.listeners.delete(listener);
  }
  private snapshot(): Snapshot {
    return {
      current: this.route,
      props: cloneState(this.props),
      state: cloneState(this.values),
      seed: this.seed,
    };
  }
  private trace(type: TraceEvent['type']): void {
    this.options.onTrace?.({ type, fragment: this.route, state: cloneState(this.values) });
  }
  private frame(target: AnyFragment, props: FragmentProps, key: string): Frame {
    // Structural mount keys let repeated Fragment includes keep regions and cleanups isolated.
    for (const name of Array.isArray(target.metadata.params) ? target.metadata.params : []) {
      if (
        typeof name === 'string' &&
        !(Array.isArray(target.metadata.optionalParams) && target.metadata.optionalParams.includes(name))
      )
        invariant(Object.hasOwn(props, name), 'E_PROPS', `${target.id} requires prop ${name}.`);
    }
    let frame = this.frames.get(key);
    if (frame && frame.fragment !== target) {
      storySupport.disposeFrame(frame);
      this.frames.delete(key);
      frame = undefined;
    }
    if (!frame) {
      invariant(
        this.live || !target.capabilities.includes('live'),
        'CAPABILITY_LIVE',
        `${target.id} requires live rendering.`,
      );
      frame = storySupport.createFrame(`i${this.frameSerial++}:${key}`, target, props);
      this.frames.set(key, frame);
      this.newFrames = true;
    }
    frame.props = props;
    this.visited.add(key);
    if (!frame.entered) {
      frame.entered = true;
      if (!this.skipEnter && target.enter) {
        target.enter(this.context(frame, 'enter'), props);
        this.trace('enter');
      }
    }
    return frame;
  }
  private renderFrame(frame: Frame): View[] {
    invariant(this.renderDepth < maxFragmentDepth, 'FRAGMENT_DEPTH', 'Maximum fragment recursion exceeded.');
    this.renderDepth++;
    try {
      frame.declaredRegions.clear();
      return normalizeView(frame.fragment.render(this.context(frame, 'render'), deepReadonly(frame.props)));
    } finally {
      this.renderDepth--;
    }
  }
  private context(frame: Frame, phase: 'render' | 'enter' | 'action'): FragmentContext {
    // Keep an explicit kernel reference because accessors bind `this` to the context object.
    // oxlint-disable-next-line typescript/no-this-alias
    const story = this;
    let includes = 0;
    const alive = () => invariant(frame.alive, 'INSTANCE_DISPOSED', 'This fragment instance has been disposed.');
    const context: FragmentContext = {
      get state() {
        // Render is pure by contract. Enter/actions receive the transaction's
        // private mutable copy, which is validated before it becomes observable.
        return phase === 'render' ? deepReadonly(story.values) : story.values;
      },
      get bindings() {
        const linked: Record<string, unknown> = {};
        const chain: Readonly<Record<string, unknown>>[] = [];
        for (
          let current = frame.fragment.bindings;
          current && current !== Object.prototype;
          current = Object.getPrototypeOf(current) as Readonly<Record<string, unknown>> | undefined
        )
          chain.push(current);
        for (let index = chain.length - 1; index >= 0; index--)
          for (const key of Object.keys(chain[index])) linked[key] = chain[index][key];
        return {
          ...linked,
          ...story.options.bindings,
          ...Object.fromEntries(story.registry),
          navigate: (id: string, props?: FragmentProps) => context.navigate(id, props),
          host: (operation: string, ...args: unknown[]) => context.host(operation, args),
        };
      },
      live: this.live,
      instanceId: frame.id,
      restoring: story.skipEnter,
      phase,
      step() {
        if (++story.steps > (story.options.maxSteps ?? 100000))
          throw new GnehError('STEP_LIMIT', 'Execution budget exhausted.');
      },
      random(min, max) {
        invariant(phase !== 'render', 'E_PURITY', 'Randomness must be stored during enter/actions.');
        invariant(
          Number.isSafeInteger(min) && Number.isSafeInteger(max) && max >= min && Number.isSafeInteger(max - min + 1),
          'E_RANDOM',
          'Invalid random range.',
        );
        story.seed = (Math.imul(1664525, story.seed) + 1013904223) >>> 0;
        return min + Math.floor((story.seed / 4294967296) * (max - min + 1));
      },
      navigate(target: string | AnyFragment, props: object = {}) {
        alive();
        invariant(!story.settingUp, 'SETUP_NAVIGATION', 'Setup passages cannot navigate.');
        const fragment = story.resolve(target, frame);
        if (story.rendering && phase === 'enter') {
          if (!story.passageRegistry.has(fragment.id)) story.register(fragment);
          story.pendingRoute = {
            id: fragment.id,
            props: cloneState(props as Record<string, Json>),
          };
          story.newFrames = true;
          return;
        }
        story.navigate(fragment, props as FragmentProps);
      },
      mutate(fn) {
        alive();
        story.mutate(fn);
      },
      local<T>(key: string, initialize: (ctx: FragmentContext) => T): T {
        alive();
        if (frame.locals.has(key)) return frame.locals.get(key) as T;
        const value = initialize(story.context(frame, 'enter'));
        frame.locals.set(key, value);
        return value;
      },
      setLocal<T>(key: string, value: T) {
        alive();
        frame.locals.set(key, value);
      },
      effect(key, action) {
        alive();
        if (frame.locals.has('effect:' + key)) return;
        frame.locals.set('effect:' + key, true);
        if (!story.skipEnter) action(story.context(frame, 'enter'));
      },
      host(operation, args = []) {
        alive();
        invariant(story.options.host, 'HOST_CAPABILITY', `Host operation is unavailable: ${operation}`);
        return story.options.host(operation, args, story);
      },
      invokeExtension(id, extensionPhase, args, children) {
        alive();
        invariant(
          (extensionPhase === 'view' && phase === 'render') || (extensionPhase === 'effect' && phase === 'enter'),
          'RUNTIME_EXTENSION_PHASE',
          `Runtime extension ${id} cannot run during ${phase}.`,
        );
        const extension = story.options.runtimeExtensions?.[id];
        invariant(extension, 'RUNTIME_EXTENSION_MISSING', `Runtime extension is unavailable: ${id}`);
        invariant(
          extension.phases.includes(extensionPhase),
          'RUNTIME_EXTENSION_PHASE',
          `Runtime extension ${id} does not support ${extensionPhase}.`,
        );
        return normalizeView(extension.invoke({ id, phase: extensionPhase, args, context, children }) ?? undefined);
      },
      dispatch(action) {
        alive();
        invariant(story.live, 'CAPABILITY_LIVE', 'This context does not allow live actions.');
        story.transact('action', () => action(story.context(frame, 'action')));
      },
      include(target: string | AnyFragment, props: object = {}, key = `call${includes++}`) {
        alive();
        const fragment = story.resolve(target, frame);
        const child = story.frame(fragment, props as FragmentProps, `${frame.id}/${key}`);
        return story.renderFrame(child);
      },
      region(name) {
        alive();
        invariant(story.live, 'CAPABILITY_LIVE', 'This context has no mutable regions.');
        invariant(
          frame.declaredRegions.has(name),
          'REGION_MISSING',
          `No mounted region named ${name} in ${frame.fragment.id}.`,
        );
        return story.regionHandle(frame, name);
      },
      regionView(name, fallback) {
        // A handle is valid only while mounted; overrides belong to its frame, not story state.
        safeKey(name);
        frame.declaredRegions.add(name);
        const override = frame.regions.get(name);
        let children = override?.replace ? [] : fallback();
        const renderItems = (items: (ViewInput | AnyFragment)[], side: string) =>
          items.flatMap((content, index) =>
            typeof content === 'object' &&
            content !== null &&
            !Array.isArray(content) &&
            'kind' in content &&
            content.kind === 'gneh.fragment'
              ? context.include(content as AnyFragment, {}, `region:${name}:${side}:${index}`)
              : normalizeView(content as ViewInput),
          );
        if (override)
          children = renderItems(override.before, 'before').concat(children, renderItems(override.after, 'after'));
        return { kind: 'region', key: `${frame.id}/region:${name}`, attrs: { name }, children };
      },
      onDispose(cleanup) {
        invariant(phase === 'enter', 'LIFECYCLE_PHASE', 'Register disposal during enter(), not during render().');
        frame.cleanups.add(cleanup);
      },
      publish(name, value) {
        alive();
        safeKey(name);
        story.registry.set(name, value);
      },
    };
    if (this.options.wikify) context.wikify = this.options.wikify;
    return context;
  }
  private regionHandle(frame: Frame, name: string): RegionHandle {
    const update = (fn: () => void) => {
      invariant(frame.alive, 'INSTANCE_DISPOSED', 'Region owner is no longer mounted.');
      invariant(frame.declaredRegions.has(name), 'REGION_MISSING', 'Region is no longer visible.');
      fn();
      if (this.rendering) this.newFrames = true;
      else if (!this.transactionDepth) this.refresh();
    };
    return {
      set: (content) => update(() => frame.regions.set(name, { replace: true, before: [], after: [content] })),
      append: (content) =>
        update(() => {
          const existing = frame.regions.get(name) ?? {
            replace: false,
            before: [],
            after: [],
          };
          existing.after.push(content);
          frame.regions.set(name, existing);
        }),
      prepend: (content) =>
        update(() => {
          const existing = frame.regions.get(name) ?? {
            replace: false,
            before: [],
            after: [],
          };
          existing.before.unshift(content);
          frame.regions.set(name, existing);
        }),
      clear: () => update(() => frame.regions.set(name, { replace: true, before: [], after: [] })),
      reset: () => update(() => frame.regions.delete(name)),
    };
  }
  /** Root-scoped lookup. Nested fragment regions stay private to their own context. */
  region(name: string): RegionHandle {
    const root = this.frames.get('root');
    invariant(root, 'NOT_STARTED', 'Start the story first.');
    return this.context(root, 'action').region(name);
  }
  mutate(fn: (state: State) => void): void {
    invariant(this.live, 'CAPABILITY_LIVE', 'Snapshot context does not allow in-place actions.');
    this.transact('action', () => fn(this.values));
  }
  navigate(target: string | AnyFragment, props: FragmentProps = {}): void {
    const fragment = this.resolve(target);
    if (!this.passageRegistry.has(fragment.id)) this.register(fragment);
    else
      invariant(
        this.passageRegistry.get(fragment.id) === fragment,
        'DUPLICATE_ID',
        `Navigation target id collides: ${fragment.id}`,
      );
    assertJson(props);
    this.transact('navigate', () => {
      this.pendingRoute = { id: fragment.id, props: cloneState(props as Record<string, Json>) };
    });
  }
  private transact(type: 'action' | 'navigate', action: () => void): void {
    invariant(!this.rendering, 'RENDER_EFFECT', 'Navigation and mutations cannot occur while rendering.');
    if (this.transactionDepth) {
      action();
      return;
    }
    // Copy-on-transaction isolates changes; failure restores state, RNG, and both histories.
    const before = this.snapshot();
    const oldPast = [...this.past],
      oldFuture = [...this.future];
    const oldRegistry = new Map(this.registry);
    this.values = cloneState(this.values);
    this.steps = 0;
    this.transactionDepth++;
    try {
      action();
      assertJson(this.values);
      if (this.pendingRoute) {
        const next = this.pendingRoute;
        this.pendingRoute = undefined;
        this.route = next.id;
        this.props = next.props;
        this.resetFrames();
      }
      this.transactionDepth--;
      this.past.push(before);
      if (this.past.length > (this.options.historyLimit ?? 100)) this.past.shift();
      this.future = [];
      this.refresh();
      this.trace(type);
    } catch (error) {
      this.transactionDepth = 0;
      this.pendingRoute = undefined;
      this.past = oldPast;
      this.future = oldFuture;
      this.registry = oldRegistry;
      this.restoreSnapshot(before);
      throw error;
    }
  }
  private refresh(): void {
    if (this.rendering) return;
    const oldRegistry = new Map(this.registry);
    this.rendering = true;
    this.steps = 0;
    try {
      // A render can discover a new child or apply a source-order region change.
      // Re-render until those one-shot effects settle, then sweep dead frames.
      let iteration = 0;
      do {
        this.newFrames = false;
        this.visited.clear();
        const root = this.frame(this.resolve(this.route), this.props, 'root');
        this.currentView = this.renderFrame(root);
        if (this.pendingRoute) {
          const next = this.pendingRoute;
          this.pendingRoute = undefined;
          this.route = next.id;
          this.props = next.props;
          this.resetFrames();
          this.newFrames = true;
        }
        invariant(++iteration <= 16, 'MOUNT_LOOP', 'Fragment initialization did not settle.');
      } while (this.newFrames);
      for (const [key, frame] of this.frames)
        if (!this.visited.has(key)) {
          storySupport.disposeFrame(frame);
          this.frames.delete(key);
        }
      assertJson(this.values);
      this.trace('render');
    } catch (error) {
      this.registry = oldRegistry;
      throw error;
    } finally {
      this.rendering = false;
      this.skipEnter = false;
    }
    for (const listener of this.listeners) listener(this.currentView);
  }
  private resetFrames(): void {
    for (const frame of this.frames.values()) storySupport.disposeFrame(frame);
    this.frames.clear();
  }
  private resetSetupFrames(): void {
    for (const frame of this.setupFrames.values()) storySupport.disposeFrame(frame);
    this.setupFrames.clear();
  }
  private runSetup(): void {
    if (!this.setup.length) return;
    const beforeState = cloneState(this.values);
    const beforeRegistry = new Map(this.registry);
    this.values = cloneState(this.values);
    this.resetSetupFrames();
    this.settingUp = true;
    try {
      for (const passage of this.setup) {
        const frame = storySupport.createFrame(`setup:${passage.id}`, passage, {}, true);
        this.setupFrames.set(passage.id, frame);
        passage.enter?.(this.context(frame, 'enter'), {});
        passage.render(this.context(frame, 'enter'), {});
      }
      assertJson(this.values);
    } catch (error) {
      this.values = beforeState;
      this.registry = beforeRegistry;
      this.resetSetupFrames();
      throw error;
    } finally {
      this.settingUp = false;
    }
  }
  private restoreSnapshot(snapshot: Snapshot): void {
    storySupport.validateSnapshot(snapshot, (id) => this.resolve(id));
    this.route = snapshot.current;
    this.props = cloneState(snapshot.props);
    this.values = cloneState(snapshot.state);
    this.seed = snapshot.seed;
    this.resetFrames();
    // Restoration recreates view-local frames, but must not replay semantic entry
    // effects that are already represented by the restored persistent state.
    this.skipEnter = true;
    this.refresh();
    this.trace('restore');
  }
  undo(): boolean {
    const previous = this.past.pop();
    if (!previous) return false;
    this.future.push(this.snapshot());
    if (this.future.length > (this.options.historyLimit ?? 100)) this.future.shift();
    this.restoreSnapshot(previous);
    return true;
  }
  redo(): boolean {
    const next = this.future.pop();
    if (!next) return false;
    this.past.push(this.snapshot());
    if (this.past.length > (this.options.historyLimit ?? 100)) this.past.shift();
    this.restoreSnapshot(next);
    return true;
  }
  save(): string {
    const data: SaveData = {
      abi: ABI_VERSION,
      story: this.identity,
      present: this.snapshot(),
      past: this.past,
      future: this.future,
    };
    return JSON.stringify(data);
  }
  load(source: string): void {
    const data = storySupport.readSave(source, this.identity, (id) => this.resolve(id));
    const before = this.snapshot();
    const beforePast = this.past;
    const beforeFuture = this.future;
    const beforeRegistry = new Map(this.registry);
    try {
      this.past = storySupport.boundedHistory(data.past, this.options.historyLimit);
      this.future = storySupport.boundedHistory(data.future, this.options.historyLimit);
      this.route = data.present.current;
      this.props = cloneState(data.present.props);
      this.values = cloneState(data.present.state);
      this.seed = data.present.seed;
      this.resetFrames();
      this.registry.clear();
      this.runSetup();
      this.skipEnter = true;
      this.refresh();
      this.trace('restore');
      this.started = true;
    } catch (error) {
      this.resetFrames();
      this.route = before.current;
      this.props = cloneState(before.props);
      this.values = cloneState(before.state);
      this.seed = before.seed;
      this.past = beforePast;
      this.future = beforeFuture;
      this.registry = beforeRegistry;
      this.skipEnter = true;
      this.refresh();
      throw error;
    }
  }
  reset(): void {
    const before = this.snapshot();
    const beforePast = this.past;
    const beforeFuture = this.future;
    const beforeRegistry = new Map(this.registry);
    try {
      this.route = this.initialRoute;
      this.props = {};
      this.values = cloneState(this.initialState);
      this.seed = (this.options.seed ?? 123456789) >>> 0;
      this.past = [];
      this.future = [];
      this.registry.clear();
      this.resetFrames();
      this.runSetup();
      this.refresh();
      this.started = true;
    } catch (error) {
      this.resetFrames();
      this.route = before.current;
      this.props = cloneState(before.props);
      this.values = cloneState(before.state);
      this.seed = before.seed;
      this.past = beforePast;
      this.future = beforeFuture;
      this.registry = beforeRegistry;
      this.skipEnter = true;
      this.refresh();
      throw error;
    }
  }
  get registrations(): ReadonlyMap<string, unknown> {
    return new Map(this.registry);
  }
  dispose(): void {
    this.resetFrames();
    this.resetSetupFrames();
    this.registry.clear();
    this.listeners.clear();
    this.currentView = [];
  }
}

export const createStory = (input: StoryIR | PassageSet, options?: StoryOptions): Story => new Story(input, options);
