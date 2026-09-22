import type { Snapshot } from '../api-types.js';

/** Everything outside a Snapshot that must be restored when an operation fails. */
export interface RuntimeCheckpoint {
  snapshot: Snapshot;
  past: Snapshot[];
  future: Snapshot[];
  registry: Map<string, unknown>;
  started: boolean;
}

export function checkpoint(
  snapshot: Snapshot,
  past: readonly Snapshot[],
  future: readonly Snapshot[],
  registry: ReadonlyMap<string, unknown>,
  started: boolean,
): RuntimeCheckpoint {
  return {
    snapshot,
    past: [...past],
    future: [...future],
    registry: new Map(registry),
    started,
  };
}
