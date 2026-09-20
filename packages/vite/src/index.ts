import fs from 'node:fs/promises';
import type { Plugin } from 'vite';
import { assertValid, generateModule, parseSource, type DialectFrontend } from '@gneh/compiler';

export interface GnehViteOptions {
  /** Every authoring dialect is explicit, including Inkdown. */
  dialects: readonly DialectFrontend[];
  live?: boolean;
  runtimeExtensionIds?: readonly string[];
}

const optInExtension = /\.(?:md|twee|tw)$/i;

function request(id: string): { file: string; params: URLSearchParams } {
  const query = id.indexOf('?');
  return {
    file: query < 0 ? id : id.slice(0, query),
    params: new URLSearchParams(query < 0 ? '' : id.slice(query + 1)),
  };
}

function dialectFor(file: string, dialects: readonly DialectFrontend[]): DialectFrontend | undefined {
  const lower = file.toLowerCase();
  return dialects.find((frontend) => lower.endsWith('.' + frontend.dialect));
}

function isStoryRequest(id: string, dialects: readonly DialectFrontend[]): boolean {
  const { file, params } = request(id);
  return Boolean(dialectFor(file, dialects)) || (optInExtension.test(file) && params.has('gneh'));
}

/** Transform only story modules imported explicitly by application code. */
export function gneh(options: GnehViteOptions): Plugin {
  if (!options.dialects.length) throw new Error('gneh requires at least one explicitly registered dialect.');
  return {
    name: 'gneh',
    enforce: 'pre',
    async load(id) {
      if (isStoryRequest(id, options.dialects)) return await fs.readFile(request(id).file, 'utf8');
    },
    async transform(code, id) {
      if (!isStoryRequest(id, options.dialects)) return;
      const file = request(id).file;
      const frontend = dialectFor(file, options.dialects);
      const parsed = parseSource(code, file, frontend?.dialect, { dialects: options.dialects });
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
      const output = generateModule(parsed.passages, code, file);
      return { code: output.code, map: output.map as never };
    },
  };
}

export default gneh;
