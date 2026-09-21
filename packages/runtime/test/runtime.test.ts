import { test } from 'vitest';
import { assert, story, text, click, compiled } from './helpers.js';
import { Story, defineIRFragment, definePassage, definePassages, v } from '../dist/index.js';
import { assertJson } from '../../core/dist/index.js';

const source = `:: Start [start]
@do $visits += 1
@action hit { @do $hp -= 1; }
HP: $hp / visit $visits
[[Hit => hit]]
@region notice { Empty }
[[Next->End]]
:: End
Done`;

test('entry effects run once per mount, not once per reactive render', () => {
  const s = story(source, 'inkdown', { state: { hp: 3, visits: 0 } });
  assert.equal(s.state.visits, 1);
  click(s, 'Hit');
  click(s, 'Hit');
  assert.equal(s.state.visits, 1);
  s.navigate('End');
  s.navigate('Start');
  assert.equal(s.state.visits, 2);
});

test('transactions update the full semantic view and checkpoint state', () => {
  const s = story(source, 'inkdown', { state: { hp: 3, visits: 0 } });
  click(s, 'Hit');
  assert.match(text(s.view), /HP: 2/);
  assert.equal(s.undo(), true);
  assert.equal(s.state.hp, 3);
  assert.equal(s.redo(), true);
  assert.equal(s.state.hp, 2);
});

test('effect expressions commit member assignments and updates through the story transaction', () => {
  const s = story(
    `@action hurt { @do $player.hp -= 1; @do $items[0].count++; }
{{ $player.hp }} / {{ $items[0].count }}
[[Hurt => hurt]]`,
    'inkdown',
    { state: { player: { hp: 3 }, items: [{ count: 0 }] } },
  );
  click(s, 'Hurt');
  assert.deepEqual(s.state, { player: { hp: 2 }, items: [{ count: 1 }] });
  assert.equal(s.undo(), true);
  assert.deepEqual(s.state, { player: { hp: 3 }, items: [{ count: 0 }] });
});

test('failed mutation rolls state and history back', () => {
  const s = story(source, 'inkdown', { state: { hp: 3, visits: 0 } });
  assert.throws(() =>
    s.mutate((state) => {
      state.hp = 0;
      state.bad = () => 1;
    }),
  );
  assert.equal(s.state.hp, 3);
  assert.equal(s.canUndo, false);
  assert.equal(s.state.visits, 1);
});

test('state exposed to callers and rendering is deeply read-only', () => {
  const s = story('Hello', 'inkdown', { state: { player: { hp: 3 } } });
  assert.throws(() => {
    s.state.player.hp = 0;
  });
  const bad = definePassage({
    id: 'Bad',
    render(ctx) {
      ctx.state.x = 1;
      return 'bad';
    },
  });
  assert.throws(() => new Story(definePassages(bad), { entry: 'Bad' }).view);
});

test('regions support set, append, clear and reset without touching story state', () => {
  const s = story(source, 'inkdown', { state: { hp: 3, visits: 0 } });
  const region = s.region('notice');
  region.set(v.p('Replaced'));
  region.append(v.strong('More'));
  assert.match(text(s.view), /ReplacedMore/);
  region.clear();
  assert.doesNotMatch(text(s.view), /Empty|Replaced/);
  region.reset();
  assert.match(text(s.view), /Empty/);
  assert.equal(s.canUndo, false);
});

test('region ownership is per fragment instance and stale handles fail', () => {
  const s = story(source, 'inkdown', { state: { hp: 3, visits: 0 } });
  const handle = s.region('notice');
  s.navigate('End');
  assert.throws(() => handle.set('Too late'), /disposed|longer/);
});

test('save/load and undo restore persistent state, not imperative region overrides', () => {
  const s = story(source, 'inkdown', { state: { hp: 3, visits: 0 } });
  click(s, 'Hit');
  const save = s.save();
  s.region('notice').set('Transient');
  click(s, 'Hit');
  s.load(save);
  assert.equal(s.state.hp, 2);
  assert.equal(s.state.visits, 1);
  assert.match(text(s.view), /Empty/);
  assert.doesNotMatch(text(s.view), /Transient/);
  assert.equal(s.undo(), true);
  assert.equal(s.state.hp, 3);
});

test('invalid save identity, props and prototype-bearing state are rejected', () => {
  const s = story('Hi');
  assert.throws(() => s.load('{'), /SAVE_JSON|Invalid save JSON/);
  const data = JSON.parse(s.save());
  data.story = 'not-this-story';
  assert.throws(() => s.load(JSON.stringify(data)));
  data.story = JSON.parse(s.save()).story;
  data.present.props = [];
  assert.throws(() => s.load(JSON.stringify(data)));
  data.present.props = {};
  data.present.current = 7;
  assert.throws(() => s.load(JSON.stringify(data)), /route.*string/i);
  assert.throws(() => assertJson(JSON.parse('{"__proto__":{"polluted":true}}')));
  assert.throws(() => assertJson(new Date()));
});

test('loading with a zero history limit does not retain saved undo or redo entries', () => {
  const source = story('Ready', 'inkdown', { state: { count: 0 } });
  source.mutate((state) => (state.count += 1));
  source.mutate((state) => (state.count += 1));
  source.undo();
  assert.equal(source.canUndo, true);
  assert.equal(source.canRedo, true);

  const loaded = story('Ready', 'inkdown', { state: { count: 0 }, historyLimit: 0 });
  loaded.load(source.save());
  assert.equal(loaded.canUndo, false);
  assert.equal(loaded.canRedo, false);
});

