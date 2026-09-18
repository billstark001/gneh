/** Twee 3 passage container parsing, emission and source positions. */
import { GnehError, assertJson, type Diagnostic, type Metadata, type ParsedPassage, type Span } from '@gneh/core';
import { mergeMetadata, metadataFailure, parseMetadata, sourceLines, type SourceLine } from './metadata.js';

export interface SourceFile {
  passages: ParsedPassage[];
  diagnostics: Diagnostic[];
  metadata: Metadata;
}

export interface Header {
  name: string;
  tags: string[];
  metadata: Metadata;
}

function unescapeHeaderName(value: string): string {
  return value.replace(/\\(.)/g, (match, character: string) => ('[]{}\\'.includes(character) ? character : match));
}

function escapeHeaderName(value: string): string {
  return [...value].map((character) => ('[]{}\\'.includes(character) ? '\\' + character : character)).join('');
}

export function parseHeader(line: string): Header {
  if (!line.startsWith('::') || line.startsWith(':::')) metadataFailure('Expected a Twee 3 passage header.');
  const text = line.slice(2).trim();
  let cut = text.length;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\') {
      i++;
      continue;
    }
    if (text[i] === '[' || text[i] === '{') {
      cut = i;
      break;
    }
  }
  const name = unescapeHeaderName(text.slice(0, cut).trim());
  if (!name) metadataFailure('Passage name cannot be empty.');
  let rest = text.slice(cut).trim();
  let tags: string[] = [];
  let metadata: Metadata = {};
  if (rest.startsWith('[')) {
    const end = rest.indexOf(']');
    if (end < 0) metadataFailure('Unclosed Twee tag list.');
    tags = rest.slice(1, end).trim().split(/\s+/).filter(Boolean);
    rest = rest.slice(end + 1).trim();
  }
  if (rest) {
    try {
      const value: unknown = JSON.parse(rest);
      if (!value || typeof value !== 'object' || Array.isArray(value))
        metadataFailure('Twee metadata must be a JSON object.');
      assertJson(value);
      metadata = value as Metadata;
    } catch (e) {
      if (e instanceof GnehError) throw e;
      metadataFailure(`Invalid Twee JSON metadata: ${(e as Error).message}`);
    }
  }
  return { name, tags, metadata };
}

function frontMatter(text: string): {
  metadata: Metadata;
  body: string;
  removed: number;
} {
  const ls = sourceLines(text);
  if (!ls.length || ls[0].text.replace(/^\uFEFF/, '').trim() !== '---') return { metadata: {}, body: text, removed: 0 };
  let end = 1;
  while (end < ls.length && !/^(?:---|\.\.\.)\s*$/.test(ls[end].text)) end++;
  if (end === ls.length) metadataFailure('Unclosed metadata block.');
  const removed = ls[end].end;
  return {
    metadata: parseMetadata(text.slice(ls[0].end, ls[end].start)),
    body: text.slice(removed),
    removed,
  };
}

