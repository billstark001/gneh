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
  entry?: string;
  state?: State;
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
