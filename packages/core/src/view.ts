import type { ContentKind, Dialect, Metadata, PassageIR } from './ir.js';
import type { Scalar, State } from './json.js';
import { display } from './json.js';

export type Scope = Record<string, unknown>;

export interface EvaluationContext {
  readonly state: State;
  readonly bindings: Readonly<Record<string, unknown>>;
  readonly phase: 'render' | 'enter' | 'action' | 'value';
  makeCallable?(id: string, scope: Scope): unknown;
  invokeValueCallable?(value: unknown, args: readonly unknown[], scope: Scope): unknown;
  step(): void;
  random(min: number, max: number): number;
}

export interface View {
  kind: ContentKind | 'text' | 'group' | 'choice' | 'button' | 'region' | `control:${string}` | `extension:${string}`;
  key?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  children?: View[];
  activate?: () => void;
  change?: (value: unknown) => void;
}

export type FragmentProps = Record<string, unknown>;

export type ViewInput = View | View[] | Scalar | undefined;

export interface RuntimeExtensionInvocation {
  readonly id: string;
  readonly phase: 'view' | 'effect';
  readonly args: readonly unknown[];
  readonly context: FragmentContext;
  children(): View[];
}

export interface RuntimeExtension {
  readonly phases: readonly ('view' | 'effect')[];
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
  /** True only while rebuilding transient runtime structure from a save. */
  readonly restoring: boolean;
  dispatch(action: (ctx: FragmentContext) => void): void;
  regionView(name: string, fallback: () => View[]): View;
  navigate<P extends object>(target: Fragment<P>, ...args: {} extends P ? [props?: P] : [props: P]): void;
  navigate(target: string, props?: FragmentProps): void;
  mutate(fn: (state: State) => void): void;
  /** Per-mounted-fragment transient storage used by materialized source dialects. */
  local<T>(key: string, initialize: (ctx: FragmentContext) => T): T;
  setLocal<T>(key: string, value: T): void;
  /** Execute an initialization effect once; restoration marks it complete without replaying it. */
  effect(key: string, action: (ctx: FragmentContext) => void): void;
  host(operation: string, args?: unknown[]): unknown;
  invokeExtension(id: string, phase: 'view' | 'effect', args: readonly unknown[], children: () => View[]): View[];
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
  render: (ctx: FragmentContext, props: P) => ViewInput;
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
};
