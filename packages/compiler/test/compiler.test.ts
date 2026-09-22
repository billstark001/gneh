import { test } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { assert, compiled, story, text, click } from './helpers.js';
import { generateModule } from '../dist/index.js';
import { Story, definePassages } from '../../runtime/dist/index.js';

const runtime = new URL('../../runtime/dist/index.js', import.meta.url).href;
const runtimeCompiler = new URL('../../runtime/dist/compiler/index.js', import.meta.url).href;

const core = new URL('../../core/dist/index.js', import.meta.url).href;

const linkRuntime = (code: string) =>
  code
    .replaceAll('"@gneh/runtime/compiler"', JSON.stringify(runtimeCompiler))
    .replaceAll('"@gneh/runtime"', JSON.stringify(runtime));

async function emittedStory(source, state = {}, modules = {}) {
  const result = compiled(source, 'inkdown', { state });
  const output = generateModule(result, source, 'test.inkdown');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gneh-esm-'));
  const file = path.join(dir, 'story.mjs');
  for (const [name, contents] of Object.entries(modules)) await fs.writeFile(path.join(dir, name), contents);
  await fs.writeFile(file, linkRuntime(output.code).replaceAll('"@gneh/core"', JSON.stringify(core)));
  const module = await import(pathToFileURL(file).href);
  const s = new Story(module.default, {
    entry: result.story.entry,
    state,
  }).start();
  return { story: s, module, output, dispose: () => fs.rm(dir, { recursive: true, force: true }) };
}

test('generated ESM and IR interpretation agree on mutations, conditions and navigation', async () => {
  const source = `:: Start
@action hit { @do $hp -= 1; }
@if ($hp > 0) {
HP: {{ $hp + 1 }}
[[Hit => hit]]
} @else {
Done
}
[[End]]
:: End
END`;
  const a = story(source, 'inkdown', { state: { hp: 2 } }),
    b = await emittedStory(source, { hp: 2 });
  try {
    for (let i = 0; i < 2; i++) {
      assert.equal(text(a.view), text(b.story.view));
      click(a, 'Hit');
      click(b.story, 'Hit');
      assert.deepEqual(JSON.parse(a.save()).present, JSON.parse(b.story.save()).present);
    }
    click(a, 'End');
    click(b.story, 'End');
    assert.equal(text(a.view), text(b.story.view));
    assert.deepEqual(Object.keys(b.module.default), ['Start', 'End']);
  } finally {
    await b.dispose();
  }
});

test('ESM evaluator handles arrow functions, optional chains, templates and short circuits', async () => {
  const expressions = [
    '$items.map(x => x * 2).join(",")',
    '$nothing?.a.b ?? "missing"',
    '$nothing?.[unknownName] ?? "safe"',
    '$nothing?.run(unknownName) ?? "safe"',
    '$fn?.(unknownName) ?? "no-call"',
    '`HP ${$hp}`',
    '$hp > 0 ? "alive" : "dead"',
    'false && unknownName',
    'true || unknownName',
    '({x: $hp}).x',
    '(($hp + 2))',
  ];
  for (const expression of expressions) {
    const source = '{{ ' + expression + ' }}',
      state = { items: [1, 2], nothing: null, fn: null, hp: 3 };
    const a = story(source, 'inkdown', { state }),
      b = await emittedStory(source, state);
    try {
      assert.equal(text(b.story.view), text(a.view), expression);
    } finally {
      await b.dispose();
    }
  }
});

test('optional chaining stops only its own chain, not a parenthesized outer access', () => {
  assert.throws(() => story('{{ ($nothing?.a).b }}', 'inkdown', { state: { nothing: null } }), /Cannot read/);
});

test('compiled null results are not evaluated twice', async () => {
  const source = `---
imports:
  ./helpers.mjs: [counted, calls]
---
:: Start [start]
{{ counted() }}{{ calls() }}`;
  const b = await emittedStory(
    source,
    {},
    {
      'helpers.mjs':
        'let count = 0; export function counted() { count++; return null; } export function calls() { return count; }',
    },
  );
  try {
    assert.equal(
      text(b.story.view),
      '2',
      'Two intentional mount-settling renders; never a second interpreter fallback per expression.',
    );
  } finally {
    await b.dispose();
  }
});

test('authored passage declarations use the generic route-props ABI', () => {
  const source = ':: Card [start]\n{{ props.enemy }}';
  const output = generateModule(compiled(source), source, 'card.inkdown');
  assert.match(output.declarations, /readonly "Card": Passage/);
  assert.equal(output.declarations.includes('Passage<{'), false);
  assert.equal(output.map.version, 3);
  assert.equal(output.map.sourcesContent[0], source);
  assert.ok(String(output.map.mappings).replaceAll(';', '').length > 0);
});

