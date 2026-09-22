import { test } from 'vitest';
import { assert, compiled, text } from './helpers.js';
import { v } from '../../core/dist/index.js';
import { Story, definePassage, definePassages } from '../dist/index.js';
import { defineIRFragment } from '../dist/compiler/index.js';

test('handwritten flows are lazy and resume one explicit step at a time', () => {
  const reached: string[] = [];
  const passage = definePassage({
    id: 'Flow',
    capabilities: ['live'],
    render: () =>
      v.flow(
        v.step(() => {
          reached.push('first');
          return 'First';
        }, 'first'),
        v.step(() => {
          reached.push('second');
          return 'Second';
        }, 'second'),
      ),
  });
  const s = new Story(definePassages(passage), { entry: 'Flow' }).start();

  assert.equal(text(s.view), 'First');
  assert.equal(reached.includes('second'), false);
  assert.equal(s.suspension?.resume.type, 'manual');
  assert.equal(s.advance(), true);
  assert.equal(text(s.view), 'FirstSecond');
  assert.equal(reached.at(-1), 'second');
  assert.equal(s.advance(), true);
  assert.equal(s.suspension, undefined);
});

test('continuations save every JSON temporary and restore an injected IR suspension', () => {
  const result = compiled(`@effect {
  @let _a = 1;
  @let _b = 2;
}
{{ _a }}`);
  const ir = result.story.passages[0];
  ir.body.splice(1, 0, {
    type: 'suspend',
    id: 'middle',
    resume: { type: 'manual' },
    span: { ...ir.span, start: ir.body[0].span.end, end: ir.body[0].span.end },
  });
  ir.capabilities = [...new Set([...ir.capabilities, 'live'])];
  const passages = definePassages(defineIRFragment(ir));
  const source = new Story(passages, { entry: ir.id }).start();

  assert.equal(text(source.view), '');
  const save = source.save();
  const continuation = Object.values(JSON.parse(save).present.continuations)[0];
  const slots = Object.values(continuation.scopes).flatMap((scope) => Object.entries(scope));
  assert.deepEqual(Object.fromEntries(slots), { _a: 1, _b: 2 });

  const restored = new Story(passages, { entry: ir.id }).start();
  restored.load(save);
  assert.equal(restored.advance(), true);
  assert.equal(text(restored.view), '1');
});

test('current projection splits an IR suspension nested inside content', () => {
  const result = compiled('A{{ $middle }}B', 'inkdown', { state: { middle: 'X' } });
  const ir = result.story.passages[0];
  const paragraph = ir.body.find((node) => node.type === 'content');
  assert.equal(paragraph?.type, 'content');
  paragraph.children.splice(1, 0, {
    type: 'suspend',
    id: 'inline',
    resume: { type: 'manual' },
    span: paragraph.span,
  });
  ir.capabilities = [...new Set([...ir.capabilities, 'live'])];
  const s = new Story(definePassages(defineIRFragment(ir)), {
    entry: ir.id,
    state: result.story.state,
    flow: { projection: 'current' },
  }).start();

  assert.equal(text(s.view), 'A');
  assert.equal(s.advance(), true);
  assert.equal(text(s.view), 'XB');
});

test('keyed handwritten loops snapshot their items and resume by structural identity', () => {
  const passage = definePassage({
    id: 'Loop',
    capabilities: ['live'],
    render: () =>
      v.flow(
        v.each(
          (initial) => initial.state.items,
          (item) => item.id,
          (item) => v.step(() => item.name, `item:${item.id}`),
          'items',
        ),
      ),
  });
  const passages = definePassages(passage);
  const options = {
    entry: 'Loop',
    state: {
      items: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
        { id: 'c', name: 'C' },
      ],
    },
    flow: { projection: 'current' },
  };
  const source = new Story(passages, options).start();
  assert.equal(text(source.view), 'A');
  source.mutate((state) => state.items.reverse());
  assert.equal(text(source.view), 'A');
  assert.equal(source.advance(), true);
  assert.equal(text(source.view), 'B');
  const save = source.save();

  const restored = new Story(passages, options).start();
  restored.load(save);
  assert.equal(text(restored.view), 'B');
  assert.equal(restored.advance(), true);
  assert.equal(text(restored.view), 'C');
  assert.equal(restored.advance(), true);
  assert.equal(restored.suspension, undefined);
  restored.mutate((state) => (state.items.at(-1).name = 'A2'));
  assert.equal(text(restored.view), 'A2');
});

