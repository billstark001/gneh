import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Diagnostic, Dialect } from '@gneh/core';
import { compileProject, generateModule, parseSource } from '@gneh/compiler';
import { writeFile } from './files.js';
import { emitTwineTwee, parseTwineHTML, twineDialect, twineEntry, type TwineStoryData } from './twine-html.js';

function outputDirectory(input: string, output: string | undefined, suffix: string): string {
  const directory = output
    ? path.resolve(output)
    : path.resolve(path.dirname(input), path.basename(input, path.extname(input)) + suffix);
  if (fs.existsSync(directory) && fs.readdirSync(directory).length)
    throw new Error(`Refusing to overwrite non-empty directory: ${directory}`);
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function requestedDialect(value: unknown): Dialect | undefined {
  if (value === undefined) return undefined;
  if (value === 'inkdown' || value === 'karlowe' || value === 'sugarcast') return value;
  throw new Error(`Unknown dialect ${JSON.stringify(value)}; expected inkdown, karlowe or sugarcast.`);
}

function collisions(story: TwineStoryData): Diagnostic[] {
  return story.passages.flatMap((passage) => {
    const match = /^::(?!:)\s*\S/m.exec(passage.source);
    return match
      ? [
          {
            code: 'IMPORT_TWEE_COLLISION',
            severity: 'error' as const,
            message: `${passage.name} contains a line that looks like a Twee passage header. The structured JSON retains the exact source, but the combined Twee file requires manual disambiguation.`,
            span: {
              file: passage.name,
              start: match.index,
              end: match.index + match[0].length,
            },
          },
        ]
      : [];
  });
}

function compatibility(
  story: TwineStoryData,
  dialect: Dialect,
): {
  passages: { name: string; status: 'portable' | 'unsupported'; diagnostics: Diagnostic[] }[];
  summary: { portable: number; unsupported: number; warnings: number };
} {
  const passages = story.passages.map((passage) => {
    const parsed = parseSource(passage.source, `twine-import/${passage.name}.${dialect}`, dialect);
    const unsupported = parsed.diagnostics.some((diagnostic) => diagnostic.severity === 'error');
    return {
      name: passage.name,
      status: unsupported ? ('unsupported' as const) : ('portable' as const),
      diagnostics: parsed.diagnostics,
    };
  });
  return {
    passages,
    summary: {
      portable: passages.filter((passage) => passage.status === 'portable').length,
      unsupported: passages.filter((passage) => passage.status === 'unsupported').length,
      warnings: passages.reduce(
        (total, passage) => total + passage.diagnostics.filter((item) => item.severity === 'warning').length,
        0,
      ),
    },
  };
}

function extractionRecord(story: TwineStoryData, input: string, html: string) {
  return {
    schema: 'gneh.twine-extract/v1',
    source: {
      file: path.resolve(input),
      sha256: crypto.createHash('sha256').update(html).digest('hex'),
    },
    story,
  };
}

function writeEmbeddedSources(directory: string, story: TwineStoryData): string[] {
  const files: string[] = [];
  for (const [kind, records, extension] of [
    ['stylesheet', story.stylesheets, 'css'],
    ['script', story.scripts, 'js'],
  ] as const)
    records.forEach((record, index) => {
      const name = `twine-user-${kind}-${index + 1}.${extension}`;
      writeFile(path.join(directory, name), record.source);
      files.push(name);
    });
  return files;
}

export function extractTwineFile(input: string, output?: string): string {
  const file = path.resolve(input);
  const html = fs.readFileSync(file, 'utf8');
  const story = parseTwineHTML(html);
  const directory = outputDirectory(file, output, '-extracted');
  const diagnostics = collisions(story);
  writeFile(
    path.join(directory, 'twine-story.json'),
    JSON.stringify(extractionRecord(story, file, html), null, 2) + '\n',
  );
  writeFile(path.join(directory, 'story.twee'), emitTwineTwee(story));
  const embeddedFiles = writeEmbeddedSources(directory, story);
  writeFile(
    path.join(directory, 'extract-report.json'),
    JSON.stringify(
      {
        schema: 'gneh.twine-import-report/v1',
        mode: 'extract',
        format: story.format,
        formatVersion: story.formatVersion,
        passages: story.passages.length,
        embeddedFiles,
        diagnostics,
        note: 'twine-story.json retains opening-tag attribute text and encoded passage source. story.twee is a decoded authoring representation.',
      },
      null,
      2,
    ) + '\n',
  );
  return directory;
}

export function importTwineFile(input: string, output?: string, dialectOption?: unknown): string {
  const file = path.resolve(input);
  const html = fs.readFileSync(file, 'utf8');
  const story = parseTwineHTML(html);
  const dialect = requestedDialect(dialectOption) ?? twineDialect(story);
  if (!dialect)
    throw new Error(
      `Cannot infer a gneh dialect from Twine format ${JSON.stringify(story.format || '(missing)')}; pass --dialect explicitly.`,
    );
  const directory = outputDirectory(file, output, '-gneh');
  const sourceName = `story.${dialect}`;
  const source = emitTwineTwee(story);
  const checked = compatibility(story, dialect);
  const containerDiagnostics = collisions(story);
  const entry = twineEntry(story) ?? 'Start';
  const project = compileProject([{ path: sourceName, source, dialect }], { entry });
  const declarationName = `story.d.${dialect}.ts`;
  const declarations = project.passages.length
    ? generateModule(project.passages, source, sourceName).declarations
    : undefined;
  const title = typeof story.attributes.name === 'string' ? story.attributes.name : undefined;

  writeFile(
    path.join(directory, 'twine-story.json'),
    JSON.stringify(extractionRecord(story, file, html), null, 2) + '\n',
  );
  writeFile(path.join(directory, sourceName), source);
  if (declarations) writeFile(path.join(directory, declarationName), declarations);
  const embeddedFiles = writeEmbeddedSources(directory, story);
  writeFile(
    path.join(directory, 'gneh.config.json'),
    JSON.stringify(
      {
        ...(title ? { title } : {}),
        entry,
        sources: [sourceName],
        dialect,
      },
      null,
      2,
    ) + '\n',
  );
  writeFile(
    path.join(directory, 'import-report.json'),
    JSON.stringify(
      {
        schema: 'gneh.twine-import-report/v1',
        mode: 'import-twine',
        format: story.format,
        formatVersion: story.formatVersion,
        dialect,
        entry,
        summary: checked.summary,
        passages: checked.passages,
        containerDiagnostics,
        projectDiagnostics: project.diagnostics,
        embeddedFiles,
        fidelity: {
          exactHtmlPreserved: false,
          encodedPassageSourcePreservedIn: 'twine-story.json',
          decodedAuthoringSourceWrittenTo: sourceName,
          typeDeclarationsWrittenTo: declarations ? declarationName : null,
          allOpeningTagAttributesPreserved: true,
          tagDefinitionsPreservedIn: 'twine-story.json',
          embeddedUserCodeAutomaticallyLoaded: false,
        },
        note: 'Portable status means accepted by the documented gneh dialect, not behavioral equivalence with the original story format.',
      },
      null,
      2,
    ) + '\n',
  );
  return directory;
}