/** Same container syntax for all three dialects. Header markers in fenced code stay text. */
export function splitPassages(source: string, file = 'story.inkdown'): SourceFile {
  const diagnostics: Diagnostic[] = [];
  const passages: ParsedPassage[] = [];
  let defaults: Metadata = {};
  let content = source;
  let base = 0;
  try {
    const f = frontMatter(source);
    defaults = f.metadata;
    content = f.body;
    base = f.removed;
  } catch (e) {
    diagnostics.push(diag(e, { file, start: 0, end: Math.min(source.length, 3) }));
    return { passages, diagnostics, metadata: {} };
  }
  const ls = sourceLines(content),
    headers: SourceLine[] = [];
  let fence = '',
    fenceLength = 0,
    inMeta = false,
    afterHeader = false;
  for (const line of ls) {
    const t = line.text;
    if (afterHeader && t === '---') {
      inMeta = true;
      afterHeader = false;
      continue;
    }
    if (inMeta) {
      if (/^(?:---|\.\.\.)\s*$/.test(t)) inMeta = false;
      continue;
    }
    const match = /^ {0,3}(`{3,}|~{3,})/.exec(t);
    if (match) {
      if (!fence) {
        fence = match[1][0];
        fenceLength = match[1].length;
      } else if (match[1][0] === fence && match[1].length >= fenceLength && /^ {0,3}(?:`+|~+)\s*$/.test(t)) fence = '';
      continue;
    }
    if (!fence && /^::(?!:)\s*\S/.test(t)) {
      headers.push(line);
      afterHeader = true;
    } else if (t.trim()) afterHeader = false;
  }
  function add(
    name: string,
    body: string,
    bodyStart: number,
    start: number,
    end: number,
    header: Metadata = {},
    tags: string[] = [],
  ): void {
    try {
      const f = frontMatter(body);
      const fileDefaults = { ...defaults };
      if (headers.length) delete fileDefaults.id;
      const metadata = mergeMetadata(fileDefaults, { tags }, header, f.metadata);
      const id = typeof metadata.id === 'string' ? metadata.id : name;
      if (!id.trim()) metadataFailure('Passage id cannot be empty.');
      metadata.id = id;
      metadata.name = name;
      if (!Array.isArray(metadata.tags)) metadataFailure('Metadata tags must be an array.');
      if (
        metadata.params !== undefined &&
        (!Array.isArray(metadata.params) || metadata.params.some((x) => typeof x !== 'string'))
      )
        metadataFailure('params must be an array of names.');
      passages.push({
        id,
        name,
        body: f.body,
        metadata,
        span: { file, start, end },
        bodyOffset: bodyStart + f.removed,
      });
    } catch (e) {
      diagnostics.push(diag(e, { file, start, end }));
    }
  }
  if (!headers.length) {
    const name =
      typeof defaults.id === 'string'
        ? defaults.id
        : file
            .replaceAll('\\', '/')
            .split('/')
            .pop()!
            .replace(/\.(?:inkdown|karlowe|sugarcast|md|twee|tw)$/i, '');
    add(name, content, base, 0, source.length);
  } else {
    if (content.slice(0, headers[0].start).trim())
      diagnostics.push({
        code: 'SOURCE_PREAMBLE',
        severity: 'warning',
        message: 'Text before the first passage header is ignored. Use file front matter for defaults.',
        span: { file, start: base, end: base + headers[0].start },
      });
    for (let i = 0; i < headers.length; i++) {
      const h = headers[i],
        end = headers[i + 1]?.start ?? content.length;
      try {
        const parsed = parseHeader(h.text);
        add(
          parsed.name,
          content.slice(h.end, end),
          base + h.end,
          base + h.start,
          base + end,
          parsed.metadata,
          parsed.tags,
        );
      } catch (e) {
        diagnostics.push(diag(e, { file, start: base + h.start, end: base + h.end }));
      }
    }
  }
  const ids = new Set<string>();
  for (const p of passages) {
    if (ids.has(p.id))
      diagnostics.push({
        code: 'DUPLICATE_ID',
        severity: 'error',
        message: `Duplicate passage id: ${p.id}`,
        span: p.span,
      });
    ids.add(p.id);
  }
  return { passages, diagnostics, metadata: defaults };
}

export function diag(error: unknown, span: Span): Diagnostic {
  return {
    code: error instanceof GnehError ? error.code : 'PARSE_ERROR',
    severity: 'error',
    message: error instanceof Error ? error.message : String(error),
    span: error instanceof GnehError && error.span ? error.span : span,
  };
}

export function metadataJSON(file: SourceFile): string {
  return JSON.stringify(Object.fromEntries(file.passages.map((p) => [p.id, p.metadata])), null, 2) + '\n';
}

export function emitTwee(passages: ParsedPassage[]): string {
  return passages
    .map((p) => {
      const metadata = { ...p.metadata };
      delete metadata.name;
      const tags = Array.isArray(metadata.tags) ? metadata.tags.map(String) : [];
      delete metadata.tags;
      const name = escapeHeaderName(p.name);
      return `:: ${name}${tags.length ? ' [' + tags.join(' ') + ']' : ''} ${JSON.stringify(metadata)}\n${p.body.trimEnd()}\n`;
    })
    .join('\n');
}

export function offsetToPosition(
  source: string,
  offset: number,
): {
  line: number;
  character: number;
} {
  const prefix = source.slice(0, offset);
  const line = (prefix.match(/\n/g) ?? []).length;
  return { line, character: offset - (prefix.lastIndexOf('\n') + 1) };
}