test('keyed includes preserve local lifetime on reordering', () => {
  let mounts = 0,
    disposals = 0;
  const card = definePassage({
    id: 'Card',
    metadata: { params: ['item'] },
    enter(ctx) {
      mounts++;
      ctx.onDispose(() => disposals++);
    },
    render(ctx, props) {
      return v.p(props.item.name);
    },
  });
  const data = compiled(
    `:: Start
@each (item of $items; key item.id) {
@Card({item})
}
:: Card {"params":["item"]}
placeholder`,
    'inkdown',
    {
      state: {
        items: [
          { id: 'a', name: 'A' },
          { id: 'b', name: 'B' },
        ],
      },
    },
  ).story;
  data.passages = data.passages.filter((p) => p.id !== 'Card');
  const passages = definePassages(...data.passages.map(defineIRFragment), card);
  const s = new Story(passages, { entry: data.entry, state: data.state });
  assert.equal(text(s.view), 'AB');
  s.mutate((state) => (state.items = state.items.map((item) => ({ ...item, name: item.name + '2' }))));
  assert.equal(text(s.view), 'A2B2');
  assert.equal(mounts, 2);
  s.mutate((state) => state.items.reverse());
  assert.equal(text(s.view), 'B2A2');
  assert.equal(mounts, 2);
  s.mutate((state) => state.items.pop());
  assert.equal(disposals, 1);
  s.dispose();
  assert.equal(disposals, 2);
});

test('recursive fragments fail with a bounded, meaningful diagnostic', () => {
  const f = definePassage({
    id: 'Recursion',
    render(ctx) {
      return ctx.include('Recursion');
    },
  });
  assert.throws(() => new Story(definePassages(f), { entry: 'Recursion' }).view, /recursion/i);
});

test('recursive authored views fail before overflowing the JavaScript stack', () => {
  assert.throws(
    () =>
      story(`@view recurse() { @recurse() }
@recurse()`),
    /IR nesting/i,
  );
});

test('recursive authored actions fail before overflowing the JavaScript stack', () => {
  const instance = story(`@action recurse() { @call recurse(); }
[[Go => recurse]]`);
  assert.throws(() => click(instance, 'Go'), /callable recursion/i);
});

test('duplicate structural keys roll back the action', () => {
  const s = story(
    `@each (item of $items; key item.id) {
{{ item.id }}
}`,
    'inkdown',
    {
      state: { items: [{ id: 'a' }] },
    },
  );
  assert.throws(() => s.mutate((state) => state.items.push({ id: 'a' })), /Duplicate/);
  assert.equal(s.state.items.length, 1);
});

test('native .mjs fragment ABI composes with parsed documents', () => {
  const native = definePassage({
    id: 'Native',
    capabilities: ['live'],
    render(ctx) {
      return [
        v.p('Counter: ', ctx.state.count),
        v.button('Add', () =>
          ctx.dispatch((action) => {
            action.state.count += 1;
          }),
        ),
      ];
    },
  });
  const result = compiled(`:: Start
[[Go->Native]]
:: Native
Placeholder`);
  result.story.passages = result.story.passages.filter((p) => p.id !== 'Native');
  const passages = definePassages(...result.story.passages.map(defineIRFragment), native);
  const s = new Story(passages, { entry: result.story.entry, state: { count: 0 } });
  click(s, 'Go');
  click(s, 'Add');
  assert.equal(text(s.view), 'Counter: 1Add');
});

test('random is deterministic, snapshotted, and forbidden during render', () => {
  const src = '@do $roll = random(1, 1000)\n$roll';
  const a = story(src, 'inkdown', { state: { roll: 0 }, seed: 3 }),
    b = story(src, 'inkdown', { state: { roll: 0 }, seed: 3 });
  assert.equal(a.state.roll, b.state.roll);
  assert.throws(() => story('{{ random(1,2) }}'), /render|store|pure/i);
  assert.throws(
    () => story('@do $roll = random(-9007199254740991, 9007199254740991)', 'inkdown', { state: { roll: 0 } }),
    /random range/i,
  );
});

test('runtime limits cannot be disabled with non-finite or wrapping options', () => {
  for (const options of [{ historyLimit: Infinity }, { maxSteps: NaN }, { seed: -1 }, { seed: 4294967296 }])
    assert.throws(() => story('Hello', 'inkdown', options));
});

test('validated runtime limits are snapshotted instead of retaining the options object', () => {
  const options = { state: { count: 0 }, historyLimit: 1 };
  const instance = story('Ready', 'inkdown', options);
  options.historyLimit = Infinity;
  instance.mutate((state) => (state.count += 1));
  instance.mutate((state) => (state.count += 1));
  assert.equal(instance.undo(), true);
  assert.equal(instance.undo(), false);
});

test('expression iteration consumes a finite execution budget', () => {
  assert.throws(
    () =>
      story(
        `@each (x of $items) {
{{ x }}
}`,
        'inkdown',
        {
          state: { items: Array(50).fill(1) },
          maxSteps: 10,
        },
      ),
    /budget/i,
  );
});
