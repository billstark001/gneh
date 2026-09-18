/** TypeScript-backed projections and cross-passage editor operations. */
import ts from 'typescript-language-service';
import { compileProject, printExpression, type SourceInput, type CompileOptions } from '@gneh/compiler';
import { splitPassages, offsetToPosition } from '@gneh/source';
import type { Diagnostic, Span, StoryNode } from '@gneh/core';
import { createVirtualFile, inferType, type VirtualFile } from './projection.js';

export interface TextEdit {
  span: Span;
  newText: string;
}

export interface Completion {
  label: string;
  detail?: string;
  insertText?: string;
  kind: 'variable' | 'property' | 'function' | 'reference' | 'keyword';
}

interface Document {
  source: string;
  version: number;
}

export interface ServiceOptions extends CompileOptions {
  stateTypes?: string;
}

function wordAt(
  source: string,
  offset: number,
): {
  word: string;
  start: number;
  end: number;
} {
  let start = offset,
    end = offset;
  while (start > 0 && /[\w$]/.test(source[start - 1])) start--;
  while (end < source.length && /[\w$]/.test(source[end])) end++;
  return { word: source.slice(start, end), start, end };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Shared by CLI checking and both LSP transports. No editor-specific global state. */
export class GnehLanguageService {
  readonly documents = new Map<string, Document>();
  private virtuals = new Map<string, VirtualFile>();
  private revision = 0;
  private cachedRevision = -1;
  private result = compileProject([]);
  private language: ts.LanguageService;
  constructor(public options: ServiceOptions = {}) {
    const settings: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      allowImportingTsExtensions: true,
    };
    const host: ts.LanguageServiceHost = {
      getCompilationSettings: () => settings,
      getScriptFileNames: () => [...this.virtuals.keys()],
      getScriptVersion: (file) => this.virtuals.get(file)?.version ?? '0',
      getScriptSnapshot: (file) => {
        const source = this.virtuals.get(file)?.code ?? ts.sys.readFile(file);
        return source === undefined ? undefined : ts.ScriptSnapshot.fromString(source);
      },
      getCurrentDirectory: () => ts.sys.getCurrentDirectory(),
      getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
      fileExists: (file) => this.virtuals.has(file) || ts.sys.fileExists(file),
      readFile: (file) => this.virtuals.get(file)?.code ?? ts.sys.readFile(file),
      readDirectory: ts.sys.readDirectory,
    };
    this.language = ts.createLanguageService(host);
  }
  setDocument(file: string, source: string, version?: number): void {
    this.documents.set(file, {
      source,
      version: version ?? (this.documents.get(file)?.version ?? 0) + 1,
    });
    this.revision++;
  }
  removeDocument(file: string): void {
    this.documents.delete(file);
    this.revision++;
  }
  configure(options: ServiceOptions): void {
    this.options = options;
    this.revision++;
  }
  private analyze(): void {
    if (this.cachedRevision === this.revision) return;
    const sources: SourceInput[] = [...this.documents].map(([path, document]) => ({
      path,
      source: document.source,
    }));
    this.result = compileProject(sources, this.options);
    this.virtuals.clear();
    for (const [file] of this.documents) {
      const passages = this.result.passages.filter((p) => p.span.file === file);
      if (!passages.length) continue;
      const virtual = createVirtualFile(passages, this.result.story.state, this.options.stateTypes);
      virtual.version = String(this.revision);
      this.virtuals.set(file + '.gneh.ts', virtual);
    }
    this.cachedRevision = this.revision;
  }
  diagnostics(file?: string): Diagnostic[] {
    this.analyze();
    const output = this.result.diagnostics.filter((d) => !file || d.span.file === file);
    for (const [name, virtual] of this.virtuals) {
      if (file && name !== file + '.gneh.ts') continue;
      for (const d of [...this.language.getSyntacticDiagnostics(name), ...this.language.getSemanticDiagnostics(name)]) {
        if (d.start === undefined) continue;
        const mapping = virtual.mappings
          .filter((m) => d.start! >= m.start && d.start! < m.end)
          .sort((a, b) => a.end - a.start - (b.end - b.start))[0];
        if (!mapping) continue;
        output.push({
          code: 'TS' + d.code,
          severity: d.category === ts.DiagnosticCategory.Warning ? 'warning' : 'error',
          message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
          span: mapping.source,
        });
      }
    }
    return output;
  }
  symbols(file: string): {
    name: string;
    span: Span;
    kind: 'fragment' | 'action';
  }[] {
    const parsed = splitPassages(this.documents.get(file)?.source ?? '', file);
    this.analyze();
    return parsed.passages.flatMap((p) => [
      { name: p.id, span: p.span, kind: 'fragment' as const },
      ...(this.result.passages.find((x) => x.id === p.id)?.actions
        ? Object.values(this.result.passages.find((x) => x.id === p.id)!.actions).map((a) => ({
            name: a.name,
            span: a.span,
            kind: 'action' as const,
          }))
        : []),
    ]);
  }
  private sourceOffset(
    file: string,
    offset: number,
  ):
    | {
        name: string;
        position: number;
      }
    | undefined {
    this.analyze();
    const name = file + '.gneh.ts',
      virtual = this.virtuals.get(name);
    if (!virtual) return;
    const selected = virtual.mappings
      .filter((m) => offset >= m.source.start && offset <= m.source.end)
      .sort((a, b) => a.source.end - a.source.start - (b.source.end - b.source.start))[0];
    if (!selected) return;
    const { word } = wordAt(this.documents.get(file)?.source ?? '', offset);
    const generated = virtual.code.slice(selected.start, selected.end);
    let position = selected.start;
    if (word) {
      const plain = word.startsWith('$') ? word.slice(1) : word;
      const match = new RegExp('\\b' + escapeRegex(plain) + '\\b').exec(generated);
      if (match) position += match.index + Math.max(1, plain.length - 1);
    }
    return { name, position };
  }
  hover(
    file: string,
    offset: number,
  ):
    | {
        contents: string;
        span: Span;
      }
    | undefined {
    const doc = this.documents.get(file);
    if (!doc) return;
    const word = wordAt(doc.source, offset);
    const location = this.sourceOffset(file, offset);
    if (location) {
      const info = this.language.getQuickInfoAtPosition(location.name, location.position);
      if (info)
        return {
          contents:
            '```typescript\n' +
            ts.displayPartsToString(info.displayParts) +
            '\n```\n' +
            ts.displayPartsToString(info.documentation),
          span: { file, start: word.start, end: word.end },
        };
    }
    this.analyze();
    const target = this.result.passages.find((p) => p.id === word.word || p.name === word.word);
    if (target)
      return {
        contents: `**${target.id}** · ${target.dialect}\n\n\`\`\`json\n${JSON.stringify(target.metadata, null, 2)}\n\`\`\``,
        span: { file, start: word.start, end: word.end },
      };
    return;
  }
  completions(file: string, offset: number): Completion[] {
    this.analyze();
    const source = this.documents.get(file)?.source ?? '',
      prefix = source.slice(0, offset);
    const variable = /\$([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*)?\.?$/.exec(prefix);
    if (variable) {
      const raw = prefix.slice(variable.index + 1),
        parts = raw.split('.');
      let object: unknown = this.result.story.state;
      for (const name of parts.slice(0, -1)) {
        if (!object || typeof object !== 'object') return [];
        object = (object as Record<string, unknown>)[name];
      }
      return object && typeof object === 'object'
        ? Object.entries(object)
            .filter(([k]) => k.startsWith(parts.at(-1) ?? ''))
            .map(([name, value]) => ({
              label: name,
              insertText: name,
              detail: inferType(value),
              kind: parts.length === 1 ? 'variable' : 'property',
            }))
        : [];
    }
    if (/(?:->|\[\[|\binclude\s+"|\bdisplay:\s*")[^\]\n]*$/.test(prefix))
      return this.result.passages.map((p) => ({
        label: p.id,
        detail: p.dialect + ' · ' + p.span.file,
        kind: 'reference',
      }));
    const location = this.sourceOffset(file, offset);
    if (location) {
      const entries =
        this.language.getCompletionsAtPosition(location.name, location.position, {
          includeCompletionsForModuleExports: false,
        })?.entries ?? [];
      if (entries.length)
        return entries.slice(0, 200).map((e) => ({
          label: e.name,
          kind: e.kind === 'function' ? 'function' : e.kind === 'property' ? 'property' : 'variable',
        }));
    }
    const dialect = file.endsWith('.karlowe') ? 'karlowe' : file.endsWith('.sugarcast') ? 'sugarcast' : 'inkdown';
    const words =
      dialect === 'karlowe'
        ? ['(if: )[]', '(set: $name to )', '(print: )', '(display: "")', '(link-goto: "", "")']
        : dialect === 'sugarcast'
          ? ['<<if >><</if>>', '<<set >>', '<<print >>', '<<include "">>', '<<button "">><</button>>']
          : [
              '@if () {\n\n}',
              '@for (const item of $items; key item.id) {\n\n}',
              '@action name {\n\n}',
              '@slot name {\n\n}',
              '{{ }}',
            ];
    return words.map((label) => ({ label, kind: 'keyword' }));
  }
  definition(file: string, offset: number): Span | undefined {
    this.analyze();
    const source = this.documents.get(file)?.source ?? '';
    const target =
      this.linkReferences().find((r) => r.span.file === file && offset >= r.span.start && offset <= r.span.end)
        ?.target ?? wordAt(source, offset).word;
    const passage = this.result.passages.find((p) => p.id === target || p.name === target);
    if (!passage) return;
    const document = this.documents.get(passage.span.file)?.source ?? '';
    const header = /^::\s*([^\n]+)/gm;
    let match: RegExpExecArray | null;
    while ((match = header.exec(document))) {
      const index = match[0].indexOf(passage.name);
      if (index >= 0 && match.index >= passage.span.start - 100 && match.index <= passage.span.start + 100)
        return {
          file: passage.span.file,
          start: match.index + index,
          end: match.index + index + passage.name.length,
        };
    }
    return passage.span;
  }
  /** Deliberately AST-based: text that merely mentions a name is never renamed. */
  private linkReferences(): {
    target: string;
    span: Span;
  }[] {
    this.analyze();
    const output: {
      target: string;
      span: Span;
    }[] = [];
    const walk = (nodes: StoryNode[]) => {
      for (const node of nodes) {
        if (node.type === 'include' || node.type === 'choice') {
          const source = this.documents.get(node.span.file)?.source ?? '',
            slice = source.slice(node.span.start, node.span.end);
          const index = slice.lastIndexOf(node.target);
          if (index >= 0)
            output.push({
              target: node.target,
              span: {
                file: node.span.file,
                start: node.span.start + index,
                end: node.span.start + index + node.target.length,
              },
            });
        }
        if (node.type === 'if') {
          walk(node.yes);
          walk(node.no);
        } else if ('children' in node) walk(node.children);
      }
    };
    for (const passage of this.result.passages) walk(passage.body);
    return output;
  }
  references(file: string, offset: number): Span[] {
    const def = this.definition(file, offset);
    if (!def) return [];
    this.analyze();
    const p = this.result.passages.find(
      (p) => p.span.file === def.file && def.start >= p.span.start - 100 && def.start <= p.span.end,
    );
    return p
      ? this.linkReferences()
          .filter((r) => r.target === p.id || r.target === p.name)
          .map((r) => r.span)
      : [];
  }
  rename(file: string, offset: number, newName: string): TextEdit[] {
    if (!/^[\p{L}_][\p{L}\p{N}_-]*$/u.test(newName))
      throw new Error('Use a simple fragment identifier for safe rename.');
    const definition = this.definition(file, offset);
    if (!definition) throw new Error('No fragment reference at this position.');
    this.analyze();
    const source = this.documents.get(definition.file)?.source ?? '',
      old = source.slice(definition.start, definition.end);
    const passage = this.result.passages.find((p) => p.name === old && p.id === old);
    if (!passage)
      throw new Error(
        'Rename is conservative: explicit id/name overrides must be edited in metadata, then references updated.',
      );
    if (this.result.passages.some((p) => p.id === newName)) throw new Error('A fragment with this id already exists.');
    return [
      { span: definition, newText: newName },
      ...this.linkReferences()
        .filter((r) => r.target === old)
        .map((r) => ({ span: r.span, newText: newName })),
    ];
  }
  virtualDocument(file: string): string | undefined {
    this.analyze();
    return this.virtuals.get(file + '.gneh.ts')?.code;
  }
  dispose(): void {
    this.language.dispose();
    this.documents.clear();
    this.virtuals.clear();
  }
}

export { offsetToPosition, printExpression };
