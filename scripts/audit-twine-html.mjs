#!/usr/bin/env node
/**
 * Staged compatibility audit for compiled Twine HTML.
 *
 * This never executes story JavaScript. Static SugarCube widget declarations can
 * resolve through Sugarcast's portable view lowering; Macro.add declarations remain
 * inventory only and require an application-provided RuntimeExtension.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createKarloweLowerings,
  harloweMacroName,
  parseKarlowe,
  parseKarloweCST,
} from '../packages/karlowe/dist/index.js';
import { createSugarcastLowerings, parseSugarcast, parseSugarcastCST } from '../packages/sugarcast/dist/index.js';
import { parseTwineHTML } from '../packages/cli/dist/twine-html.js';

export const extractTwineStory = parseTwineHTML;

const stageNames = ['structured', 'declared', 'resolved', 'lowered', 'runtime-satisfied'];

function staticString(source, index) {
  const quote = source[index];
  if (!['"', "'", '`'].includes(quote)) return;
  let value = '';
  for (let cursor = index + 1; cursor < source.length; cursor++) {
    const character = source[cursor];
    if (character === '\\') {
      if (cursor + 1 >= source.length) return;
      value += source[++cursor];
    } else if (character === quote) return { value, end: cursor + 1 };
    else value += character;
  }
}

function staticFirstArgument(source, index) {
  while (/\s/.test(source[index] ?? '')) index++;
  const direct = staticString(source, index);
  if (direct) return { values: [direct.value], end: direct.end };
  if (source[index] !== '[') return;
  const values = [];
  let cursor = index + 1;
  while (cursor < source.length) {
    while (/\s|,/.test(source[cursor] ?? '')) cursor++;
    if (source[cursor] === ']') return { values, end: cursor + 1 };
    const item = staticString(source, cursor);
    if (!item) return;
    values.push(item.value);
    cursor = item.end;
  }
}

function collectSugarcastDeclarations(story) {
  const declarations = new Map();
  let dynamic = 0;
  const declare = (name, kind, source) => {
    const normalized = name.toLowerCase();
    if (!normalized) return;
    const id = `sugarcast/${normalized}`;
    const existing = declarations.get(id) ?? { id, kind, sources: [] };
    if (existing.sources.length < 3) existing.sources.push(source);
    declarations.set(id, existing);
  };
  for (const passage of story.passages) {
    for (const match of passage.source.matchAll(/<<\s*widget\s+(["'`])((?:\\.|[^\\])*?)\1/gi))
      declare(match[2].replace(/\\([\\"'`])/g, '$1'), 'widget', passage.name);
  }
  for (const [scriptIndex, script] of story.scripts.entries()) {
    const calls = /\b(?:Macro\.add|DefineMacro)\s*\(/g;
    for (const match of script.source.matchAll(calls)) {
      const argument = staticFirstArgument(script.source, match.index + match[0].length);
      if (!argument?.values.length) {
        dynamic++;
        continue;
      }
      for (const name of argument.values) declare(name, 'script-registration', `script:${scriptIndex + 1}`);
    }
  }
  return { declarations, dynamic };
}

function collectKarloweDeclarations(story) {
  const declarations = new Map();
  let dynamic = 0;
  for (const passage of story.passages) {
    for (const match of passage.source.matchAll(/\(set:\s*\$([\w-]+)\s+to\s+\(macro:/gi)) {
      const name = harloweMacroName(match[1]);
      const id = `karlowe/${name}`;
      declarations.set(id, {
        id,
        kind: 'macro-value',
        sources: [passage.name],
      });
    }
  }
  return { declarations, dynamic };
}

function collectKarloweOccurrences(nodes, output = []) {
  for (const node of nodes) {
    if (node.type === 'macro') output.push(`karlowe/${harloweMacroName(node.name)}`);
    else if (node.type === 'hook') collectKarloweOccurrences(node.children, output);
  }
  return output;
}

function collectSugarcastOccurrences(nodes, output = []) {
  for (const node of nodes) {
    if (node.type !== 'macro') continue;
    if (!node.name.startsWith('/')) output.push(`sugarcast/${node.name.toLowerCase()}`);
    collectSugarcastOccurrences(node.children, output);
  }
  return output;
}

function walkNodes(nodes, visit) {
  for (const node of nodes) {
    visit(node);
    if (node.type === 'if') {
      walkNodes(node.yes, visit);
      walkNodes(node.no, visit);
    } else {
      if ('children' in node) walkNodes(node.children, visit);
      if (node.type === 'interaction' || node.type === 'control') walkNodes(node.label, visit);
    }
  }
}

function increment(map, key, amount = 1) {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function top(map, limit) {
  return Object.fromEntries(
    [...map].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).slice(0, limit),
  );
}

function addSample(samples, stage, limit, value) {
  if (!limit) return;
  const entries = samples[stage];
  if (entries.length < limit) entries.push(value);
}

export function auditTwineHTML(html, file = 'story.html', options = {}) {
  const story = extractTwineStory(html);
  const normalized = story.format.toLowerCase();
  const dialect = normalized === 'harlowe' ? 'karlowe' : normalized === 'sugarcube' ? 'sugarcast' : undefined;
  if (!dialect)
    throw new Error(
      `Unsupported Twine story format ${JSON.stringify(story.format || '(missing)')}; expected Harlowe or SugarCube.`,
    );

  const parse = dialect === 'karlowe' ? parseKarlowe : parseSugarcast;
  const lowerings = dialect === 'karlowe' ? createKarloweLowerings() : createSugarcastLowerings();
  const builtins = new Set(lowerings.entries().map((definition) => `${dialect}/${definition.name}`));
  const inventory = dialect === 'karlowe' ? collectKarloweDeclarations(story) : collectSugarcastDeclarations(story);
  const configured = new Set(options.declaredRuntimeExtensionIds ?? []);
  const implemented = new Set(options.runtimeExtensionIds ?? []);
  const declarationForms = new Set(dialect === 'sugarcast' ? ['sugarcast/widget'] : []);
  const stages = Object.fromEntries(stageNames.map((name) => [name, { passed: 0, failed: 0 }]));
  const samples = Object.fromEntries(stageNames.map((name) => [name, []]));
  const diagnostics = new Map();
  const occurrencesById = new Map();
  const undeclaredById = new Map();
  const runtimeMissingById = new Map();
  const occurrenceKinds = {
    total: 0,
    builtin: 0,
    sourceDeclared: 0,
    configured: 0,
    declarationForm: 0,
    undeclared: 0,
  };
  let warnings = 0;
  let invokeNodes = 0;

  for (const passage of story.passages) {
    let occurrences = [];
    let structureDiagnostics = [];
    try {
      if (dialect === 'karlowe') {
        const cst = parseKarloweCST(passage.source);
        occurrences = collectKarloweOccurrences(cst.children);
      } else {
        const cst = parseSugarcastCST(passage.source);
        occurrences = collectSugarcastOccurrences(cst.children);
        structureDiagnostics = cst.diagnostics;
      }
    } catch (error) {
      structureDiagnostics = [
        {
          code: error?.code ?? 'CST',
          message: error instanceof Error ? error.message : String(error),
        },
      ];
    }

    const structured = structureDiagnostics.length === 0;
    const undeclared = [];
    const unresolved = [];
    for (const id of occurrences) {
      occurrenceKinds.total++;
      increment(occurrencesById, id);
      if (builtins.has(id)) occurrenceKinds.builtin++;
      else if (inventory.declarations.has(id)) {
        occurrenceKinds.sourceDeclared++;
        if (inventory.declarations.get(id).kind !== 'widget') unresolved.push(id);
      } else if (configured.has(id)) occurrenceKinds.configured++;
      else if (declarationForms.has(id)) {
        occurrenceKinds.declarationForm++;
        unresolved.push(id);
      } else {
        occurrenceKinds.undeclared++;
        undeclared.push(id);
        increment(undeclaredById, id);
      }
    }
    const declared = structured && undeclared.length === 0;
    const resolved = declared && unresolved.length === 0;

    const result = parse(passage.source, `${file}#${passage.name}`);
    const errors = result.diagnostics.filter((item) => item.severity === 'error');
    warnings += result.diagnostics.length - errors.length;
    for (const item of errors) increment(diagnostics, item.code);
    const invocations = [];
    for (const parsedPassage of result.passages)
      walkNodes(parsedPassage.body, (node) => {
        if (node.type === 'invoke') invocations.push(node.id);
      });
    const genericInvocations = invocations.filter(
      (id) => !(dialect === 'sugarcast' && inventory.declarations.get(id)?.kind === 'widget'),
    );
    invokeNodes += genericInvocations.length;
    const lowered = resolved && errors.length === 0;
    const runtimeMissing = lowered ? genericInvocations.filter((id) => !implemented.has(id)) : [];
    for (const id of runtimeMissing) increment(runtimeMissingById, id);
    const runtimeSatisfied = lowered && runtimeMissing.length === 0;
    const outcomes = {
      structured,
      declared,
      resolved,
      lowered,
      'runtime-satisfied': runtimeSatisfied,
    };
    for (const stage of stageNames) {
      stages[stage][outcomes[stage] ? 'passed' : 'failed']++;
      if (!outcomes[stage]) {
        const blockers =
          stage === 'structured'
            ? structureDiagnostics.map((item) => item.code)
            : stage === 'declared'
              ? structured
                ? [...new Set(undeclared)]
                : ['structured']
              : stage === 'resolved'
                ? declared
                  ? [...new Set(unresolved)]
                  : ['declared']
                : stage === 'lowered'
                  ? resolved
                    ? errors.map((item) => item.code)
                    : ['resolved']
                  : lowered
                    ? [...new Set(runtimeMissing)]
                    : ['lowered'];
        addSample(samples, stage, options.sampleLimit ?? 0, {
          passage: passage.name,
          blockers: blockers.slice(0, 5),
        });
      }
    }
  }

  const idLimit = options.idLimit ?? 20;
  const declarationKinds = new Map();
  for (const declaration of inventory.declarations.values()) increment(declarationKinds, declaration.kind);
  return {
    schema: 'gneh.compatibility-audit/v2',
    stageDefinitions: {
      structured: 'The dialect CST is balanced and preserves the passage syntax.',
      declared:
        'Every macro occurrence names a built-in, a static source declaration, a configured extension, or a recognized declaration form.',
      resolved:
        'Every declared occurrence resolves to a built-in lowering, a static declaration, or a configured extension ID.',
      lowered: 'All preceding gates pass and the dialect frontend emits semantic IR without errors.',
      'runtime-satisfied': 'The passage lowers and every generic invoke node has an installed RuntimeExtension ID.',
    },
    file,
    format: story.format,
    formatVersion: story.formatVersion,
    dialect,
    passages: story.passages.length,
    stages,
    declarations: {
      static: inventory.declarations.size,
      dynamic: inventory.dynamic,
      byKind: Object.fromEntries(declarationKinds),
      ...(options.sampleLimit ? { samples: [...inventory.declarations.values()].slice(0, options.sampleLimit) } : {}),
    },
    occurrences: {
      ...occurrenceKinds,
      topById: top(occurrencesById, idLimit),
      topUndeclaredById: top(undeclaredById, idLimit),
    },
    lowering: {
      invokeNodes,
      warnings,
      errorsByCode: top(diagnostics, idLimit),
    },
    runtime: {
      declaredExtensionIds: configured.size,
      implementedExtensionIds: implemented.size,
      missingInvocations: [...runtimeMissingById.values()].reduce((sum, count) => sum + count, 0),
      topMissingById: top(runtimeMissingById, idLimit),
    },
    ...(options.sampleLimit ? { samples } : {}),
  };
}

function main(args) {
  const details = args.includes('--details');
  const files = args.filter((argument) => argument !== '--' && argument !== '--details');
  if (!files.length)
    throw new Error('Usage: node scripts/audit-twine-html.mjs [--details] <compiled-story.html> [...]');
  for (const file of files) {
    const resolved = path.resolve(file);
    console.log(
      JSON.stringify(
        auditTwineHTML(fs.readFileSync(resolved, 'utf8'), resolved, {
          sampleLimit: details ? 3 : 0,
        }),
        null,
        2,
      ),
    );
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
