import { type AnyFragment, type FragmentProps, type State, type ViewInput } from '@gneh/core';

export interface RegionOverride {
  replace: boolean;
  before: (ViewInput | AnyFragment)[];
  after: (ViewInput | AnyFragment)[];
}

/** Runtime identity and transient UI state for one mounted Fragment invocation. */
export interface Frame {
  id: string;
  key: string;
  fragment: AnyFragment;
  props: FragmentProps;
  alive: boolean;
  entered: boolean;
  cleanups: Set<() => void>;
  regions: Map<string, RegionOverride>;
  declaredRegions: Set<string>;
  locals: Map<string, unknown>;
  /** Suspension keys already crossed by this mounted invocation. */
  passed: Set<string>;
  /** Serialized lexical slots applied when their scope is reconstructed. */
  restoredScopes: Map<string, State>;
}
