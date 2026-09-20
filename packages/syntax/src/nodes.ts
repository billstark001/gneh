import type { StoryNode } from '@gneh/core';
import type { MarkupParser } from './parser.js';

/** Converts literal multiline source into text and semantic break nodes. */
export function literalNodes(value: string, base: number, offset: number, parser: MarkupParser): StoryNode[] {
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
