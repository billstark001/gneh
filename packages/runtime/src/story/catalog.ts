import { ABI_VERSION, cloneState, invariant, type AnyFragment, type State, type StoryIR } from '@gneh/core';
import { passageSetSetup } from '../brands.js';
import { defineIRFragment } from '../compiler/interpreter.js';
import { isPassage } from '../definitions/fragment.js';
import type { Passage, PassageSet, StoryOptions } from '../api-types.js';

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
