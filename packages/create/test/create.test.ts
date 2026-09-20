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

test('@gneh/create emits distinct native React, Preact and Vue projects', async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'create-gneh-frameworks-'));
  try {
    const react = path.join(parent, 'React Story');
    const preact = path.join(parent, 'Preact Story');
    const vue = path.join(parent, 'Vue Story');
    createProject(react, 'react');
    createProject(preact, 'preact');
    createProject(vue, 'vue');
    const reactManifest = JSON.parse(await fs.readFile(path.join(react, 'package.json'), 'utf8'));
    const preactManifest = JSON.parse(await fs.readFile(path.join(preact, 'package.json'), 'utf8'));
    const vueManifest = JSON.parse(await fs.readFile(path.join(vue, 'package.json'), 'utf8'));
    assert.match(reactManifest.dependencies.react, /^\^19\./);
    assert.match(reactManifest.dependencies['react-dom'], /^\^19\./);
    assert.equal(reactManifest.dependencies.preact, undefined);
    assert.match(await fs.readFile(path.join(react, 'src/App.tsx'), 'utf8'), /from 'react'/);
    assert.match(await fs.readFile(path.join(react, 'vite.config.ts'), 'utf8'), /plugin-react/);
    assert.match(preactManifest.dependencies.preact, /^\^10\./);
    assert.equal(preactManifest.dependencies.vue, undefined);
    assert.match(await fs.readFile(path.join(preact, 'src/App.tsx'), 'utf8'), /preact\/hooks/);
    assert.doesNotMatch(await fs.readFile(path.join(preact, 'src/App.tsx'), 'utf8'), /preact\/compat/);
    assert.match(vueManifest.dependencies.vue, /^\^3\./);
    assert.equal(vueManifest.dependencies.preact, undefined);
    assert.match(await fs.readFile(path.join(vue, 'src/App.vue'), 'utf8'), /<template>/);
    await assert.rejects(() => fs.readFile(path.join(preact, 'src/ui.ts')), /ENOENT/);
    await assert.rejects(() => fs.readFile(path.join(vue, 'src/ui.ts')), /ENOENT/);
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
});
