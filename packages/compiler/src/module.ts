/** ESM, declaration and source-map generation for one source module. */
import {
  GnehError,
  type CallableIR,
  type EffectNode,
  type ParseResult,
  type PassageIR,
  type Span,
  type ValueCallableBodyIR,
} from '@gneh/core';
import { offsetToPosition } from '@gneh/source';
import { effectBindings, namespacePassage } from './namespace.js';

const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function vlq(value: number): string {
  let x = value < 0 ? (-value << 1) | 1 : value << 1;
  let out = '';
  do {
    let d = x & 31;
    x >>>= 5;
    if (x) d |= 32;
    out += chars[d];
  } while (x);
  return out;
}

export interface ModuleOutput {
  code: string;
  declarations: string;
  map: Record<string, unknown>;
}

function runtimePassage(
  input: PassageIR,
  id: string,
  passageIds: ReadonlyMap<string, string>,
  inheritedNames: ReadonlySet<string>,
): string {
  const passage = namespacePassage(input, passageIds, inheritedNames);
  const sourceOwners = new WeakSet<object>();
  const spanOwners = new WeakSet<object>();
  const markExpression = (expression: object) => {
    sourceOwners.add(expression);
    spanOwners.add(expression);
  };
  function markCallable(callable: CallableIR): void {
    sourceOwners.add(callable);
    spanOwners.add(callable);
    if (callable.phase === 'view') markNodes(callable.body as PassageIR['body']);
    else if (callable.phase === 'effect') markEffects(callable.body as EffectNode[]);
    else {
      const body = callable.body as ValueCallableBodyIR;
      markEffects(body.effects);
      markExpression(body.result);
    }
  }
  function markCall(call: import('@gneh/core').CallableCallIR): void {
    for (const argument of call.args) markExpression(argument);
    if (call.callee.type === 'expression') markExpression(call.callee.expression);
    else if (call.callee.type === 'inline') markCallable(call.callee.callable);
  }
  function markEffects(effects: EffectNode[]): void {
    for (const effect of effects) {
      if (effect.type === 'assign-callable' || effect.type === 'publish-callable') markCallable(effect.callable);
      else if (effect.type === 'call') markCall(effect.call);
      else if (effect.type === 'if') {
        markEffects(effect.yes);
        markEffects(effect.no);
      } else if (effect.type === 'each') markEffects(effect.body);
    }
  }
  function markNodes(nodes: PassageIR['body']): void {
    for (const node of nodes) {
      spanOwners.add(node);
      if (node.type === 'value') markExpression(node.expression);
      else if (node.type === 'suspend') {
        if (node.resume.type === 'timer') markExpression(node.resume.durationMs);
        else if (node.resume.type === 'signal' && node.resume.filter) markExpression(node.resume.filter);
        else if (node.resume.type === 'task') for (const argument of node.resume.args) markExpression(argument);
      } else if (node.type === 'if') {
        markExpression(node.test);
        markNodes(node.yes);
        markNodes(node.no);
      } else if (node.type === 'each') {
        markExpression(node.items);
        if (node.key) markExpression(node.key);
        markNodes(node.children);
      } else if (node.type === 'include') {
        if (node.props) markExpression(node.props);
      } else if (node.type === 'choice') {
        if (node.props) markExpression(node.props);
        markNodes(node.children);
      } else if (node.type === 'call') {
        markCall(node.call);
        markNodes(node.children);
      } else if (node.type === 'callable') {
        markCallable(node.callable);
      } else if (node.type === 'invoke') {
        for (const argument of node.args) markExpression(argument);
        markNodes(node.children);
      } else if (node.type === 'control') {
        markCall(node.action);
        markExpression(node.value);
        for (const option of node.options) markExpression(option);
        markNodes(node.label);
      } else if (node.type === 'extension') {
        for (const expression of Object.values(node.bindings)) markExpression(expression);
        markNodes(node.children);
      } else {
        if (node.type === 'effect') markEffects(node.effects);
        if (node.type === 'button') markCall(node.action);
        if ('children' in node) markNodes(node.children);
        if (node.type === 'interaction') markNodes(node.label);
      }
    }
  }
  markNodes(passage.body);
  for (const expression of Object.values(passage.constants)) markExpression(expression);
  const { name: _name, dialect: _dialect, source: _source, span: _span, ...runtime } = passage;
  return JSON.stringify({ ...runtime, id }, function (key, value) {
    if (key === 'source' && sourceOwners.has(this)) return undefined;
    if (key === 'span' && spanOwners.has(this) && value && typeof value === 'object') return { start: value.start };
    return value;
  });
}

