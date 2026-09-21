import {
  invariant,
  type Fragment,
  type FragmentContext,
  type FragmentProps,
  type Metadata,
  type ViewInput,
} from '@gneh/core';

export interface FragmentDefinition<P extends object> {
  id: string;
  metadata?: Metadata;
  capabilities?: string[];
  bindings?: Readonly<Record<string, unknown>>;
  enter?: (ctx: FragmentContext, props: P) => void;
  render: (ctx: FragmentContext, props: P) => ViewInput;
}

export function defineFragment<P extends object = FragmentProps>(definition: FragmentDefinition<P>): Fragment<P> {
  invariant(!!definition.id, 'FRAGMENT_ID', 'A fragment requires a stable id.');
  return Object.freeze({
    kind: 'gneh.fragment' as const,
    id: definition.id,
    metadata: definition.metadata ?? {},
    capabilities: definition.capabilities ?? [],
    bindings: definition.bindings,
    enter: definition.enter,
    render: definition.render,
  });
}
