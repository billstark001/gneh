import { test } from 'vitest';
import { assert, compiled, compileProject, compileSource, story, text, click, all } from './helpers.js';
import { toInkdown, walkNodes } from '../dist/index.js';
import { createWikifier, readPassageData } from '../../vendor/dist/index.js';
import { Story, definePassages } from '../../runtime/dist/index.js';
import { parseExpression } from '../../expression/dist/index.js';
import { createKarloweLowerings, karlowe, lexKarlowe, parseKarloweCST } from '../../karlowe/dist/index.js';
import { createInkdownLowerings, inkdown } from '../../inkdown/dist/index.js';
import { createSugarcastLowerings, parseSugarcastCST, sugarcast } from '../../sugarcast/dist/index.js';

const vendorDialects = [inkdown(), karlowe(), sugarcast()];

test('dialect frontends do not expose aliases or interpret Inkdown directives', async () => {
  const [inkdown, karlowe, sugarcast] = await Promise.all([
    import('../../inkdown/dist/index.js'),
    import('../../karlowe/dist/index.js'),
    import('../../sugarcast/dist/index.js'),
  ]);
  assert.equal('parse' in inkdown, false);
  assert.equal('parse' in karlowe, false);
  assert.equal('parse' in sugarcast, false);
  assert.equal('createInkdownMacroRegistry' in inkdown, false);
  assert.equal('createKarloweMacroRegistry' in karlowe, false);
  assert.equal('createSugarcastMacroRegistry' in sugarcast, false);

  for (const dialect of ['karlowe', 'sugarcast']) {
    const result = compiled('@action change { $value = 2; }\n@if ($value) { changed }', dialect);
    assert.equal(
      result.passages[0].body.some((node) => node.type === 'callable'),
      false,
    );
    assert.match(text(new Story(result.story).view), /@action/);
  }
});

test('bare sigils and explicit interpolation have the same semantic AST', () => {
  const p = compiled('$hp {{ $hp }}').passages[0];
  const nodes = p.body[0].children.filter((n) => n.type === 'value');
  assert.deepEqual(nodes[0].expression.ast, nodes[1].expression.ast);
  assert.notDeepEqual(nodes[0].expression.span, nodes[1].expression.span);
});

test('expression identifiers preserve sigils while the expression wrapper carries source location', () => {
  const span = { file: 'story.inkdown', start: 100, end: 130 };
  for (const source of ['$hp', '_scratch', 'props', 'Math', 'enemy']) {
    const ast = parseExpression(source, span).ast;
    assert.equal(ast.type, 'Identifier');
    assert.equal(ast.name, source);
    assert.deepEqual(parseExpression(source, span).span, span);
  }
  const passage = compiled(`---
imports:
  ./helpers.mjs: [helper]
---
:: Start [start]
{{ helper() }}`).passages[0];
  const call = passage.body[0].children.find((node) => node.type === 'value').expression.ast;
  assert.deepEqual(call.callee, { type: 'Identifier', name: 'helper' });
});

test('inline strings with brackets do not terminate JS directives early', () => {
  const s = story(
    `@if ($x === "}") {
{{ "a}b" }}
}`,
    'inkdown',
    { state: { x: '}' } },
  );
  assert.equal(text(s.view), 'a}b');
});

test('reusable passage parameters are checked and passed', () => {
  const source = `:: Start
@Card({enemy: $enemy})
:: Card {"params":["enemy"]}
**{{ enemy.name }}**`;
  const s = story(source, 'inkdown', { state: { enemy: { name: 'Ink' } } });
  assert.equal(text(s.view), 'Ink');
  assert.ok(compileSource(source.replace('{enemy: $enemy}', '{}')).diagnostics.some((d) => d.code === 'PROPS_MISSING'));
});

test('passage calls use canonical ids and do not create display-name aliases', () => {
  const source = `:: Start
@RealCard()
:: Card {"id":"RealCard"}
resolved`;
  assert.equal(text(story(source).view), 'resolved');
  const call = compileSource(source).passages[0].body[0].children[0];
  assert.equal(call.type === 'call' && call.call.callee.type === 'binding' ? call.call.callee.name : '', 'RealCard');
  assert.throws(() => story(source.replace('@RealCard()', '@Card()')), /Unknown passage: Card/);
});

test('unknown fragment references fail at compile time', () => {
  assert.ok(compileSource('[[Missing]]').diagnostics.some((d) => d.code === 'PASSAGE_MISSING'));
});

test('DOM-coupled changers and arbitrary script macros explicitly fail', () => {
  for (const [source, dialect] of [
    ['(enchant: ?page, (text-colour: red))', 'karlowe'],
    ['<<script>>alert(1)<</script>>', 'sugarcast'],
  ])
    assert.ok(compileSource(source, 'test.' + dialect, { dialect }).diagnostics.some((d) => d.severity === 'error'));
});

test('new Karlowe lexer keeps spans lossless and expression operators distinct', () => {
  const source = '(print: 8 / 2 % 3)';
  assert.deepEqual(lexKarlowe(source), [
    {
      type: 'macro',
      name: 'print',
      args: '8 / 2 % 3',
      start: 0,
      argsStart: 8,
      end: source.length,
    },
  ]);
  assert.equal(text(story(source, 'karlowe').view), '1');
});

