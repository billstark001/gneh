import { invariant, type Fragment, type FragmentProps } from '@gneh/core';
import type { FragmentDefinition, Passage, PassageDefinition } from '../api-types.js';
import { passageBrand } from '../brands.js';

export function defineFragment<P extends object = FragmentProps>(definition: FragmentDefinition<P>): Fragment<P> {
  invariant(!!definition.id, 'FRAGMENT_ID', 'A fragment requires a stable id.');
  return Object.freeze({
    kind: 'gneh.fragment' as const,
    id: definition.id,
    metadata: Object.freeze({ ...definition.metadata }),
    capabilities: Object.freeze([...(definition.capabilities ?? [])]),
    bindings: definition.bindings,
    ir: definition.ir,
    enter: definition.enter,
    render: definition.render,
  });
}

export function definePassage<P extends object = FragmentProps>(definition: PassageDefinition<P>): Passage<P> {
  const fragment = defineFragment({
    ...definition,
    metadata: { ...definition.metadata, name: definition.name ?? definition.metadata?.name ?? definition.id },
  });
  return Object.freeze({ ...fragment, [passageBrand]: true as const });
}

export function isPassage(value: unknown): value is Passage {
  return !!value && typeof value === 'object' && (value as Passage)[passageBrand] === true;
}
