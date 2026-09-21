import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createProject } from '../dist/index.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = path.resolve(packageRoot, '../..');

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
    const styles = await fs.readFile(path.join(destination, 'src/style.css'), 'utf8');
    assert.doesNotMatch(styles, /article\s*\{[^}]*max-width:\s*50rem/s);
    assert.match(styles, /--gneh-page-background/);
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
    assert.doesNotMatch(await fs.readFile(path.join(react, 'src/App.tsx'), 'utf8'), /story\/main\.inkdown/);
    assert.match(await fs.readFile(path.join(react, 'src/main.tsx'), 'utf8'), /story\/main\.inkdown/);
    assert.match(await fs.readFile(path.join(react, 'src/main.tsx'), 'utf8'), /gnehEnvironment = 'story-flow'/);
    assert.doesNotMatch(await fs.readFile(path.join(react, 'src/App.tsx'), 'utf8'), /story\.dispose/);
    assert.match(await fs.readFile(path.join(react, 'vite.config.ts'), 'utf8'), /plugin-react/);
    assert.match(preactManifest.dependencies.preact, /^\^10\./);
    assert.equal(preactManifest.dependencies.vue, undefined);
    assert.match(await fs.readFile(path.join(preact, 'src/App.tsx'), 'utf8'), /preact\/hooks/);
    assert.doesNotMatch(await fs.readFile(path.join(preact, 'src/App.tsx'), 'utf8'), /preact\/compat/);
    assert.doesNotMatch(await fs.readFile(path.join(preact, 'src/App.tsx'), 'utf8'), /story\/main\.inkdown/);
    assert.match(await fs.readFile(path.join(preact, 'src/main.tsx'), 'utf8'), /story\/main\.inkdown/);
    assert.match(await fs.readFile(path.join(preact, 'src/main.tsx'), 'utf8'), /gnehEnvironment = 'story-flow'/);
    assert.match(vueManifest.dependencies.vue, /^\^3\./);
    assert.equal(vueManifest.dependencies.preact, undefined);
    assert.match(vueManifest.devDependencies['vue-tsc'], /^\^3\./);
    assert.match(vueManifest.devDependencies.typescript, /^\^6\./);
    assert.equal(vueManifest.scripts.typecheck, 'vue-tsc --noEmit');
    assert.match(await fs.readFile(path.join(vue, 'src/App.vue'), 'utf8'), /<template>/);
    assert.doesNotMatch(await fs.readFile(path.join(vue, 'src/App.vue'), 'utf8'), /story\/main\.inkdown/);
    assert.match(await fs.readFile(path.join(vue, 'src/main.ts'), 'utf8'), /story\/main\.inkdown/);
    assert.match(await fs.readFile(path.join(vue, 'src/main.ts'), 'utf8'), /gnehEnvironment = 'story-flow'/);
    await assert.rejects(() => fs.readFile(path.join(preact, 'src/ui.ts')), /ENOENT/);
    await assert.rejects(() => fs.readFile(path.join(vue, 'src/ui.ts')), /ENOENT/);
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
});

test('@gneh/create framework projects typecheck and build from their public entrypoints', async () => {
  const parent = await fs.mkdtemp(path.join(packageRoot, '.generated-test-'));
  try {
    for (const template of ['react', 'preact', 'vue']) {
      const destination = path.join(parent, template);
      createProject(destination, template);
      const typechecker = template === 'vue' ? 'vue-tsc' : 'tsc';
      const executableRoot = template === 'vue' ? packageRoot : workspaceRoot;
      execFileSync(path.join(executableRoot, 'node_modules/.bin', typechecker), ['--noEmit', '-p', 'tsconfig.json'], {
        cwd: destination,
        stdio: 'pipe',
      });
      execFileSync(path.join(workspaceRoot, 'node_modules/.bin/vite'), ['build'], {
        cwd: destination,
        stdio: 'pipe',
      });
    }
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
}, 20_000);
