import { describe, expect, test } from 'vitest';
import { createInkdownLowerings, parseInkdown } from '../dist/index.js';

const markdownHardBreak = '  ';

describe('@gneh/inkdown', () => {
  test('parses native directives into structural IR', () => {
    const result = parseInkdown(
      `:: Start [start]
@if ($ready) {
Hello {{ $name }}
}`,
      'story.inkdown',
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.passages[0]?.body.some((node) => node.type === 'if')).toBe(true);
  });

  test('provides an isolated, caller-owned lowering registry', () => {
    const first = createInkdownLowerings();
    const second = first.clone();
    second.register('custom', () => ({ nodes: [], end: 0 }));
    expect(first.has('custom')).toBe(false);
    expect(second.resolve('custom')?.handler).toBeTypeOf('function');
  });

  test('honors Markdown escapes, hard breaks, code spans and intraword underscores', () => {
    const result = parseInkdown(
      `:: Start [start]
snake_case \\*literal\\* \` code \`${markdownHardBreak}
next\\
line`,
      'story.inkdown',
    );
    expect(result.diagnostics).toEqual([]);
    const body = result.passages[0].body;
    const flatten = (nodes: typeof body): typeof body =>
      nodes.flatMap((node) => [node, ...('children' in node ? flatten(node.children) : [])]);
    const nodes = flatten(body);
    expect(nodes.filter((node) => node.type === 'content' && node.kind === 'break')).toHaveLength(2);
    expect(nodes.find((node) => node.type === 'content' && node.kind === 'code')).toMatchObject({
      children: [{ type: 'text', value: 'code' }],
    });
    expect(nodes.some((node) => node.type === 'content' && node.kind === 'emphasis')).toBe(false);
  });

  test('parses URL schemes in Markdown links as markup rather than JavaScript comments', () => {
    const result = parseInkdown(':: Start [start]\n[site](https://example.com)', 'story.inkdown');
    expect(result.diagnostics).toEqual([]);
    expect(result.passages[0].body[0]).toMatchObject({
      type: 'content',
      kind: 'paragraph',
      children: [expect.objectContaining({ type: 'content', kind: 'link', attrs: { href: 'https://example.com' } })],
    });
  });

  test('keeps nested lists and literal trailing heading hashes structural', () => {
    const result = parseInkdown(
      `:: Start [start]
- parent
  - child
# heading#
# closed #`,
      'story.inkdown',
    );
    expect(result.diagnostics).toEqual([]);
    const body = result.passages[0].body;
    const topList = body[0];
    expect(topList).toMatchObject({ type: 'content', kind: 'list' });
    if (topList.type !== 'content') throw new Error('expected list');
    expect(topList.children[0]).toMatchObject({
      type: 'content',
      kind: 'item',
      children: expect.arrayContaining([expect.objectContaining({ type: 'content', kind: 'list' })]),
    });
    const headings = body.filter((node) => node.type === 'content' && node.kind === 'heading');
    expect(headings[0]).toMatchObject({ children: [{ type: 'text', value: 'heading#' }] });
    expect(headings[1]).toMatchObject({ children: [{ type: 'text', value: 'closed' }] });
  });

  test('bounds adversarial list nesting before the JavaScript stack overflows', () => {
    const body = Array.from({ length: 200 }, (_, index) => `${'  '.repeat(index)}- item`).join('\n');
    expect(parseInkdown(`:: Start\n${body}`).diagnostics[0]?.code).toBe('LIST_DEPTH');
  });
});
