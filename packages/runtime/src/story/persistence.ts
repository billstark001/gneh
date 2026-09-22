import { ABI_VERSION, GnehError, assertJson, cloneState, invariant, type Json, type State } from '@gneh/core';
import type { ContinuationSnapshot, SaveData, Snapshot } from '../api-types.js';
import type { Frame } from './frames.js';

export function serializeContinuation(frame: Frame): ContinuationSnapshot | undefined {
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
      // Native handles and other transient implementation values are reconstructed.
    }
  }
  if (!frame.passed.size && !Object.keys(locals).length && !Object.keys(scopes).length) return;
  return { fragment: frame.fragment.id, passed: [...frame.passed], locals, scopes };
}

export function validateSnapshot(value: Snapshot, resolve: (id: string) => unknown): void {
  invariant(value && typeof value === 'object', 'SAVE_SHAPE', 'Invalid save snapshot.');
  invariant(typeof value.current === 'string', 'SAVE_ROUTE', 'Saved route must be a string.');
  resolve(value.current);
  assertJson(value.state);
  assertJson(value.props);
  invariant(
    !Array.isArray(value.state) && typeof value.state === 'object' && value.state !== null,
    'SAVE_STATE',
    'Invalid saved state.',
  );
  invariant(
    value.props !== null && typeof value.props === 'object' && !Array.isArray(value.props),
    'SAVE_PROPS',
    'Saved props must be an object.',
  );
  invariant(
    Number.isInteger(value.seed) && value.seed >= 0 && value.seed <= 4294967295,
    'SAVE_SEED',
    'Invalid saved random state.',
  );
  invariant(
    value.continuations !== null && typeof value.continuations === 'object' && !Array.isArray(value.continuations),
    'SAVE_CONTINUATION',
    'Saved continuations must be an object.',
  );
  for (const [frameKey, continuation] of Object.entries(value.continuations)) {
    invariant(frameKey.length > 0, 'SAVE_CONTINUATION', 'Continuation frame keys must not be empty.');
    invariant(
      continuation && typeof continuation === 'object' && !Array.isArray(continuation),
      'SAVE_CONTINUATION',
      'Invalid continuation frame.',
    );
    invariant(typeof continuation.fragment === 'string', 'SAVE_CONTINUATION', 'Invalid continuation fragment.');
    resolve(continuation.fragment);
    invariant(
      Array.isArray(continuation.passed) && continuation.passed.every((key) => typeof key === 'string'),
      'SAVE_CONTINUATION',
      'Invalid continuation frontier.',
    );
    invariant(
      continuation.locals !== null && typeof continuation.locals === 'object' && !Array.isArray(continuation.locals),
      'SAVE_CONTINUATION',
      'Continuation locals must be an object.',
    );
    invariant(
      continuation.scopes !== null && typeof continuation.scopes === 'object' && !Array.isArray(continuation.scopes),
      'SAVE_CONTINUATION',
      'Continuation scopes must be an object.',
    );
    assertJson(continuation.locals);
    assertJson(continuation.scopes);
  }
}

/** Apply the configured history bound without `slice(-0)` accidentally retaining every entry. */
export function boundedHistory(snapshots: Snapshot[], limit = 100): Snapshot[] {
  return limit === 0 ? [] : snapshots.slice(-limit);
}

export function readSave(source: string, identity: string, resolve: (id: string) => unknown): SaveData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new GnehError('SAVE_JSON', `Invalid save JSON: ${(error as Error).message}`);
  }
  invariant(
    parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed),
    'SAVE_SHAPE',
    'Invalid save data.',
  );
  const data = parsed as SaveData;
  invariant(
    data.abi === ABI_VERSION && data.story === identity,
    'SAVE_STORY',
    'Save ABI or story identity does not match.',
  );
  invariant(Array.isArray(data.past) && Array.isArray(data.future), 'SAVE_HISTORY', 'Invalid save history.');
  for (const snapshot of [...data.past, ...data.future, data.present]) validateSnapshot(snapshot, resolve);
  return data;
}
