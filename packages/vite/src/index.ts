import fs from 'node:fs/promises';
import path from 'node:path';
import type { Plugin } from 'vite';
import { assertValid, generateModule, parseSource, type DialectLowerings } from '@gneh/compiler';
import type { Dialect } from '@gneh/core';

export interface GnehViteOptions {
  dialect?: Dialect;
  live?: boolean;
  /** Emit adjacent `file.d.<dialect>.ts` modules for TypeScript's arbitrary-extension resolver. */
  declarations?: boolean;
  namespace?: boolean;
  /** Caller-owned CST-to-IR lowerings shared by transformed files. */
  lowerings?: DialectLowerings;
  runtimeExtensionIds?: readonly string[];
}

const directExtension = /\.(?:inkdown|karlowe|sugarcast)$/i;

const optInExtension = /\.(?:md|twee|tw)$/i;

function request(id: string): { file: string; params: URLSearchParams } {
  const query = id.indexOf('?');
  return {
    file: query < 0 ? id : id.slice(0, query),
    params: new URLSearchParams(query < 0 ? '' : id.slice(query + 1)),
  };
}

function isStoryRequest(id: string): boolean {
  const { file, params } = request(id);
  return directExtension.test(file) || (optInExtension.test(file) && params.has('gneh'));
}

function declarationFile(file: string): string {
  const dot = file.lastIndexOf('.');
  return `${file.slice(0, dot)}.d.${file.slice(dot + 1)}.ts`;
}

async function writeIfChanged(file: string, contents: string): Promise<void> {
  try {
    if ((await fs.readFile(file, 'utf8')) === contents) return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await fs.writeFile(file, contents, 'utf8');
}

/**
 * Compile story files as ordinary ESM modules. Native gneh extensions are automatic;
 * ambiguous `.md`, `.twee` and `.tw` files require `?gneh`, so other Vite plugins can
 * continue to own those extensions.
 */
export function gneh(options: GnehViteOptions = {}): Plugin {
  let root = process.cwd();
  return {
    name: 'gneh',
    enforce: 'pre',
    configResolved(config) {
      root = config.root;
    },
    async load(id) {
      if (isStoryRequest(id)) return await fs.readFile(request(id).file, 'utf8');
    },
    async transform(code, id) {
      if (!isStoryRequest(id)) return;
      const file = request(id).file;
      const parsed = parseSource(code, file, options.dialect, { lowerings: options.lowerings });
      assertValid(parsed);
      const unresolved = parsed.passages
        .flatMap((passage) => passage.capabilities)
        .find(
          (capability) =>
            capability.startsWith('runtime-extension:') &&
            !(options.runtimeExtensionIds ?? []).includes(capability.slice('runtime-extension:'.length)),
        );
      if (unresolved) this.error(`Undeclared ${unresolved}. Add its ID to gneh({ runtimeExtensionIds: [...] }).`);
      if (options.live === false) {
        const live = parsed.passages.find((passage) => passage.capabilities.includes('live'));
        if (live) this.error(`${live.id} requires a live context.`);
      }
      const output = generateModule(parsed.passages, code, file, {
        namespace: options.namespace === false ? undefined : path.relative(root, file).replaceAll('\\', '/'),
      });
      if (options.declarations !== false) await writeIfChanged(declarationFile(file), output.declarations);
      return { code: output.code, map: output.map as never };
    },
  };
}

export default gneh;
