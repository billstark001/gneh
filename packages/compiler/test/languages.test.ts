import { test } from 'vitest';
import { assert, compiled, compileProject, compileSource, story, text, click, all } from './helpers.js';
import { toInkdown, walkNodes } from '../dist/index.js';
import { createWikifier, readPassageData } from '../../vendor/dist/index.js';
import { Story } from '../../runtime/dist/index.js';
import { parseExpression } from '../../expression/dist/index.js';
import { createKarloweLowerings, karlowe, lexKarlowe, parseKarloweCST } from '../../karlowe/dist/index.js';
import { createInkdownLowerings, inkdown } from '../../inkdown/dist/index.js';
import { createSugarcastLowerings, parseSugarcastCST, sugarcast } from '../../sugarcast/dist/index.js';

const vendorDialects = [inkdown(), karlowe(), sugarcast()];

test('native documents stay reactive while compatibility dialects materialize their passage', () => {
  const sources = {
    inkdown:
      ':: Start\n@action hit { @do $hp -= 1; }\n@if ($hp > 0) {\nHP: $hp\n[[Hit => hit]]\n} @else {\nDead\n}\n[[Next -> End]]\n:: End\nEnd',
    karlowe:
      ':: Start\n(if: $hp > 0)[HP: $hp (link-repeat: "Hit")[(set: $hp to $hp - 1)]](else:)[Dead]\n[[Next->End]]\n:: End\nEnd',
    sugarcast:
      ':: Start\n<<if $hp > 0>>HP: $hp <<button "Hit">><<set $hp -= 1>><</button>><<else>>Dead<</if>>\n[[Next->End]]\n:: End\nEnd',
  };
  for (const [dialect, source] of Object.entries(sources)) {
    const s = story(source, dialect, { state: { hp: 1 } });
    assert.match(text(s.view), /HP: 1/);
    click(s, 'Hit');
    if (dialect === 'inkdown') assert.match(text(s.view), /Dead/);
    else assert.match(text(s.view), /HP: 1/);
    assert.equal(s.state.hp, 0);
    click(s, 'Next');
    assert.equal(s.current, 'End');
  }
});

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
    assert.deepEqual(result.passages[0].effects, {});
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
  const passage = compiled('@import { helper } from "./helpers.mjs"\n{{ helper() }}').passages[0];
  const call = passage.body[0].children.find((node) => node.type === 'value').expression.ast;
  assert.deepEqual(call.callee, { type: 'Identifier', name: 'helper' });
});

test('inline escapes, code and currency do not execute variables', () => {
  const s = story('Cost $1.50. `{{ $hp }}` \\$hp **$hp**', 'inkdown', { state: { hp: 7 } });
  assert.equal(text(s.view), 'Cost $1.50. {{ $hp }} $hp 7');
});

test('nested conditions and keyed loops are real structural nodes', () => {
  const s = story(
    '@if ($ok) {\n@each (item of $items; key item.id) {\n- {{ item.name }}\n}\n} @else {\nNo\n}',
    'inkdown',
    {
      state: {
        ok: true,
        items: [
          { id: 'a', name: 'Alpha' },
          { id: 'b', name: 'Beta' },
        ],
      },
    },
  );
  assert.match(text(s.view), /AlphaBeta/);
  s.mutate((state) => (state.ok = false));
  assert.equal(text(s.view), 'No');
});

test('inline strings with brackets do not terminate JS directives early', () => {
  const s = story('@if ($x === "}") {\n{{ "a}b" }}\n}', 'inkdown', { state: { x: '}' } });
  assert.equal(text(s.view), 'a}b');
});

test('reusable passage parameters are checked and passed', () => {
  const source = ':: Start\n@Card({enemy: $enemy})\n:: Card {"params":["enemy"]}\n**{{ enemy.name }}**';
  const s = story(source, 'inkdown', { state: { enemy: { name: 'Ink' } } });
  assert.equal(text(s.view), 'Ink');
  assert.ok(compileSource(source.replace('{enemy: $enemy}', '{}')).diagnostics.some((d) => d.code === 'PROPS_MISSING'));
});

