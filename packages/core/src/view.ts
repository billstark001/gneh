import type { ContentKind, Dialect, InvocationPhase, Metadata, PassageIR } from './ir.js';
import type { Json, Scalar, State } from './json.js';
import { display } from './json.js';

export type Scope = Record<string, unknown>;

export type EvaluationPhase = 'render' | 'enter' | 'action' | 'value';

export interface EvaluationContext {
  readonly state: State;
  readonly bindings: Readonly<Record<string, unknown>>;
  readonly phase: EvaluationPhase;
  makeCallable?(id: string, scope: Scope): unknown;
  invokeValueCallable?(value: unknown, args: readonly unknown[], scope: Scope): unknown;
  step(): void;
  random(min: number, max: number): number;
}

export interface View {
  kind:
    | ContentKind
    | 'text'
    | 'group'
    | 'choice'
    | 'button'
    | 'region'
    /** Runtime-internal flow boundary; Story removes it before renderer delivery. */
    | 'suspend'
    | `control:${string}`
    | `extension:${string}`;
  key?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  children?: View[];
  activate?: () => void;
  change?: (value: unknown) => void;
}

export type FragmentProps = Record<string, unknown>;

export type ViewInput = View | View[] | Scalar | undefined;

/** A renderer-neutral condition which can resume a suspended flow. */
export type ResumeCondition =
  | { type: 'manual' }
  | { type: 'timer'; durationMs: number; clock?: 'active' | 'wall' }
  | { type: 'signal'; name: string; filter?: Json }
  | { type: 'task'; operation: string; args?: Json[] };

export interface FlowLazy {
  readonly kind: 'gneh.flow.lazy';
  readonly id?: string;
  readonly render: (ctx: FragmentContext) => RenderInput;
}

export interface FlowSuspend {
  readonly kind: 'gneh.flow.suspend';
  readonly id?: string;
  readonly resume: ResumeCondition;
  /** Store the JSON resume value in a continuation local with this name. */
  readonly bind?: string;
}

export interface FlowEach {
  readonly kind: 'gneh.flow.each';
  readonly id?: string;
  readonly items: readonly Json[] | ((ctx: FragmentContext) => readonly Json[]);
  readonly key: (item: Json, index: number) => string | number;
  readonly render: (item: Json, index: number, ctx: FragmentContext) => RenderInput;
}

export type FlowNode = ViewInput | Flow | FlowLazy | FlowSuspend | FlowEach;

/** A declarative, resumable render program for handwritten passages and views. */
export interface Flow {
  readonly kind: 'gneh.flow';
  readonly nodes: readonly FlowNode[];
}

export type RenderInput = ViewInput | Flow;

export interface RenderEvaluation {
  readonly view: View[];
  readonly suspended: boolean;
}

export interface RuntimeExtensionInvocation {
  readonly id: string;
  readonly phase: InvocationPhase;
  readonly args: readonly unknown[];
  readonly context: FragmentContext;
  children(): View[];
}

export interface RuntimeExtension {
  readonly phases: readonly (InvocationPhase)[];
  invoke(invocation: RuntimeExtensionInvocation): ViewInput | void;
}

export interface RegionHandle {
  set(content: ViewInput | AnyFragment): void;
  append(content: ViewInput | AnyFragment): void;
  prepend(content: ViewInput | AnyFragment): void;
  clear(): void;
  reset(): void;
}

export interface FragmentContext extends EvaluationContext {
  readonly live: boolean;
  readonly instanceId: string;
  /** Stable structural mount key used by continuation state. */
  readonly mountKey: string;
  /** True only while rebuilding transient runtime structure from a save. */
  readonly restoring: boolean;
  /** True after the current render pass reaches an unresolved suspension. */
  readonly suspended: boolean;
  dispatch(action: (ctx: FragmentContext) => void): void;
  regionView(name: string, fallback: () => View[]): View;
  navigate<P extends object>(target: Fragment<P>, ...args: {} extends P ? [props?: P] : [props: P]): void;
  navigate(target: string, props?: FragmentProps): void;
  mutate(fn: (state: State) => void): void;
  /** Per-mounted-fragment transient storage used by materialized source dialects. */
  local<T>(key: string, initialize: (ctx: FragmentContext) => T): T;
  setLocal<T>(key: string, value: T): void;
  /** JSON continuation storage. It is retained by history and save/load. */
  continuation<T extends Json>(key: string, initialize: (ctx: FragmentContext) => T): T;
  setContinuation<T extends Json>(key: string, value: T): void;
  deleteContinuation(key: string): void;
  /** Evaluate a handwritten declarative flow inside this mounted Fragment. */
  evaluate(input: RenderInput, key?: string): RenderEvaluation;
  /** Install a suspension point. Returns true when evaluation must stop here. */
  suspend(
    key: string,
    resume?: ResumeCondition,
    accept?: (value: Json | undefined, ctx: FragmentContext) => void,
  ): boolean;
  /** Execute an initialization effect once; restoration marks it complete without replaying it. */
  effect(key: string, action: (ctx: FragmentContext) => void): void;
  host(operation: string, args?: unknown[]): unknown;
  invokeExtension(id: string, phase: InvocationPhase, args: readonly unknown[], children: () => View[]): View[];
  include<P extends object>(
    target: Fragment<P>,
    ...args: {} extends P ? [props?: P, key?: string] : [props: P, key?: string]
  ): View[];
  include(target: string, props?: FragmentProps, key?: string): View[];
  region(name: string): RegionHandle;
  wikify?: (source: string, dialect?: Dialect) => Fragment;
  onDispose(cleanup: () => void): void;
  /** Stage a callable in this Story's transient registry. */
  publish(name: string, value: unknown): void;
}

