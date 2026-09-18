/** Source parsing and whole-project semantic validation. */
import {
  ABI_VERSION,
  GnehError,
  assertJson,
  type CompileResult,
  type Diagnostic,
  type Dialect,
  type Expr,
  type Metadata,
  type ParseResult,
  type PassageIR,
  type Span,
  type State,
  type Statement,
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
    resolvePassageExpressions(passage);
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

function resolveExpression(expr: Expr, lexical: ReadonlySet<string>, bindings: ReadonlySet<string>): void {
  if (expr.type === 'reference') {
    if (expr.namespace === 'lexical' && !lexical.has(expr.name) && bindings.has(expr.name)) expr.namespace = 'binding';
    return;
  }
  if (expr.type === 'literal') return;
  if (expr.type === 'array') expr.items.forEach((item) => resolveExpression(item, lexical, bindings));
  else if (expr.type === 'object') expr.entries.forEach(([, value]) => resolveExpression(value, lexical, bindings));
  else if (expr.type === 'unary' || expr.type === 'chain') resolveExpression(expr.value, lexical, bindings);
  else if (expr.type === 'binary') {
    resolveExpression(expr.left, lexical, bindings);
    resolveExpression(expr.right, lexical, bindings);
  } else if (expr.type === 'conditional') {
    resolveExpression(expr.test, lexical, bindings);
    resolveExpression(expr.yes, lexical, bindings);
    resolveExpression(expr.no, lexical, bindings);
  } else if (expr.type === 'get') {
    resolveExpression(expr.object, lexical, bindings);
    resolveExpression(expr.key, lexical, bindings);
  } else if (expr.type === 'call') {
    resolveExpression(expr.callee, lexical, bindings);
    expr.args.forEach((argument) => resolveExpression(argument, lexical, bindings));
  } else if (expr.type === 'arrow') {
    resolveExpression(expr.body, new Set([...lexical, ...expr.params]), bindings);
  } else if (expr.type === 'template')
    expr.parts.forEach((part) => {
      if (typeof part !== 'string') resolveExpression(part, lexical, bindings);
    });
}

function resolveStatements(
  statements: Statement[],
  inherited: ReadonlySet<string>,
  bindings: ReadonlySet<string>,
): void {
  const lexical = new Set(inherited);
  for (const statement of statements) {
    if (statement.type === 'assign') {
      resolveExpression(statement.target, lexical, bindings);
      resolveExpression(statement.value, lexical, bindings);
    } else if (statement.type === 'declare') {
      resolveExpression(statement.value, lexical, bindings);
      lexical.add(statement.name);
    } else if (statement.type === 'call') resolveExpression(statement.expression, lexical, bindings);
    else if (statement.type === 'if') {
      resolveExpression(statement.test, lexical, bindings);
      resolveStatements(statement.yes, lexical, bindings);
      resolveStatements(statement.no, lexical, bindings);
    } else {
      resolveExpression(statement.items, lexical, bindings);
      resolveStatements(statement.body, new Set([...lexical, statement.name]), bindings);
    }
  }
}

export function resolvePassageExpressions(passage: PassageIR): void {
  const params = Array.isArray(passage.metadata.params)
    ? passage.metadata.params.filter((name): name is string => typeof name === 'string')
    : [];
  const base = new Set([...params, 'props', 'index', '_index']);
  const bindings = new Set([
    ...passage.imports,
    'navigate',
    'host',
    'prompt',
    'saveGame',
    'loadGame',
    'savedGames',
    'history',
  ]);
  resolveStatements(passage.enter, base, bindings);
  for (const action of Object.values(passage.actions))
    resolveStatements(action.statements, new Set([...base, 'value']), bindings);
  const visit = (nodes: StoryNode[], lexical: ReadonlySet<string>) => {
    for (const node of nodes) {
      if (node.type === 'value') resolveExpression(node.expression.ast, lexical, bindings);
      else if (node.type === 'if') {
        resolveExpression(node.test.ast, lexical, bindings);
        visit(node.yes, lexical);
        visit(node.no, lexical);
      } else if (node.type === 'each') {
        resolveExpression(node.items.ast, lexical, bindings);
        const child = new Set([...lexical, node.name, 'index', '_index']);
        if (node.key) resolveExpression(node.key.ast, child, bindings);
        visit(node.children, child);
      } else if (node.type === 'include' || node.type === 'choice') {
        if (node.props) resolveExpression(node.props.ast, lexical, bindings);
        if (node.type === 'choice') visit(node.children, lexical);
      } else if (node.type === 'extension') {
        Object.values(node.bindings).forEach((value) => resolveExpression(value.ast, lexical, bindings));
        visit(node.children, lexical);
      } else if (node.type === 'invoke') {
        node.args.forEach((value) => resolveExpression(value.ast, lexical, bindings));
        visit(node.children, lexical);
      } else if (node.type === 'control') {
        resolveExpression(node.value.ast, lexical, bindings);
        node.options.forEach((value) => resolveExpression(value.ast, lexical, bindings));
        visit(node.label, lexical);
      } else if (node.type === 'interaction') {
        visit(node.label, lexical);
        visit(node.children, lexical);
      } else if ('children' in node) visit(node.children, lexical);
    }
  };
  visit(passage.body, base);
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
    resolvePassageExpressions(p);
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
          if (Array.isArray(params) && params.length && (!n.props || n.props.ast.type === 'object')) {
            const provided = n.props?.ast.type === 'object' ? n.props.ast.entries.map(([k]) => k) : [];
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
