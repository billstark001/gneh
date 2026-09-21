import type { Metadata } from '@gneh/core';
import { metadataFailure, parseMetadata, sourceLines } from './metadata.js';

export interface SourceImport {
  source: string;
  imported: string;
  local: string;
}

export interface SourceExport {
  local: string;
  exported: string;
}

export interface SourceLinkage {
  imports: SourceImport[];
  exports: SourceExport[];
  setup: string[];
}

const reservedBindings = new Set([
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'let',
  'new',
  'null',
  'return',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
]);

const esmName = (value: string) => /^[A-Za-z_$][\w$]*$/.test(value) && !reservedBindings.has(value);
const sourceBinding = (value: string) => /^[A-Za-z][\w$]*$/.test(value) && !reservedBindings.has(value);

export function frontMatter(text: string): { metadata: Metadata; body: string; removed: number } {
  let effective = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (effective < text.length) {
    const whitespace = /^[ \t\r\n]+/.exec(text.slice(effective));
    if (whitespace) effective += whitespace[0].length;
    if (text.startsWith('<!--', effective)) {
      const end = text.indexOf('-->', effective + 4);
      if (end < 0) metadataFailure('Unclosed comment before file metadata.');
      effective = end + 3;
      continue;
    }
    break;
  }
  const lines = sourceLines(text.slice(effective));
  if (!lines.length || lines[0].text.trim() !== '---') return { metadata: {}, body: text, removed: 0 };
  let end = 1;
  while (end < lines.length && !/^(?:---|\.\.\.)\s*$/.test(lines[end].text)) end++;
  if (end === lines.length) metadataFailure('Unclosed metadata block.');
  const removed = effective + lines[end].end;
  return {
    metadata: parseMetadata(text.slice(effective + lines[0].end, effective + lines[end].start)),
    body: text.slice(removed),
    removed,
  };
}

export function moduleLinkage(metadata: Metadata): { metadata: Metadata; linkage: SourceLinkage } {
  const moduleMetadata = metadata.metadata;
  if (
    moduleMetadata !== undefined &&
    (moduleMetadata === null || Array.isArray(moduleMetadata) || typeof moduleMetadata !== 'object')
  )
    metadataFailure('metadata must be a mapping.');
  const imports: SourceImport[] = [];
  const rawImports = metadata.imports;
  if (rawImports !== undefined) {
    if (!rawImports || Array.isArray(rawImports) || typeof rawImports !== 'object')
      metadataFailure('imports must be a mapping.');
    for (const [source, specifiers] of Object.entries(rawImports)) {
      if (typeof specifiers === 'string') imports.push({ source, imported: 'default', local: specifiers });
      else if (Array.isArray(specifiers)) {
        for (const name of specifiers) {
          if (typeof name !== 'string') metadataFailure(`Import list for ${source} must contain names.`);
          imports.push({ source, imported: name, local: name });
        }
      } else if (specifiers && typeof specifiers === 'object') {
        const entries = Object.entries(specifiers);
        if (entries.some(([name]) => name === '*') && entries.length !== 1)
          metadataFailure(`Namespace import ${source} cannot be combined with other imports.`);
        for (const [imported, localValue] of entries) {
          if (typeof localValue !== 'string') metadataFailure(`Import alias for ${source}:${imported} must be a name.`);
          imports.push({ source, imported, local: localValue === '=' ? imported : localValue });
        }
      } else metadataFailure(`Invalid import entry for ${source}.`);
    }
  }
  const exports: SourceExport[] = [];
  const rawExports = metadata.exports;
  if (rawExports !== undefined) {
    if (Array.isArray(rawExports)) {
      for (const name of rawExports) {
        if (typeof name !== 'string') metadataFailure('exports lists local binding names.');
        exports.push({ local: name, exported: name });
      }
    } else if (rawExports && typeof rawExports === 'object') {
      for (const [local, exported] of Object.entries(rawExports)) {
        if (typeof exported !== 'string') metadataFailure(`Export alias for ${local} must be a name.`);
        exports.push({ local, exported });
      }
    } else metadataFailure('exports must be a list or mapping.');
  }
  if (exports.some((item) => item.exported === 'default')) metadataFailure('The default export is compiler-owned.');
  const setup = metadata.setup ?? [];
  if (!Array.isArray(setup) || setup.some((name) => typeof name !== 'string'))
    metadataFailure('setup must be a list of canonical passage IDs.');
  const allowed = new Set(['metadata', 'imports', 'exports', 'setup']);
  for (const key of Object.keys(metadata))
    if (!allowed.has(key)) metadataFailure(`Unknown file metadata field: ${key}`);
  const importLocals = new Set<string>();
  for (const item of imports) {
    if (!sourceBinding(item.local)) metadataFailure(`Invalid source import binding: ${item.local}`);
    if (item.imported !== '*' && item.imported !== 'default' && !esmName(item.imported))
      metadataFailure(`Invalid imported ESM name: ${item.imported}`);
    if (importLocals.has(item.local)) metadataFailure(`Duplicate source import binding: ${item.local}`);
    importLocals.add(item.local);
  }
  const exportNames = new Set<string>();
  for (const item of exports) {
    if (!esmName(item.local) || !esmName(item.exported))
      metadataFailure(`Invalid ESM export ${item.local} as ${item.exported}.`);
    if (exportNames.has(item.exported)) metadataFailure(`Duplicate ESM export name: ${item.exported}`);
    exportNames.add(item.exported);
  }
  if (new Set(setup as string[]).size !== setup.length) metadataFailure('setup contains duplicate passage IDs.');
  return {
    metadata: (moduleMetadata as Metadata | undefined) ?? {},
    linkage: { imports, exports, setup: setup as string[] },
  };
}
