import {
  ABI_VERSION,
  GnehError,
  assertJson,
  cloneState,
  invariant,
  type AnyFragment,
  type State,
  type StoryIR,
} from '@gneh/core';
import { isPassage } from './definition.js';
import { passageSetSetup } from './brands.js';
import { defineIRFragment } from './fragment.js';
import type { Passage, PassageSet, SaveData, Snapshot, StoryOptions } from './api-types.js';
import type { Frame } from './story-internals.js';

export interface StoryInitialization {
  setup: readonly Passage[];
  route: string;
  values: State;
}

export function initializeStoryInput(
  input: StoryIR | PassageSet,
  options: StoryOptions,
  register: (passage: AnyFragment) => void,
): StoryInitialization {
  invariant(
    options.historyLimit === undefined || (Number.isSafeInteger(options.historyLimit) && options.historyLimit >= 0),
    'HISTORY_LIMIT',
    'StoryOptions.historyLimit must be a non-negative safe integer.',
  );
  invariant(
    options.maxSteps === undefined || (Number.isSafeInteger(options.maxSteps) && options.maxSteps > 0),
    'STEP_LIMIT',
    'StoryOptions.maxSteps must be a positive safe integer.',
  );
  invariant(
    options.seed === undefined || (Number.isInteger(options.seed) && options.seed >= 0 && options.seed <= 4294967295),
    'RANDOM_SEED',
    'StoryOptions.seed must be an unsigned 32-bit integer.',
  );
  invariant(
    options.flow?.projection === undefined || ['revealed', 'current', 'all'].includes(options.flow.projection),
    'FLOW_PROJECTION',
    'StoryOptions.flow.projection must be revealed, current, or all.',
  );
  const storyIR = input as StoryIR;
  if (typeof storyIR.abi === 'number' && Array.isArray(storyIR.passages)) {
    invariant(storyIR.abi === ABI_VERSION, 'ABI_VERSION', `Unsupported story ABI: ${storyIR.abi}`);
    const passages = new Map<string, AnyFragment>();
    for (const passageIR of storyIR.passages) {
      const passage = defineIRFragment(passageIR);
      register(passage);
      passages.set(passage.id, passage);
    }
    return {
      route: options.entry ?? storyIR.entry,
      values: cloneState({ ...storyIR.state, ...options.state }),
      setup: (storyIR.setup ?? []).map((id) => {
        const passage = passages.get(id);
        invariant(passage && isPassage(passage), 'SETUP_MISSING', `Unknown setup passage: ${id}`);
        return passage;
      }),
    };
  }
  const passageSet = input as PassageSet;
  for (const passage of Object.values(passageSet)) register(passage);
  const starts = Object.values(passageSet).filter(
    (passage) => Array.isArray(passage.metadata.tags) && passage.metadata.tags.includes('start'),
  );
  invariant(
    options.entry || starts.length === 1,
    'ENTRY_REQUIRED',
    starts.length > 1
      ? 'Multiple passages have the start tag; select StoryOptions.entry.'
      : 'Select StoryOptions.entry or mark exactly one passage with the start tag.',
  );
  return {
    route: options.entry ?? starts[0].id,
    values: cloneState(options.state ?? {}),
    setup: (passageSet as PassageSet & { readonly [passageSetSetup]: readonly Passage[] })[passageSetSetup],
  };
}

export function createFrame(
  id: string,
  fragment: AnyFragment,
  props: Frame['props'],
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
