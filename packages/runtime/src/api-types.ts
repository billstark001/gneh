import type {
  ABI_VERSION,
  CallablePhase,
  Dialect,
  Fragment,
  FragmentContext,
  FragmentProps,
  Json,
  Metadata,
  PassageIR,
  RenderInput,
  ResumeCondition,
  RuntimeExtension,
  State,
} from '@gneh/core';
import type { Story } from './story.js';
import type { authoredCallableBrand, passageBrand, passageSetBrand } from './brands.js';

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

export type PassageSet = PassageRecord & { readonly [passageSetBrand]: true };

export type PassageInput = Passage | PassageSet | PassageRecord;

export interface PassageSetDefinition {
  passages: PassageInput | readonly PassageInput[];
  setup?: readonly (Passage | string)[];
}

export interface AuthoredCallable<P extends CallablePhase = CallablePhase> {
  readonly kind: 'gneh.authored-callable';
  readonly phase: P;
  readonly [authoredCallableBrand]: true;
  readonly invoke: (...args: unknown[]) => unknown;
}

export interface ModuleBindingCell {
  get(): unknown;
  set(value: unknown): void;
}

export interface Snapshot {
  current: string;
  props: Record<string, Json>;
  state: State;
  seed: number;
  continuations: Record<string, ContinuationSnapshot>;
}

export interface ContinuationSnapshot {
  fragment: string;
  passed: string[];
  locals: Record<string, Json>;
  scopes: Record<string, State>;
}

export interface SaveData {
  abi: typeof ABI_VERSION;
  story: string;
  present: Snapshot;
  past: Snapshot[];
  future: Snapshot[];
}

export interface TraceEvent {
  type: 'enter' | 'render' | 'action' | 'navigate' | 'resume' | 'restore';
  fragment: string;
  state?: State;
}

export interface StoryOptions {
  /** Initial passage id; required when a PassageSet has no unique `[start]` passage. */
  entry?: string;
  /** JSON state merged over StoryIR defaults, or used as the initial state for a PassageSet. */
  state?: State;
  /** Enable actions and mutable regions; set false for deterministic snapshot rendering. Defaults to true. */
  live?: boolean;
  /** Maximum retained undo and redo snapshots. Zero disables history; defaults to 100. */
  historyLimit?: number;
  /** Evaluation steps allowed per transaction or render pass. Defaults to 100,000. */
  maxSteps?: number;
  /** Trusted application values and Fragment bindings exposed to portable expressions. */
  bindings?: Record<string, unknown>;
  /** Phase-declared implementations for `invoke` nodes required by compiled story IR. */
  runtimeExtensions?: Readonly<Record<string, RuntimeExtension>>;
  /** Unsigned 32-bit initial state for deterministic effect-time randomness. */
  seed?: number;
  /** Receives cloned state snapshots for lifecycle tracing. */
  onTrace?: (event: TraceEvent) => void;
  /** Optional trusted compiler bridge used by explicit runtime wikification features. */
  wikify?: (source: string, dialect?: Dialect) => Fragment;
  /** Projection for declarative flow segments. Defaults to all revealed segments. */
  flow?: {
    projection?: 'revealed' | 'current' | 'all';
  };
  /** Injectable wall clock used by timer suspensions. Defaults to Date.now. */
  now?: () => number;
  /** Renderer/application-owned effects. The story kernel never reaches for DOM or browser globals. */
  host?: (operation: string, args: readonly unknown[], story: Story) => unknown;
}

export interface ActiveSuspension {
  readonly key: string;
  readonly fragment: string;
  readonly instanceId: string;
  readonly resume: ResumeCondition;
  readonly startedAt?: number;
  readonly dueAt?: number;
}