/** A file is one ESM namespace whose default export is a typed PassageSet. */
export function generateModule(
  result: ParseResult,
  source = '',
  file = 'story.inkdown',
  options: {
    namespace?: string;
  } = {},
): ModuleOutput {
  const passages = result.passages;
  const passageIds = new Map(
    passages.map((passage) => [passage.id, options.namespace ? `${options.namespace}#${passage.id}` : passage.id]),
  );
  const module = result.module ?? { metadata: {}, imports: [], exports: [], setup: [] };
  const imports = module.imports.filter(
    (value, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.source === value.source && candidate.imported === value.imported && candidate.local === value.local,
      ) === index,
  );
  const importNames = imports.map((value) => value.local);
  const moduleNames = new Set(importNames);
  for (const node of module.primary?.body ?? []) {
    if (node.type === 'callable' && node.callable.name) moduleNames.add(node.callable.name);
    else if (node.type === 'effect') effectBindings(node.effects).forEach((name) => moduleNames.add(name));
  }
  if (
    importNames.some((x) => ['passages', '__gneh', '__bindings', '__primary'].includes(x) || /^__(?:ir|p)\d+$/.test(x))
  )
    throw new GnehError('MODULE_RESERVED', 'The import name is reserved by generated module linkage.');
  const code: string[] = [
    '// Generated by gneh 0.1.0. Source dialect does not affect the Fragment ABI.',
    ...imports.map((value) =>
      value.imported === '*'
        ? `import * as ${value.local} from ${JSON.stringify(value.source)};`
        : `import { ${value.imported}${value.imported === value.local ? '' : ` as ${value.local}`} } from ${JSON.stringify(value.source)};`,
    ),
    'import { defineIRFragment as __gneh, definePassages as __sets, initializeModule as __init } from "@gneh/runtime";',
  ];
  const mapping: {
    line: number;
    span: Span;
  }[] = [];
  if (importNames.some((name) => passages.some((p) => p.id === name)))
    throw new GnehError(
      'MODULE_SHADOW',
      'A local passage id cannot shadow an ESM binding. Rename the import alias or passage id.',
    );
  const bindings = '__primary';
  code.push(
    `const __bindings = {${importNames.map((name) => `get ${JSON.stringify(name)}(){ return ${name}; }`).join(',')}};`,
  );
  const exported = module.exports.filter(
    (value, index, all) =>
      all.findIndex((candidate) => candidate.local === value.local && candidate.exported === value.exported) === index,
  );
  const exportedNames = new Set<string>();
  for (const item of exported) {
    if (!/^[A-Za-z_$][\w$]*$/.test(item.local) || !/^[A-Za-z_$][\w$]*$/.test(item.exported))
      throw new GnehError('EXPORT_BINDING', `Invalid ESM export ${item.local} as ${item.exported}.`);
    if (item.exported === 'default' || exportedNames.has(item.exported))
      throw new GnehError('EXPORT_CONFLICT', `Duplicate or reserved ESM export: ${item.exported}`);
    exportedNames.add(item.exported);
  }
  for (const local of new Set(exported.map((item) => item.local))) code.push(`let ${local};`);
  if (module.primary)
    code.push(`const __primaryIR = ${runtimePassage(module.primary, 'primary', passageIds, new Set(importNames))};`);
  const cells = [...new Set(exported.map((item) => item.local))]
    .map((name) => `${JSON.stringify(name)}:{get:()=>${name},set:next=>${name}=next}`)
    .join(',');
  code.push(`const __primary = __init(${module.primary ? '__primaryIR' : 'undefined'}, __bindings, {${cells}});`);
  for (let i = 0; i < passages.length; i++) {
    const p = passages[i];
    code.push(`const __ir${i} = ${runtimePassage(p, passageIds.get(p.id)!, passageIds, moduleNames)};`);
    mapping.push({ line: code.join('\n').split('\n').length, span: p.span });
    code.push(`const __p${i} = __gneh(__ir${i}, {bindings:${bindings}});`);
  }
  code.push(
    `const passages = __sets({passages:{${passages.map((p, i) => `${JSON.stringify(options.namespace ? options.namespace + '#' + p.id : p.id)}:__p${i}`).join(',')}},setup:${JSON.stringify(module.setup.map((id) => (options.namespace ? options.namespace + '#' + id : id)))}});`,
  );
  code.push('Object.assign(__bindings, passages);');
  if (exported.length)
    code.push(
      `export { ${exported.map((item) => (item.local === item.exported ? item.local : `${item.local} as ${item.exported}`)).join(', ')} };`,
    );
  code.push('export default passages;');
  const generated = code.join('\n') + '\n';
  const mapLines = generated.split('\n').map(() => '');
  let previousLine = 0,
    previousColumn = 0;
  for (const m of mapping) {
    const pos = offsetToPosition(source, m.span.start);
    mapLines[m.line] = vlq(0) + vlq(0) + vlq(pos.line - previousLine) + vlq(pos.character - previousColumn);
    previousLine = pos.line;
    previousColumn = pos.character;
  }
  const declarations =
    [
      'import type { Passage, PassageSet } from "@gneh/runtime";',
      ...exported.map((item) => `declare let ${item.local}: unknown;`),
      ...(exported.length
        ? [
            `export { ${exported.map((item) => (item.local === item.exported ? item.local : `${item.local} as ${item.exported}`)).join(', ')} };`,
          ]
        : []),
      `declare const passages: PassageSet & {${passages.map((p) => `readonly ${JSON.stringify(options.namespace ? options.namespace + '#' + p.id : p.id)}: Passage`).join(';')}};`,
      'export default passages;',
    ].join('\n') + '\n';
  return {
    code: generated,
    declarations,
    map: {
      version: 3,
      file: file.replace(/\.[^.]+$/, '.mjs'),
      sources: [file],
      sourcesContent: [source],
      names: [],
      mappings: mapLines.join(';'),
    },
  };
}
