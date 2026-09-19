import { test } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { assert, compiled, story, text, click } from './helpers.js';
import { generateModule } from '../dist/index.js';
import { Story } from '../../runtime/dist/index.js';

const runtime = new URL('../../runtime/dist/index.js', import.meta.url).href;

const core = new URL('../../core/dist/index.js', import.meta.url).href;

async function emittedStory(source, state = {}) {
  const result = compiled(source, 'inkdown', { state });
  const output = generateModule(result.passages, source, 'test.inkdown');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gneh-esm-'));
  const file = path.join(dir, 'story.mjs');
  await fs.writeFile(
    file,
    output.code.replaceAll('"@gneh/runtime"', JSON.stringify(runtime)).replaceAll('"@gneh/core"', JSON.stringify(core)),
  );
  const module = await import(pathToFileURL(file).href);
  const s = new Story(Object.values(module.fragments), {
    entry: result.story.entry,
    state,
  }).start();
  return { story: s, module, output, dispose: () => fs.rm(dir, { recursive: true, force: true }) };
}

test('generated ESM and IR interpretation agree on mutations, conditions and navigation', async () => {
  const source =
    ':: Start\n@action hit { $hp -= 1; }\n@if ($hp > 0) {\nHP: {{ $hp + 1 }}\n[[Hit => hit]]\n} @else {\nDone\n}\n[[End]]\n:: End\nEND';
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
    assert.equal(b.module.default.kind, 'gneh.fragment');
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
  const source =
    '@module {\nexport let calls = 0;\nexport function counted() { calls++; return null; }\n}\n{{ counted() }}';
  const b = await emittedStory(source);
  try {
    assert.equal(text(b.story.view), '');
    assert.equal(
      b.module.calls,
      2,
      'Two intentional mount-settling renders; never a second interpreter fallback per expression.',
    );
  } finally {
    await b.dispose();
  }
});

test('metadata creates concrete required props in declaration output', () => {
  const source =
    "---\nid: Card\nparams: [enemy, compact]\noptionalParams: [compact]\nparamTypes:\n  enemy: '{hp: number; name: string}'\n  compact: boolean\n---\n{{ enemy.hp }}";
  const output = generateModule(compiled(source).passages, source, 'card.inkdown');
  assert.match(output.declarations, /"enemy": \{hp: number; name: string\}/);
  assert.match(output.declarations, /"compact"\?: boolean/);
  assert.equal(output.map.version, 3);
  assert.equal(output.map.sourcesContent[0], source);
  assert.ok(String(output.map.mappings).replaceAll(';', '').length > 0);
});

test('typed ESM namespaces expose all in-file passages', async () => {
  const output = await emittedStory(':: Alpha\nA\n:: Beta\nB');
  try {
    assert.deepEqual(Object.keys(output.module.fragments), ['Alpha', 'Beta']);
    assert.equal(output.module.default.id, 'Alpha');
    assert.equal(output.module.metadata.Beta.id, 'Beta');
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
  const source =
    ':: Start\n@Card({label: "local"})\n[[Next]]\n:: Card {"params":["label"]}\nCard: {{ label }}\n:: Next\nNext scene';
  const output = generateModule(compiled(source).passages, source, 'chapter.inkdown', {
    namespace: 'chapters/one.inkdown',
  });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gneh-local-'));
  try {
    const file = path.join(dir, 'chapter.mjs');
    await fs.writeFile(
      file,
      output.code
        .replaceAll('"@gneh/runtime"', JSON.stringify(runtime))
        .replaceAll('"@gneh/core"', JSON.stringify(core)),
    );
    const module = await import(pathToFileURL(file).href);
    const first = new Story([module.default]).start();
    assert.equal(first.current, 'chapters/one.inkdown#Start');
    assert.match(text(first.view), /Card: local/);
    click(first, 'Next');
    assert.equal(first.current, 'chapters/one.inkdown#Next');
    const second = new Story([module.default]).start();
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
      const source = `:: Start\n@Card()\n:: Card\n${id}`;
      const output = generateModule(compiled(source).passages, source, id + '.inkdown', {
        namespace: id,
      });
      const file = path.join(dir, id + '.mjs');
      await fs.writeFile(
        file,
        output.code
          .replaceAll('"@gneh/runtime"', JSON.stringify(runtime))
          .replaceAll('"@gneh/core"', JSON.stringify(core)),
      );
      modules.push(await import(pathToFileURL(file).href));
    }
    const instance = new Story(modules.map((m) => m.default)).start();
    assert.equal(text(instance.view), 'alpha');
    instance.navigate(modules[1].default);
    assert.equal(text(instance.view), 'beta');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('private module helpers and live module bindings remain available to templates', async () => {
  const b = await emittedStory(
    '@module {\nlet value = "first";\nfunction local() { return value; }\nexport function change() { value = "second"; }\n}\n{{ local() }} / {{ value }}',
  );
  try {
    assert.equal(text(b.story.view), 'first / first');
    b.module.change();
    b.story.refresh();
    assert.equal(text(b.story.view), 'second / second');
    assert.match(b.output.declarations, /function change/);
  } finally {
    await b.dispose();
  }
});
