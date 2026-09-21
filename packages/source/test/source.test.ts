import { test } from 'vitest';
import assert from 'node:assert/strict';
import { splitPassages, parseHeader, parseMetadata, mergeMetadata, emitTwee, metadataJSON } from '../dist/index.js';

test('file YAML owns module linkage while header JSON owns passage metadata', () => {
  const source = `---
metadata:
  title: Book
imports:
  ./panel.mjs: Panel
exports: [CardView]
setup: [EnemyCard]
---
:: Card [component] {"id":"EnemyCard","position":"1,2","audience":"adult","layout":{"tone":"quiet"}}
Hello`;
  const result = splitPassages(source, 'card.inkdown');
  assert.deepEqual(result.diagnostics, []);
  const p = result.passages[0];
  assert.equal(p.id, 'EnemyCard');
  assert.equal(p.name, 'Card');
  assert.deepEqual(p.metadata.tags, ['component']);
  assert.deepEqual(p.metadata.layout, { tone: 'quiet' });
  assert.deepEqual(result.metadata, { title: 'Book' });
  assert.deepEqual(result.linkage.imports, [{ source: './panel.mjs', imported: 'default', local: 'Panel' }]);
  assert.deepEqual(result.linkage.exports, [{ local: 'CardView', exported: 'CardView' }]);
  assert.deepEqual(result.linkage.setup, ['EnemyCard']);
  assert.equal(source.slice(p.bodyOffset), 'Hello');
  assert.equal(JSON.parse(metadataJSON(result)).EnemyCard.position, '1,2');
});

test('all dialects use exactly the same container parser', () => {
  for (const ext of ['inkdown', 'karlowe', 'sugarcast']) {
    const parsed = splitPassages(
      `:: One [tag] {"x":1,"audience":["reader"]}
body
:: Two
second`,
      `x.${ext}`,
    );
    assert.deepEqual(
      parsed.passages.map((p) => p.id),
      ['One', 'Two'],
    );
    assert.deepEqual(parsed.passages[0].metadata.audience, ['reader']);
  }
});

test('fenced code cannot accidentally start another passage', () => {
  const result = splitPassages(`:: A
\`\`\`twee
:: NotAPassage
\`\`\`

:: B
Done`);
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

test('headerless source is a primary initializer, never an implicit passage', () => {
  const result = splitPassages(
    `---
metadata:
  title: Standalone
---
@const value = 1`,
    'large.inkdown',
  );
  assert.equal(result.passages.length, 0);
  assert.equal(result.primary?.id, 'primary');
  assert.equal(result.primary?.body, '@const value = 1');
});

test('canonical metadata output round trips both formats', () => {
  const source = ':: A [two] {"x":{"a":1}}\nbody';
  const first = splitPassages(source);
  const second = splitPassages(emitTwee(first.passages));
  assert.deepEqual(second.passages[0].metadata, first.passages[0].metadata);
});

test('metadata profile supports typed scalars, flow collections and block strings', () => {
  assert.deepEqual(
    parseMetadata(
      `id: X
audience: [reader, editor]
flag: true
count: 2
none: null
obj: {a: 1, b: [two, three]}
text: |-
  line1
  line2`,
    ),
    {
      id: 'X',
      audience: ['reader', 'editor'],
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
  assert.throws(() => parseMetadata('"broken" suffix: value'), /Invalid quoted metadata key/);
  assert.throws(() => parseMetadata("'broken' suffix: value"), /Invalid quoted metadata key/);
  assert.throws(() => parseHeader(':: A {bad}'));
});

test('metadata nesting is bounded before host recursion limits', () => {
  assert.doesNotThrow(() => parseMetadata(`x: ${'['.repeat(127)}0${']'.repeat(127)}`));
  assert.throws(() => parseMetadata(`x: ${'['.repeat(5_000)}0${']'.repeat(5_000)}`), /nesting depth limit/);
  const block = Array.from({ length: 500 }, (_, index) => `${'  '.repeat(index)}x${index}:`).join('\n');
  assert.throws(() => parseMetadata(`${block}\n${'  '.repeat(500)}leaf: true`), /nesting depth limit/);
});

test('unclosed YAML and duplicate ids are errors, never ignored', () => {
  assert.equal(splitPassages('---\nid: bad').diagnostics[0].severity, 'error');
  assert.equal(
    splitPassages(`:: A
x
:: A
y`).diagnostics[0].code,
    'DUPLICATE_ID',
  );
});

test('duplicate file YAML and passage front matter are rejected explicitly', () => {
  const duplicate = splitPassages(`---
metadata: {title: A}
---
---
metadata: {title: B}
---
:: Start
body`);
  assert.ok(duplicate.diagnostics.some((diagnostic) => diagnostic.code === 'FILE_METADATA_DUPLICATE'));
  const passage = splitPassages(`:: Start
---
audience: [reader]
---
body`);
  assert.ok(passage.diagnostics.some((diagnostic) => diagnostic.code === 'PASSAGE_FRONT_MATTER'));
});

test('module linkage rejects ambiguous or invalid ESM binding names', () => {
  for (const yaml of [
    'imports: {"./x.mjs": {$value: =}}',
    'imports: {"./x.mjs": [same, same]}',
    'exports: {one: default}',
    'exports: {one: shared, two: shared}',
    'setup: [Start, Start]',
  ]) {
    const parsed = splitPassages(`---
${yaml}
---
:: Start
body`);
    assert.ok(
      parsed.diagnostics.some((diagnostic) => diagnostic.severity === 'error'),
      yaml,
    );
  }
});
