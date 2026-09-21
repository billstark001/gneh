import { test } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Story } from '../../runtime/dist/index.js';
import { generateModule } from '../dist/index.js';
import { assert, compiled, text } from './helpers.js';

const runtime = new URL('../../runtime/dist/index.js', import.meta.url).href;

test('namespace rewriting preserves primary module bindings that shadow passage ids', async () => {
  const source = `@view Card() { module card }
:: Start [start]
@Card()
:: Card
passage card`;
  const output = generateModule(compiled(source), source, 'chapter.inkdown', { namespace: 'chapter' });
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gneh-namespace-module-scope-'));
  try {
    const file = path.join(directory, 'story.mjs');
    await fs.writeFile(file, output.code.replaceAll('"@gneh/runtime"', JSON.stringify(runtime)));
    const module = await import(pathToFileURL(file).href);
    assert.equal(text(new Story(module.default).view).trim(), 'module card');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
