import { describe, expect, test } from 'vitest';
import { safeURL } from '../dist/index.js';

describe('@gneh/renderer-dom', () => {
  test('allows portable navigation targets and safe network URLs', () => {
    expect(safeURL('#passage')).toBe('#passage');
    expect(safeURL('https://example.com/story')).toBe('https://example.com/story');
    expect(safeURL('/assets/image.png', true)).toBe('/assets/image.png');
  });

  test('rejects executable and non-image data URLs', () => {
    expect(safeURL('javascript:alert(1)')).toBe('');
    expect(safeURL('data:text/html,<script>alert(1)</script>', true)).toBe('');
  });
});
