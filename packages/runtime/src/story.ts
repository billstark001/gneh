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
  type Dialect,
  type Fragment,
  type FragmentContext,
  type FragmentProps,
  type Json,
  type RegionHandle,
  type RuntimeExtension,
  type State,
  type StoryIR,
  type View,
  type ViewInput,
} from '@gneh/core';
import { defineIRFragment } from './fragment.js';
import { deepReadonly } from './readonly.js';

export interface Snapshot {
  current: string;
  props: Record<string, Json>;
  state: State;
  seed: number;
}

export interface SaveData {
  abi: typeof ABI_VERSION;
  story: string;
  present: Snapshot;
  past: Snapshot[];
  future: Snapshot[];
}

export interface TraceEvent {
  type: 'enter' | 'render' | 'action' | 'navigate' | 'restore';
  fragment: string;
  state?: State;
}

export interface StoryOptions {
  entry?: string;
  state?: State;
  fragments?: AnyFragment[];
  live?: boolean;
  historyLimit?: number;
  maxSteps?: number;
  bindings?: Record<string, unknown>;
  runtimeExtensions?: Readonly<Record<string, RuntimeExtension>>;
  seed?: number;
  onTrace?: (event: TraceEvent) => void;
  wikify?: (source: string, dialect?: Dialect) => Fragment;
  /** Renderer/application-owned effects. The story kernel never reaches for DOM or browser globals. */
  host?: (operation: string, args: readonly unknown[], story: Story) => unknown;
}

interface RegionOverride {
  replace: boolean;
  before: (ViewInput | AnyFragment)[];
  after: (ViewInput | AnyFragment)[];
}

/** Runtime identity and transient UI state for one mounted Fragment invocation. */
interface Frame {
  id: string;
  fragment: AnyFragment;
  props: FragmentProps;
  alive: boolean;
  entered: boolean;
  cleanups: Set<() => void>;
  regions: Map<string, RegionOverride>;
  declaredRegions: Set<string>;
  locals: Map<string, unknown>;
}

