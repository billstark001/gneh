import { describe, expect, test } from 'vitest';
import { createWikifier, readPassageData, Story } from '../dist/index.js';

function text(nodes: Array<{ text?: string; children?: any[] }>): string {
  return nodes.map((node) => (node.text ?? '') + text(node.children ?? [])).join('');
}

describe('@gneh/vendor', () => {
  test('loads vendor passage data through the shared story ABI', () => {
    const story = new Story(
      readPassageData({
        entry: 'Start',
        state: { hp: 2 },
        passages: [{ id: 'Start', dialect: 'inkdown', text: 'HP: $hp' }],
      }),
    ).start();
    expect(text(story.view)).toBe('HP: 2');
  });

  test('creates pure wikifier fragments and rejects source effects', () => {
    const fragment = createWikifier({ pure: true })('**Hello**');
    expect(fragment.kind).toBe('gneh.fragment');
    expect(() => createWikifier({ pure: true })('@slot notice { Hi }')).toThrow();
  });
});