test('compatibility CSTs preserve unknown syntax without consulting lowerings', () => {
  const karlowe = parseKarloweCST('(mystery: $hp)[inside (nested:)]');
  assert.equal(karlowe.children[0].type, 'macro');
  assert.equal(karlowe.children[0].name, 'mystery');
  assert.equal(karlowe.children[1].type, 'hook');
  assert.equal(karlowe.children[1].children[1].type, 'macro');
  assert.equal(karlowe.children[1].children[1].name, 'nested');

  const sugarcast = parseSugarcastCST('<<mystery $hp>>inside <<nested>><</mystery>>');
  assert.deepEqual(sugarcast.diagnostics, []);
  assert.equal(sugarcast.children[0].type, 'macro');
  assert.equal(sugarcast.children[0].name, 'mystery');
  assert.equal(sugarcast.children[0].children[1].type, 'macro');
  assert.equal(sugarcast.children[0].children[1].name, 'nested');

  const mixed = parseSugarcastCST('<<panel>><<panel>>body<</panel>>');
  assert.deepEqual(mixed.diagnostics, []);
  assert.equal(mixed.children.length, 2);
  assert.equal(mixed.children[0].fullEnd, mixed.children[0].end);
  assert.ok(mixed.children[1].closing);
});

test('unknown compatibility macros lower to declared runtime extension invocations', () => {
  for (const [dialect, source, id] of [
    ['karlowe', '(badge: $hp)[score]', 'karlowe/badge'],
    ['sugarcast', '<<badge $hp>>score<</badge>>', 'sugarcast/badge'],
  ]) {
    const result = compileSource(source, `test.${dialect}`, {
      dialect,
      state: { hp: 7 },
      runtimeExtensionIds: [id],
    });
    assert.deepEqual(
      result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error'),
      [],
    );
    let invocation;
    walkNodes(result.passages[0].body, (node) => {
      if (node.type === 'invoke') invocation = node;
    });
    assert.equal(invocation.type, 'invoke');
    assert.equal(invocation.id, id);
    const instance = new Story(result.story, {
      runtimeExtensions: {
        [id]: {
          phases: ['view'],
          invoke({ args, children }) {
            return { kind: 'group', attrs: { value: args[0] }, children: children() };
          },
        },
      },
    }).start();
    assert.equal(text(instance.view), 'score');
    assert.equal(all(instance.view).find((node) => node.attrs?.value === 7).attrs.value, 7);
  }
});

test('dialects expose caller-owned CST-to-IR lowerings through the compiler', () => {
  const cases = [
    {
      dialect: 'inkdown',
      source: '@shout',
      registry: createInkdownLowerings(),
      end: (token) => token.headEnd,
    },
    {
      dialect: 'karlowe',
      source: '(shout:)',
      registry: createKarloweLowerings(),
      end: (token) => token.end,
    },
    {
      dialect: 'sugarcast',
      source: '<<shout>>',
      registry: createSugarcastLowerings(),
      end: (token) => token.end,
    },
  ];
  for (const { dialect, source, registry, end } of cases) {
    registry.register('shout', ({ node, parser, base, index }) => ({
      nodes: [
        {
          type: 'text',
          value: dialect.toUpperCase(),
          span: parser.span(base + index, base + end(node)),
        },
      ],
      end: end(node),
    }));
    const frontend =
      dialect === 'inkdown' ? inkdown(registry) : dialect === 'karlowe' ? karlowe(registry) : sugarcast(registry);
    const s = story(source, dialect, { dialects: [frontend] });
    assert.equal(text(s.view), dialect.toUpperCase());
  }
});

test('karlowe lowering registry uses normalized macro names without global mutation', () => {
  const original = createKarloweLowerings();
  const overridden = original.clone();
  assert.throws(() => overridden.register('Pr-In-T', () => undefined), /already registered/);
  overridden.register(
    'Pr-In-T',
    ({ node, parser, base }) => ({
      nodes: [
        {
          type: 'text',
          value: 'override',
          span: parser.span(base + node.start, base + node.end),
        },
      ],
      end: node.end,
    }),
    { replace: true },
  );
  assert.equal(text(story('(print: 1)', 'karlowe', { dialects: [karlowe(overridden)] }).view), 'override');
  assert.equal(text(story('(print: 1)', 'karlowe', { dialects: [karlowe(original)] }).view), '1');
});

test('karlowe sidebar changes cross an explicit host boundary', () => {
  assert.throws(() => story('(append: ?Sidebar)[Notice]', 'karlowe'), /Host operation is unavailable: portal/);
  let received;
  let disposed = false;
  const hosted = story(
    `:: Start
(append: ?Sidebar)[Notice]
:: End
Done`,
    'karlowe',
    {
      host(operation, args) {
        received = { operation, args };
        return () => (disposed = true);
      },
    },
  );
  assert.equal(received.operation, 'portal');
  assert.deepEqual(received.args.slice(0, 2), ['sidebar', 'append']);
  assert.equal(text(received.args[2]), 'Notice');
  hosted.navigate('End');
  assert.equal(disposed, true);
});

