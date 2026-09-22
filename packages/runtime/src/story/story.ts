/* oxlint-disable max-lines -- lifecycle, continuation, and transaction invariants stay in one kernel. */
/** Renderer-neutral story kernel, lifecycle, history and regions. */
import {
  ABI_VERSION,
  GnehError,
  assertJson,
  cloneState,
  invariant,
  safeKey,
  type AnyFragment,
  type FragmentContext,
  type FragmentProps,
  type Json,
  type ResumeCondition,
  type RegionHandle,
  type State,
  type StoryIR,
  type View,
  type EvaluationPhase,
} from '@gneh/core';
import { deepReadonly } from '../internal/readonly.js';
import { evaluateRenderInput } from './render.js';
import { createCheckpoint, type RuntimeCheckpoint } from './transaction.js';
import { isPassage } from '../definitions/fragment.js';
import { initializeStoryInput } from './catalog.js';
import { createFrame, disposeFrame } from './frames.js';
import { boundedHistory, readSave, serializeContinuation, validateSnapshot } from './persistence.js';
import type {
  ActiveSuspension,
  ContinuationSnapshot,
  SaveData,
  Snapshot,
  StoryOptions,
  TraceEvent,
  Passage,
  PassageSet,
} from '../api-types.js';
import type { Frame } from './frames.js';
import { createFragmentContext, type ContextRuntimeHooks } from './context.js';

const maxFragmentDepth = 128;
const maxSteps = 100000;

/** Renderer-neutral story kernel. Re-evaluation is batched per transaction (not signal-level). */
export class Story {
  readonly live: boolean;
  private readonly options: Readonly<StoryOptions>;
  private readonly identity: string;
  readonly #contextHooks: ContextRuntimeHooks;

  private readonly passageRegistry = new Map<string, AnyFragment>();
  private readonly setup: readonly Passage[];
  private readonly initialState: State;
  private readonly initialRoute: string;

