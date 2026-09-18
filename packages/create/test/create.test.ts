import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createProject } from '../dist/index.js';

test('@gneh/create copies an editable Vite application and never overwrites files', async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'create-gneh-'));
  const destination = path.join(parent, 'My Story');
  try {
    createProject(destination);
    const manifest = JSON.parse(await fs.readFile(path.join(destination, 'package.json'), 'utf8'));
    assert.equal(manifest.name, 'my-story');
    assert.equal(manifest.scripts.dev, 'vite');
    assert.equal(manifest.dependencies.preact, undefined);
    assert.match(await fs.readFile(path.join(destination, 'src/ui.ts'), 'utf8'), /createApp/);
    assert.match(await fs.readFile(path.join(destination, 'vite.config.ts'), 'utf8'), /@gneh\/vite/);
    assert.match(await fs.readFile(path.join(destination, '.gitignore'), 'utf8'), /node_modules/);
    assert.throws(() => createProject(destination), /non-empty/);
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
});

test('@gneh/create derives Preact and Vue projects from the shared template', async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'create-gneh-frameworks-'));
  try {
    const preact = path.join(parent, 'Preact Story');
    const vue = path.join(parent, 'Vue Story');
    createProject(preact, 'preact');
    createProject(vue, 'vue');
    const preactManifest = JSON.parse(await fs.readFile(path.join(preact, 'package.json'), 'utf8'));
    const vueManifest = JSON.parse(await fs.readFile(path.join(vue, 'package.json'), 'utf8'));
    assert.match(preactManifest.dependencies.preact, /^\^10\./);
    assert.equal(preactManifest.dependencies.vue, undefined);
    assert.match(await fs.readFile(path.join(preact, 'src/main.ts'), 'utf8'), /from 'preact'/);
    assert.match(vueManifest.dependencies.vue, /^\^3\./);
    assert.equal(vueManifest.dependencies.preact, undefined);
    assert.match(await fs.readFile(path.join(vue, 'src/main.ts'), 'utf8'), /from 'vue'/);
    assert.equal(
      await fs.readFile(path.join(preact, 'src/ui.ts'), 'utf8'),
      await fs.readFile(path.join(vue, 'src/ui.ts'), 'utf8'),
    );
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
});
