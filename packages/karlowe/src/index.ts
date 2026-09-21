/** Stable public Karlowe frontend API. */
export { createKarloweMacroReader, createKarloweLowerings, parseKarlowe, readKarlowe } from './parser.js';

export type { KarloweMacroMeta, KarloweLowerings, KarloweParseOptions } from './parser.js';
export { readKarloweAttachment } from './attachment.js';
export type { KarloweAttachment } from './attachment.js';

export { parseKarloweExpression, karloweAssignments } from './expression.js';

export { harloweMacroName } from './names.js';

export { karloweMarkup } from './markup.js';

export { lexKarlowe, parseKarloweCST, readKarloweHook, readKarloweMacro } from './lexer.js';

export type { KarloweCSTNode, KarloweDocumentCST, KarloweToken, KarloweMacroToken, KarloweHookToken } from './lexer.js';

import { parseKarlowe, type KarloweLowerings } from './parser.js';

/** Explicit compiler/Vite registration; compatibility syntax is never enabled implicitly. */
export function karlowe(lowerings?: KarloweLowerings) {
  return {
    dialect: 'karlowe' as const,
    extensions: ['karlowe'],
    parse: (source: string, file: string) => parseKarlowe(source, file, { lowerings }),
  };
}
