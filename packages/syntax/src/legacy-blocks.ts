import type { StoryNode } from '@gneh/core';
import { legacyListMatch, type LegacyListMatch, type MarkupProfile, type ProfileParser } from './profiles.js';

export function readSugarCodeBlock(
  source: string,
  index: number,
  base: number,
  lineEnd: (start: number) => number,
  parser: ProfileParser,
): { node: StoryNode; end: number } | undefined {
  let end = lineEnd(index);
  if (!/^\{\{\{\s*$/.test(source.slice(index, end).replace(/\r?\n$/, ''))) return;
  const bodyStart = end;
  let cursor = end;
  while (cursor < source.length) {
    const next = lineEnd(cursor);
    if (/^\}\}\}\s*$/.test(source.slice(cursor, next).replace(/\r?\n$/, ''))) {
      end = next;
      return {
        node: {
          type: 'content',
          kind: 'code-block',
          attrs: {},
          children: [
            {
              type: 'text',
              value: source.slice(bodyStart, cursor).replace(/\r?\n$/, ''),
              span: parser.span(base + bodyStart, base + cursor),
            },
          ],
          span: parser.span(base + index, base + end),
        },
        end,
      };
    }
    cursor = next;
  }
  parser.error('CODE_FENCE', 'Unclosed SugarCube code block.', base + index);
}

export function readMarkdownCodeFence(
  source: string,
  index: number,
  base: number,
  lineEnd: (start: number) => number,
  parser: ProfileParser,
): { node: StoryNode; end: number } | undefined {
  let end = lineEnd(index);
  const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(source.slice(index, end).replace(/\r?\n$/, ''));
  if (!fence) return;
  const marker = fence[1],
    bodyStart = end;
  let cursor = end;
  while (cursor < source.length) {
    const next = lineEnd(cursor),
      line = source.slice(cursor, next).trim();
    if (line[0] === marker[0] && line.length >= marker.length && [...line].every((c) => c === marker[0])) {
      end = next;
      return {
        node: {
          type: 'content',
          kind: 'code-block',
          attrs: { language: fence[2].trim() },
          children: [
            {
              type: 'text',
              value: source.slice(bodyStart, cursor).replace(/\r?\n$/, ''),
              span: parser.span(base + bodyStart, base + cursor),
            },
          ],
          span: parser.span(base + index, base + end),
        },
        end,
      };
    }
    cursor = next;
  }
  parser.error('CODE_FENCE', 'Unclosed code fence.', base + index);
}

export function readLegacyList(
  source: string,
  index: number,
  base: number,
  profile: MarkupProfile,
  lineEnd: (start: number) => number,
  parser: ProfileParser,
): { nodes: StoryNode[]; end: number } | undefined {
  if (!legacyListMatch(source.slice(index, lineEnd(index)), profile)) return;
  type Entry = LegacyListMatch & { start: number; end: number };
  const entries: Entry[] = [];
  let cursor = index;
  while (cursor < source.length) {
    const end = lineEnd(cursor),
      match = legacyListMatch(source.slice(cursor, end), profile);
    if (!match) break;
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
      const contentOffset = current.start + source.slice(current.start, current.end).indexOf(current.content);
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
  return { nodes, end: cursor };
}
