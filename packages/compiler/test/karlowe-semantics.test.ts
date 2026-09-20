import { test } from 'vitest';
import { all, assert, story, text } from './helpers.js';

test('karlowe follows Harlowe inferred-comparison and logical precedence rules', () => {
  const source =
    '(if: $reason is 7 or 14 and $experience is 3)[match](else:)[miss] ' +
    '(if: 3 and 4 < $limit)[range](else:)[outside]';
  assert.equal(text(story(source, 'karlowe', { state: { reason: 5, experience: 3, limit: 5 } }).view), 'missrange');
  assert.equal(text(story(source, 'karlowe', { state: { reason: 14, experience: 3, limit: 5 } }).view), 'matchrange');
  assert.equal(
    text(story('(if: $reason is 7 or 14)[match](else:)[miss]', 'karlowe', { state: { reason: 5 } }).view),
    'miss',
  );
  assert.equal(text(story('(print: 1 is 2 < 3)', 'karlowe').view), 'false');
  assert.equal(text(story('(print: -1 + 2)', 'karlowe').view), '1');
  assert.equal(
    text(story('(if: $value > 2 and < 5 and it > 3)[yes](else:)[no]', 'karlowe', { state: { value: 4 } }).view),
    'yes',
  );
  assert.equal(
    text(
      story('(if: $hurt is $bleeding or $bandaged)[yes](else:)[no]', 'karlowe', {
        state: { hurt: false, bleeding: true, bandaged: true },
      }).view,
    ),
    'yes',
  );
});

test('karlowe preserves Harlowe prose line breaks and escaped joins', () => {
  const s = story('first\nsecond\\\nthird\n\\fourth', 'karlowe');
  assert.equal(text(s.view), 'firstsecondthirdfourth');
  assert.equal(all(s.view).filter((node) => node.kind === 'break').length, 1);
});

test('karlowe uses Harlowe formatting rather than Markdown lookalikes', () => {
  const s = story(
    "#Title\n//italic// ''bold'' *emphasis* **strong** ~~strike~~ ^^sup^^\n" +
      '`$hidden //raw//`\n* item\n** nested\n0. first\n---',
    'karlowe',
    { state: { hidden: 'shown' } },
  );
  const kinds = all(s.view).map((node) => node.kind);
  for (const kind of ['heading', 'italic', 'bold', 'emphasis', 'strong', 'strike', 'superscript', 'rule'])
    assert.ok(kinds.includes(kind), `missing ${kind}`);
  assert.equal(kinds.filter((kind) => kind === 'list').length, 3);
  assert.match(text(s.view), /\$hidden \/\/raw\/\//);
  assert.doesNotMatch(text(s.view), /shown/);
});

test('harlowe macro names also ignore underscores', () => {
  assert.equal(text(story('(Pr_In_T: 2 + 3)', 'karlowe').view), '5');
});

test('karlowe supports collapsing, unclosed collapsing and combined emphasis markup', () => {
  const s = story('{one\n    two} ***both*** {=three\n   four', 'karlowe');
  assert.equal(text(s.view), 'one two both three four');
  const nodes = all(s.view);
  assert.ok(nodes.some((node) => node.kind === 'span' && node.attrs?.collapse === true));
  const strong = nodes.find((node) => node.kind === 'strong');
  assert.equal(strong.children[0].kind, 'emphasis');
});

test('karlowe follows the official modal aligner markup', () => {
  // Harlowe 3.3.8 manual, "Aligner markup": https://twine2.neocities.org/#markup_aligner
  const s = story('==>\nright\n=><=\ncenter\n===><=\noffset\n<==>\njustified\n<==\nleft', 'karlowe');
  const groups = all(s.view).filter((node) => node.kind === 'group');
  assert.deepEqual(
    groups.map((node) => node.attrs?.alignment),
    ['right', 'center', 'center', 'justify'],
  );
  assert.deepEqual(groups[1].attrs, { alignment: 'center', marginLeft: 0, marginRight: 0 });
  assert.deepEqual(groups[2].attrs, { alignment: 'center', marginLeft: 50, marginRight: 0 });
  assert.equal(text(s.view), 'rightcenteroffsetjustifiedleft');
});

test('karlowe uses the rightmost Harlowe arrow and one-based computed possessive access', () => {
  // Harlowe 3.3.8 manual, "Link markup" and computed property indexing.
  const linked = story(':: Start\n[[A->B->End]]\n:: End\ndone', 'karlowe');
  assert.equal(text(linked.view), 'A->B');
  assert.equal(text(story('(print: (a: "first", "second")\'s (2))', 'karlowe').view), 'second');
  assert.equal(
    text(story('(print: (a: "first", "second")\'s ($position))', 'karlowe', { state: { position: 1 } }).view),
    'first',
  );
});
