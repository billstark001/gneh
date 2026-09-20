import type { ContentKind, Span, StoryNode } from '@gneh/core';
import { balanced } from './delimiters.js';

export type MarkupProfile = 'markdown' | 'harlowe' | 'sugarcube';

export interface ProfileParser {
  inline(source: string, base: number): StoryNode[];
  span(start: number, end: number): Span;
  error(code: string, message: string, start: number, end?: number): never;
}

export const profileMarks: Record<MarkupProfile, (readonly [string, ContentKind])[]> = {
  markdown: [
    ['**', 'strong'],
    ['__', 'strong'],
    ['~~', 'strike'],
    ['*', 'emphasis'],
    ['_', 'emphasis'],
  ],
  harlowe: [
    ['**', 'strong'],
    ["''", 'bold'],
    ['//', 'italic'],
    ['~~', 'strike'],
    ['^^', 'superscript'],
    ['*', 'emphasis'],
  ],
  sugarcube: [
    ['//', 'emphasis'],
    ["''", 'strong'],
    ['__', 'underline'],
    ['==', 'strike'],
    ['^^', 'superscript'],
    ['~~', 'subscript'],
  ],
};

export function literalNodes(value: string, base: number, offset: number, parser: ProfileParser): StoryNode[] {
  const nodes: StoryNode[] = [];
  let cursor = 0;
  for (const match of value.matchAll(/\r\n|\r|\n/g)) {
    const at = match.index;
    if (at > cursor)
      nodes.push({
        type: 'text',
        value: value.slice(cursor, at),
        span: parser.span(base + offset + cursor, base + offset + at),
      });
    nodes.push({
      type: 'content',
      kind: 'break',
      attrs: {},
      children: [],
      span: parser.span(base + offset + at, base + offset + at + match[0].length),
    });
    cursor = at + match[0].length;
  }
  if (cursor < value.length)
    nodes.push({
      type: 'text',
      value: value.slice(cursor),
      span: parser.span(base + offset + cursor, base + offset + value.length),
    });
  return nodes;
}

export function collapseNodes(nodes: StoryNode[]): StoryNode[] {
  const output: StoryNode[] = [];
  let pending = '',
    pendingSpan: Span | undefined;
  const flush = () => {
    if (pendingSpan) output.push({ type: 'text', value: pending.replace(/\s+/g, ' '), span: pendingSpan });
    pending = '';
    pendingSpan = undefined;
  };
  for (const node of nodes) {
    if (node.type === 'text' || (node.type === 'content' && node.kind === 'break')) {
      pendingSpan ??= node.span;
      pending += node.type === 'text' ? node.value : ' ';
      continue;
    }
    flush();
    if ('children' in node && !(node.type === 'content' && node.attrs.verbatim))
      output.push({ ...node, children: collapseNodes(node.children) });
    else output.push(node);
  }
  flush();
  return output;
}

export function readHarloweCollapse(
  source: string,
  index: number,
  base: number,
  parser: ProfileParser,
): { node: StoryNode; end: number } | undefined {
  if (source[index] !== '{') return;
  let contentStart = index + 1,
    contentEnd: number,
    syntaxEnd: number;
  try {
    const group = balanced(source, index);
    contentEnd = group.end - 1;
    syntaxEnd = group.end;
  } catch {
    const unclosed = /^\{=+/.exec(source.slice(index));
    if (!unclosed) return;
    contentStart = index + unclosed[0].length;
    contentEnd = source.length;
    syntaxEnd = source.length;
  }
  return {
    node: {
      type: 'content',
      kind: 'span',
      attrs: { collapse: true },
      children: collapseNodes(parser.inline(source.slice(contentStart, contentEnd), base + contentStart)),
      span: parser.span(base + index, base + syntaxEnd),
    },
    end: syntaxEnd,
  };
}

export function readHarloweCombinedEmphasis(
  source: string,
  index: number,
  base: number,
  parser: ProfileParser,
): { node: StoryNode; end: number } | undefined {
  if (!source.startsWith('***', index)) return;
  const end = source.indexOf('***', index + 3);
  if (end < index + 3) return;
  const inner = parser.inline(source.slice(index + 3, end), base + index + 3);
  return {
    node: {
      type: 'content',
      kind: 'strong',
      attrs: {},
      children: [
        {
          type: 'content',
          kind: 'emphasis',
          attrs: {},
          children: inner,
          span: parser.span(base + index + 1, base + end + 2),
        },
      ],
      span: parser.span(base + index, base + end + 3),
    },
    end: end + 3,
  };
}

export interface LegacyListMatch {
  content: string;
  depth: number;
  ordered: boolean;
}

export function legacyListMatch(line: string, profile: MarkupProfile): LegacyListMatch | undefined {
  line = line.replace(/\r?\n$/, '');
  const match =
    profile === 'harlowe'
      ? /^\s*(\*+|(0\.)+)\s+(.*)$/.exec(line)
      : profile === 'sugarcube'
        ? /^(\*+|#+)\s+(.*)$/.exec(line)
        : undefined;
  if (!match) return;
  const marker = match[1];
  return {
    depth: profile === 'harlowe' && marker.startsWith('0') ? marker.length / 2 : marker.length,
    ordered: profile === 'harlowe' ? marker.startsWith('0') : marker.startsWith('#'),
    content: match[profile === 'harlowe' ? 3 : 2],
  };
}

export function profileBlockStart(line: string, profile: MarkupProfile): boolean {
  line = line.replace(/\r?\n$/, '');
  if (profile === 'harlowe') return /^\s*(?:#{1,6}|-{3,}\s*$)/.test(line) || !!legacyListMatch(line, profile);
  if (profile === 'sugarcube')
    return /^(?:!{1,6}|-{4,}\s*$|>+\s?|\{\{\{\s*$)/.test(line) || !!legacyListMatch(line, profile);
  return /^\s*$|^ {0,3}(?:#{1,6}\s|>\s?|[-*+]\s|\d+\.\s|`{3,}|~{3,}|:::)/.test(line);
}

export function profileHeading(line: string, profile: MarkupProfile): RegExpExecArray | null {
  return profile === 'harlowe'
    ? /^\s*(#{1,6})\s*(.*)$/.exec(line)
    : profile === 'sugarcube'
      ? /^(!{1,6})(.*)$/.exec(line)
      : /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
}

export function isProfileRule(line: string, profile: MarkupProfile): boolean {
  return profile === 'harlowe'
    ? /^\s*-{3,}\s*$/.test(line)
    : profile === 'sugarcube'
      ? /^-{4,}\s*$/.test(line)
      : /^ {0,3}(?:---+|\*\*\*+|___+)\s*$/.test(line);
}

export function profileQuote(line: string, profile: MarkupProfile): RegExpExecArray | undefined {
  return profile === 'sugarcube'
    ? (/^(>+)\s?(.*)$/.exec(line) ?? undefined)
    : profile === 'markdown'
      ? (/^ {0,3}>\s?(.*)$/.exec(line) ?? undefined)
      : undefined;
}
