import { test } from 'vitest';
import { assert, story, text, click, compiled } from './helpers.js';
import { Story, defineFragment, v } from '../dist/index.js';
import { assertJson } from '../../core/dist/index.js';

const source =
  ':: Start\n@enter { @do $visits += 1; }\n@action hit { @do $hp -= 1; }\nHP: $hp / visit $visits\n[[Hit => hit]]\n@region notice { Empty }\n[[Next->End]]\n:: End\nDone';

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
    '@action hurt { @do $player.hp -= 1; @do $items[0].count++; }\n{{ $player.hp }} / {{ $items[0].count }}\n[[Hurt => hurt]]',
    'inkdown',
    { state: { player: { hp: 3 }, items: [{ count: 0 }] } },
  );
  click(s, 'Hurt');
  assert.deepEqual(s.state, { player: { hp: 2 }, items: [{ count: 1 }] });
  assert.equal(s.undo(), true);
  assert.deepEqual(s.state, { player: { hp: 3 }, items: [{ count: 0 }] });
});

test('Inkdown effects compose binding patterns, control flow and nested action calls', () => {
  const s = story(
    `@action add(amount) {
  @do $total += amount;
}
@action collect({bonus = 2}) {
  @let [first, ...rest] = $values;
  @if (first > 0) {
    @call add(first + bonus);
    @each (value of rest) {
      @call add(value);
    }
  } @else {
    @do $total = -1;
  }
}
Total: {{ $total }}
[[Collect => collect({})]]`,
    'inkdown',
    { state: { total: 0, values: [1, 3, 4] } },
  );
  click(s, 'Collect');
  assert.equal(s.state.total, 10);
  assert.match(text(s.view), /Total: 10/);
});

test('Inkdown views use the same binding-pattern call convention as actions', () => {
  const s = story('@view Badge({label = "untitled"}) { **{{ label }}** @children }\n@Badge({label: "Ready"}) { now }');
  assert.equal(text(s.view).replaceAll(/\s/g, ''), 'Readynow');
});

test('view and action rest parameters receive every call argument', () => {
  const s = story(
    `@view Join(first, ...rest) { {{ first + rest.join("") }} }
@action add(...values) {
  @each (value of values) { @do $total += value; }
}
@Join("A", "B", "C")
[[Add => add(1, 2, 3)]]`,
    'inkdown',
    { state: { total: 0 } },
  );
  assert.match(text(s.view).replaceAll(/\s/g, ''), /ABC/);
  click(s, 'Add');
  assert.equal(s.state.total, 6);
});

test('source-order compatibility effects migrate to native @effect blocks', () => {
  const s = story('before {{ $value }}\n@effect { @do $value += 1; }\nafter {{ $value }}', 'inkdown', {
    state: { value: 0 },
  });
  assert.equal(s.state.value, 1);
  assert.equal(text(s.view).replaceAll(/\s/g, ''), 'before0after1');
  s.mutate((state) => (state.value = 9));
  assert.equal(text(s.view).replaceAll(/\s/g, ''), 'before0after1');
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
  const bad = defineFragment({
    id: 'Bad',
    render(ctx) {
      ctx.state.x = 1;
      return 'bad';
    },
  });
  assert.throws(() => new Story([bad]).view);
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
  const data = JSON.parse(s.save());
  data.story = 'not-this-story';
  assert.throws(() => s.load(JSON.stringify(data)));
  data.story = JSON.parse(s.save()).story;
  data.present.props = [];
  assert.throws(() => s.load(JSON.stringify(data)));
  assert.throws(() => assertJson(JSON.parse('{"__proto__":{"polluted":true}}')));
  assert.throws(() => assertJson(new Date()));
});

test('keyed includes preserve local lifetime on reordering', () => {
  let mounts = 0,
    disposals = 0;
  const card = defineFragment({
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
    ':: Start\n@each (item of $items; key item.id) {\n@Card({item})\n}\n:: Card {"params":["item"]}\nplaceholder',
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
  const s = new Story(data, { fragments: [card] });
  assert.equal(text(s.view), 'AB');
  s.mutate((state) => state.items.reverse());
  assert.equal(text(s.view), 'BA');
  assert.equal(mounts, 2);
  s.mutate((state) => state.items.pop());
  assert.equal(disposals, 1);
  s.dispose();
  assert.equal(disposals, 2);
});

test('recursive fragments fail with a bounded, meaningful diagnostic', () => {
  const f = defineFragment({
    id: 'Recursion',
    render(ctx) {
      return ctx.include('Recursion');
    },
  });
  assert.throws(() => new Story([f]).view, /recursion/i);
});

test('duplicate structural keys roll back the action', () => {
  const s = story('@each (item of $items; key item.id) {\n{{ item.id }}\n}', 'inkdown', {
    state: { items: [{ id: 'a' }] },
  });
  assert.throws(() => s.mutate((state) => state.items.push({ id: 'a' })), /Duplicate/);
  assert.equal(s.state.items.length, 1);
});

test('native .mjs fragment ABI composes with parsed documents', () => {
  const native = defineFragment({
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
  const result = compiled(':: Start\n[[Go->Native]]\n:: Native\nPlaceholder');
  result.story.passages = result.story.passages.filter((p) => p.id !== 'Native');
  const s = new Story(result.story, { state: { count: 0 }, fragments: [native] });
  click(s, 'Go');
  click(s, 'Add');
  assert.equal(text(s.view), 'Counter: 1Add');
});

test('random is deterministic, snapshotted, and forbidden during render', () => {
  const src = '@enter { @do $roll = random(1, 1000); }\n$roll';
  const a = story(src, 'inkdown', { state: { roll: 0 }, seed: 3 }),
    b = story(src, 'inkdown', { state: { roll: 0 }, seed: 3 });
  assert.equal(a.state.roll, b.state.roll);
  assert.throws(() => story('{{ random(1,2) }}'), /render|store|pure/i);
});

test('expression iteration consumes a finite execution budget', () => {
  assert.throws(
    () =>
      story('@each (x of $items) {\n{{ x }}\n}', 'inkdown', {
        state: { items: Array(50).fill(1) },
        maxSteps: 10,
      }),
    /budget/i,
  );
});
