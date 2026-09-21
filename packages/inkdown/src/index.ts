import { splitPassages, diag } from '@gneh/source';
import { MarkupParser, basePassage } from '@gneh/syntax';
import type { ParseResult } from '@gneh/core';
import { parseExpression } from '@gneh/expression';
import { createInkdownDirectiveReader, createInkdownLowerings, type InkdownLowerings } from './directives.js';
import { inkdownMarkup } from './markup.js';

export { createInkdownDirectiveReader, createInkdownLowerings, readInkdownDirective } from './directives.js';

export type { InkdownLowerings, InkdownMacroToken } from './directives.js';

export { inkdownMarkup } from './markup.js';

export interface InkdownParseOptions {
  lowerings?: InkdownLowerings;
}

export function parseInkdown(source: string, file = 'story.inkdown', options: InkdownParseOptions = {}): ParseResult {
  const lowerings = options.lowerings ?? createInkdownLowerings();
  const split = splitPassages(source, file);
  const result: ParseResult = { passages: [], diagnostics: [...split.diagnostics] };
  const parse = (passage: (typeof split.passages)[number], initializer = false) => {
    try {
      const value = basePassage(
        passage,
        'inkdown',
        new MarkupParser({
          file,
          expression: parseExpression,
          markup: inkdownMarkup,
          special: createInkdownDirectiveReader(lowerings),
          isBlockStart: (line) => {
            const match = /^\s*@([A-Za-z_][\w-]*)\b/.exec(line);
            return !!match && lowerings.has(match[1]);
          },
          contextName: passage.name,
          initializer,
        }),
      );
      if (initializer) {
        const bare = value.body.find((node) => node.type !== 'callable' && node.type !== 'effect');
        if (bare) throw new Error('Bare render output is not allowed in the primary initializer.');
      } else result.passages.push(value);
      return value;
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

/** Explicit compiler/Vite registration; no authoring dialect is enabled implicitly. */
export function inkdown(lowerings?: InkdownLowerings) {
  return {
    dialect: 'inkdown' as const,
    extensions: ['inkdown'],
    parse: (source: string, file: string) => parseInkdown(source, file, { lowerings }),
  };
}
