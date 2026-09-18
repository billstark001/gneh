import fs from 'node:fs';
import path from 'node:path';

/** Write a UTF-8 artifact, creating only its parent directories. */
export function writeFile(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}
