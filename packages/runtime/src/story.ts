/* oxlint-disable max-lines -- lifecycle, continuation, and transaction invariants stay in one kernel. */
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
  type Flow,
  type FlowEach,
  type FlowNode,
  type Json,
  type RenderEvaluation,
  type RenderInput,
  type ResumeCondition,
  type RegionHandle,
  type State,
  type StoryIR,
  type View,
  type ViewInput,
} from '@gneh/core';
import { deepReadonly } from './readonly.js';
import { isPassage } from './definition.js';
import * as storySupport from './story-support.js';
import type {
  ActiveSuspension,
  ContinuationSnapshot,
  SaveData,
  Snapshot,
  StoryOptions,
  TraceEvent,
  Passage,
  PassageSet,
} from './api-types.js';
import type { Frame } from './story-internals.js';

const maxFragmentDepth = 128;

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
  private restoredContinuations = new Map<string, ContinuationSnapshot>();
  private activeFlow:
    | {
        descriptor: ActiveSuspension;
        frame: Frame;
        accept?: (value: Json | undefined, ctx: FragmentContext) => void;
      }
    | undefined;
  constructor(input: StoryIR | PassageSet, options: StoryOptions = {}) {
    this.options = { ...options, flow: options.flow ? { ...options.flow } : undefined };
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
  get suspension(): ActiveSuspension | undefined {
    const descriptor = this.activeFlow?.descriptor;
    return descriptor ? { ...descriptor, resume: cloneState(descriptor.resume) } : undefined;
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
      continuations: Object.fromEntries(
        [...this.frames.entries()]
          .map(([key, frame]) => [key, this.serializeContinuation(frame)] as const)
          .filter((entry): entry is readonly [string, ContinuationSnapshot] => entry[1] !== undefined),
      ),
    };
  }
  private serializeContinuation(frame: Frame): ContinuationSnapshot | undefined {
    const locals: Record<string, Json> = Object.create(null) as Record<string, Json>;
    const scopes: Record<string, State> = Object.create(null) as Record<string, State>;
    for (const [key, value] of frame.locals) {
      if (key.startsWith('scope:') && value && typeof value === 'object' && !Array.isArray(value)) {
        const slots: State = Object.create(null) as State;
        for (const [name, slot] of Object.entries(value)) {
          if (name.startsWith('__')) continue;
          try {
            assertJson(slot);
            slots[name] = cloneState(slot);
          } catch (error) {
            if (name.startsWith('_')) throw error;
          }
        }
        scopes[key] = slots;
        continue;
      }
      try {
        assertJson(value);
        locals[key] = cloneState(value);
      } catch {
        // Runtime callables, native handles and other transient implementation
        // values are reconstructed. JSON locals are retained without liveness pruning.
      }
    }
    if (!frame.passed.size && !Object.keys(locals).length && !Object.keys(scopes).length) return;
    return {
      fragment: frame.fragment.id,
      passed: [...frame.passed],
      locals,
      scopes,
    };
  }
  private trace(type: TraceEvent['type']): void {
    this.options.onTrace?.({ type, fragment: this.route, state: cloneState(this.values) });
  }
  private frame(target: AnyFragment, props: FragmentProps, key: string): Frame {
    // Structural mount keys let repeated Fragment includes keep regions and cleanups isolated.
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
      frame = storySupport.createFrame(`i${this.frameSerial++}:${key}`, target, props, false, key);
      const restored = this.restoredContinuations.get(key);
      if (restored) {
        invariant(restored.fragment === target.id, 'SAVE_CONTINUATION', `Continuation target changed at ${key}.`);
        frame.passed = new Set(restored.passed);
        for (const [localKey, value] of Object.entries(restored.locals)) frame.locals.set(localKey, cloneState(value));
        frame.restoredScopes = new Map(
          Object.entries(restored.scopes).map(([scopeKey, value]) => [scopeKey, cloneState(value)]),
        );
      }
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
      const context = this.context(frame, 'render');
      return this.evaluateRenderInput(
        frame,
        context,
        frame.fragment.render(context, deepReadonly(frame.props)),
        `${frame.key}/flow`,
      ).view;
    } finally {
      this.renderDepth--;
    }
  }
  private evaluateRenderInput(
    frame: Frame,
    context: FragmentContext,
    input: RenderInput,
    path: string,
  ): RenderEvaluation {
    const segments: View[][] = [[]];
    const splitBoundaries = (view: View): View[] => {
      if (view.kind === 'suspend' || !view.children?.length) return [view];
      const flattened = view.children.flatMap(splitBoundaries);
      if (!flattened.some((child) => child.kind === 'suspend')) return [view];
      const output: View[] = [];
      let children: View[] = [];
      let part = 0;
      const flush = () => {
        if (!children.length) return;
        output.push({ ...view, key: view.key ? `${view.key}:flow:${part++}` : undefined, children });
        children = [];
      };
      for (const child of flattened) {
        if (child.kind === 'suspend') {
          flush();
          output.push(child);
        } else children.push(child);
      }
      flush();
      return output;
    };
    const appendViews = (views: View[]) => {
      for (const view of views.flatMap(splitBoundaries)) {
        if (view.kind === 'suspend') {
          if (segments.at(-1)!.length || segments.length === 1) segments.push([]);
          if (view.attrs?.active) break;
        } else segments.at(-1)!.push(view);
      }
    };
    const visit = (value: RenderInput | FlowNode, currentPath: string): void => {
      if (value && typeof value === 'object' && !Array.isArray(value) && value.kind === 'gneh.flow') {
        const flow = value as Flow;
        for (let index = 0; index < flow.nodes.length && !context.suspended; index++)
          visit(flow.nodes[index], `${currentPath}/${index}`);
        return;
      }
      if (value && typeof value === 'object' && !Array.isArray(value) && value.kind === 'gneh.flow.lazy') {
        const lazy = value as import('@gneh/core').FlowLazy;
        visit(lazy.render(context), `${currentPath}/${lazy.id ?? 'lazy'}`);
        return;
      }
      if (value && typeof value === 'object' && !Array.isArray(value) && value.kind === 'gneh.flow.suspend') {
        const suspension = value as import('@gneh/core').FlowSuspend;
        const key = `${currentPath}/${suspension.id ?? 'suspend'}`;
        const stopped = context.suspend(
          key,
          suspension.resume,
          suspension.bind
            ? (resumeValue, actionContext) => {
                actionContext.setContinuation(suspension.bind!, resumeValue ?? null);
              }
            : undefined,
        );
        segments.push([]);
        if (stopped) return;
        return;
      }
      if (value && typeof value === 'object' && !Array.isArray(value) && value.kind === 'gneh.flow.each') {
        const each = value as FlowEach;
        const loopPath = `${currentPath}/${each.id ?? 'each'}`;
        const items = context.continuation(`flow:items:${loopPath}`, (initial) => {
          const resolved = typeof each.items === 'function' ? each.items(initial) : each.items;
          invariant(Array.isArray(resolved), 'E_ITERABLE', 'A flow loop requires an array.');
          assertJson(resolved);
          return cloneState(resolved as Json[]);
        });
        const seen = new Set<string>();
        for (let index = 0; index < items.length && !context.suspended; index++) {
          const item = items[index];
          const identity = each.key(item, index);
          invariant(
            typeof identity === 'string' || typeof identity === 'number',
            'E_KEY',
            'Flow loop keys must be strings or numbers.',
          );
          const stable = JSON.stringify(identity);
          invariant(!seen.has(stable), 'DUPLICATE_KEY', `Duplicate flow loop key: ${stable}`);
          seen.add(stable);
          visit(each.render(item, index, context), `${loopPath}/${stable}`);
        }
        if (!context.suspended) context.deleteContinuation(`flow:items:${loopPath}`);
        return;
      }
      appendViews(normalizeView(value as ViewInput));
    };
    visit(input, path);
    const nonempty = segments.filter((segment) => segment.length > 0);
    const projection = this.options.flow?.projection ?? 'revealed';
    const view = projection === 'current' ? (nonempty.at(-1) ?? []) : nonempty.flatMap((segment) => segment);
    return { view, suspended: context.suspended };
  }
  private installSuspension(
    frame: Frame,
    key: string,
    resume: ResumeCondition,
    accept?: (value: Json | undefined, ctx: FragmentContext) => void,
  ): boolean {
    safeKey(key);
    assertJson(resume);
    if (resume.type === 'timer')
      invariant(
        Number.isFinite(resume.durationMs) && resume.durationMs >= 0,
        'SUSPEND_TIMER',
        'Timer duration must be a finite non-negative number.',
      );
    if (frame.passed.has(key) || this.options.flow?.projection === 'all') return false;
    if (!this.activeFlow) {
      const timer =
        resume.type === 'timer'
          ? (() => {
              const timerKey = `suspension:timer:${key}`;
              const startedAt = frame.locals.has(timerKey)
                ? (frame.locals.get(timerKey) as number)
                : (this.options.now?.() ?? Date.now());
              frame.locals.set(timerKey, startedAt);
              return { startedAt, dueAt: startedAt + resume.durationMs };
            })()
          : {};
      const descriptor: ActiveSuspension = {
        key,
        fragment: frame.fragment.id,
        instanceId: frame.id,
        resume: cloneState(resume),
        ...timer,
      };
      this.activeFlow = { descriptor, frame, accept };
    }
    return true;
  }
  private context(frame: Frame, phase: 'render' | 'enter' | 'action'): FragmentContext {
    // Keep an explicit kernel reference because accessors bind `this` to the context object.
    // oxlint-disable-next-line typescript/no-this-alias
    const story = this;
    let includes = 0;
    const alive = () => invariant(frame.alive, 'INSTANCE_DISPOSED', 'This fragment instance has been disposed.');
    const readonlyState = phase === 'render' ? deepReadonly(story.values) : undefined;
    const context: FragmentContext = {
      get state() {
        // Render is pure by contract. Enter/actions receive the transaction's
        // private mutable copy, which is validated before it becomes observable.
        return readonlyState ?? story.values;
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
      mountKey: frame.key,
      restoring: story.skipEnter,
      get suspended() {
        return !!story.activeFlow;
      },
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
        const restored = frame.restoredScopes.get(key);
        if (restored && value && typeof value === 'object' && !Array.isArray(value)) {
          Object.assign(value as object, cloneState(restored));
          frame.restoredScopes.delete(key);
        }
        frame.locals.set(key, value);
        return value;
      },
      setLocal<T>(key: string, value: T) {
        alive();
        frame.locals.set(key, value);
      },
      continuation<T extends Json>(key: string, initialize: (ctx: FragmentContext) => T): T {
        alive();
        safeKey(key);
        const storageKey = `continuation:${key}`;
        if (frame.locals.has(storageKey)) return frame.locals.get(storageKey) as T;
        const value = initialize(story.context(frame, 'enter'));
        assertJson(value);
        const cloned = cloneState(value);
        frame.locals.set(storageKey, cloned);
        return cloned;
      },
      setContinuation<T extends Json>(key: string, value: T) {
        alive();
        safeKey(key);
        assertJson(value);
        frame.locals.set(`continuation:${key}`, cloneState(value));
      },
      deleteContinuation(key) {
        alive();
        safeKey(key);
        frame.locals.delete(`continuation:${key}`);
      },
      evaluate(input, key = 'nested') {
        alive();
        return story.evaluateRenderInput(frame, context, input, `${frame.key}/${key}`);
      },
      suspend(key, resume = { type: 'manual' }, accept) {
        alive();
        return story.installSuspension(frame, key, resume, accept);
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
        const child = story.frame(fragment, props as FragmentProps, `${frame.key}/${key}`);
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
  private resumeActive(value?: Json): boolean {
    const active = this.activeFlow;
    if (!active) return false;
    if (value !== undefined) assertJson(value);
    this.transact('resume', () => {
      active.frame.passed.add(active.descriptor.key);
      active.accept?.(value === undefined ? undefined : cloneState(value), this.context(active.frame, 'action'));
      this.activeFlow = undefined;
    });
    return true;
  }
  /** Resume a manual suspension. */
  advance(value?: Json): boolean {
    if (this.activeFlow?.descriptor.resume.type !== 'manual') return false;
    return this.resumeActive(value);
  }
  /** Deliver a named signal to the active suspension. */
  signal(name: string, value?: Json): boolean {
    const condition = this.activeFlow?.descriptor.resume;
    if (!condition || condition.type !== 'signal' || condition.name !== name) return false;
    if (condition.filter !== undefined && JSON.stringify(condition.filter) !== JSON.stringify(value)) return false;
    return this.resumeActive(value);
  }
  /** Resume a timer suspension once the injected clock reaches its deadline. */
  tick(now = this.options.now?.() ?? Date.now()): boolean {
    const active = this.activeFlow?.descriptor;
    if (!active || active.resume.type !== 'timer' || active.dueAt === undefined || now < active.dueAt) return false;
    return this.resumeActive(now);
  }
  /** Complete an application-owned task suspension with a JSON result. */
  completeTask(operation: string, value?: Json): boolean {
    const condition = this.activeFlow?.descriptor.resume;
    if (!condition || condition.type !== 'task' || condition.operation !== operation) return false;
    return this.resumeActive(value);
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
  private transact(type: 'action' | 'navigate' | 'resume', action: () => void): void {
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
    this.activeFlow = undefined;
    this.steps = 0;
    try {
      // A render can discover a new child or apply a source-order region change.
      // Re-render until those one-shot effects settle, then sweep dead frames.
      let iteration = 0;
      do {
        // A settling pass supersedes the previous pass's frontier descriptor.
        // Passed keys live on the frame; the active descriptor is render-derived.
        this.activeFlow = undefined;
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
      this.restoredContinuations.clear();
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
    this.activeFlow = undefined;
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
    this.restoredContinuations = new Map(Object.entries(cloneState(snapshot.continuations)));
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
    const wasStarted = this.started;
    try {
      this.past = storySupport.boundedHistory(data.past, this.options.historyLimit);
      this.future = storySupport.boundedHistory(data.future, this.options.historyLimit);
      this.route = data.present.current;
      this.props = cloneState(data.present.props);
      this.values = cloneState(data.present.state);
      this.seed = data.present.seed;
      this.resetFrames();
      this.restoredContinuations = new Map(Object.entries(cloneState(data.present.continuations)));
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
      this.restoredContinuations = new Map(Object.entries(cloneState(before.continuations)));
      this.started = wasStarted;
      if (wasStarted) {
        this.skipEnter = true;
        this.refresh();
      } else {
        this.skipEnter = false;
        this.currentView = [];
      }
      throw error;
    }
  }
  reset(): void {
    const before = this.snapshot();
    const beforePast = this.past;
    const beforeFuture = this.future;
    const beforeRegistry = new Map(this.registry);
    const wasStarted = this.started;
    try {
      this.route = this.initialRoute;
      this.props = {};
      this.values = cloneState(this.initialState);
      this.seed = (this.options.seed ?? 123456789) >>> 0;
      this.past = [];
      this.future = [];
      this.registry.clear();
      this.resetFrames();
      this.restoredContinuations.clear();
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
      this.restoredContinuations = new Map(Object.entries(cloneState(before.continuations)));
      this.started = wasStarted;
      if (wasStarted) {
        this.skipEnter = true;
        this.refresh();
      } else {
        this.skipEnter = false;
        this.currentView = [];
      }
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
    this.restoredContinuations.clear();
    this.activeFlow = undefined;
    this.listeners.clear();
    this.currentView = [];
  }
}
