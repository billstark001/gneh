import { test } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { assert, compiled, compileSource, text } from './helpers.js';
import { generateModule } from '../dist/index.js';
import { definePassages, Story } from '../../runtime/dist/index.js';

const runtime = new URL('../../runtime/dist/index.js', import.meta.url).href;
const runtimeCompiler = new URL('../../runtime/dist/compiler/index.js', import.meta.url).href;
const core = new URL('../../core/dist/index.js', import.meta.url).href;

const linkRuntime = (code: string) =>
  code
    .replaceAll('"@gneh/runtime/compiler"', JSON.stringify(runtimeCompiler))
    .replaceAll('"@gneh/runtime"', JSON.stringify(runtime));

async function emittedStory(source: string, modules: Record<string, string>) {
  const result = compiled(source);
  const output = generateModule(result, source, 'test.inkdown');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gneh-esm-linkage-'));
  for (const [name, contents] of Object.entries(modules)) await fs.writeFile(path.join(directory, name), contents);
  const file = path.join(directory, 'story.mjs');
  await fs.writeFile(file, linkRuntime(output.code));
  const module = await import(pathToFileURL(file).href);
  return {
    story: new Story(module.default, { entry: result.story.entry }).start(),
    dispose: () => fs.rm(directory, { recursive: true, force: true }),
  };
}

test('declarative imports support default ESM exports without an embedded module body', async () => {
  const output = await emittedStory(
    `---
imports:
  ./greet.mjs: greet
---
:: Start [start]
{{ greet("Ada") }}`,
    { 'greet.mjs': 'export default name => `Hello ${name}`;' },
  );
  try {
    assert.equal(text(output.story.view), 'Hello Ada');
  } finally {
    await output.dispose();
  }
});

test('generated modules keep native passage bindings lazy across an ESM cycle', async () => {
  const source = `---
imports:
  ./native.mjs:
    default: ModelLab
---
@const heading = "Primer"
:: Primer [start]
# {{ heading }}
[[Open lab -> ModelLab]]`;
  const result = compileSource(source, 'story.inkdown', { dialect: 'inkdown' });
  assert.deepEqual(result.diagnostics, []);
  const output = generateModule(result, source, 'story.inkdown');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gneh-esm-cycle-'));
  const storyFile = path.join(directory, 'story.mjs');
  const nativeFile = path.join(directory, 'native.mjs');
  try {
    await fs.writeFile(storyFile, linkRuntime(output.code));
    await fs.writeFile(
      nativeFile,
      `import passages from './story.mjs';
import { definePassage } from ${JSON.stringify(runtime)};
import { v } from ${JSON.stringify(core)};
export default definePassage({
  id: 'ModelLab',
  bindings: { get Primer() { return passages.Primer; } },
  render(ctx) {
    return v.choice('Back to primer', passages.Primer.id, () => ctx.navigate(passages.Primer));
  },
});`,
    );

    // Loading the native side first reproduces the browser's failing evaluation
    // order: native -> generated story -> still-uninitialized native binding.
    const native = await import(pathToFileURL(nativeFile).href);
    const generated = await import(pathToFileURL(storyFile).href);
    const story = new Story(definePassages(generated.default, native.default), { entry: 'Primer' }).start();
    story.navigate(native.default);
    assert.equal(text(story.view), 'Back to primer');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('primary-only modules initialize once and default-export an empty PassageSet', async () => {
  const source = `---
imports:
  ./counter.mjs: [next]
exports: [count]
---
@let count = next()`;
  const result = compileSource(source, 'utility.inkdown', { dialect: 'inkdown' });
  assert.deepEqual(result.diagnostics, []);
  const output = generateModule(result, source, 'utility.inkdown');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gneh-primary-'));
  try {
    await fs.writeFile(path.join(directory, 'counter.mjs'), 'let value = 0; export const next = () => ++value;');
    const file = path.join(directory, 'utility.mjs');
    await fs.writeFile(file, linkRuntime(output.code));
    const first = await import(pathToFileURL(file).href);
    const second = await import(pathToFileURL(file).href);
    assert.equal(first, second);
    assert.equal(first.count, 1);
    assert.deepEqual(Object.keys(first.default), []);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