test('removed Inkdown entry declarations are rejected everywhere', () => {
  assert.ok(
    compileSource(`@if ($yes) {
@enter { @do $x = 1; }
}`).diagnostics.some((d) => d.code === 'REMOVED_DIRECTIVE'),
  );
});

test('Inkdown has no JavaScript statement, module, or script escape hatch', () => {
  for (const source of [
    '@action broken { if ($ok) { $x = 1; } }',
    '@action broken { @do await task(); }',
    '@module { export const x = 1; }',
    '@script { import("./side-effect.mjs"); }',
  ])
    assert.ok(compileSource(source).diagnostics.some((diagnostic) => diagnostic.severity === 'error'));
});

test('removed inline ESM records and state declarations are rejected', () => {
  for (const source of ['@import { helper } from "./helpers.mjs"', '@export { helper }', '@const $value = 1'])
    assert.ok(compileSource(source).diagnostics.some((diagnostic) => diagnostic.severity === 'error'));
});

test('known callable phase errors are checked while dynamic registry calls remain valid', () => {
  assert.ok(
    compileSource(`@view wrong() { no }
@action outer { @call wrong(); }
[[Run => outer]]`).diagnostics.some((diagnostic) => diagnostic.code === 'CALLABLE_PHASE'),
  );
  assert.ok(
    compileSource(`@action wrong() {}
@view Card() { @wrong() }
@Card()`).diagnostics.some((diagnostic) => diagnostic.code === 'CALLABLE_PHASE'),
  );
  assert.ok(
    !compileSource('@action outer { @call installedLater(); }').diagnostics.some((d) => d.severity === 'error'),
  );
  assert.ok(compileSource('@children').diagnostics.some((diagnostic) => diagnostic.code === 'CHILDREN_POSITION'));
});

test('migration pretty-printer preserves supported observable behavior', () => {
  const old = `:: Start
<<if $hp gt 0>>HP: $hp<<else>>Dead<</if>>
[[End]]
:: End
Done`;
  const parsed = compiled(old, 'sugarcast', { state: { hp: 2 } });
  const native = toInkdown(parsed.passages);
  const a = new Story(parsed.story).start(),
    b = story(native, 'inkdown', { state: { hp: 2 } });
  assert.equal(text(a.view).replace(/\s/g, ''), text(b.view).replace(/\s/g, ''));
});

test('migration spells compatibility effects as Inkdown effects', () => {
  const parsed = compiled('(print: $hp)(set: $hp to 2)(print: $hp)', 'karlowe', { state: { hp: 1 } });
  const native = toInkdown(parsed.passages);
  const original = new Story(parsed.story);
  original.start();
  assert.match(native, /@effect[\s\S]*@do \(\$hp = 2\)/);
  assert.equal(
    text(original.view).replaceAll(/\s/g, ''),
    text(story(native, 'inkdown', { state: { hp: 1 } }).view).replaceAll(/\s/g, ''),
  );
});

test('vendor data compiler and optional wikifier use the same ABI', () => {
  const ir = readPassageData(
    {
      entry: 'Start',
      state: { hp: 2 },
      passages: [{ id: 'Start', dialect: 'inkdown', text: 'HP: $hp' }],
    },
    { dialects: vendorDialects },
  );
  assert.equal(text(new Story(ir).view), 'HP: 2');
  const f = createWikifier({ dialects: vendorDialects })('**{{ $hp }}**');
  assert.equal(text(new Story(definePassages(f), { state: { hp: 9 }, entry: f.id }).view), '9');
});

test('wikify rejects module and source effects; pure excludes actions/regions', () => {
  assert.throws(() => createWikifier({ dialects: vendorDialects })('@enter { @do $hp=1; }'));
  assert.throws(() => createWikifier({ dialects: vendorDialects })('(set: $hp to 1)', 'karlowe'));
  assert.throws(() => createWikifier({ dialects: vendorDialects })('@import { x } from "./x.mjs"'));
  assert.throws(() => createWikifier({ dialects: vendorDialects, pure: true })('@region x { hello }'));
  assert.throws(() =>
    createWikifier({ dialects: vendorDialects })(`:: A
a
:: B
b`),
  );
});

test('snapshot target rejects live requirements but retains navigation', () => {
  assert.ok(
    compileSource('@region n { hello }', 'x.inkdown', { live: false }).diagnostics.some(
      (d) => d.code === 'CAPABILITY_LIVE',
    ),
  );
  const s = story(
    `:: Start
[[Go->End]]
:: End
Done`,
    'inkdown',
    { live: false },
  );
  click(s, 'Go');
  assert.equal(s.current, 'End');
  assert.throws(() => s.mutate((state) => (state.x = 1)));
});

test('dialect metadata and the ambiguous .twee extension are not accepted', () => {
  assert.throws(
    () =>
      compileProject([
        {
          path: 'test.twee',
          source: `---
dialect: sugarcast
---
:: Start
<<print 42>>`,
        },
      ]),
    /native GNEH dialect/,
  );
});
