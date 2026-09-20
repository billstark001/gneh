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
