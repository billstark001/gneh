import {
  readKarloweHook,
  readKarloweMacro,
  readKarloweToken,
  type KarloweHookToken,
  type KarloweMacroToken,
} from './lexer.js';

export interface KarloweAttachment {
  macros: KarloweMacroToken[];
  hook?: KarloweHookToken;
  end: number;
}

const spaces = (source: string, start: number) => {
  let index = start;
  while (/\s/.test(source[index] ?? '')) index++;
  return index;
};

export function readKarloweAttachment(source: string, first: KarloweMacroToken): KarloweAttachment {
  const macros = [first];
  let cursor = spaces(source, first.end);
  while (source[cursor] === '+') {
    const next = readKarloweMacro(source, spaces(source, cursor + 1));
    if (!next) break;
    macros.push(next);
    cursor = spaces(source, next.end);
  }
  let hook = readKarloweHook(source, cursor);
  if (!hook && source.startsWith('[[', cursor) && source[cursor + 2] !== '[') {
    const link = readKarloweToken(source, cursor);
    if (link?.type === 'link')
      hook = {
        type: 'hook',
        hidden: false,
        start: cursor,
        bodyStart: cursor,
        bodyEnd: link.end,
        end: link.end,
      };
  }
  return { macros, hook, end: hook?.end ?? first.end };
}
