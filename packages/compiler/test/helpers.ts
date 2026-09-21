import assert from 'node:assert/strict';
import { compileSource as compile, compileProject as compileMany } from '../dist/index.js';
import { karlowe } from '../../karlowe/dist/index.js';
import { sugarcast } from '../../sugarcast/dist/index.js';
import { inkdown } from '../../inkdown/dist/index.js';
import { Story } from '../../runtime/dist/index.js';

const dialects = [inkdown(), karlowe(), sugarcast()];

export function compileSource(source, file, options = {}) {
  const normalized = normalizeTestSource(source);
  return compile(normalized.source, file ?? 'test.inkdown', {
    ...options,
    entry: options.entry ?? normalized.entry,
    dialects: options.dialects ?? dialects,
  });
}

export function compileProject(sources, options = {}) {
  return compileMany(sources, { ...options, dialects: options.dialects ?? dialects });
}

export { Story, assert };

export function compiled(source, dialect = 'inkdown', options = {}) {
  const normalized = normalizeTestSource(source);
  const result = compileSource(normalized.source, `test.${dialect}`, {
    entry: normalized.entry,
    ...options,
    dialect,
  });
  assert.deepEqual(
    result.diagnostics.filter((d) => d.severity === 'error'),
    [],
  );
  return result;
}

function normalizeTestSource(source) {
  if (/^\s*---(?:\r?\n)/.test(source)) return { source, entry: undefined };
  const header = /^::[ \t]*([^\r\n[{]*?)(?:[ \t]*\[[^\r\n]*])?(?:[ \t]*(\{[^\r\n]*}))?[ \t]*$/m.exec(source);
  if (!header) return { source: `:: Start [start]\n${source}`, entry: 'Start' };
  let entry = header[1].trim();
  if (header[2]) {
    const metadata = JSON.parse(header[2]);
    if (typeof metadata.id === 'string') entry = metadata.id;
  }
  return { source, entry };
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