  private values: State;
  private seed: number;

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
    const initialized = initializeStoryInput(input, this.options, (passage) => this.register(passage));
    this.route = initialized.route;
    this.values = initialized.values;
    this.setup = initialized.setup;
    this.identity = [...this.passageRegistry.keys()].sort().join('|');
    this.seed = (options.seed ?? 123456789) >>> 0;
    const host = this.options.host;
    this.#contextHooks = {
      live: this.live,
      projection: this.options.flow?.projection,
      wikify: this.options.wikify,
      state: (phase) => (phase === 'render' ? deepReadonly(this.values) : this.values),
      restoring: () => this.skipEnter,
      suspended: () => !!this.activeFlow,
      bindings: () => ({ ...this.options.bindings, ...Object.fromEntries(this.registry) }),
      step: () => this.#step(),
      random: (min, max) => this.#random(min, max),
      navigate: (target, props, frame, phase) => this.#performNavigation(target, props, frame, phase),
      mutate: (fn) => this.mutate(fn),
      installSuspension: (frame, key, resume, accept) => this.#installSuspension(frame, key, resume, accept),
      dispatch: (action) => this.transact('action', action),
      include: (target, props, frame, key) => this.#include(target, props, frame, key),
      updateRegion: (frame, name, update) => this.#updateRegion(frame, name, update),
      publish: (name, value) => this.#publish(name, value),
      host: host ? (operation, args) => host(operation, args, this) : undefined,
      runtimeExtension: (id) => this.options.runtimeExtensions?.[id],
    };
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
      let previousSetupFrames: Map<string, Frame> | undefined;
      this.started = true;
      try {
        this.registry.clear();
        previousSetupFrames = this.runSetup();
        this.refresh();
        this.commitSetupFrames(previousSetupFrames);
      } catch (error) {
        this.rollbackSetupFrames(previousSetupFrames);
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
          .map(([key, frame]) => [key, serializeContinuation(frame)] as const)
          .filter((entry): entry is readonly [string, ContinuationSnapshot] => entry[1] !== undefined),
      ),
    };
  }
  private trace(type: TraceEvent['type']): void {
    this.options.onTrace?.({ type, fragment: this.route, state: cloneState(this.values) });
  }
  private checkpoint(snapshot = this.snapshot()): RuntimeCheckpoint {
    return createCheckpoint(snapshot, this.past, this.future, this.registry, this.started);
  }
  private rollback(checkpoint: RuntimeCheckpoint, traceRestore = false): void {
    this.resetFrames();
    this.route = checkpoint.snapshot.current;
    this.props = cloneState(checkpoint.snapshot.props);
    this.values = cloneState(checkpoint.snapshot.state);
    this.seed = checkpoint.snapshot.seed;
    this.past = checkpoint.past;
    this.future = checkpoint.future;
    this.registry = checkpoint.registry;
    this.restoredContinuations = new Map(Object.entries(cloneState(checkpoint.snapshot.continuations)));
    this.started = checkpoint.started;
    if (checkpoint.started) {
      this.skipEnter = true;
      this.refresh();
      if (traceRestore) this.trace('restore');
    } else {
      this.skipEnter = false;
      this.currentView = [];
    }
  }
  private frame(target: AnyFragment, props: FragmentProps, key: string): Frame {
    // Structural mount keys let repeated Fragment includes keep regions and cleanups isolated.
    let frame = this.frames.get(key);
    if (frame && frame.fragment !== target) {
      disposeFrame(frame);
      this.frames.delete(key);
      frame = undefined;
    }
    if (!frame) {
      invariant(
        this.live || !target.capabilities.includes('live'),
        'CAPABILITY_LIVE',
        `${target.id} requires live rendering.`,
      );
      frame = createFrame(`i${this.frameSerial++}:${key}`, target, props, false, key);
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
      return evaluateRenderInput(
        context,
        frame.fragment.render(context, deepReadonly(frame.props)),
        `${frame.key}/flow`,
        this.options.flow?.projection,
      ).view;
    } finally {
      this.renderDepth--;
    }
  }
  #installSuspension(
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
  private context(frame: Frame, phase: EvaluationPhase): FragmentContext {
    return createFragmentContext(this.#contextHooks, frame, phase);
  }

  #updateRegion(frame: Frame, name: string, update: () => void): void {
    invariant(frame.alive, 'INSTANCE_DISPOSED', 'Region owner is no longer mounted.');
    invariant(frame.declaredRegions.has(name), 'REGION_MISSING', 'Region is no longer visible.');
    update();
    if (this.rendering) this.newFrames = true;
    else if (!this.transactionDepth) this.refresh();
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

  /** Generate a random number within the specified range, then advance the seed. */
  #random(min: number, max: number): number {
    this.seed = (Math.imul(1664525, this.seed) + 1013904223) >>> 0;
    return min + Math.floor((this.seed / 4294967296) * (max - min + 1));
  }

  /** Advance the execution step. */
  #step(): void {
    if (++this.steps > (this.options.maxSteps ?? maxSteps))
      throw new GnehError('STEP_LIMIT', 'Execution budget exhausted.');
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

  #performNavigation(
    target: string | AnyFragment,
    props: FragmentProps = {},
    frame: Frame | undefined,
    phase: EvaluationPhase,
  ): void {
    invariant(!this.settingUp, 'SETUP_NAVIGATION', 'Setup passages cannot navigate.');
    const fragment = this.resolve(target, frame);
    if (this.rendering && phase === 'enter') {
      if (!this.passageRegistry.has(fragment.id)) this.register(fragment);
      this.pendingRoute = {
        id: fragment.id,
        props: cloneState(props as Record<string, Json>),
      };
      this.newFrames = true;
      return;
    }
    this.navigate(fragment, props as FragmentProps);
  }

  #include(target: string | AnyFragment, props: object, frame: Frame, key: string): View[] {
    const fragment = this.resolve(target, frame);
    const child = this.frame(fragment, props as FragmentProps, `${frame.key}/${key}`);
    return this.renderFrame(child);
  }

  #publish(name: string, value: unknown): void {
    safeKey(name);
    this.registry.set(name, value);
  }

  private transact(type: 'action' | 'navigate' | 'resume', action: () => void): void {
    invariant(!this.rendering, 'RENDER_EFFECT', 'Navigation and mutations cannot occur while rendering.');
    if (this.transactionDepth) {
      action();
      return;
    }
    // Copy-on-transaction isolates changes; failure restores state, RNG, and both histories.
    const before = this.snapshot();
    const rollback = this.checkpoint(before);
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
      this.rollback(rollback, true);
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
          disposeFrame(frame);
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
    for (const frame of this.frames.values()) disposeFrame(frame);
    this.frames.clear();
    this.activeFlow = undefined;
  }
  private resetSetupFrames(): void {
    for (const frame of this.setupFrames.values()) disposeFrame(frame);
    this.setupFrames.clear();
  }
  private commitSetupFrames(previous: Map<string, Frame> | undefined): void {
    if (previous) for (const frame of previous.values()) disposeFrame(frame);
  }
  private rollbackSetupFrames(previous: Map<string, Frame> | undefined): void {
    if (!previous) return;
    this.resetSetupFrames();
    this.setupFrames = previous;
  }
  private runSetup(): Map<string, Frame> | undefined {
    if (!this.setup.length) return undefined;
    const beforeState = cloneState(this.values);
    const beforeRegistry = new Map(this.registry);
    const previousFrames = this.setupFrames;
    const nextFrames = new Map<string, Frame>();
    this.values = cloneState(this.values);
    this.setupFrames = nextFrames;
    this.settingUp = true;
    try {
      for (const passage of this.setup) {
        const frame = createFrame(`setup:${passage.id}`, passage, {}, true);
        this.setupFrames.set(passage.id, frame);
        passage.enter?.(this.context(frame, 'enter'), {});
        passage.render(this.context(frame, 'enter'), {});
      }
      assertJson(this.values);
      return previousFrames;
    } catch (error) {
      this.values = beforeState;
      this.registry = beforeRegistry;
      for (const frame of nextFrames.values()) disposeFrame(frame);
      this.setupFrames = previousFrames;
      throw error;
    } finally {
      this.settingUp = false;
    }
  }
  private restoreSnapshot(snapshot: Snapshot): void {
    validateSnapshot(snapshot, (id) => this.resolve(id));
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
    const data = readSave(source, this.identity, (id) => this.resolve(id));
    const rollback = this.checkpoint();
    let previousSetupFrames: Map<string, Frame> | undefined;
    try {
      this.past = boundedHistory(data.past, this.options.historyLimit);
      this.future = boundedHistory(data.future, this.options.historyLimit);
      this.route = data.present.current;
      this.props = cloneState(data.present.props);
      this.values = cloneState(data.present.state);
      this.seed = data.present.seed;
      this.resetFrames();
      this.restoredContinuations = new Map(Object.entries(cloneState(data.present.continuations)));
      this.registry.clear();
      previousSetupFrames = this.runSetup();
      this.skipEnter = true;
      this.refresh();
      this.trace('restore');
      this.started = true;
      this.commitSetupFrames(previousSetupFrames);
    } catch (error) {
      this.rollbackSetupFrames(previousSetupFrames);
      this.rollback(rollback);
      throw error;
    }
  }
  reset(): void {
    const rollback = this.checkpoint();
    let previousSetupFrames: Map<string, Frame> | undefined;
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
      previousSetupFrames = this.runSetup();
      this.refresh();
      this.started = true;
      this.commitSetupFrames(previousSetupFrames);
    } catch (error) {
      this.rollbackSetupFrames(previousSetupFrames);
      this.rollback(rollback);
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
