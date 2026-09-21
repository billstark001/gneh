import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { compileSource } from '../../compiler/dist/index.js';
import { GnehError } from '../../core/dist/index.js';
import { parseInkdown, inkdown } from '../../inkdown/dist/index.js';
import { parseKarlowe, parseKarloweCST, karlowe } from '../../karlowe/dist/index.js';
import { renderText } from '../../renderer-xml/dist/index.js';
import { Story } from '../../runtime/dist/index.js';
import { parseMetadata, splitPassages } from '../../source/dist/index.js';
import { parseSugarcast, parseSugarcastCST, sugarcast } from '../../sugarcast/dist/index.js';

const syntaxSeed = 0x40c0ffee;
const metadataSeed = 0x9e3779b9;
const syntaxCases = 8_192;
const metadataCases = 16_384;
const validStoriesPerDialect = 128;
const dialects = [inkdown(), karlowe(), sugarcast()];

function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => (state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0) / 2 ** 32;
}

function generatedSource(random: () => number, atoms: readonly string[], maxLength: number): string {
  let source = '';
  const length = Math.floor(random() * maxLength);
  for (let index = 0; index < length; index++) source += atoms[Math.floor(random() * atoms.length)];
  return source;
}

function unexpected(entry: string, seed: number, index: number, source: string, error: unknown): never {
  throw new Error(
    `${entry} leaked ${error instanceof Error ? error.constructor.name : typeof error} for seed ${seed}, case ${index}: ${JSON.stringify(source)}`,
    { cause: error },
  );
}

describe('deterministic robustness smoke tests', () => {
  test('dialect and CST entry points contain malformed-input failures', () => {
    const random = generator(syntaxSeed);
    const atoms = [
      'a',
      '0',
      ' ',
      '\n',
      '(',
      ')',
      '[',
      ']',
      '{',
      '}',
      '<',
      '>',
      '$',
      '_',
      '"',
      "'",
      ':',
      ';',
      '|',
      '-',
      '*',
      '\\',
      '🦉',
    ];
    const frontends = [parseInkdown, parseKarlowe, parseSugarcast];
    const csts = [parseKarloweCST, parseSugarcastCST];

    for (let index = 0; index < syntaxCases; index++) {
      const source = `:: Start [start]\n${generatedSource(random, atoms, 96)}`;
      for (const parse of frontends) {
        try {
          parse(source);
        } catch (error) {
          unexpected(parse.name, syntaxSeed, index, source, error);
        }
      }
      for (const parse of csts) {
        try {
          parse(source);
        } catch (error) {
          if (!(error instanceof GnehError)) unexpected(parse.name, syntaxSeed, index, source, error);
        }
      }
    }
  });

  test('metadata and passage containers expose only typed failures', () => {
    const random = generator(metadataSeed);
    const atoms = [
      'a',
      'Z',
      '0',
      ' ',
      ':',
      ',',
      '-',
      '[',
      ']',
      '{',
      '}',
      "'",
      '"',
      '\\',
      '#',
      '&',
      '*',
      '!',
      '~',
      '\n',
      '\t',
      '🦉',
    ];

    for (let index = 0; index < metadataCases; index++) {
      const source = generatedSource(random, atoms, 80);
      try {
        parseMetadata(source);
      } catch (error) {
        if (!(error instanceof GnehError)) unexpected('parseMetadata', metadataSeed, index, source, error);
      }
      try {
        splitPassages(source);
      } catch (error) {
        unexpected('splitPassages', metadataSeed, index, source, error);
      }
    }
  });

  test('generated valid stories compile, start and render in every dialect', () => {
    const templates = {
      inkdown: (value: number) => `:: Start [start]
@let $value = ${value}
@if ($value >= 0) { Value {{ $value }} }`,
      karlowe: (value: number) => `:: Start [start]\n(set: $value to ${value})(if: $value >= 0)[Value (print: $value)]`,
      sugarcast: (value: number) =>
        `:: Start [start]\n<<set $value = ${value}>><<if $value >= 0>>Value <<print $value>><</if>>`,
    } as const;

    for (const dialect of dialects)
      for (let value = 0; value < validStoriesPerDialect; value++) {
        const result = compileSource(templates[dialect.dialect](value), `generated.${dialect.dialect}`, {
          dialect: dialect.dialect,
          dialects,
          entry: 'Start',
        });
        assert.deepEqual(
          result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error'),
          [],
          `${dialect.dialect} generated story ${value}`,
        );
        const story = new Story(result.story).start();
        assert.equal(renderText(story.view).trim(), `Value ${value}`);
      }
  });
});
