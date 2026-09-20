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
const viteAssetQueries = ['raw', 'url', 'worker', 'sharedworker', 'inline'];

function request(id: string): { file: string; params: URLSearchParams } {
  const query = id.indexOf('?');
  return {
    file: query < 0 ? id : id.slice(0, query),
    params: new URLSearchParams(query < 0 ? '' : id.slice(query + 1)),
  };
}

function dialectFor(file: string, dialects: readonly DialectFrontend[]): DialectFrontend | undefined {
  const lower = file.toLowerCase();
  return dialects.find((frontend) =>
    frontend.extensions.some((extension) => lower.endsWith('.' + extension.toLowerCase().replace(/^\./, ''))),
  );
}

function isStoryRequest(id: string, dialects: readonly DialectFrontend[]): boolean {
  const { file, params } = request(id);
  if (viteAssetQueries.some((query) => params.has(query))) return false;
  return Boolean(dialectFor(file, dialects)) || (optInExtension.test(file) && params.has('gneh'));
}

function requestedDialect(id: string, dialects: readonly DialectFrontend[]): DialectFrontend | undefined {
  const { file, params } = request(id);
  const native = dialectFor(file, dialects);
  if (native) return native;
  const selected = params.get('gneh');
  if (!selected) return undefined;
  return dialects.find((frontend) => frontend.dialect === selected);
}

/** Transform only story modules imported explicitly by application code. */
export function gneh(options: GnehViteOptions): Plugin {
  if (!options?.dialects?.length) throw new Error('gneh requires at least one explicitly registered dialect.');
  const dialectNames = new Set<string>();
  const extensions = new Set<string>();
  for (const frontend of options.dialects) {
    if (dialectNames.has(frontend.dialect))
      throw new Error(`gneh dialect ${JSON.stringify(frontend.dialect)} is registered more than once.`);
    dialectNames.add(frontend.dialect);
    if (!Array.isArray(frontend.extensions) || !frontend.extensions.length)
      throw new Error(`gneh dialect ${JSON.stringify(frontend.dialect)} must own at least one native extension.`);
    for (const value of frontend.extensions) {
      const extension = value.toLowerCase().replace(/^\./, '');
      if (!extension) throw new Error(`gneh dialect ${JSON.stringify(frontend.dialect)} has an empty extension.`);
      if (extensions.has(extension))
        throw new Error(`gneh extension ${JSON.stringify(extension)} has multiple owners.`);
      extensions.add(extension);
    }
  }
  return {
    name: 'gneh',
    enforce: 'pre',
    async load(id) {
      if (isStoryRequest(id, options.dialects)) return await fs.readFile(request(id).file, 'utf8');
    },
    async transform(code, id) {
      if (!isStoryRequest(id, options.dialects)) return;
      const { file, params } = request(id);
      const frontend = requestedDialect(id, options.dialects);
      const selected = optInExtension.test(file) ? params.get('gneh') : undefined;
      if (selected && !frontend)
        this.error(`Dialect ${JSON.stringify(selected)} is not registered in gneh({ dialects: [...] }).`);
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