test('generated runtime IR omits only compiler-owned source and full spans', () => {
  const source = `:: Start {"source":"author","span":{"label":"wide"},"asset":{"type":"image","source":"cover.png","span":{"label":"metadata"}}}\n${'A long authored paragraph that must not be duplicated in runtime IR. '.repeat(200)} {{ $name }}`;
  const result = compiled(source, 'inkdown', { state: { name: 'Ada' } });
  const passages = result.passages;
  const output = generateModule(result, source, 'story.inkdown');
  assert.match(output.code, /"source":"author"/);
  assert.match(output.code, /"span":\{"label":"wide"\}/);
  assert.match(output.code, /"asset":\{"type":"image","source":"cover\.png","span":\{"label":"metadata"\}\}/);
  assert.doesNotMatch(output.code, /"source":"\$name"/);
  assert.doesNotMatch(output.code, /"span":\{"file":/);
  assert.ok(output.code.length < JSON.stringify(passages).length * 0.75);
  assert.equal(output.map.sourcesContent[0], source);
});

test('typed ESM namespaces expose all in-file passages', async () => {
  const output = await emittedStory(`:: Alpha
A
:: Beta
B`);
  try {
    assert.deepEqual(Object.keys(output.module.default), ['Alpha', 'Beta']);
    assert.equal(output.module.default.Alpha.id, 'Alpha');
    assert.equal(output.module.default.Beta.id, 'Beta');
  } finally {
    await output.dispose();
  }
});

test('render expressions reject mutation and statement-shaped JavaScript', () => {
  for (const source of ['{{ new Date() }}', '{{ $x = 1 }}', '{{ (() => { return 1; })() }}'])
    assert.ok(compiledError(source));
  assert.ok(!compiledError('{{ $x.constructor }}'));
  function compiledError(source) {
    try {
      compiled(source);
      return false;
    } catch {
      return true;
    }
  }
});

test('local passages have lexical module scope and survive fresh save/load', async () => {
  const source = `:: Start
@view Card({label}) {
Card: {{ label }}
}
@Card({label: "local"})
[[Next]]
:: Next
Next scene`;
  const output = generateModule(compiled(source), source, 'chapter.inkdown', {
    namespace: 'chapters/one.inkdown',
  });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gneh-local-'));
  try {
    const file = path.join(dir, 'chapter.mjs');
    await fs.writeFile(file, linkRuntime(output.code).replaceAll('"@gneh/core"', JSON.stringify(core)));
    const module = await import(pathToFileURL(file).href);
    const first = new Story(module.default, { entry: 'chapters/one.inkdown#Start' }).start();
    assert.equal(first.current, 'chapters/one.inkdown#Start');
    assert.match(text(first.view), /Card: local/);
    click(first, 'Next');
    assert.equal(first.current, 'chapters/one.inkdown#Next');
    const second = new Story(module.default, { entry: 'chapters/one.inkdown#Start' }).start();
    second.load(first.save());
    assert.equal(text(second.view), text(first.view));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('different modules may each define a private passage named Card', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gneh-namespaces-'));
  try {
    const modules = [];
    for (const id of ['alpha', 'beta']) {
      const source = `:: Start
[[Card]]
:: Card
${id}`;
      const output = generateModule(compiled(source), source, id + '.inkdown', {
        namespace: id,
      });
      const file = path.join(dir, id + '.mjs');
      await fs.writeFile(file, linkRuntime(output.code).replaceAll('"@gneh/core"', JSON.stringify(core)));
      modules.push(await import(pathToFileURL(file).href));
    }
    const instance = new Story(definePassages(...modules.map((m) => m.default)), { entry: 'alpha#Start' }).start();
    instance.navigate('alpha#Card');
    assert.equal(text(instance.view), 'alpha');
    instance.navigate('beta#Card');
    assert.equal(text(instance.view), 'beta');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('explicit namespace rewriting preserves a preceding lexical callable with the same name', async () => {
  const source = `:: Start
@view Card() { lexical }
@Card()
:: Card
passage`;
  const output = generateModule(compiled(source), source, 'chapter.inkdown', { namespace: 'chapter' });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gneh-namespace-scope-'));
  try {
    const file = path.join(dir, 'chapter.mjs');
    await fs.writeFile(file, linkRuntime(output.code));
    const module = await import(pathToFileURL(file).href);
    const instance = new Story(module.default, { entry: 'chapter#Start' }).start();
    assert.match(text(instance.view), /lexical/);
    assert.doesNotMatch(text(instance.view), /passage/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('private module helpers and live module bindings remain available to templates', async () => {
  const b = await emittedStory(
    `---
exports: [value, change]
---
@let value = "first"
@action change() { @do value = "second"; }
:: Start [start]
{{ value }} [[Change => change()]]`,
  );
  try {
    assert.match(text(b.story.view), /first/);
    assert.equal(b.module.value, 'first');
    click(b.story, 'Change');
    assert.equal(b.module.value, 'second');
    assert.match(b.output.declarations, /declare let change/);
  } finally {
    await b.dispose();
  }
});
