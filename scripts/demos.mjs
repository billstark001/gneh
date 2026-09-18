import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const output = path.join(root, 'demo');

const projects = [
  { name: 'starter', root: 'packages/create/template', config: 'vite.config.ts' },
  { name: 'vite-app', root: 'examples/vite-app', config: 'vite.config.mjs' },
];

fs.rmSync(output, { recursive: true, force: true });

for (const project of projects) {
  const projectRoot = path.join(root, project.root);
  await build({
    root: projectRoot,
    configFile: path.join(projectRoot, project.config),
    base: './',
    build: { outDir: path.join(output, project.name), emptyOutDir: true },
  });
}

fs.writeFileSync(
  path.join(output, 'index.html'),
  `<!doctype html><html lang="en"><meta charset="utf-8"><title>gneh demos</title>
<main><h1>gneh Vite demos</h1><ul>
<li><a href="./starter/">Editable starter</a> · <a href="./starter/?environment=wiki">wiki</a> · <a href="./starter/?environment=visual-novel">visual novel</a></li>
<li><a href="./vite-app/">Vite coexistence example</a></li>
</ul></main></html>`,
);

fs.writeFileSync(
  path.join(output, 'generation.json'),
  JSON.stringify({ generatedBy: 'pnpm demos', inputs: projects }, null, 2) + '\n',
);
