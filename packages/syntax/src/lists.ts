import type { StoryNode } from '@gneh/core';
import type { LineEnd, MarkupParser, ReadResult } from './parser.js';

export interface ListLine {
  content: string;
  depth: number;
  ordered: boolean;
}

export type ListLineReader = (line: string) => ListLine | undefined;

const maxListDepth = 128;

/** Builds nested list IR from a dialect-owned line recognizer. */
export function readList(
  source: string,
  index: number,
  base: number,
  lineEnd: LineEnd,
  parser: MarkupParser,
  readLine: ListLineReader,
): ReadResult | undefined {
  if (!readLine(source.slice(index, lineEnd(index)))) return;
  type Entry = ListLine & { start: number; end: number };
  const entries: Entry[] = [];
  let cursor = index;
  while (cursor < source.length) {
    const end = lineEnd(cursor),
      match = readLine(source.slice(cursor, end));
    if (!match) break;
    if (!Number.isSafeInteger(match.depth) || match.depth < 1)
      parser.error('LIST_DEPTH', 'List readers must return a positive integer depth.', base + cursor, base + end);
    if (match.depth > maxListDepth)
      parser.error('LIST_DEPTH', `List nesting exceeds the depth limit of ${maxListDepth}.`, base + cursor, base + end);
    entries.push({ ...match, start: cursor, end });
    cursor = end;
  }
  let entry = 0;
  const build = (depth: number, ordered: boolean): StoryNode => {
    const children: StoryNode[] = [];
    const listStart = entries[entry].start;
    let listEnd = entries[entry].end;
    while (entry < entries.length) {
      const current = entries[entry];
      if (current.depth < depth || (current.depth === depth && current.ordered !== ordered)) break;
      if (current.depth > depth) {
        const parent = children.at(-1);
        if (parent?.type !== 'content' || parent.kind !== 'item') break;
        parent.children.push(build(current.depth, current.ordered));
        listEnd = current.end;
        continue;
      }
      const line = source.slice(current.start, current.end);
      const contentOffset = current.start + line.indexOf(current.content);
      children.push({
        type: 'content',
        kind: 'item',
        attrs: {},
        children: parser.inline(current.content, base + contentOffset),
        span: parser.span(base + current.start, base + current.end),
      });
      listEnd = current.end;
      entry++;
      if (entry < entries.length && entries[entry].depth > depth) {
        const nested = entries[entry];
        (children.at(-1) as Extract<StoryNode, { type: 'content' }>).children.push(build(nested.depth, nested.ordered));
        listEnd = nested.end;
      }
    }
    return {
      type: 'content',
      kind: 'list',
      attrs: { ordered },
      children,
      span: parser.span(base + listStart, base + listEnd),
    };
  };
  const nodes: StoryNode[] = [];
  while (entry < entries.length) {
    const current = entries[entry];
    nodes.push(build(current.depth, current.ordered));
  }
  return { nodes, end: cursor, block: true };
}
