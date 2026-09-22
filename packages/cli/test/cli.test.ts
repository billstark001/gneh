import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));

const cli = path.join(root, 'standalone/gneh.mjs');
const linkedCli = path.join(root, 'examples/playground/node_modules/@gneh/cli/dist/index.js');

function run(...args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 15000,
  });
}

test('workspace bin entry resolves symlinked package paths', () => {
  const result = spawnSync(process.execPath, [linkedCli, 'check', '.'], {
    cwd: path.join(root, 'examples/playground'),
    encoding: 'utf8',
    timeout: 15000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Checked 3 files \/ 8 passages; no errors\./);
});

test('CLI help, check, metadata and graph are usable without node_modules', () => {
  assert.match(run('help').stdout, /Usage: gneh/);
  assert.equal(run('check', 'examples/playground').status, 0);
  const metadata = JSON.parse(run('metadata', 'examples/playground').stdout);
  assert.equal(metadata.Status.nav, false);
  assert.equal(metadata.Start.layout.accent, 'amber');
  const graph = JSON.parse(run('graph', 'examples/playground', '--json').stdout);
  assert.ok(graph.some((edge) => edge.from === 'Start' && edge.to === 'Vault' && edge.kind === 'choice'));
});

test('CLI compile emits executable modules, declarations, maps and manifest', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gneh-compile-'));
  try {
    const a = run('compile', 'examples/playground', '-o', dir);
    assert.equal(a.status, 0, a.stderr);
    const files = await fs.readdir(path.join(dir, 'story'));
    assert.ok(files.includes('main.mjs'));
    assert.ok(files.includes('main.d.mts'));
    assert.ok(files.includes('main.mjs.map'));
    assert.equal(JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8')).abi, 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('CLI reports unsupported legacy constructs and writes migration diagnostics', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gneh-migrate-'));
  try {
    const file = path.join(dir, 'bad.karlowe');
    await fs.writeFile(file, ':: Start\n(enchant: ?page, (text-colour: red))');
    const result = run('migrate', file, '-o', path.join(dir, 'new.inkdown'));
    assert.equal(result.status, 1);
    const report = JSON.parse(await fs.readFile(path.join(dir, 'new.inkdown.report.json'), 'utf8'));
    assert.ok(report.diagnostics.some((d) => d.code === 'RUNTIME_EXTENSION_UNDECLARED'));
    await assert.rejects(() => fs.readFile(path.join(dir, 'new.inkdown')));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('CLI extracts and imports Twine HTML with fidelity and compatibility reports', async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'gneh-twine-import-'));
  try {
    const html = path.join(parent, 'story.html');
    await fs.writeFile(
      html,
      '<!doctype html><tw-storydata name="Imported &amp; Story" startnode="2" format="Harlowe" format-version="3.3.9" ifid="example-id"><style role="stylesheet" id="twine-user-stylesheet">body { color: red; }</style><script role="script" id="twine-user-script">window.authored = true;</script><tw-tag name="opening" color="green"></tw-tag><tw-passagedata pid="1" name="Intro" tags="opening" position="1,2">Before &amp; after</tw-passagedata><tw-passagedata pid="2" name="Start" custom-flag>(set: $hp to 2)HP: $hp</tw-passagedata></tw-storydata>',
    );

    const extracted = path.join(parent, 'extracted');
    const extraction = run('extract', html, '-o', extracted);
    assert.equal(extraction.status, 0, extraction.stderr);
    const record = JSON.parse(await fs.readFile(path.join(extracted, 'twine-story.json')));
    assert.equal(record.story.attributes.name, 'Imported & Story');
    assert.equal(record.story.passages[0].encodedSource, 'Before &amp; after');
    assert.equal(record.story.passages[1].attributes['custom-flag'], true);
    assert.equal(record.story.tagDefinitions[0].attributes.color, 'green');
    assert.match(await fs.readFile(path.join(extracted, 'twine-user-stylesheet-1.css'), 'utf8'), /color: red/);
    assert.match(await fs.readFile(path.join(extracted, 'twine-user-script-1.js'), 'utf8'), /authored/);

    const imported = path.join(parent, 'imported');
    const reportPath = path.join(parent, 'report.json');
    const result = run('import-twine', html, '-o', imported, '--report', reportPath, '--preserve-container');
    assert.equal(result.status, 0, result.stderr);
    await assert.rejects(() => fs.readFile(path.join(imported, 'gneh.config.json')), /ENOENT/);
    await assert.rejects(() => fs.readFile(path.join(imported, 'story.d.karlowe.ts')), /ENOENT/);
    const report = JSON.parse(await fs.readFile(reportPath));
    assert.deepEqual(report.summary, { portable: 2, unsupported: 0, warnings: 0 });
    assert.equal(report.fidelity.embeddedUserCodeAutomaticallyLoaded, false);
    assert.equal(report.fidelity.encodedPassageSourcePreservedIn, '.gneh/import/twine-story.json');
    assert.equal(
      JSON.parse(await fs.readFile(path.join(imported, '.gneh/import/twine-story.json'))).story.attributes.name,
      'Imported & Story',
    );
    assert.match(await fs.readFile(path.join(imported, 'story.karlowe'), 'utf8'), /:: Start \[start\]/);
    assert.equal(run('check', imported).status, 0);
    const lean = path.join(parent, 'lean-import');
    assert.equal(run('import-twine', html, '-o', lean).status, 0);
    assert.deepEqual((await fs.readdir(lean)).sort(), [
      'story.karlowe',
      'twine-user-script-1.js',
      'twine-user-stylesheet-1.css',
    ]);
    const overwrite = run('import-twine', html, '-o', imported);
    assert.equal(overwrite.status, 1);
    assert.match(overwrite.stderr, /non-empty/);
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
});

test('CLI inspect exposes versioned container, syntax and resolved IR records', () => {
  for (const level of ['container', 'syntax', 'ir']) {
    const result = run('inspect', 'examples/playground', '--level', level, '--passage', 'Status');
    assert.equal(result.status, 0, result.stderr);
    const record = JSON.parse(result.stdout);
    assert.equal(record.schema, 'gneh.inspect/v1');
    assert.equal(record.level, level);
    const passages = level === 'ir' ? record.story.passages : record.sources.flatMap((source) => source.passages);
    assert.deepEqual(
      passages.map((passage) => passage.id),
      ['Status'],
    );
  }
});

test('CLI rejects unknown options and removed inspect aliases', () => {
  const unknown = run('check', 'examples/playground', '--bogus');
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /unknown option '--bogus'/);

  const removedAlias = run('inspect', 'examples/playground', '--ir');
  assert.equal(removedAlias.status, 1);
  assert.match(removedAlias.stderr, /unknown option '--ir'/);
});
