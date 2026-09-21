import { test } from 'vitest';
import { assert, click, compiled, compileSource, story, text } from './helpers.js';

test('SugarCube widgets lower to portable views with arguments, children and effects', () => {
  const source = `:: WidgetDefinitions [widget]
<<widget "badge">><<print _args[0]>><</widget>>
<<widget "panel" container>>[<<print _contents>>]<</widget>>
<<widget "add">><<set $total += _args[0]>><</widget>>
:: Start
<<badge "Ready">>
<<panel>>inside<</panel>>
<<add 2>>
<<print $total>>`;
  const instance = story(source, 'sugarcast', { state: { total: 1 } });
  assert.equal(instance.state.total, 3);
  assert.match(text(instance.view).replaceAll(/\s/g, ''), /Ready\[inside\]3/);
});

test('SugarCube widgets can call other file-wide widgets', () => {
  const source = `:: WidgetDefinitions [widget]
<<widget "outer">>before <<inner _args[0]>> after<</widget>>
<<widget "inner">><<print _args[0]>><</widget>>
:: Start
<<outer "nested">>`;
  assert.match(text(story(source, 'sugarcast').view).replaceAll(/\s/g, ''), /beforenestedafter/);
});

test('nested Sugarcast widgets are lexical callables instead of file-wide registrations', () => {
  const source = `<<if true>>
  <<widget "local">><<print _args[0]>><</widget>>
  <<local "inside">>
<</if>>`;
  assert.match(text(story(source, 'sugarcast').view), /inside/);
  const outside = compileSource(source + '\n<<local "outside">>', 'test.sugarcast', { dialect: 'sugarcast' });
  assert.ok(outside.diagnostics.some((diagnostic) => diagnostic.code === 'VIEW_MISSING'));
});

test('SugarCube widget capabilities include their lazily lowered bodies', () => {
  const source = '<<widget "badge">><<hostvalue>><</widget>><<badge>>';
  const result = compiled(source, 'sugarcast', {
    runtimeExtensionIds: ['sugarcast/hostvalue'],
  });
  assert.ok(result.passages[0].capabilities.includes('runtime-extension:sugarcast/hostvalue'));
});

test('SugarCube wiki-link headers and effect-only button control flow remain portable', () => {
  const source = `:: Start
<<link [[Continue|$next]]>><</link>>
<<button "Add">>
  <<if $enabled>>
    <<for _value of $values>><<set $total += _value>><</for>>
  <<else>><<set $total = -1>><</if>>
<</button>>
:: End
done`;
  const instance = story(source, 'sugarcast', {
    state: { next: 'End', enabled: true, values: [2, 3], total: 0 },
  });
  click(instance, 'Add');
  assert.equal(instance.state.total, 5);
  click(instance, 'Continue');
  assert.equal(instance.current, 'End');
});
