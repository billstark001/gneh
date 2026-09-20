/** Stable public Sugarcast frontend API. */
export {
  createSugarcastMacroReader,
  createSugarcastLowerings,
  parseSugarcast,
  parseSugarcastCST,
  readSugarcastBlock,
  readSugarcast,
  readSugarcastMacro,
} from './parser.js';

export type {
  SugarcastMacroMeta,
  SugarcastLowerings,
  SugarcastMacroToken,
  SugarcastMacroCST,
  SugarcastCSTNode,
  SugarcastDocumentCST,
  SugarcastParseOptions,
} from './parser.js';

export { sugarcastMarkup } from './markup.js';

import { parseSugarcast, type SugarcastLowerings } from './parser.js';

/** Explicit compiler/Vite registration; compatibility syntax is never enabled implicitly. */
export function sugarcast(lowerings?: SugarcastLowerings) {
  return {
    dialect: 'sugarcast' as const,
    extensions: ['sugarcast', 'sugar'],
    parse: (source: string, file: string) => parseSugarcast(source, file, { lowerings }),
  };
}
