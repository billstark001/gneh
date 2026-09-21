import { ABI_VERSION, assertJson, cloneState, invariant, type AnyFragment, type State, type StoryIR } from '@gneh/core';
import { isPassage, passageSetSetup, type Passage, type PassageSet } from './definition.js';
import { defineIRFragment } from './fragment.js';
import type { Frame, SaveData, Snapshot, StoryOptions } from './story-types.js';

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
    setup: passageSet[passageSetSetup],
  };
}

export function createFrame(id: string, fragment: AnyFragment, props: Frame['props'], entered = false): Frame {
  return {
    id,
    fragment,
    props,
    alive: true,
    entered,
    cleanups: new Set(),
    regions: new Map(),
    declaredRegions: new Set(),
    locals: new Map(),
  };
}

export function validateSnapshot(value: Snapshot, resolve: (id: string) => unknown): void {
  invariant(value && typeof value === 'object', 'SAVE_SHAPE', 'Invalid save snapshot.');
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
  frame.regions.clear();
  frame.declaredRegions.clear();
  frame.props = {};
}

export function readSave(source: string, identity: string, resolve: (id: string) => unknown): SaveData {
  const data = JSON.parse(source) as SaveData;
  invariant(
    data.abi === ABI_VERSION && data.story === identity,
    'SAVE_STORY',
    'Save ABI or story identity does not match.',
  );
  invariant(Array.isArray(data.past) && Array.isArray(data.future), 'SAVE_HISTORY', 'Invalid save history.');
  for (const snapshot of [...data.past, ...data.future, data.present]) validateSnapshot(snapshot, resolve);
  return data;
}
