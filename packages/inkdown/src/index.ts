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
  for (const passage of split.passages) {
    try {
      result.passages.push(
        basePassage(
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
          }),
        ),
      );
    } catch (error) {
      result.diagnostics.push(diag(error, passage.span));
    }
  }
  return result;
}
