import { type AnyFragment, type Fragment, type FragmentProps } from '@gneh/core';
import { defineFragment } from './definition.js';

export function bindFragment<P extends object>(fragment: Fragment<P>, props: P, id = fragment.id + ':bound'): Fragment {
  return defineFragment({
    id,
    metadata: { nav: false },
    capabilities: [...fragment.capabilities],
    render(ctx) {
      return ctx.include(fragment as AnyFragment, props as FragmentProps);
    },
  });
}
