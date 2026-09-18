import assert from 'node:assert/strict';
import { compileSource, compileProject } from '../dist/index.js';
import { Story } from '../../runtime/dist/index.js';

export { compileSource, compileProject, Story, assert };

export function compiled(source, dialect = 'inkdown', options = {}) {
  const result = compileSource(source, `test.${dialect}`, { ...options, dialect });
  assert.deepEqual(
    result.diagnostics.filter((d) => d.severity === 'error'),
    [],
  );
  return result;
}

export function story(source, dialect = 'inkdown', options = {}) {
  return new Story(compiled(source, dialect, options).story, options).start();
}

export function text(nodes) {
  return nodes.map((n) => (n.text ?? '') + text(n.children ?? [])).join('');
}

export function all(nodes) {
  return nodes.flatMap((n) => [n, ...all(n.children ?? [])]);
}

export function click(instance, label) {
  const node = all(instance.view).find(
    (n) => ['button', 'choice'].includes(n.kind) && (n.text ?? text(n.children ?? [])) === label,
  );
  assert.ok(node, `Missing interactive node: ${label}`);
  node.activate();
}
