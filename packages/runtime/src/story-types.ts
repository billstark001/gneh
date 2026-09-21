import {
  ABI_VERSION,
  type AnyFragment,
  type Dialect,
  type Fragment,
  type FragmentProps,
  type Json,
  type RuntimeExtension,
  type State,
  type ViewInput,
} from '@gneh/core';
import type { Story } from './story.js';

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
  /** Renderer/application-owned effects. The story kernel never reaches for DOM or browser globals. */
  host?: (operation: string, args: readonly unknown[], story: Story) => unknown;
}

export interface RegionOverride {
  replace: boolean;
  before: (ViewInput | AnyFragment)[];
  after: (ViewInput | AnyFragment)[];
}

/** Runtime identity and transient UI state for one mounted Fragment invocation. */
export interface Frame {
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
