/** JSON-compatible metadata profile (deliberately smaller than YAML). */
import { GnehError, assertJson, safeKey, type Json, type Metadata } from '@gneh/core';

export interface SourceLine {
  text: string;
  start: number;
  end: number;
}

export function sourceLines(source: string): SourceLine[] {
  const out: SourceLine[] = [];
  let start = 0;
  for (const part of source.split(/(?<=\n)/)) {
    out.push({ text: part.replace(/\r?\n$/, ''), start, end: start + part.length });
    start += part.length;
  }
  return out;
}

export function metadataFailure(message: string): never {
  throw new GnehError('META_SYNTAX', message);
}

function splitFlow(source: string, separator = ','): string[] {
  const parts: string[] = [];
  let start = 0,
    depth = 0,
    quote = '';
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === '\\' && quote === '"') i++;
      else if (c === quote) {
        if (quote === "'" && source[i + 1] === "'") i++;
        else quote = '';
      }
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === '[' || c === '{') depth++;
    if (c === ']' || c === '}') depth--;
    if (c === separator && depth === 0) {
      parts.push(source.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (quote || depth !== 0) metadataFailure('Unclosed flow collection or quote.');
  parts.push(source.slice(start).trim());
  return parts;
}

function mappingPair(source: string): [string, string] {
  let quote = '',
    depth = 0;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === '[' || c === '{') depth++;
    if (c === ']' || c === '}') depth--;
    if (c === ':' && depth === 0) {
      const raw = source.slice(0, i).trim();
      const key = raw.startsWith('"')
        ? JSON.parse(raw)
        : raw.startsWith("'")
          ? raw.slice(1, -1).replaceAll("''", "'")
          : raw;
      return [safeKey(key), source.slice(i + 1).trim()];
    }
  }
  return metadataFailure(`Expected a metadata key/value pair: ${source}`);
}

function scalar(source: string): Json {
  const s = source.trim();
  if (!s) return null;
  if (s.startsWith('"')) {
    try {
      return JSON.parse(s) as Json;
    } catch {
      return metadataFailure(`Invalid quoted string: ${s}`);
    }
  }
  if (s.startsWith("'")) {
    if (!s.endsWith("'")) metadataFailure('Unclosed single-quoted string.');
    return s.slice(1, -1).replaceAll("''", "'");
  }
  if (s.startsWith('[')) {
    if (!s.endsWith(']')) metadataFailure('Unclosed array.');
    return s === '[]' ? [] : splitFlow(s.slice(1, -1)).map(scalar);
  }
  if (s.startsWith('{')) {
    if (!s.endsWith('}')) metadataFailure('Unclosed object.');
    const o: Metadata = {};
    if (s !== '{}')
      for (const item of splitFlow(s.slice(1, -1))) {
        const [k, v] = mappingPair(item);
        if (Object.hasOwn(o, k)) metadataFailure(`Duplicate key: ${k}`);
        o[k] = scalar(v);
      }
    return o;
  }
  const value = s.replace(/\s+#.*$/, '').trim();
  if (value === 'null' || value === '~') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) {
    const n = Number(value);
    if (!Number.isFinite(n)) metadataFailure('Non-finite metadata number.');
    return n;
  }
  if (/^[&*!]|^(?:\.nan|[-+]?\.inf)$/i.test(value))
    metadataFailure(
      'YAML aliases, tags, anchors and non-finite values are outside the JSON-compatible metadata profile.',
    );
  return value;
}

/** JSON-compatible YAML profile: maps, lists, flow collections, scalars, | and >.
 * Not a general YAML loader: tags, aliases and implicit dates are deliberately excluded. */
export function parseMetadata(source: string): Metadata {
  const ls = sourceLines(source);
  let i = 0;
  const indent = (l: SourceLine) => {
    if (/^\s*\t/.test(l.text)) metadataFailure('Use spaces, not tabs, for metadata indentation.');
    return l.text.length - l.text.trimStart().length;
  };
  const skip = () => {
    while (i < ls.length && (!ls[i].text.trim() || ls[i].text.trimStart().startsWith('#'))) i++;
  };
  function block(level: number): Json {
    skip();
    const sequence = ls[i]?.text.trimStart().startsWith('- ');
    const out: Json[] | Metadata = sequence ? [] : {};
    while (i < ls.length) {
      skip();
      if (i >= ls.length || indent(ls[i]) < level) break;
      if (indent(ls[i]) !== level) metadataFailure(`Unexpected indentation on metadata line ${i + 1}`);
      const text = ls[i].text.trim();
      i++;
      if (sequence) {
        if (!text.startsWith('- ')) metadataFailure('Cannot mix mapping and sequence entries.');
        const value = text.slice(2).trim();
        (out as Json[]).push(value ? scalar(value) : block(level + 2));
        continue;
      }
      const [key, value] = mappingPair(text);
      if (Object.hasOwn(out, key)) metadataFailure(`Duplicate metadata key: ${key}`);
      let result: Json;
      if (value === '|' || value === '>' || value === '|-') {
        const chunks: string[] = [];
        while (i < ls.length && (!ls[i].text.trim() || indent(ls[i]) > level)) {
          chunks.push(ls[i++].text.slice(level + 2));
        }
        result = chunks.join(value === '>' ? ' ' : '\n') + (value === '|-' ? '' : '\n');
      } else if (value) result = scalar(value);
      else {
        skip();
        result = i < ls.length && indent(ls[i]) > level ? block(indent(ls[i])) : null;
      }
      (out as Metadata)[key] = result;
    }
    return out;
  }
  skip();
  if (i === ls.length) return {};
  const value = block(indent(ls[i]));
  if (Array.isArray(value) || value === null || typeof value !== 'object')
    metadataFailure('Front matter must be a mapping.');
  assertJson(value);
  return value as Metadata;
}

export function mergeMetadata(...values: Metadata[]): Metadata {
  const result: Metadata = {};
  for (const object of values)
    for (const [key, value] of Object.entries(object)) {
      safeKey(key);
      assertJson(value);
      const old = result[key];
      if (key === 'tags' && Array.isArray(value)) {
        result[key] = [...new Set([...(Array.isArray(old) ? old : []), ...value].map(String))];
      } else if (
        value !== null &&
        !Array.isArray(value) &&
        typeof value === 'object' &&
        old !== null &&
        !Array.isArray(old) &&
        typeof old === 'object'
      )
        result[key] = mergeMetadata(old as Metadata, value as Metadata);
      else result[key] = structuredClone(value);
    }
  return result;
}
