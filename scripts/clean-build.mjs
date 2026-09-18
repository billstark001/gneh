/** Remove only reproducible compiler/bundler outputs before a release build. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

for (const entry of fs.readdirSync(path.join(root, 'packages'), { withFileTypes: true })) {
  if (entry.isDirectory()) fs.rmSync(path.join(root, 'packages', entry.name, 'dist'), { recursive: true, force: true });
}

for (const generated of ['dist', 'standalone', '.cache/tsbuildinfo'])
  fs.rmSync(path.join(root, generated), { recursive: true, force: true });
