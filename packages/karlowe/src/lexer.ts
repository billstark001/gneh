import { GnehError } from '@gneh/core';

const maxKarloweCSTDepth = 100;

export interface KarloweMacroToken {
  type: 'macro';
  name: string;
  args: string;
  start: number;
  argsStart: number;
  end: number;
}

export interface KarloweHookToken {
  type: 'hook';
  name?: string;
  hidden: boolean;
  start: number;
  bodyStart: number;
  bodyEnd: number;
  end: number;
}

export interface KarloweLinkToken {
  type: 'link';
  source: string;
  start: number;
  end: number;
}

export interface KarloweTextToken {
  type: 'text';
  value: string;
  start: number;
  end: number;
}

export type KarloweToken = KarloweMacroToken | KarloweHookToken | KarloweLinkToken | KarloweTextToken;

export type KarloweCSTNode =
  | KarloweMacroToken
  | KarloweLinkToken
  | KarloweTextToken
  | (KarloweHookToken & { children: KarloweCSTNode[] });

export interface KarloweDocumentCST {
  type: 'document';
  source: string;
  children: KarloweCSTNode[];
}

const macroHead = /^\(\s*([$_][A-Za-z]\w*|[A-Za-z][\w-]*)\s*:\s*/;

function quoted(source: string, index: number): number {
  const quote = source[index];
  let i = index + 1;
  while (i < source.length) {
    if (source[i] === '\\') i += 2;
    else if (source[i++] === quote) return i;
  }
  throw new GnehError('KARLOWE_STRING', 'Unclosed string literal.');
}

function verbatim(source: string, index: number): number {
  let count = 1;
  while (source[index + count] === '`') count++;
  const end = source.indexOf('`'.repeat(count), index + count);
  return end < 0 ? source.length : end + count;
}

/**
 * Scan one macro without assigning expression token kinds. In particular `/`
 * and `%` remain distinct source characters for the expression lexer.
 */
export function readKarloweMacro(source: string, index: number): KarloweMacroToken | undefined {
  const head = macroHead.exec(source.slice(index));
  if (!head) return;
  const stack = [')'];
  let i = index + head[0].length;
  const argsStart = i;
  while (i < source.length) {
    const c = source[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    // Possessive syntax ($value's name) is not a single-quoted string.
    if ((c === '"' || c === "'") && !(c === "'" && source.startsWith("'s", i))) {
      i = quoted(source, i);
      continue;
    }
    if (c === '`') {
      i = verbatim(source, i);
      continue;
    }
    if (source.startsWith('<!--', i)) {
      const end = source.indexOf('-->', i + 4);
      if (end < 0) throw new GnehError('COMMENT', 'Unclosed comment.');
      i = end + 3;
      continue;
    }
    if (c === '(') stack.push(')');
    else if (c === '[') stack.push(']');
    else if (c === '{') stack.push('}');
    else if (c === ')' || c === ']' || c === '}') {
      const expected = stack.pop();
      if (expected !== c) throw new GnehError('KARLOWE_DELIMITER', `Expected ${expected ?? 'nothing'}, got ${c}.`);
      if (!stack.length)
        return {
          type: 'macro',
          name: head[1],
          args: source.slice(argsStart, i),
          start: index,
          argsStart,
          end: i + 1,
        };
    }
    i++;
  }
  throw new GnehError('KARLOWE_MACRO', `Unclosed (${head[1]}:) macro.`);
}

function hookPrefix(source: string, index: number) {
  const match = /^\|([^|>)\n]+)(>|\))\[/.exec(source.slice(index));
  if (!match) return;
  return {
    name: match[1].replace(/\s+/g, '').toLowerCase(),
    hidden: match[2] === ')',
    open: index + match[0].length - 1,
  };
}

function scanLink(source: string, index: number): number {
  let i = index + 2;
  while (i < source.length) {
    if (source[i] === '\\') i += 2;
    else if (source.startsWith(']]', i)) return i + 2;
    else i++;
  }
  throw new GnehError('LINK_CLOSE', 'Unclosed [[link]].');
}

function scanHookBody(source: string, open: number): number {
  let depth = 1;
  let i = open + 1;
  while (i < source.length) {
    const c = source[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (source.startsWith('<!--', i)) {
      const end = source.indexOf('-->', i + 4);
      if (end < 0) throw new GnehError('COMMENT', 'Unclosed comment.');
      i = end + 3;
      continue;
    }
    if (c === '`') {
      i = verbatim(source, i);
      continue;
    }
    if (source.startsWith('[[', i) && source[i + 2] !== '[') {
      i = scanLink(source, i);
      continue;
    }
    const macro = c === '(' ? readKarloweMacro(source, i) : undefined;
    if (macro) {
      i = macro.end;
      continue;
    }
    if (c === '[') depth++;
    else if (c === ']' && --depth === 0) return i;
    i++;
  }
  throw new GnehError('KARLOWE_HOOK', 'Unclosed hook.');
}

export function readKarloweHook(source: string, index: number): KarloweHookToken | undefined {
  const prefix = hookPrefix(source, index);
  let open = index;
  let name = prefix?.name;
  let hidden = prefix?.hidden ?? false;
  if (prefix) open = prefix.open;
  // `[[target]]` is a link, while `[[[target]]]` is an anonymous hook whose
  // first child is a link. This ambiguity is common in conditional choices.
  else if (source[index] !== '[' || (source[index + 1] === '[' && source[index + 2] !== '[')) return;
  const close = scanHookBody(source, open);
  let end = close + 1;
  if (!prefix) {
    const suffix = /^(<|\()([^|\n]+)\|/.exec(source.slice(end));
    if (suffix) {
      hidden = suffix[1] === '(';
      name = suffix[2].replace(/\s+/g, '').toLowerCase();
      end += suffix[0].length;
    }
  }
  return {
    type: 'hook',
    name,
    hidden,
    start: index,
    bodyStart: open + 1,
    bodyEnd: close,
    end,
  };
}

export function readKarloweToken(source: string, index: number): KarloweToken | undefined {
  const macro = readKarloweMacro(source, index);
  if (macro) return macro;
  const hook = readKarloweHook(source, index);
  if (hook) return hook;
  if (source.startsWith('[[', index)) {
    const end = scanLink(source, index);
    return { type: 'link', source: source.slice(index, end), start: index, end };
  }
  return;
}

/** Linear, lossless tokenization used by diagnostics, tests and the parser. */
export function lexKarlowe(source: string): KarloweToken[] {
  const tokens: KarloweToken[] = [];
  let i = 0;
  let textStart = 0;
  const flush = (end: number) => {
    if (end > textStart) tokens.push({ type: 'text', value: source.slice(textStart, end), start: textStart, end });
  };
  while (i < source.length) {
    const token = readKarloweToken(source, i);
    if (!token) {
      i++;
      continue;
    }
    flush(i);
    tokens.push(token);
    i = token.end;
    textStart = i;
  }
  flush(source.length);
  return tokens;
}

function parseKarloweCSTAt(source: string, base: number, depth: number): KarloweDocumentCST {
  if (depth >= maxKarloweCSTDepth)
    throw new GnehError('KARLOWE_CST_DEPTH', `Karlowe CST nesting exceeds the depth limit of ${maxKarloweCSTDepth}.`);
  const children = lexKarlowe(source).map((token): KarloweCSTNode => {
    if (token.type === 'macro')
      return {
        ...token,
        start: token.start + base,
        argsStart: token.argsStart + base,
        end: token.end + base,
      };
    if (token.type !== 'hook') return { ...token, start: token.start + base, end: token.end + base };
    return {
      ...token,
      start: token.start + base,
      end: token.end + base,
      bodyStart: token.bodyStart + base,
      bodyEnd: token.bodyEnd + base,
      children: parseKarloweCSTAt(source.slice(token.bodyStart, token.bodyEnd), base + token.bodyStart, depth + 1)
        .children,
    };
  });
  return { type: 'document', source, children };
}

/** Lossless registry-independent structure; semantic macro names are never consulted. */
export function parseKarloweCST(source: string, base = 0): KarloweDocumentCST {
  return parseKarloweCSTAt(source, base, 0);
}
