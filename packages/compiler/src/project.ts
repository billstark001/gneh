/** Source parsing and whole-project semantic validation. */
import {
  ABI_VERSION,
  GnehError,
  assertJson,
  type CompileResult,
  type Diagnostic,
  type Dialect,
  type Metadata,
  type ParseResult,
  type PassageIR,
  type Span,
  type State,
  type StoryNode,
} from '@gneh/core';
import { mergeMetadata, splitPassages } from '@gneh/source';
import { parseInkdown, type InkdownLowerings } from '@gneh/inkdown';
import { parseKarlowe, type KarloweLowerings } from '@gneh/karlowe';
import { parseSugarcast, type SugarcastLowerings } from '@gneh/sugarcast';

export interface SourceInput {
  path: string;
  source: string;
  dialect?: Dialect;
}

export interface DialectLowerings {
  inkdown?: InkdownLowerings;
  karlowe?: KarloweLowerings;
  sugarcast?: SugarcastLowerings;
}

export interface CompileOptions {
  entry?: string;
  state?: State;
  live?: boolean;
  mode?: 'esm' | 'vendor';
  metadata?: Metadata;
  /** Caller-owned CST-to-IR lowerings, reused across every matching source file. */
  lowerings?: DialectLowerings;
  /** Runtime extension IDs that the application promises to install. */
  runtimeExtensionIds?: readonly string[];
}

export function detectDialect(file: string, fallback: Dialect = 'inkdown'): Dialect {
  return /\.karlowe$/i.test(file) ? 'karlowe' : /\.(?:sugarcast|sugar)$/i.test(file) ? 'sugarcast' : fallback;
}

export function parseSource(
  source: string,
  file = 'story.inkdown',
  dialect?: Dialect,
  options: { lowerings?: DialectLowerings } = {},
): ParseResult {
  const header = splitPassages(source, file);
  const configured = header.metadata.dialect;
  const selected =
    dialect ??
    (configured === 'inkdown' || configured === 'karlowe' || configured === 'sugarcast'
      ? configured
      : detectDialect(file));
  const parsed =
    selected === 'inkdown'
      ? parseInkdown(source, file, { lowerings: options.lowerings?.inkdown })
      : selected === 'karlowe'
        ? parseKarlowe(source, file, { lowerings: options.lowerings?.karlowe })
        : parseSugarcast(source, file, { lowerings: options.lowerings?.sugarcast });
  const fileBindings = new Set(parsed.passages.flatMap((passage) => passage.imports));
  for (const passage of parsed.passages) {
    passage.imports = [...fileBindings];
  }
  return parsed;
}

export function walkNodes(nodes: StoryNode[], fn: (node: StoryNode) => void): void {
  for (const n of nodes) {
    fn(n);
    if (n.type === 'if') {
      walkNodes(n.yes, fn);
      walkNodes(n.no, fn);
    } else {
      if ('children' in n) walkNodes(n.children, fn);
      if (n.type === 'interaction') walkNodes(n.label, fn);
      if (n.type === 'control') walkNodes(n.label, fn);
    }
  }
}

