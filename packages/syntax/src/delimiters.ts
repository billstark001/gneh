import { GnehError } from '@gneh/core';

export interface Balanced {
  content: string;
  start: number;
  end: number;
}

export type DelimiterSkipper = (source: string, index: number) => number | undefined;

export interface BalancedOptions {
  mode?: 'js' | 'markup';
  /** Treat possessive apostrophes as operators instead of string openers. */
  apostropheProperty?: boolean;
  /** Let a caller skip a dialect-owned nested construct atomically. */
  skip?: DelimiterSkipper;
}

/** Delimiters are scanned with quotes, comments, escapes and fenced code awareness. */
export function balanced(source: string, index: number, options: 'js' | 'markup' | BalancedOptions = 'js'): Balanced {
  const config = typeof options === 'string' ? { mode: options } : options;
  const mode = config.mode ?? 'js';
  const open = source[index],
    close: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
  if (!close[open]) throw new GnehError('DELIMITER', 'Expected an opening delimiter.');
  const stack = [close[open]];
  let i = index + 1;
  while (i < source.length) {
    const skipped = config.skip?.(source, i);
    if (skipped !== undefined && skipped > i) {
      i = skipped;
      continue;
    }
    const c = source[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (
      mode !== 'markup' &&
      !(config.apostropheProperty && c === "'" && source.slice(i, i + 2) === "'s" && /\s/.test(source[i + 2] ?? '')) &&
      (c === '"' || c === "'" || c === '`')
    ) {
      const q = c;
      i++;
      while (i < source.length) {
        if (source[i] === '\\') {
          i += 2;
          continue;
        }
        if (source[i++] === q) break;
      }
      continue;
    }
    if (mode !== 'markup' && source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2);
      if (end < 0) break;
      i = end + 2;
      continue;
    }
    if (mode !== 'markup' && source.startsWith('//', i)) {
      const end = source.indexOf('\n', i + 2);
      if (end < 0) break;
      i = end + 1;
      continue;
    }
    if (mode === 'markup' && c === '`') {
      let length = 1;
      while (source[i + length] === '`') length++;
      const end = source.indexOf('`'.repeat(length), i + length);
      if (end < 0) {
        i += length;
        continue;
      }
      i = end + length;
      continue;
    }
    if (mode === 'markup' && source.startsWith('{{', i)) {
      const b = balanced(source, i, 'js');
      i = b.end;
      continue;
    }
    // Markup nesting tracks the current delimiter, not apostrophes in natural-language prose.
    if (mode === 'markup') {
      if (c === open) stack.push(close[open]);
      else if (c === close[open]) stack.pop();
    } else if (close[c]) stack.push(close[c]);
    else if (c === ')' || c === ']' || c === '}') {
      if (c !== stack.pop()) throw new GnehError('DELIMITER', `Mismatched delimiter ${c}`);
    }
    if (!stack.length) return { content: source.slice(index + 1, i), start: index + 1, end: i + 1 };
    i++;
  }
  throw new GnehError('DELIMITER', `Unclosed ${open} block.`);
}

export function splitTopLevel(source: string, separator = ','): string[] {
  const result: string[] = [];
  let start = 0;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      i++;
      while (i < source.length) {
        if (source[i] === '\\') i++;
        else if (source[i] === q) break;
        i++;
      }
      continue;
    }
    if (c === '(' || c === '[' || c === '{') {
      i = balanced(source, i).end - 1;
      continue;
    }
    if (source.startsWith(separator, i)) {
      result.push(source.slice(start, i).trim());
      i += separator.length - 1;
      start = i + 1;
    }
  }
  result.push(source.slice(start).trim());
  return result;
}
