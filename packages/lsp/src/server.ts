import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GnehLanguageService, offsetToPosition, type ServiceOptions } from '@gneh/language-service';

// JSON-RPC is an untyped wire boundary; every document and edit is validated below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Wire = any;

export interface Transport {
  notify(method: string, params: unknown): void;
}

const extensions = /\.(?:md|inkdown|karlowe|sugarcast|sugar|tw|twee)$/i;

const ignored = new Set(['node_modules', '.git', 'dist', 'standalone', 'site', '.gneh']);

function filename(uri: string): string {
  return uri.startsWith('file:') ? fileURLToPath(uri) : uri;
}

function uri(file: string): string {
  return file.startsWith('file:') ? file : pathToFileURL(file).href;
}

function at(
  source: string,
  position: {
    line: number;
    character: number;
  },
): number {
  const lines = source.split('\n');
  let offset = 0;
  for (let i = 0; i < Math.max(0, position.line) && i < lines.length; i++) offset += lines[i].length + 1;
  return Math.min(source.length, offset + Math.max(0, position.character));
}

/** Protocol logic is transport-independent and is tested over real stdio framing. */
export class LanguageServer {
  readonly service = new GnehLanguageService();
  private open = new Set<string>();
  private root = '';
  private sourceRoots: string[] = [];
  private stopped = false;
  constructor(private transport: Transport) {}
  private options: ServiceOptions = {};
  private readConfig(): void {
    const config = path.join(this.root, 'gneh.config.json');
    try {
      const data = JSON.parse(fs.readFileSync(config, 'utf8'));
      this.options = {
        state: data.state ?? {},
        entry: data.entry,
        live: data.live,
        stateTypes: data.stateTypes,
      };
      this.service.configure(this.options);
      this.sourceRoots = Array.isArray(data.sources)
        ? data.sources.filter((s: unknown) => typeof s === 'string').map((s: string) => path.resolve(this.root, s))
        : [this.root];
    } catch (error) {
      if (fs.existsSync(config))
        this.transport.notify('window/logMessage', {
          type: 2,
          message: `gneh configuration: ${(error as Error).message}`,
        });
    }
  }
  private index(directory: string, depth = 0): void {
    if (depth > 20) return;
    try {
      if (fs.statSync(directory).isFile()) {
        if (extensions.test(directory) && !this.open.has(directory))
          this.service.setDocument(directory, fs.readFileSync(directory, 'utf8'));
        return;
      }
    } catch {
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (ignored.has(entry.name) || entry.isSymbolicLink()) continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) this.index(file, depth + 1);
      else if (extensions.test(entry.name) && !this.open.has(file)) {
        try {
          const source = fs.readFileSync(file, 'utf8');
          if (source.length < 2000000) this.service.setDocument(file, source);
        } catch {
          /* deleted during scan */
        }
      }
    }
  }
  private range(span: { file: string; start: number; end: number }): Wire {
    const text = this.service.documents.get(span.file)?.source ?? '';
    return { start: offsetToPosition(text, span.start), end: offsetToPosition(text, span.end) };
  }
  private location(span: { file: string; start: number; end: number }): Wire {
    return { uri: uri(span.file), range: this.range(span) };
  }
  private publish(): void {
    const diagnostics = this.service.diagnostics();
    for (const file of this.service.documents.keys())
      this.transport.notify('textDocument/publishDiagnostics', {
        uri: uri(file),
        version: this.service.documents.get(file)?.version,
        diagnostics: diagnostics
          .filter((d) => d.span.file === file)
          .map((d) => ({
            range: this.range(d.span),
            severity: d.severity === 'error' ? 1 : 2,
            code: d.code,
            source: 'gneh',
            message: d.message + (d.hint ? '\n' + d.hint : ''),
          })),
      });
  }
  async request(method: string, params: Wire = {}): Promise<unknown> {
    if (this.stopped && method !== 'exit') throw new Error('Language server has shut down.');
    if (method === 'initialize') {
      this.root = params.rootUri
        ? filename(params.rootUri)
        : params.workspaceFolders?.[0]?.uri
          ? filename(params.workspaceFolders[0].uri)
          : (params.rootPath ?? process.cwd());
      this.readConfig();
      for (const source of this.sourceRoots.length ? this.sourceRoots : [this.root]) this.index(source);
      return {
        serverInfo: { name: 'gneh', version: '0.1.0' },
        capabilities: {
          textDocumentSync: { openClose: true, change: 2, save: { includeText: true } },
          completionProvider: { triggerCharacters: ['$', '.', '@', '>', '"'] },
          hoverProvider: true,
          definitionProvider: true,
          referencesProvider: true,
          renameProvider: true,
          documentSymbolProvider: true,
          workspaceSymbolProvider: true,
          documentFormattingProvider: false,
          workspace: { workspaceFolders: { supported: true, changeNotifications: false } },
        },
      };
    }
    if (method === 'initialized') {
      this.publish();
      return;
    }
    if (method === 'shutdown') {
      this.stopped = true;
      this.service.dispose();
      return null;
    }
    if (method === 'exit') {
      process.exitCode = this.stopped ? 0 : 1;
      return;
    }
    if (method === 'workspace/didChangeConfiguration') {
      this.readConfig();
      this.publish();
      return;
    }
    if (method === 'workspace/didChangeWatchedFiles') {
      for (const change of params.changes ?? []) {
        const file = filename(change.uri);
        if (path.basename(file) === 'gneh.config.json') {
          this.readConfig();
          continue;
        }
        if (this.open.has(file) || !extensions.test(file)) continue;
        if (change.type === 3) this.service.removeDocument(file);
        else
          try {
            this.service.setDocument(file, fs.readFileSync(file, 'utf8'));
          } catch {
            /* deletion */
          }
      }
      this.publish();
      return;
    }
    if (method === 'workspace/symbol') {
      const q = String(params.query ?? '').toLowerCase();
      return [...this.service.documents.keys()].flatMap((file) =>
        this.service
          .symbols(file)
          .filter((s) => s.name.toLowerCase().includes(q))
          .map((s) => ({
            name: s.name,
            kind: s.kind === 'action' ? 12 : 2,
            location: this.location(s.span),
          })),
      );
    }
    if (method === 'gneh/virtualDocument') return this.service.virtualDocument(filename(params.uri));
    if (method === '$/cancelRequest' || method === '$/setTrace') return;
    const document = params.textDocument;
    if (!document?.uri) return null;
    const file = filename(document.uri);
    if (method === 'textDocument/didOpen') {
      if (typeof document.text !== 'string') throw new Error('didOpen requires text');
      this.open.add(file);
      this.service.setDocument(file, document.text, document.version);
      this.publish();
      return;
    }
    if (method === 'textDocument/didClose') {
      this.open.delete(file);
      try {
        this.service.setDocument(file, fs.readFileSync(file, 'utf8'));
      } catch {
        this.service.removeDocument(file);
      }
      this.transport.notify('textDocument/publishDiagnostics', {
        uri: document.uri,
        diagnostics: [],
      });
      return;
    }
    if (method === 'textDocument/didChange') {
      let source = this.service.documents.get(file)?.source ?? '';
      for (const edit of params.contentChanges ?? []) {
        if (typeof edit.text !== 'string') throw new Error('Invalid content edit');
        if (edit.range) {
          const start = at(source, edit.range.start),
            end = at(source, edit.range.end);
          source = source.slice(0, start) + edit.text + source.slice(end);
        } else source = edit.text;
      }
      this.service.setDocument(file, source, document.version);
      this.publish();
      return;
    }
    if (method === 'textDocument/didSave') {
      if (typeof params.text === 'string') this.service.setDocument(file, params.text);
      this.publish();
      return;
    }
    const source = this.service.documents.get(file)?.source ?? '',
      offset = params.position ? at(source, params.position) : 0;
    switch (method) {
      case 'textDocument/completion':
        return {
          isIncomplete: false,
          items: this.service.completions(file, offset).map((c) => ({
            label: c.label,
            insertText: c.insertText ?? c.label,
            detail: c.detail,
            kind: { variable: 6, property: 10, function: 3, reference: 18, keyword: 14 }[c.kind],
          })),
        };
      case 'textDocument/hover': {
        const result = this.service.hover(file, offset);
        return result
          ? {
              contents: { kind: 'markdown', value: result.contents },
              range: this.range(result.span),
            }
          : null;
      }
      case 'textDocument/definition': {
        const result = this.service.definition(file, offset);
        return result ? this.location(result) : null;
      }
      case 'textDocument/references':
        return this.service.references(file, offset).map((span) => this.location(span));
      case 'textDocument/rename': {
        const changes: Record<string, Wire[]> = {};
        for (const edit of this.service.rename(file, offset, String(params.newName))) {
          (changes[uri(edit.span.file)] ??= []).push({
            range: this.range(edit.span),
            newText: edit.newText,
          });
        }
        return { changes };
      }
      case 'textDocument/documentSymbol':
        return this.service.symbols(file).map((s) => ({
          name: s.name,
          kind: s.kind === 'action' ? 12 : 2,
          range: this.range(s.span),
          selectionRange: this.range(s.span),
        }));
      default:
        return null;
    }
  }
}
