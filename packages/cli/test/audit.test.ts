import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditTwineHTML, extractTwineStory } from '../../../scripts/audit-twine-html.mjs';

const html = (format, body) =>
  `<!doctype html><tw-storydata name="Example" format="${format}" format-version="3.0"><tw-passagedata pid="1" name="Start">${body}</tw-passagedata></tw-storydata>`;

test('Twine HTML audit extracts entities and checks the matching portable dialect', () => {
  const harlowe = html('Harlowe', '(set: $hp to 2)(if: $hp &gt; 0)[ok]');
  assert.equal(extractTwineStory(harlowe).passages[0].source, '(set: $hp to 2)(if: $hp > 0)[ok]');
  const harloweAudit = auditTwineHTML(harlowe);
  assert.equal(harloweAudit.schema, 'gneh.compatibility-audit/v2');
  assert.equal(harloweAudit.dialect, 'karlowe');
  assert.equal(harloweAudit.passages, 1);
  assert.deepEqual(Object.keys(harloweAudit.stageDefinitions), [
    'structured',
    'declared',
    'resolved',
    'lowered',
    'runtime-satisfied',
  ]);
  for (const stage of ['structured', 'declared', 'resolved', 'lowered', 'runtime-satisfied'])
    assert.deepEqual(harloweAudit.stages[stage], { passed: 1, failed: 0 });
  assert.deepEqual(harloweAudit.lowering.errorsByCode, {});

  const sugarcube = auditTwineHTML(
    html('SugarCube', '&lt;&lt;set $hp = 2&gt;&gt;&lt;&lt;if $hp &gt; 0&gt;&gt;ok&lt;&lt;/if&gt;&gt;'),
  );
  assert.deepEqual(sugarcube.stages.lowered, { passed: 1, failed: 0 });
  assert.deepEqual(sugarcube.stages['runtime-satisfied'], { passed: 1, failed: 0 });
});

test('Twine audit separates structure, declarations, lowering and runtime satisfaction', () => {
  const source = html('SugarCube', '&lt;&lt;badge $hp&gt;&gt;score&lt;&lt;/badge&gt;&gt;');
  const unknown = auditTwineHTML(source, 'unknown.html', { sampleLimit: 1 });
  assert.deepEqual(unknown.stages.structured, { passed: 1, failed: 0 });
  assert.deepEqual(unknown.stages.declared, { passed: 0, failed: 1 });
  assert.deepEqual(unknown.stages.lowered, { passed: 0, failed: 1 });
  assert.deepEqual(unknown.samples.declared[0].blockers, ['sugarcast/badge']);

  const declared = auditTwineHTML(source, 'declared.html', {
    declaredRuntimeExtensionIds: ['sugarcast/badge'],
  });
  assert.deepEqual(declared.stages.lowered, { passed: 1, failed: 0 });
  assert.deepEqual(declared.stages['runtime-satisfied'], { passed: 0, failed: 1 });
  assert.equal(declared.runtime.missingInvocations, 1);

  const satisfied = auditTwineHTML(source, 'satisfied.html', {
    declaredRuntimeExtensionIds: ['sugarcast/badge'],
    runtimeExtensionIds: ['sugarcast/badge'],
  });
  assert.deepEqual(satisfied.stages['runtime-satisfied'], { passed: 1, failed: 0 });
});

test('Twine audit inventories source macro declarations without enabling their runtime', () => {
  const source =
    '<!doctype html><tw-storydata name="Example" format="SugarCube" format-version="2">' +
    '<script role="script">Macro.add(["scripted", "scripted-two"], {})</script>' +
    '<tw-passagedata pid="1" name="Widgets" tags="widget">&lt;&lt;widget "badge"&gt;&gt;badge&lt;&lt;/widget&gt;&gt;</tw-passagedata>' +
    '<tw-passagedata pid="2" name="Start">&lt;&lt;badge&gt;&gt;&lt;&lt;scripted&gt;&gt;</tw-passagedata>' +
    '</tw-storydata>';
  const audit = auditTwineHTML(source);
  assert.equal(audit.declarations.static, 3);
  assert.deepEqual(audit.declarations.byKind, { widget: 1, 'script-registration': 2 });
  assert.equal(audit.occurrences.sourceDeclared, 2);
  assert.deepEqual(audit.stages.structured, { passed: 2, failed: 0 });
  assert.deepEqual(audit.stages.resolved, { passed: 1, failed: 1 });
  assert.deepEqual(audit.stages['runtime-satisfied'], { passed: 0, failed: 2 });
});

