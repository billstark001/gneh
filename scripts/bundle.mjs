import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const require = createRequire(import.meta.url);

const packages = fs
  .readdirSync(path.join(root, 'packages'))
  .filter((name) => fs.existsSync(path.join(root, 'packages', name, 'package.json')));

const out = path.join(root, 'dist');

fs.mkdirSync(out, { recursive: true });

const offline = process.argv.includes('--offline');

/** Only the emergency/offline path uses this static CJS linker. No eval/new Function. */
async function offlineBundle(entry, output) {
  const tsPath = process.env.GNEH_TYPESCRIPT_API;
  const ts = require(tsPath ? path.join(tsPath, 'lib/typescript.js') : 'typescript-language-service');
  const modules = new Map();
  function resolve(specifier, parent) {
    if (specifier.startsWith('@gneh/')) return path.join(root, 'packages', specifier.slice(6), 'src/index.ts');
    if (specifier.startsWith('.')) {
      const full = path.resolve(path.dirname(parent), specifier);
      for (const candidate of [full.replace(/\.js$/, '.ts'), full, full + '/index.ts'])
        if (fs.existsSync(candidate)) return candidate;
    }
    throw new Error(`Offline browser linker does not recognize ${specifier} from ${parent}`);
  }
  function visit(file) {
    const relative = path.relative(root, file).replaceAll('\\', '/');
    const id = relative.startsWith('../') ? 'vendor/' + path.basename(file) : relative;
    if (modules.has(id)) return id;
    const source = fs.readFileSync(file, 'utf8');
    const code = file.endsWith('.ts')
      ? ts.transpileModule(source, {
          fileName: file,
          compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.CommonJS,
            esModuleInterop: true,
          },
        }).outputText
      : source;
    const record = { code, map: {} };
    modules.set(id, record);
    for (const match of code.matchAll(/\brequire\(["']([^"']+)["']\)/g))
      record.map[match[1]] = visit(resolve(match[1], file));
    return id;
  }
  const entryId = visit(entry);
  const code = `/*! gneh 0.1.0 | MIT; third-party notices are in licenses/ and THIRD_PARTY_NOTICES.md */\n(function(global){\n"use strict";\nconst modules={\n${[...modules].map(([id, m]) => `${JSON.stringify(id)}:[function(module,exports,require){\n${m.code}\n},${JSON.stringify(m.map)}]`).join(',\n')}\n};\nconst cache={};function load(id){if(cache[id])return cache[id].exports;const entry=modules[id];if(!entry)throw Error("Unknown module "+id);const module={exports:{}};cache[id]=module;entry[0](module,module.exports,name=>load(entry[1][name]));return module.exports;}global.Gneh=load(${JSON.stringify(entryId)});\n})(globalThis);\n`;
  fs.writeFileSync(output, code);
  return modules.size;
}

if (offline) {
  for (const [entry, name] of [
    ['runtime.ts', 'gneh.global.js'],
    ['index.ts', 'gneh.vendor.global.js'],
  ]) {
    const count = await offlineBundle(path.join(root, 'packages/vendor/src', entry), path.join(out, name));
    console.log(`Offline static bundle ${name}: ${count} modules.`);
  }
} else {
  const { build } = await import('vite');
  for (const [entry, name] of [
    ['runtime.ts', 'gneh.global.js'],
    ['index.ts', 'gneh.vendor.global.js'],
  ])
    await build({
      configFile: false,
      resolve: {
        alias: Object.fromEntries(
          packages.map((name) => ['@gneh/' + name, path.join(root, 'packages', name, 'src/index.ts')]),
        ),
      },
      build: {
        target: 'es2022',
        lib: {
          entry: path.join(root, 'packages/vendor/src', entry),
          name: 'Gneh',
          formats: ['iife'],
          fileName: () => name,
        },
        outDir: out,
        emptyOutDir: false,
        sourcemap: true,
      },
    });
}

// Preserve full license notices even when a browser bundle is copied out of the workspace.
const licenseFiles = [
  'LICENSE',
  'licenses/pure-expr-MIT.txt',
  'licenses/twee-grind-MIT.txt',
  'licenses/twee-grind-harlowe.txt',
];

const banner =
  '/*!\n' +
  licenseFiles.map((file) => file + '\n' + fs.readFileSync(path.join(root, file), 'utf8')).join('\n---\n') +
  '\n*/\n';

for (const name of ['gneh.global.js', 'gneh.vendor.global.js']) {
  const file = path.join(out, name);
  fs.writeFileSync(file, banner + fs.readFileSync(file, 'utf8'));
}
