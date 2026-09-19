import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

let plugin;

try {
  ({ gneh: plugin } = await import('../dist/index.js'));
} catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
}

const hooks = { skip: !plugin ? 'Workspace build/link is not available.' : false };

test('Vite hooks generate scoped ESM with typed in-file passages', hooks, async () => {
  const gneh = plugin({ declarations: false });
  gneh.configResolved({ root: '/project' });
  const ctx = {
    error(message) {
      throw new Error(message);
    },
  };
  const result = await gneh.transform.call(ctx, ':: Start\n@Card()\n:: Card\nHello', '/project/story/main.inkdown');
  assert.match(result.code, /story\/main\.inkdown#Start/);
  assert.match(result.code, /"Card":__f1/);
  assert.equal(result.map.version, 3);
  assert.equal(
    gneh.handleHotUpdate,
    undefined,
    'normal Vite module propagation should decide whether the host application reloads',
  );
});

test('Vite hooks enforce snapshot capability and emit concrete declarations', hooks, async () => {
  const gneh = plugin({ live: false });
  await assert.rejects(
    () =>
      gneh.transform.call(
        {
          error(message) {
            throw new Error(message);
          },
        },
        ':: Start\n@action hit { @do $hp -= 1; }\n[[Hit => hit]]',
        '/project/a.inkdown',
      ),
    /live/,
  );
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gneh-vite-types-'));
  try {
    const typed = plugin({ declarations: true });
    typed.configResolved({ root: dir });
    await typed.transform.call(
      {},
      ':: Card {"params":["label"],"paramTypes":{"label":"string"}}\n{{ label }}',
      path.join(dir, 'card.inkdown'),
    );
    assert.match(await fs.readFile(path.join(dir, 'card.d.inkdown.ts'), 'utf8'), /"label": string/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

const require = createRequire(import.meta.url);

let ts;

try {
  ts = require('typescript-language-service');
} catch {}

test(
  'Fragment props are checked for ordinary TypeScript interfaces',
  { skip: !ts ? 'Classic TypeScript API is not installed.' : false },
  async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gneh-props-'));
    try {
      const core = new URL('../../core/dist/index.js', import.meta.url).pathname;
      const file = path.join(dir, 'test.mts');
      await fs.writeFile(
        file,
        `import type { Fragment, FragmentContext } from ${JSON.stringify(core)};\ninterface Props { label: string }\ndeclare const card: Fragment<Props>;\ndeclare const ctx: FragmentContext;\nctx.include(card, {label: 'OK'});\nctx.navigate(card, {label: 'OK'});\n// @ts-expect-error required props\nctx.include(card);\n// @ts-expect-error wrong prop type\nctx.navigate(card, {label: 123});\n`,
      );
      const program = ts.createProgram([file], {
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        target: ts.ScriptTarget.ES2022,
        strict: true,
        noEmit: true,
        skipLibCheck: true,
      });
      const errors = ts.getPreEmitDiagnostics(program).filter((d) => d.category === ts.DiagnosticCategory.Error);
      assert.deepEqual(
        errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')),
        [],
      );
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  },
);