test('view-style passage calls resolve display-name aliases to runtime ids', () => {
  const source = ':: Start\n@Card()\n:: Card\n---\nid: RealCard\n---\nresolved';
  assert.equal(text(story(source).view), 'resolved');
  assert.equal(compileSource(source).passages[0].body[0].children[0].name, 'RealCard');
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

test('karlowe macro names ignore ASCII case and internal hyphens', () => {
  const s = story('(Se-T: $value to 7)(PrInT: $value)(TeXtCoLoUr: red)[!]', 'karlowe', {
    state: { value: 0 },
  });
  assert.equal(text(s.view), '7!');
  assert.equal(s.state.value, 7);
  assert.equal(text(story('(PRINT: (A: "ok")\'s 1st)', 'karlowe').view), 'ok');

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

test('karlowe resolves triple-bracket hook and link ambiguity in prose', () => {
  const s = story(':: Start\nBefore [[[Go->End]]]\n:: End\nDone', 'karlowe');
  assert.equal(text(s.view), 'Before Go');
  click(s, 'Go');
  assert.equal(s.current, 'End');
});

test('karlowe executes effects in source order and keeps materialized values stable', () => {
  const s = story('(set: $value to 1)(print: $value)(set: $value to 2)(print: $value)', 'karlowe', {
    state: { value: 0 },
  });
  assert.equal(text(s.view), '12');
  s.mutate((state) => (state.value = 9));
  assert.equal(text(s.view), '12');
});

test('karlowe source-order navigation settles before publishing the view', () => {
  const s = story(':: Start\n(go-to: "End")\n:: End\nDone', 'karlowe');
  assert.equal(s.current, 'End');
  assert.equal(text(s.view), 'Done');
});

test('karlowe supports semantic named-hook changes without DOM queries', () => {
  const s = story('|notice>[old](replace: ?notice)[new]', 'karlowe');
  assert.equal(text(s.view), 'new');
});

test('karlowe sidebar changes cross an explicit host boundary', () => {
  assert.throws(() => story('(append: ?Sidebar)[Notice]', 'karlowe'), /Host operation is unavailable: portal/);
  let received;
  let disposed = false;
  const hosted = story(':: Start\n(append: ?Sidebar)[Notice]\n:: End\nDone', 'karlowe', {
    host(operation, args) {
      received = { operation, args };
      return () => (disposed = true);
    },
  });
  assert.equal(received.operation, 'portal');
  assert.deepEqual(received.args.slice(0, 2), ['sidebar', 'append']);
  assert.equal(text(received.args[2]), 'Notice');
  hosted.navigate('End');
  assert.equal(disposed, true);
});

test('portable Harlowe and SugarCube checkbox bindings remain live', () => {
  const karlowe = story('(checkbox: 2bind $enabled, "Enabled")', 'karlowe', {
    state: { enabled: false },
  });
  const karloweControl = all(karlowe.view).find((node) => node.kind === 'control:checkbox');
  assert.equal(text(karlowe.view), 'Enabled');
  karloweControl.change(true);
  assert.equal(karlowe.state.enabled, true);

  const sugarcast = story('<<checkbox "$enabled" false true autocheck>>', 'sugarcast', {
    state: { enabled: false },
  });
  const sugarcastControl = all(sugarcast.view).find((node) => node.kind === 'control:checkbox');
  sugarcastControl.change(true);
  assert.equal(sugarcast.state.enabled, true);
});

test('entry declarations cannot hide inside reactive branches', () => {
  assert.ok(
    compileSource('@if ($yes) {\n@enter { @do $x = 1; }\n}').diagnostics.some((d) => d.code === 'DECLARATION_POSITION'),
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

test('declarative ESM records reject names that collide with state or temporary namespaces', () => {
  for (const source of [
    '@import { helper as $helper } from "./helpers.mjs"',
    '@import { helper as _helper } from "./helpers.mjs"',
    '@const $value = 1',
    '@export { bad-name }',
  ])
    assert.ok(compileSource(source).diagnostics.some((diagnostic) => diagnostic.severity === 'error'));
});

test('effect calls are checked inside actions and declared views are checked like passage bodies', () => {
  assert.ok(
    compileSource('@action outer { @call missing(); }\n[[Run => outer]]').diagnostics.some(
      (diagnostic) => diagnostic.code === 'ACTION_MISSING',
    ),
  );
  assert.ok(
    compileSource('@view Card() { @Missing() }\n@Card()').diagnostics.some(
      (diagnostic) => diagnostic.code === 'VIEW_MISSING',
    ),
  );
  assert.ok(compileSource('@children').diagnostics.some((diagnostic) => diagnostic.code === 'CHILDREN_POSITION'));
});

test('karlowe arithmetic, containers, possessive access and membership are normalized', () => {
  const s = story("(print: 1 + 2 * 3) (print: $enemy's name) (print: (a: 1, 2) contains 2)", 'karlowe', {
    state: { enemy: { name: 'Ada' } },
  });
  assert.equal(text(s.view), '7 Ada true');
});

test('karlowe preserves conditional writes as source-order effects', () => {
  const source = '(if: $enabled)[(set: $value to 2)](else:)[(set: $value to 3)](print: $value)';
  const enabled = story(source, 'karlowe', { state: { enabled: true, value: 0 } });
  assert.equal(enabled.state.value, 2);
  assert.match(text(enabled.view), /2/);
  const disabled = story(source, 'karlowe', { state: { enabled: false, value: 0 } });
  assert.equal(disabled.state.value, 3);
  assert.match(text(disabled.view), /3/);
});

test('sugarcast operators do not rewrite quoted strings', () => {
  const s = story('<<if $a is 1 and not $b>><<print "is and to">><</if>>', 'sugarcast', {
    state: { a: 1, b: false },
  });
  assert.equal(text(s.view), 'is and to');
});

test('sugarcast keeps multiline containers and conditional source-order effects structured', () => {
  const source = `Before <<if $enabled>>
<<set $value = 2>>

Value: <<print $value>>
<<else>>
<<set $value = 3>>
Disabled
<</if>>`;
  const enabled = story(source, 'sugarcast', { state: { enabled: true, value: 0 } });
  assert.equal(enabled.state.value, 2);
  assert.match(text(enabled.view), /Value: 2/);
  const disabled = story(source, 'sugarcast', { state: { enabled: false, value: 0 } });
  assert.equal(disabled.state.value, 3);
  assert.match(text(disabled.view), /Disabled/);
});

test('portable loops in karlowe and sugarcast', () => {
  assert.equal(text(story('(for: each _x, (a: "A", "B"))[(print: _x)]', 'karlowe').view), 'AB');
  assert.equal(
    text(
      story('<<for _x of $items>><<print _x>><</for>>', 'sugarcast', {
        state: { items: ['A', 'B'] },
      }).view,
    ),
    'AB',
  );
});

test('migration pretty-printer preserves supported observable behavior', () => {
  const old = ':: Start\n<<if $hp gt 0>>HP: $hp<<else>>Dead<</if>>\n[[End]]\n:: End\nDone';
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
  assert.equal(text(new Story([f], { state: { hp: 9 } }).view), '9');
});

test('wikify rejects module and source effects; pure excludes actions/regions', () => {
  assert.throws(() => createWikifier({ dialects: vendorDialects })('@enter { @do $hp=1; }'));
  assert.throws(() => createWikifier({ dialects: vendorDialects })('(set: $hp to 1)', 'karlowe'));
  assert.throws(() => createWikifier({ dialects: vendorDialects })('@import { x } from "./x.mjs"'));
  assert.throws(() => createWikifier({ dialects: vendorDialects, pure: true })('@region x { hello }'));
  assert.throws(() => createWikifier({ dialects: vendorDialects })(':: A\na\n:: B\nb'));
});

test('snapshot target rejects live requirements but retains navigation', () => {
  assert.ok(
    compileSource('@region n { hello }', 'x.md', { live: false }).diagnostics.some((d) => d.code === 'CAPABILITY_LIVE'),
  );
  const s = story(':: Start\n[[Go->End]]\n:: End\nDone', 'inkdown', { live: false });
  click(s, 'Go');
  assert.equal(s.current, 'End');
  assert.throws(() => s.mutate((state) => (state.x = 1)));
});

test('metadata-controlled .twee dialect is honored', () => {
  const result = compileProject([
    { path: 'test.twee', source: '---\ndialect: sugarcast\n---\n:: Start\n<<print 42>>' },
  ]);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(text(new Story(result.story).view), '42');
});
