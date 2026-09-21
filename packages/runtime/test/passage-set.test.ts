import { test } from 'vitest';
import { Story, definePassage, definePassages, defineView } from '../dist/index.js';
import { assert, text } from './helpers.js';

test('PassageSet entry selection has no property-order fallback', () => {
  const one = definePassage({ id: 'One', render: () => 'one' });
  const two = definePassage({ id: 'Two', render: () => 'two' });
  assert.throws(() => new Story(definePassages(one, two)), /entry|start/i);
  const start = definePassage({ id: 'Start', metadata: { tags: ['start'] }, render: () => 'start' });
  assert.equal(new Story(definePassages(one, start)).current, 'Start');
});

test('PassageSet setup plans compose in order and rebuild transient registrations', () => {
  const setupA = definePassage({
    id: 'SetupA',
    render(ctx) {
      ctx.state.order = String(ctx.state.order ?? '') + 'A';
      ctx.publish(
        'shared',
        defineView(() => 'A'),
      );
      return [];
    },
  });
  const setupB = definePassage({
    id: 'SetupB',
    render(ctx) {
      ctx.state.order = String(ctx.state.order ?? '') + 'B';
      return [];
    },
  });
  const start = definePassage({ id: 'Start', metadata: { tags: ['start'] }, render: () => 'ready' });
  const inherited = definePassages({ passages: [setupA, start], setup: [setupA] });
  const passages = definePassages({ passages: [inherited, setupB], setup: [setupB] });
  const instance = new Story(passages, { state: { order: '' } }).start();
  assert.equal(instance.state.order, 'AB');
  const first = instance.registrations.get('shared');
  assert.ok(first);
  instance.reset();
  assert.equal(instance.state.order, 'AB');
  assert.notEqual(instance.registrations.get('shared'), first);
  assert.throws(
    () => definePassages({ passages: [setupA, start], setup: [setupA, setupA] }),
    /Duplicate setup passage/,
  );
});

test('failed setup rolls back state and registry during start and load', () => {
  const setup = definePassage({
    id: 'Setup',
    render(ctx) {
      ctx.state.value = 99;
      ctx.publish(
        'temporary',
        defineView(() => 'temporary'),
      );
      if (ctx.state.fail) throw new Error('setup failed');
      return [];
    },
  });
  const start = definePassage({ id: 'Start', metadata: { tags: ['start'] }, render: () => 'ready' });
  const passages = definePassages({ passages: [setup, start], setup: [setup] });
  const failed = new Story(passages, { state: { fail: true, value: 0 } });
  assert.throws(() => failed.start(), /setup failed/);
  assert.deepEqual(failed.state, { fail: true, value: 0 });
  assert.equal(failed.registrations.size, 0);

  const instance = new Story(passages, { state: { fail: false, value: 0 } }).start();
  const registration = instance.registrations.get('temporary');
  const save = JSON.parse(instance.save());
  save.present.state.fail = true;
  save.present.state.value = 7;
  assert.throws(() => instance.load(JSON.stringify(save)), /setup failed/);
  assert.deepEqual(instance.state, { fail: false, value: 99 });
  assert.equal(instance.registrations.get('temporary'), registration);
  assert.equal(text(instance.view), 'ready');
});
