import { test } from 'vitest';
import { Story, definePassage, definePassages } from '../dist/index.js';
import { assert, text } from './helpers.js';

test('read-only state blocks meta-object mutations and keeps identity within one render', () => {
  let stableIdentity = false;
  const passage = definePassage({
    id: 'Readonly',
    render(ctx) {
      stableIdentity = ctx.state.player === ctx.state.player;
      return 'ok';
    },
  });
  const instance = new Story(definePassages(passage), {
    entry: 'Readonly',
    state: { player: { hp: 3 } },
  }).start();

  assert.equal(stableIdentity, true);
  assert.throws(() => Object.setPrototypeOf(instance.state.player, null), /read-only/i);
  assert.throws(() => Object.preventExtensions(instance.state.player), /read-only/i);
  assert.deepEqual(instance.state, { player: { hp: 3 } });
});

test('a failed load does not consume enter lifecycle on a lazy story', () => {
  let enters = 0;
  const passage = definePassage({
    id: 'LazyRollback',
    enter() {
      enters++;
    },
    render(ctx) {
      if (ctx.state.fail) throw new Error('load render failed');
      return 'ready';
    },
  });
  const passages = definePassages(passage);
  const source = new Story(passages, { entry: 'LazyRollback', state: { fail: false } }).start();
  const saved = JSON.parse(source.save());
  saved.present.state.fail = true;
  const target = new Story(passages, { entry: 'LazyRollback', state: { fail: false } });
  enters = 0;

  assert.throws(() => target.load(JSON.stringify(saved)), /load render failed/);
  assert.equal(enters, 0);
  target.start();
  assert.equal(enters, 1);
  assert.equal(text(target.view), 'ready');
});
