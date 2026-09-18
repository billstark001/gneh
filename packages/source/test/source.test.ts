import { test } from 'vitest';
import assert from 'node:assert/strict';
import { splitPassages, parseHeader, parseMetadata, mergeMetadata, emitTwee, metadataJSON } from '../dist/index.js';

test('Twee header JSON and both front matter scopes merge deterministically', () => {
  const source =
    '---\ntags: [book]\nlayout:\n  density: loose\n---\n:: Card [component] {"position":"1,2","layout":{"tone":"quiet"}}\n---\nid: EnemyCard\nparams: [enemy]\nlayout:\n  density: compact\n---\nHello';
  const result = splitPassages(source, 'card.inkdown');
  assert.deepEqual(result.diagnostics, []);
  const p = result.passages[0];
  assert.equal(p.id, 'EnemyCard');
  assert.equal(p.name, 'Card');
  assert.deepEqual(p.metadata.tags, ['book', 'component']);
  assert.deepEqual(p.metadata.layout, { density: 'compact', tone: 'quiet' });
  assert.equal(source.slice(p.bodyOffset), 'Hello');
  assert.equal(JSON.parse(metadataJSON(result)).EnemyCard.position, '1,2');
});

test('all dialects use exactly the same container parser', () => {
  for (const ext of ['inkdown', 'karlowe', 'sugarcast']) {
    const parsed = splitPassages(':: One [tag] {"x":1}\n---\nparams: [enemy]\n---\nbody\n:: Two\nsecond', `x.${ext}`);
    assert.deepEqual(
      parsed.passages.map((p) => p.id),
      ['One', 'Two'],
    );
    assert.deepEqual(parsed.passages[0].metadata.params, ['enemy']);
  }
});

test('fenced code cannot accidentally start another passage', () => {
  const result = splitPassages(':: A\n```twee\n:: NotAPassage\n```\n\n:: B\nDone');
  assert.deepEqual(
    result.passages.map((p) => p.id),
    ['A', 'B'],
  );
  assert.match(result.passages[0].body, /NotAPassage/);
});

test('CRLF, Unicode and escaped header names retain source offsets', () => {
  const source = ':: 名字\\[一\\] [tag]\r\n你好\r\n:: Next\r\nWorld';
  const result = splitPassages(source);
  assert.equal(result.passages[0].name, '名字[一]');
  assert.equal(source.slice(result.passages[0].bodyOffset, result.passages[0].span.end), '你好\r\n');
});

test('standalone YAML id names an implicit default passage', () => {
  const result = splitPassages('---\nid: Standalone\nparams: [value]\n---\nbody', 'large.md');
  assert.equal(result.passages[0].id, 'Standalone');
  assert.equal(result.passages[0].body, 'body');
});

test('canonical metadata output round trips both formats', () => {
  const source = '---\ntags: [one]\n---\n:: A [two] {"x":{"a":1}}\n---\nx:\n  b: 2\n---\nbody';
  const first = splitPassages(source);
  const second = splitPassages(emitTwee(first.passages));
  assert.deepEqual(second.passages[0].metadata, first.passages[0].metadata);
});

test('metadata profile supports typed scalars, flow collections and block strings', () => {
  assert.deepEqual(
    parseMetadata(
      'id: X\nparams: [enemy, compact]\nflag: true\ncount: 2\nnone: null\nobj: {a: 1, b: [two, three]}\ntext: |-\n  line1\n  line2',
    ),
    {
      id: 'X',
      params: ['enemy', 'compact'],
      flag: true,
      count: 2,
      none: null,
      obj: { a: 1, b: ['two', 'three'] },
      text: 'line1\nline2',
    },
  );
});

test('metadata merges replace arrays except stable-union tags', () => {
  assert.deepEqual(mergeMetadata({ a: [1], tags: ['x'] }, { a: [2], tags: ['x', 'y'] }), {
    a: [2],
    tags: ['x', 'y'],
  });
});

test('unsafe metadata constructs and duplicate YAML keys are diagnosed', () => {
  for (const source of ['x: 1\nx: 2', '__proto__: x', 'x: &a foo', 'x: .inf'])
    assert.throws(() => parseMetadata(source));
  assert.throws(() => parseHeader(':: A {bad}'));
});

test('unclosed YAML, duplicate ids and invalid params are errors, never ignored', () => {
  assert.equal(splitPassages('---\nid: bad').diagnostics[0].severity, 'error');
  assert.equal(splitPassages(':: A\nx\n:: A\ny').diagnostics[0].code, 'DUPLICATE_ID');
  assert.equal(splitPassages('---\nparams: nope\n---\nx').diagnostics[0].severity, 'error');
});
