import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gneh } from '../dist/index.js';
import { createInkdownLowerings } from '../../inkdown/dist/index.js';

test('Vite plugin compiles native extensions without claiming generic frontend files', async () => {
  const plugin = gneh({ declarations: false });
  const transform = plugin.transform.handler ?? plugin.transform;
  assert.equal(
    await transform.call(
      {
        error: (message) => {
          throw new Error(message);
        },
      },
      '# Notes',
      '/src/notes.md',
    ),
    undefined,
  );
  assert.equal(await transform.call({}, '<template/>', '/src/App.vue'), undefined);
  const compiled = await transform.call(
    {
      error: (message) => {
        throw new Error(message);
      },
    },
    '# Story',
    '/src/story.inkdown',
  );
  assert.match(compiled.code, /defineIRFragment/);
  const optedIn = await transform.call(
    {
      error: (message) => {
        throw new Error(message);
      },
    },
    '# Story',
    '/src/story.md?gneh',
  );
  assert.match(optedIn.code, /defineIRFragment/);
});

test('Vite shares caller-owned CST-to-IR lowerings with frontend transforms', async () => {
  const inkdown = createInkdownLowerings();
  inkdown.register('build-name', ({ node, parser, base }) => ({
    nodes: [
      {
        type: 'text',
        value: 'nightly',
        span: parser.span(base + node.start, base + node.headEnd),
      },
    ],
    end: node.headEnd,
  }));
  const plugin = gneh({ declarations: false, lowerings: { inkdown } });
  const transform = plugin.transform.handler ?? plugin.transform;
  const result = await transform.call(
    { error: (message) => assert.fail(message) },
    '@build-name',
    '/src/story.inkdown',
  );
  assert.match(result.code, /nightly/);
});

test('Vite emits adjacent arbitrary-extension declarations for direct story imports', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gneh-vite-types-'));
  const file = path.join(directory, 'cards.karlowe');
  const source = ':: Card {"params":["enemy"],"paramTypes":{"enemy":"{name:string}"}}\n(print: $enemy.name)';
  try {
    const plugin = gneh();
    const transform = plugin.transform.handler ?? plugin.transform;
    await transform.call({ error: (message) => assert.fail(message) }, source, file);
    const declaration = await fs.readFile(path.join(directory, 'cards.d.karlowe.ts'), 'utf8');
    assert.match(declaration, /readonly "Card": Fragment<\{ "enemy": \{name:string\} \}>/);
    assert.match(declaration, /declare const primary: Fragment<\{ "enemy": \{name:string\} \}>/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
