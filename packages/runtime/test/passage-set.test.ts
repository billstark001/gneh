import { test } from 'vitest';
import type { PassageIR, StoryNode } from '../../core/dist/index.js';
import { Story, defineIRFragment, definePassage, definePassages, defineView } from '../dist/index.js';
import { assert, story, text } from './helpers.js';

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

test('load and reset start a lazy story without replaying setup on first view', () => {
  const setup = definePassage({
    id: 'Setup',
    render(ctx) {
      ctx.state.runs += 1;
      return [];
    },
  });
  const start = definePassage({
    id: 'Start',
    metadata: { tags: ['start'] },
    render(ctx) {
      return String(ctx.state.runs);
    },
  });
  const passages = definePassages({ passages: [setup, start], setup: [setup] });
  const makeStory = () => new Story(passages, { state: { runs: 0 } });

  const source = makeStory().start();
  const loaded = makeStory();
  loaded.load(source.save());
  const loadedRuns = loaded.state.runs;
  assert.equal(text(loaded.view), String(loadedRuns));
  assert.equal(loaded.state.runs, loadedRuns);

  const reset = makeStory();
  reset.reset();
  assert.equal(text(reset.view), '1');
  assert.equal(reset.state.runs, 1);
});

test('undo and redo preserve the history limit for loaded branch histories', () => {
  const makeInstance = () => story('Ready', 'inkdown', { state: { count: 0 }, historyLimit: 2 });
  const source = makeInstance();
  const data = JSON.parse(source.save());
  const snapshot = data.present;
  data.past = [snapshot, snapshot];
  data.future = [snapshot, snapshot];
  const saved = JSON.stringify(data);

  const undone = makeInstance();
  undone.load(saved);
  assert.equal(undone.undo(), true);
  assert.equal(JSON.parse(undone.save()).future.length, 2);

  const redone = makeInstance();
  redone.load(saved);
  assert.equal(redone.redo(), true);
  assert.equal(JSON.parse(redone.save()).past.length, 2);
});

test('IR declaration discovery is depth-bounded before runtime rendering', () => {
  let body: StoryNode[] = [{ type: 'text', value: 'leaf', span: { file: 'deep', start: 0, end: 0 } }];
  for (let depth = 0; depth < 5_000; depth++)
    body = [{ type: 'content', kind: 'group', attrs: {}, children: body, span: { file: 'deep', start: 0, end: 0 } }];
  const ir: PassageIR = {
    id: 'Deep',
    name: 'Deep',
    dialect: 'inkdown',
    metadata: {},
    source: '',
    span: { file: 'deep', start: 0, end: 0 },
    body,
    evaluation: 'reactive',
    constants: {},
    capabilities: [],
  };
  assert.throws(() => defineIRFragment(ir), /IR nesting/i);
});