test('an IR suspension inside a keyed each resumes the snapshotted iteration', () => {
  const result = compiled(`@each (item of $items; key item.id) {
{{ item.name }}
}`);
  const ir = result.story.passages[0];
  const loop = ir.body.find((node) => node.type === 'each');
  assert.equal(loop?.type, 'each');
  loop.children.push({
    type: 'suspend',
    id: 'item',
    resume: { type: 'manual' },
    span: loop.span,
  });
  ir.capabilities = [...new Set([...ir.capabilities, 'live'])];
  const passages = definePassages(defineIRFragment(ir));
  const options = {
    entry: ir.id,
    state: {
      items: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
    },
    flow: { projection: 'current' },
  };
  const s = new Story(passages, options).start();

  assert.equal(text(s.view).trim(), 'A');
  s.mutate((state) => state.items.reverse());
  assert.equal(s.advance(), true);
  assert.equal(text(s.view).trim(), 'B');
});

test('signal, timer and task suspensions resume only through their matching API', () => {
  let now = 100;
  const passage = definePassage({
    id: 'Conditions',
    capabilities: ['live'],
    render: () =>
      v.flow(
        'A',
        v.suspend({ type: 'signal', name: 'ready', filter: 7 }, 'signal'),
        'B',
        v.suspend({ type: 'timer', durationMs: 50 }, 'timer'),
        'C',
        v.suspend({ type: 'task', operation: 'fetch' }, 'task'),
        'D',
      ),
  });
  const s = new Story(definePassages(passage), { entry: 'Conditions', now: () => now }).start();
  assert.equal(text(s.view), 'A');
  assert.equal(s.signal('other', 7), false);
  assert.equal(s.signal('ready', 8), false);
  assert.equal(s.signal('ready', 7), true);
  assert.equal(text(s.view), 'AB');
  assert.equal(s.tick(149), false);
  now = 150;
  assert.equal(s.tick(), true);
  assert.equal(text(s.view), 'ABC');
  assert.equal(s.completeTask('other'), false);
  assert.equal(s.completeTask('fetch', { ok: true }), true);
  assert.equal(text(s.view), 'ABCD');
});

test('the public suspension descriptor cannot mutate the active suspension', () => {
  const passage = definePassage({
    id: 'Protected',
    capabilities: ['live'],
    render: () => v.flow('A', v.suspend({ type: 'manual' }, 'pause'), 'B'),
  });
  const instance = new Story(definePassages(passage), { entry: 'Protected' }).start();
  const exposed = instance.suspension!;

  (exposed.resume as { type: string }).type = 'signal';
  assert.equal(instance.advance(), true);
  assert.equal(text(instance.view), 'AB');
});

test('a failed load restores the prior continuation frontier', () => {
  const passage = definePassage({
    id: 'Rollback',
    capabilities: ['live'],
    render: (ctx) => {
      if (ctx.state.fail) throw new Error('load render failed');
      return v.flow(
        v.step(() => 'A', 'a'),
        v.step(() => 'B', 'b'),
      );
    },
  });
  const s = new Story(definePassages(passage), { entry: 'Rollback', state: { fail: false } }).start();
  const invalid = JSON.parse(s.save());
  invalid.present.state.fail = true;

  assert.throws(() => s.load(JSON.stringify(invalid)), /load render failed/);
  assert.equal(text(s.view), 'A');
  assert.equal(s.advance(), true);
  assert.equal(text(s.view), 'AB');
});
