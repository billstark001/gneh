#!/usr/bin/env node
/**
 * Run the staged compatibility audit against an external gneh-ws corpus.
 *
 * Samples are never copied into this repository. Plain compiled HTML and zip
 * archives containing compiled HTML are both accepted. Static source declarations
 * are inventoried but never executed. Set GNEH_SAMPLE_DIR to override the default
 * sibling directory.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { auditTwineHTML } from './audit-twine-html.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const corpus = path.resolve(process.env.GNEH_SAMPLE_DIR ?? path.join(root, '..', 'gneh-ws'));

function readSample(file) {
  if (!file.toLowerCase().endsWith('.zip')) return fs.readFileSync(file, 'utf8');
  const entries = execFileSync('unzip', ['-Z1', file, '*.html'], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
    .split(/\r?\n/)
    .filter((entry) => entry.toLowerCase().endsWith('.html'));
  if (!entries.length) throw new Error('Archive contains no HTML file.');
  return execFileSync('unzip', ['-p', file, entries[0]], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
}

if (!fs.existsSync(corpus)) throw new Error(`Sample directory does not exist: ${corpus}`);

const results = [];

for (const name of fs.readdirSync(corpus).sort()) {
  const file = path.join(corpus, name);
  if (!fs.statSync(file).isFile()) continue;
  try {
    results.push(auditTwineHTML(readSample(file), file, { sampleLimit: 3 }));
  } catch (error) {
    results.push({ file, skipped: error instanceof Error ? error.message : String(error) });
  }
}

console.log(JSON.stringify(results, null, 2));
