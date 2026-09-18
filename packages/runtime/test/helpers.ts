import assert from 'node:assert/strict';
import { compileSource } from '../../compiler/dist/index.js';
import { Story } from '../dist/index.js';

export { assert };

export function compiled(source: string, dialect = 'inkdown', options: Record<string, unknown> = {}) {
  const result = compileSource(source, `test.${dialect}`, { ...options, dialect });
  assert.deepEqual(
    result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error'),
    [],
  );
  return result;
}

export function story(source: string, dialect = 'inkdown', options: Record<string, unknown> = {}) {
  return new Story(compiled(source, dialect, options).story, options).start();
}

export function text(nodes: Array<{ text?: string; children?: any[] }>): string {
  return nodes.map((node) => (node.text ?? '') + text(node.children ?? [])).join('');
}

function all(nodes: Array<{ children?: any[] }>): any[] {
  return nodes.flatMap((node) => [node, ...all(node.children ?? [])]);
}

export function click(instance: Story, label: string): void {
  const node = all(instance.view).find(
    (candidate) =>
      ['button', 'choice'].includes(candidate.kind) && (candidate.text ?? text(candidate.children ?? [])) === label,
  );
  assert.ok(node, `Missing interactive node: ${label}`);
  node.activate();
}
