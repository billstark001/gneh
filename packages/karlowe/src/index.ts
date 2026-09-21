/** Stable public Karlowe frontend API. */
export { createKarloweMacroReader, createKarloweLowerings, readKarlowe } from './parser.js';
export { parseKarlowe } from './source.js';

export type { KarloweMacroMeta, KarloweLowerings } from './parser.js';
export type { KarloweParseOptions } from './source.js';
export { readKarloweAttachment } from './attachment.js';
export type { KarloweAttachment } from './attachment.js';

export { parseKarloweExpression, karloweAssignments } from './expression.js';

export { harloweMacroName } from './names.js';

export { karloweMarkup } from './markup.js';

export { lexKarlowe, parseKarloweCST, readKarloweHook, readKarloweMacro } from './lexer.js';

export type { KarloweCSTNode, KarloweDocumentCST, KarloweToken, KarloweMacroToken, KarloweHookToken } from './lexer.js';

import type { KarloweLowerings } from './parser.js';
import { parseKarlowe } from './source.js';

/** Explicit compiler/Vite registration; compatibility syntax is never enabled implicitly. */
export function karlowe(lowerings?: KarloweLowerings) {
  return {
    dialect: 'karlowe' as const,
    extensions: ['karlowe'],
    parse: (source: string, file: string) => parseKarlowe(source, file, { lowerings }),
  };
}
