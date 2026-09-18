/** Stable public Karlowe frontend API. */
export {
  createKarloweMacroReader,
  createKarloweLowerings,
  parseKarlowe,
  readKarloweAttachment,
  readKarlowe,
} from './parser.js';

export type { KarloweMacroMeta, KarloweLowerings, KarloweParseOptions, KarloweAttachment } from './parser.js';

export { parseKarloweExpression, karloweAssignments } from './expression.js';

export { lexKarlowe, parseKarloweCST, readKarloweHook, readKarloweMacro } from './lexer.js';

export type { KarloweCSTNode, KarloweDocumentCST, KarloweToken, KarloweMacroToken, KarloweHookToken } from './lexer.js';
