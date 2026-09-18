import fs from 'node:fs';
import path from 'node:path';
import { Command, CommanderError, Option } from 'commander';
import { ABI_VERSION } from '@gneh/core';
import { assertValid, generateModule, graph, toInkdown } from '@gneh/compiler';
import { emitTwee, splitPassages } from '@gneh/source';
import { writeFile } from './files.js';
import { inspectProject, type InspectionLevel } from './inspect.js';
import { loadProject, printDiagnostics, type Project } from './project.js';
import { extractTwineFile, importTwineFile } from './twine.js';

async function typeCheck(project: Project): Promise<void> {
  let service;
  try {
    const { GnehLanguageService } = await import('@gneh/language-service');
    service = new GnehLanguageService({
      state: project.config.state,
      entry: project.config.entry,
      live: project.config.live,
      stateTypes: project.config.stateTypes,
    });
    for (const source of project.sources) service.setDocument(source.path, source.source);
    project.result.diagnostics = service.diagnostics();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND')
      throw new Error('Type checking requires workspace dependencies: run pnpm install && pnpm build.');
    throw error;
  } finally {
    service?.dispose();
  }
}

function writeOrPrint(content: string, output?: string): void {
  if (output) writeFile(output, content);
  else process.stdout.write(content);
}

function addOutput(command: Command, description: string): Command {
  return command.option('-o, --output <path>', description);
}

