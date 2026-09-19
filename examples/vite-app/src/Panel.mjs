import { defineFragment, v } from '@gneh/runtime';
import Start from './story.inkdown';

export const description = 'A normal ESM named export.';

/** @typedef {{ label?: string }} Props */
/** @type {import('@gneh/core').Fragment<Props>} */
export default defineFragment({
  id: 'Panel',
  metadata: { title: 'Native JavaScript', optionalParams: ['label'] },
  capabilities: ['live'],
  bindings: {
    get Start() {
      return Start;
    },
  },
  enter(ctx) {
    // Per-instance lifecycle, not a global CSS selector.
    ctx.onDispose(() => {
      /* release any instance-owned external resource here */
    });
  },
  render(ctx, props) {
    return [
      v.heading(2, props.label ?? 'JavaScript fragment'),
      v.p('Counter: ', v.strong(v.text(ctx.state.count))),
      v.button('Increment', () =>
        ctx.dispatch((action) => {
          action.state.count = Number(action.state.count) + 1;
        }),
      ),
      ctx.regionView('message', () => [v.p('A structural region that JavaScript can change.')]),
      v.button('Replace this instance region', () => {
        ctx.region('message').set(v.p('Replacement occurs in the semantic tree, not the DOM.'));
      }),
      v.button('Reset region', () => ctx.region('message').reset()),
      v.choice('Entrance', Start.id, () => ctx.navigate(Start)),
    ];
  },
});
