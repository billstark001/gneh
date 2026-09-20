import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gneh } from '../dist/index.js';
import { createInkdownLowerings, inkdown } from '../../inkdown/dist/index.js';
import { karlowe } from '../../karlowe/dist/index.js';
import { sugarcast } from '../../sugarcast/dist/index.js';

test('Vite plugin compiles native extensions without claiming generic frontend files', async () => {
  const plugin = gneh({ dialects: [inkdown()] });
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

test('Vite claims only explicitly registered dialects', async () => {
  assert.throws(() => gneh({ dialects: [] }), /at least one/);
  assert.throws(() => gneh({ dialects: [inkdown(), inkdown()] }), /more than once/);
  const plugin = gneh({ dialects: [inkdown()] });
  const transform = plugin.transform.handler ?? plugin.transform;
  assert.equal(await transform.call({}, '(print: 1)', '/src/story.karlowe'), undefined);
  await assert.rejects(
    () =>
      transform.call(
        {
          error: (message) => {
            throw new Error(message);
          },
        },
        '(print: 1)',
        '/src/story.md?gneh=karlowe',
      ),
    /not registered/,
  );
});

test('Vite respects asset queries and dialect-owned extension aliases', async () => {
  const plugin = gneh({ dialects: [inkdown(), karlowe(), sugarcast()] });
  const transform = plugin.transform.handler ?? plugin.transform;
  const load = plugin.load.handler ?? plugin.load;
  for (const query of ['raw', 'url', 'worker', 'sharedworker', 'inline']) {
    assert.equal(await load.call({}, `/src/story.inkdown?${query}`), undefined);
    assert.equal(await transform.call({}, '# source', `/src/story.inkdown?${query}`), undefined);
  }
  const sugar = await transform.call({ error: (message) => assert.fail(message) }, '<<print 2>>', '/src/story.sugar');
  assert.match(sugar.code, /defineIRFragment/);
  const karloweMarkdown = await transform.call(
    { error: (message) => assert.fail(message) },
    '(print: 2)',
    '/src/story.md?gneh=karlowe',
  );
  assert.match(karloweMarkdown.code, /defineIRFragment/);
});

test('Vite shares caller-owned CST-to-IR lowerings with frontend transforms', async () => {
  const lowerings = createInkdownLowerings();
  lowerings.register('build-name', ({ node, parser, base }) => ({
    nodes: [
      {
        type: 'text',
        value: 'nightly',
        span: parser.span(base + node.start, base + node.headEnd),
      },
    ],
    end: node.headEnd,
  }));
  const plugin = gneh({ dialects: [inkdown(lowerings)] });
  const transform = plugin.transform.handler ?? plugin.transform;
  const result = await transform.call(
    { error: (message) => assert.fail(message) },
    '@build-name',
    '/src/story.inkdown',
  );
  assert.match(result.code, /nightly/);
});

test('Vite transforms never write adjacent declaration files', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gneh-vite-types-'));
  const file = path.join(directory, 'cards.karlowe');
  const source = ':: Card {"params":["enemy"],"paramTypes":{"enemy":"{name:string}"}}\n(print: $enemy.name)';
  try {
    const plugin = gneh({ dialects: [inkdown()] });
    const transform = plugin.transform.handler ?? plugin.transform;
    await transform.call({ error: (message) => assert.fail(message) }, source, file + '.inkdown');
    await assert.rejects(() => fs.readFile(path.join(directory, 'cards.d.karlowe.ts')), /ENOENT/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
