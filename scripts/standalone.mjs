/**
 * Derive the dependency-free Node distribution from normal package outputs.
 *
 * The generated tree uses Node's standard node_modules layout. Keeping the
 * emitted package imports intact is both easier to audit and less fragile than
 * rewriting JavaScript module specifiers after TypeScript has emitted them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const output = path.join(root, 'standalone');

const excluded = new Set(['create', 'language-service', 'lsp', 'vite']);

const externalRequests = [];

const packages = fs
  .readdirSync(path.join(root, 'packages'))
  .filter((name) => !excluded.has(name) && fs.existsSync(path.join(root, 'packages', name, 'package.json')));

fs.rmSync(output, { recursive: true, force: true });

fs.mkdirSync(path.join(output, 'node_modules', '@gneh'), { recursive: true });

for (const name of packages) {
  const source = path.join(root, 'packages', name);
  const target = path.join(output, 'node_modules', '@gneh', name);
  if (!fs.existsSync(path.join(source, 'dist')))
    throw new Error(`Missing packages/${name}/dist; run the TypeScript build first.`);
  fs.mkdirSync(target, { recursive: true });
  fs.cpSync(path.join(source, 'dist'), path.join(target, 'dist'), { recursive: true });
  for (const file of ['README.md', 'LICENSE', 'NOTICE.md'])
    if (fs.existsSync(path.join(source, file))) fs.copyFileSync(path.join(source, file), path.join(target, file));
  if (fs.existsSync(path.join(source, 'licenses')))
    fs.cpSync(path.join(source, 'licenses'), path.join(target, 'licenses'), { recursive: true });

  // Keep package exports intact, but remove workspace-only optional packages from
  // the copied manifest and replace workspace protocol ranges with the release version.
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
  const portableDependencies = (dependencies = {}) =>
    Object.fromEntries(
      Object.entries(dependencies)
        .filter(([dependency]) => {
          if (dependency.startsWith('@gneh/')) return packages.includes(dependency.slice('@gneh/'.length));
          externalRequests.push({ dependency, from: source });
          return true;
        })
        .map(([dependency, version]) => [
          dependency,
          String(version).startsWith('workspace:') ? manifest.version : version,
        ]),
    );
  manifest.dependencies = portableDependencies(manifest.dependencies);
  manifest.peerDependencies = portableDependencies(manifest.peerDependencies);
  if (!Object.keys(manifest.peerDependencies).length) delete manifest.peerDependencies;
  delete manifest.scripts;
  fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
}

function resolveInstalledPackage(dependency, from) {
  let directory = from;
  while (true) {
    const candidate = path.join(directory, 'node_modules', ...dependency.split('/'));
    if (fs.existsSync(candidate)) return fs.realpathSync(candidate);
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error(`Cannot locate installed dependency ${dependency} from ${from}.`);
}

const copiedExternal = new Set();

function copyExternalPackage(dependency, from) {
  if (copiedExternal.has(dependency)) return;
  const source = resolveInstalledPackage(dependency, from);
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
  copiedExternal.add(dependency);

  const target = path.join(output, 'node_modules', ...dependency.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, {
    recursive: true,
    filter: (entry) => path.basename(entry) !== 'node_modules',
  });

  for (const child of Object.keys(manifest.dependencies ?? {})) copyExternalPackage(child, source);
}

for (const request of externalRequests) copyExternalPackage(request.dependency, request.from);

fs.writeFileSync(
  path.join(output, 'gneh.mjs'),
  `#!/usr/bin/env node
import { main } from '@gneh/cli';
main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
`,
  { mode: 0o755 },
);

fs.writeFileSync(
  path.join(output, 'package.json'),
  JSON.stringify(
    {
      name: '@gneh/standalone',
      version: '0.1.0',
      private: true,
      type: 'module',
      bin: { gneh: './gneh.mjs' },
    },
    null,
    2,
  ) + '\n',
);

fs.mkdirSync(path.join(output, 'browser'), { recursive: true });

for (const name of ['gneh.global.js', 'gneh.vendor.global.js'])
  fs.copyFileSync(path.join(root, 'dist', name), path.join(output, 'browser', name));

for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md'])
  fs.copyFileSync(path.join(root, file), path.join(output, file));

fs.cpSync(path.join(root, 'licenses'), path.join(output, 'licenses'), { recursive: true });

fs.writeFileSync(
  path.join(output, 'README.md'),
  `# gneh standalone

This directory is generated by \`pnpm build:standalone\` from the ordinary package outputs.
It contains a standard Node module graph rather than rewritten or bundled CLI source.

Run \`node gneh.mjs help\` from this directory, or \`node standalone/gneh.mjs help\`
from the repository root. LSP, TypeScript-backed checks, and Vite integration remain
workspace-only features.
`,
);

console.log(
  `Standalone distribution: ${packages.length} gneh packages + ${copiedExternal.size} external runtime packages; create, LSP and Vite stay in the npm workspace.`,
);