export function compileProject(sources: SourceInput[], options: CompileOptions = {}): CompileResult {
  const passages: PassageIR[] = [],
    diagnostics: Diagnostic[] = [];
  let metadata = options.metadata ?? {};
  for (const input of sources) {
    const parsed = parseSource(input.source, input.path, input.dialect, {
      lowerings: options.lowerings,
    });
    diagnostics.push(...parsed.diagnostics);
    for (const p of parsed.passages) {
      if (p.name === 'StoryTitle') {
        metadata = mergeMetadata(metadata, { title: p.source.trim() });
        continue;
      }
      if (p.name === 'StoryData') {
        try {
          const data: unknown = JSON.parse(p.source);
          assertJson(data);
          if (data === null || Array.isArray(data) || typeof data !== 'object')
            throw new Error('StoryData must contain an object');
          metadata = mergeMetadata(metadata, data);
        } catch (e) {
          diagnostics.push({
            code: 'STORY_DATA',
            severity: 'error',
            message: (e as Error).message,
            span: p.span,
          });
        }
        continue;
      }
      passages.push(p);
    }
  }
  const ids = new Map<string, PassageIR>(),
    aliases = new Map<string, string>();
  const error = (code: string, message: string, span: Span, hint?: string) =>
    diagnostics.push({ code, severity: 'error', message, span, hint });
  for (const p of passages) {
    if (ids.has(p.id)) error('DUPLICATE_ID', `Duplicate passage id: ${p.id}`, p.span);
    ids.set(p.id, p);
    if (aliases.has(p.name) && aliases.get(p.name) !== p.id) aliases.set(p.name, '');
    else aliases.set(p.name, p.id);
  }
  const fileBindings = new Map<string, Set<string>>();
  for (const p of passages) {
    const set = fileBindings.get(p.span.file) ?? new Set<string>();
    p.imports.forEach((x) => set.add(x));
    fileBindings.set(p.span.file, set);
  }
  for (const p of passages) {
    p.imports = [...(fileBindings.get(p.span.file) ?? [])];
    if (options.mode === 'vendor' && p.module.trim())
      error(
        'VENDOR_MODULE',
        `@module in ${p.id} requires an ESM/Vite build. Data mode never evaluates module source.`,
        p.span,
      );
    if (options.live === false && p.capabilities.includes('live'))
      error(
        'CAPABILITY_LIVE',
        `${p.id} uses buttons or mutable regions but the snapshot context was selected.`,
        p.span,
      );
    walkNodes(p.body, (n) => {
      if (n.type === 'choice' || n.type === 'include') {
        const dest = ids.get(n.target) ?? ids.get(aliases.get(n.target) ?? '');
        if (!dest && !p.imports.includes(n.target))
          error(
            'PASSAGE_MISSING',
            `Unknown or ambiguous fragment ${JSON.stringify(n.target)} referenced by ${p.id}.`,
            n.span,
            'Import a JS/ESM fragment or declare a passage with this id.',
          );
        if (dest) {
          n.target = dest.id;
          const params = dest.metadata.params;
          if (Array.isArray(params) && params.length && (!n.props || n.props.ast.type === 'ObjectExpression')) {
            const provided =
              n.props?.ast.type === 'ObjectExpression'
                ? n.props.ast.properties.flatMap((property) =>
                    property.type === 'Property' && !property.computed
                      ? property.key.type === 'Identifier'
                        ? [property.key.name]
                        : property.key.type === 'Literal'
                          ? [String(property.key.value)]
                          : []
                      : [],
                  )
                : [];
            const optional = Array.isArray(dest.metadata.optionalParams) ? dest.metadata.optionalParams : [];
            for (const param of params)
              if (typeof param === 'string' && !provided.includes(param) && !optional.includes(param))
                error('PROPS_MISSING', `${n.target} requires prop ${param}.`, n.span);
          }
        }
      }
      if ((n.type === 'button' || n.type === 'control') && !p.actions[n.action])
        error('ACTION_MISSING', `Unknown action: ${n.action}`, n.span);
      if (n.type === 'invoke' && !(options.runtimeExtensionIds ?? []).includes(n.id))
        error(
          'RUNTIME_EXTENSION_UNDECLARED',
          `Runtime extension ${JSON.stringify(n.id)} is not declared by the build configuration.`,
          n.span,
          'Add the extension ID to compileOptions.runtimeExtensionIds and install the same implementation in StoryOptions.runtimeExtensions.',
        );
      if (n.type === 'each' && !n.key)
        diagnostics.push({
          code: 'LOOP_KEY',
          severity: 'warning',
          message:
            'Loop identity uses item.id when present, otherwise its index. Supply ; key ... when order can change.',
          span: n.span,
        });
    });
  }
  let entry =
    options.entry ??
    (typeof metadata.start === 'string' ? metadata.start : undefined) ??
    passages.find((p) => Array.isArray(p.metadata.tags) && p.metadata.tags.includes('start'))?.id ??
    (ids.has('Start') ? 'Start' : (passages[0]?.id ?? ''));
  entry = ids.has(entry) ? entry : (aliases.get(entry) ?? entry);
  if (!ids.has(entry) && passages.length)
    error('ENTRY_MISSING', `Entry passage does not exist: ${entry}`, passages[0].span);
  let state = options.state ?? {};
  if (!options.state) {
    const declared = passages.find((p) => p.metadata.state)?.metadata.state;
    if (declared && typeof declared === 'object' && !Array.isArray(declared)) state = declared as State;
  }
  assertJson(state);
  return { passages, diagnostics, story: { abi: ABI_VERSION, entry, state, metadata, passages } };
}

export function compileSource(
  source: string,
  file = 'story.inkdown',
  options: CompileOptions & {
    dialect?: Dialect;
  } = {},
): CompileResult {
  return compileProject([{ path: file, source, dialect: options.dialect }], options);
}

export function assertValid(result: ParseResult): void {
  const errors = result.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length)
    throw new GnehError(
      'COMPILE_ERRORS',
      errors.map((d) => `${d.span.file}:${d.span.start} ${d.code}: ${d.message}`).join('\n'),
    );
}
