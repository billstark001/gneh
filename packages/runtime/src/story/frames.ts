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

export function createFrame(
  id: string,
  fragment: AnyFragment,
  props: FragmentProps,
  entered = false,
  key = id,
): Frame {
  return {
    id,
    key,
    fragment,
    props,
    alive: true,
    entered,
    cleanups: new Set(),
    regions: new Map(),
    declaredRegions: new Set(),
    locals: new Map(),
    passed: new Set(),
    restoredScopes: new Map(),
  };
}
export function disposeFrame(frame: Frame): void {
  frame.alive = false;
  for (const cleanup of frame.cleanups) {
    try {
      cleanup();
    } catch (error) {
      console.error('gneh cleanup:', error);
    }
  }
  frame.cleanups.clear();
  frame.locals.clear();
  frame.passed.clear();
  frame.restoredScopes.clear();
  frame.regions.clear();
  frame.declaredRegions.clear();
  frame.props = {};
}
