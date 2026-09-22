import { invariant } from '@gneh/core';
import type { Passage, PassageInput, PassageSet, PassageSetDefinition } from '../api-types.js';
import { passageSetBrand, passageSetSetup } from '../brands.js';
import { isPassage } from './fragment.js';

export type RuntimePassageSet = PassageSet & { readonly [passageSetSetup]: readonly Passage[] };

export function isPassageSet(value: unknown): value is RuntimePassageSet {
  return !!value && typeof value === 'object' && (value as PassageSet)[passageSetBrand] === true;
}

function inputs(value: PassageInput | readonly PassageInput[]): readonly PassageInput[] {
  return Array.isArray(value) ? (value as readonly PassageInput[]) : [value as PassageInput];
}

function createPassageSet(source: readonly PassageInput[], setupReferences: readonly (Passage | string)[]): PassageSet {
  const result: Record<string, Passage> = Object.create(null);
  const setup: Passage[] = [];
  const addPassage = (key: string, passage: Passage) => {
    invariant(isPassage(passage), 'PASSAGE_DEFINITION', `Expected a branded Passage at ${key}.`);
    invariant(key === passage.id, 'PASSAGE_KEY', `Passage key ${key} does not match canonical id ${passage.id}.`);
    invariant(!Object.hasOwn(result, key), 'DUPLICATE_ID', `Duplicate passage id: ${key}`);
    result[key] = passage;
  };
  for (const input of source) {
    if (isPassage(input)) addPassage(input.id, input);
    else {
      for (const [key, passage] of Object.entries(input)) addPassage(key, passage);
      if (isPassageSet(input)) setup.push(...input[passageSetSetup]);
    }
  }
  for (const reference of setupReferences) {
    const passage = typeof reference === 'string' ? result[reference] : reference;
    invariant(passage && result[passage.id] === passage, 'SETUP_MISSING', `Unknown setup passage: ${String(reference)}`);
    setup.push(passage);
  }
  const seen = new Set<string>();
  for (const passage of setup) {
    invariant(!seen.has(passage.id), 'DUPLICATE_SETUP', `Duplicate setup passage: ${passage.id}`);
    seen.add(passage.id);
  }
  Object.defineProperties(result, {
    [passageSetBrand]: { value: true, enumerable: false },
    [passageSetSetup]: { value: Object.freeze(setup), enumerable: false },
  });
  return Object.freeze(result) as PassageSet;
}

export function definePassages(...values: PassageInput[]): PassageSet {
  return createPassageSet(values, []);
}

export function definePassageSet(definition: PassageSetDefinition): PassageSet {
  return createPassageSet(inputs(definition.passages), definition.setup ?? []);
}
