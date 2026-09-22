import { definePassage, v } from '@gneh/runtime';
import passages from './story.inkdown';

export const description = 'A handwritten Passage composed with the compiled Wiki at the application boundary.';

/** @typedef {{ label?: string }} Props */
/** @type {import('@gneh/runtime').Passage<Props>} */
export default definePassage({
  id: 'ModelLab',
  metadata: { title: 'Concept lab', group: 'Explore', order: 80 },
  capabilities: ['live'],
  bindings: {
    get Primer() {
      return passages.Primer;
    },
  },
  enter(ctx) {
    ctx.onDispose(() => {
      // A real passage can release observers, timers, or media handles here.
    });
  },
  render(ctx, props) {
    const confidence = Number(ctx.state.confidence);
    const interpretation =
      confidence < 0.2
        ? 'Only near neighbours can interact; fragmentation is easier to sustain.'
        : confidence < 0.5
          ? 'Several local groups may communicate while distant opinions remain separated.'
          : 'A broad interaction neighbourhood makes large-scale agreement more plausible.';

    return v.flow(
      v.step(
        () => [
          v.heading(1, props.label ?? 'Concept lab'),
          v.p(
            'This native JavaScript passage shares the same state, history, navigation, and semantic renderer as the compiled Wiki.',
          ),
        ],
        'introduction',
      ),
      v.step(
        () => [
          v.heading(2, 'Confidence radius'),
          v.p('Current illustrative value: ', v.strong(confidence.toFixed(2))),
          v.button('Narrow −0.05', () =>
            ctx.dispatch((action) => {
              action.state.confidence = Math.max(0.05, Number(action.state.confidence) - 0.05);
            }),
          ),
          v.button('Widen +0.05', () =>
            ctx.dispatch((action) => {
              action.state.confidence = Math.min(0.95, Number(action.state.confidence) + 0.05);
            }),
          ),
        ],
        'controls',
      ),
      v.step(
        () => [
          ctx.regionView('interpretation', () => [v.p(interpretation)]),
          v.button('Replace the local region', () => {
            ctx
              .region('interpretation')
              .set(
                v.p(
                  'This replacement belongs to this mounted passage instance; it is not a DOM query or global mutation.',
                ),
              );
          }),
          v.button('Restore computed interpretation', () => ctx.region('interpretation').reset()),
          v.choice('Back to the primer', passages.Primer.id, () => ctx.navigate(passages.Primer)),
        ],
        'interpretation',
      ),
    );
  },
});
