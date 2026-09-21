import { test } from 'vitest';
import { assert, click, story, text } from './helpers.js';

test('Inkdown callables are lexical closures with per-iteration environments', () => {
  const source = `@each (item of [{id: "a", label: "A"}, {id: "b", label: "B"}]; key item.id) {
  @view Cell() { {{ item.label }} }
  @action choose() { @do $picked = item.id; }
  @Cell()
  [[Choose {{ item.label }} => choose()]]
}`;
  const instance = story(source, 'inkdown', { state: { picked: '' } });
  assert.match(text(instance.view).replaceAll(/\s/g, ''), /AChooseABChooseB/);
  click(instance, 'Choose B');
  assert.equal(instance.state.picked, 'b');
});

test('Karlowe custom macros are serializable value and view callables', () => {
  const source = `(set: $double to (macro: num-type _n, [(output-data: _n * 2)]))
(set: $badge to (macro: str-type _label, [(output:)[Badge: (print: _label)]]))
(print: ($double: 3)) ($badge: "ready")`;
  const instance = story(source, 'karlowe');
  assert.match(text(instance.view).replaceAll(/\s/g, ''), /6Badge:ready/);
  const saved = instance.save();
  const restored = story(source, 'karlowe');
  restored.load(saved);
  assert.match(text(restored.view).replaceAll(/\s/g, ''), /6Badge:ready/);
});

test('value callables keep local computation but cannot mutate story state or consume randomness', () => {
  const local = `(set: $twice to (macro: num-type _n, [(set: _result to _n * 2)(output-data: _result)]))
(print: ($twice: 4))`;
  assert.match(text(story(local, 'karlowe').view), /8/);

  const mutation = `(set: $bad to (macro: [(set: $value to 2)(output-data: $value)]))(print: ($bad:))`;
  assert.throws(() => story(mutation, 'karlowe', { state: { value: 1 } }));
  const randomness = `(set: $roll to (macro: [(output-data: (random: 1, 6))]))(print: ($roll:))`;
  assert.throws(() => story(randomness, 'karlowe'));
});
