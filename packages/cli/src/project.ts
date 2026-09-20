import fs from 'node:fs';
import path from 'node:path';
import { assertJson, type CompileResult, type Dialect, type State } from '@gneh/core';
import { compileProject, type SourceInput } from '@gneh/compiler';
import { karlowe } from '@gneh/karlowe';
import { sugarcast } from '@gneh/sugarcast';
import { inkdown } from '@gneh/inkdown';
import { offsetToPosition } from '@gneh/source';

export interface ProjectOptions {
  snapshot?: boolean;
}

export interface Config {
  entry?: string;
  sources?: string[];
  state?: State;
  title?: string;
  dialect?: Dialect;
  live?: boolean;
  stateTypes?: string;
}

export interface Project {
  root: string;
  sources: SourceInput[];
  config: Config;
  result: CompileResult;
}

const sourceExtension = /\.(?:inkdown|karlowe|sugarcast|md|twee|tw)$/i;

/** Directories ignored by discovery and by the preview server's file watcher. */
export const ignoredDirectories = new Set([
  'node_modules',
  'dist',
  'site',
  'standalone',
  '.git',
  '.gneh',
  'verification',
]);

function collectSources(input: string): string[] {
  const stat = fs.statSync(input);
  if (stat.isFile()) return sourceExtension.test(input) ? [input] : [];
  return fs
    .readdirSync(input, { withFileTypes: true })
    .flatMap((entry) =>
      entry.name.startsWith('.') || ignoredDirectories.has(entry.name)
        ? []
        : entry.isDirectory()
          ? collectSources(path.join(input, entry.name))
          : sourceExtension.test(entry.name)
            ? [path.join(input, entry.name)]
            : [],
    )
    .sort();
}

/** Read configuration and sources once, then compile the in-memory project model. */
export function loadProject(input: string, options: ProjectOptions = {}): Project {
  const target = path.resolve(input);
  const root = fs.statSync(target).isDirectory() ? target : path.dirname(target);
  const configPath = path.join(root, 'gneh.config.json');
  const config: Config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
  if (config.state) assertJson(config.state);
  if (config.sources && !config.sources.every((value) => typeof value === 'string'))
    throw new Error('config.sources must be an array of relative paths.');

  const files = fs.statSync(target).isFile()
    ? [target]
    : (config.sources ?? ['.']).flatMap((source) => collectSources(path.resolve(root, source)));
  const sources = [...new Set(files)].map((file) => ({
    path: path.relative(root, file).replaceAll('\\', '/'),
    source: fs.readFileSync(file, 'utf8'),
    dialect: config.dialect,
  }));
  if (!sources.length) throw new Error(`No story sources in ${input}`);

  const result = compileProject(sources, {
    dialects: [inkdown(), karlowe(), sugarcast()],
    entry: config.entry,
    state: config.state,
    live: options.snapshot ? false : config.live,
    metadata: config.title ? { title: config.title } : undefined,
  });
  return { root, sources, config, result };
}

export function printDiagnostics(project: Project, json = false): void {
  if (json) {
    console.log(JSON.stringify(project.result.diagnostics, null, 2));
    return;
  }
  for (const diagnostic of project.result.diagnostics) {
    const source = project.sources.find((entry) => entry.path === diagnostic.span.file)?.source ?? '';
    const at = offsetToPosition(source, diagnostic.span.start);
    console.error(
      `${diagnostic.span.file}:${at.line + 1}:${at.character + 1} ${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`,
    );
    if (diagnostic.hint) console.error('  ' + diagnostic.hint);
  }
}