export function createProgram(): Command {
  const program = new Command()
    .name('gneh')
    .version('0.1.0')
    .description('Typed narrative modules and story-domain tooling.')
    .showHelpAfterError()
    .exitOverride();

  program
    .command('check')
    .description('Validate a story file or project.')
    .argument('<input>', 'story file or project directory')
    .option('--json', 'print diagnostics as JSON')
    .option('--types', 'include TypeScript projection diagnostics')
    .option('--snapshot', 'reject features that require a live runtime')
    .action(async (input: string, options: { json?: boolean; types?: boolean; snapshot?: boolean }) => {
      const project = loadProject(input, { snapshot: options.snapshot });
      if (options.types) await typeCheck(project);
      printDiagnostics(project, options.json ?? false);
      if (project.result.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) process.exitCode = 1;
      else if (!options.json)
        console.log(`Checked ${project.sources.length} files / ${project.result.passages.length} passages; no errors.`);
    });

  addOutput(
    program
      .command('metadata')
      .description('Emit merged passage metadata keyed by ID.')
      .argument('<input>', 'story file or project directory'),
    'metadata JSON file',
  ).action((input: string, options: { output?: string }) => {
    const project = loadProject(input);
    assertValid(project.result);
    writeOrPrint(
      JSON.stringify(
        Object.fromEntries(project.result.passages.map((passage) => [passage.id, passage.metadata])),
        null,
        2,
      ) + '\n',
      options.output,
    );
  });

  program
    .command('graph')
    .description('Emit the static navigation/include graph.')
    .argument('<input>', 'project directory')
    .option('--json', 'emit JSON instead of Graphviz DOT')
    .action((input: string, options: { json?: boolean }) => {
      const project = loadProject(input);
      assertValid(project.result);
      const edges = graph(project.result.passages);
      console.log(
        options.json
          ? JSON.stringify(edges, null, 2)
          : 'digraph gneh {\n' +
              project.result.passages.map((passage) => '  ' + JSON.stringify(passage.id) + ';').join('\n') +
              '\n' +
              edges
                .map(
                  (edge) =>
                    `  ${JSON.stringify(edge.from)} -> ${JSON.stringify(edge.to)} [label=${JSON.stringify(edge.kind)}];`,
                )
                .join('\n') +
              '\n}',
      );
    });

  addOutput(
    program
      .command('compile')
      .description('Emit ESM, declarations, source maps and a manifest.')
      .argument('<input>', 'story file or project directory'),
    'output directory (default: <project>/.gneh/esm)',
  ).action((input: string, options: { output?: string }) => {
    const project = loadProject(input);
    printDiagnostics(project);
    assertValid(project.result);
    const output = path.resolve(options.output ?? path.join(project.root, '.gneh', 'esm'));
    for (const source of project.sources) {
      const passages = project.result.passages.filter((passage) => passage.span.file === source.path);
      if (!passages.length) continue;
      const emitted = generateModule(passages, source.source, source.path);
      const name = source.path.replace(/\.[^.]+$/, '.mjs');
      writeFile(path.join(output, name), emitted.code + `//# sourceMappingURL=${path.basename(name)}.map\n`);
      writeFile(path.join(output, name + '.map'), JSON.stringify(emitted.map));
      writeFile(path.join(output, name.replace(/\.mjs$/, '.d.mts')), emitted.declarations);
    }
    writeFile(
      path.join(output, 'manifest.json'),
      JSON.stringify(
        {
          abi: ABI_VERSION,
          entry: project.result.story.entry,
          metadata: Object.fromEntries(project.result.passages.map((passage) => [passage.id, passage.metadata])),
          sources: project.sources.map((source) => ({
            source: source.path,
            module: source.path.replace(/\.[^.]+$/, '.mjs'),
          })),
        },
        null,
        2,
      ),
    );
    console.log(`ESM, declarations, source maps and manifest written to ${output}`);
  });

  addOutput(
    program
      .command('migrate')
      .description('Rewrite the supported portable profile to Inkdown.')
      .argument('<input>', 'story file or project directory'),
    'Inkdown output file (default: <project>/migrated.inkdown)',
  ).action((input: string, options: { output?: string }) => {
    const project = loadProject(input);
    const output = path.resolve(options.output ?? path.join(project.root, 'migrated.inkdown'));
    const report = output + '.report.json';
    writeFile(
      report,
      JSON.stringify(
        {
          supported: project.result.passages.map((passage) => ({
            id: passage.id,
            dialect: passage.dialect,
            status: 'portable',
          })),
          diagnostics: project.result.diagnostics,
          semanticProfile: 'gneh-0.1',
          note: 'Not a full Harlowe/SugarCube compatibility claim. Unsupported passages are not silently rewritten.',
        },
        null,
        2,
      ),
    );
    assertValid(project.result);
    writeFile(output, toInkdown(project.result.passages));
    console.log(`Wrote ${output} and ${report}`);
  });

  addOutput(
    program
      .command('fmt')
      .description('Canonicalize Twee headers and metadata without reformatting prose.')
      .argument('<file>', 'Twee or gneh source file'),
    'output file (default: stdout)',
  ).action((file: string, options: { output?: string }) => {
    const source = fs.readFileSync(file, 'utf8');
    const parsed = splitPassages(source, file);
    if (parsed.diagnostics.some((diagnostic) => diagnostic.severity === 'error'))
      throw new Error(parsed.diagnostics.map((diagnostic) => diagnostic.message).join('\n'));
    writeOrPrint(emitTwee(parsed.passages), options.output);
  });

  addOutput(
    program
      .command('extract')
      .description('Extract structured Twine data and decoded Twee without executing HTML.')
      .argument('<html>', 'compiled Twine HTML file'),
    'new output directory',
  ).action((html: string, options: { output?: string }) => {
    const output = extractTwineFile(html, options.output);
    console.log(`Extracted Twine data and decoded Twee source → ${output}`);
  });

  addOutput(
    program
      .command('import-twine')
      .description('Create a gneh project and compatibility report from Twine HTML.')
      .argument('<html>', 'compiled Twine HTML file')
      .addOption(
        new Option('--dialect <dialect>', 'override the inferred gneh dialect').choices([
          'inkdown',
          'karlowe',
          'sugarcast',
        ]),
      ),
    'new project directory',
  ).action((html: string, options: { output?: string; dialect?: string }) => {
    const output = importTwineFile(html, options.output, options.dialect);
    console.log(`Imported Twine project with a compatibility report → ${output}`);
  });

  addOutput(
    program
      .command('inspect')
      .description('Emit a versioned public container, syntax or resolved IR record.')
      .argument('<input>', 'story file or project directory')
      .addOption(
        new Option('--level <level>', 'inspection boundary').choices(['container', 'syntax', 'ir']).default('ir'),
      )
      .option('--passage <id-or-name>', 'filter to one passage'),
    'JSON output file (default: stdout)',
  ).action((input: string, options: { level: InspectionLevel; passage?: string; output?: string }) => {
    const project = loadProject(input);
    writeOrPrint(
      JSON.stringify(inspectProject(project, options.level, options.passage), null, 2) + '\n',
      options.output,
    );
  });

  program
    .command('lsp')
    .description('Start the Language Server Protocol adapter on standard I/O.')
    .action(async () => {
      await (await import('@gneh/lsp')).startServer();
    });

  return program;
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const program = createProgram();
  if (!args.length) {
    program.outputHelp();
    return;
  }
  try {
    await program.parseAsync(args, { from: 'user' });
  } catch (error) {
    if (error instanceof CommanderError) {
      if (error.exitCode) process.exitCode = error.exitCode;
      return;
    }
    throw error;
  }
}
