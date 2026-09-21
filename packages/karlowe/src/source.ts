import type { ParseResult } from '@gneh/core';
import { diag, splitPassages } from '@gneh/source';
import { basePassage, MarkupParser } from '@gneh/syntax';
import { parseKarloweExpression } from './expression.js';
import { karloweMarkup } from './markup.js';
import {
  createKarloweLowerings,
  createKarloweMacroReader,
  extendKarloweParagraph,
  type KarloweLowerings,
} from './parser.js';

export interface KarloweParseOptions {
  lowerings?: KarloweLowerings;
}

export function parseKarlowe(source: string, file = 'story.karlowe', options: KarloweParseOptions = {}): ParseResult {
  const lowerings = options.lowerings ?? createKarloweLowerings();
  const split = splitPassages(source, file);
  const result: ParseResult = { passages: [], diagnostics: [...split.diagnostics] };
  const parse = (passage: (typeof split.passages)[number], initializer = false) => {
    try {
      const parsed = basePassage(
        passage,
        'karlowe',
        new MarkupParser({
          file,
          expression: parseKarloweExpression,
          markup: karloweMarkup,
          special: createKarloweMacroReader(lowerings),
          isBlockStart: (line) => /^\s*\([\w-]+\s*:/.test(line),
          extendParagraph: extendKarloweParagraph,
          contextName: passage.name,
          initializer,
        }),
      );
      if (initializer && parsed.body.some((node) => node.type !== 'callable' && node.type !== 'effect'))
        throw new Error('Bare render output is not allowed in the primary initializer.');
      parsed.evaluation = 'materialized';
      if (!initializer) result.passages.push(parsed);
      return parsed;
    } catch (error) {
      result.diagnostics.push(diag(error, passage.span));
    }
  };
  const primary = split.primary ? parse(split.primary, true) : undefined;
  for (const passage of split.passages) parse(passage);
  const automatic =
    primary?.body.flatMap((node) =>
      node.type === 'callable' && node.callable.escape === 'export' && node.callable.name
        ? [{ local: node.callable.name, exported: node.callable.name }]
        : [],
    ) ?? [];
  result.module = {
    metadata: split.metadata,
    imports: split.linkage.imports,
    exports: [...split.linkage.exports, ...automatic],
    setup: split.linkage.setup,
    primary,
  };
  return result;
}