test('Twine extraction follows HTML parsing and character-reference rules', () => {
  const source =
    '<tw-storydata name="A &quot;quoted&quot; story" format="SugarCube" format-version="2">' +
    '<tw-passagedata pid=1 name="Start &amp; End" data-note="a > b">' +
    '&copy; &#x1F600; &lt;&lt;set $ready = true&gt;&gt;' +
    '</tw-passagedata></tw-storydata>';
  const story = extractTwineStory(source);
  assert.equal(story.attributes.name, 'A "quoted" story');
  assert.equal(story.passages[0].name, 'Start & End');
  assert.equal(story.passages[0].attributes['data-note'], 'a > b');
  assert.equal(story.passages[0].source, '© 😀 <<set $ready = true>>');
  assert.equal(story.passages[0].encodedSource, '&copy; &#x1F600; &lt;&lt;set $ready = true&gt;&gt;');
});

test('Twine HTML audit rejects unrelated story formats', () => {
  assert.throws(() => auditTwineHTML(html('Chapbook', 'hello')), /Unsupported Twine story format/);
});

test('shared syntax infrastructure has no concrete dialect dependency', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'packages/syntax/package.json')));
  assert.deepEqual(manifest.dependencies, { '@gneh/core': 'workspace:*' });
  const source = fs
    .readdirSync(path.join(root, 'packages/syntax/src'))
    .filter((name) => name.endsWith('.ts'))
    .map((name) => fs.readFileSync(path.join(root, 'packages/syntax/src', name), 'utf8'))
    .join('\n');
  assert.doesNotMatch(source, /@gneh\/(?:expression|inkdown|karlowe|sugarcast)/);
  assert.doesNotMatch(source, /readInkdown|readKarlowe|readSugarcast/);
});

test('Twine HTML parsing is isolated to the CLI package', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const source = JSON.parse(fs.readFileSync(path.join(root, 'packages/source/package.json'), 'utf8'));
  const cli = JSON.parse(fs.readFileSync(path.join(root, 'packages/cli/package.json'), 'utf8'));
  assert.equal(source.dependencies.parse5, undefined);
  assert.match(cli.dependencies.parse5, /^\^8\./);
});

test('package manifests only advertise files that exist', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  for (const entry of fs.readdirSync(path.join(root, 'packages'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(root, 'packages', entry.name);
    if (!fs.existsSync(path.join(directory, 'package.json'))) continue;
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json')));
    for (const included of manifest.files ?? [])
      assert.ok(fs.existsSync(path.join(directory, included)), `${manifest.name} advertises missing ${included}`);
  }
});

test('workspace package dependencies are acyclic', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const graph = new Map();
  for (const entry of fs.readdirSync(path.join(root, 'packages'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!fs.existsSync(path.join(root, 'packages', entry.name, 'package.json'))) continue;
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'packages', entry.name, 'package.json')));
    graph.set(
      manifest.name,
      Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies }).filter((name) =>
        name.startsWith('@gneh/'),
      ),
    );
  }
  const visited = new Set();
  const active = new Set();
  const visit = (name, path = []) => {
    if (active.has(name)) assert.fail(`Package dependency cycle: ${[...path, name].join(' -> ')}`);
    if (visited.has(name)) return;
    active.add(name);
    for (const dependency of graph.get(name) ?? []) visit(dependency, [...path, name]);
    active.delete(name);
    visited.add(name);
  };
  for (const name of graph.keys()) visit(name);
});

test('standalone manifests describe the generated module graph', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const scope = path.join(root, 'standalone/node_modules/@gneh');
  for (const name of fs.readdirSync(scope)) {
    const manifest = JSON.parse(fs.readFileSync(path.join(scope, name, 'package.json'), 'utf8'));
    for (const dependency of Object.keys({
      ...manifest.dependencies,
      ...manifest.peerDependencies,
    })) {
      const target = dependency.startsWith('@gneh/')
        ? path.join(scope, dependency.slice('@gneh/'.length))
        : path.join(root, 'standalone/node_modules', dependency);
      assert.ok(fs.existsSync(target), `${manifest.name} has missing dependency ${dependency}`);
    }
  }
});
