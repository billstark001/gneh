/**
 * Offline fallback using an already installed classic TypeScript compiler API.
 * This performs a real project-reference build (including declarations); it is not
 * evidence that the declared TypeScript 7 CLI or the network-installed toolchain ran.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const require = createRequire(import.meta.url);

let ts;

try {
  ts = require(process.env.GNEH_TYPESCRIPT_API || 'typescript-language-service');
} catch {
  console.error(
    'Install dependencies first, or set GNEH_TYPESCRIPT_API to an existing classic TypeScript compiler API.',
  );
  process.exit(1);
}

const packages = fs
  .readdirSync(path.join(root, 'packages'))
  .filter((name) => fs.existsSync(path.join(root, 'packages', name, 'src')));

// Package-name symlinks let Node execute the emitted ESM exactly as a workspace
// install would. They are also understood by NodeNext resolution during the build.
fs.mkdirSync(path.join(root, 'node_modules', '@gneh'), { recursive: true });

for (const name of packages) {
  const link = path.join(root, 'node_modules', '@gneh', name);
  try {
    fs.symlinkSync(path.join(root, 'packages', name), link, 'dir');
  } catch {}
  fs.rmSync(path.join(root, 'packages', name, 'dist'), { recursive: true, force: true });
}

fs.rmSync(path.join(root, '.cache', 'tsbuildinfo'), { recursive: true, force: true });

if (process.env.GNEH_TYPESCRIPT_API) {
  const configured = path.resolve(process.env.GNEH_TYPESCRIPT_API);
  const directory = configured.endsWith('.js') ? path.resolve(configured, '../..') : configured;
  try {
    fs.symlinkSync(directory, path.join(root, 'node_modules', 'typescript-language-service'), 'dir');
  } catch {}
}

let hadDiagnostic = false;

const host = ts.createSolutionBuilderHost(ts.sys, undefined, (diagnostic) => {
  hadDiagnostic = true;
  console.error(
    ts.formatDiagnostic(diagnostic, {
      getCanonicalFileName: (file) => file,
      getCurrentDirectory: () => root,
      getNewLine: () => '\n',
    }),
  );
});

const builder = ts.createSolutionBuilder(host, [path.join(root, 'tsconfig.json')], {
  pretty: false,
  force: true,
});

const status = builder.build();

if (hadDiagnostic || status !== ts.ExitStatus.Success) process.exit(1);

console.log(
  `Offline project-reference build: ${packages.length} packages; compiler API ${ts.version} (not TS7 validation).`,
);
