import { test } from 'vitest';
import { Story, definePassage, definePassageSet, definePassages } from '../dist/index.js';
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

test('a failed transaction restores state and reports the restore trace', () => {
  const traces: string[] = [];
  const passage = definePassage({
    id: 'TransactionRollback',
    render(ctx) {
      if (ctx.state.fail) throw new Error('transaction render failed');
      return 'ready';
    },
  });
  const instance = new Story(definePassages(passage), {
    entry: 'TransactionRollback',
    state: { fail: false },
    onTrace(event) {
      traces.push(event.type);
    },
  }).start();
  traces.length = 0;

  assert.throws(
    () =>
      instance.mutate((state) => {
        state.fail = true;
      }),
    /transaction render failed/,
  );
  assert.deepEqual(instance.state, { fail: false });
  assert.deepEqual(traces, ['render', 'restore']);
});

test('a setup frame is replaced only after the complete load succeeds', () => {
  let disposals = 0;
  const setup = definePassage({
    id: 'Setup',
    enter(ctx) {
      ctx.onDispose(() => disposals++);
    },
    render: () => [],
  });
  const passage = definePassage({
    id: 'StagedSetup',
    render(ctx) {
      if (ctx.state.fail) throw new Error('passage render failed');
      return 'ready';
    },
  });
  const instance = new Story(definePassageSet({ passages: [setup, passage], setup: [setup] }), {
    entry: 'StagedSetup',
    state: { fail: false },
  }).start();
  const saved = JSON.parse(instance.save());
  saved.present.state.fail = true;

  assert.throws(() => instance.load(JSON.stringify(saved)), /passage render failed/);
  assert.equal(disposals, 1, 'the staged replacement frame is disposed');
  assert.equal(text(instance.view), 'ready');
  instance.dispose();
  assert.equal(disposals, 2, 'the original frame survives until normal disposal');
});
