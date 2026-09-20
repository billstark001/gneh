import { test } from 'vitest';
import { all, assert, story, text } from './helpers.js';

test('sugarcast follows SugarCube formatting, comments and continuation markup', () => {
  const source =
    "!Title\n//emphasis// ''strong'' __underline__ ==strike== ^^sup^^ ~~sub~~\n" +
    '"""$hidden //raw//"""\n{{{$hidden //code//}}}\n' +
    '/* hidden */ /% hidden too %/ visible\n' +
    '* item\n** nested\n# ordered\n----\n' +
    'joined \\   \ntogether\njoined again\n  \\ together';
  const s = story(source, 'sugarcast', { state: { hidden: 'shown' } });
  const kinds = all(s.view).map((node) => node.kind);
  for (const kind of [
    'heading',
    'emphasis',
    'strong',
    'underline',
    'strike',
    'superscript',
    'subscript',
    'code',
    'rule',
  ])
    assert.ok(kinds.includes(kind), `missing ${kind}`);
  assert.equal(kinds.filter((kind) => kind === 'list').length, 3);
  assert.match(text(s.view), /\$hidden \/\/raw\/\//);
  assert.match(text(s.view), /\$hidden \/\/code\/\//);
  assert.doesNotMatch(text(s.view), /shown|hidden too|hidden \*\//);
  assert.match(text(s.view), /joined together/);
  assert.match(text(s.view), /joined again together/);
});

test('sugarcast recognizes block code without evaluating its contents', () => {
  const s = story('{{{\n$hidden\n}}}', 'sugarcast', { state: { hidden: 'shown' } });
  assert.equal(text(s.view), '$hidden');
  assert.ok(all(s.view).some((node) => node.kind === 'code-block'));
});

test('sugarcast follows official naked-variable and nowiki behavior', () => {
  // SugarCube v2 docs, "Naked Variable" and "Verbatim Text":
  // https://www.motoslave.net/sugarcube/2/docs/#markup-naked-variable
  const s = story(
    '<<set _local = { name: "temporary" }>>$hero.name $items[1] $hero[$key] _local.name $$hero <nowiki>$hero.name //raw//</nowiki> `$name`',
    'sugarcast',
    {
      state: {
        hero: { name: 'Mara', title: 'Captain' },
        items: ['zero', 'one'],
        key: 'title',
        name: 'Mara',
      },
    },
  );
  assert.equal(text(s.view), 'Mara one Captain temporary $hero $hero.name //raw// `Mara`');
  assert.equal(
    all(s.view).some((node) => node.kind === 'code'),
    false,
  );
});

test('sugarcast supports both official print aliases', () => {
  // SugarCube v2 docs, "<<= expression>>" and "<<- expression>>".
  assert.equal(text(story('<<= $value>>/<<- $value>>', 'sugarcast', { state: { value: '<ok>' } }).view), '<ok>/<ok>');
});

test('sugarcast preserves SugarCube simple comparison aliases', () => {
  // SugarCube v2 docs, "Conditional operators".
  const source = '<<if 1 eq "1" and 1 isnot "1" and def $present and ndef $missing>>compatible<<else>>wrong<</if>>';
  assert.equal(text(story(source, 'sugarcast', { state: { present: 0 } }).view), 'compatible');
});