/** Renderer-neutral story kernel. Re-evaluation is batched per transaction (not signal-level). */
export class Story {
  readonly live: boolean;
  readonly fragments = new Map<string, AnyFragment>();
  private aliases = new Map<string, string>();
  private values: State;
  private seed: number;
  private readonly options: StoryOptions;
  private route: string;
  private props: Record<string, Json> = {};
  private frames = new Map<string, Frame>();
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
  constructor(input: StoryIR | AnyFragment[], options: StoryOptions = {}) {
    this.options = options;
    this.live = options.live ?? true;
    if (Array.isArray(input)) {
      for (const f of input) this.register(f);
      this.route = options.entry ?? input[0]?.id ?? '';
      this.values = cloneState(options.state ?? {});
    } else {
      invariant(input.abi === ABI_VERSION, 'ABI_VERSION', `Unsupported story ABI: ${input.abi}`);
      for (const p of input.passages) this.register(defineIRFragment(p));
      this.route = options.entry ?? input.entry;
      this.values = cloneState({ ...input.state, ...options.state });
    }
    for (const f of options.fragments ?? []) this.register(f);
    this.identity = [...this.fragments.keys()].sort().join('|');
    this.seed = (options.seed ?? 123456789) >>> 0;
    this.resolve(this.route);
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
  register(fragment: AnyFragment): void {
    invariant(
      fragment.kind === 'gneh.fragment',
      'FRAGMENT_ABI',
      'Expected a gneh Fragment, not raw HTML or a module namespace.',
    );
    const existing = this.fragments.get(fragment.id);
    if (existing === fragment) return;
    invariant(!existing, 'DUPLICATE_ID', `Duplicate fragment id: ${fragment.id}`);
    invariant(
      this.live || !fragment.capabilities.includes('live'),
      'CAPABILITY_LIVE',
      `${fragment.id} requires the live context.`,
    );
    this.fragments.set(fragment.id, fragment);
    const name = typeof fragment.metadata.name === 'string' ? fragment.metadata.name : fragment.id;
    if (this.aliases.has(name) && this.aliases.get(name) !== fragment.id) this.aliases.set(name, '');
    else this.aliases.set(name, fragment.id);
    // Module-scoped imports/locals form the reachable fragment graph for navigation and save/load.
    for (const value of Object.values(fragment.bindings ?? {}))
      if (value && typeof value === 'object' && (value as AnyFragment).kind === 'gneh.fragment')
        this.register(value as AnyFragment);
  }
  private resolve(target: string | AnyFragment, frame?: Frame): AnyFragment {
    if (typeof target !== 'string') return target;
    const binding = frame?.fragment.bindings?.[target] ?? this.options.bindings?.[target];
    if (binding && typeof binding === 'object' && (binding as AnyFragment).kind === 'gneh.fragment')
      return binding as AnyFragment;
    const fragment = this.fragments.get(target) ?? this.fragments.get(this.aliases.get(target) ?? '');
    invariant(fragment, 'PASSAGE_MISSING', `Unknown or ambiguous fragment: ${target}`);
    return fragment;
  }
  start(): this {
    if (!this.started) {
      const before = this.snapshot();
      this.started = true;
      try {
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
    // `key` is a structural mount path, not a passage id. The same Fragment may
    // therefore be included more than once without sharing regions or cleanups.
    for (const name of Array.isArray(target.metadata.params) ? target.metadata.params : []) {
      if (
        typeof name === 'string' &&
        !(Array.isArray(target.metadata.optionalParams) && target.metadata.optionalParams.includes(name))
      )
        invariant(Object.hasOwn(props, name), 'E_PROPS', `${target.id} requires prop ${name}.`);
    }
    let frame = this.frames.get(key);
    if (frame && frame.fragment !== target) {
      this.disposeFrame(frame);
      this.frames.delete(key);
      frame = undefined;
    }
    if (!frame) {
      invariant(
        this.live || !target.capabilities.includes('live'),
        'CAPABILITY_LIVE',
        `${target.id} requires live rendering.`,
      );
      frame = {
        id: `i${this.frameSerial++}:${key}`,
        fragment: target,
        props,
        alive: true,
        entered: false,
        cleanups: new Set(),
        regions: new Map(),
        declaredRegions: new Set(),
        locals: new Map(),
      };
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
    invariant(this.renderDepth < 128, 'FRAGMENT_DEPTH', 'Maximum fragment recursion exceeded.');
    this.renderDepth++;
    try {
      frame.declaredRegions.clear();
      return normalizeView(frame.fragment.render(this.context(frame, 'render'), deepReadonly(frame.props)));
    } finally {
      this.renderDepth--;
    }
  }
  private context(frame: Frame, phase: 'render' | 'enter' | 'action'): FragmentContext {
    // The context object uses accessors whose `this` is the context itself; retain
    // an explicit kernel reference so every callback closes over the same Story.
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
        return {
          ...story.options.bindings,
          ...frame.fragment.bindings,
          navigate: (id: string, props?: FragmentProps) => context.navigate(id, props),
          host: (operation: string, ...args: unknown[]) => context.host(operation, args),
        };
      },
      live: this.live,
      instanceId: frame.id,
      phase,
      step() {
        if (++story.steps > (story.options.maxSteps ?? 100000))
          throw new GnehError('STEP_LIMIT', 'Execution budget exhausted.');
      },
      random(min, max) {
        invariant(phase !== 'render', 'E_PURITY', 'Randomness must be stored during enter/actions.');
        invariant(
          Number.isSafeInteger(min) && Number.isSafeInteger(max) && max >= min,
          'E_RANDOM',
          'Invalid random range.',
        );
        story.seed = (Math.imul(1664525, story.seed) + 1013904223) >>> 0;
        return min + Math.floor((story.seed / 4294967296) * (max - min + 1));
      },
      navigate(target: string | AnyFragment, props: object = {}) {
        alive();
        const fragment = story.resolve(target, frame);
        if (story.rendering && phase === 'enter') {
          if (!story.fragments.has(fragment.id)) story.register(fragment);
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
        // Declaring during render makes a handle valid only while the region is
        // actually mounted. Overrides belong to the owning frame, not story state.
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
    if (!this.fragments.has(fragment.id)) this.register(fragment);
    else
      invariant(
        this.fragments.get(fragment.id) === fragment,
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
    // Copy-on-transaction isolates mutations until validation, rendering and
    // navigation all succeed. Any failure restores state, RNG and both histories.
    const before = this.snapshot();
    const oldPast = [...this.past],
      oldFuture = [...this.future];
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
      this.restoreSnapshot(before);
      throw error;
    }
  }
  private refresh(): void {
    if (this.rendering) return;
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
          this.disposeFrame(frame);
          this.frames.delete(key);
        }
      assertJson(this.values);
      this.trace('render');
    } finally {
      this.rendering = false;
      this.skipEnter = false;
    }
    for (const listener of this.listeners) listener(this.currentView);
  }
  private disposeFrame(frame: Frame): void {
    frame.alive = false;
    for (const fn of frame.cleanups) {
      try {
        fn();
      } catch (error) {
        console.error('gneh cleanup:', error);
      }
    }
    frame.cleanups.clear();
  }
  private resetFrames(): void {
    for (const frame of this.frames.values()) this.disposeFrame(frame);
    this.frames.clear();
  }
  private restoreSnapshot(snapshot: Snapshot): void {
    this.validateSnapshot(snapshot);
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
    this.restoreSnapshot(previous);
    return true;
  }
  redo(): boolean {
    const next = this.future.pop();
    if (!next) return false;
    this.past.push(this.snapshot());
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
  private validateSnapshot(value: Snapshot): void {
    invariant(value && typeof value === 'object', 'SAVE_SHAPE', 'Invalid save snapshot.');
    this.resolve(value.current);
    assertJson(value.state);
    assertJson(value.props);
    invariant(
      !Array.isArray(value.state) && typeof value.state === 'object' && value.state !== null,
      'SAVE_STATE',
      'Invalid saved state.',
    );
    invariant(
      value.props !== null && typeof value.props === 'object' && !Array.isArray(value.props),
      'SAVE_PROPS',
      'Saved props must be an object.',
    );
    invariant(
      Number.isInteger(value.seed) && value.seed >= 0 && value.seed <= 4294967295,
      'SAVE_SEED',
      'Invalid saved random state.',
    );
  }
  load(source: string): void {
    const data = JSON.parse(source) as SaveData;
    invariant(
      data.abi === ABI_VERSION && data.story === this.identity,
      'SAVE_STORY',
      'Save ABI or story identity does not match.',
    );
    invariant(Array.isArray(data.past) && Array.isArray(data.future), 'SAVE_HISTORY', 'Invalid save history.');
    for (const snapshot of [...data.past, ...data.future, data.present]) this.validateSnapshot(snapshot);
    this.past = data.past.slice(-(this.options.historyLimit ?? 100));
    this.future = data.future.slice(-(this.options.historyLimit ?? 100));
    this.restoreSnapshot(data.present);
  }
  dispose(): void {
    this.resetFrames();
    this.listeners.clear();
    this.currentView = [];
  }
}

export const createStory = (input: StoryIR | AnyFragment[], options?: StoryOptions): Story => new Story(input, options);