export interface Fragment<P extends object = FragmentProps> {
  readonly kind: 'gneh.fragment';
  readonly id: string;
  readonly metadata: Metadata;
  readonly capabilities: readonly string[];
  readonly ir?: PassageIR;
  readonly bindings?: Readonly<Record<string, unknown>>;
  enter?: (ctx: FragmentContext, props: P) => void;
  render: (ctx: FragmentContext, props: P) => RenderInput;
}

/** Type-erased storage boundary; public include/navigation overloads preserve props. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyFragment = Fragment<any>;

export interface Renderer<Host, Handle> {
  mount(host: Host, view: View[]): Handle;
  update(handle: Handle, view: View[]): void;
  dispose(handle: Handle): void;
}

export function normalizeView(input: ViewInput): View[] {
  if (input == null) return [];
  if (typeof input === 'string' || typeof input === 'number' || typeof input === 'boolean')
    return [{ kind: 'text', text: display(input) }];
  return Array.isArray(input) ? input : [input];
}

/** Small host-neutral constructors for hand-written fragments. */
export const v = {
  text: (value: unknown): View => ({ kind: 'text', text: display(value) }),
  p: (...children: ViewInput[]): View => ({
    kind: 'paragraph',
    children: children.flatMap(normalizeView),
  }),
  heading: (level: number, ...children: ViewInput[]): View => ({
    kind: 'heading',
    attrs: { level },
    children: children.flatMap(normalizeView),
  }),
  strong: (...children: ViewInput[]): View => ({
    kind: 'strong',
    children: children.flatMap(normalizeView),
  }),
  group: (...children: ViewInput[]): View => ({
    kind: 'group',
    children: children.flatMap(normalizeView),
  }),
  button: (label: string, activate: () => void): View => ({
    kind: 'button',
    text: label,
    activate,
  }),
  choice: (label: string, target: string, activate: () => void): View => ({
    kind: 'choice',
    text: label,
    attrs: { target },
    activate,
  }),
  extension: (name: string, attrs: Record<string, unknown>, ...children: ViewInput[]): View => ({
    kind: `extension:${name}`,
    attrs,
    children: children.flatMap(normalizeView),
  }),
  /** Compose lazy flow instructions without evaluating later segments eagerly. */
  flow: (...nodes: FlowNode[]): Flow => ({ kind: 'gneh.flow', nodes }),
  /** Lazily produce content when the flow frontier reaches this instruction. */
  lazy: (render: (ctx: FragmentContext) => RenderInput, id?: string): FlowLazy => ({
    kind: 'gneh.flow.lazy',
    id,
    render,
  }),
  /** Suspend after a lazily rendered segment. */
  step: (render: (ctx: FragmentContext) => RenderInput, id?: string): Flow => ({
    kind: 'gneh.flow',
    nodes: [
      { kind: 'gneh.flow.lazy', id: id ? `${id}:content` : undefined, render },
      { kind: 'gneh.flow.suspend', id, resume: { type: 'manual' } },
    ],
  }),
  suspend: (resume: ResumeCondition = { type: 'manual' }, id?: string, bind?: string): FlowSuspend => ({
    kind: 'gneh.flow.suspend',
    id,
    resume,
    bind,
  }),
  each: (items: FlowEach['items'], key: FlowEach['key'], render: FlowEach['render'], id?: string): FlowEach => ({
    kind: 'gneh.flow.each',
    id,
    items,
    key,
    render,
  }),
};
